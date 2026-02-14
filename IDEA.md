# Task Market - Complete Specification & Implementation Plan (TypeScript Monorepo)

## System Overview

A decentralized task marketplace where requesters post tasks with USDC escrow, workers complete tasks and submit encrypted results, and payments are released upon acceptance with optional ratings.

**Tech Stack:**

- **Monorepo:** Turborepo or Nx
- **Language:** TypeScript throughout
- **Blockchain:** Base L2
- **Wallet:** Coinbase Agentic Wallet
- **Smart Contract:** Solidity
- **Backend:** Node.js + Express + PostgreSQL + S3
- **CLI:** Node.js (Commander.js or oclif)
- **Frontend:** Next.js 14

---

## Monorepo Structure

```
task-market/
├── packages/
│   ├── contracts/              # Solidity contracts
│   │   ├── contracts/
│   │   │   └── TaskMarket.sol
│   │   ├── test/
│   │   │   └── TaskMarket.test.ts
│   │   ├── scripts/
│   │   │   └── deploy.ts
│   │   ├── hardhat.config.ts
│   │   └── package.json
│   │
│   ├── shared/                 # Shared types & utils
│   │   ├── src/
│   │   │   ├── types/
│   │   │   │   ├── task.ts
│   │   │   │   ├── submission.ts
│   │   │   │   └── agent.ts
│   │   │   ├── constants.ts
│   │   │   └── utils/
│   │   │       ├── encryption.ts
│   │   │       └── validation.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   ├── api/                    # Backend API
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   │   ├── tasks.ts
│   │   │   │   ├── submissions.ts
│   │   │   │   └── agents.ts
│   │   │   ├── services/
│   │   │   │   ├── indexer.ts
│   │   │   │   ├── storage.ts
│   │   │   │   └── blockchain.ts
│   │   │   ├── db/
│   │   │   │   ├── client.ts
│   │   │   │   └── schema.ts
│   │   │   └── server.ts
│   │   ├── migrations/
│   │   │   └── 001_initial_schema.sql
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   ├── cli/                    # CLI tool
│   │   ├── src/
│   │   │   ├── commands/
│   │   │   │   ├── create.ts
│   │   │   │   ├── submit.ts
│   │   │   │   ├── accept.ts
│   │   │   │   ├── search.ts
│   │   │   │   └── stats.ts
│   │   │   ├── lib/
│   │   │   │   ├── awal.ts
│   │   │   │   ├── api-client.ts
│   │   │   │   └── crypto.ts
│   │   │   ├── config.ts
│   │   │   └── index.ts
│   │   ├── bin/
│   │   │   └── task-market.js
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   └── frontend/               # Next.js frontend
│       ├── app/
│       │   ├── page.tsx
│       │   ├── create/
│       │   ├── tasks/
│       │   └── leaderboard/
│       ├── components/
│       ├── lib/
│       ├── tsconfig.json
│       └── package.json
│
├── turbo.json                  # Turborepo config
├── package.json                # Root package.json
└── tsconfig.json               # Base TypeScript config
```

---

## Part 1: Shared Package

### packages/shared/src/types/task.ts

```typescript
export enum TaskStatus {
  Open = "open",
  PendingApproval = "pending_approval",
  Accepted = "accepted",
  Expired = "expired",
  Disputed = "disputed",
}

export interface Task {
  id: string; // bytes32 as hex string
  requester: string; // Ethereum address
  requesterPublicKey: string;
  description: string;
  reward: bigint; // Wei amount
  escrowTxHash: string;
  createdAt: Date;
  expiryTime: Date;
  status: TaskStatus;
  tags: string[];
  rating?: number; // 1-5 or undefined
  worker?: string; // Set when accepted
}

export interface CreateTaskRequest {
  description: string;
  reward: number; // USDC amount (human-readable)
  duration: number; // Hours
  tags: string[];
}

export interface CreateTaskResponse {
  taskId: string;
  escrowTxHash: string;
}
```

### packages/shared/src/types/submission.ts

```typescript
export interface Submission {
  id: string;
  taskId: string;
  workerAddress: string;
  encryptedFileUrl: string;
  encryptedKeyBundle: string; // Base64 encoded
  signature: string;
  submittedAt: Date;
}

export interface SubmitTaskRequest {
  taskId: string;
  filePath: string;
}

export interface DownloadRequest {
  acceptanceTxHash: string;
}

export interface DownloadResponse {
  fileUrl: string;
  encryptedKeyBundle: string;
  expiresAt: Date;
}
```

### packages/shared/src/types/agent.ts

```typescript
export interface AgentStats {
  address: string;
  completedTasks: number;
  ratedTasks: number;
  totalStars: number;
  averageRating: number;
  totalEarnings: bigint;
  recentRatings?: Rating[];
}

export interface Rating {
  taskId: string;
  rating: number;
  timestamp: Date;
}

export interface LeaderboardEntry {
  rank: number;
  address: string;
  completedTasks: number;
  averageRating: number;
}
```

### packages/shared/src/utils/encryption.ts

