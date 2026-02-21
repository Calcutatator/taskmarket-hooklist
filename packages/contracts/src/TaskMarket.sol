// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IReputationRegistry {
    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8 valueDecimals,
        string calldata tag1,
        string calldata tag2,
        string calldata endpoint,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) external;
}

/**
 * @title TaskMarket
 * @notice Multi-mode decentralized task marketplace with USDC escrow on Base L2
 * @dev Supports Contest, Instant, Proposal, and Race modes with platform fees and staking.
 *      All mutating functions are called by the authorized server wallet, which passes
 *      the real requester/worker addresses explicitly. This ensures on-chain records
 *      attribute activity to the actual participants, not the server.
 */
contract TaskMarket is ReentrancyGuard, Ownable {
    IERC20 public immutable usdcToken;

    /// @notice Server wallet authorized to call mutating functions on behalf of users
    address public authorizedServer;

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
    address public reputationRegistry;

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
    event AuthorizedServerUpdated(address newServer);
    event ReputationRegistryUpdated(address newRegistry);

    modifier onlyServer() {
        require(msg.sender == authorizedServer, "Not authorized server");
        _;
    }

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
     * @notice Set the ERC-8004 reputation registry address (owner only)
     * @param registry New reputation registry address
     */
    function setReputationRegistry(address registry) external onlyOwner {
        reputationRegistry = registry;
        emit ReputationRegistryUpdated(registry);
    }

    /**
     * @notice Set the authorized server address (owner only)
     * @param server New authorized server wallet
     */
    function setAuthorizedServer(address server) external onlyOwner {
        require(server != address(0), "Invalid server address");
        authorizedServer = server;
        emit AuthorizedServerUpdated(server);
    }

    /**
     * @notice Create a new task with USDC escrow
     * @param taskId Unique task identifier
     * @param requester Real requester wallet address (task attributed on-chain to this address)
     * @param reward USDC reward amount (6 decimals)
     * @param duration Task duration in seconds
     * @param mode Task mode (Contest/Instant/Proposal/Race)
     * @param proposalDeadline Deadline for proposals (Proposal mode only, seconds from now)
     * @dev Server must have USDC approval for reward amount before calling.
     *      Server holds the USDC (received via X402 payment) and escrows it here.
     */
    function createTask(
        bytes32 taskId,
        address requester,
        uint256 reward,
        uint256 duration,
        TaskMode mode,
        uint256 proposalDeadline
    ) external onlyServer {
        require(requester != address(0), "Invalid requester");
        require(reward > 0, "Reward must be greater than 0");
        require(duration > 0, "Duration must be greater than 0");
        require(tasks[taskId].requester == address(0), "Task already exists");

        require(usdcToken.transferFrom(msg.sender, address(this), reward), "USDC transfer failed");

        tasks[taskId] = Task({
            id: taskId,
            requester: requester,
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

        emit TaskCreated(taskId, requester, reward, block.timestamp + duration, mode);
    }

    /**
     * @notice Claim an Instant mode task on behalf of a worker
     * @param taskId Task identifier
     * @param worker Real worker wallet address (claim attributed on-chain to this address)
     * @param stakeAmount USDC stake amount (0 = no stake required)
     * @dev If stakeAmount > 0, server must have USDC approval for stake amount.
     */
    function claimTask(bytes32 taskId, address worker, uint256 stakeAmount) external onlyServer {
        Task storage task = tasks[taskId];
        require(task.requester != address(0), "Task does not exist");
        require(worker != address(0), "Invalid worker");
        require(task.mode == TaskMode.Instant, "Not an Instant task");
        require(task.status == TaskStatus.Open, "Task not available");
        require(block.timestamp <= task.expiryTime, "Task expired");

        if (stakeAmount > 0) {
            require(usdcToken.transferFrom(msg.sender, address(this), stakeAmount), "Stake transfer failed");
        }

        task.claimer = worker;
        task.claimedAt = block.timestamp;
        task.stakeAmount = stakeAmount;
        task.status = TaskStatus.Claimed;

        emit TaskClaimed(taskId, worker, stakeAmount);
    }

    /**
     * @notice Select a worker for Proposal mode
     * @param taskId Task identifier
     * @param requester Real requester wallet (must match task.requester)
     * @param worker Selected worker address
     */
    function selectWorker(bytes32 taskId, address requester, address worker) external onlyServer {
        Task storage task = tasks[taskId];
        require(requester == task.requester, "Not requester");
        require(task.mode == TaskMode.Proposal, "Not a Proposal task");
        require(task.status == TaskStatus.Open, "Task not available");
        require(block.timestamp <= task.proposalDeadline, "Proposal deadline passed");

        task.worker = worker;
        task.status = TaskStatus.WorkerSelected;

        emit TaskWorkerSelected(taskId, worker);
    }

    /**
     * @notice Accept submission and release payment to worker
     * @param taskId Task identifier
     * @param requester Real requester wallet (must match task.requester)
     * @param worker Worker address to pay
     */
    function acceptSubmission(bytes32 taskId, address requester, address worker) external onlyServer nonReentrant {
        Task storage task = tasks[taskId];
        require(requester == task.requester, "Not requester");
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

        emit TaskAccepted(taskId, requester, worker, workerPayment, fee);
    }

    /**
     * @notice Forfeit claimer's stake and reopen Instant task
     * @param taskId Task identifier
     * @param requester Real requester wallet (must match task.requester)
     */
    function forfeitAndReopen(bytes32 taskId, address requester) external onlyServer {
        Task storage task = tasks[taskId];
        require(requester == task.requester, "Not requester");
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
     * @param requester Real requester wallet (must match task.requester)
     * @param rating Rating (0-100)
     * @param workerAgentId ERC-8004 agentId of the worker, or 0 if unknown
     * @param feedbackURI URI of the canonical off-chain feedback file
     * @param feedbackHash keccak256 hash of the feedback file content
     */
    function rateTask(
        bytes32 taskId,
        address requester,
        uint8 rating,
        uint256 workerAgentId,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) external onlyServer {
        Task storage task = tasks[taskId];
        require(requester == task.requester, "Not requester");
        require(task.status == TaskStatus.Accepted, "Task not accepted");
        require(rating <= 100, "Rating must be 0-100");
        require(task.rating == 0, "Already rated");

        task.rating = rating;

        workerStats[task.worker].ratedTasks++;
        workerStats[task.worker].totalStars += rating;

        emit TaskRated(taskId, task.worker, rating);

        if (workerAgentId != 0 && reputationRegistry != address(0)) {
            try IReputationRegistry(reputationRegistry).giveFeedback(
                workerAgentId,
                int128(int256(uint256(rating))),
                0,
                "starred",
                "",
                "",
                feedbackURI,
                feedbackHash
            ) {} catch {}
        }
    }

    /**
     * @notice Refund expired task reward to requester
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
