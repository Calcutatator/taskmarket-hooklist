// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {AffiliateSidecarEscrowHook} from "../src/AffiliateSidecarEscrowHook.sol";

interface IRevisionedTaskmarket {
    function diamondVersion() external view returns (uint256);
}

contract Deploy is Script {
    uint256 internal constant BASE_SEPOLIA_CHAIN_ID = 84532;
    uint256 internal constant REQUIRED_DIAMOND_REVISION = 20;

    // The Taskmarket address is fixed at scaffold time and guarded below before any broadcast starts.
    address constant TASKMARKET = 0x0A24E9c3b9E31B8258329e187470ACc16497Cec7;

    error Deploy__DiamondRevisionCheckFailed(address taskmarket);
    error Deploy__MissingTaskmarketCode(address taskmarket);
    error Deploy__UnexpectedChain(uint256 actualChainId, uint256 expectedChainId);
    error Deploy__UnexpectedDiamondRevision(uint256 actualRevision, uint256 expectedRevision);

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
    }
}
