import {
  EpochBudgetABI,
  RewardVaultABI,
  TaskMarketABI,
  TaskMarketForwarderABI,
  TaskTokenRewardHookABI,
} from '@taskmarket/contracts/abi';
import { toFunctionSelector } from 'viem';

/**
 * Maps a contract error selector to its name, for every error the deployed contracts can throw.
 *
 * This used to be ~135 hand-written selector/name pairs, and the cost of a miss is not cosmetic:
 * an unmapped error decodes as no reason at all, `classifyRelayFailure` reads that as transient,
 * and the relayer re-sends a call that can only revert again. The map's own comment stated the
 * rule -- "adding a custom error to a facet is not finished until it appears here" -- and it
 * drifted twice anyway: the createTask payment-orphan incident, and a smoke run that burned 20
 * broadcast attempts over ~17 minutes before refunding. A rule enforced by memory keeps being
 * forgotten, so it is enforced by derivation now.
 *
 * The base is computed from the generated ABI artifacts, which `make contract abi-check` already
 * gates against the contract sources (ADR-0065). Every error across the Diamond, forwarder, hook,
 * vault and epoch budget is therefore covered without anyone remembering to add it.
 */

type AbiParameterLike = { type: string; components?: readonly AbiParameterLike[] };
type AbiErrorLike = { type: string; name?: string; inputs?: readonly AbiParameterLike[] };

const ARTIFACTS = {
  EpochBudget: EpochBudgetABI,
  RewardVault: RewardVaultABI,
  TaskMarket: TaskMarketABI,
  // Nothing indexes the forwarder, but every relayed call goes through it, so its errors are
  // the ones a relayed write reverts with most often. It was not a generated artifact until
  // this map started deriving from them, and its eight errors were hand-mapped or nothing.
  TaskMarketForwarder: TaskMarketForwarderABI,
  TaskTokenRewardHook: TaskTokenRewardHookABI,
} as const;

/**
 * The canonical type string a selector is hashed from. Tuples expand to their components in
 * parentheses, keeping any array suffix -- `tuple[]` is `(uint256,address)[]`, and hashing the
 * literal word "tuple" would produce a selector no contract will ever emit.
 */
function canonicalType(input: AbiParameterLike): string {
  if (input.type.startsWith('tuple')) {
    const components = (input.components ?? []).map(canonicalType).join(',');
    return `(${components})${input.type.slice('tuple'.length)}`;
  }

  return input.type;
}

export function errorSignature(item: AbiErrorLike): string {
  return `${item.name}(${(item.inputs ?? []).map(canonicalType).join(',')})`;
}

/** Every error defined across all four generated artifacts, as `{ artifact, name, signature }`. */
export function generatedErrors(): { artifact: string; name: string; signature: string }[] {
  return Object.entries(ARTIFACTS).flatMap(([artifact, abi]) =>
    (abi as readonly AbiErrorLike[])
      .filter((item) => item.type === 'error' && item.name)
      .map((item) => ({ artifact, name: item.name as string, signature: errorSignature(item) }))
  );
}

function deriveKnownErrors(): Record<string, string> {
  const derived: Record<string, string> = {};
  for (const { name, signature } of generatedErrors()) {
    derived[toFunctionSelector(signature).toLowerCase()] = name;
  }
  return derived;
}

/**
 * Errors whose facets have not been deployed yet.
 *
 * This overlay is load-bearing and must not be deleted as redundant. A derived map can only
 * contain errors present in the ABI it was built from, and `abi-check` pins that artifact to the
 * contract sources in the same tree -- so derivation alone cannot express "an error the deployed
 * Diamond cannot throw yet", which is exactly what shipping decodability one deploy ahead of the
 * facet that throws it requires. Without this, that window reopens on every future upgrade.
 *
 * Entries here are deliberately temporary. `contract-known-errors.test.ts` fails an entry once
 * it appears in the derived base, so the overlay empties itself rather than accumulating.
 *
 * It is empty right now because rev020 has shipped and every error in the tree is in the ABI.
 * Add to it when mapping an error ahead of its upgrade; remove the entry when that upgrade lands.
 */
export const PENDING_ERROR_OVERLAY: Record<string, string> = {};

export const KNOWN_ERRORS: Record<string, string> = {
  ...deriveKnownErrors(),
  ...PENDING_ERROR_OVERLAY,
};
