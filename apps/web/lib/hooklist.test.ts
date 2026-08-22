import { describe, expect, it } from 'vitest';

import {
  buildHookManifest,
  buildHookSolidity,
  hookCallbacks,
  initialHookBuilderInput,
  manifestReadiness,
  type HookBuilderInput,
} from './hooklist';

const evidence = {
  ...initialHookBuilderInput,
  author: 'Taskmarket contributor',
  authorUrl: 'https://github.com/taskmarket',
  callbacks: ['checkFund'],
  commit: 'abcdef0',
  conformanceStatus: 'tested',
  conformanceEvidenceUrl: 'https://github.com/taskmarket/hooks/actions/runs/1',
  deploymentBlockNumber: '123',
  deploymentChainId: '8453',
  deploymentNetwork: 'base',
  deploymentTransactionHash: `0x${'1'.repeat(64)}`,
  description: 'Rejects tasks that do not include an approved configuration.',
  gasMethodology: 'Foundry gas snapshot on a Base fork.',
  hookAddress: '0x1111111111111111111111111111111111111111',
  livenessFailureMode: 'A rejecting checkFund callback blocks task creation.',
  livenessRequirements: '[]',
  listingStatus: 'unlisted',
  maximumGas: '120000',
  name: 'Approved configuration',
  protocolDefaultStatus: 'not-default',
  repository: 'https://github.com/taskmarket/hooks',
  runtimeCodehash: `0x${'2'.repeat(64)}`,
  securityAuditScope: 'Generated hook source and deployment metadata.',
  securityAuditStatus: 'unaudited',
  securityNotes: 'No audit is claimed; source and deployment were reviewed.',
  sourcePath: 'src/ApprovedConfigurationHook.sol',
  sourceVerification: 'unverified',
  taskmarket: '0x2222222222222222222222222222222222222222',
  trustReviewed: true,
  typicalGas: '100000',
} satisfies HookBuilderInput;

