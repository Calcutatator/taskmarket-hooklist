// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/TaskMarket.sol";

contract DeployScript is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address usdcToken = vm.envAddress("USDC_TOKEN_ADDRESS");
        address feeRecipient = vm.envAddress("FEE_RECIPIENT_ADDRESS");
        uint16 defaultFeeBps = uint16(vm.envUint("DEFAULT_PLATFORM_FEE_BPS"));

        vm.startBroadcast(deployerPrivateKey);

        TaskMarket taskMarket = new TaskMarket(usdcToken, feeRecipient, defaultFeeBps);

        console.log("TaskMarket deployed to:", address(taskMarket));
        console.log("USDC Token:", usdcToken);
        console.log("Fee Recipient:", feeRecipient);
        console.log("Default Fee BPS:", defaultFeeBps);

        vm.stopBroadcast();
    }
}
