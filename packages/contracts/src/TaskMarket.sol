// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Initializable} from "openzeppelin-contracts-upgradeable/contracts/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "openzeppelin-contracts-upgradeable/contracts/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "openzeppelin-contracts-upgradeable/contracts/access/OwnableUpgradeable.sol";

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
 * @dev Supports Bounty, Claim, Pitch, Benchmark, and Auction modes with platform fees and staking.
 *      All mutating functions are called by the authorized server wallet, which passes
 *      the real requester/worker addresses explicitly. This ensures on-chain records
 *      attribute activity to the actual participants, not the server.
 *
 *      UUPS upgradeable — proxy address is permanent; only the implementation changes on upgrades.
 *      Storage layout rule: new state variables MUST be appended after existing ones and MUST
 *      consume slots from __gap (shrink __gap by the number of slots used). Never insert between
 *      existing variables.
 */
contract TaskMarket is Initializable, OwnableUpgradeable, ReentrancyGuard, UUPSUpgradeable {
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    IERC20 public usdcToken;

    /// @notice Server wallet authorized to call mutating functions on behalf of users
    address public authorizedServer;

    enum TaskMode {
        Bounty,
        Claim,
        Pitch,
        Benchmark,
        Auction
    }

    enum TaskStatus {
        Open,
        Claimed,
        WorkerSelected,
        PendingApproval,
        Accepted,
        Expired,
        Disputed,
        Cancelled
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
        uint256 pitchDeadline;
        uint16 feeBps;
        uint256 bidDeadline;
        uint256 maxPrice;
    }

    struct WorkerStats {
        uint256 completedTasks;
        uint256 ratedTasks;
        uint256 totalStars;
    }

    struct Bid {
        address worker;
        uint256 price;
    }

    mapping(bytes32 => Task) public tasks;
    mapping(address => WorkerStats) public workerStats;
    mapping(bytes32 => uint256) public stakeForfeit;
    mapping(bytes32 => Bid[]) public taskBids;

    uint16 public defaultFeeBps;
    address public feeRecipient;
    uint256 public totalFeesCollected;
    address public reputationRegistry;

    // Reserve 50 slots for future state variables. Consume from this gap when adding new vars.
    uint256[50] private __gap;

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
    event BidSubmitted(bytes32 indexed taskId, address indexed worker, uint256 price);
    event TaskCancelled(bytes32 indexed taskId, address indexed requester, uint256 refundAmount);
    event TaskUpdated(bytes32 indexed taskId, uint256 newReward, uint256 newExpiryTime);

    modifier onlyServer() {
        require(msg.sender == authorizedServer, "Not authorized server");
        _;
    }

    /**
     * @notice Initialize the proxy (replaces constructor for UUPS pattern)
     * @param _usdcToken USDC token address on Base
     * @param _feeRecipient Address to receive platform fees
     * @param _defaultFeeBps Default platform fee in basis points (500 = 5%)
     */
    function initialize(
        address _usdcToken,
        address _feeRecipient,
        uint16 _defaultFeeBps
    ) public initializer {
        __Ownable_init(msg.sender);
        require(_feeRecipient != address(0), "Invalid fee recipient");
        require(_defaultFeeBps <= 10000, "Fee BPS too high");
        usdcToken = IERC20(_usdcToken);
        feeRecipient = _feeRecipient;
        defaultFeeBps = _defaultFeeBps;
    }

    /**
     * @notice Authorize upgrade — only owner may upgrade the implementation
     * @dev Required by UUPSUpgradeable
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

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
     * @param reward USDC reward amount (6 decimals); for Auction mode this is the max price
     * @param duration Task duration in seconds
     * @param mode Task mode (Bounty/Claim/Pitch/Benchmark/Auction)
     * @param pitchDeadline Deadline for pitches (Pitch mode only, seconds from now)
     * @param bidDeadline Deadline for bids (Auction mode only, seconds from now)
     * @dev Server must have USDC approval for reward amount before calling.
     *      Server holds the USDC (received via X402 payment) and escrows it here.
     */
    function createTask(
        bytes32 taskId,
        address requester,
        uint256 reward,
        uint256 duration,
        TaskMode mode,
        uint256 pitchDeadline,
        uint256 bidDeadline
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
            pitchDeadline: mode == TaskMode.Pitch ? block.timestamp + pitchDeadline : 0,
            feeBps: defaultFeeBps,
            bidDeadline: mode == TaskMode.Auction ? block.timestamp + bidDeadline : 0,
            maxPrice: mode == TaskMode.Auction ? reward : 0
        });

        emit TaskCreated(taskId, requester, reward, block.timestamp + duration, mode);
    }

    /**
     * @notice Claim a Claim mode task on behalf of a worker
     * @param taskId Task identifier
     * @param worker Real worker wallet address (claim attributed on-chain to this address)
     * @param stakeAmount USDC stake amount (0 = no stake required)
     * @dev If stakeAmount > 0, server must have USDC approval for stake amount.
     */
    function claimTask(bytes32 taskId, address worker, uint256 stakeAmount) external onlyServer {
        Task storage task = tasks[taskId];
        require(task.requester != address(0), "Task does not exist");
        require(worker != address(0), "Invalid worker");
        require(task.mode == TaskMode.Claim, "Not a Claim task");
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
     * @notice Select a worker for Pitch mode
     * @param taskId Task identifier
     * @param requester Real requester wallet (must match task.requester)
     * @param worker Selected worker address
     */
    function selectWorker(bytes32 taskId, address requester, address worker) external onlyServer {
        Task storage task = tasks[taskId];
        require(requester == task.requester, "Not requester");
        require(task.mode == TaskMode.Pitch, "Not a Pitch task");
        require(task.status == TaskStatus.Open, "Task not available");
        require(block.timestamp <= task.pitchDeadline, "Pitch deadline passed");

        task.worker = worker;
        task.status = TaskStatus.WorkerSelected;

        emit TaskWorkerSelected(taskId, worker);
    }

    /**
     * @notice Submit a bid on an Auction mode task
     * @param taskId Task identifier
     * @param worker Real worker wallet address
     * @param price Bid price in USDC base units (must be <= maxPrice)
     */
    function submitBid(bytes32 taskId, address worker, uint256 price) external onlyServer {
        Task storage task = tasks[taskId];
        require(task.requester != address(0), "Task does not exist");
        require(task.mode == TaskMode.Auction, "Not an Auction task");
        require(task.status == TaskStatus.Open, "Task not open");
        require(block.timestamp < task.bidDeadline, "Bid deadline passed");
        require(price <= task.maxPrice, "Bid exceeds max price");

        taskBids[taskId].push(Bid({ worker: worker, price: price }));

        emit BidSubmitted(taskId, worker, price);
    }

    /**
     * @notice Select the lowest bidder after bid deadline (callable by server)
     * @param taskId Task identifier
     */
    function selectLowestBidder(bytes32 taskId) external onlyServer {
        Task storage task = tasks[taskId];
        require(task.requester != address(0), "Task does not exist");
        require(task.mode == TaskMode.Auction, "Not an Auction task");
        require(task.status == TaskStatus.Open, "Task not open");
        require(block.timestamp >= task.bidDeadline, "Bid deadline not passed");

        Bid[] storage bids = taskBids[taskId];
        require(bids.length > 0, "No bids submitted");

        uint256 lowestPrice = bids[0].price;
        address lowestBidder = bids[0].worker;

        for (uint256 i = 1; i < bids.length; i++) {
            if (bids[i].price < lowestPrice) {
                lowestPrice = bids[i].price;
                lowestBidder = bids[i].worker;
            }
        }

        task.worker = lowestBidder;
        task.stakeAmount = lowestPrice;
        task.status = TaskStatus.Claimed;

        emit TaskWorkerSelected(taskId, lowestBidder);
    }

    /**
     * @notice Directly award an open auction task to a worker at a given price.
     *         Used by clock-based auction subtypes (dutch, reverse_dutch) where
     *         the first worker to accept the current clock price wins immediately.
     *         The server enforces clock timing off-chain before calling this.
     * @param taskId Task identifier
     * @param worker Worker address accepting the clock price
     * @param price  Accepted price in USDC base units (must be <= task.maxPrice)
     */
    function acceptAuction(bytes32 taskId, address worker, uint256 price) external onlyServer {
        Task storage task = tasks[taskId];
        require(task.requester != address(0), "Task does not exist");
        require(task.mode == TaskMode.Auction, "Not an Auction task");
        require(task.status == TaskStatus.Open, "Task not open");
        require(price <= task.maxPrice, "Price exceeds max price");
        task.worker = worker;
        task.stakeAmount = price;
        task.status = TaskStatus.Claimed;
        emit BidSubmitted(taskId, worker, price);
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

        if (task.mode == TaskMode.Claim) {
            require(task.status == TaskStatus.Claimed, "Task not claimed");
            require(worker == task.claimer, "Worker must be claimer");
        } else if (task.mode == TaskMode.Pitch) {
            require(task.status == TaskStatus.WorkerSelected, "Worker not selected");
            require(worker == task.worker, "Worker mismatch");
        } else if (task.mode == TaskMode.Auction) {
            require(task.status == TaskStatus.Claimed, "Winner not selected");
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

        uint256 paymentAmount = task.mode == TaskMode.Auction ? task.stakeAmount : task.reward;
        uint256 fee = (paymentAmount * task.feeBps) / 10000;
        uint256 workerPayment = paymentAmount - fee;

        require(usdcToken.transfer(worker, workerPayment), "Worker payment failed");

        if (fee > 0) {
            require(usdcToken.transfer(feeRecipient, fee), "Fee transfer failed");
            totalFeesCollected += fee;
        }

        if (task.mode == TaskMode.Claim && task.stakeAmount > 0) {
            require(usdcToken.transfer(task.claimer, task.stakeAmount), "Stake return failed");
            emit StakeReturned(taskId, task.claimer, task.stakeAmount);
        }

        if (task.mode == TaskMode.Auction) {
            uint256 refund = task.maxPrice - task.stakeAmount;
            if (refund > 0) {
                require(usdcToken.transfer(task.requester, refund), "Auction refund failed");
            }
        }

        emit TaskAccepted(taskId, requester, worker, workerPayment, fee);
    }

    /**
     * @notice Forfeit claimer's stake and reopen Claim task
     * @param taskId Task identifier
     * @param requester Real requester wallet (must match task.requester)
     * @dev Can only be called after the task has expired. The claimer's stake is
     *      transferred to the fee recipient as a penalty for non-delivery.
     *      To recover the escrowed reward afterwards, call refundExpired.
     */
    function forfeitAndReopen(bytes32 taskId, address requester) external onlyServer {
        Task storage task = tasks[taskId];
        require(requester == task.requester, "Not requester");
        require(task.mode == TaskMode.Claim, "Not a Claim task");
        require(task.status == TaskStatus.Claimed, "Task not claimed");
        require(block.timestamp > task.expiryTime, "Task not yet expired");

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
     * @notice Refund expired task reward to requester.
     *         Special case: if an auction task has a selected winner (status=Claimed) and the
     *         requester never called acceptSubmission before expiry, this function auto-pays
     *         the winner at the agreed price rather than refunding the full reward.
     * @param taskId Task identifier
     */
    function refundExpired(bytes32 taskId) external nonReentrant {
        Task storage task = tasks[taskId];
        require(task.requester != address(0), "Task does not exist");
        require(block.timestamp > task.expiryTime, "Task not expired");
        require(task.status != TaskStatus.Accepted, "Task already accepted");
        require(task.status != TaskStatus.Cancelled, "Task cancelled");

        // Auction winner selected but requester abandoned — auto-pay the worker at the agreed price.
        // Must be handled before setting status=Expired so the correct status is stored.
        if (task.mode == TaskMode.Auction && task.status == TaskStatus.Claimed) {
            uint256 fee = (task.stakeAmount * task.feeBps) / 10000;
            uint256 workerPayment = task.stakeAmount - fee;
            task.status = TaskStatus.Accepted;
            workerStats[task.worker].completedTasks++;
            if (workerPayment > 0) {
                require(usdcToken.transfer(task.worker, workerPayment), "Worker payment failed");
            }
            if (fee > 0) {
                require(usdcToken.transfer(feeRecipient, fee), "Fee transfer failed");
                totalFeesCollected += fee;
            }
            uint256 refund = task.reward - task.stakeAmount;
            if (refund > 0) {
                require(usdcToken.transfer(task.requester, refund), "Requester refund failed");
            }
            emit TaskAccepted(taskId, task.requester, task.worker, workerPayment, fee);
            return;
        }

        task.status = TaskStatus.Expired;
        uint256 refundAmount = task.reward;

        require(usdcToken.transfer(task.requester, refundAmount), "Refund failed");

        if (task.mode == TaskMode.Claim && task.stakeAmount > 0) {
            require(usdcToken.transfer(task.claimer, task.stakeAmount), "Stake return failed");
            emit StakeReturned(taskId, task.claimer, task.stakeAmount);
        }

        emit TaskExpired(taskId, task.requester, refundAmount);
    }

    /**
     * @notice Cancel an open task and refund the escrowed reward to the requester.
     *         Auction tasks may only be cancelled if no bids have been submitted.
     * @param taskId Task identifier
     * @param requester Real requester wallet (must match task.requester)
     */
    function cancelTask(bytes32 taskId, address requester) external onlyServer nonReentrant {
        Task storage task = tasks[taskId];
        require(task.requester != address(0), "Task does not exist");
        require(requester == task.requester, "Not requester");
        require(task.status == TaskStatus.Open, "Task not open");
        if (task.mode == TaskMode.Auction) {
            require(taskBids[taskId].length == 0, "Bids exist");
        }
        task.status = TaskStatus.Cancelled;
        uint256 refundAmount = task.reward;
        require(usdcToken.transfer(task.requester, refundAmount), "Refund failed");
        emit TaskCancelled(taskId, task.requester, refundAmount);
    }

    /**
     * @notice Update an open task's parameters.
     *         Pass 0 for any field to leave it unchanged.
     *         Auction tasks may only be updated if no bids have been submitted.
     *         auctionFloorPrice and auctionStartPrice are DB-only fields updated by the backend.
     * @param taskId Task identifier
     * @param requester Real requester wallet (must match task.requester)
     * @param newReward New reward amount (0 = no change); if higher, server must have USDC approval
     * @param newExpiryTime New absolute expiry Unix timestamp (0 = no change); must be in future
     * @param newBidDeadline New absolute bid deadline Unix timestamp (auction only, 0 = no change)
     * @param newPitchDeadline New absolute pitch deadline Unix timestamp (pitch only, 0 = no change)
     */
    function updateTask(
        bytes32 taskId,
        address requester,
        uint256 newReward,
        uint256 newExpiryTime,
        uint256 newBidDeadline,
        uint256 newPitchDeadline
    ) external onlyServer nonReentrant {
        Task storage task = tasks[taskId];
        require(task.requester != address(0), "Task does not exist");
        require(requester == task.requester, "Not requester");
        require(task.status == TaskStatus.Open, "Task not open");
        if (task.mode == TaskMode.Auction) {
            require(taskBids[taskId].length == 0, "Bids exist");
        }

        uint256 originalReward = task.reward;
        uint256 originalExpiryTime = task.expiryTime;

        if (newReward != 0 && newReward != task.reward) {
            if (newReward > task.reward) {
                uint256 additional = newReward - task.reward;
                require(usdcToken.transferFrom(msg.sender, address(this), additional), "USDC transfer failed");
            } else {
                uint256 refund = task.reward - newReward;
                require(usdcToken.transfer(task.requester, refund), "USDC refund failed");
            }
            task.reward = newReward;
            if (task.mode == TaskMode.Auction) {
                task.maxPrice = newReward;
            }
        }
        if (newExpiryTime != 0) {
            require(newExpiryTime > block.timestamp, "Expiry must be in future");
            task.expiryTime = newExpiryTime;
        }
        if (newBidDeadline != 0 && task.mode == TaskMode.Auction) {
            require(newBidDeadline > block.timestamp, "Bid deadline must be in future");
            task.bidDeadline = newBidDeadline;
        }
        if (newPitchDeadline != 0 && task.mode == TaskMode.Pitch) {
            require(newPitchDeadline > block.timestamp, "Pitch deadline must be in future");
            task.pitchDeadline = newPitchDeadline;
        }

        bool changed = (newReward != 0 && newReward != originalReward)
            || (newExpiryTime != 0 && newExpiryTime != originalExpiryTime)
            || (newBidDeadline != 0 && task.mode == TaskMode.Auction)
            || (newPitchDeadline != 0 && task.mode == TaskMode.Pitch);
        if (changed) {
            emit TaskUpdated(taskId, task.reward, task.expiryTime);
        }
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

    /**
     * @notice Get all bids for a task
     * @param taskId Task identifier
     * @return bids Array of Bid structs
     */
    function getBids(bytes32 taskId) external view returns (Bid[] memory) {
        return taskBids[taskId];
    }
}