```typescript
import { randomBytes, createCipheriv, createDecipheriv } from "crypto";
import { publicEncrypt, privateDecrypt } from "crypto";

export class Encryptor {
  /**
   * Encrypts a file for a specific recipient's public key
   */
  static async encryptFile(
    fileBuffer: Buffer,
    recipientPublicKey: string
  ): Promise<{ encryptedFile: Buffer; encryptedKey: string }> {
    // Generate random AES-256 key
    const symmetricKey = randomBytes(32);
    const iv = randomBytes(16);

    // Encrypt file with AES
    const cipher = createCipheriv("aes-256-cbc", symmetricKey, iv);
    const encryptedFile = Buffer.concat([
      iv,
      cipher.update(fileBuffer),
      cipher.final(),
    ]);

    // Encrypt symmetric key with recipient's public key (RSA)
    const publicKey = `-----BEGIN PUBLIC KEY-----\n${recipientPublicKey}\n-----END PUBLIC KEY-----`;
    const encryptedKey = publicEncrypt(
      {
        key: publicKey,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256",
      },
      symmetricKey
    );

    return {
      encryptedFile,
      encryptedKey: encryptedKey.toString("base64"),
    };
  }

  /**
   * Decrypts a file using private key
   */
  static async decryptFile(
    encryptedFile: Buffer,
    encryptedKey: string,
    privateKey: string
  ): Promise<Buffer> {
    // Decrypt symmetric key with private key
    const privateKeyPem = `-----BEGIN PRIVATE KEY-----\n${privateKey}\n-----END PRIVATE KEY-----`;
    const symmetricKey = privateDecrypt(
      {
        key: privateKeyPem,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256",
      },
      Buffer.from(encryptedKey, "base64")
    );

    // Extract IV and decrypt file
    const iv = encryptedFile.slice(0, 16);
    const encrypted = encryptedFile.slice(16);

    const decipher = createDecipheriv("aes-256-cbc", symmetricKey, iv);
    const decryptedFile = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    return decryptedFile;
  }
}
```

### packages/shared/src/constants.ts

```typescript
export const CONTRACTS = {
  TASK_MARKET: {
    "base-mainnet": "0x...",
    "base-sepolia": "0x...",
  },
} as const;

export const API_ENDPOINTS = {
  production: "https://api.taskmarket.xyz",
  staging: "https://staging-api.taskmarket.xyz",
  development: "http://localhost:3000",
} as const;

export const VALIDATION = {
  MIN_REWARD: 1, // 1 USDC minimum
  MAX_REWARD: 10000, // 10k USDC maximum
  MIN_DURATION: 1, // 1 hour minimum
  MAX_DURATION: 168, // 7 days maximum
  MAX_FILE_SIZE: 50 * 1024 * 1024, // 50MB
  MAX_DESCRIPTION_LENGTH: 1000,
} as const;
```

---

## Part 2: Smart Contract Package

### packages/contracts/contracts/TaskMarket.sol

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract TaskMarket is ReentrancyGuard {
    enum TaskStatus { Open, PendingApproval, Accepted, Expired, Disputed }

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

    event TaskCreated(
        bytes32 indexed taskId,
        address indexed requester,
        uint256 reward,
        uint256 expiryTime
    );

    event TaskAccepted(
        bytes32 indexed taskId,
        address indexed requester,
        address indexed worker,
        uint256 reward
    );

    event TaskRated(
        bytes32 indexed taskId,
        address indexed worker,
        uint8 rating
    );

    event TaskExpired(
        bytes32 indexed taskId,
        address indexed requester,
        uint256 refundAmount
    );

    function createTask(bytes32 taskId, uint256 duration) external payable {
        require(msg.value > 0, "Reward must be greater than 0");
        require(duration > 0, "Duration must be greater than 0");
        require(tasks[taskId].requester == address(0), "Task already exists");

        tasks[taskId] = Task({
            id: taskId,
            requester: msg.sender,
            worker: address(0),
            reward: msg.value,
            createdAt: block.timestamp,
            expiryTime: block.timestamp + duration,
            status: TaskStatus.Open,
            rating: 0
        });

        emit TaskCreated(taskId, msg.sender, msg.value, block.timestamp + duration);
    }

    function acceptSubmission(bytes32 taskId, address worker)
        external
        nonReentrant
    {
        Task storage task = tasks[taskId];
        require(msg.sender == task.requester, "Not requester");
        require(
            task.status == TaskStatus.Open || task.status == TaskStatus.PendingApproval,
            "Task not open"
        );
        require(block.timestamp <= task.expiryTime, "Task expired");

        task.status = TaskStatus.Accepted;
        task.worker = worker;

        workerStats[worker].completedTasks++;

        payable(worker).transfer(task.reward);

        emit TaskAccepted(taskId, msg.sender, worker, task.reward);
    }

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

    function refundExpired(bytes32 taskId) external nonReentrant {
        Task storage task = tasks[taskId];
        require(task.requester != address(0), "Task does not exist");
        require(block.timestamp > task.expiryTime, "Task not expired");
        require(task.status != TaskStatus.Accepted, "Task already accepted");

        task.status = TaskStatus.Expired;
        uint256 refundAmount = task.reward;

        payable(task.requester).transfer(refundAmount);

        emit TaskExpired(taskId, task.requester, refundAmount);
    }

    function getWorkerStats(address worker)
        external
        view
        returns (uint256 completedTasks, uint256 avgRating, uint256 ratedTasks)
    {
        WorkerStats memory stats = workerStats[worker];
        uint256 avg = stats.ratedTasks > 0
            ? (stats.totalStars * 100) / stats.ratedTasks
            : 0;
        return (stats.completedTasks, avg, stats.ratedTasks);
    }

    function getTask(bytes32 taskId) external view returns (Task memory) {
        return tasks[taskId];
    }
}
```

### packages/contracts/test/TaskMarket.test.ts

```typescript
import { expect } from "chai";
import { ethers } from "hardhat";
import { TaskMarket } from "../typechain-types";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

