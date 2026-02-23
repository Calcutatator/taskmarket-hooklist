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
    address public server = address(6);

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
        market.setAuthorizedServer(server);
        vm.stopPrank();

        // Server holds USDC to escrow on behalf of requesters (received via X402)
        usdc.mint(server, 10000 * 10 ** 6);
        usdc.mint(worker1, 1000 * 10 ** 6);
        usdc.mint(worker2, 1000 * 10 ** 6);
    }

    function test_Constructor() public view {
        assertEq(address(market.usdcToken()), address(usdc));
        assertEq(market.feeRecipient(), feeRecipient);
        assertEq(market.defaultFeeBps(), defaultFeeBps);
        assertEq(market.authorizedServer(), server);
    }

    function test_CreateTask_Bounty() public {
        vm.startPrank(server);
        usdc.approve(address(market), REWARD);

        vm.expectEmit(true, true, false, true);
        emit TaskMarket.TaskCreated(TASK_ID_1, requester, REWARD, block.timestamp + DURATION, TaskMarket.TaskMode.Bounty);

        market.createTask(TASK_ID_1, requester, REWARD, DURATION, TaskMarket.TaskMode.Bounty, 0, 0);
        vm.stopPrank();

        TaskMarket.Task memory task = market.getTask(TASK_ID_1);
        assertEq(task.requester, requester);
        assertEq(task.reward, REWARD);
        assertEq(uint256(task.mode), uint256(TaskMarket.TaskMode.Bounty));
        assertEq(uint256(task.status), uint256(TaskMarket.TaskStatus.Open));
    }

    function test_AcceptSubmission_Bounty() public {
        vm.startPrank(server);
        usdc.approve(address(market), REWARD);
        market.createTask(TASK_ID_1, requester, REWARD, DURATION, TaskMarket.TaskMode.Bounty, 0, 0);
        vm.stopPrank();

        uint256 expectedFee = (REWARD * defaultFeeBps) / 10000;
        uint256 expectedWorkerPayment = REWARD - expectedFee;

        uint256 workerBalanceBefore = usdc.balanceOf(worker1);
        uint256 feeRecipientBalanceBefore = usdc.balanceOf(feeRecipient);

        vm.prank(server);
        market.acceptSubmission(TASK_ID_1, requester, worker1);

        assertEq(usdc.balanceOf(worker1), workerBalanceBefore + expectedWorkerPayment);
        assertEq(usdc.balanceOf(feeRecipient), feeRecipientBalanceBefore + expectedFee);

        TaskMarket.Task memory task = market.getTask(TASK_ID_1);
        assertEq(uint256(task.status), uint256(TaskMarket.TaskStatus.Accepted));
        assertEq(task.worker, worker1);

        (uint256 completedTasks,,) = market.getWorkerStats(worker1);
        assertEq(completedTasks, 1);
    }

    function test_ClaimTask_Claim() public {
        vm.startPrank(server);
        usdc.approve(address(market), REWARD);
        market.createTask(TASK_ID_2, requester, REWARD, DURATION, TaskMarket.TaskMode.Claim, 0, 0);
        vm.stopPrank();

        uint256 stakeAmount = REWARD / 10;

        vm.startPrank(server);
        usdc.approve(address(market), stakeAmount);

        vm.expectEmit(true, true, false, true);
        emit TaskMarket.TaskClaimed(TASK_ID_2, worker1, stakeAmount);

        market.claimTask(TASK_ID_2, worker1, stakeAmount);
        vm.stopPrank();

        TaskMarket.Task memory task = market.getTask(TASK_ID_2);
        assertEq(uint256(task.status), uint256(TaskMarket.TaskStatus.Claimed));
        assertEq(task.claimer, worker1);
        assertEq(task.stakeAmount, stakeAmount);
    }

    function test_AcceptSubmission_Claim_ReturnsStake() public {
        vm.startPrank(server);
        usdc.approve(address(market), REWARD);
        market.createTask(TASK_ID_2, requester, REWARD, DURATION, TaskMarket.TaskMode.Claim, 0, 0);
        vm.stopPrank();

        uint256 stakeAmount = REWARD / 10;

        vm.startPrank(server);
        usdc.approve(address(market), stakeAmount);
        market.claimTask(TASK_ID_2, worker1, stakeAmount);
        vm.stopPrank();

        uint256 expectedFee = (REWARD * defaultFeeBps) / 10000;
        uint256 expectedWorkerPayment = REWARD - expectedFee;
        uint256 workerBalanceBefore = usdc.balanceOf(worker1);

        vm.prank(server);
        market.acceptSubmission(TASK_ID_2, requester, worker1);

        assertEq(usdc.balanceOf(worker1), workerBalanceBefore + expectedWorkerPayment + stakeAmount);
    }

    function test_ForfeitAndReopen_Claim() public {
        vm.startPrank(server);
        usdc.approve(address(market), REWARD);
        market.createTask(TASK_ID_2, requester, REWARD, DURATION, TaskMarket.TaskMode.Claim, 0, 0);
        vm.stopPrank();

        uint256 stakeAmount = REWARD / 10;

        vm.startPrank(server);
        usdc.approve(address(market), stakeAmount);
        market.claimTask(TASK_ID_2, worker1, stakeAmount);
        vm.stopPrank();

        vm.warp(block.timestamp + (DURATION / 2) + 1);

        uint256 feeRecipientBalanceBefore = usdc.balanceOf(feeRecipient);

        vm.prank(server);
        market.forfeitAndReopen(TASK_ID_2, requester);

        assertEq(usdc.balanceOf(feeRecipient), feeRecipientBalanceBefore + stakeAmount);

        TaskMarket.Task memory task = market.getTask(TASK_ID_2);
        assertEq(uint256(task.status), uint256(TaskMarket.TaskStatus.Open));
        assertEq(task.claimer, address(0));
        assertEq(task.stakeAmount, 0);
    }

    function test_SelectWorker_Pitch() public {
        uint256 pitchDeadline = 2 days;

        vm.startPrank(server);
        usdc.approve(address(market), REWARD);
        market.createTask(TASK_ID_3, requester, REWARD, DURATION, TaskMarket.TaskMode.Pitch, pitchDeadline, 0);
        vm.stopPrank();

        vm.expectEmit(true, true, false, false);
        emit TaskMarket.TaskWorkerSelected(TASK_ID_3, worker1);

        vm.prank(server);
        market.selectWorker(TASK_ID_3, requester, worker1);

        TaskMarket.Task memory task = market.getTask(TASK_ID_3);
        assertEq(uint256(task.status), uint256(TaskMarket.TaskStatus.WorkerSelected));
        assertEq(task.worker, worker1);
    }

    function test_AcceptSubmission_Pitch() public {
        uint256 pitchDeadline = 2 days;

        vm.startPrank(server);
        usdc.approve(address(market), REWARD);
        market.createTask(TASK_ID_3, requester, REWARD, DURATION, TaskMarket.TaskMode.Pitch, pitchDeadline, 0);
        market.selectWorker(TASK_ID_3, requester, worker1);
        vm.stopPrank();

        uint256 expectedFee = (REWARD * defaultFeeBps) / 10000;
        uint256 expectedWorkerPayment = REWARD - expectedFee;

        vm.prank(server);
        market.acceptSubmission(TASK_ID_3, requester, worker1);

        assertEq(usdc.balanceOf(worker1) - 1000 * 10 ** 6, expectedWorkerPayment);

        TaskMarket.Task memory task = market.getTask(TASK_ID_3);
        assertEq(uint256(task.status), uint256(TaskMarket.TaskStatus.Accepted));
    }

    function test_AcceptSubmission_Benchmark() public {
        vm.startPrank(server);
        usdc.approve(address(market), REWARD);
        market.createTask(TASK_ID_4, requester, REWARD, DURATION, TaskMarket.TaskMode.Benchmark, 0, 0);
        vm.stopPrank();

        uint256 expectedFee = (REWARD * defaultFeeBps) / 10000;
        uint256 expectedWorkerPayment = REWARD - expectedFee;

        vm.prank(server);
        market.acceptSubmission(TASK_ID_4, requester, worker1);

        assertEq(usdc.balanceOf(worker1) - 1000 * 10 ** 6, expectedWorkerPayment);

        TaskMarket.Task memory task = market.getTask(TASK_ID_4);
        assertEq(uint256(task.status), uint256(TaskMarket.TaskStatus.Accepted));
    }

    function test_RateTask() public {
        vm.startPrank(server);
        usdc.approve(address(market), REWARD);
        market.createTask(TASK_ID_1, requester, REWARD, DURATION, TaskMarket.TaskMode.Bounty, 0, 0);
        market.acceptSubmission(TASK_ID_1, requester, worker1);
        vm.stopPrank();

        vm.expectEmit(true, true, false, true);
        emit TaskMarket.TaskRated(TASK_ID_1, worker1, 5);

        vm.prank(server);
        market.rateTask(TASK_ID_1, requester, 5, 0, "", bytes32(0));

        TaskMarket.Task memory task = market.getTask(TASK_ID_1);
        assertEq(task.rating, 5);

        (,uint256 avgRating, uint256 ratedTasks) = market.getWorkerStats(worker1);
        assertEq(ratedTasks, 1);
        assertEq(avgRating, 500);
    }

    function test_RefundExpired() public {
        vm.startPrank(server);
        usdc.approve(address(market), REWARD);
        market.createTask(TASK_ID_1, requester, REWARD, DURATION, TaskMarket.TaskMode.Bounty, 0, 0);
        vm.stopPrank();

        vm.warp(block.timestamp + DURATION + 1);

        uint256 requesterBalanceBefore = usdc.balanceOf(requester);

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

    function test_RevertWhen_NonOwnerSetFees() public {
        vm.prank(worker1);
        vm.expectRevert();
        market.setDefaultFeeBps(1000);
    }

    function test_RevertWhen_ClaimNonClaimTask() public {
        vm.startPrank(server);
        usdc.approve(address(market), REWARD);
        market.createTask(TASK_ID_1, requester, REWARD, DURATION, TaskMarket.TaskMode.Bounty, 0, 0);
        vm.expectRevert();
        market.claimTask(TASK_ID_1, worker1, REWARD / 10);
        vm.stopPrank();
    }

    function test_RevertWhen_SelectWorkerNonPitchTask() public {
        vm.startPrank(server);
        usdc.approve(address(market), REWARD);
        market.createTask(TASK_ID_1, requester, REWARD, DURATION, TaskMarket.TaskMode.Bounty, 0, 0);
        vm.expectRevert();
        market.selectWorker(TASK_ID_1, requester, worker1);
        vm.stopPrank();
    }

    function test_RevertWhen_ForfeitTooEarly() public {
        vm.startPrank(server);
        usdc.approve(address(market), REWARD + REWARD / 10);
        market.createTask(TASK_ID_2, requester, REWARD, DURATION, TaskMarket.TaskMode.Claim, 0, 0);
        market.claimTask(TASK_ID_2, worker1, REWARD / 10);
        vm.expectRevert();
        market.forfeitAndReopen(TASK_ID_2, requester);
        vm.stopPrank();
    }

    function test_RevertWhen_AcceptExpiredTask() public {
        vm.startPrank(server);
        usdc.approve(address(market), REWARD);
        market.createTask(TASK_ID_1, requester, REWARD, DURATION, TaskMarket.TaskMode.Bounty, 0, 0);
        vm.stopPrank();

        vm.warp(block.timestamp + DURATION + 1);

        vm.prank(server);
        vm.expectRevert();
        market.acceptSubmission(TASK_ID_1, requester, worker1);
    }

    function test_RevertWhen_RateTaskTwice() public {
        vm.startPrank(server);
        usdc.approve(address(market), REWARD);
        market.createTask(TASK_ID_1, requester, REWARD, DURATION, TaskMarket.TaskMode.Bounty, 0, 0);
        market.acceptSubmission(TASK_ID_1, requester, worker1);
        market.rateTask(TASK_ID_1, requester, 5, 0, "", bytes32(0));
        vm.expectRevert();
        market.rateTask(TASK_ID_1, requester, 4, 0, "", bytes32(0));
        vm.stopPrank();
    }

    // -----------------------------------------------------------------------
    // Access control (onlyServer) — non-server caller
    // -----------------------------------------------------------------------

    address public alice = address(7);

    function test_RevertWhen_NonServer_CreateTask() public {
        usdc.mint(alice, REWARD);
        vm.startPrank(alice);
        usdc.approve(address(market), REWARD);
        vm.expectRevert("Not authorized server");
        market.createTask(TASK_ID_1, requester, REWARD, DURATION, TaskMarket.TaskMode.Bounty, 0, 0);
        vm.stopPrank();
    }

    function test_RevertWhen_NonServer_ClaimTask() public {
        vm.startPrank(server);
        usdc.approve(address(market), REWARD);
        market.createTask(TASK_ID_2, requester, REWARD, DURATION, TaskMarket.TaskMode.Claim, 0, 0);
        vm.stopPrank();

        vm.prank(alice);
        vm.expectRevert("Not authorized server");
        market.claimTask(TASK_ID_2, worker1, 0);
    }

    function test_RevertWhen_NonServer_SelectWorker() public {
        vm.startPrank(server);
        usdc.approve(address(market), REWARD);
        market.createTask(TASK_ID_3, requester, REWARD, DURATION, TaskMarket.TaskMode.Pitch, 2 days, 0);
        vm.stopPrank();

        vm.prank(alice);
        vm.expectRevert("Not authorized server");
        market.selectWorker(TASK_ID_3, requester, worker1);
    }

    function test_RevertWhen_NonServer_AcceptSubmission() public {
        vm.startPrank(server);
        usdc.approve(address(market), REWARD);
        market.createTask(TASK_ID_1, requester, REWARD, DURATION, TaskMarket.TaskMode.Bounty, 0, 0);
        vm.stopPrank();

        vm.prank(alice);
        vm.expectRevert("Not authorized server");
        market.acceptSubmission(TASK_ID_1, requester, worker1);
    }

    function test_RevertWhen_NonServer_ForfeitAndReopen() public {
        vm.startPrank(server);
        usdc.approve(address(market), REWARD + REWARD / 10);
        market.createTask(TASK_ID_2, requester, REWARD, DURATION, TaskMarket.TaskMode.Claim, 0, 0);
        market.claimTask(TASK_ID_2, worker1, REWARD / 10);
        vm.stopPrank();

        vm.warp(block.timestamp + (DURATION / 2) + 1);

        vm.prank(alice);
        vm.expectRevert("Not authorized server");
        market.forfeitAndReopen(TASK_ID_2, requester);
    }

    function test_RevertWhen_NonServer_RateTask() public {
        vm.startPrank(server);
        usdc.approve(address(market), REWARD);
        market.createTask(TASK_ID_1, requester, REWARD, DURATION, TaskMarket.TaskMode.Bounty, 0, 0);
        market.acceptSubmission(TASK_ID_1, requester, worker1);
        vm.stopPrank();

        vm.prank(alice);
        vm.expectRevert("Not authorized server");
        market.rateTask(TASK_ID_1, requester, 5, 0, "", bytes32(0));
    }

    // -----------------------------------------------------------------------
    // setAuthorizedServer
    // -----------------------------------------------------------------------

    function test_SetAuthorizedServer() public {
        address newServer = address(8);

        vm.startPrank(owner);
        vm.expectEmit(false, false, false, true);
        emit TaskMarket.AuthorizedServerUpdated(newServer);
        market.setAuthorizedServer(newServer);
        vm.stopPrank();

        assertEq(market.authorizedServer(), newServer);

        // Confirm new server can call a server-only function
        usdc.mint(newServer, REWARD);
        vm.startPrank(newServer);
        usdc.approve(address(market), REWARD);
        market.createTask(TASK_ID_1, requester, REWARD, DURATION, TaskMarket.TaskMode.Bounty, 0, 0);
        vm.stopPrank();

        TaskMarket.Task memory task = market.getTask(TASK_ID_1);
        assertEq(task.requester, requester);
    }

    function test_RevertWhen_SetAuthorizedServer_ZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert("Invalid server address");
        market.setAuthorizedServer(address(0));
    }

    function test_RevertWhen_NonOwner_SetAuthorizedServer() public {
        vm.prank(alice);
        vm.expectRevert();
        market.setAuthorizedServer(address(8));
    }

    // -----------------------------------------------------------------------
    // Constructor validation
    // -----------------------------------------------------------------------

    function test_RevertWhen_Constructor_ZeroFeeRecipient() public {
        vm.prank(owner);
        vm.expectRevert("Invalid fee recipient");
        new TaskMarket(address(usdc), address(0), defaultFeeBps);
    }

    function test_RevertWhen_Constructor_FeeBpsTooHigh() public {
        vm.prank(owner);
        vm.expectRevert("Fee BPS too high");
        new TaskMarket(address(usdc), feeRecipient, 10001);
    }

    // -----------------------------------------------------------------------
    // createTask input validation
    // -----------------------------------------------------------------------

    function test_RevertWhen_CreateTask_ZeroRequester() public {
        vm.startPrank(server);
        usdc.approve(address(market), REWARD);
        vm.expectRevert("Invalid requester");
        market.createTask(TASK_ID_1, address(0), REWARD, DURATION, TaskMarket.TaskMode.Bounty, 0, 0);
        vm.stopPrank();
    }

    function test_RevertWhen_CreateTask_ZeroReward() public {
        vm.startPrank(server);
        usdc.approve(address(market), REWARD);
        vm.expectRevert("Reward must be greater than 0");
        market.createTask(TASK_ID_1, requester, 0, DURATION, TaskMarket.TaskMode.Bounty, 0, 0);
        vm.stopPrank();
    }

    function test_RevertWhen_CreateTask_ZeroDuration() public {
        vm.startPrank(server);
        usdc.approve(address(market), REWARD);
        vm.expectRevert("Duration must be greater than 0");
        market.createTask(TASK_ID_1, requester, REWARD, 0, TaskMarket.TaskMode.Bounty, 0, 0);
        vm.stopPrank();
    }

    function test_RevertWhen_CreateTask_DuplicateId() public {
        vm.startPrank(server);
        usdc.approve(address(market), REWARD * 2);
        market.createTask(TASK_ID_1, requester, REWARD, DURATION, TaskMarket.TaskMode.Bounty, 0, 0);
        vm.expectRevert("Task already exists");
        market.createTask(TASK_ID_1, requester, REWARD, DURATION, TaskMarket.TaskMode.Bounty, 0, 0);
        vm.stopPrank();
    }

    // -----------------------------------------------------------------------
    // claimTask additional reverts
    // -----------------------------------------------------------------------

    function test_RevertWhen_ClaimTask_TaskExpired() public {
        vm.startPrank(server);
        usdc.approve(address(market), REWARD);
        market.createTask(TASK_ID_2, requester, REWARD, DURATION, TaskMarket.TaskMode.Claim, 0, 0);
        vm.stopPrank();

        vm.warp(block.timestamp + DURATION + 1);

        vm.prank(server);
        vm.expectRevert("Task expired");
        market.claimTask(TASK_ID_2, worker1, 0);
    }

    function test_RevertWhen_ClaimTask_AlreadyClaimed() public {
        vm.startPrank(server);
        usdc.approve(address(market), REWARD);
        market.createTask(TASK_ID_2, requester, REWARD, DURATION, TaskMarket.TaskMode.Claim, 0, 0);
        market.claimTask(TASK_ID_2, worker1, 0);
        vm.expectRevert("Task not available");
        market.claimTask(TASK_ID_2, worker2, 0);
        vm.stopPrank();
    }

    // -----------------------------------------------------------------------
    // Wrong requester reverts
    // -----------------------------------------------------------------------

    function test_RevertWhen_SelectWorker_WrongRequester() public {
        vm.startPrank(server);
        usdc.approve(address(market), REWARD);
        market.createTask(TASK_ID_3, requester, REWARD, DURATION, TaskMarket.TaskMode.Pitch, 2 days, 0);
        vm.expectRevert("Not requester");
        market.selectWorker(TASK_ID_3, worker2, worker1);
        vm.stopPrank();
    }

    function test_RevertWhen_AcceptSubmission_WrongRequester() public {
        vm.startPrank(server);
        usdc.approve(address(market), REWARD);
        market.createTask(TASK_ID_1, requester, REWARD, DURATION, TaskMarket.TaskMode.Bounty, 0, 0);
        vm.expectRevert("Not requester");
        market.acceptSubmission(TASK_ID_1, worker2, worker1);
        vm.stopPrank();
    }

    function test_RevertWhen_ForfeitAndReopen_WrongRequester() public {
        vm.startPrank(server);
        usdc.approve(address(market), REWARD + REWARD / 10);
        market.createTask(TASK_ID_2, requester, REWARD, DURATION, TaskMarket.TaskMode.Claim, 0, 0);
        market.claimTask(TASK_ID_2, worker1, REWARD / 10);
        vm.stopPrank();

        vm.warp(block.timestamp + (DURATION / 2) + 1);

        vm.prank(server);
        vm.expectRevert("Not requester");
        market.forfeitAndReopen(TASK_ID_2, worker2);
    }

    function test_RevertWhen_RateTask_WrongRequester() public {
        vm.startPrank(server);
        usdc.approve(address(market), REWARD);
        market.createTask(TASK_ID_1, requester, REWARD, DURATION, TaskMarket.TaskMode.Bounty, 0, 0);
        market.acceptSubmission(TASK_ID_1, requester, worker1);
        vm.expectRevert("Not requester");
        market.rateTask(TASK_ID_1, worker2, 5, 0, "", bytes32(0));
        vm.stopPrank();
    }

    // -----------------------------------------------------------------------
    // selectWorker additional reverts
    // -----------------------------------------------------------------------

    function test_RevertWhen_SelectWorker_DeadlinePassed() public {
        vm.startPrank(server);
        usdc.approve(address(market), REWARD);
        market.createTask(TASK_ID_3, requester, REWARD, DURATION, TaskMarket.TaskMode.Pitch, 1 days, 0);
        vm.stopPrank();

        vm.warp(block.timestamp + 1 days + 1);

        vm.prank(server);
        vm.expectRevert("Pitch deadline passed");
        market.selectWorker(TASK_ID_3, requester, worker1);
    }

    function test_RevertWhen_SelectWorker_NotOpen() public {
        vm.startPrank(server);
        usdc.approve(address(market), REWARD);
        market.createTask(TASK_ID_3, requester, REWARD, DURATION, TaskMarket.TaskMode.Pitch, 2 days, 0);
        market.selectWorker(TASK_ID_3, requester, worker1);
        vm.expectRevert("Task not available");
        market.selectWorker(TASK_ID_3, requester, worker2);
        vm.stopPrank();
    }

    // -----------------------------------------------------------------------
    // acceptSubmission additional reverts
    // -----------------------------------------------------------------------

    function test_RevertWhen_AcceptSubmission_Claim_WrongClaimer() public {
        vm.startPrank(server);
        usdc.approve(address(market), REWARD);
        market.createTask(TASK_ID_2, requester, REWARD, DURATION, TaskMarket.TaskMode.Claim, 0, 0);
        market.claimTask(TASK_ID_2, worker1, 0);
        vm.expectRevert("Worker must be claimer");
        market.acceptSubmission(TASK_ID_2, requester, worker2);
        vm.stopPrank();
    }

    function test_RevertWhen_AcceptSubmission_Pitch_WrongWorker() public {
        vm.startPrank(server);
        usdc.approve(address(market), REWARD);
        market.createTask(TASK_ID_3, requester, REWARD, DURATION, TaskMarket.TaskMode.Pitch, 2 days, 0);
        market.selectWorker(TASK_ID_3, requester, worker1);
        vm.expectRevert("Worker mismatch");
        market.acceptSubmission(TASK_ID_3, requester, worker2);
        vm.stopPrank();
    }

    // -----------------------------------------------------------------------
    // rateTask additional reverts
    // -----------------------------------------------------------------------

    function test_RevertWhen_RateTask_NotAccepted() public {
        vm.startPrank(server);
        usdc.approve(address(market), REWARD);
        market.createTask(TASK_ID_1, requester, REWARD, DURATION, TaskMarket.TaskMode.Bounty, 0, 0);
        vm.expectRevert("Task not accepted");
        market.rateTask(TASK_ID_1, requester, 3, 0, "", bytes32(0));
        vm.stopPrank();
    }

    function test_RevertWhen_RateTask_InvalidRating_Zero() public {
        vm.startPrank(server);
        usdc.approve(address(market), REWARD);
        market.createTask(TASK_ID_1, requester, REWARD, DURATION, TaskMarket.TaskMode.Bounty, 0, 0);
        market.acceptSubmission(TASK_ID_1, requester, worker1);
        vm.expectRevert("Rating must be 0-100");
        market.rateTask(TASK_ID_1, requester, 101, 0, "", bytes32(0));
        vm.stopPrank();
    }

    function test_RevertWhen_RateTask_InvalidRating_Six() public {
        vm.startPrank(server);
        usdc.approve(address(market), REWARD);
        market.createTask(TASK_ID_1, requester, REWARD, DURATION, TaskMarket.TaskMode.Bounty, 0, 0);
        market.acceptSubmission(TASK_ID_1, requester, worker1);
        vm.expectRevert("Rating must be 0-100");
        market.rateTask(TASK_ID_1, requester, 101, 0, "", bytes32(0));
        vm.stopPrank();
    }

    // -----------------------------------------------------------------------
    // refundExpired edge cases
    // -----------------------------------------------------------------------

    function test_RevertWhen_RefundExpired_NotYetExpired() public {
        vm.startPrank(server);
        usdc.approve(address(market), REWARD);
        market.createTask(TASK_ID_1, requester, REWARD, DURATION, TaskMarket.TaskMode.Bounty, 0, 0);
        vm.stopPrank();

        vm.expectRevert("Task not expired");
        market.refundExpired(TASK_ID_1);
    }

    function test_RevertWhen_RefundExpired_TaskDoesNotExist() public {
        vm.expectRevert("Task does not exist");
        market.refundExpired(keccak256("nonexistent"));
    }

    function test_RevertWhen_RefundExpired_AlreadyAccepted() public {
        vm.startPrank(server);
        usdc.approve(address(market), REWARD);
        market.createTask(TASK_ID_1, requester, REWARD, DURATION, TaskMarket.TaskMode.Bounty, 0, 0);
        market.acceptSubmission(TASK_ID_1, requester, worker1);
        vm.stopPrank();

        vm.warp(block.timestamp + DURATION + 1);

        vm.expectRevert("Task already accepted");
        market.refundExpired(TASK_ID_1);
    }

    function test_RefundExpired_Claim_ReturnsStake() public {
        uint256 stakeAmount = REWARD / 10;

        vm.startPrank(server);
        usdc.approve(address(market), REWARD + stakeAmount);
        market.createTask(TASK_ID_2, requester, REWARD, DURATION, TaskMarket.TaskMode.Claim, 0, 0);
        market.claimTask(TASK_ID_2, worker1, stakeAmount);
        vm.stopPrank();

        vm.warp(block.timestamp + DURATION + 1);

        uint256 worker1BalanceBefore = usdc.balanceOf(worker1);
        uint256 requesterBalanceBefore = usdc.balanceOf(requester);

        market.refundExpired(TASK_ID_2);

        // Requester gets reward back
        assertEq(usdc.balanceOf(requester), requesterBalanceBefore + REWARD);
        // Worker gets stake back
        assertEq(usdc.balanceOf(worker1), worker1BalanceBefore + stakeAmount);
    }

    // -----------------------------------------------------------------------
    // forfeitAndReopen additional reverts
    // -----------------------------------------------------------------------

    function test_RevertWhen_ForfeitAndReopen_NotClaim() public {
        vm.startPrank(server);
        usdc.approve(address(market), REWARD);
        market.createTask(TASK_ID_1, requester, REWARD, DURATION, TaskMarket.TaskMode.Bounty, 0, 0);
        vm.expectRevert("Not a Claim task");
        market.forfeitAndReopen(TASK_ID_1, requester);
        vm.stopPrank();
    }

    function test_RevertWhen_ForfeitAndReopen_NotClaimed() public {
        vm.startPrank(server);
        usdc.approve(address(market), REWARD);
        market.createTask(TASK_ID_2, requester, REWARD, DURATION, TaskMarket.TaskMode.Claim, 0, 0);
        vm.expectRevert("Task not claimed");
        market.forfeitAndReopen(TASK_ID_2, requester);
        vm.stopPrank();
    }

    // -----------------------------------------------------------------------
    // Admin setters
    // -----------------------------------------------------------------------

    function test_RevertWhen_SetDefaultFeeBps_TooHigh() public {
        vm.prank(owner);
        vm.expectRevert("Fee BPS too high");
        market.setDefaultFeeBps(10001);
    }

    function test_RevertWhen_NonOwner_SetFeeRecipient() public {
        vm.prank(alice);
        vm.expectRevert();
        market.setFeeRecipient(address(99));
    }

    function test_RevertWhen_SetFeeRecipient_ZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert("Invalid recipient");
        market.setFeeRecipient(address(0));
    }

    // -----------------------------------------------------------------------
    // Worker stats across multiple tasks
    // -----------------------------------------------------------------------

    function test_GetWorkerStats_MultipleAcceptedTasks() public {
        vm.startPrank(server);
        usdc.approve(address(market), REWARD * 2);

        market.createTask(TASK_ID_1, requester, REWARD, DURATION, TaskMarket.TaskMode.Bounty, 0, 0);
        market.createTask(TASK_ID_2, requester, REWARD, DURATION, TaskMarket.TaskMode.Claim, 0, 0);
        market.claimTask(TASK_ID_2, worker1, 0);

        market.acceptSubmission(TASK_ID_1, requester, worker1);
        market.acceptSubmission(TASK_ID_2, requester, worker1);
        vm.stopPrank();

        (uint256 completedTasks,,) = market.getWorkerStats(worker1);
        assertEq(completedTasks, 2);

        // Verify both tasks show worker1 as the worker
        TaskMarket.Task memory task1 = market.getTask(TASK_ID_1);
        TaskMarket.Task memory task2 = market.getTask(TASK_ID_2);
        assertEq(task1.worker, worker1);
        assertEq(task2.worker, worker1);
    }
}
