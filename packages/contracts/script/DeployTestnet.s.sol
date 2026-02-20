// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/TaskMarket.sol";

contract DeployTestnet is Script {
    address constant CIRCLE_USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEV_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        uint16 feeBps = uint16(vm.envUint("DEFAULT_PLATFORM_FEE_BPS"));

        // Derive server address from SERVER_PRIVATE_KEY
        uint256 serverPrivateKey = vm.envUint("SERVER_PRIVATE_KEY");
        address serverAddress = vm.addr(serverPrivateKey);

        vm.startBroadcast(deployerPrivateKey);
        TaskMarket taskMarket = new TaskMarket(CIRCLE_USDC, deployer, feeBps);
        taskMarket.setAuthorizedServer(serverAddress);
        vm.stopBroadcast();

        console.log("TaskMarket deployed to:", address(taskMarket));
        console.log("USDC:", CIRCLE_USDC);
        console.log("Authorized server:", serverAddress);
    }
}