describe("TaskMarket", () => {
  let taskMarket: TaskMarket;
  let requester: SignerWithAddress;
  let worker: SignerWithAddress;

  const taskId = ethers.utils.formatBytes32String("task1");
  const reward = ethers.utils.parseEther("100"); // 100 USDC
  const duration = 86400; // 24 hours

  beforeEach(async () => {
    [requester, worker] = await ethers.getSigners();

    const TaskMarketFactory = await ethers.getContractFactory("TaskMarket");
    taskMarket = await TaskMarketFactory.deploy();
    await taskMarket.deployed();
  });

  describe("createTask", () => {
    it("should create task with escrow", async () => {
      await expect(
        taskMarket
          .connect(requester)
          .createTask(taskId, duration, { value: reward })
      )
        .to.emit(taskMarket, "TaskCreated")
        .withArgs(taskId, requester.address, reward, anyValue);

      const task = await taskMarket.getTask(taskId);
      expect(task.requester).to.equal(requester.address);
      expect(task.reward).to.equal(reward);
    });

    it("should revert if reward is 0", async () => {
      await expect(
        taskMarket.connect(requester).createTask(taskId, duration, { value: 0 })
      ).to.be.revertedWith("Reward must be greater than 0");
    });
  });

  describe("acceptSubmission", () => {
    beforeEach(async () => {
      await taskMarket
        .connect(requester)
        .createTask(taskId, duration, { value: reward });
    });

    it("should accept submission and pay worker", async () => {
      const workerBalanceBefore = await worker.getBalance();

      await expect(
        taskMarket.connect(requester).acceptSubmission(taskId, worker.address)
      )
        .to.emit(taskMarket, "TaskAccepted")
        .withArgs(taskId, requester.address, worker.address, reward);

      const workerBalanceAfter = await worker.getBalance();
      expect(workerBalanceAfter.sub(workerBalanceBefore)).to.equal(reward);

      const stats = await taskMarket.getWorkerStats(worker.address);
      expect(stats.completedTasks).to.equal(1);
    });

    it("should revert if not requester", async () => {
      await expect(
        taskMarket.connect(worker).acceptSubmission(taskId, worker.address)
      ).to.be.revertedWith("Not requester");
    });
  });

  describe("rateTask", () => {
    beforeEach(async () => {
      await taskMarket
        .connect(requester)
        .createTask(taskId, duration, { value: reward });
      await taskMarket
        .connect(requester)
        .acceptSubmission(taskId, worker.address);
    });

    it("should rate task and update stats", async () => {
      await expect(taskMarket.connect(requester).rateTask(taskId, 5))
        .to.emit(taskMarket, "TaskRated")
        .withArgs(taskId, worker.address, 5);

      const stats = await taskMarket.getWorkerStats(worker.address);
      expect(stats.ratedTasks).to.equal(1);
      expect(stats.avgRating).to.equal(500); // 5.00 * 100
    });

    it("should prevent double rating", async () => {
      await taskMarket.connect(requester).rateTask(taskId, 5);

      await expect(
        taskMarket.connect(requester).rateTask(taskId, 4)
      ).to.be.revertedWith("Already rated");
    });
  });

  describe("refundExpired", () => {
    it("should refund expired task", async () => {
      await taskMarket
        .connect(requester)
        .createTask(taskId, 1, { value: reward });

      // Fast forward time
      await ethers.provider.send("evm_increaseTime", [2]);
      await ethers.provider.send("evm_mine", []);

      const requesterBalanceBefore = await requester.getBalance();

      await taskMarket.connect(requester).refundExpired(taskId);

      const requesterBalanceAfter = await requester.getBalance();
      expect(requesterBalanceAfter).to.be.gt(requesterBalanceBefore);
    });
  });
});
```

---

## Part 3: API Package

### packages/api/src/db/schema.ts

```typescript
import { Pool } from "pg";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const createTables = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id VARCHAR(66) PRIMARY KEY,
      requester VARCHAR(42) NOT NULL,
      requester_pubkey TEXT NOT NULL,
      description TEXT NOT NULL,
      reward NUMERIC(78,0) NOT NULL,
      escrow_tx_hash VARCHAR(66) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      expiry_time TIMESTAMP NOT NULL,
      status VARCHAR(20) NOT NULL,
      tags TEXT[],
      worker VARCHAR(42),
      rating SMALLINT
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_expiry ON tasks(expiry_time);
    CREATE INDEX IF NOT EXISTS idx_tasks_tags ON tasks USING GIN(tags);

    CREATE TABLE IF NOT EXISTS submissions (
      id VARCHAR(66) PRIMARY KEY,
      task_id VARCHAR(66) REFERENCES tasks(id),
      worker_address VARCHAR(42) NOT NULL,
      encrypted_file_url TEXT NOT NULL,
      encrypted_key_bundle TEXT NOT NULL,
      signature TEXT NOT NULL,
      submitted_at TIMESTAMP DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_submissions_task ON submissions(task_id);
    CREATE INDEX IF NOT EXISTS idx_submissions_worker ON submissions(worker_address);

    CREATE TABLE IF NOT EXISTS agents (
      address VARCHAR(42) PRIMARY KEY,
      completed_tasks INT DEFAULT 0,
      rated_tasks INT DEFAULT 0,
      total_stars INT DEFAULT 0,
      total_earnings NUMERIC(78,0) DEFAULT 0,
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_agents_rating ON agents((total_stars::float / NULLIF(rated_tasks, 0)));
    CREATE INDEX IF NOT EXISTS idx_agents_completed ON agents(completed_tasks);

    CREATE TABLE IF NOT EXISTS ratings (
      id SERIAL PRIMARY KEY,
      task_id VARCHAR(66) REFERENCES tasks(id),
      worker_address VARCHAR(42) NOT NULL,
      rating SMALLINT NOT NULL CHECK (rating >= 1 AND rating <= 5),
      block_number BIGINT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_ratings_worker ON ratings(worker_address);
    CREATE INDEX IF NOT EXISTS idx_ratings_created ON ratings(created_at);
  `);
};
```

### packages/api/src/services/indexer.ts

```typescript
import { ethers } from "ethers";
import { pool } from "../db/schema";
import TaskMarketABI from "@task-market/contracts/artifacts/contracts/TaskMarket.sol/TaskMarket.json";

export class Indexer {
  private contract: ethers.Contract;
  private provider: ethers.providers.JsonRpcProvider;

  constructor(contractAddress: string, rpcUrl: string) {
    this.provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    this.contract = new ethers.Contract(
      contractAddress,
      TaskMarketABI.abi,
      this.provider
    );
  }

  async start() {
    console.log("Starting event indexer...");

    // Sync historical events
    await this.syncHistoricalEvents();

    // Listen to new events
    this.listenToEvents();
  }

  private async syncHistoricalEvents() {
    const currentBlock = await this.provider.getBlockNumber();
    const deployBlock = parseInt(process.env.CONTRACT_DEPLOY_BLOCK || "0");

    console.log(`Syncing events from block ${deployBlock} to ${currentBlock}`);

    const acceptedEvents = await this.contract.queryFilter(
      this.contract.filters.TaskAccepted(),
      deployBlock,
      currentBlock
    );

    for (const event of acceptedEvents) {
      await this.handleTaskAccepted(event as any);
    }

    const ratedEvents = await this.contract.queryFilter(
      this.contract.filters.TaskRated(),
      deployBlock,
      currentBlock
    );

    for (const event of ratedEvents) {
      await this.handleTaskRated(event as any);
    }

    console.log("Historical sync complete");
  }

  private listenToEvents() {
    this.contract.on(
      "TaskAccepted",
      async (taskId, requester, worker, reward, event) => {
        await this.handleTaskAccepted({
          taskId,
          requester,
          worker,
          reward,
          event,
        });
      }
    );

    this.contract.on("TaskRated", async (taskId, worker, rating, event) => {
      await this.handleTaskRated({ taskId, worker, rating, event });
    });

    this.contract.on(
      "TaskExpired",
      async (taskId, requester, refundAmount, event) => {
        await pool.query(`UPDATE tasks SET status = 'expired' WHERE id = $1`, [
          taskId,
        ]);
      }
    );
  }

  private async handleTaskAccepted(data: any) {
    const { taskId, worker, reward } = data;

    // Update agent stats
    await pool.query(
      `
      INSERT INTO agents (address, completed_tasks, total_earnings)
      VALUES ($1, 1, $2)
      ON CONFLICT (address) DO UPDATE SET
        completed_tasks = agents.completed_tasks + 1,
        total_earnings = agents.total_earnings + $2,
        updated_at = NOW()
    `,
      [worker, reward.toString()]
    );

    // Update task status
    await pool.query(
      `
      UPDATE tasks SET status = 'accepted', worker = $2 WHERE id = $1
    `,
      [taskId, worker]
    );

    console.log(`Task ${taskId} accepted by ${worker}`);
  }

  private async handleTaskRated(data: any) {
    const { taskId, worker, rating, event } = data;

    // Update agent stats
    await pool.query(
      `
      UPDATE agents SET
        rated_tasks = rated_tasks + 1,
        total_stars = total_stars + $2,
        updated_at = NOW()
      WHERE address = $1
    `,
      [worker, rating]
    );

    // Store individual rating
    await pool.query(
      `
      INSERT INTO ratings (task_id, worker_address, rating, block_number)
      VALUES ($1, $2, $3, $4)
    `,
      [taskId, worker, rating, event.blockNumber]
    );

    // Update task
    await pool.query(
      `
      UPDATE tasks SET rating = $2 WHERE id = $1
    `,
      [taskId, rating]
    );

    console.log(`Task ${taskId} rated ${rating} stars`);
  }
}
```

### packages/api/src/routes/tasks.ts

```typescript
import { Router } from "express";
import { pool } from "../db/schema";
import type { Task, CreateTaskRequest } from "@task-market/shared";

export const tasksRouter = Router();

tasksRouter.post("/", async (req, res) => {
  const {
    id,
    requester,
    requesterPublicKey,
    description,
    reward,
    escrowTxHash,
    expiryTime,
    tags,
  } = req.body;

  try {
    await pool.query(
      `
      INSERT INTO tasks (
        id, requester, requester_pubkey, description, reward,
        escrow_tx_hash, expiry_time, status, tags
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'open', $8)
    `,
      [
        id,
        requester,
        requesterPublicKey,
        description,
        reward,
        escrowTxHash,
        expiryTime,
        tags,
      ]
    );

    res.json({ success: true, taskId: id });
  } catch (error) {
    console.error("Error creating task:", error);
    res.status(500).json({ error: "Failed to create task" });
  }
});

tasksRouter.get("/", async (req, res) => {
  const { status, tags, minReward } = req.query;

  let query = "SELECT * FROM tasks WHERE 1=1";
  const params: any[] = [];
  let paramCount = 1;

  if (status) {
    query += ` AND status = $${paramCount}`;
    params.push(status);
    paramCount++;
  }

  if (tags) {
    query += ` AND tags && $${paramCount}`;
    params.push((tags as string).split(","));
    paramCount++;
  }

  if (minReward) {
    query += ` AND reward >= $${paramCount}`;
    params.push(minReward);
    paramCount++;
  }

  query += " ORDER BY created_at DESC LIMIT 50";

  try {
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching tasks:", error);
    res.status(500).json({ error: "Failed to fetch tasks" });
  }
});

tasksRouter.get("/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query("SELECT * FROM tasks WHERE id = $1", [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Task not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error fetching task:", error);
    res.status(500).json({ error: "Failed to fetch task" });
  }
});
```

### packages/api/src/routes/submissions.ts

```typescript
import { Router } from "express";
import { pool } from "../db/schema";
import { ethers } from "ethers";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const submissionsRouter = Router();

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

submissionsRouter.post("/tasks/:taskId/submissions", async (req, res) => {
  const { taskId } = req.params;
  const { workerAddress, encryptedFile, encryptedKeyBundle, signature } =
    req.body;

  try {
    // Upload encrypted file to S3
    const submissionId = ethers.utils
      .id(taskId + workerAddress + Date.now())
      .slice(0, 42);
    const fileKey = `submissions/${submissionId}.enc`;

    await s3.send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: fileKey,
        Body: Buffer.from(encryptedFile, "base64"),
        ContentType: "application/octet-stream",
      })
    );

    const fileUrl = `s3://${process.env.S3_BUCKET}/${fileKey}`;

    // Store submission in database
    await pool.query(
      `
      INSERT INTO submissions (
        id, task_id, worker_address, encrypted_file_url,
        encrypted_key_bundle, signature
      )
      VALUES ($1, $2, $3, $4, $5, $6)
    `,
      [
        submissionId,
        taskId,
        workerAddress,
        fileUrl,
        encryptedKeyBundle,
        signature,
      ]
    );

    // Update task status
    await pool.query(
      `
      UPDATE tasks SET status = 'pending_approval' WHERE id = $1 AND status = 'open'
    `,
      [taskId]
    );

    res.json({ success: true, submissionId });
  } catch (error) {
    console.error("Error creating submission:", error);
    res.status(500).json({ error: "Failed to create submission" });
  }
});

