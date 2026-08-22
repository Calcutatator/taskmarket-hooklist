#!/usr/bin/env node
import { mkdir, writeFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

const usage = `Usage: create-taskmarket-hook <project-name> --taskmarket <0x-address> [--hook-name <SolidityName>]

Example:
  npx create-taskmarket-hook my-hook --taskmarket 0x1111111111111111111111111111111111111111 --hook-name MyHook`;

function fail(message) {
  console.error(`Error: ${message}\n\n${usage}`);
  process.exitCode = 1;
}

function parseArgs(args) {
  const [projectName, ...rest] = args;
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (!flag?.startsWith("--") || !value || options[flag])
      throw new Error("invalid arguments");
    if (flag !== "--taskmarket" && flag !== "--hook-name")
      throw new Error(`unknown option: ${flag}`);
    options[flag] = value;
  }
  return {
    projectName,
    taskmarket: options["--taskmarket"],
    hookName: options["--hook-name"],
  };
}

function solidityName(projectName) {
  return (
    projectName
      .split("-")
      .map((part) => part[0].toUpperCase() + part.slice(1))
      .join("") + "Hook"
  );
}

const dependencies = {
  taskmarket:
    "daydreamsai/taskmarket-contracts@657b9f74478bdf71c3c1b5e0d2dde7197aba56cb",
  openzeppelin:
    "OpenZeppelin/openzeppelin-contracts@fcbae5394ae8ad52d8e580a3477db99814b9d565",
  forgeStd: "foundry-rs/forge-std@1801b0541f4fda118a10798fd3486bb7051c5dd6",
};

const installCommands = [
  `forge install --no-git ${dependencies.taskmarket}`,
  `forge install --no-git ${dependencies.openzeppelin}`,
  `forge install --no-git ${dependencies.forgeStd}`,
];

function render(files, values) {
  return Object.fromEntries(
    Object.entries(files).map(([file, contents]) => [
      file
        .replaceAll("{{PROJECT_NAME}}", values.projectName)
        .replaceAll("{{HOOK_NAME}}", values.hookName),
      contents
        .replaceAll("{{PROJECT_NAME}}", values.projectName)
        .replaceAll("{{HOOK_NAME}}", values.hookName)
        .replaceAll("{{TASKMARKET_HEX}}", values.taskmarket.slice(2))
        .replaceAll("{{TASKMARKET_ADDRESS}}", values.taskmarket),
    ]),
  );
}

