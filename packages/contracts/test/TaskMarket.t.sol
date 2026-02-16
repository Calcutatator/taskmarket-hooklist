// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/TaskMarket.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {
        _mint(msg.sender, 1000000 * 10 ** 6);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}

contract TaskMarketTest is Test {
    TaskMarket public market;
    MockERC20 public usdc;

    address public owner = address(1);
    address public feeRecipient = address(2);
    address public requester = address(3);
    address public worker1 = address(4);
    address public worker2 = address(5);

    uint16 public defaultFeeBps = 500;

    bytes32 public constant TASK_ID_1 = keccak256("task1");
    bytes32 public constant TASK_ID_2 = keccak256("task2");
    bytes32 public constant TASK_ID_3 = keccak256("task3");
    bytes32 public constant TASK_ID_4 = keccak256("task4");

    uint256 public constant REWARD = 100 * 10 ** 6;
    uint256 public constant DURATION = 7 days;

    function setUp() public {
        vm.startPrank(owner);
        usdc = new MockERC20();
        market = new TaskMarket(address(usdc), feeRecipient, defaultFeeBps);
        vm.stopPrank();

        usdc.mint(requester, 10000 * 10 ** 6);
        usdc.mint(worker1, 1000 * 10 ** 6);
        usdc.mint(worker2, 1000 * 10 ** 6);
    }

    function test_Constructor() public view {
        assertEq(address(market.usdcToken()), address(usdc));
        assertEq(market.feeRecipient(), feeRecipient);
        assertEq(market.defaultFeeBps(), defaultFeeBps);
    }

    function test_CreateTask_Contest() public {
        vm.startPrank(requester);
        usdc.approve(address(market), REWARD);

        vm.expectEmit(true, true, false, true);
        emit TaskMarket.TaskCreated(TASK_ID_1, requester, REWARD, block.timestamp + DURATION, TaskMarket.TaskMode.Contest);

        market.createTask(TASK_ID_1, REWARD, DURATION, TaskMarket.TaskMode.Contest, 0);
        vm.stopPrank();

        TaskMarket.Task memory task = market.getTask(TASK_ID_1);
        assertEq(task.requester, requester);
        assertEq(task.reward, REWARD);
        assertEq(uint256(task.mode), uint256(TaskMarket.TaskMode.Contest));
        assertEq(uint256(task.status), uint256(TaskMarket.TaskStatus.Open));
    }

    function test_AcceptSubmission_Contest() public {
        vm.startPrank(requester);
        usdc.approve(address(market), REWARD);
        market.createTask(TASK_ID_1, REWARD, DURATION, TaskMarket.TaskMode.Contest, 0);
        vm.stopPrank();

        uint256 expectedFee = (REWARD * defaultFeeBps) / 10000;
        uint256 expectedWorkerPayment = REWARD - expectedFee;

        uint256 workerBalanceBefore = usdc.balanceOf(worker1);
        uint256 feeRecipientBalanceBefore = usdc.balanceOf(feeRecipient);

        vm.prank(requester);
        market.acceptSubmission(TASK_ID_1, worker1);

        assertEq(usdc.balanceOf(worker1), workerBalanceBefore + expectedWorkerPayment);
        assertEq(usdc.balanceOf(feeRecipient), feeRecipientBalanceBefore + expectedFee);

        TaskMarket.Task memory task = market.getTask(TASK_ID_1);
        assertEq(uint256(task.status), uint256(TaskMarket.TaskStatus.Accepted));
        assertEq(task.worker, worker1);

        (uint256 completedTasks,,) = market.getWorkerStats(worker1);
        assertEq(completedTasks, 1);
    }

    function test_ClaimTask_Instant() public {
        vm.startPrank(requester);
        usdc.approve(address(market), REWARD);
        market.createTask(TASK_ID_2, REWARD, DURATION, TaskMarket.TaskMode.Instant, 0);
        vm.stopPrank();

        uint256 stakeAmount = REWARD / 10;

        vm.startPrank(worker1);
        usdc.approve(address(market), stakeAmount);

        vm.expectEmit(true, true, false, true);
        emit TaskMarket.TaskClaimed(TASK_ID_2, worker1, stakeAmount);

        market.claimTask(TASK_ID_2, stakeAmount);
        vm.stopPrank();

        TaskMarket.Task memory task = market.getTask(TASK_ID_2);
        assertEq(uint256(task.status), uint256(TaskMarket.TaskStatus.Claimed));
        assertEq(task.claimer, worker1);
        assertEq(task.stakeAmount, stakeAmount);
    }

    function test_AcceptSubmission_Instant_ReturnsStake() public {
        vm.startPrank(requester);
        usdc.approve(address(market), REWARD);
        market.createTask(TASK_ID_2, REWARD, DURATION, TaskMarket.TaskMode.Instant, 0);
        vm.stopPrank();

        uint256 stakeAmount = REWARD / 10;

        vm.startPrank(worker1);
        usdc.approve(address(market), stakeAmount);
        market.claimTask(TASK_ID_2, stakeAmount);
        vm.stopPrank();

        uint256 expectedFee = (REWARD * defaultFeeBps) / 10000;
        uint256 expectedWorkerPayment = REWARD - expectedFee;
        uint256 workerBalanceBefore = usdc.balanceOf(worker1);

        vm.prank(requester);
        market.acceptSubmission(TASK_ID_2, worker1);

        assertEq(usdc.balanceOf(worker1), workerBalanceBefore + expectedWorkerPayment + stakeAmount);
    }

    function test_ForfeitAndReopen_Instant() public {
        vm.startPrank(requester);
        usdc.approve(address(market), REWARD);
        market.createTask(TASK_ID_2, REWARD, DURATION, TaskMarket.TaskMode.Instant, 0);
        vm.stopPrank();

        uint256 stakeAmount = REWARD / 10;

        vm.startPrank(worker1);
        usdc.approve(address(market), stakeAmount);
        market.claimTask(TASK_ID_2, stakeAmount);
        vm.stopPrank();

        vm.warp(block.timestamp + (DURATION / 2) + 1);

        uint256 feeRecipientBalanceBefore = usdc.balanceOf(feeRecipient);

        vm.prank(requester);
        market.forfeitAndReopen(TASK_ID_2);

        assertEq(usdc.balanceOf(feeRecipient), feeRecipientBalanceBefore + stakeAmount);

        TaskMarket.Task memory task = market.getTask(TASK_ID_2);
        assertEq(uint256(task.status), uint256(TaskMarket.TaskStatus.Open));
        assertEq(task.claimer, address(0));
        assertEq(task.stakeAmount, 0);
    }

    function test_SelectWorker_Proposal() public {
        uint256 proposalDeadline = 2 days;

        vm.startPrank(requester);
        usdc.approve(address(market), REWARD);
        market.createTask(TASK_ID_3, REWARD, DURATION, TaskMarket.TaskMode.Proposal, proposalDeadline);
        vm.stopPrank();

        vm.expectEmit(true, true, false, false);
        emit TaskMarket.TaskWorkerSelected(TASK_ID_3, worker1);

        vm.prank(requester);
        market.selectWorker(TASK_ID_3, worker1);

        TaskMarket.Task memory task = market.getTask(TASK_ID_3);
        assertEq(uint256(task.status), uint256(TaskMarket.TaskStatus.WorkerSelected));
        assertEq(task.worker, worker1);
    }

    function test_AcceptSubmission_Proposal() public {
        uint256 proposalDeadline = 2 days;

        vm.startPrank(requester);
        usdc.approve(address(market), REWARD);
        market.createTask(TASK_ID_3, REWARD, DURATION, TaskMarket.TaskMode.Proposal, proposalDeadline);
        market.selectWorker(TASK_ID_3, worker1);
        vm.stopPrank();

        uint256 expectedFee = (REWARD * defaultFeeBps) / 10000;
        uint256 expectedWorkerPayment = REWARD - expectedFee;

        vm.prank(requester);
        market.acceptSubmission(TASK_ID_3, worker1);

        assertEq(usdc.balanceOf(worker1) - 1000 * 10 ** 6, expectedWorkerPayment);

        TaskMarket.Task memory task = market.getTask(TASK_ID_3);
        assertEq(uint256(task.status), uint256(TaskMarket.TaskStatus.Accepted));
    }

    function test_AcceptSubmission_Race() public {
        vm.startPrank(requester);
        usdc.approve(address(market), REWARD);
        market.createTask(TASK_ID_4, REWARD, DURATION, TaskMarket.TaskMode.Race, 0);
        vm.stopPrank();

        uint256 expectedFee = (REWARD * defaultFeeBps) / 10000;
        uint256 expectedWorkerPayment = REWARD - expectedFee;

        vm.prank(requester);
        market.acceptSubmission(TASK_ID_4, worker1);

        assertEq(usdc.balanceOf(worker1) - 1000 * 10 ** 6, expectedWorkerPayment);

        TaskMarket.Task memory task = market.getTask(TASK_ID_4);
        assertEq(uint256(task.status), uint256(TaskMarket.TaskStatus.Accepted));
    }

    function test_RateTask() public {
        vm.startPrank(requester);
        usdc.approve(address(market), REWARD);
        market.createTask(TASK_ID_1, REWARD, DURATION, TaskMarket.TaskMode.Contest, 0);
        market.acceptSubmission(TASK_ID_1, worker1);
        vm.stopPrank();

        vm.expectEmit(true, true, false, true);
        emit TaskMarket.TaskRated(TASK_ID_1, worker1, 5);

        vm.prank(requester);
        market.rateTask(TASK_ID_1, 5);

        TaskMarket.Task memory task = market.getTask(TASK_ID_1);
        assertEq(task.rating, 5);

        (,uint256 avgRating, uint256 ratedTasks) = market.getWorkerStats(worker1);
        assertEq(ratedTasks, 1);
        assertEq(avgRating, 500);
    }

    function test_RefundExpired() public {
        vm.startPrank(requester);
        usdc.approve(address(market), REWARD);
        market.createTask(TASK_ID_1, REWARD, DURATION, TaskMarket.TaskMode.Contest, 0);
        vm.stopPrank();

        vm.warp(block.timestamp + DURATION + 1);

        uint256 requesterBalanceBefore = usdc.balanceOf(requester);

        vm.prank(requester);
        market.refundExpired(TASK_ID_1);

        assertEq(usdc.balanceOf(requester), requesterBalanceBefore + REWARD);

        TaskMarket.Task memory task = market.getTask(TASK_ID_1);
        assertEq(uint256(task.status), uint256(TaskMarket.TaskStatus.Expired));
    }

    function test_SetDefaultFeeBps() public {
        uint16 newFeeBps = 750;

        vm.prank(owner);
        market.setDefaultFeeBps(newFeeBps);

        assertEq(market.defaultFeeBps(), newFeeBps);
    }

    function test_SetFeeRecipient() public {
        address newRecipient = address(99);

        vm.prank(owner);
        market.setFeeRecipient(newRecipient);

        assertEq(market.feeRecipient(), newRecipient);
    }

    function testFail_NonOwnerSetFees() public {
        vm.prank(worker1);
        market.setDefaultFeeBps(1000);
    }

    function testFail_ClaimNonInstantTask() public {
        vm.startPrank(requester);
        usdc.approve(address(market), REWARD);
        market.createTask(TASK_ID_1, REWARD, DURATION, TaskMarket.TaskMode.Contest, 0);
        vm.stopPrank();

        vm.startPrank(worker1);
        usdc.approve(address(market), REWARD / 10);
        market.claimTask(TASK_ID_1, REWARD / 10);
        vm.stopPrank();
    }

    function testFail_SelectWorkerNonProposalTask() public {
        vm.startPrank(requester);
        usdc.approve(address(market), REWARD);
        market.createTask(TASK_ID_1, REWARD, DURATION, TaskMarket.TaskMode.Contest, 0);
        market.selectWorker(TASK_ID_1, worker1);
        vm.stopPrank();
    }

    function testFail_ForfeitTooEarly() public {
        vm.startPrank(requester);
        usdc.approve(address(market), REWARD);
        market.createTask(TASK_ID_2, REWARD, DURATION, TaskMarket.TaskMode.Instant, 0);
        vm.stopPrank();

        vm.startPrank(worker1);
        usdc.approve(address(market), REWARD / 10);
        market.claimTask(TASK_ID_2, REWARD / 10);
        vm.stopPrank();

        vm.prank(requester);
        market.forfeitAndReopen(TASK_ID_2);
    }

    function testFail_AcceptExpiredTask() public {
        vm.startPrank(requester);
        usdc.approve(address(market), REWARD);
        market.createTask(TASK_ID_1, REWARD, DURATION, TaskMarket.TaskMode.Contest, 0);
        vm.stopPrank();

        vm.warp(block.timestamp + DURATION + 1);

        vm.prank(requester);
        market.acceptSubmission(TASK_ID_1, worker1);
    }

    function testFail_RateTaskTwice() public {
        vm.startPrank(requester);
        usdc.approve(address(market), REWARD);
        market.createTask(TASK_ID_1, REWARD, DURATION, TaskMarket.TaskMode.Contest, 0);
        market.acceptSubmission(TASK_ID_1, worker1);
        market.rateTask(TASK_ID_1, 5);
        market.rateTask(TASK_ID_1, 4);
        vm.stopPrank();
    }
}
