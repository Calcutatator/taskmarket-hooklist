// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/TaskMarket.sol";

contract DeployScript is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address usdcToken = vm.envAddress("USDC_TOKEN_ADDRESS");

        vm.startBroadcast(deployerPrivateKey);

        TaskMarket taskMarket = new TaskMarket(usdcToken);

        console.log("TaskMarket deployed to:", address(taskMarket));
        console.log("USDC Token:", usdcToken);

        vm.stopBroadcast();
    }
}
