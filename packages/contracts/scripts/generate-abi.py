#!/usr/bin/env python3
"""Merge forge build artifacts into the committed ABI files under packages/contracts/abi/.

The Diamond (EIP-2535) presents one address whose ABI is the union of every facet's
ABI, so TaskMarket.json is that union, de-duplicated and order-stable. The reward
hook contracts are deployed separately, so each gets its own file.

These files are the single source of truth the backend indexer reads its event
definitions from (apps/backend/src/services/indexer-abi-events.ts). `make contract
abi-check` regenerates them and fails if the committed copies differ, mirroring the
`forge snapshot --check` gas gate -- a stale committed ABI would silently defeat the
indexer's drift guard.

Run from packages/contracts.
"""

import json
import os
import sys

DIAMOND_FACETS = [
    "DiamondCutFacet.sol/DiamondCutFacet.json",
    "DiamondLoupeFacet.sol/DiamondLoupeFacet.json",
    "AdminFacet.sol/AdminFacet.json",
    "CoreFacet.sol/CoreFacet.json",
    "AuctionFacet.sol/AuctionFacet.json",
    "AcceptanceFacet.sol/AcceptanceFacet.json",
    "EvaluatorFacet.sol/EvaluatorFacet.json",
    "RatingFacet.sol/RatingFacet.json",
    "RegistryFacet.sol/RegistryFacet.json",
]

# Standalone contracts deployed at their own addresses. The indexer polls each of
# these separately, so each needs its own ABI file.
STANDALONE = {
    "TaskTokenRewardHook": "TaskTokenRewardHook.sol/TaskTokenRewardHook.json",
    "RewardVault": "RewardVault.sol/RewardVault.json",
    "EpochBudget": "EpochBudget.sol/EpochBudget.json",
}


def load_abi(artifact):
    path = os.path.join("out", artifact)
    if not os.path.exists(path):
        sys.exit(f"Missing forge artifact: {path} (run `forge build --root packages/contracts` first)")
    with open(path) as handle:
        return json.load(handle)["abi"]


def write(name, entries):
    with open(os.path.join("abi", f"{name}.json"), "w") as handle:
        handle.write(json.dumps(entries, indent=2) + "\n")
    print(f"ABI: {len(entries)} entries -> abi/{name}.json")


def main():
    merged = []
    seen = set()
    for artifact in DIAMOND_FACETS:
        for entry in load_abi(artifact):
            key = json.dumps(entry, sort_keys=True)
            if key in seen:
                continue
            seen.add(key)
            merged.append(entry)
    write("TaskMarket", merged)

    for name, artifact in STANDALONE.items():
        write(name, load_abi(artifact))


if __name__ == "__main__":
    main()
