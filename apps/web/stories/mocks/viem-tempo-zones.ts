// Wagmi's Tempo action barrel references this not-yet-exported viem subpath even
// when Tempo is unused. Storybook only exercises Base, so a build-time shim keeps
// that unrelated connector surface out of the catalogue bundle.
export const Abis = {};
export const Actions = {};
export const Bytes = {};
export const PublicKey = {};
export const Secp256k1 = {};
export const TokenId = {};

export function zone() {
  throw new Error('Tempo zones are not available in Storybook.');
}
