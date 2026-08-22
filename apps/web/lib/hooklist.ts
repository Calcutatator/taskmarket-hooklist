import {
  decodeAbiParameters,
  encodeAbiParameters,
  parseAbiParameters,
  type AbiParameter,
  type Hex,
} from 'viem';

export const hookCallbacks = [
  ['checkFund', 'Validate funding and optional hook data.'],
  ['checkClaim', 'Gate a worker claim.'],
  ['checkSelectWorker', 'Gate a requester selection.'],
  ['checkSubmit', 'Validate a deliverable hash.'],
  ['checkEvaluate', 'Gate an evaluator action.'],
  ['checkComplete', 'Validate a completion verdict.'],
  ['onComplete', 'React after a successful completion.'],
  ['onForfeit', 'React after a worker forfeits.'],
  ['onCancel', 'React after a requester cancels.'],
  ['onExpire', 'React after expiry.'],
] as const;

export const hookModes = ['bounty', 'claim', 'pitch', 'benchmark', 'auction'] as const;
export type HookCallback = (typeof hookCallbacks)[number][0];
export type HookMode = (typeof hookModes)[number];

export type PublicHook = {
  address: string;
  activePhaseTaskCount: number;
  modes: HookMode[];
  taskCount: number;
  taskIds: string[];
};

export type HookBuilderInput = {
  name: string;
  description: string;
  author: string;
  authorUrl: string;
  repository: string;
  commit: string;
  sourcePath: string;
  callbacks: HookCallback[];
  modes: HookMode[];
  taskmarket: string;
  hookAddress: string;
  deploymentTransactionHash: string;
  deploymentBlockNumber: string;
  runtimeCodehash: string;
  upgradeability: 'immutable' | 'erc1967';
  proxyImplementation: string;
  proxyAdmin: string;
  upgradeAuthorityDescription: string;
  hookDataEncoding: 'none' | 'abi';
  hookDataAbiType: string;
  hookDataDecoded: string;
  hookDataEncoded: string;
  typicalGas: string;
  maximumGas: string;
  gasMethodology: string;
  sourceVerification: string;
  sourceVerificationVerifiers: string;
  listingStatus: string;
  listingEvidenceUrl: string;
  conformanceStatus: string;
  conformanceEvidenceUrl: string;
  protocolDefaultStatus: string;
  protocolDefaultEvidenceUrl: string;
  livenessRequirements: string;
  livenessFailureMode: string;
  livenessRecovery: string;
  securityAuditStatus: string;
  securityAuditScope: string;
  securityAuditReport: string;
  securityAuditDate: string;
  securityNotes: string;
  externalDependencies: string;
  privilegedRoles: string;
  trustReviewed: boolean;
};

export const initialHookBuilderInput: HookBuilderInput = {
  name: '',
  description: '',
  author: '',
  authorUrl: '',
  repository: '',
  commit: '',
  sourcePath: '',
  callbacks: ['checkFund'],
  modes: ['bounty'],
  taskmarket: '',
  hookAddress: '',
  deploymentTransactionHash: '',
  deploymentBlockNumber: '',
  runtimeCodehash: '',
  upgradeability: 'immutable',
  proxyImplementation: '',
  proxyAdmin: '',
  upgradeAuthorityDescription: '',
  hookDataEncoding: 'none',
  hookDataAbiType: '',
  hookDataDecoded: '',
  hookDataEncoded: '0x',
  typicalGas: '',
  maximumGas: '',
  gasMethodology: '',
  sourceVerification: '',
  sourceVerificationVerifiers: '[]',
  listingStatus: '',
  listingEvidenceUrl: '',
  conformanceStatus: '',
  conformanceEvidenceUrl: '',
  protocolDefaultStatus: '',
  protocolDefaultEvidenceUrl: '',
  livenessRequirements: '[]',
  livenessFailureMode: '',
  livenessRecovery: '',
  securityAuditStatus: '',
  securityAuditScope: '',
  securityAuditReport: '',
  securityAuditDate: '',
  securityNotes: '',
  externalDependencies: '[]',
  privilegedRoles: '[]',
  trustReviewed: false,
};

