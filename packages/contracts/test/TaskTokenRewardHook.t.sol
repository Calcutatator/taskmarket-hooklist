// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import { ITMPCore } from "../src/interfaces/ITMPCore.sol";
import { ITMPHook } from "../src/interfaces/ITMPHook.sol";
import { IPGTRForwarder } from "../src/interfaces/IPGTRForwarder.sol";
import { IERC165 } from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import { ITokenUsdOracle, PriceData } from "../src/interfaces/ITokenUsdOracle.sol";
import { TaskTokenRewardHook } from "../src/hooks/TaskTokenRewardHook.sol";
import { RewardVault } from "../src/hooks/RewardVault.sol";
import { EpochBudget } from "../src/hooks/EpochBudget.sol";
import { DiamondTestHelper } from "./helpers/DiamondTestHelper.sol";
import { ITaskMarketFull } from "./helpers/ITaskMarketFull.sol";
import "./mocks/MockUSDC.sol";

// ─────────────────────────────────────────────────────────────────────────────
// Mock oracle
// ─────────────────────────────────────────────────────────────────────────────

contract MockOracle is ITokenUsdOracle {
    PriceData public mockPrice;

    constructor(uint256 price) {
        mockPrice =
            PriceData({ price: price, twapWindow: 3600, liquidity: 1e18, updatedAt: block.timestamp, valid: true });
    }

    function getPrice() external view returns (PriceData memory) {
        return mockPrice;
    }

    function getTwapWindow() external pure returns (uint32) {
        return 3600;
    }

    function setPrice(uint256 price) external {
        mockPrice.price = price;
        mockPrice.updatedAt = block.timestamp;
    }

    function setValid(bool valid) external {
        mockPrice.valid = valid;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock relay forwarder matching the real IPGTRForwarder interface
// ─────────────────────────────────────────────────────────────────────────────

contract MockPGTRForwarder is IPGTRForwarder {
    IERC20 public usdc;
    address private _pgtrSenderValue;

    constructor(address _usdc) {
        usdc = IERC20(_usdc);
    }

    function isPGTRForwarder() external pure override returns (bool) {
        return true;
    }

    function pgtrSender() external view override returns (address) {
        return _pgtrSenderValue;
    }

    function isTrustedForwarder(address addr) external view override returns (bool) {
        return addr == address(this);
    }

    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == type(IPGTRForwarder).interfaceId || interfaceId == type(IERC165).interfaceId;
    }

    function relay(address target, address pgtrSenderAddr, uint256 paymentAmount, bytes calldata data)
        external
        returns (bytes memory)
    {
        if (paymentAmount > 0) {
            require(usdc.transfer(target, paymentAmount), "USDC transfer failed");
        }
        _pgtrSenderValue = pgtrSenderAddr;
        (bool success, bytes memory result) = target.call(data);
        _pgtrSenderValue = address(0);
        if (!success) {
            if (result.length > 0) {
                assembly { revert(add(result, 32), mload(result)) }
            }
            revert("relay failed");
        }
        return result;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Test suite
// ─────────────────────────────────────────────────────────────────────────────

contract TaskTokenRewardHookTest is DiamondTestHelper {
    // price = USDC per 1 DREAMS, 1e18 scaled. $0.10 per DREAMS => 1e17.
    uint256 constant PRICE_DREAMS_USD = 1e17;
    // $100 USDC reward = 100 * 1e6 (6 decimals)
    uint256 constant REWARD_100_USDC = 100 * 1e6;
    // expected token reward: rewardUsd * 10^(18+12) / price = 100e6 * 1e30 / 1e17 = 1000 DREAMS
    uint256 constant EXPECTED_REWARD_1000_DREAMS = 1000 * 1e18;

    uint256 constant EPOCH_DURATION = 7 days;
    uint256 constant GLOBAL_CAP = 1_000_000 * 1e18;
    uint256 constant WORKER_CAP = 100_000 * 1e18;
    uint256 constant REQUESTER_CAP = 500_000 * 1e18;
    uint256 constant MAX_PER_TASK = 10_000 * 1e18;
    uint16 constant DRIFT_BPS = 2000; // 20%

    ITaskMarketFull market;
    MockPGTRForwarder forwarder;
    MockUSDC usdc;
    MockUSDC dreamsToken;

    MockOracle oracle;
    RewardVault vault;
    EpochBudget budget;
    TaskTokenRewardHook hook;

    address owner = makeAddr("owner");
    address requester = makeAddr("requester");
    address worker = makeAddr("worker");
    address feeRecipient = makeAddr("feeRecipient");

    function setUp() public {
        vm.startPrank(owner);

        usdc = new MockUSDC();
        dreamsToken = new MockUSDC(); // 18-decimal mock for DREAMS

        market = deployDiamond(owner, address(usdc), feeRecipient, 500);

        forwarder = new MockPGTRForwarder(address(usdc));
        market.addForwarder(address(forwarder));

        oracle = new MockOracle(PRICE_DREAMS_USD);
        vault = new RewardVault(address(dreamsToken), owner);
        budget = new EpochBudget(EPOCH_DURATION, GLOBAL_CAP, WORKER_CAP, REQUESTER_CAP, MAX_PER_TASK, owner);
        hook = new TaskTokenRewardHook(
            address(oracle), address(vault), address(budget), address(market), 18, DRIFT_BPS, owner
        );

        vault.setHook(address(hook));
        budget.setHook(address(hook));

        // Fund vault with 100k DREAMS
        dreamsToken.mint(owner, 100_000 * 1e18);
        dreamsToken.transfer(address(vault), 100_000 * 1e18);

        vm.stopPrank();

        // Forwarder holds USDC on behalf of payers
        usdc.mint(address(forwarder), 10_000 * 1e6);
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    function _relay(address sender, uint256 amount, bytes memory data) internal returns (bytes memory) {
        return forwarder.relay(address(market), sender, amount, data);
    }

    function _createClaimTask() internal returns (bytes32 taskId) {
        bytes memory result = _relay(
            requester,
            REWARD_100_USDC,
            abi.encodeCall(
                market.createTask,
                (
                    REWARD_100_USDC,
                    1 days,
                    market.CLAIM(),
                    0,
                    0,
                    bytes4(0),
                    ITMPCore.HookConfig({ contracts: _hookArr(address(hook)), data: "" }),
                    ITMPCore.TaskContent({ contentHash: bytes32(0), contentURI: "", tags: new bytes32[](0) })
                )
            )
        );
        taskId = abi.decode(result, (bytes32));
    }

    function _createBountyTask() internal returns (bytes32 taskId) {
        bytes memory result = _relay(
            requester,
            REWARD_100_USDC,
            abi.encodeCall(
                market.createTask,
                (
                    REWARD_100_USDC,
                    1 days,
                    market.BOUNTY(),
                    0,
                    0,
                    bytes4(0),
                    ITMPCore.HookConfig({ contracts: _hookArr(address(hook)), data: "" }),
                    ITMPCore.TaskContent({ contentHash: bytes32(0), contentURI: "", tags: new bytes32[](0) })
                )
            )
        );
        taskId = abi.decode(result, (bytes32));
    }

    function _hookArr(address h) internal pure returns (address[] memory arr) {
        arr = new address[](1);
        arr[0] = h;
    }

    // ─── ERC-165 ──────────────────────────────────────────────────────────────

    function test_supportsInterface() public view {
        assertTrue(hook.supportsInterface(type(ITMPHook).interfaceId));
        assertTrue(hook.supportsInterface(type(IERC165).interfaceId));
        assertFalse(hook.supportsInterface(bytes4(0xdeadbeef)));
    }

    // ─── Claim mode happy path ─────────────────────────────────────────────────

    function test_claimMode_fullHappyPath() public {
        bytes32 taskId = _createClaimTask();

        // Verify state stored
        (uint256 rewardUsd,,,,, address req,, bool reserved, bool paid) = hook.rewardStates(taskId);
        assertEq(rewardUsd, REWARD_100_USDC);
        assertEq(req, requester);
        assertFalse(reserved);
        assertFalse(paid);

        // Worker claims — price locks, tokens reserved
        uint256 vaultBefore = vault.available();
        _relay(worker, 0, abi.encodeCall(market.claimTask, (taskId, 0)));

        (, uint256 startPrice,,, uint256 reservedAmt,, address lockedWorker, bool res,) = hook.rewardStates(taskId);
        assertEq(startPrice, PRICE_DREAMS_USD);
        assertEq(lockedWorker, worker);
        assertTrue(res);
        // max reserved = rewardUsd * 1e30 / minSettlePrice = 100e6 * 1e30 / (1e17 * 0.8) = 1250 DREAMS
        assertEq(reservedAmt, 1250 * 1e18);
        assertLt(vault.available(), vaultBefore);

        // Worker submits
        _relay(worker, 0, abi.encodeCall(market.submitWork, (taskId, keccak256("work"))));

        // Requester accepts — hook pays tokens. Price unchanged so effectivePrice = startPrice.
        uint256 workerDreamsBefore = dreamsToken.balanceOf(worker);
        _relay(requester, 0, abi.encodeCall(market.acceptSubmission, (taskId, worker, keccak256("work"), 0)));

        uint256 workerDreamsAfter = dreamsToken.balanceOf(worker);
        // 100e6 * 1e30 / 1e17 = 1000 DREAMS
        assertEq(workerDreamsAfter - workerDreamsBefore, EXPECTED_REWARD_1000_DREAMS);
        // Unused reserve (1250 - 1000 = 250) released back to available pool
        assertEq(vault.taskReserve(taskId), 0);

        // Verify paid flag
        (,,,,,,,, bool paid2) = hook.rewardStates(taskId);
        assertTrue(paid2);
    }

    // ─── Bounty mode (Path B) ─────────────────────────────────────────────────

    function test_bountyMode_paysAtComplete() public {
        bytes32 taskId = _createBountyTask();

        // Worker submits (no checkClaim fires)
        _relay(worker, 0, abi.encodeCall(market.submitWork, (taskId, keccak256("work"))));

        uint256 workerDreamsBefore = dreamsToken.balanceOf(worker);
        _relay(requester, 0, abi.encodeCall(market.acceptSubmission, (taskId, worker, keccak256("work"), 0)));

        assertGt(dreamsToken.balanceOf(worker), workerDreamsBefore);
    }

    // ─── Price drift clamping ─────────────────────────────────────────────────

    function test_priceDrift_clampedToFloor() public {
        bytes32 taskId = _createClaimTask();
        _relay(worker, 0, abi.encodeCall(market.claimTask, (taskId, 0)));

        // Price drops 50% — should be clamped to floor (startPrice * 0.8)
        oracle.setPrice(PRICE_DREAMS_USD / 2);

        _relay(worker, 0, abi.encodeCall(market.submitWork, (taskId, keccak256("work"))));

        uint256 before = dreamsToken.balanceOf(worker);
        _relay(requester, 0, abi.encodeCall(market.acceptSubmission, (taskId, worker, keccak256("work"), 0)));
        uint256 paid = dreamsToken.balanceOf(worker) - before;

        // At floor price (10e18 * 0.8 = 8e18): reward = 100e6 * 1e30 / 8e18 = 1250 DREAMS
        // (rather than 2000 DREAMS at the dropped price)
        assertLt(paid, 1300 * 1e18); // clamped
    }

    function test_priceDrift_clampedToCeiling() public {
        bytes32 taskId = _createClaimTask();
        _relay(worker, 0, abi.encodeCall(market.claimTask, (taskId, 0)));

        // Price rises 3x — should be clamped to ceiling (startPrice * 1.2)
        oracle.setPrice(PRICE_DREAMS_USD * 3);

        _relay(worker, 0, abi.encodeCall(market.submitWork, (taskId, keccak256("work"))));

        uint256 before = dreamsToken.balanceOf(worker);
        _relay(requester, 0, abi.encodeCall(market.acceptSubmission, (taskId, worker, keccak256("work"), 0)));
        uint256 paid = dreamsToken.balanceOf(worker) - before;

        // At ceiling price (10e18 * 1.2 = 12e18): reward = 100e6 * 1e30 / 12e18 ≈ 833 DREAMS
        assertLt(paid, 900 * 1e18);
        assertGt(paid, 800 * 1e18);
    }

    // ─── Oracle invalid ───────────────────────────────────────────────────────

    function test_oracleInvalid_blocksCheckFund() public {
        // Precompute mode + calldata so the expectRevert applies to the relay, not market.CLAIM()
        bytes memory data = abi.encodeCall(
            market.createTask,
            (
                REWARD_100_USDC,
                1 days,
                market.CLAIM(),
                0,
                0,
                bytes4(0),
                ITMPCore.HookConfig({ contracts: _hookArr(address(hook)), data: "" }),
                ITMPCore.TaskContent({ contentHash: bytes32(0), contentURI: "", tags: new bytes32[](0) })
            )
        );
        oracle.setValid(false);
        // The hook reverts with OracleInvalid inside checkFund, propagated through createTask
        vm.expectRevert();
        forwarder.relay(address(market), requester, REWARD_100_USDC, data);
    }

    function test_oracleInvalid_blocksCheckClaim() public {
        bytes32 taskId = _createClaimTask();
        oracle.setValid(false);
        vm.expectRevert();
        _relay(worker, 0, abi.encodeCall(market.claimTask, (taskId, 0)));
    }

    function test_oracleInvalid_blocksCheckComplete() public {
        bytes32 taskId = _createClaimTask();
        _relay(worker, 0, abi.encodeCall(market.claimTask, (taskId, 0)));
        _relay(worker, 0, abi.encodeCall(market.submitWork, (taskId, keccak256("work"))));
        oracle.setValid(false);
        vm.expectRevert();
        _relay(requester, 0, abi.encodeCall(market.acceptSubmission, (taskId, worker, keccak256("work"), 0)));
    }

    // ─── Worker mismatch ─────────────────────────────────────────────────────

    function test_workerMismatch_revertsAtSubmit() public {
        bytes32 taskId = _createClaimTask();
        _relay(worker, 0, abi.encodeCall(market.claimTask, (taskId, 0)));

        address wrongWorker = makeAddr("wrongWorker");
        vm.expectRevert();
        _relay(wrongWorker, 0, abi.encodeCall(market.submitWork, (taskId, keccak256("work"))));
    }

    // ─── Double payment blocked ───────────────────────────────────────────────

    function test_doublePayment_blocked() public {
        bytes32 taskId = _createClaimTask();
        _relay(worker, 0, abi.encodeCall(market.claimTask, (taskId, 0)));
        _relay(worker, 0, abi.encodeCall(market.submitWork, (taskId, keccak256("work"))));
        _relay(requester, 0, abi.encodeCall(market.acceptSubmission, (taskId, worker, keccak256("work"), 0)));

        // Direct call to checkComplete is blocked by onlyDiamond — CallerNotDiamond fires first,
        // which also prevents any double-payment path from being reached.
        ITMPCore.Verdict memory verdict;
        ITMPCore.TaskContext memory ctx;
        ctx.requester = requester;
        vm.expectRevert(abi.encodeWithSelector(TaskTokenRewardHook.CallerNotDiamond.selector));
        hook.checkComplete(taskId, ctx, verdict);
    }

    // ─── Forfeit releases reserve ─────────────────────────────────────────────

    function test_forfeit_releasesReserve() public {
        bytes32 taskId = _createClaimTask();
        _relay(worker, 0, abi.encodeCall(market.claimTask, (taskId, 0)));

        uint256 reservedBefore = vault.taskReserve(taskId);
        assertGt(reservedBefore, 0);

        // forfeitAndReopen is requester-called after expiry; releases via onForfeit
        vm.warp(block.timestamp + 2 days);
        _relay(requester, 0, abi.encodeCall(market.forfeitAndReopen, (taskId)));

        assertEq(vault.taskReserve(taskId), 0);
    }

    // ─── Cancel on unclaimed task: onCancel fires, no reserve to release ───────

    function test_cancel_noReserve_noRevert() public {
        bytes32 taskId = _createClaimTask();
        // Task is Open (unclaimed) — cancelTask fires onCancel with no reserve
        _relay(requester, 0, abi.encodeCall(market.cancelTask, (taskId, 0)));
        assertEq(vault.taskReserve(taskId), 0);
    }

    function test_expire_releasesReserve() public {
        bytes32 taskId = _createClaimTask();
        _relay(worker, 0, abi.encodeCall(market.claimTask, (taskId, 0)));

        uint256 reservedBefore = vault.taskReserve(taskId);
        assertGt(reservedBefore, 0);

        // Fast-forward past expiry
        vm.warp(block.timestamp + 2 days);
        market.refundExpired(taskId, 0);

        assertEq(vault.taskReserve(taskId), 0);
    }

    // ─── Epoch budget exceeded ────────────────────────────────────────────────

    function test_epochBudget_globalCapExceeded_revertsAtClaim() public {
        // Set tiny global cap
        vm.prank(owner);
        budget.setGlobalCap(1); // 1 wei

        bytes32 taskId = _createClaimTask();
        vm.expectRevert();
        _relay(worker, 0, abi.encodeCall(market.claimTask, (taskId, 0)));
    }

    // ─── Epoch rollover resets per-account usage ──────────────────────────────

    function test_epochRollover_resetsUsage() public {
        // Complete one task — consumes worker/requester/global budget
        bytes32 taskId = _createClaimTask();
        _relay(worker, 0, abi.encodeCall(market.claimTask, (taskId, 0)));
        _relay(worker, 0, abi.encodeCall(market.submitWork, (taskId, keccak256("w"))));
        _relay(requester, 0, abi.encodeCall(market.acceptSubmission, (taskId, worker, keccak256("w"), 0)));

        assertGt(budget.workerUsed(worker), 0);

        // Advance past the epoch boundary
        vm.warp(block.timestamp + EPOCH_DURATION + 1);

        // Usage should now read as zero in the new epoch
        assertEq(budget.workerUsed(worker), 0);
        assertEq(budget.requesterUsed(requester), 0);
        assertEq(budget.globalUsed(), 0);
        assertEq(budget.remaining(requester, worker), MAX_PER_TASK);
    }

    // ─── Vault insufficient ───────────────────────────────────────────────────

    function test_vaultInsufficient_revertsAtClaim() public {
        // Drain vault (compute available() before prank so it doesn't consume it)
        uint256 avail = vault.available();
        vm.prank(owner);
        vault.withdraw(owner, avail);

        bytes32 taskId = _createClaimTask();
        vm.expectRevert();
        _relay(worker, 0, abi.encodeCall(market.claimTask, (taskId, 0)));
    }

    function test_vaultInsufficient_bounty_revertsAtComplete() public {
        bytes32 taskId = _createBountyTask();
        _relay(worker, 0, abi.encodeCall(market.submitWork, (taskId, keccak256("work"))));

        uint256 avail = vault.available();
        vm.prank(owner);
        vault.withdraw(owner, avail);

        vm.expectRevert();
        _relay(requester, 0, abi.encodeCall(market.acceptSubmission, (taskId, worker, keccak256("work"), 0)));
    }
}
