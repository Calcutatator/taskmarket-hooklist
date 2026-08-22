// @vitest-environment node

import { describe, expect, it } from 'vitest';

// The canonical validator is an ESM JavaScript tool owned by the contracts package.
// @ts-expect-error It intentionally has no TypeScript declaration surface.
import { validate } from '../../../packages/contracts/tools/hook-manifest/validate.mjs';

import {
  buildHookManifest,
  initialHookBuilderInput,
  manifestReadiness,
  type HookBuilderInput,
} from './hooklist';

const readyInput = {
  ...initialHookBuilderInput,
  author: 'Taskmarket contributor',
  authorUrl: 'https://github.com/taskmarket',
  commit: 'abcdef0',
  conformanceStatus: 'tested',
  conformanceEvidenceUrl: 'https://github.com/taskmarket/hooks/actions/runs/1',
  deploymentBlockNumber: '123',
  deploymentChainId: '8453',
  deploymentNetwork: 'base',
  deploymentTransactionHash: `0x${'1'.repeat(64)}`,
  description: 'Rejects incomplete configuration.',
  gasMethodology: 'Foundry gas snapshot on a Base fork.',
  hookAddress: '0x1111111111111111111111111111111111111111',
  livenessFailureMode: 'A rejecting callback blocks task creation.',
  livenessRequirements: '[]',
  listingStatus: 'unlisted',
  maximumGas: '120000',
  name: 'Approved configuration',
  protocolDefaultStatus: 'not-default',
  repository: 'https://github.com/taskmarket/hooks',
  runtimeCodehash: `0x${'2'.repeat(64)}`,
  securityAuditScope: 'Generated hook source and deployment metadata.',
  securityAuditStatus: 'unaudited',
  securityNotes: 'No audit is claimed.',
  sourcePath: 'src/ApprovedConfigurationHook.sol',
  sourceVerification: 'unverified',
  taskmarket: '0x2222222222222222222222222222222222222222',
  trustReviewed: true,
  typicalGas: '100000',
} satisfies HookBuilderInput;

const publishableDependencyCases = [
  {
    label: 'contract address',
    dependency: {
      name: 'configuration registry',
      kind: 'contract',
      deployments: [
        {
          chainId: 8453,
          addresses: ['0x3333333333333333333333333333333333333333'],
        },
      ],
      purpose: 'Reads approved configuration.',
    },
  },
  {
    label: 'token address',
    dependency: {
      name: 'reward token',
      kind: 'token',
      deployments: [
        {
          chainId: 8453,
          addresses: ['0x3333333333333333333333333333333333333333'],
        },
      ],
      purpose: 'Transfers rewards.',
    },
  },
  {
    label: 'oracle address',
    dependency: {
      name: 'price oracle',
      kind: 'oracle',
      deployments: [
        {
          chainId: 8453,
          addresses: ['0x3333333333333333333333333333333333333333'],
        },
      ],
      purpose: 'Reads a reference price.',
    },
  },
  {
    label: 'relayer address',
    dependency: {
      name: 'automation relayer',
      kind: 'relayer',
      deployments: [
        {
          chainId: 8453,
          addresses: ['0x3333333333333333333333333333333333333333'],
        },
      ],
      purpose: 'Submits lifecycle updates.',
    },
  },
  {
    label: 'API URL without addresses',
    dependency: {
      name: 'policy API',
      kind: 'api',
      deployments: [{ chainId: 8453, url: 'https://api.example.com/v1/policy' }],
      purpose: 'Reads policy metadata.',
    },
  },
  {
    label: 'other URL without addresses',
    dependency: {
      name: 'operator handbook',
      kind: 'other',
      deployments: [{ chainId: 8453, url: 'https://docs.example.com/operator' }],
      purpose: 'Documents manual recovery.',
    },
  },
  {
    label: 'other address',
    dependency: {
      name: 'custom registry',
      kind: 'other',
      deployments: [
        {
          chainId: 8453,
          addresses: ['0x4444444444444444444444444444444444444444'],
        },
      ],
      purpose: 'Provides custom policy.',
    },
  },
] as const;

