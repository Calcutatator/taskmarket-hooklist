// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script, console } from "forge-std/Script.sol";
import { IDiamondCut } from "../../src/interfaces/IDiamondCut.sol";
import { AdminFacet } from "../../src/facets/AdminFacet.sol";
import { CoreFacet } from "../../src/facets/CoreFacet.sol";
import { EvaluatorFacet } from "../../src/facets/EvaluatorFacet.sol";
import { FacetSelectors } from "../lib/FacetSelectors.sol";

/// @title Rev016Upgrade — createTask takes evaluator configuration, so assignment is atomic
/// @dev Before this revision, a task with an evaluator needed two transactions: `createTask`,
///      then `assignEvaluator`. The task is Open — and therefore claimable — from the moment
///      `createTask` mines, and `assignEvaluator` reverts `TaskNotOpen` once a worker has
///      claimed, so the second call raced every worker agent watching for new tasks and could
///      lose. `createTask` now takes an `ITMPCore.TaskEvaluatorConfig` and applies it in the
///      same transaction, which removes the window rather than narrowing it.
///
/// @dev Two facets change:
///
///      CoreFacet — `createTask` gained a parameter, so its selector changed
///        (0xa595d889 -> 0x95d5ec3f). As in rev014, a selector change is a Remove(old) +
///        Replace(unchanged) + Add(new), not a pure Replace: the diamond routes by selector, and
///        the old one has no implementation to route to any more.
///
///      EvaluatorFacet — `assignEvaluator`'s signature is unchanged, but its body now delegates
///        the shared validation, storage writes, stake pull and event to
///        LibTaskMarket._applyEvaluatorConfig so the two entry points cannot drift. That is a
///        bytecode change with no selector change, so it is a pure Replace.
///
/// @dev The old `createTask` selector is deliberately removed rather than left routed alongside
///      the new one. A caller still encoding the 9-parameter signature is a caller that believes
///      evaluator terms cannot be set at creation, and silently accepting that call would create
///      exactly the un-evaluated task this revision exists to prevent — as a success, with no
///      error anyone sees. A removed selector reverts at the diamond's fallback instead, which is
///      a loud, immediate, and correct answer. The only in-repo encoder of the signature is the
///      backend's hand-written viem ABI in `apps/backend/src/services/contract.ts`, updated in
///      the same change; the forwarder does not encode the selector itself, it relays whatever
///      calldata it is handed, so it needs no redeployment.
///
/// @dev Required env vars:
///      FORGE_DEV_PRIVATE_KEY          — owner key (must match Diamond owner)
///      FORGE_DIAMOND_ADDRESS_TESTNET  — Diamond proxy on Base Sepolia (chain 84532)
///      FORGE_DIAMOND_ADDRESS_MAINNET  — Diamond proxy on Base Mainnet (chain 8453)
///
/// @dev Usage (normally applied automatically by `make upgrade <testnet|mainnet>` as part of the
///      pending-steps sequence; direct single-step invocation):
///      make upgrade testnet rev016
///      make upgrade mainnet rev016
contract Rev016Upgrade is Script {
    uint256 private constant EXPECTED_PRE_VERSION = 15;
    uint256 private constant TARGET_VERSION = 16;

    // Pre-rev016 createTask selector: the rev014 signature, with StakeConfig but no evaluator
    // config. Rev015 replaced only RegistryFacet, so this is still the selector live on any
    // diamond at rev015.
    bytes4 private constant OLD_CREATE_TASK = bytes4(
        keccak256(
            "createTask(uint256,uint256,bytes4,uint256,uint256,bytes4,(bool,uint16),(address[],bytes),(bytes32,string,bytes32[]))"
        )
    );

    function run() external {
        uint256 ownerKey = vm.envUint("FORGE_DEV_PRIVATE_KEY");
        address diamond = block.chainid == 8453
            ? vm.envAddress("FORGE_DIAMOND_ADDRESS_MAINNET")
            : vm.envAddress("FORGE_DIAMOND_ADDRESS_TESTNET");

        uint256 currentVersion = AdminFacet(diamond).diamondVersion();
        require(currentVersion == EXPECTED_PRE_VERSION, "Rev016Upgrade: diamond is not at rev015");

        vm.startBroadcast(ownerKey);

        address coreFacet = address(new CoreFacet());
        address evalFacet = address(new EvaluatorFacet());

        IDiamondCut.FacetCut[] memory cuts = new IDiamondCut.FacetCut[](4);

        bytes4[] memory oldCreateTask = new bytes4[](1);
        oldCreateTask[0] = OLD_CREATE_TASK;
        cuts[0] = IDiamondCut.FacetCut(address(0), IDiamondCut.FacetCutAction.Remove, oldCreateTask);

        cuts[1] = IDiamondCut.FacetCut(coreFacet, IDiamondCut.FacetCutAction.Replace, _coreUnchangedSelectors());

        bytes4[] memory newCreateTask = new bytes4[](1);
        newCreateTask[0] = CoreFacet.createTask.selector;
        cuts[2] = IDiamondCut.FacetCut(coreFacet, IDiamondCut.FacetCutAction.Add, newCreateTask);

        cuts[3] =
            IDiamondCut.FacetCut(evalFacet, IDiamondCut.FacetCutAction.Replace, FacetSelectors.evalFacetSelectors());

        IDiamondCut(diamond).diamondCut(cuts, address(0), "");
        AdminFacet(diamond).setDiamondVersion(TARGET_VERSION);

        vm.stopBroadcast();

        console.log("Rev016 upgrade complete. Diamond:", diamond);
        console.log("CoreFacet:      ", coreFacet);
        console.log("EvaluatorFacet: ", evalFacet);
        console.log("diamondVersion: ", TARGET_VERSION);
    }

    /// @dev The 20 CoreFacet selectors whose signature is unaffected by rev016 (everything in
    ///      FacetSelectors.coreFacetSelectors() except createTask, which changed).
    function _coreUnchangedSelectors() private pure returns (bytes4[] memory s) {
        s = new bytes4[](20);
        s[0] = bytes4(keccak256("BOUNTY()"));
        s[1] = bytes4(keccak256("CLAIM()"));
        s[2] = bytes4(keccak256("PITCH()"));
        s[3] = bytes4(keccak256("BENCHMARK()"));
        s[4] = bytes4(keccak256("AUCTION()"));
        s[5] = bytes4(keccak256("AUCTION_DUTCH()"));
        s[6] = bytes4(keccak256("AUCTION_ENGLISH()"));
        s[7] = bytes4(keccak256("AUCTION_REVERSE_DUTCH()"));
        s[8] = bytes4(keccak256("AUCTION_REVERSE_ENGLISH()"));
        s[9] = bytes4(keccak256("MAX_BIDS_PER_TASK()"));
        s[10] = CoreFacet.claimTask.selector;
        s[11] = CoreFacet.selectWorker.selector;
        s[12] = CoreFacet.submitPitch.selector;
        s[13] = CoreFacet.submitProof.selector;
        s[14] = CoreFacet.submitWork.selector;
        s[15] = CoreFacet.forfeitAndReopen.selector;
        s[16] = CoreFacet.cancelTask.selector;
        s[17] = CoreFacet.updateTask.selector;
        s[18] = CoreFacet.refundExpired.selector;
        s[19] = CoreFacet.rejectSubmission.selector;
    }
}