const template = {
  "foundry.toml": `[profile.default]
src = "src"
test = "test"
script = "script"
out = "out"
libs = ["lib"]
solc_version = "0.8.24"
optimizer = true
optimizer_runs = 200
via_ir = true

[rpc_endpoints]
base_sepolia = "\${FORGE_BASE_SEPOLIA_RPC_URL}"

[etherscan]
base_sepolia = { key = "\${FORGE_ETHERSCAN_API_KEY}", chain = 84532, url = "https://api.etherscan.io/v2/api?chainid=84532" }
`,
  "remappings.txt": `@taskmarket/contracts/=lib/taskmarket-contracts/
@openzeppelin/=lib/openzeppelin-contracts/
forge-std/=lib/forge-std/src/
`,
  ".env.example": `# A Base Sepolia RPC endpoint and the private key that will deploy the hook.
FORGE_BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
PRIVATE_KEY=
# Used by forge script --verify. Obtain one from Basescan/Etherscan.
FORGE_ETHERSCAN_API_KEY=
`,
  ".gitignore": `.env
out/
cache/
broadcast/
lib/
`,
  "src/{{HOOK_NAME}}.sol": `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {ITMPCore} from "@taskmarket/contracts/src/interfaces/ITMPCore.sol";
import {ITMPHook} from "@taskmarket/contracts/src/interfaces/ITMPHook.sol";

/// @notice A safe starting point for Taskmarket lifecycle hooks.
/// @dev Every callback is restricted to the configured Taskmarket Diamond. Keep check hooks
///      deterministic: returning false or reverting blocks the corresponding lifecycle action.
contract {{HOOK_NAME}} is ITMPHook {
    error UnauthorizedTaskmarket(address caller);

    address public immutable taskmarket;

    event TaskCompleted(bytes32 indexed taskId, address indexed requester);

    constructor(address taskmarket_) {
        require(taskmarket_ != address(0), "taskmarket is zero");
        taskmarket = taskmarket_;
    }

    modifier onlyTaskmarket() {
        if (msg.sender != taskmarket) revert UnauthorizedTaskmarket(msg.sender);
        _;
    }

    function checkFund(bytes32, ITMPCore.TaskContext calldata, bytes calldata) external onlyTaskmarket returns (bool) {
        return true;
    }

    function checkClaim(bytes32, ITMPCore.TaskContext calldata, address) external onlyTaskmarket returns (bool) {
        return true;
    }

    function checkSelectWorker(bytes32, ITMPCore.TaskContext calldata, address)
        external
        onlyTaskmarket
        returns (bool)
    {
        return true;
    }

    function checkSubmit(bytes32, ITMPCore.TaskContext calldata, address, bytes32)
        external
        onlyTaskmarket
        returns (bool)
    {
        return true;
    }

    function checkEvaluate(bytes32, ITMPCore.TaskContext calldata, address) external onlyTaskmarket returns (bool) {
        return true;
    }

    // Example override: add your completion policy here. Revert or return false to reject.
    function checkComplete(bytes32, ITMPCore.TaskContext calldata, ITMPCore.Verdict calldata)
        external
        onlyTaskmarket
        returns (bool)
    {
        return true;
    }

    function onComplete(bytes32 taskId, ITMPCore.TaskContext calldata ctx, ITMPCore.Verdict calldata)
        external
        onlyTaskmarket
    {
        emit TaskCompleted(taskId, ctx.requester);
    }

    function onForfeit(bytes32, ITMPCore.TaskContext calldata, address) external onlyTaskmarket {}
    function onCancel(bytes32, ITMPCore.TaskContext calldata) external onlyTaskmarket {}
    function onExpire(bytes32, ITMPCore.TaskContext calldata) external onlyTaskmarket {}

    function supportsInterface(bytes4 interfaceId) public pure virtual returns (bool) {
        return interfaceId == type(ITMPHook).interfaceId || interfaceId == type(IERC165).interfaceId;
    }
}
`,
  "script/Deploy.s.sol": `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {{{HOOK_NAME}}} from "../src/{{HOOK_NAME}}.sol";

contract Deploy is Script {
    // The Taskmarket address is fixed at scaffold time; update only after verifying the target deployment.
    address constant TASKMARKET = address(bytes20(hex"{{TASKMARKET_HEX}}"));

    function run() external returns ({{HOOK_NAME}} hook) {
        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
        hook = new {{HOOK_NAME}}(TASKMARKET);
        vm.stopBroadcast();
    }
}
`,
  "test/{{HOOK_NAME}}.t.sol": `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ITMPCore} from "@taskmarket/contracts/src/interfaces/ITMPCore.sol";
import {{{HOOK_NAME}}} from "../src/{{HOOK_NAME}}.sol";

contract {{HOOK_NAME}}Test is Test {
    address constant TASKMARKET = address(bytes20(hex"{{TASKMARKET_HEX}}"));
    {{HOOK_NAME}} hook;

    function setUp() public {
        hook = new {{HOOK_NAME}}(TASKMARKET);
    }

    function testCheckClaimAcceptsConfiguredTaskmarket() public {
        vm.prank(TASKMARKET);
        assertTrue(hook.checkClaim(bytes32(0), _context(), address(0xBEEF)));
    }

    function testCheckClaimRejectsEveryoneElse() public {
        vm.expectRevert(abi.encodeWithSelector({{HOOK_NAME}}.UnauthorizedTaskmarket.selector, address(this)));
        hook.checkClaim(bytes32(0), _context(), address(0xBEEF));
    }

    function _context() internal pure returns (ITMPCore.TaskContext memory ctx) {}
}
`,
  "README.md": `# {{PROJECT_NAME}}

A Taskmarket lifecycle-hook project generated by \`create-taskmarket-hook\`.

The starter hook accepts calls **only** from the Taskmarket deployment configured at generation time: \`{{TASKMARKET_ADDRESS}}\`. Its check callbacks currently allow lifecycle actions and \`onComplete\` emits an event. Extend the marked \`checkComplete\` override (or another callback) with your policy; a false return or revert rejects that transition.

## Install

Prerequisites: Node.js 18+, [Foundry](https://book.getfoundry.sh/getting-started/installation), and Git.

\`\`\`sh
${installCommands.join("\n")}
cp .env.example .env
\`\`\`

## Build and test

\`\`\`sh
forge build
forge test -j 1
\`\`\`

## Deploy and verify on Base Sepolia

Set \`PRIVATE_KEY\`, \`FORGE_BASE_SEPOLIA_RPC_URL\`, and \`FORGE_ETHERSCAN_API_KEY\` in \`.env\`. Confirm that the configured Taskmarket address is the Base Sepolia deployment you intend to use before broadcasting.

\`\`\`sh
set -a
source .env
set +a
forge script script/Deploy.s.sol:Deploy --rpc-url base_sepolia --broadcast --verify
\`\`\`

Register the deployed hook when creating a Taskmarket task. Hooks are immutable per task, and check callbacks can block task state transitions, so test your policy thoroughly before using it in production.
`,
};

async function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch {
    return fail("arguments must be flag/value pairs");
  }
  const {
    projectName,
    taskmarket,
    hookName = projectName && solidityName(projectName),
  } = parsed;
  if (!projectName || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(projectName))
    return fail("project name must be lowercase kebab-case");
  if (
    !taskmarket ||
    !/^0x[0-9a-fA-F]{40}$/.test(taskmarket) ||
    /^0x0{40}$/i.test(taskmarket)
  )
    return fail("--taskmarket must be a non-zero 20-byte address");
  if (!/^[A-Z][A-Za-z0-9]*Hook$/.test(hookName))
    return fail("--hook-name must be a PascalCase name ending in Hook");

  const target = path.resolve(process.cwd(), projectName);
  try {
    await access(target, constants.F_OK);
    return fail(`target already exists: ${target}`);
  } catch {
    /* expected */
  }
  const files = render(template, {
    projectName,
    taskmarket: taskmarket.toLowerCase(),
    hookName,
  });
  await mkdir(target, { recursive: false });
  await Promise.all(
    Object.entries(files).map(async ([file, contents]) => {
      const destination = path.join(target, file);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, contents);
    }),
  );
  console.log(
    `Created ${target}\n\nNext:\n  cd ${projectName}\n  ${installCommands.join("\n  ")}\n  forge test -j 1`,
  );
}

main().catch((error) => fail(error.message));
