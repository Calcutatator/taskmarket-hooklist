// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/TaskMarket.sol";

contract DeployScript is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("FORGE_DEV_PRIVATE_KEY");
        address usdcToken = vm.envAddress("FORGE_USDC_TOKEN_ADDRESS");
        address feeRecipient = vm.envAddress("FORGE_FEE_RECIPIENT_ADDRESS");
        uint16 defaultFeeBps = uint16(vm.envUint("FORGE_DEFAULT_PLATFORM_FEE_BPS"));
        address reputationRegistry = vm.envAddress("FORGE_ERC8004_REPUTATION_REGISTRY");
        address serverAddress = vm.envAddress("FORGE_SERVER_ADDRESS");

        vm.startBroadcast(deployerPrivateKey);

        TaskMarket taskMarket = new TaskMarket(usdcToken, feeRecipient, defaultFeeBps);
        taskMarket.setAuthorizedServer(serverAddress);
        taskMarket.setReputationRegistry(reputationRegistry);

        console.log("TaskMarket deployed to:", address(taskMarket));
        console.log("USDC Token:", usdcToken);
        console.log("Fee Recipient:", feeRecipient);
        console.log("Default Fee BPS:", defaultFeeBps);
        console.log("Reputation registry:", reputationRegistry);
        console.log("Authorized server:", serverAddress);

        vm.stopBroadcast();
    }
}
