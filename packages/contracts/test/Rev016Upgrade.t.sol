// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import { IDiamondCut } from "../src/interfaces/IDiamondCut.sol";
import { IDiamondLoupe } from "../src/interfaces/IDiamondLoupe.sol";
import { AdminFacet } from "../src/facets/AdminFacet.sol";
import { CoreFacet } from "../src/facets/CoreFacet.sol";
import { EvaluatorFacet } from "../src/facets/EvaluatorFacet.sol";
import { Rev016Upgrade } from "../script/upgrades/Rev016Upgrade.s.sol";
import { DiamondTestHelper } from "./helpers/DiamondTestHelper.sol";

/// @title Rev016UpgradeTest
/// @dev Rev016 changes `createTask`'s selector (it gained the evaluator config parameter) and
///      replaces EvaluatorFacet's bytecode without changing any of its selectors. This exercises
///      both halves of that cut.
///
///      A fresh test diamond is built from FacetSelectors, which is the *current* steady state,
///      so it already routes the post-rev016 createTask selector and does not route the
///      pre-rev016 one — the reverse of what rev016 expects to find. Rather than skip the step
///      the way Rev015UpgradeTest has to for rev014, this test reconstructs the pre-rev016
///      routing directly: remove the new selector, add the old one. Routing is the entire thing
///      the cut manipulates, so a reconstruction at that level is a faithful precondition even
///      though no historical CoreFacet bytecode survives in this repo to deploy.
contract Rev016UpgradeTest is Test, DiamondTestHelper {
    uint256 internal constant OWNER_KEY = 0xA11CE;
    address internal owner;
    address internal usdc = address(0xACDC);
    address internal feeRecipient = address(0xFEE0);
    uint16 internal feeBps = 500;

    bytes4 internal constant OLD_CREATE_TASK = bytes4(
        keccak256(
            "createTask(uint256,uint256,bytes4,uint256,uint256,bytes4,(bool,uint16),(address[],bytes),(bytes32,string,bytes32[]))"
        )
    );

    function setUp() public {
        owner = vm.addr(OWNER_KEY);
    }

    function _atRev015WithOldCreateTask(address diamond) internal {
        vm.setEnv("FORGE_DEV_PRIVATE_KEY", vm.toString(OWNER_KEY));
        vm.setEnv("FORGE_DIAMOND_ADDRESS_TESTNET", vm.toString(diamond));
        vm.setEnv("FORGE_DIAMOND_ADDRESS_MAINNET", vm.toString(diamond));

        address coreFacet = IDiamondLoupe(diamond).facetAddress(CoreFacet.claimTask.selector);

        bytes4[] memory newSel = new bytes4[](1);
        newSel[0] = CoreFacet.createTask.selector;
        bytes4[] memory oldSel = new bytes4[](1);
        oldSel[0] = OLD_CREATE_TASK;

        IDiamondCut.FacetCut[] memory cuts = new IDiamondCut.FacetCut[](2);
        cuts[0] = IDiamondCut.FacetCut(address(0), IDiamondCut.FacetCutAction.Remove, newSel);
        cuts[1] = IDiamondCut.FacetCut(coreFacet, IDiamondCut.FacetCutAction.Add, oldSel);

        vm.prank(owner);
        IDiamondCut(diamond).diamondCut(cuts, address(0), "");

        vm.prank(owner);
        AdminFacet(diamond).setDiamondVersion(15);
    }

    function test_Rev016Upgrade_SwapsCreateTaskSelectorAndReplacesEvaluatorFacet() public {
        address diamond = address(deployDiamond(owner, usdc, feeRecipient, feeBps));
        _atRev015WithOldCreateTask(diamond);

        assertEq(AdminFacet(diamond).diamondVersion(), 15, "must be at rev015 before rev016");
        assertNotEq(IDiamondLoupe(diamond).facetAddress(OLD_CREATE_TASK), address(0), "old selector routed pre-upgrade");

        address oldEvalFacet = IDiamondLoupe(diamond).facetAddress(EvaluatorFacet.assignEvaluator.selector);

        new Rev016Upgrade().run();

        assertEq(AdminFacet(diamond).diamondVersion(), 16, "diamondVersion must be 16 after rev016 upgrade");

        // The old selector is unrouted, so a client still encoding the 9-parameter signature gets
        // a revert rather than a silently un-evaluated task.
        assertEq(IDiamondLoupe(diamond).facetAddress(OLD_CREATE_TASK), address(0), "old selector must be removed");

        address newCoreFacet = IDiamondLoupe(diamond).facetAddress(CoreFacet.createTask.selector);
        assertNotEq(newCoreFacet, address(0), "new createTask must route");
        assertEq(
            IDiamondLoupe(diamond).facetAddress(CoreFacet.claimTask.selector),
            newCoreFacet,
            "unchanged CoreFacet selectors must route to the same new facet"
        );
        assertEq(
            IDiamondLoupe(diamond).facetAddress(CoreFacet.rejectSubmission.selector),
            newCoreFacet,
            "rejectSubmission must route to the new facet"
        );

        // EvaluatorFacet: same selectors, new implementation.
        address newEvalFacet = IDiamondLoupe(diamond).facetAddress(EvaluatorFacet.assignEvaluator.selector);
        assertNotEq(newEvalFacet, oldEvalFacet, "EvaluatorFacet must be replaced");
        assertEq(
            IDiamondLoupe(diamond).facetAddress(EvaluatorFacet.evaluate.selector),
            newEvalFacet,
            "evaluate must route to the new EvaluatorFacet"
        );
        assertEq(
            IDiamondLoupe(diamond).facetAddress(EvaluatorFacet.evaluatorTimeout.selector),
            newEvalFacet,
            "evaluatorTimeout must route to the new EvaluatorFacet"
        );
    }

    function test_RevertWhen_Rev016Upgrade_NotAtRev015() public {
        address diamond = address(deployDiamond(owner, usdc, feeRecipient, feeBps));

        vm.setEnv("FORGE_DEV_PRIVATE_KEY", vm.toString(OWNER_KEY));
        vm.setEnv("FORGE_DIAMOND_ADDRESS_TESTNET", vm.toString(diamond));
        vm.setEnv("FORGE_DIAMOND_ADDRESS_MAINNET", vm.toString(diamond));

        // Diamond is still at rev011 -- rev016 requires rev015.
        Rev016Upgrade runner = new Rev016Upgrade();
        vm.expectRevert(bytes("Rev016Upgrade: diamond is not at rev015"));
        runner.run();
    }
}
