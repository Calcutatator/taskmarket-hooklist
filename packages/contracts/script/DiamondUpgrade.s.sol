// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IDiamondCut} from "../src/interfaces/IDiamondCut.sol";
import {DiamondCutFacet} from "../src/facets/DiamondCutFacet.sol";
import {DiamondLoupeFacet} from "../src/facets/DiamondLoupeFacet.sol";
import {AdminFacet} from "../src/facets/AdminFacet.sol";
import {CoreFacet} from "../src/facets/CoreFacet.sol";
import {AuctionFacet} from "../src/facets/AuctionFacet.sol";
import {AcceptanceFacet} from "../src/facets/AcceptanceFacet.sol";
import {EvaluatorFacet} from "../src/facets/EvaluatorFacet.sol";
import {RatingFacet} from "../src/facets/RatingFacet.sol";
import {RegistryFacet} from "../src/facets/RegistryFacet.sol";

/// @title DiamondUpgrade — replace one or more facets in the Diamond
/// @dev Required env vars:
///      FORGE_DEV_PRIVATE_KEY  — owner key (must match Diamond owner)
///      DIAMOND_ADDRESS        — deployed Diamond proxy address
///      FACET_NAME             — which facet to upgrade (e.g. "CoreFacet")
///
///      Example usage:
///        FACET_NAME=CoreFacet forge script script/DiamondUpgrade.s.sol \
///          --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast --verify
contract DiamondUpgrade is Script {
    function run() external {
        uint256 ownerKey       = vm.envUint("FORGE_DEV_PRIVATE_KEY");
        address diamondAddress = vm.envAddress("DIAMOND_ADDRESS");
        string memory facetName = vm.envString("FACET_NAME");

        vm.startBroadcast(ownerKey);

        (address newImpl, bytes4[] memory selectors) = _deployFacet(facetName);
        require(newImpl != address(0), "Unknown facet name");

        IDiamondCut.FacetCut[] memory cuts = new IDiamondCut.FacetCut[](1);
        cuts[0] = IDiamondCut.FacetCut(newImpl, IDiamondCut.FacetCutAction.Replace, selectors);

        IDiamondCut(diamondAddress).diamondCut(cuts, address(0), "");

        vm.stopBroadcast();

        console.log("Upgraded %s at %s on Diamond %s", facetName, newImpl, diamondAddress);
    }

    function _deployFacet(string memory name) internal returns (address impl, bytes4[] memory selectors) {
        if (keccak256(bytes(name)) == keccak256("DiamondCutFacet")) {
            impl = address(new DiamondCutFacet());
            selectors = new bytes4[](1);
            selectors[0] = DiamondCutFacet.diamondCut.selector;
        } else if (keccak256(bytes(name)) == keccak256("DiamondLoupeFacet")) {
            impl = address(new DiamondLoupeFacet());
            selectors = new bytes4[](5);
            selectors[0] = DiamondLoupeFacet.facets.selector;
            selectors[1] = DiamondLoupeFacet.facetFunctionSelectors.selector;
            selectors[2] = DiamondLoupeFacet.facetAddresses.selector;
            selectors[3] = DiamondLoupeFacet.facetAddress.selector;
            selectors[4] = DiamondLoupeFacet.supportsInterface.selector;
        } else if (keccak256(bytes(name)) == keccak256("AdminFacet")) {
            impl = address(new AdminFacet());
            selectors = new bytes4[](13);
            selectors[0]  = AdminFacet.paused.selector;
            selectors[1]  = AdminFacet.pause.selector;
            selectors[2]  = AdminFacet.unpause.selector;
            selectors[3]  = AdminFacet.transferOwnership.selector;
            selectors[4]  = AdminFacet.acceptOwnership.selector;
            selectors[5]  = AdminFacet.owner.selector;
            selectors[6]  = AdminFacet.pendingOwner.selector;
            selectors[7]  = AdminFacet.addForwarder.selector;
            selectors[8]  = AdminFacet.removeForwarder.selector;
            selectors[9]  = AdminFacet.isTrustedForwarder.selector;
            selectors[10] = AdminFacet.setDefaultFeeBps.selector;
            selectors[11] = AdminFacet.setFeeRecipient.selector;
            selectors[12] = AdminFacet.setReputationRegistry.selector;
        } else if (keccak256(bytes(name)) == keccak256("CoreFacet")) {
            impl = address(new CoreFacet());
            selectors = new bytes4[](20);
            selectors[0]  = bytes4(keccak256("BOUNTY()"));
            selectors[1]  = bytes4(keccak256("CLAIM()"));
            selectors[2]  = bytes4(keccak256("PITCH()"));
            selectors[3]  = bytes4(keccak256("BENCHMARK()"));
            selectors[4]  = bytes4(keccak256("AUCTION()"));
            selectors[5]  = bytes4(keccak256("AUCTION_DUTCH()"));
            selectors[6]  = bytes4(keccak256("AUCTION_ENGLISH()"));
            selectors[7]  = bytes4(keccak256("AUCTION_REVERSE_DUTCH()"));
            selectors[8]  = bytes4(keccak256("AUCTION_REVERSE_ENGLISH()"));
            selectors[9]  = bytes4(keccak256("MAX_BIDS_PER_TASK()"));
            selectors[10] = CoreFacet.createTask.selector;
            selectors[11] = CoreFacet.claimTask.selector;
            selectors[12] = CoreFacet.selectWorker.selector;
            selectors[13] = CoreFacet.submitPitch.selector;
            selectors[14] = CoreFacet.submitProof.selector;
            selectors[15] = CoreFacet.submitWork.selector;
            selectors[16] = CoreFacet.forfeitAndReopen.selector;
            selectors[17] = CoreFacet.cancelTask.selector;
            selectors[18] = CoreFacet.updateTask.selector;
            selectors[19] = CoreFacet.refundExpired.selector;
        } else if (keccak256(bytes(name)) == keccak256("AuctionFacet")) {
            impl = address(new AuctionFacet());
            selectors = new bytes4[](3);
            selectors[0] = AuctionFacet.submitBid.selector;
            selectors[1] = AuctionFacet.selectLowestBidder.selector;
            selectors[2] = AuctionFacet.acceptAuction.selector;
        } else if (keccak256(bytes(name)) == keccak256("AcceptanceFacet")) {
            impl = address(new AcceptanceFacet());
            selectors = new bytes4[](2);
            selectors[0] = AcceptanceFacet.acceptSubmission.selector;
            selectors[1] = AcceptanceFacet.acceptSubmissions.selector;
        } else if (keccak256(bytes(name)) == keccak256("EvaluatorFacet")) {
            impl = address(new EvaluatorFacet());
            selectors = new bytes4[](6);
            selectors[0] = EvaluatorFacet.assignEvaluator.selector;
            selectors[1] = EvaluatorFacet.evaluate.selector;
            selectors[2] = EvaluatorFacet.appeal.selector;
            selectors[3] = EvaluatorFacet.finalizeVerdict.selector;
            selectors[4] = EvaluatorFacet.resolveDispute.selector;
            selectors[5] = EvaluatorFacet.evaluatorTimeout.selector;
        } else if (keccak256(bytes(name)) == keccak256("RatingFacet")) {
            impl = address(new RatingFacet());
            selectors = new bytes4[](3);
            selectors[0] = RatingFacet.rateTask.selector;
            selectors[1] = RatingFacet.getCredibility.selector;
            selectors[2] = RatingFacet.getAverageRating.selector;
        } else if (keccak256(bytes(name)) == keccak256("RegistryFacet")) {
            impl = address(new RegistryFacet());
            selectors = new bytes4[](21);
            selectors[0]  = RegistryFacet.getTask.selector;
            selectors[1]  = RegistryFacet.getWorkerStats.selector;
            selectors[2]  = RegistryFacet.requesterNonce.selector;
            selectors[3]  = RegistryFacet.getTaskState.selector;
            selectors[4]  = RegistryFacet.getTaskContext.selector;
            selectors[5]  = RegistryFacet.getTaskVerdict.selector;
            selectors[6]  = RegistryFacet.evaluatorFor.selector;
            selectors[7]  = RegistryFacet.taskMode.selector;
            selectors[8]  = RegistryFacet.defaultFeeBps.selector;
            selectors[9]  = RegistryFacet.feeRecipient.selector;
            selectors[10] = RegistryFacet.totalFeesCollected.selector;
            selectors[11] = RegistryFacet.feeForTask.selector;
            selectors[12] = RegistryFacet.reputationRegistry.selector;
            selectors[13] = RegistryFacet.getTaskEvaluatorConfig.selector;
            selectors[14] = RegistryFacet.getTaskAuctionConfig.selector;
            selectors[15] = RegistryFacet.getTaskMetadata.selector;
            selectors[16] = RegistryFacet.getTaskPitchConfig.selector;
            selectors[17] = RegistryFacet.getBids.selector;
            selectors[18] = RegistryFacet.usdcToken.selector;
            selectors[19] = RegistryFacet.taskPitchHashes.selector;
            selectors[20] = RegistryFacet.taskProofHashes.selector;
        }
    }
}