const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const nonZeroBytes32Pattern = /^0x(?!0{64}$)[0-9a-fA-F]{64}$/;
const hexBytesPattern = /^0x(?:[0-9a-fA-F]{2})*$/;
const commitPattern = /^[0-9a-fA-F]{7,64}$/;
const sourcePathPattern =
  /^(?![A-Za-z]:)(?!.*(?:^|\/)\.\.?(?:\/|$))(?!.*\/\/)(?!.*\\)[^/]+(?:\/[^/]+)*$/;

function normalizedEffectiveHttpsUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !url.hostname) return null;
    return url.href;
  } catch {
    return null;
  }
}

function isHttpsUrl(value: string) {
  if (
    !value.startsWith('https://') ||
    value.startsWith('https:///') ||
    /[^\x21-\x7e]/.test(value) ||
    /%(?![0-9a-fA-F]{2})/.test(value) ||
    /[<>"\\^`{|}]/.test(value) ||
    value.includes('[') ||
    value.includes(']')
  )
    return false;
  return normalizedEffectiveHttpsUrl(value) !== null;
}

function parseJson(value: string) {
  try {
    return { value: JSON.parse(value) as unknown };
  } catch {
    return null;
  }
}

function parseArray(value: string) {
  const parsed = parseJson(value);
  return parsed && Array.isArray(parsed.value) ? parsed.value : null;
}

function isPortableSourcePath(value: string) {
  return (
    sourcePathPattern.test(value) &&
    ![...value].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f;
    })
  );
}

/**
 * Canonical JSON for ABI examples uses viem's decoded shape: one ABI parameter is represented
 * directly, while multiple parameters use a positional array. ABI integers become base-10 strings,
 * arrays remain arrays, and named tuples become objects with lexicographically sorted keys.
 */
function normalizeAbiJson(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString(10);
  if (Array.isArray(value)) return value.map(normalizeAbiJson);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalizeAbiJson(item)])
    );
  }
  return value;
}

function parseHookDataAbiParameters(value: string): readonly AbiParameter[] | null {
  try {
    const parameters = parseAbiParameters(value);
    return parameters.length ? parameters : null;
  } catch {
    return null;
  }
}

function canonicalAbiExample(
  parameters: readonly AbiParameter[],
  decodedJson: unknown,
  encoded: string
) {
  try {
    const decodedValues = decodeAbiParameters(parameters, encoded as Hex);
    const canonicalEncoded = encodeAbiParameters(parameters, decodedValues);
    if (canonicalEncoded.toLowerCase() !== encoded.toLowerCase()) return null;

    const decoded = normalizeAbiJson(parameters.length === 1 ? decodedValues[0] : decodedValues);
    if (JSON.stringify(decoded) !== JSON.stringify(normalizeAbiJson(decodedJson))) return null;
    return { decoded, encoded: canonicalEncoded };
  } catch {
    return null;
  }
}

function isNonZeroAddress(value: string) {
  return addressPattern.test(value) && !/^0x0{40}$/i.test(value);
}

