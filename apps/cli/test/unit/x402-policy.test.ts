// Verifies: ADR-0092
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  addX402PolicyRule,
  authorizeX402Requirement,
  initializeX402Policy,
  loadX402Policy,
  parseX402Policy,
  removeX402PolicyRule,
  saveX402Policy,
  setX402PolicyRuleEnabled,
  X402_POLICY_JSON_SCHEMA,
  type X402Policy,
} from '../../src/lib/x402-policy.js';

const ASSET = '0x0000000000000000000000000000000000000001';
const PAY_TO = '0x0000000000000000000000000000000000000002';

function policy(overrides: Partial<X402Policy> = {}): X402Policy {
  return parseX402Policy({
    version: 1,
    networks: { 'eip155:8453': { rpcUrlEnv: 'BASE_RPC_URL' } },
    rules: [
      {
        id: 'example',
        enabled: true,
        priority: 10,
        origin: 'https://api.example.com',
        pathPrefix: '/v1/',
        methods: ['GET', 'POST'],
        unattended: true,
        maxAuthorizationSeconds: 300,
        payments: [
          {
            scheme: 'upto',
            network: 'eip155:8453',
            asset: ASSET,
            payTo: PAY_TO,
            maxPerPayment: '100',
            spendWindow: { seconds: 3600, max: '500' },
          },
        ],
      },
    ],
    ...overrides,
  });
}

describe('x402 policy', () => {
  let temporaryDirectory: string;
  let policyPath: string;

  beforeEach(async () => {
    temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'x402-policy-test-'));
    policyPath = path.join(temporaryDirectory, 'policy.json');
  });

  afterEach(async () => {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  });

  it('rejects non-HTTPS origins', () => {
    expect(() =>
      parseX402Policy({
        ...policy(),
        rules: [{ ...policy().rules[0], origin: 'http://api.example.com' }],
      })
    ).toThrow('origin must use HTTPS');
  });

  it('rejects duplicate rule ids', () => {
    const base = policy();
    expect(() => parseX402Policy({ ...base, rules: [base.rules[0], base.rules[0]] })).toThrow(
      'duplicate rule id'
    );
  });

  it('rejects a per-payment amount above the window maximum', () => {
    const base = policy();
    expect(() =>
      parseX402Policy({
        ...base,
        rules: [
          {
            ...base.rules[0],
            payments: [
              {
                ...base.rules[0].payments[0],
                maxPerPayment: '501',
              },
            ],
          },
        ],
      })
    ).toThrow('maxPerPayment must not exceed');
  });

  it('requires unattended payment entries to pin the recipient', () => {
    const base = policy();
    const payment = { ...base.rules[0].payments[0] } as Record<string, unknown>;
    delete payment['payTo'];
    expect(() =>
      parseX402Policy({
        ...base,
        rules: [{ ...base.rules[0], payments: [payment] }],
      })
    ).toThrow('must pin payTo');
  });

  it('authorizes a matching unattended requirement', () => {
    const result = authorizeX402Requirement({
      policy: policy(),
      url: new URL('https://api.example.com/v1/generate'),
      method: 'POST',
      requirement: {
        scheme: 'upto',
        network: 'eip155:8453',
        amount: '90',
        asset: ASSET,
        payTo: PAY_TO,
        maxTimeoutSeconds: 60,
      },
      nonInteractive: true,
    });
    expect(result.rule.id).toBe('example');
    expect(result.payment.maxPerPayment).toBe('100');
  });

  it('rejects a requirement above the per-payment maximum', () => {
    expect(() =>
      authorizeX402Requirement({
        policy: policy(),
        url: new URL('https://api.example.com/v1/generate'),
        method: 'POST',
        requirement: {
          scheme: 'upto',
          network: 'eip155:8453',
          amount: '101',
          asset: ASSET,
          payTo: PAY_TO,
          maxTimeoutSeconds: 60,
        },
        nonInteractive: true,
      })
    ).toThrow('does not allow');
  });

  it('rejects a requirement that redirects payment to another recipient', () => {
    expect(() =>
      authorizeX402Requirement({
        policy: policy(),
        url: new URL('https://api.example.com/v1/generate'),
        method: 'POST',
        requirement: {
          scheme: 'upto',
          network: 'eip155:8453',
          amount: '90',
          asset: ASSET,
          payTo: '0x0000000000000000000000000000000000000099',
          maxTimeoutSeconds: 60,
        },
        nonInteractive: true,
      })
    ).toThrow('does not allow');
  });

  it('rejects unattended use of an interactive-only rule', () => {
    const base = policy();
    const interactive = parseX402Policy({
      ...base,
      rules: [{ ...base.rules[0], unattended: false }],
    });
    expect(() =>
      authorizeX402Requirement({
        policy: interactive,
        url: new URL('https://api.example.com/v1/generate'),
        method: 'POST',
        requirement: {
          scheme: 'upto',
          network: 'eip155:8453',
          amount: '90',
          asset: ASSET,
          payTo: PAY_TO,
          maxTimeoutSeconds: 60,
        },
        nonInteractive: true,
      })
    ).toThrow('does not allow unattended');
  });

  it('rejects ambiguous equal-priority rules', () => {
    const base = policy();
    const ambiguous = parseX402Policy({
      ...base,
      rules: [base.rules[0], { ...base.rules[0], id: 'example-two' }],
    });
    expect(() =>
      authorizeX402Requirement({
        policy: ambiguous,
        url: new URL('https://api.example.com/v1/generate'),
        method: 'GET',
        requirement: {
          scheme: 'upto',
          network: 'eip155:8453',
          amount: '10',
          asset: ASSET,
          payTo: PAY_TO,
          maxTimeoutSeconds: 60,
        },
        nonInteractive: false,
      })
    ).toThrow('Ambiguous');
  });

  it('writes policy with owner-only permissions', async () => {
    await saveX402Policy(policy(), policyPath);
    expect((await fs.stat(policyPath)).mode & 0o777).toBe(0o600);
    expect((await loadX402Policy(policyPath)).rules).toHaveLength(1);
  });

  it('rejects a policy file accessible by group or others', async () => {
    await saveX402Policy(policy(), policyPath);
    await fs.chmod(policyPath, 0o644);
    await expect(loadX402Policy(policyPath)).rejects.toThrow('only by its owner');
  });

  it('initializes deny-all policy and refuses to overwrite it', async () => {
    await expect(initializeX402Policy(policyPath)).resolves.toEqual({
      version: 1,
      networks: {},
      rules: [],
    });
    await expect(initializeX402Policy(policyPath)).rejects.toThrow('already exists');
  });

  it('adds, disables, enables and removes a rule atomically', async () => {
    await saveX402Policy({ version: 1, networks: policy().networks, rules: [] }, policyPath);
    await addX402PolicyRule(policy().rules[0], policyPath);
    expect((await loadX402Policy(policyPath)).rules[0].enabled).toBe(true);
    await setX402PolicyRuleEnabled('example', false, policyPath);
    expect((await loadX402Policy(policyPath)).rules[0].enabled).toBe(false);
    await setX402PolicyRuleEnabled('example', true, policyPath);
    await removeX402PolicyRule('example', policyPath);
    expect((await loadX402Policy(policyPath)).rules).toEqual([]);
  });

  it('keeps the published policy schema identical to the CLI schema', async () => {
    const published = JSON.parse(
      await fs.readFile(
        path.resolve(process.cwd(), '../docs/src/public/reference/x402-policy.schema.json'),
        'utf8'
      )
    ) as unknown;
    expect(published).toEqual(X402_POLICY_JSON_SCHEMA);
  });
});
