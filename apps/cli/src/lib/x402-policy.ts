// Implements: ADR-0092
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { z } from 'zod';

const AtomicAmountSchema = z
  .string()
  .regex(/^\d+$/, 'amount must be an unsigned integer string')
  .refine((value) => BigInt(value) > 0n, 'amount must be greater than zero');

const EvmAddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'invalid EVM address');
const EvmNetworkSchema = z
  .string()
  .regex(/^eip155:[1-9]\d*$/, 'network must be an EVM CAIP-2 identifier');
const EnvironmentVariableSchema = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'invalid environment variable name');

const OriginSchema = z.string().superRefine((value, ctx) => {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'origin must use HTTPS' });
    }
    if (parsed.origin !== value || parsed.username || parsed.password) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'origin must be an exact URL origin' });
    }
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'origin must be a valid URL' });
  }
});

export const X402SpendWindowSchema = z.object({
  seconds: z.number().int().positive().max(31_536_000),
  max: AtomicAmountSchema,
});

export const X402Permit2PolicySchema = z.object({
  allowSponsoredApproval: z.boolean().default(true),
  allowDirectApproval: z.boolean().default(false),
  allowUnattendedDirectApproval: z.boolean().default(false),
  maxApprovalGasWei: AtomicAmountSchema.optional(),
});

export const X402PaymentPolicySchema = z
  .object({
    scheme: z.enum(['exact', 'upto']),
    network: EvmNetworkSchema,
    asset: EvmAddressSchema,
    payTo: EvmAddressSchema.optional(),
    displaySymbol: z.string().min(1).max(32).optional(),
    displayDecimals: z.number().int().min(0).max(255).optional(),
    maxPerPayment: AtomicAmountSchema,
    spendWindow: X402SpendWindowSchema,
    permit2: X402Permit2PolicySchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (BigInt(value.maxPerPayment) > BigInt(value.spendWindow.max)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'maxPerPayment must not exceed spendWindow.max',
        path: ['maxPerPayment'],
      });
    }
    if (value.permit2?.allowUnattendedDirectApproval && !value.permit2.allowDirectApproval) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'unattended direct approval requires allowDirectApproval',
        path: ['permit2', 'allowUnattendedDirectApproval'],
      });
    }
  });

export const X402PolicyRuleSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/, 'invalid rule id'),
    enabled: z.boolean().default(true),
    priority: z.number().int().default(0),
    origin: OriginSchema,
    pathPrefix: z.string().startsWith('/').default('/'),
    methods: z.array(z.enum(['GET', 'POST'])).min(1),
    unattended: z.boolean().default(false),
    allowPrivateNetwork: z.boolean().default(false),
    maxAuthorizationSeconds: z.number().int().positive().max(3600).default(300),
    payments: z.array(X402PaymentPolicySchema).min(1),
  })
  .superRefine((value, ctx) => {
    if (!value.unattended) return;
    value.payments.forEach((payment, index) => {
      if (!payment.payTo) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'unattended payment entries must pin payTo',
          path: ['payments', index, 'payTo'],
        });
      }
    });
  });