function isNonZeroCommit(value: string) {
  return commitPattern.test(value) && !/^0+$/.test(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasOnlyKeys(value: object, keys: string[]) {
  return Object.keys(value).every((key) => keys.includes(key));
}

function validVerifierList(value: string, status: string) {
  const verifiers = parseArray(value);
  if (!verifiers) return false;
  const valid = verifiers.every(
    (verifier) =>
      typeof verifier === 'object' &&
      verifier !== null &&
      !Array.isArray(verifier) &&
      hasOnlyKeys(verifier, ['chainId', 'url', 'status']) &&
      Number.isInteger((verifier as { chainId?: unknown }).chainId) &&
      (verifier as { chainId: number }).chainId === 8453 &&
      isHttpsUrl((verifier as { url?: string }).url ?? '') &&
      ['verified', 'unverified', 'pending'].includes((verifier as { status?: string }).status ?? '')
  );
  if (!valid) return false;
  const evidenceKeys = verifiers.map((verifier) =>
    JSON.stringify([
      (verifier as { chainId: number }).chainId,
      normalizedEffectiveHttpsUrl((verifier as { url: string }).url),
    ])
  );
  if (new Set(evidenceKeys).size !== evidenceKeys.length) return false;
  const statuses = verifiers.map((verifier) => (verifier as { status: string }).status);
  if (status === 'verified')
    return verifiers.length > 0 && statuses.every((item) => item === 'verified');
  if (status === 'partially-verified')
    return (
      verifiers.length >= 2 &&
      statuses.includes('verified') &&
      statuses.some((item) => item === 'unverified' || item === 'pending')
    );
  if (status === 'unverified')
    return statuses.every((item) => item === 'unverified' || item === 'pending');
  return status === 'not-applicable' && verifiers.length === 0;
}

function validExternalDependencies(value: string) {
  const dependencies = parseArray(value);
  return (
    dependencies !== null &&
    dependencies.every((dependency) => {
      if (
        typeof dependency !== 'object' ||
        dependency === null ||
        Array.isArray(dependency) ||
        !hasOnlyKeys(dependency, ['name', 'kind', 'addresses', 'url', 'purpose']) ||
        !isNonEmptyString((dependency as { name?: unknown }).name) ||
        !isNonEmptyString((dependency as { purpose?: unknown }).purpose)
      )
        return false;

      const kind = (dependency as { kind?: string }).kind ?? '';
      if (!['contract', 'oracle', 'token', 'relayer', 'api', 'other'].includes(kind)) return false;

      const hasAddresses = Object.hasOwn(dependency, 'addresses');
      const addresses = (dependency as { addresses?: unknown }).addresses;
      if (
        hasAddresses &&
        (!Array.isArray(addresses) ||
          addresses.length === 0 ||
          !addresses.every((address) => isNonZeroAddress(String(address))))
      )
        return false;

      const hasUrl = Object.hasOwn(dependency, 'url');
      if (hasUrl && !isHttpsUrl(String((dependency as { url?: unknown }).url))) return false;

      if (['contract', 'oracle', 'token', 'relayer'].includes(kind)) return hasAddresses;
      if (kind === 'api') return hasUrl;
      return hasAddresses || hasUrl;
    })
  );
}

function validPrivilegedRoles(value: string) {
  const roles = parseArray(value);
  return (
    roles !== null &&
    roles.every(
      (role) =>
        typeof role === 'object' &&
        role !== null &&
        !Array.isArray(role) &&
        hasOnlyKeys(role, ['name', 'holders', 'capabilities', 'renounceable']) &&
        isNonEmptyString((role as { name?: unknown }).name) &&
        Array.isArray((role as { holders?: unknown }).holders) &&
        (role as { holders: unknown[] }).holders.length > 0 &&
        (role as { holders: unknown[] }).holders.every((holder) =>
          isNonZeroAddress(String(holder))
        ) &&
        Array.isArray((role as { capabilities?: unknown }).capabilities) &&
        (role as { capabilities: unknown[] }).capabilities.length > 0 &&
        (role as { capabilities: unknown[] }).capabilities.every(isNonEmptyString) &&
        (!Object.hasOwn(role, 'renounceable') ||
          typeof (role as { renounceable: unknown }).renounceable === 'boolean')
    )
  );
}

function validStringArray(value: string) {
  const parsed = parseArray(value);
  return parsed !== null && parsed.every(isNonEmptyString);
}

function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function slug(value: string) {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'my-taskmarket-hook'
  );
}

function contractName(value: string) {
  const name =
    value
      .replace(/[^a-zA-Z0-9]+/g, ' ')
      .split(' ')
      .filter(Boolean)
      .map((word) => `${word[0]?.toUpperCase()}${word.slice(1)}`)
      .join('') || 'MyTaskmarketHook';
  return `${/^[0-9]/.test(name) ? 'Hook' : ''}${name.endsWith('Hook') ? name : `${name}Hook`}`;
}

export function manifestReadiness(input: HookBuilderInput) {
  const missing: string[] = [];
  if (!input.name.trim()) missing.push('project name');
  if ([...input.name].length > 120) missing.push('project name at most 120 characters');
  if (!input.description.trim()) missing.push('description');
  if ([...input.description].length > 2000) missing.push('description at most 2000 characters');
  if (!input.author.trim()) missing.push('author name');
  if (!isHttpsUrl(input.authorUrl)) missing.push('author HTTPS URL');
  if (!isHttpsUrl(input.repository)) missing.push('source repository HTTPS URL');
  if (!isNonZeroCommit(input.commit)) missing.push('nonzero source commit SHA');
  if (!isPortableSourcePath(input.sourcePath)) missing.push('source contract path');
  if (!input.callbacks.length) missing.push('at least one callback');
  if (new Set(input.callbacks).size !== input.callbacks.length) missing.push('unique callbacks');
  if (input.callbacks.some((callback) => !hookCallbacks.some(([name]) => name === callback)))
    missing.push('supported callbacks');
  if (!input.modes.length) missing.push('at least one task mode');
  if (new Set(input.modes).size !== input.modes.length) missing.push('unique task modes');
  if (input.modes.some((mode) => !hookModes.some((name) => name === mode)))
    missing.push('supported task modes');
  if (!isNonZeroAddress(input.taskmarket)) missing.push('nonzero Taskmarket Diamond address');
  if (!isNonZeroAddress(input.hookAddress)) missing.push('nonzero deployed hook address');
  if (!nonZeroBytes32Pattern.test(input.deploymentTransactionHash))
    missing.push('deployment transaction hash');
  if (
    !Number.isInteger(Number(input.deploymentBlockNumber)) ||
    Number(input.deploymentBlockNumber) <= 0
  )
    missing.push('deployment block number');
  if (!nonZeroBytes32Pattern.test(input.runtimeCodehash)) missing.push('runtime codehash');
  if (!Number.isInteger(Number(input.typicalGas)) || Number(input.typicalGas) <= 0)
    missing.push('nonzero typical gas estimate');
  if (
    !Number.isInteger(Number(input.maximumGas)) ||
    Number(input.maximumGas) < Number(input.typicalGas) ||
    Number(input.maximumGas) <= 0
  )
    missing.push('nonzero maximum gas at least typical gas');
  if (!input.gasMethodology.trim()) missing.push('gas methodology');
  if (input.hookDataEncoding === 'abi') {
    const parameters = parseHookDataAbiParameters(input.hookDataAbiType);
    const decodedJson = parseJson(input.hookDataDecoded);
    const encodedIsHex =
      hexBytesPattern.test(input.hookDataEncoded) && input.hookDataEncoded !== '0x';
    if (!parameters) missing.push('valid hookData ABI parameter declaration');
    if (!decodedJson) missing.push('valid decoded hookData JSON');
    if (!encodedIsHex) missing.push('encoded hookData bytes');
    if (
      parameters &&
      decodedJson &&
      encodedIsHex &&
      !canonicalAbiExample(parameters, decodedJson.value, input.hookDataEncoded)
    )
      missing.push('canonical hookData bytes matching the decoded JSON');
  }
  if (input.upgradeability === 'erc1967') {
    if (!isNonZeroAddress(input.proxyImplementation))
      missing.push('nonzero proxy implementation address');
    if (!isNonZeroAddress(input.proxyAdmin)) missing.push('nonzero proxy admin address');
    if (!input.upgradeAuthorityDescription.trim()) missing.push('upgrade authority description');
  }
  if (
    !['verified', 'partially-verified', 'unverified', 'not-applicable'].includes(
      input.sourceVerification
    ) ||
    !validVerifierList(input.sourceVerificationVerifiers, input.sourceVerification)
  )
    missing.push('source verification declaration and verifier evidence');
  if (!['unlisted', 'submitted', 'listed', 'delisted'].includes(input.listingStatus))
    missing.push('listing declaration');
  if (
    (['submitted', 'listed'].includes(input.listingStatus) &&
      !isHttpsUrl(input.listingEvidenceUrl)) ||
    (input.listingEvidenceUrl && !isHttpsUrl(input.listingEvidenceUrl))
  )
    missing.push('listing evidence HTTPS URL');
  if (
    !['self-attested', 'tested', 'independently-verified', 'not-claimed'].includes(
      input.conformanceStatus
    )
  )
    missing.push('conformance declaration');
  if (
    (['tested', 'independently-verified'].includes(input.conformanceStatus) &&
      !isHttpsUrl(input.conformanceEvidenceUrl)) ||
    (input.conformanceEvidenceUrl && !isHttpsUrl(input.conformanceEvidenceUrl))
  )
    missing.push('conformance evidence HTTPS URL');
  if (!['not-default', 'candidate'].includes(input.protocolDefaultStatus))
    missing.push('protocol-default declaration');
  if (
    (input.protocolDefaultStatus === 'candidate' &&
      !isHttpsUrl(input.protocolDefaultEvidenceUrl)) ||
    (input.protocolDefaultEvidenceUrl && !isHttpsUrl(input.protocolDefaultEvidenceUrl))
  )
    missing.push('protocol-default evidence HTTPS URL');
  if (!validStringArray(input.livenessRequirements))
    missing.push('liveness requirements JSON array');
  if (!input.livenessFailureMode.trim()) missing.push('liveness failure mode');
  if (!['audited', 'unaudited', 'in-progress'].includes(input.securityAuditStatus))
    missing.push('security audit status');
  if (!input.securityAuditScope.trim()) missing.push('security audit scope');
  if (
    (input.securityAuditStatus === 'audited' && !isHttpsUrl(input.securityAuditReport)) ||
    (input.securityAuditReport && !isHttpsUrl(input.securityAuditReport))
  )
    missing.push('security audit report HTTPS URL');
  if (input.securityAuditDate && !isValidDate(input.securityAuditDate))
    missing.push('security audit date');
  if (!input.securityNotes.trim()) missing.push('security notes');
  if (!validExternalDependencies(input.externalDependencies))
    missing.push('schema-valid external dependencies JSON array');
  if (!validPrivilegedRoles(input.privilegedRoles))
    missing.push('schema-valid privileged roles JSON array');
  if (
    input.upgradeability === 'erc1967' &&
    !parseArray(input.privilegedRoles)?.some((role) => {
      const holders = (role as { holders?: unknown[] }).holders;
      return (
        Array.isArray(holders) &&
        holders.some((holder) => String(holder).toLowerCase() === input.proxyAdmin.toLowerCase())
      );
    })
  )
    missing.push('privileged role for the proxy admin');
  if (!input.trustReviewed) missing.push('review of every trust declaration');
  return { missing, ready: missing.length === 0 };
}

export function buildHookManifest(input: HookBuilderInput) {
  const readiness = manifestReadiness(input);
  const parsedAbiParameters = parseHookDataAbiParameters(input.hookDataAbiType);
  const parsedDecoded = parseJson(input.hookDataDecoded);
  const abiExample =
    input.hookDataEncoding === 'abi' && parsedAbiParameters && parsedDecoded
      ? canonicalAbiExample(parsedAbiParameters, parsedDecoded.value, input.hookDataEncoded)
      : null;
  const dependencies = parseArray(input.externalDependencies) ?? [];
  const roles = parseArray(input.privilegedRoles) ?? [];
  const verifiers = parseArray(input.sourceVerificationVerifiers) ?? [];
  const livenessRequirements = parseArray(input.livenessRequirements) ?? [];
  const placeholderAddress = `0x${'0'.repeat(40)}`;
  const placeholderHash = `0x${'0'.repeat(64)}`;
  const typical = Number.isInteger(Number(input.typicalGas)) ? Number(input.typicalGas) : 0;
  const maximum = Number.isInteger(Number(input.maximumGas))
    ? Math.max(Number(input.maximumGas), typical)
    : typical;
  const callbacks = input.callbacks.length ? input.callbacks : ['checkFund'];
  const manifest = {
    manifestVersion: '1.0.0',
    identity: {
      name: input.name || 'Draft Taskmarket Hook',
      slug: slug(input.name),
      version: '1.0.0',
      description: input.description || 'Draft manifest. Do not publish.',
    },
    author: {
      name: input.author || 'DRAFT: unknown author',
      url: isHttpsUrl(input.authorUrl) ? input.authorUrl : 'https://example.invalid',
    },
    source: {
      repository: isHttpsUrl(input.repository) ? input.repository : 'https://example.invalid/draft',
      commit: isNonZeroCommit(input.commit) ? input.commit : '0000000',
      path: input.sourcePath || `src/${contractName(input.name)}.sol`,
    },
    license: 'MIT',
    deployments: [
      {
        chainId: 8453,
        network: 'base',
        hook: addressPattern.test(input.hookAddress) ? input.hookAddress : placeholderAddress,
        taskmarketDiamond: addressPattern.test(input.taskmarket)
          ? input.taskmarket
          : placeholderAddress,
        deployment: {
          transactionHash: nonZeroBytes32Pattern.test(input.deploymentTransactionHash)
            ? input.deploymentTransactionHash
            : placeholderHash,
          blockNumber: Number.isInteger(Number(input.deploymentBlockNumber))
            ? Number(input.deploymentBlockNumber)
            : 0,
        },
        runtimeCodehash: nonZeroBytes32Pattern.test(input.runtimeCodehash)
          ? input.runtimeCodehash
          : placeholderHash,
      },
    ],
    callbacks,
    taskModes: input.modes.length ? input.modes : ['bounty'],
    hookData:
      input.hookDataEncoding === 'abi'
        ? {
            encoding: 'abi',
            abiType: input.hookDataAbiType || 'bytes',
            schema: {},
            // Publisher-attested structural ABI example; it is not independently verified.
            examples: [
              {
                name: 'example configuration',
                decoded: abiExample?.decoded ?? parsedDecoded?.value ?? null,
                encoded: abiExample?.encoded ?? '0x',
              },
            ],
          }
        : {
            encoding: 'none',
            schema: {},
            examples: [{ name: 'no configuration', decoded: null, encoded: '0x' }],
          },
    sourceVerification: { status: input.sourceVerification || 'unverified', verifiers },
    proxy:
      input.upgradeability === 'erc1967'
        ? {
            kind: 'erc1967',
            upgradeable: true,
            implementation: addressPattern.test(input.proxyImplementation)
              ? input.proxyImplementation
              : placeholderAddress,
            admin: addressPattern.test(input.proxyAdmin) ? input.proxyAdmin : placeholderAddress,
            upgradeAuthorityDescription:
              input.upgradeAuthorityDescription || 'DRAFT: authority has not been verified.',
          }
        : { kind: 'none', upgradeable: false },
    privilegedRoles: roles,
    externalDependencies: dependencies,
    liveness: {
      requirements: livenessRequirements,
      failureMode: input.livenessFailureMode || 'DRAFT: failure mode has not been reviewed.',
      ...(input.livenessRecovery ? { recovery: input.livenessRecovery } : {}),
    },
    gas: {
      network: 'base',
      estimates: Object.fromEntries(
        callbacks.map((callback) => [
          callback,
          {
            typical,
            maximum,
            methodology: input.gasMethodology || 'DRAFT: gas has not been measured.',
          },
        ])
      ),
    },
    security: {
      audits: [
        {
          status: input.securityAuditStatus || 'unaudited',
          scope: input.securityAuditScope || 'DRAFT: audit scope has not been recorded.',
          ...(input.securityAuditReport ? { report: input.securityAuditReport } : {}),
          ...(input.securityAuditDate ? { date: input.securityAuditDate } : {}),
        },
      ],
      notes: [input.securityNotes || 'DRAFT: security review has not been recorded.'],
    },
    listing: {
      status: input.listingStatus || 'unlisted',
      ...(input.listingEvidenceUrl ? { listingUrl: input.listingEvidenceUrl } : {}),
    },
    conformance: {
      status: input.conformanceStatus || 'not-claimed',
      standard: 'ITMPHook / ERC-8195',
      ...(input.conformanceEvidenceUrl ? { evidence: input.conformanceEvidenceUrl } : {}),
    },
    protocolDefault: {
      status: input.protocolDefaultStatus || 'not-default',
      ...(input.protocolDefaultEvidenceUrl ? { evidence: input.protocolDefaultEvidenceUrl } : {}),
    },
    'x-schema': 'https://taskmarket.dev/schemas/taskmarket-hook/1.0.0/schema.json',
    ...(readiness.ready
      ? {}
      : {
          'x-draft': {
            warning:
              'This file is a draft. Replace placeholders and independently verify every declaration before publishing.',
            missing: readiness.missing,
          },
        }),
  };
  return manifest;
}

export function buildHookSolidity(input: HookBuilderInput) {
  const name = contractName(input.name);
  const selected = new Set(input.callbacks);
  const methods: Record<HookCallback, string> = {
    checkFund:
      'function _checkFund(bytes32, ITMPCore.TaskContext calldata, bytes calldata) internal override returns (bool) { return true; }',
    checkClaim:
      'function _checkClaim(bytes32, ITMPCore.TaskContext calldata, address) internal override returns (bool) { return true; }',
    checkSelectWorker:
      'function _checkSelectWorker(bytes32, ITMPCore.TaskContext calldata, address) internal override returns (bool) { return true; }',
    checkSubmit:
      'function _checkSubmit(bytes32, ITMPCore.TaskContext calldata, address, bytes32) internal override returns (bool) { return true; }',
    checkEvaluate:
      'function _checkEvaluate(bytes32, ITMPCore.TaskContext calldata, address) internal override returns (bool) { return true; }',
    checkComplete:
      'function _checkComplete(bytes32, ITMPCore.TaskContext calldata, ITMPCore.Verdict calldata) internal override returns (bool) { return true; }',
    onComplete:
      'function _onComplete(bytes32, ITMPCore.TaskContext calldata, ITMPCore.Verdict calldata) internal override { }',
    onForfeit:
      'function _onForfeit(bytes32, ITMPCore.TaskContext calldata, address) internal override { }',
    onCancel: 'function _onCancel(bytes32, ITMPCore.TaskContext calldata) internal override { }',
    onExpire: 'function _onExpire(bytes32, ITMPCore.TaskContext calldata) internal override { }',
  };
  const overrides = hookCallbacks
    .map(([callback]) =>
      selected.has(callback)
        ? `    // TODO: implement ${callback} policy.\n    ${methods[callback]}`
        : ''
    )
    .filter(Boolean)
    .join('\n\n');
  return `// SPDX-License-Identifier: MIT\npragma solidity ^0.8.24;\n\nimport { BaseTMPHook } from "@taskmarket/contracts/src/hooks/base/BaseTMPHook.sol";\nimport { ITMPCore } from "@taskmarket/contracts/src/interfaces/ITMPCore.sol";\n\n/// @notice Safe-by-default Taskmarket hook scaffold.\ncontract ${name} is BaseTMPHook {\n    constructor(address taskmarket_) BaseTMPHook(taskmarket_) { }\n\n${overrides}\n}\n`;
}