const rejectedDependencyCases = [
  {
    label: 'legacy top-level address locator',
    dependency: {
      name: 'configuration registry',
      kind: 'contract',
      addresses: ['0x3333333333333333333333333333333333333333'],
      purpose: 'Reads approved configuration.',
    },
    errorPath: '$.externalDependencies[0].deployments',
  },
  {
    label: 'binding on an undeclared chain',
    dependency: {
      name: 'configuration registry',
      kind: 'contract',
      deployments: [
        {
          chainId: 84532,
          addresses: ['0x3333333333333333333333333333333333333333'],
        },
      ],
      purpose: 'Reads approved configuration.',
    },
    errorPath: '$.externalDependencies[0].deployments[0].chainId',
  },
  {
    label: 'duplicate chain bindings',
    dependency: {
      name: 'configuration registry',
      kind: 'contract',
      deployments: [
        {
          chainId: 8453,
          addresses: ['0x3333333333333333333333333333333333333333'],
        },
        {
          chainId: 8453,
          addresses: ['0x4444444444444444444444444444444444444444'],
        },
      ],
      purpose: 'Reads approved configuration.',
    },
    errorPath: '$.externalDependencies[0].deployments[1].chainId',
  },
  {
    label: 'normalized duplicate addresses',
    dependency: {
      name: 'configuration registry',
      kind: 'contract',
      deployments: [
        {
          chainId: 8453,
          addresses: [`0x${'a'.repeat(40)}`, `0x${'A'.repeat(40)}`],
        },
      ],
      purpose: 'Reads approved configuration.',
    },
    errorPath: '$.externalDependencies[0].deployments[0].addresses[1]',
  },
  {
    label: 'contract without addresses',
    dependency: {
      name: 'configuration registry',
      kind: 'contract',
      deployments: [{ chainId: 8453 }],
      purpose: 'Reads approved configuration.',
    },
    errorPath: '$.externalDependencies[0].deployments[0].addresses',
  },
  {
    label: 'relayer with empty addresses',
    dependency: {
      name: 'automation relayer',
      kind: 'relayer',
      deployments: [{ chainId: 8453, addresses: [] }],
      purpose: 'Submits lifecycle updates.',
    },
    errorPath: '$.externalDependencies[0].deployments[0].addresses',
  },
  {
    label: 'oracle with a zero address',
    dependency: {
      name: 'price oracle',
      kind: 'oracle',
      deployments: [{ chainId: 8453, addresses: [`0x${'0'.repeat(40)}`] }],
      purpose: 'Reads a reference price.',
    },
    errorPath: '$.externalDependencies[0].deployments[0].addresses[0]',
  },
  {
    label: 'API without a URL',
    dependency: {
      name: 'policy API',
      kind: 'api',
      deployments: [
        {
          chainId: 8453,
          addresses: ['0x3333333333333333333333333333333333333333'],
        },
      ],
      purpose: 'Reads policy metadata.',
    },
    errorPath: '$.externalDependencies[0].deployments[0].url',
  },
  {
    label: 'API URL with forbidden addresses',
    dependency: {
      name: 'policy API',
      kind: 'api',
      deployments: [
        {
          chainId: 8453,
          addresses: ['0x3333333333333333333333333333333333333333'],
          url: 'https://api.example.com/v1/policy',
        },
      ],
      purpose: 'Reads policy metadata.',
    },
    errorPath: '$.externalDependencies[0].deployments[0].addresses',
  },
  {
    label: 'other dependency without a locator',
    dependency: {
      name: 'custom policy',
      kind: 'other',
      deployments: [{ chainId: 8453 }],
      purpose: 'Provides custom policy.',
    },
    errorPath: '$.externalDependencies[0].deployments[0]',
  },
  {
    label: 'other URL with empty addresses',
    dependency: {
      name: 'custom policy',
      kind: 'other',
      deployments: [{ chainId: 8453, addresses: [], url: 'https://dependency.example.com' }],
      purpose: 'Provides custom policy.',
    },
    errorPath: '$.externalDependencies[0].deployments[0].addresses',
  },
] as const;

