// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import { IDiamondLoupe } from "../src/interfaces/IDiamondLoupe.sol";
import { AdminFacet } from "../src/facets/AdminFacet.sol";
import { CoreFacet } from "../src/facets/CoreFacet.sol";
import { FacetSelectors } from "../script/lib/FacetSelectors.sol";
import { Rev012Upgrade } from "../script/upgrades/Rev012Upgrade.s.sol";
import { Rev013Upgrade } from "../script/upgrades/Rev013Upgrade.s.sol";
import { Rev015Upgrade } from "../script/upgrades/Rev015Upgrade.s.sol";
import { Rev016Upgrade } from "../script/upgrades/Rev016Upgrade.s.sol";
import { DiamondTestHelper } from "./helpers/DiamondTestHelper.sol";

/// @title Rev016UpgradeTest
/// @dev Deploys a diamond at rev011 (the test helper's baseline), advances through
///      rev012/013/014/015 to reach rev016's precondition, applies the rev016 upgrade step, and
///      asserts diamondVersion bumps to 16 and CoreFacet is replaced with a new implementation
///      while every one of its selectors still routes. Rev016 changes no parameter list, so the
///      selector set must come through the cut identical -- that is the property under test, and
///      a Replace that silently dropped or misrouted a selector is exactly the failure mode a
///      pure-Replace step can have.
contract Rev016UpgradeTest is Test, DiamondTestHelper {
    uint256 internal constant OWNER_KEY = 0xA11CE;
    address internal owner;
    address internal usdc = address(0xACDC);
    address internal feeRecipient = address(0xFEE0);
    uint16 internal feeBps = 500;

    function setUp() public {
        owner = vm.addr(OWNER_KEY);
    }

    function _advanceToRev015(address diamond) internal {
        vm.setEnv("FORGE_DEV_PRIVATE_KEY", vm.toString(OWNER_KEY));
        vm.setEnv("FORGE_DIAMOND_ADDRESS_TESTNET", vm.toString(diamond));
        vm.setEnv("FORGE_DIAMOND_ADDRESS_MAINNET", vm.toString(diamond));
        new Rev012Upgrade().run();
        new Rev013Upgrade().run();
        // Rev014Upgrade cannot run here for the reason Rev015UpgradeTest documents: it Removes
        // the pre-rev014 createTask selector, but a fresh test diamond is already built from
        // FacetSelectors and therefore already carries the current one. Only the counter needs
        // to catch up.
        vm.prank(owner);
        AdminFacet(diamond).setDiamondVersion(14);
        new Rev015Upgrade().run();
    }

    function test_Rev016Upgrade_BumpsVersionAndReplacesCoreFacet() public {
        address diamond = address(deployDiamond(owner, usdc, feeRecipient, feeBps));
        _advanceToRev015(diamond);
        assertEq(AdminFacet(diamond).diamondVersion(), 15, "must be at rev015 before rev016");

        address oldCoreFacet = IDiamondLoupe(diamond).facetAddress(CoreFacet.refundExpired.selector);

        new Rev016Upgrade().run();

        assertEq(AdminFacet(diamond).diamondVersion(), 16, "diamondVersion must be 16 after rev016 upgrade");

        address newCoreFacet = IDiamondLoupe(diamond).facetAddress(CoreFacet.refundExpired.selector);
        assertTrue(newCoreFacet != oldCoreFacet, "CoreFacet must be replaced");

        // No signature changed, so every selector in the single source of truth must still route,
        // and all of them to the one new facet. Checked exhaustively rather than by sample: the
        // whole risk of a pure Replace is one entry going missing from the list.
        bytes4[] memory selectors = FacetSelectors.coreFacetSelectors();
        for (uint256 i; i < selectors.length; i++) {
            assertEq(
                IDiamondLoupe(diamond).facetAddress(selectors[i]),
                newCoreFacet,
                "every CoreFacet selector must route to the replaced facet"
            );
        }
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