submissionsRouter.get("/tasks/:taskId/submissions", async (req, res) => {
  const { taskId } = req.params;

  try {
    const result = await pool.query(
      `SELECT s.*, a.completed_tasks, a.rated_tasks, a.total_stars
       FROM submissions s
       LEFT JOIN agents a ON s.worker_address = a.address
       WHERE s.task_id = $1
       ORDER BY s.submitted_at DESC`,
      [taskId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching submissions:", error);
    res.status(500).json({ error: "Failed to fetch submissions" });
  }
});

submissionsRouter.post(
  "/tasks/:taskId/submissions/:submissionId/download",
  async (req, res) => {
    const { taskId, submissionId } = req.params;
    const { acceptanceTxHash } = req.body;

    try {
      // Verify tx on-chain
      const provider = new ethers.providers.JsonRpcProvider(
        process.env.BASE_RPC_URL
      );
      const receipt = await provider.getTransactionReceipt(acceptanceTxHash);

      if (!receipt || receipt.status !== 1) {
        return res.status(400).json({ error: "Invalid transaction" });
      }

      // Get submission
      const result = await pool.query(
        "SELECT * FROM submissions WHERE id = $1 AND task_id = $2",
        [submissionId, taskId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Submission not found" });
      }

      const submission = result.rows[0];
      const fileKey = submission.encrypted_file_url.replace(
        `s3://${process.env.S3_BUCKET}/`,
        ""
      );

      // Generate signed URL (expires in 5 minutes)
      const command = new GetObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: fileKey,
      });

      const signedUrl = await getSignedUrl(s3, command, { expiresIn: 300 });

      res.json({
        fileUrl: signedUrl,
        encryptedKeyBundle: submission.encrypted_key_bundle,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      });
    } catch (error) {
      console.error("Error generating download URL:", error);
      res.status(500).json({ error: "Failed to generate download URL" });
    }
  }
);
```

### packages/api/src/routes/agents.ts

```typescript
import { Router } from "express";
import { pool } from "../db/schema";

export const agentsRouter = Router();

agentsRouter.get("/:address/stats", async (req, res) => {
  const { address } = req.params;

  try {
    const statsResult = await pool.query(
      "SELECT * FROM agents WHERE address = $1",
      [address]
    );

    if (statsResult.rows.length === 0) {
      return res.json({
        address,
        completedTasks: 0,
        ratedTasks: 0,
        averageRating: 0,
        totalEarnings: "0",
        recentRatings: [],
      });
    }

    const stats = statsResult.rows[0];

    const ratingsResult = await pool.query(
      `SELECT task_id, rating, created_at
       FROM ratings
       WHERE worker_address = $1
       ORDER BY created_at DESC
       LIMIT 10`,
      [address]
    );

    const averageRating =
      stats.rated_tasks > 0 ? stats.total_stars / stats.rated_tasks : 0;

    res.json({
      address: stats.address,
      completedTasks: stats.completed_tasks,
      ratedTasks: stats.rated_tasks,
      averageRating: Number(averageRating.toFixed(1)),
      totalEarnings: stats.total_earnings,
      recentRatings: ratingsResult.rows,
    });
  } catch (error) {
    console.error("Error fetching agent stats:", error);
    res.status(500).json({ error: "Failed to fetch agent stats" });
  }
});

agentsRouter.get("/leaderboard", async (req, res) => {
  const { limit = 20 } = req.query;

  try {
    const result = await pool.query(
      `
      SELECT
        address,
        completed_tasks,
        rated_tasks,
        total_stars,
        CASE
          WHEN rated_tasks > 0 THEN total_stars::float / rated_tasks
          ELSE 0
        END as average_rating
      FROM agents
      WHERE rated_tasks >= 5
      ORDER BY average_rating DESC, completed_tasks DESC
      LIMIT $1
    `,
      [limit]
    );

    const leaderboard = result.rows.map((row, index) => ({
      rank: index + 1,
      address: row.address,
      completedTasks: row.completed_tasks,
      averageRating: Number(row.average_rating.toFixed(1)),
    }));

    res.json(leaderboard);
  } catch (error) {
    console.error("Error fetching leaderboard:", error);
    res.status(500).json({ error: "Failed to fetch leaderboard" });
  }
});
```

### packages/api/src/server.ts

```typescript
import express from "express";
import cors from "cors";
import { tasksRouter } from "./routes/tasks";
import { submissionsRouter } from "./routes/submissions";
import { agentsRouter } from "./routes/agents";
import { Indexer } from "./services/indexer";
import { createTables } from "./db/schema";

const app = express();

app.use(cors());
app.use(express.json({ limit: "50mb" }));

app.use("/api/tasks", tasksRouter);
app.use("/api", submissionsRouter);
app.use("/api/agents", agentsRouter);

const PORT = process.env.PORT || 3000;

async function start() {
  // Initialize database
  await createTables();

  // Start event indexer
  const indexer = new Indexer(
    process.env.CONTRACT_ADDRESS!,
    process.env.BASE_RPC_URL!
  );
  await indexer.start();

  // Start server
  app.listen(PORT, () => {
    console.log(`API server running on port ${PORT}`);
  });
}

start().catch(console.error);
```

---

## Part 4: CLI Package

### packages/cli/src/lib/awal.ts

```typescript
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export class AwalClient {
  async getAddress(): Promise<string> {
    const { stdout } = await execAsync("npx awal status");
    // Parse address from output
    const match = stdout.match(/Address: (0x[a-fA-F0-9]{40})/);
    if (!match) throw new Error("Could not parse wallet address");
    return match[1];
  }

  async getPublicKey(): Promise<string> {
    // TODO: Implement based on awal's API
    // For now, might need to derive from address or call CDP API
    throw new Error("Not implemented");
  }

  async send(recipient: string, amount: number): Promise<string> {
    const { stdout } = await execAsync(`npx awal send ${amount} ${recipient}`);
    // Parse tx hash from output
    const match = stdout.match(/0x[a-fA-F0-9]{64}/);
    if (!match) throw new Error("Could not parse transaction hash");
    return match[0];
  }

  async callContract(
    contractAddress: string,
    method: string,
    args: any[],
    value?: number
  ): Promise<string> {
    const argsJson = JSON.stringify(args);
    const valueFlag = value ? `--value ${value}` : "";

    const { stdout } = await execAsync(
      `npx awal contract call ${contractAddress} ${method} '${argsJson}' ${valueFlag} --wait`
    );

    // Parse tx hash
    const match = stdout.match(/0x[a-fA-F0-9]{64}/);
    if (!match) throw new Error("Could not parse transaction hash");
    return match[0];
  }

  async authenticate(): Promise<void> {
    await execAsync("npx awal authenticate");
  }
}
```

### packages/cli/src/lib/api-client.ts

```typescript
import axios, { AxiosInstance } from "axios";
import type { Task, Submission, AgentStats } from "@task-market/shared";

export class ApiClient {
  private client: AxiosInstance;

  constructor(baseUrl: string) {
    this.client = axios.create({ baseURL: baseUrl });
  }

  async createTask(task: Partial<Task>): Promise<{ taskId: string }> {
    const response = await this.client.post("/api/tasks", task);
    return response.data;
  }

  async getTask(taskId: string): Promise<Task> {
    const response = await this.client.get(`/api/tasks/${taskId}`);
    return response.data;
  }

  async searchTasks(params: {
    status?: string;
    tags?: string[];
    minReward?: number;
  }): Promise<Task[]> {
    const response = await this.client.get("/api/tasks", { params });
    return response.data;
  }

  async submitTask(
    taskId: string,
    submission: Partial<Submission>
  ): Promise<{ submissionId: string }> {
    const response = await this.client.post(
      `/api/tasks/${taskId}/submissions`,
      submission
    );
    return response.data;
  }

  async getSubmissions(taskId: string): Promise<Submission[]> {
    const response = await this.client.get(`/api/tasks/${taskId}/submissions`);
    return response.data;
  }

  async getDownloadUrl(
    taskId: string,
    submissionId: string,
    acceptanceTxHash: string
  ): Promise<{ fileUrl: string; encryptedKeyBundle: string }> {
    const response = await this.client.post(
      `/api/tasks/${taskId}/submissions/${submissionId}/download`,
      { acceptanceTxHash }
    );
    return response.data;
  }

  async getAgentStats(address: string): Promise<AgentStats> {
    const response = await this.client.get(`/api/agents/${address}/stats`);
    return response.data;
  }

  async getLeaderboard(): Promise<any[]> {
    const response = await this.client.get("/api/agents/leaderboard");
    return response.data;
  }

  async uploadFile(file: Buffer): Promise<{ url: string }> {
    const response = await this.client.post("/api/upload", {
      file: file.toString("base64"),
    });
    return response.data;
  }
}
```

### packages/cli/src/commands/create.ts

```typescript
import { Command } from "commander";
import { AwalClient } from "../lib/awal";
import { ApiClient } from "../lib/api-client";
import { ethers } from "ethers";
import ora from "ora";
import chalk from "chalk";

export const createCommand = new Command("create")
  .description("Create a new task")
  .option("-d, --description <text>", "Task description")
  .option("-r, --reward <amount>", "Reward in USDC")
  .option("-t, --duration <hours>", "Duration in hours")
  .option("--tags <tags>", "Comma-separated tags")
  .action(async (options) => {
    const spinner = ora("Creating task...").start();

    try {
      const awal = new AwalClient();
      const api = new ApiClient(process.env.API_URL || "http://localhost:3000");

      // Get requester address
      const requesterAddress = await awal.getAddress();
      spinner.text = "Got wallet address";

      // Generate task ID
      const taskId = ethers.utils.id(
        requesterAddress + options.description + Date.now()
      );

      // Convert reward to wei (assuming USDC has 6 decimals)
      const rewardWei = ethers.utils.parseUnits(options.reward, 6);

      // Convert duration to seconds
      const durationSeconds = parseInt(options.duration) * 3600;

      // Create escrow transaction via awal
      spinner.text = "Creating escrow transaction...";
      const txHash = await awal.callContract(
        process.env.CONTRACT_ADDRESS!,
        "createTask",
        [taskId, durationSeconds],
        rewardWei.toString()
      );

      spinner.text = "Posting task to API...";

      // TODO: Get public key from awal
      const requesterPublicKey = "TODO";

      // Post to API
      await api.createTask({
        id: taskId,
        requester: requesterAddress,
        requesterPublicKey,
        description: options.description,
        reward: rewardWei.toBigInt(),
        escrowTxHash: txHash,
        expiryTime: new Date(Date.now() + durationSeconds * 1000),
        status: "open",
        tags: options.tags.split(","),
      });

      spinner.succeed(chalk.green("Task created successfully!"));
      console.log(chalk.blue(`Task ID: ${taskId}`));
      console.log(chalk.blue(`Escrow TX: ${txHash}`));
    } catch (error) {
      spinner.fail(chalk.red("Failed to create task"));
      console.error(error);
      process.exit(1);
    }
  });
```

### packages/cli/src/commands/submit.ts

```typescript
import { Command } from "commander";
import { AwalClient } from "../lib/awal";
import { ApiClient } from "../lib/api-client";
import { Encryptor } from "@task-market/shared";
import { readFile } from "fs/promises";
import ora from "ora";
import chalk from "chalk";

export const submitCommand = new Command("submit")
  .description("Submit work for a task")
  .argument("<taskId>", "Task ID")
  .option("-f, --file <path>", "File to submit")
  .action(async (taskId, options) => {
    const spinner = ora("Submitting work...").start();

    try {
      const awal = new AwalClient();
      const api = new ApiClient(process.env.API_URL || "http://localhost:3000");

      // Get worker address
      const workerAddress = await awal.getAddress();

      // Get task details
      spinner.text = "Fetching task details...";
      const task = await api.getTask(taskId);

      // Read file
      spinner.text = "Reading file...";
      const fileBuffer = await readFile(options.file);

      // Encrypt file
      spinner.text = "Encrypting file...";
      const { encryptedFile, encryptedKey } = await Encryptor.encryptFile(
        fileBuffer,
        task.requesterPublicKey
      );

      // Upload to API
      spinner.text = "Uploading encrypted file...";
      await api.submitTask(taskId, {
        workerAddress,
        encryptedFile: encryptedFile.toString("base64"),
        encryptedKeyBundle: encryptedKey,
        signature: "TODO", // Sign with awal
      });

      spinner.succeed(chalk.green("Submission created successfully!"));
    } catch (error) {
      spinner.fail(chalk.red("Failed to submit work"));
      console.error(error);
      process.exit(1);
    }
  });
```

### packages/cli/src/commands/accept.ts

```typescript
import { Command } from "commander";
import { AwalClient } from "../lib/awal";
import { ApiClient } from "../lib/api-client";
import { Encryptor } from "@task-market/shared";
import { writeFile } from "fs/promises";
import axios from "axios";
import ora from "ora";
import chalk from "chalk";

export const acceptCommand = new Command("accept")
  .description("Accept a submission")
  .argument("<taskId>", "Task ID")
  .argument("<submissionId>", "Submission ID")
  .action(async (taskId, submissionId) => {
    const spinner = ora("Accepting submission...").start();

    try {
      const awal = new AwalClient();
      const api = new ApiClient(process.env.API_URL || "http://localhost:3000");

      // Get submission details
      const submissions = await api.getSubmissions(taskId);
      const submission = submissions.find((s) => s.id === submissionId);

      if (!submission) {
        throw new Error("Submission not found");
      }

      // Call smart contract
      spinner.text = "Releasing escrow...";
      const txHash = await awal.callContract(
        process.env.CONTRACT_ADDRESS!,
        "acceptSubmission",
        [taskId, submission.workerAddress]
      );

      spinner.text = "Waiting for confirmation...";

      // Get download URL from API
      spinner.text = "Getting download URL...";
      const { fileUrl, encryptedKeyBundle } = await api.getDownloadUrl(
        taskId,
        submissionId,
        txHash
      );

      // Download encrypted file
      spinner.text = "Downloading file...";
      const response = await axios.get(fileUrl, {
        responseType: "arraybuffer",
      });
      const encryptedFile = Buffer.from(response.data);

      // Decrypt file
      spinner.text = "Decrypting file...";
      // TODO: Get private key from awal or local keystore
      const privateKey = "TODO";
      const decryptedFile = await Encryptor.decryptFile(
        encryptedFile,
        encryptedKeyBundle,
        privateKey
      );

      // Save file
      const outputPath = `./downloads/${taskId}_${submissionId}`;
      await writeFile(outputPath, decryptedFile);

      spinner.succeed(chalk.green("Submission accepted!"));
      console.log(chalk.blue(`File saved to: ${outputPath}`));
      console.log(chalk.blue(`Transaction: ${txHash}`));
    } catch (error) {
      spinner.fail(chalk.red("Failed to accept submission"));
      console.error(error);
      process.exit(1);
    }
  });
```

### packages/cli/src/commands/search.ts

```typescript
import { Command } from "commander";
import { ApiClient } from "../lib/api-client";
import chalk from "chalk";
import Table from "cli-table3";

export const searchCommand = new Command("search")
  .description("Search for available tasks")
  .option("--tags <tags>", "Filter by tags (comma-separated)")
  .option("--min-reward <amount>", "Minimum reward")
  .action(async (options) => {
    try {
      const api = new ApiClient(process.env.API_URL || "http://localhost:3000");

      const tasks = await api.searchTasks({
        status: "open",
        tags: options.tags?.split(","),
        minReward: options.minReward,
      });

      if (tasks.length === 0) {
        console.log(chalk.yellow("No tasks found"));
        return;
      }

      const table = new Table({
        head: ["ID", "Description", "Reward", "Expires", "Submissions"],
        colWidths: [10, 40, 10, 20, 12],
      });

      for (const task of tasks) {
        const expiresIn = Math.floor(
          (new Date(task.expiryTime).getTime() - Date.now()) / 1000 / 3600
        );

        table.push([
          task.id.slice(0, 8) + "...",
          task.description.slice(0, 37) + "...",
          `${task.reward} USDC`,
          `${expiresIn}h`,
          "0", // TODO: Get submission count
        ]);
      }

      console.log(table.toString());
    } catch (error) {
      console.error(chalk.red("Failed to search tasks"));
      console.error(error);
      process.exit(1);
    }
  });
```

### packages/cli/src/commands/stats.ts

```typescript
import { Command } from "commander";
import { ApiClient } from "../lib/api-client";
import chalk from "chalk";

export const statsCommand = new Command("stats")
  .description("View worker statistics")
  .argument("<address>", "Worker address")
  .action(async (address) => {
    try {
      const api = new ApiClient(process.env.API_URL || "http://localhost:3000");

      const stats = await api.getAgentStats(address);

      console.log(chalk.bold(`\nWorker: ${address}\n`));
      console.log(`Completed Tasks: ${chalk.green(stats.completedTasks)}`);
      console.log(
        `Average Rating: ${chalk.yellow(
          "⭐".repeat(Math.round(stats.averageRating))
        )} ${stats.averageRating}/5`
      );
      console.log(
        `Rated Tasks: ${stats.ratedTasks} (${Math.round(
          (stats.ratedTasks / stats.completedTasks) * 100
        )}% rated)`
      );
      console.log(`Total Earnings: ${chalk.green(stats.totalEarnings)} USDC`);

      if (stats.recentRatings && stats.recentRatings.length > 0) {
        console.log(chalk.bold("\nRecent Ratings:"));
        for (const rating of stats.recentRatings) {
          console.log(
            `  ${"⭐".repeat(rating.rating)} - Task ${rating.taskId.slice(
              0,
              8
            )}... (${new Date(rating.timestamp).toLocaleDateString()})`
          );
        }
      }
    } catch (error) {
      console.error(chalk.red("Failed to fetch stats"));
      console.error(error);
      process.exit(1);
    }
  });
```

### packages/cli/src/index.ts

```typescript
#!/usr/bin/env node

import { Command } from "commander";
import { createCommand } from "./commands/create";
import { submitCommand } from "./commands/submit";
import { acceptCommand } from "./commands/accept";
import { searchCommand } from "./commands/search";
import { statsCommand } from "./commands/stats";

const program = new Command();

program.name("task-market").description("CLI for Task Market").version("1.0.0");

program.addCommand(createCommand);
program.addCommand(submitCommand);
program.addCommand(acceptCommand);
program.addCommand(searchCommand);
program.addCommand(statsCommand);

program.parse();
```

---

## Part 5: Implementation Timeline

### Week 1: Smart Contract + Shared Package

**Days 1-2:**

- Set up monorepo (Turborepo)
- Create packages/shared with types
- Write TaskMarket.sol
- Write deployment scripts

**Days 3-4:**

- Write comprehensive tests
- Deploy to Base Sepolia testnet
- Verify contract on BaseScan

**Day 5:**

- Security review
- Gas optimization
- Documentation

### Week 2: API Backend

**Days 1-2:**

- Set up packages/api
- Database schema + migrations
- Task CRUD endpoints
- File upload to S3

**Days 3-4:**

- Event indexer implementation
- Sync historical events
- Agent stats endpoints

**Day 5:**

- Testing
- Error handling
- Deploy to staging

### Week 3: CLI

**Days 1-2:**

- Set up packages/cli
- Awal wrapper
- Create + search commands

**Days 3-4:**

- Submit command + encryption
- Accept command + decryption
- Stats commands

**Day 5:**

- Polish UX
- Error handling
- Documentation

### Week 4: Frontend (Optional)

**Days 1-3:**

- Next.js setup
- Core pages
- Wallet integration

**Days 4-5:**

- Polish
- Deploy to Vercel

### Week 5: Launch

**Days 1-2:**

- End-to-end testing
- Bug fixes

**Days 3-4:**

- Mainnet deployment
- Documentation
- Video tutorials

**Day 5:**

- Launch announcement
- Monitor for issues

---

## Root Package Files

### package.json (root)

```json
{
  "name": "task-market",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev --parallel",
    "test": "turbo run test",
    "lint": "turbo run lint",
    "deploy:contracts": "cd packages/contracts && npm run deploy",
    "start:api": "cd packages/api && npm run start",
    "start:indexer": "cd packages/api && npm run indexer"
  },
  "devDependencies": {
    "turbo": "^1.10.0",
    "typescript": "^5.0.0"
  }
}
```

### turbo.json

```json
{
  "$schema": "https://turbo.build/schema.json",
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**"]
    },
    "test": {
      "dependsOn": ["build"]
    },
    "lint": {},
    "dev": {
      "cache": false
    }
  }
}
```

---

**Total: 5 weeks to production**
**MVP (no frontend): 3 weeks**

Ready to start building?