function withDependency(dependency: object): HookBuilderInput {
  return { ...readyInput, externalDependencies: JSON.stringify([dependency]) };
}

describe('Hooklist canonical manifest integration', () => {
  it('accepts a ready builder fixture with the canonical contracts validator', () => {
    const manifest = buildHookManifest(readyInput);

    expect(manifestReadiness(readyInput).ready).toBe(true);
    expect(manifest).not.toHaveProperty('x-draft');
    expect(manifest).not.toHaveProperty('gas');
    expect(manifest.deployments[0].gas.estimates).toEqual({
      checkFund: {
        maximum: 120000,
        methodology: readyInput.gasMethodology,
        typical: 100000,
      },
    });
    expect(validate(manifest)).toEqual([]);
  });

  it('publishes Base Sepolia chain, verifier, proxy, and gas evidence consistently', () => {
    const input = {
      ...readyInput,
      deploymentChainId: '84532',
      deploymentNetwork: 'base-sepolia',
      sourceVerification: 'verified',
      sourceVerificationVerifiers: JSON.stringify([
        {
          chainId: 84532,
          status: 'verified',
          url: 'https://sepolia.basescan.org/address/0x1111111111111111111111111111111111111111',
        },
      ]),
    } satisfies HookBuilderInput;
    const manifest = buildHookManifest(input);

    expect(manifestReadiness(input)).toMatchObject({ missing: [], ready: true });
    expect(manifest).not.toHaveProperty('x-draft');
    expect(manifest).not.toHaveProperty('proxy');
    expect(manifest.deployments[0]).toMatchObject({
      chainId: 84532,
      network: 'base-sepolia',
      proxy: { kind: 'none', upgradeable: false },
    });
    expect(manifest).not.toHaveProperty('gas');
    expect(manifest.deployments[0].gas.estimates.checkFund).toMatchObject({
      maximum: 120000,
      typical: 100000,
    });
    expect(validate(manifest)).toEqual([]);
  });

  it('rejects verifier evidence from outside the selected deployment chain', () => {
    const input = {
      ...readyInput,
      deploymentChainId: '84532',
      deploymentNetwork: 'base-sepolia',
      sourceVerification: 'verified',
      sourceVerificationVerifiers: JSON.stringify([
        {
          chainId: 8453,
          status: 'verified',
          url: 'https://basescan.org/address/0x1111111111111111111111111111111111111111',
        },
      ]),
    } satisfies HookBuilderInput;
    const draft = buildHookManifest(input);

    expect(manifestReadiness(input)).toMatchObject({
      missing: expect.arrayContaining(['source verification declaration and verifier evidence']),
      ready: false,
    });
    expect(draft).toHaveProperty('x-draft');
    expect(validate(draft)).toEqual(
      expect.arrayContaining([expect.stringContaining('must reference a declared deployment')])
    );
  });

  it.each(['https:example.com', 'https:/example.com', 'https:///example.com'])(
    'rejects WHATWG-normalized non-canonical HTTPS input %j in builder and validator',
    (url) => {
      const input = { ...readyInput, authorUrl: url };
      const draft = buildHookManifest(input);
      const publishedCandidate = buildHookManifest(readyInput);
      publishedCandidate.author.url = url;

      expect(manifestReadiness(input)).toMatchObject({
        missing: expect.arrayContaining(['author HTTPS URL']),
        ready: false,
      });
      expect(draft).toHaveProperty('x-draft');
      expect(validate(publishedCandidate)).toEqual(
        expect.arrayContaining([expect.stringContaining('$.author.url')])
      );
    }
  );

  it.each([
    ['https://Verifier.Example.com:443/contracts/../source', 'https://verifier.example.com/source'],
    ['https://verifier.example.com', 'https://verifier.example.com/'],
  ])(
    'rejects normalized verifier aliases in both builder and canonical validation',
    (first, second) => {
      const input = {
        ...readyInput,
        sourceVerification: 'partially-verified',
        sourceVerificationVerifiers: JSON.stringify([
          { chainId: 8453, status: 'verified', url: first },
          { chainId: 8453, status: 'pending', url: second },
        ]),
      };
      const draft = buildHookManifest(input);

      expect(manifestReadiness(input)).toMatchObject({
        missing: expect.arrayContaining(['source verification declaration and verifier evidence']),
        ready: false,
      });
      expect(draft).toHaveProperty('x-draft');
      expect(validate(draft)).toEqual(
        expect.arrayContaining([expect.stringContaining('duplicates chainId and normalized URL')])
      );
    }
  );

  it.each([
    [
      'https://verifier.example.com/source?view=source',
      'https://verifier.example.com/source?view=bytecode',
    ],
    ['https://verifier.example.com/source#L1', 'https://verifier.example.com/source#L2'],
  ])('publishes verifier URLs with distinct query or fragment evidence', (first, second) => {
    const input = {
      ...readyInput,
      sourceVerification: 'verified',
      sourceVerificationVerifiers: JSON.stringify([
        { chainId: 8453, status: 'verified', url: first },
        { chainId: 8453, status: 'verified', url: second },
      ]),
    };
    const manifest = buildHookManifest(input);

    expect(manifestReadiness(input).ready).toBe(true);
    expect(manifest).not.toHaveProperty('x-draft');
    expect(manifest).not.toHaveProperty('proxy');
    expect(validate(manifest)).toEqual([]);
  });

  it.each(publishableDependencyCases)(
    'emits a canonical publishable manifest for $label evidence',
    ({ dependency }) => {
      const input = withDependency(dependency);
      const manifest = buildHookManifest(input);

      expect(manifestReadiness(input).ready).toBe(true);
      expect(manifest).not.toHaveProperty('x-draft');
      expect(manifest.externalDependencies).toEqual([dependency]);
      if (!Object.hasOwn(dependency.deployments[0], 'addresses')) {
        expect(manifest.externalDependencies[0].deployments[0]).not.toHaveProperty('addresses');
      }
      expect(validate(manifest)).toEqual([]);
    }
  );

  it.each(rejectedDependencyCases)(
    'keeps $label evidence non-publishable in both builder and canonical validation',
    ({ dependency, errorPath }) => {
      const input = withDependency(dependency);
      const draft = buildHookManifest(input);
      const publishedCandidate = buildHookManifest(readyInput);
      publishedCandidate.externalDependencies = [dependency];

      expect(manifestReadiness(input)).toMatchObject({
        missing: expect.arrayContaining(['schema-valid external dependencies JSON array']),
        ready: false,
      });
      expect(draft).toHaveProperty('x-draft');
      expect(validate(publishedCandidate)).toEqual(
        expect.arrayContaining([expect.stringContaining(errorPath)])
      );
    }
  );

  it('keeps portable source, verifier evidence, and proxy authority canonical', () => {
    const admin = '0x4444444444444444444444444444444444444444';
    const input = {
      ...readyInput,
      privilegedRoles: JSON.stringify([
        {
          name: 'proxy administrator',
          holders: [{ chainId: 8453, address: admin }],
          capabilities: ['upgrade hook implementation'],
          renounceable: false,
        },
      ]),
      proxyAdmin: admin,
      proxyImplementation: '0x3333333333333333333333333333333333333333',
      sourcePath: '.github/hooks/Approved Configuration.sol',
      sourceVerification: 'verified',
      sourceVerificationVerifiers: JSON.stringify([
        {
          chainId: 8453,
          status: 'verified',
          url: 'https://basescan.org/address/0x1111111111111111111111111111111111111111',
        },
      ]),
      upgradeability: 'erc1967',
      upgradeAuthorityDescription: 'The declared proxy administrator controls upgrades.',
    } satisfies HookBuilderInput;
    const manifest = buildHookManifest(input);

    expect(manifestReadiness(input).ready).toBe(true);
    expect(manifest).not.toHaveProperty('x-draft');
    expect(manifest).not.toHaveProperty('proxy');
    expect(manifest.deployments[0].proxy).toMatchObject({
      admin,
      implementation: input.proxyImplementation,
      kind: 'erc1967',
      upgradeable: true,
    });
    expect(validate(manifest)).toEqual([]);
  });
});
