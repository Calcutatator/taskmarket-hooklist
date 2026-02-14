// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title TaskMarket
 * @notice Decentralized task marketplace with USDC escrow on Base L2
 * @dev Uses USDC (ERC20) for payments, not native ETH
 */
contract TaskMarket is ReentrancyGuard {
    IERC20 public immutable usdcToken;

    enum TaskStatus {
        Open,
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
    }

    struct WorkerStats {
        uint256 completedTasks;
        uint256 ratedTasks;
        uint256 totalStars;
    }

    mapping(bytes32 => Task) public tasks;
    mapping(address => WorkerStats) public workerStats;

    event TaskCreated(bytes32 indexed taskId, address indexed requester, uint256 reward, uint256 expiryTime);

    event TaskAccepted(bytes32 indexed taskId, address indexed requester, address indexed worker, uint256 reward);

    event TaskRated(bytes32 indexed taskId, address indexed worker, uint8 rating);

    event TaskExpired(bytes32 indexed taskId, address indexed requester, uint256 refundAmount);

    /**
     * @notice Constructor to set the USDC token address
     * @param _usdcToken Address of the USDC token contract on Base
     * @dev Base Mainnet: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
     * @dev Base Sepolia: 0x036CbD53842c5426634e7929541eC2318f3dCF7e
     */
    constructor(address _usdcToken) {
        usdcToken = IERC20(_usdcToken);
    }

    /**
     * @notice Create a new task with USDC escrow
     * @param taskId Unique task identifier (bytes32)
     * @param reward Amount of USDC to escrow (6 decimals: 1 USDC = 1,000,000)
     * @param duration Task duration in seconds
     * @dev Requires prior USDC approval for this contract
     */
    function createTask(bytes32 taskId, uint256 reward, uint256 duration) external {
        require(reward > 0, "Reward must be greater than 0");
        require(duration > 0, "Duration must be greater than 0");
        require(tasks[taskId].requester == address(0), "Task already exists");

        // Transfer USDC from requester to contract
        require(usdcToken.transferFrom(msg.sender, address(this), reward), "USDC transfer failed");

        tasks[taskId] = Task({
            id: taskId,
            requester: msg.sender,
            worker: address(0),
            reward: reward,
            createdAt: block.timestamp,
            expiryTime: block.timestamp + duration,
            status: TaskStatus.Open,
            rating: 0
        });

        emit TaskCreated(taskId, msg.sender, reward, block.timestamp + duration);
    }

    /**
     * @notice Accept a submission and release USDC payment to worker
     * @param taskId Task identifier
     * @param worker Address of the worker to pay
     */
    function acceptSubmission(bytes32 taskId, address worker) external nonReentrant {
        Task storage task = tasks[taskId];
        require(msg.sender == task.requester, "Not requester");
        require(
            task.status == TaskStatus.Open || task.status == TaskStatus.PendingApproval, "Task not available"
        );
        require(block.timestamp <= task.expiryTime, "Task expired");

        task.status = TaskStatus.Accepted;
        task.worker = worker;

        workerStats[worker].completedTasks++;

        // Transfer USDC to worker
        require(usdcToken.transfer(worker, task.reward), "USDC transfer failed");

        emit TaskAccepted(taskId, msg.sender, worker, task.reward);
    }

    /**
     * @notice Rate a completed task (1-5 stars)
     * @param taskId Task identifier
     * @param rating Rating value (1-5)
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
     * @notice Refund USDC to requester for an expired task
     * @param taskId Task identifier
     */
    function refundExpired(bytes32 taskId) external nonReentrant {
        Task storage task = tasks[taskId];
        require(task.requester != address(0), "Task does not exist");
        require(block.timestamp > task.expiryTime, "Task not expired");
        require(task.status != TaskStatus.Accepted, "Task already accepted");

        task.status = TaskStatus.Expired;
        uint256 refundAmount = task.reward;

        // Transfer USDC back to requester
        require(usdcToken.transfer(task.requester, refundAmount), "USDC transfer failed");

        emit TaskExpired(taskId, task.requester, refundAmount);
    }

    /**
     * @notice Get worker statistics
     * @param worker Worker address
     * @return completedTasks Number of completed tasks
     * @return avgRating Average rating (scaled by 100, e.g., 450 = 4.50 stars)
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