describe('Hooklist manifest builder', () => {
  it('keeps an incomplete manifest visibly draft instead of publishing placeholders', () => {
    const manifest = buildHookManifest(initialHookBuilderInput);

    expect(manifestReadiness(initialHookBuilderInput)).toMatchObject({
      missing: expect.arrayContaining(['deployment chain ID', 'deployment network']),
      ready: false,
    });
    expect(manifest['x-draft']).toMatchObject({
      missing: expect.arrayContaining(['project name']),
    });
    expect(manifest.deployments[0]).toMatchObject({
      chainId: 1,
      gas: {
        estimates: {
          checkFund: {
            maximum: 0,
            methodology: 'DRAFT: gas has not been measured.',
            typical: 0,
          },
        },
      },
      network: 'draft',
      proxy: { kind: 'none', upgradeable: false },
    });
    expect(manifest.deployments[0].deployment.transactionHash).toBe(`0x${'0'.repeat(64)}`);
    expect(manifest).not.toHaveProperty('gas');
    expect(manifest).not.toHaveProperty('proxy');
  });

  it('keeps Base Sepolia deployment, verifier, proxy, and gas evidence on one chain', () => {
    const input = {
      ...evidence,
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
    };

    expect(manifestReadiness(input)).toMatchObject({ missing: [], ready: true });
    const manifest = buildHookManifest(input);
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
    expect(manifest.sourceVerification.verifiers).toEqual([
      expect.objectContaining({ chainId: 84532 }),
    ]);
    expect(manifest).not.toHaveProperty('proxy');
  });

  it('scopes ERC-1967 implementation and authority to the selected deployment', () => {
    const admin = '0x4444444444444444444444444444444444444444';
    const input = {
      ...evidence,
      privilegedRoles: JSON.stringify([
        {
          name: 'proxy administrator',
          holders: [{ chainId: 8453, address: admin }],
          capabilities: ['upgrade hook implementation'],
        },
      ]),
      proxyAdmin: admin,
      proxyImplementation: '0x3333333333333333333333333333333333333333',
      upgradeability: 'erc1967' as const,
      upgradeAuthorityDescription: 'The declared proxy administrator controls upgrades.',
    };

    expect(manifestReadiness(input)).toMatchObject({ missing: [], ready: true });
    const manifest = buildHookManifest(input);
    expect(manifest).not.toHaveProperty('proxy');
    expect(manifest.deployments[0].proxy).toEqual({
      admin,
      implementation: input.proxyImplementation,
      kind: 'erc1967',
      upgradeable: true,
      upgradeAuthorityDescription: input.upgradeAuthorityDescription,
    });
  });

  it.each([
    {
      label: 'legacy string holder',
      holders: ['0x4444444444444444444444444444444444444444'],
    },
    {
      label: 'holder on another chain',
      holders: [{ chainId: 84532, address: '0x4444444444444444444444444444444444444444' }],
    },
    {
      label: 'normalized duplicate holders',
      holders: [
        { chainId: 8453, address: `0x${'a'.repeat(40)}` },
        { chainId: 8453, address: `0x${'A'.repeat(40)}` },
      ],
    },
  ])('rejects privileged-role evidence with a $label', ({ holders }) => {
    const input = {
      ...evidence,
      privilegedRoles: JSON.stringify([
        {
          name: 'administrator',
          holders,
          capabilities: ['upgrade hook implementation'],
        },
      ]),
    };

    expect(manifestReadiness(input)).toMatchObject({
      missing: expect.arrayContaining(['schema-valid privileged roles JSON array']),
      ready: false,
    });
  });

  it('requires exact-unique privileged-role names and capabilities', () => {
    const holder = {
      chainId: 8453,
      address: '0x4444444444444444444444444444444444444444',
    };
    const duplicateNames = {
      ...evidence,
      privilegedRoles: JSON.stringify([
        { name: 'admin', holders: [holder], capabilities: ['upgrade'] },
        { name: 'admin', holders: [holder], capabilities: ['pause'] },
      ]),
    };
    const duplicateCapabilities = {
      ...evidence,
      privilegedRoles: JSON.stringify([
        { name: 'admin', holders: [holder], capabilities: ['upgrade', 'upgrade'] },
      ]),
    };

    for (const input of [duplicateNames, duplicateCapabilities]) {
      expect(manifestReadiness(input)).toMatchObject({
        missing: expect.arrayContaining(['schema-valid privileged roles JSON array']),
        ready: false,
      });
    }
  });

  it('keeps verifier evidence for a different chain non-publishable', () => {
    const input = {
      ...evidence,
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
    };

    expect(manifestReadiness(input)).toMatchObject({
      missing: expect.arrayContaining(['source verification declaration and verifier evidence']),
      ready: false,
    });
    expect(buildHookManifest(input)).toHaveProperty('x-draft');
  });

  it.each([
    ['empty', ''],
    ['zero', '0'],
    ['negative', '-1'],
    ['unsafe', '9007199254740992'],
    ['exponent notation', '8.4532e4'],
    ['leading zero', '084532'],
  ])('rejects deployment chain IDs that are %s', (_label, deploymentChainId) => {
    const input = { ...evidence, deploymentChainId };

    expect(manifestReadiness(input)).toMatchObject({
      missing: expect.arrayContaining(['deployment chain ID']),
      ready: false,
    });
    expect(buildHookManifest(input).deployments[0].chainId).toBe(1);
  });

  it('requires nonzero evidence, valid ABI parameters and JSON, and bounded gas', () => {
    const incomplete = {
      ...evidence,
      commit: '0000000',
      deploymentTransactionHash: `0x${'0'.repeat(64)}`,
      hookDataAbiType: 'uint256',
      hookDataDecoded: '{',
      hookDataEncoded: '0x01',
      hookDataEncoding: 'abi' as const,
      maximumGas: '99999',
    };

    expect(manifestReadiness(incomplete).missing).toEqual(
      expect.arrayContaining([
        'nonzero source commit SHA',
        'deployment transaction hash',
        'valid decoded hookData JSON',
        'nonzero maximum gas at least typical gas',
      ])
    );
    expect(buildHookManifest(incomplete).deployments[0].gas.estimates.checkFund).toMatchObject({
      maximum: 100000,
      typical: 100000,
    });
  });

  it.each(['9007199254740992', '9007199254740993'])(
    'rejects unsafe integer %s instead of lossily serializing deployment and gas evidence',
    (unsafeInteger) => {
      const input = {
        ...evidence,
        deploymentBlockNumber: unsafeInteger,
        maximumGas: unsafeInteger,
        typicalGas: unsafeInteger,
      };

      expect(manifestReadiness(input)).toMatchObject({
        missing: expect.arrayContaining([
          'deployment block number',
          'nonzero typical gas estimate',
          'nonzero maximum gas at least typical gas',
        ]),
        ready: false,
      });

      const manifest = buildHookManifest(input);
      expect(manifest.deployments[0].deployment.blockNumber).toBe(0);
      expect(manifest.deployments[0].gas.estimates.checkFund).toMatchObject({
        maximum: 0,
        typical: 0,
      });
      expect(JSON.stringify(manifest)).not.toContain('9007199254740992');
    }
  );

  it.each([
    ['exponent notation', '1e3'],
    ['decimal notation', '1.0'],
    ['surrounding whitespace', ' 123 '],
    ['a leading zero', '0123'],
    ['an explicit plus sign', '+123'],
    ['a hexadecimal prefix', '0x10'],
  ])('rejects %s in canonical positive integer fields', (_label, value) => {
    const input = {
      ...evidence,
      deploymentBlockNumber: value,
      maximumGas: value,
      typicalGas: value,
    };
    expect(manifestReadiness(input)).toMatchObject({
      missing: expect.arrayContaining([
        'deployment block number',
        'nonzero typical gas estimate',
        'nonzero maximum gas at least typical gas',
      ]),
      ready: false,
    });
    const manifest = buildHookManifest(input);
    expect(manifest.deployments[0].deployment.blockNumber).toBe(0);
    expect(manifest.deployments[0].gas.estimates.checkFund).toMatchObject({
      maximum: 0,
      typical: 0,
    });
  });

  it('accepts and exactly serializes the maximum safe integer boundary', () => {
    const maximumSafeInteger = String(Number.MAX_SAFE_INTEGER);
    const input = {
      ...evidence,
      deploymentBlockNumber: maximumSafeInteger,
      maximumGas: maximumSafeInteger,
      typicalGas: maximumSafeInteger,
    };

    expect(manifestReadiness(input)).toMatchObject({ missing: [], ready: true });
    const manifest = buildHookManifest(input);
    expect(manifest.deployments[0].deployment.blockNumber).toBe(Number.MAX_SAFE_INTEGER);
    expect(manifest.deployments[0].gas.estimates.checkFund).toMatchObject({
      maximum: Number.MAX_SAFE_INTEGER,
      typical: Number.MAX_SAFE_INTEGER,
    });
  });

  it('accepts a canonical ABI example and emits deterministic bigint-string JSON', () => {
    const abiEvidence = {
      ...evidence,
      hookDataAbiType: '(address recipient, uint256 limit) config',
      hookDataDecoded: '{"recipient":"0x1111111111111111111111111111111111111111","limit":"42"}',
      hookDataEncoded:
        '0x0000000000000000000000001111111111111111111111111111111111111111' +
        '000000000000000000000000000000000000000000000000000000000000002a',
      hookDataEncoding: 'abi' as const,
    };

    expect(manifestReadiness(abiEvidence)).toMatchObject({ missing: [], ready: true });
    expect(buildHookManifest(abiEvidence).hookData.examples[0]).toEqual({
      decoded: {
        limit: '42',
        recipient: '0x1111111111111111111111111111111111111111',
      },
      encoded: abiEvidence.hookDataEncoded,
      name: 'example configuration',
    });
  });

  it('rejects invalid ABI syntax and decoded JSON unrelated to the supplied bytes', () => {
    const invalidType = {
      ...evidence,
      hookDataAbiType: 'tuple(address,uint256)',
      hookDataDecoded: '["0x1111111111111111111111111111111111111111","42"]',
      hookDataEncoded:
        '0x0000000000000000000000001111111111111111111111111111111111111111' +
        '000000000000000000000000000000000000000000000000000000000000002a',
      hookDataEncoding: 'abi' as const,
    };
    const unrelated = {
      ...invalidType,
      hookDataAbiType: '(address,uint256)',
      hookDataDecoded: '["0x1111111111111111111111111111111111111111","41"]',
    };

    expect(manifestReadiness(invalidType)).toMatchObject({
      missing: expect.arrayContaining(['valid hookData ABI parameter declaration']),
      ready: false,
    });
    expect(manifestReadiness(unrelated)).toMatchObject({
      missing: expect.arrayContaining(['canonical hookData bytes matching the decoded JSON']),
      ready: false,
    });
  });

  it('rejects ABI bytes with unrelated trailing data instead of treating them as canonical', () => {
    const incomplete = {
      ...evidence,
      hookDataAbiType: 'uint256',
      hookDataDecoded: '"42"',
      hookDataEncoded:
        '0x000000000000000000000000000000000000000000000000000000000000002a' +
        '0000000000000000000000000000000000000000000000000000000000000000',
      hookDataEncoding: 'abi' as const,
    };

    expect(manifestReadiness(incomplete)).toMatchObject({
      missing: expect.arrayContaining(['canonical hookData bytes matching the decoded JSON']),
      ready: false,
    });
  });

  it('rejects duplicate or unsupported callbacks and task modes supplied by helper callers', () => {
    const incomplete = {
      ...evidence,
      callbacks: ['checkFund', 'checkFund', 'notACallback'] as HookBuilderInput['callbacks'],
      modes: ['bounty', 'bounty', 'notAMode'] as HookBuilderInput['modes'],
    };

    expect(manifestReadiness(incomplete)).toMatchObject({
      missing: expect.arrayContaining([
        'unique callbacks',
        'supported callbacks',
        'unique task modes',
        'supported task modes',
      ]),
      ready: false,
    });
  });

  it('enforces schema length limits and rejects NUL in the source path', () => {
    const incomplete = {
      ...evidence,
      description: 'd'.repeat(2001),
      name: 'n'.repeat(121),
      sourcePath: 'src/Approved\0ConfigurationHook.sol',
    };

    expect(manifestReadiness(incomplete)).toMatchObject({
      missing: expect.arrayContaining([
        'project name at most 120 characters',
        'description at most 2000 characters',
        'source contract path',
      ]),
      ready: false,
    });
  });

  it.each([
    '/src/Hook.sol',
    'src/Hook.sol/',
    'src//Hook.sol',
    './src/Hook.sol',
    'src/./Hook.sol',
    '../Hook.sol',
    'src/../Hook.sol',
    'C:/repo/Hook.sol',
    'src\\Hook.sol',
    'src/\nHook.sol',
  ])('rejects non-portable canonical source path %j', (sourcePath) => {
    expect(manifestReadiness({ ...evidence, sourcePath })).toMatchObject({
      missing: expect.arrayContaining(['source contract path']),
      ready: false,
    });
  });

  it.each(['src/Hook.sol', '.github/hooks/Hook Example.sol', 'src/Hook..sol'])(
    'accepts portable canonical source path %j',
    (sourcePath) => {
      expect(manifestReadiness({ ...evidence, sourcePath }).ready).toBe(true);
    }
  );

  it('rejects malformed URI syntax that native URL parsing accepts', () => {
    const incomplete = {
      ...evidence,
      authorUrl: 'https://example.com/%',
      listingEvidenceUrl: 'https://example.com/[',
      repository: 'https://example.com/source path',
    };

    expect(manifestReadiness(incomplete)).toMatchObject({
      missing: expect.arrayContaining([
        'author HTTPS URL',
        'source repository HTTPS URL',
        'listing evidence HTTPS URL',
      ]),
      ready: false,
    });
  });

  it.each([
    {
      label: 'author URL',
      overrides: { authorUrl: 'https:example.com' },
      missing: 'author HTTPS URL',
    },
    {
      label: 'repository URL',
      overrides: { repository: 'https:example.com/source' },
      missing: 'source repository HTTPS URL',
    },
    {
      label: 'source verifier URL',
      overrides: {
        sourceVerification: 'verified',
        sourceVerificationVerifiers: JSON.stringify([
          { chainId: 8453, status: 'verified', url: 'https:example.com/verifier' },
        ]),
      },
      missing: 'source verification declaration and verifier evidence',
    },
    {
      label: 'listing evidence URL',
      overrides: { listingEvidenceUrl: 'https:example.com/listing' },
      missing: 'listing evidence HTTPS URL',
    },
    {
      label: 'conformance evidence URL',
      overrides: { conformanceEvidenceUrl: 'https:example.com/conformance' },
      missing: 'conformance evidence HTTPS URL',
    },
    {
      label: 'protocol-default evidence URL',
      overrides: { protocolDefaultEvidenceUrl: 'https:example.com/default' },
      missing: 'protocol-default evidence HTTPS URL',
    },
    {
      label: 'security report URL',
      overrides: { securityAuditReport: 'https:example.com/audit' },
      missing: 'security audit report HTTPS URL',
    },
    {
      label: 'external dependency URL',
      overrides: {
        externalDependencies: JSON.stringify([
          {
            name: 'policy API',
            kind: 'api',
            deployments: [{ chainId: 8453, url: 'https:example.com/policy' }],
            purpose: 'Reads policy metadata.',
          },
        ]),
      },
      missing: 'schema-valid external dependencies JSON array',
    },
  ])('applies literal canonical HTTPS validation to every $label', ({ missing, overrides }) => {
    expect(manifestReadiness({ ...evidence, ...overrides })).toMatchObject({
      missing: expect.arrayContaining([missing]),
      ready: false,
    });
  });

  it('rejects zero addresses and malformed trust declarations before they can become ready', () => {
    const incomplete = {
      ...evidence,
      externalDependencies: '[{"name":"oracle"}]',
      hookAddress: `0x${'0'.repeat(40)}`,
      privilegedRoles: '[{"name":"admin","holders":[],"capabilities":[]}]',
      taskmarket: `0x${'0'.repeat(40)}`,
    };

    expect(manifestReadiness(incomplete).missing).toEqual(
      expect.arrayContaining([
        'nonzero Taskmarket Diamond address',
        'nonzero deployed hook address',
        'schema-valid external dependencies JSON array',
        'schema-valid privileged roles JSON array',
      ])
    );
  });

  it.each([
    {
      label: 'contract with an address',
      dependency: {
        name: 'registry',
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
      label: 'API with a URL and omitted addresses',
      dependency: {
        name: 'policy API',
        kind: 'api',
        deployments: [{ chainId: 8453, url: 'https://api.example.com/v1/policy' }],
        purpose: 'Reads policy metadata.',
      },
    },
    {
      label: 'other dependency with a URL and omitted addresses',
      dependency: {
        name: 'operator handbook',
        kind: 'other',
        deployments: [{ chainId: 8453, url: 'https://docs.example.com/operator' }],
        purpose: 'Documents manual recovery.',
      },
    },
    {
      label: 'other dependency with an address',
      dependency: {
        name: 'custom registry',
        kind: 'other',
        deployments: [
          {
            chainId: 8453,
            addresses: ['0x4444444444444444444444444444444444444444'],
          },
        ],
        purpose: 'Provides a custom registry.',
      },
    },
  ])('accepts kind-aware external dependency evidence: $label', ({ dependency }) => {
    expect(
      manifestReadiness({
        ...evidence,
        externalDependencies: JSON.stringify([dependency]),
      }).ready
    ).toBe(true);
  });

  it('requires exact-unique dependency names', () => {
    const deployment = {
      chainId: 8453,
      addresses: ['0x3333333333333333333333333333333333333333'],
    };
    const externalDependencies = JSON.stringify([
      {
        name: 'registry',
        kind: 'contract',
        deployments: [deployment],
        purpose: 'Reads configuration.',
      },
      {
        name: 'registry',
        kind: 'oracle',
        deployments: [deployment],
        purpose: 'Reads policy state.',
      },
    ]);

    expect(manifestReadiness({ ...evidence, externalDependencies })).toMatchObject({
      missing: expect.arrayContaining(['schema-valid external dependencies JSON array']),
      ready: false,
    });
  });

  it.each([
    {
      label: 'legacy top-level locator',
      dependency: {
        name: 'registry',
        kind: 'contract',
        addresses: ['0x3333333333333333333333333333333333333333'],
        purpose: 'Reads configuration.',
      },
    },
    {
      label: 'binding on an undeclared chain',
      dependency: {
        name: 'registry',
        kind: 'contract',
        deployments: [
          {
            chainId: 84532,
            addresses: ['0x3333333333333333333333333333333333333333'],
          },
        ],
        purpose: 'Reads configuration.',
      },
    },
    {
      label: 'duplicate bindings for one chain',
      dependency: {
        name: 'registry',
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
        purpose: 'Reads configuration.',
      },
    },
    {
      label: 'normalized duplicate addresses',
      dependency: {
        name: 'registry',
        kind: 'contract',
        deployments: [
          {
            chainId: 8453,
            addresses: [`0x${'a'.repeat(40)}`, `0x${'A'.repeat(40)}`],
          },
        ],
        purpose: 'Reads configuration.',
      },
    },
    {
      label: 'contract without addresses',
      dependency: {
        name: 'registry',
        kind: 'contract',
        deployments: [{ chainId: 8453 }],
        purpose: 'Reads configuration.',
      },
    },
    {
      label: 'oracle with empty addresses',
      dependency: {
        name: 'oracle',
        kind: 'oracle',
        deployments: [{ chainId: 8453, addresses: [] }],
        purpose: 'Reads a price.',
      },
    },
    {
      label: 'token with a zero address',
      dependency: {
        name: 'token',
        kind: 'token',
        deployments: [{ chainId: 8453, addresses: [`0x${'0'.repeat(40)}`] }],
        purpose: 'Transfers rewards.',
      },
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
    },
    {
      label: 'API with a forbidden addresses property',
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
    },
    {
      label: 'other dependency without a locator',
      dependency: {
        name: 'custom system',
        kind: 'other',
        deployments: [{ chainId: 8453 }],
        purpose: 'Provides policy.',
      },
    },
    {
      label: 'other URL dependency with an empty addresses property',
      dependency: {
        name: 'custom system',
        kind: 'other',
        deployments: [{ chainId: 8453, addresses: [], url: 'https://dependency.example.com' }],
        purpose: 'Provides policy.',
      },
    },
  ])('rejects non-canonical external dependency evidence: $label', ({ dependency }) => {
    expect(
      manifestReadiness({
        ...evidence,
        externalDependencies: JSON.stringify([dependency]),
      })
    ).toMatchObject({
      missing: expect.arrayContaining(['schema-valid external dependencies JSON array']),
      ready: false,
    });
  });

  it.each([
    ['https://Verifier.Example.com:443/contracts/../source', 'https://verifier.example.com/source'],
    ['https://verifier.example.com', 'https://verifier.example.com/'],
  ])('rejects source verifier aliases with the same normalized effective URL', (first, second) => {
    expect(
      manifestReadiness({
        ...evidence,
        sourceVerification: 'partially-verified',
        sourceVerificationVerifiers: JSON.stringify([
          { chainId: 8453, status: 'verified', url: first },
          { chainId: 8453, status: 'pending', url: second },
        ]),
      })
    ).toMatchObject({
      missing: expect.arrayContaining(['source verification declaration and verifier evidence']),
      ready: false,
    });
  });

  it.each([
    [
      'https://verifier.example.com/source?view=source',
      'https://verifier.example.com/source?view=bytecode',
    ],
    ['https://verifier.example.com/source#L1', 'https://verifier.example.com/source#L2'],
  ])('keeps verifier URLs with different query or fragment evidence distinct', (first, second) => {
    expect(
      manifestReadiness({
        ...evidence,
        sourceVerification: 'verified',
        sourceVerificationVerifiers: JSON.stringify([
          { chainId: 8453, status: 'verified', url: first },
          { chainId: 8453, status: 'verified', url: second },
        ]),
      }).ready
    ).toBe(true);
  });

  it('requires HTTPS evidence for elevated listing, conformance, default, and audit claims', () => {
    const incomplete = {
      ...evidence,
      conformanceEvidenceUrl: '',
      conformanceStatus: 'independently-verified',
      listingEvidenceUrl: '',
      listingStatus: 'listed',
      protocolDefaultEvidenceUrl: '',
      protocolDefaultStatus: 'candidate',
      securityAuditReport: '',
      securityAuditStatus: 'audited',
    };

    expect(manifestReadiness(incomplete).missing).toEqual(
      expect.arrayContaining([
        'listing evidence HTTPS URL',
        'conformance evidence HTTPS URL',
        'protocol-default evidence HTTPS URL',
        'security audit report HTTPS URL',
      ])
    );
  });

  it('rejects an unsafe optional listing URL even when the hook is unlisted', () => {
    const incomplete = { ...evidence, listingEvidenceUrl: 'http://example.com/listing' };

    expect(manifestReadiness(incomplete)).toMatchObject({
      missing: expect.arrayContaining(['listing evidence HTTPS URL']),
      ready: false,
    });
  });

  it('rejects an unsafe optional conformance URL for a self-attested claim', () => {
    const incomplete = {
      ...evidence,
      conformanceEvidenceUrl: 'javascript:alert(1)',
      conformanceStatus: 'self-attested',
    };

    expect(manifestReadiness(incomplete)).toMatchObject({
      missing: expect.arrayContaining(['conformance evidence HTTPS URL']),
      ready: false,
    });
  });

  it('rejects an unsafe optional protocol-default URL when the hook is not default', () => {
    const incomplete = {
      ...evidence,
      protocolDefaultEvidenceUrl: 'ftp://example.com/default-evidence',
    };

    expect(manifestReadiness(incomplete)).toMatchObject({
      missing: expect.arrayContaining(['protocol-default evidence HTTPS URL']),
      ready: false,
    });
  });

  it('emits an exact fail-closed scaffold for selected check and after-hook callbacks', () => {
    const solidity = buildHookSolidity({
      ...evidence,
      callbacks: ['checkFund', 'onCancel'],
      name: 'Policy guard',
    });

    expect(solidity).toBe(`// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { BaseTMPHook } from "@taskmarket/contracts/src/hooks/base/BaseTMPHook.sol";
import { ITMPCore } from "@taskmarket/contracts/src/interfaces/ITMPCore.sol";

/// @notice Fail-closed Taskmarket hook scaffold; selected callbacks revert until implemented.
contract PolicyGuardHook is BaseTMPHook {
    error HookPolicyNotImplemented();

    constructor(address taskmarket_) BaseTMPHook(taskmarket_) { }

    // TODO: implement checkFund policy; this stub intentionally reverts.
    function _checkFund(bytes32, ITMPCore.TaskContext calldata, bytes calldata) internal override returns (bool) { revert HookPolicyNotImplemented(); }

    // TODO: implement onCancel policy; this stub intentionally reverts.
    function _onCancel(bytes32, ITMPCore.TaskContext calldata) internal override { revert HookPolicyNotImplemented(); }
}
`);
  });

  it('fails closed for every selectable lifecycle callback', () => {
    const callbacks = hookCallbacks.map(([callback]) => callback);
    const solidity = buildHookSolidity({ ...evidence, callbacks });

    expect(solidity.match(/revert HookPolicyNotImplemented\(\);/g)).toHaveLength(callbacks.length);
    expect(solidity).not.toContain('return true;');
    for (const callback of callbacks) {
      expect(solidity).toContain(
        `TODO: implement ${callback} policy; this stub intentionally reverts.`
      );
    }
  });

  it('emits a schema-shaped ready manifest and an internal BaseTMPHook scaffold', () => {
    const manifest = buildHookManifest(evidence);
    const solidity = buildHookSolidity(evidence);

    expect(manifestReadiness(evidence).ready).toBe(true);
    expect(manifest['x-draft']).toBeUndefined();
    expect(manifest.callbacks).toEqual(['checkFund']);
    expect(manifest.deployments[0]).toMatchObject({
      chainId: 8453,
      network: 'base',
      proxy: { kind: 'none', upgradeable: false },
    });
    expect(manifest.conformance).toMatchObject({
      evidence: evidence.conformanceEvidenceUrl,
      status: 'tested',
    });
    expect(manifest).not.toHaveProperty('gas');
    expect(manifest.deployments[0].gas.estimates.checkFund).toMatchObject({
      maximum: 120000,
      typical: 100000,
    });
    expect(solidity).toContain('@taskmarket/contracts/src/hooks/base/BaseTMPHook.sol');
    expect(solidity).toContain('error HookPolicyNotImplemented();');
    expect(solidity).toContain('function _checkFund');
    expect(solidity).toContain('revert HookPolicyNotImplemented();');
    expect(solidity).not.toContain('function supportsInterface');
  });
});
