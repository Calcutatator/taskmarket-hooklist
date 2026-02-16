// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title TaskMarket
 * @notice Multi-mode decentralized task marketplace with USDC escrow on Base L2
 * @dev Supports Contest, Instant, Proposal, and Race modes with platform fees and staking
 */
contract TaskMarket is ReentrancyGuard, Ownable {
    IERC20 public immutable usdcToken;

    enum TaskMode {
        Contest,
        Instant,
        Proposal,
        Race
    }

    enum TaskStatus {
        Open,
        Claimed,
        WorkerSelected,
        PendingApproval,
        Accepted,
        Expired,
        Disputed
    }

    struct Task {
        bytes32 id;
        address requester;
        address worker;
        uint256 reward;
        uint256 createdAt;
        uint256 expiryTime;
        TaskStatus status;
        uint8 rating;
        TaskMode mode;
        uint256 stakeAmount;
        address claimer;
        uint256 claimedAt;
        uint256 proposalDeadline;
        uint16 feeBps;
    }

    struct WorkerStats {
        uint256 completedTasks;
        uint256 ratedTasks;
        uint256 totalStars;
    }

    mapping(bytes32 => Task) public tasks;
    mapping(address => WorkerStats) public workerStats;
    mapping(bytes32 => uint256) public stakeForfeit;

    uint16 public defaultFeeBps;
    address public feeRecipient;
    uint256 public totalFeesCollected;

    event TaskCreated(
        bytes32 indexed taskId,
        address indexed requester,
        uint256 reward,
        uint256 expiryTime,
        TaskMode mode
    );
    event TaskClaimed(bytes32 indexed taskId, address indexed claimer, uint256 stakeAmount);
    event TaskWorkerSelected(bytes32 indexed taskId, address indexed worker);
    event TaskAccepted(
        bytes32 indexed taskId,
        address indexed requester,
        address indexed worker,
        uint256 workerPayment,
        uint256 platformFee
    );
    event TaskRated(bytes32 indexed taskId, address indexed worker, uint8 rating);
    event TaskExpired(bytes32 indexed taskId, address indexed requester, uint256 refundAmount);
    event StakeForfeited(bytes32 indexed taskId, address indexed claimer, uint256 stakeAmount);
    event StakeReturned(bytes32 indexed taskId, address indexed claimer, uint256 stakeAmount);
    event TaskReopened(bytes32 indexed taskId);
    event FeesUpdated(uint16 newFeeBps);
    event FeeRecipientUpdated(address newRecipient);

    /**
     * @notice Constructor
     * @param _usdcToken USDC token address on Base
     * @param _feeRecipient Address to receive platform fees
     * @param _defaultFeeBps Default platform fee in basis points (500 = 5%)
     */
    constructor(address _usdcToken, address _feeRecipient, uint16 _defaultFeeBps) Ownable(msg.sender) {
        require(_feeRecipient != address(0), "Invalid fee recipient");
        require(_defaultFeeBps <= 10000, "Fee BPS too high");
        usdcToken = IERC20(_usdcToken);
        feeRecipient = _feeRecipient;
        defaultFeeBps = _defaultFeeBps;
    }

    /**
     * @notice Create a new task with USDC escrow
     * @param taskId Unique task identifier
     * @param reward USDC reward amount (6 decimals)
     * @param duration Task duration in seconds
     * @param mode Task mode (Contest/Instant/Proposal/Race)
     * @param proposalDeadline Deadline for proposals (Proposal mode only, seconds from now)
     * @dev Requires prior USDC approval for reward amount
     */
    function createTask(
        bytes32 taskId,
        uint256 reward,
        uint256 duration,
        TaskMode mode,
        uint256 proposalDeadline
    ) external {
        require(reward > 0, "Reward must be greater than 0");
        require(duration > 0, "Duration must be greater than 0");
        require(tasks[taskId].requester == address(0), "Task already exists");

        require(usdcToken.transferFrom(msg.sender, address(this), reward), "USDC transfer failed");

        tasks[taskId] = Task({
            id: taskId,
            requester: msg.sender,
            worker: address(0),
            reward: reward,
            createdAt: block.timestamp,
            expiryTime: block.timestamp + duration,
            status: TaskStatus.Open,
            rating: 0,
            mode: mode,
            stakeAmount: 0,
            claimer: address(0),
            claimedAt: 0,
            proposalDeadline: mode == TaskMode.Proposal ? block.timestamp + proposalDeadline : 0,
            feeBps: defaultFeeBps
        });

        emit TaskCreated(taskId, msg.sender, reward, block.timestamp + duration, mode);
    }

    /**
     * @notice Claim an Instant mode task with stake
     * @param taskId Task identifier
     * @param stakeAmount USDC stake amount (10% of reward recommended)
     * @dev Requires prior USDC approval for stake amount
     */
    function claimTask(bytes32 taskId, uint256 stakeAmount) external {
        Task storage task = tasks[taskId];
        require(task.requester != address(0), "Task does not exist");
        require(task.mode == TaskMode.Instant, "Not an Instant task");
        require(task.status == TaskStatus.Open, "Task not available");
        require(block.timestamp <= task.expiryTime, "Task expired");

        require(usdcToken.transferFrom(msg.sender, address(this), stakeAmount), "Stake transfer failed");

        task.claimer = msg.sender;
        task.claimedAt = block.timestamp;
        task.stakeAmount = stakeAmount;
        task.status = TaskStatus.Claimed;

        emit TaskClaimed(taskId, msg.sender, stakeAmount);
    }

    /**
     * @notice Select a worker for Proposal mode
     * @param taskId Task identifier
     * @param worker Selected worker address
     */
    function selectWorker(bytes32 taskId, address worker) external {
        Task storage task = tasks[taskId];
        require(msg.sender == task.requester, "Not requester");
        require(task.mode == TaskMode.Proposal, "Not a Proposal task");
        require(task.status == TaskStatus.Open, "Task not available");
        require(block.timestamp <= task.proposalDeadline, "Proposal deadline passed");

        task.worker = worker;
        task.status = TaskStatus.WorkerSelected;

        emit TaskWorkerSelected(taskId, worker);
    }

    /**
     * @notice Accept submission and release payment
     * @param taskId Task identifier
     * @param worker Worker address
     */
    function acceptSubmission(bytes32 taskId, address worker) external nonReentrant {
        Task storage task = tasks[taskId];
        require(msg.sender == task.requester, "Not requester");
        require(block.timestamp <= task.expiryTime, "Task expired");

        if (task.mode == TaskMode.Instant) {
            require(task.status == TaskStatus.Claimed, "Task not claimed");
            require(worker == task.claimer, "Worker must be claimer");
        } else if (task.mode == TaskMode.Proposal) {
            require(task.status == TaskStatus.WorkerSelected, "Worker not selected");
            require(worker == task.worker, "Worker mismatch");
        } else {
            require(
                task.status == TaskStatus.Open || task.status == TaskStatus.PendingApproval,
                "Task not available"
            );
        }

        task.status = TaskStatus.Accepted;
        task.worker = worker;

        workerStats[worker].completedTasks++;

        uint256 fee = (task.reward * task.feeBps) / 10000;
        uint256 workerPayment = task.reward - fee;

        require(usdcToken.transfer(worker, workerPayment), "Worker payment failed");

        if (fee > 0) {
            require(usdcToken.transfer(feeRecipient, fee), "Fee transfer failed");
            totalFeesCollected += fee;
        }

        if (task.mode == TaskMode.Instant && task.stakeAmount > 0) {
            require(usdcToken.transfer(task.claimer, task.stakeAmount), "Stake return failed");
            emit StakeReturned(taskId, task.claimer, task.stakeAmount);
        }

        emit TaskAccepted(taskId, msg.sender, worker, workerPayment, fee);
    }

    /**
     * @notice Forfeit claimer's stake and reopen Instant task
     * @param taskId Task identifier
     */
    function forfeitAndReopen(bytes32 taskId) external {
        Task storage task = tasks[taskId];
        require(msg.sender == task.requester, "Not requester");
        require(task.mode == TaskMode.Instant, "Not an Instant task");
        require(task.status == TaskStatus.Claimed, "Task not claimed");
        require(
            block.timestamp > task.claimedAt + ((task.expiryTime - task.createdAt) / 2),
            "Cannot forfeit yet"
        );

        uint256 forfeited = task.stakeAmount;
        stakeForfeit[taskId] = forfeited;

        if (forfeited > 0) {
            require(usdcToken.transfer(feeRecipient, forfeited), "Forfeit transfer failed");
            totalFeesCollected += forfeited;
            emit StakeForfeited(taskId, task.claimer, forfeited);
        }

        task.status = TaskStatus.Open;
        task.claimer = address(0);
        task.claimedAt = 0;
        task.stakeAmount = 0;

        emit TaskReopened(taskId);
    }

    /**
     * @notice Rate a completed task
     * @param taskId Task identifier
     * @param rating Rating (1-5 stars)
     */
    function rateTask(bytes32 taskId, uint8 rating) external {
        Task storage task = tasks[taskId];
        require(msg.sender == task.requester, "Not requester");
        require(task.status == TaskStatus.Accepted, "Task not accepted");
        require(rating >= 1 && rating <= 5, "Rating must be 1-5");
        require(task.rating == 0, "Already rated");

        task.rating = rating;

        workerStats[task.worker].ratedTasks++;
        workerStats[task.worker].totalStars += rating;

        emit TaskRated(taskId, task.worker, rating);
    }

    /**
     * @notice Refund expired task
     * @param taskId Task identifier
     */
    function refundExpired(bytes32 taskId) external nonReentrant {
        Task storage task = tasks[taskId];
        require(task.requester != address(0), "Task does not exist");
        require(block.timestamp > task.expiryTime, "Task not expired");
        require(task.status != TaskStatus.Accepted, "Task already accepted");

        task.status = TaskStatus.Expired;
        uint256 refundAmount = task.reward;

        require(usdcToken.transfer(task.requester, refundAmount), "Refund failed");

        if (task.mode == TaskMode.Instant && task.stakeAmount > 0) {
            require(usdcToken.transfer(task.claimer, task.stakeAmount), "Stake return failed");
            emit StakeReturned(taskId, task.claimer, task.stakeAmount);
        }

        emit TaskExpired(taskId, task.requester, refundAmount);
    }

    /**
     * @notice Set default platform fee (owner only)
     * @param feeBps New fee in basis points
     */
    function setDefaultFeeBps(uint16 feeBps) external onlyOwner {
        require(feeBps <= 10000, "Fee BPS too high");
        defaultFeeBps = feeBps;
        emit FeesUpdated(feeBps);
    }

    /**
     * @notice Set fee recipient (owner only)
     * @param recipient New fee recipient address
     */
    function setFeeRecipient(address recipient) external onlyOwner {
        require(recipient != address(0), "Invalid recipient");
        feeRecipient = recipient;
        emit FeeRecipientUpdated(recipient);
    }

    /**
     * @notice Get worker statistics
     * @param worker Worker address
     * @return completedTasks Number of completed tasks
     * @return avgRating Average rating (scaled by 100)
     * @return ratedTasks Number of rated tasks
     */
    function getWorkerStats(address worker)
        external
        view
        returns (uint256 completedTasks, uint256 avgRating, uint256 ratedTasks)
    {
        WorkerStats memory stats = workerStats[worker];
        uint256 avg = stats.ratedTasks > 0 ? (stats.totalStars * 100) / stats.ratedTasks : 0;
        return (stats.completedTasks, avg, stats.ratedTasks);
    }

    /**
     * @notice Get task details
     * @param taskId Task identifier
     * @return task Task struct
     */
    function getTask(bytes32 taskId) external view returns (Task memory) {
        return tasks[taskId];
    }
}
