// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {IDiamondLoupe} from "@taskmarket/contracts/src/interfaces/IDiamondLoupe.sol";
import {ITMPDiamond} from "@taskmarket/contracts/src/interfaces/ITMPDiamond.sol";
import {AffiliateSidecarEscrowHook} from "../src/AffiliateSidecarEscrowHook.sol";

interface IRevisionedTaskmarket {
    function diamondVersion() external view returns (uint256);
}

contract Deploy is Script {
    uint256 internal constant BASE_SEPOLIA_CHAIN_ID = 84532;
    uint256 internal constant REQUIRED_DIAMOND_REVISION = 20;

    // The Taskmarket address is fixed at scaffold time and guarded below before any broadcast starts.
    address constant TASKMARKET = 0x0A24E9c3b9E31B8258329e187470ACc16497Cec7;
    // Circle's canonical USDC contract on Base Sepolia. Taskmarket's payment-token getter must match it.
    address constant BASE_SEPOLIA_USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    error Deploy__DiamondLoupeCheckFailed(address taskmarket, bytes4 selector);
    error Deploy__DiamondRevisionCheckFailed(address taskmarket);
    error Deploy__MissingFacetCode(bytes4 selector, address facet);
    error Deploy__MissingPaymentTokenCode(address paymentToken);
    error Deploy__MissingRequiredSelector(bytes4 selector);
    error Deploy__MissingTaskmarketCode(address taskmarket);
    error Deploy__PaymentTokenCheckFailed(address taskmarket);
    error Deploy__UnexpectedChain(uint256 actualChainId, uint256 expectedChainId);
    error Deploy__UnexpectedDiamondRevision(uint256 actualRevision, uint256 expectedRevision);
    error Deploy__UnexpectedPaymentToken(address actualPaymentToken, address expectedPaymentToken);

    function run() external returns (AffiliateSidecarEscrowHook hook) {
        _preflight();

        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
        hook = new AffiliateSidecarEscrowHook(TASKMARKET);
        vm.stopBroadcast();
    }

    function _preflight() private view {
        if (block.chainid != BASE_SEPOLIA_CHAIN_ID) {
            revert Deploy__UnexpectedChain(block.chainid, BASE_SEPOLIA_CHAIN_ID);
        }
        if (TASKMARKET.code.length == 0) revert Deploy__MissingTaskmarketCode(TASKMARKET);

        uint256 revision;
        try IRevisionedTaskmarket(TASKMARKET).diamondVersion() returns (uint256 actualRevision) {
            revision = actualRevision;
        } catch {
            revert Deploy__DiamondRevisionCheckFailed(TASKMARKET);
        }
        if (revision != REQUIRED_DIAMOND_REVISION) {
            revert Deploy__UnexpectedDiamondRevision(revision, REQUIRED_DIAMOND_REVISION);
        }

        _checkRequiredSelectors();
        _checkPaymentToken();
    }

    /// @dev Checks only the externally callable surface this hook directly relies on. It intentionally
    ///      does not pin facet addresses or bytecode: either can change during a reviewed Diamond upgrade.
    function _checkRequiredSelectors() private view {
        _requireSelector(IDiamondLoupe.facetAddress.selector);
        _requireSelector(IRevisionedTaskmarket.diamondVersion.selector);
        _requireSelector(ITMPDiamond.usdcToken.selector);
        _requireSelector(ITMPDiamond.getTask.selector);
        _requireSelector(ITMPDiamond.getTaskContext.selector);
        _requireSelector(ITMPDiamond.getTaskMetadata.selector);
        _requireSelector(ITMPDiamond.getTaskEvaluatorConfig.selector);
        _requireSelector(ITMPDiamond.getTaskAuctionConfig.selector);
        _requireSelector(ITMPDiamond.getTaskPitchConfig.selector);
        _requireSelector(ITMPDiamond.getTaskHooks.selector);
    }

    function _requireSelector(bytes4 selector) private view {
        address facet;
        try IDiamondLoupe(TASKMARKET).facetAddress(selector) returns (address actualFacet) {
            facet = actualFacet;
        } catch {
            revert Deploy__DiamondLoupeCheckFailed(TASKMARKET, selector);
        }

        if (facet == address(0)) revert Deploy__MissingRequiredSelector(selector);
        if (facet.code.length == 0) revert Deploy__MissingFacetCode(selector, facet);
    }

    function _checkPaymentToken() private view {
        address paymentToken;
        try ITMPDiamond(TASKMARKET).usdcToken() returns (address actualPaymentToken) {
            paymentToken = actualPaymentToken;
        } catch {
            revert Deploy__PaymentTokenCheckFailed(TASKMARKET);
        }

        if (paymentToken != BASE_SEPOLIA_USDC) {
            revert Deploy__UnexpectedPaymentToken(paymentToken, BASE_SEPOLIA_USDC);
        }
        if (paymentToken.code.length == 0) revert Deploy__MissingPaymentTokenCode(paymentToken);
    }
}