export const X402PolicySchema = z
  .object({
    version: z.literal(1),
    networks: z.record(
      EvmNetworkSchema,
      z.object({
        rpcUrlEnv: EnvironmentVariableSchema,
      })
    ),
    rules: z.array(X402PolicyRuleSchema),
  })
  .superRefine((value, ctx) => {
    const ids = new Set<string>();
    for (let index = 0; index < value.rules.length; index += 1) {
      const rule = value.rules[index];
      if (ids.has(rule.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate rule id: ${rule.id}`,
          path: ['rules', index, 'id'],
        });
      }
      ids.add(rule.id);
      for (const payment of rule.payments) {
        if (!value.networks[payment.network]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `network ${payment.network} has no RPC configuration`,
            path: ['rules', index, 'payments'],
          });
        }
      }
    }
  });

export type X402Policy = z.infer<typeof X402PolicySchema>;
export type X402PolicyRule = z.infer<typeof X402PolicyRuleSchema>;
export type X402PaymentPolicy = z.infer<typeof X402PaymentPolicySchema>;

export interface X402PaymentRequirement {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
}

export interface X402PolicyAuthorization {
  rule: X402PolicyRule;
  payment: X402PaymentPolicy;
  requirement: X402PaymentRequirement;
  windowStartedAt: string;
}

export const EMPTY_X402_POLICY: X402Policy = {
  version: 1,
  networks: {},
  rules: [],
};

export function getX402PolicyPath(): string {
  return (
    process.env['TASKMARKET_X402_POLICY_PATH'] ??
    path.join(os.homedir(), '.taskmarket', 'x402-policy.json')
  );
}

function policyError(error: z.ZodError): Error {
  const details = error.issues
    .map((issue) => `${issue.path.join('.') || 'policy'}: ${issue.message}`)
    .join('; ');
  return new Error(`Invalid x402 policy: ${details}`);
}

export function parseX402Policy(input: unknown): X402Policy {
  const result = X402PolicySchema.safeParse(input);
  if (!result.success) throw policyError(result.error);
  return result.data;
}

export async function loadX402Policy(
  policyPath: string = getX402PolicyPath(),
  options: { allowMissing?: boolean } = {}
): Promise<X402Policy> {
  let raw: string;
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(policyPath, 'r');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && options.allowMissing) {
      return EMPTY_X402_POLICY;
    }
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`x402 policy not found at ${policyPath}. Run 'taskmarket x402 policy init'.`);
    }
    throw error;
  }

  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error(`x402 policy must be a regular file: ${policyPath}`);
    if ((stat.mode & 0o077) !== 0) {
      throw new Error(`x402 policy must be accessible only by its owner: ${policyPath}`);
    }
    raw = await handle.readFile('utf8');
  } finally {
    await handle.close();
  }

  try {
    return parseX402Policy(JSON.parse(raw));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in x402 policy ${policyPath}: ${error.message}`);
    }
    throw error;
  }
}

export async function saveX402Policy(
  policy: X402Policy,
  policyPath: string = getX402PolicyPath()
): Promise<void> {
  const parsed = parseX402Policy(policy);
  const directory = path.dirname(policyPath);
  const temporaryPath = path.join(directory, `.x402-policy-${randomUUID()}.tmp`);
  await fs.mkdir(directory, { recursive: true });
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(parsed, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    await fs.rename(temporaryPath, policyPath);
    await fs.chmod(policyPath, 0o600);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

export async function initializeX402Policy(
  policyPath: string = getX402PolicyPath()
): Promise<X402Policy> {
  try {
    await fs.access(policyPath);
    throw new Error(`x402 policy already exists at ${policyPath}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await saveX402Policy(EMPTY_X402_POLICY, policyPath);
  return EMPTY_X402_POLICY;
}

export async function addX402PolicyRule(
  ruleInput: unknown,
  policyPath: string = getX402PolicyPath()
): Promise<X402Policy> {
  const rule = X402PolicyRuleSchema.parse(ruleInput);
  const policy = await loadX402Policy(policyPath, { allowMissing: true });
  if (policy.rules.some((candidate) => candidate.id === rule.id)) {
    throw new Error(`x402 policy rule '${rule.id}' already exists`);
  }
  const next = parseX402Policy({ ...policy, rules: [...policy.rules, rule] });
  await saveX402Policy(next, policyPath);
  return next;
}

export async function removeX402PolicyRule(
  id: string,
  policyPath: string = getX402PolicyPath()
): Promise<X402Policy> {
  const policy = await loadX402Policy(policyPath);
  if (!policy.rules.some((candidate) => candidate.id === id)) {
    throw new Error(`x402 policy rule '${id}' was not found`);
  }
  const next = { ...policy, rules: policy.rules.filter((candidate) => candidate.id !== id) };
  await saveX402Policy(next, policyPath);
  return next;
}

export async function setX402PolicyRuleEnabled(
  id: string,
  enabled: boolean,
  policyPath: string = getX402PolicyPath()
): Promise<X402Policy> {
  const policy = await loadX402Policy(policyPath);
  let found = false;
  const rules = policy.rules.map((candidate) => {
    if (candidate.id !== id) return candidate;
    found = true;
    return { ...candidate, enabled };
  });
  if (!found) throw new Error(`x402 policy rule '${id}' was not found`);
  const next = parseX402Policy({ ...policy, rules });
  await saveX402Policy(next, policyPath);
  return next;
}

function requirementMatchesPayment(
  requirement: X402PaymentRequirement,
  payment: X402PaymentPolicy
): boolean {
  return (
    requirement.scheme === payment.scheme &&
    requirement.network === payment.network &&
    requirement.asset.toLowerCase() === payment.asset.toLowerCase() &&
    (!payment.payTo || requirement.payTo.toLowerCase() === payment.payTo.toLowerCase()) &&
    /^\d+$/.test(requirement.amount) &&
    BigInt(requirement.amount) <= BigInt(payment.maxPerPayment)
  );
}

export function authorizeX402Requirement(input: {
  policy: X402Policy;
  url: URL;
  method: 'GET' | 'POST';
  requirement: X402PaymentRequirement;
  nonInteractive: boolean;
  requestedRuleId?: string;
  now?: Date;
}): X402PolicyAuthorization {
  const { policy, url, method, requirement, nonInteractive, requestedRuleId } = input;
  if (!/^\d+$/.test(requirement.amount) || BigInt(requirement.amount) <= 0n) {
    throw new Error('x402 requirement amount must be a positive integer string');
  }
  if (!/^eip155:[1-9]\d*$/.test(requirement.network)) {
    throw new Error(`x402 network '${requirement.network}' is not an EVM CAIP-2 network`);
  }
  if (!['exact', 'upto'].includes(requirement.scheme)) {
    throw new Error(`x402 scheme '${requirement.scheme}' is not supported`);
  }

  const matches = policy.rules.filter(
    (rule) =>
      rule.enabled &&
      (!requestedRuleId || rule.id === requestedRuleId) &&
      rule.origin === url.origin &&
      url.pathname.startsWith(rule.pathPrefix) &&
      rule.methods.includes(method)
  );
  if (matches.length === 0) {
    throw new Error(`No x402 policy rule authorizes ${method} ${url.origin}${url.pathname}`);
  }
  const highestPriority = Math.max(...matches.map((rule) => rule.priority));
  const winners = matches.filter((rule) => rule.priority === highestPriority);
  if (winners.length !== 1) {
    throw new Error(
      `Ambiguous x402 policy: ${winners.length} matching rules have priority ${highestPriority}`
    );
  }
  const rule = winners[0];
  if (nonInteractive && !rule.unattended) {
    throw new Error(`x402 policy rule '${rule.id}' does not allow unattended payments`);
  }
  if (requirement.maxTimeoutSeconds > rule.maxAuthorizationSeconds) {
    throw new Error(
      `x402 authorization lifetime ${requirement.maxTimeoutSeconds}s exceeds policy limit ${rule.maxAuthorizationSeconds}s`
    );
  }
  const payment = rule.payments.find((candidate) =>
    requirementMatchesPayment(requirement, candidate)
  );
  if (!payment) {
    throw new Error(
      `x402 policy rule '${rule.id}' does not allow ${requirement.scheme} ${requirement.network} ${requirement.asset} for ${requirement.amount}`
    );
  }
  const now = input.now ?? new Date();
  return {
    rule,
    payment,
    requirement,
    windowStartedAt: new Date(now.getTime() - payment.spendWindow.seconds * 1000).toISOString(),
  };
}

export function rpcUrlForNetwork(policy: X402Policy, network: string): string {
  const configuration = policy.networks[network];
  if (!configuration) throw new Error(`No RPC configuration exists for ${network}`);
  const value = process.env[configuration.rpcUrlEnv]?.trim();
  if (!value) {
    throw new Error(
      `RPC environment variable ${configuration.rpcUrlEnv} is required for ${network}`
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`RPC environment variable ${configuration.rpcUrlEnv} is not a valid URL`);
  }
  if (!['https:', 'http:'].includes(parsed.protocol)) {
    throw new Error(`RPC environment variable ${configuration.rpcUrlEnv} must use HTTP or HTTPS`);
  }
  return value;
}

export const X402_POLICY_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://docs.taskmarket.dev/reference/x402-policy.schema.json',
  title: 'Taskmarket external x402 payment policy',
  type: 'object',
  additionalProperties: false,
  required: ['version', 'networks', 'rules'],
  properties: {
    version: { const: 1 },
    networks: {
      type: 'object',
      propertyNames: { pattern: '^eip155:[1-9][0-9]*$' },
      additionalProperties: {
        type: 'object',
        additionalProperties: false,
        required: ['rpcUrlEnv'],
        properties: { rpcUrlEnv: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]*$' } },
      },
    },
    rules: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'origin', 'methods', 'payments'],
        properties: {
          id: { type: 'string', pattern: '^[a-z0-9][a-z0-9._-]{0,63}$' },
          enabled: { type: 'boolean', default: true },
          priority: { type: 'integer', default: 0 },
          origin: { type: 'string', pattern: '^https://' },
          pathPrefix: { type: 'string', pattern: '^/', default: '/' },
          methods: { type: 'array', minItems: 1, items: { enum: ['GET', 'POST'] } },
          unattended: { type: 'boolean', default: false },
          allowPrivateNetwork: { type: 'boolean', default: false },
          maxAuthorizationSeconds: {
            type: 'integer',
            minimum: 1,
            maximum: 3600,
            default: 300,
          },
          payments: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['scheme', 'network', 'asset', 'maxPerPayment', 'spendWindow'],
              properties: {
                scheme: { enum: ['exact', 'upto'] },
                network: { type: 'string', pattern: '^eip155:[1-9][0-9]*$' },
                asset: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$' },
                payTo: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$' },
                displaySymbol: { type: 'string', minLength: 1, maxLength: 32 },
                displayDecimals: { type: 'integer', minimum: 0, maximum: 255 },
                maxPerPayment: { type: 'string', pattern: '^[0-9]+$' },
                spendWindow: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['seconds', 'max'],
                  properties: {
                    seconds: { type: 'integer', minimum: 1, maximum: 31_536_000 },
                    max: { type: 'string', pattern: '^[0-9]+$' },
                  },
                },
                permit2: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    allowSponsoredApproval: { type: 'boolean', default: true },
                    allowDirectApproval: { type: 'boolean', default: false },
                    allowUnattendedDirectApproval: { type: 'boolean', default: false },
                    maxApprovalGasWei: { type: 'string', pattern: '^[0-9]+$' },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;
