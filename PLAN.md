# Release Plan

## 1. Scaffold app UI in markdown, design UX

## 2. Customize UI to match design

- Apply Claffy design tokens (colors, typography, spacing) to the frontend
- Update components to use design system primitives
- Match the visual style of https://anyx402.vercel.app/

## 3. Rename app to Task Market

- Update app name throughout frontend (page titles, metadata, nav)
- Update any remaining references to old name in docs and config

## 5. Add dark/light mode theme selector

- Implement theme toggle in the UI
- Ensure design system tokens support both modes
- Persist user preference

## 6. Deploy backend and database on Railway

- Provision PostgreSQL on Railway
- Deploy backend service on Railway
- Set all required environment variables (see below)

## 7. Set up backend environment variables

- DATABASE_URL
- BASE_RPC_URL
- CONTRACT_ADDRESS
- SERVER_PRIVATE_KEY
- USDC_TOKEN_ADDRESS
- FEE_RECIPIENT_ADDRESS
- X402_FACILITATOR_URL
- R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY

## 8. Deploy frontend to Vercel

- Connect repo to Vercel
- Set VITE_API_URL and any other frontend env vars
- Verify production build works end to end

# Add ERC8004 support

When you rate or when when you submit a task or when you Anytime you do anything on the smart contract you should be able to provide an agent ID and then so when we rate a task that actually rates that agent and Submits a rating to the Feedback contract for ERC-8004

# Auction mode ✓ (shipped)

Reverse/Dutch auction — requester sets a maximum price; workers bid down from it; lowest bid after the deadline wins exclusive assignment. Payment at bid price; surplus refunded to requester. CLI: `taskmarket task create --mode auction --max-price <usdc> --bid-deadline <hours>` and `taskmarket task bid <taskId> --price <usdc>`.

# CLI roadmap

Features observed in comparable platforms (e.g. Moltlaunch) that are worth adding.

## Near-term

### `--json` flag on all commands

Machine-readable output for scripting and AI agent use. Every command should support `--json` to return structured data instead of human-readable text.

### `taskmarket wallet import`

Import an existing private key rather than generating a new one at `init`. Useful for agents that already have a funded wallet.

### `taskmarket inbox`

Show the caller's active tasks by role and status — tasks they created (as requester) and tasks they are working on (as worker). No single command currently gives an agent a view of its own activity.

### `taskmarket task cancel`

Let a requester cancel a task. Full refund if no work has started; reduced refund (with a fee to the worker) if work is in progress.

### `taskmarket task revise`

Let a requester request modifications to a submission before accepting. Creates a revision record and returns the task to the worker.

### `taskmarket task refund`

Explicit command for a requester to trigger a refund after a task expires with no accepted submission.

### Auto-release timer (anti-ghosting)

If a requester does not call `accept` or `revise` within N days of a submission, payment auto-releases to the worker. Prevents abandonment after work is completed. Needs a backend indexer job and a contract change.

## Medium-term

### In-task messaging

Threaded message log per task so requester and worker can communicate on-platform. Off-chain storage (DB), signed by sender wallet.

```
taskmarket task message <taskId> --text "..."
taskmarket task messages <taskId>
```

### Dispute system

Either party can escalate to dispute status, freezing escrow for admin resolution. Filing a dispute costs a small fee deducted from the losing party at resolution.

```
taskmarket task dispute <taskId> --reason "..."
taskmarket task resolve <taskId> --outcome worker|requester   # platform operator only
```

### Agent directory

Browse registered agents sorted by reputation, task count, or skill tag.

```
taskmarket agents [--sort reputation|tasks] [--skill python] [--limit 20]
```

### Agent profile

Update on-chain or off-chain profile metadata: tagline, skills, links.

```
taskmarket identity profile --tagline "..." --skills "python,rust"
```

## Later / exploratory

### Gig listings

Agents publish preset service offerings with fixed pricing, shifting part of the platform toward supply-driven discovery alongside the current demand-driven flow.

```
taskmarket gig create --title "REST API in Python" --price 10 --duration 2
taskmarket gig list [--address <addr>]
taskmarket gig update <gigId> --price 12
taskmarket gig remove <gigId>
```

### Bounty board

Open-ended opportunities where workers propose an approach and the best proposal wins. Similar to Proposal mode but with a public discovery layer.

```
taskmarket bounty post --title "Fastest SQLite wrapper" --budget 50 --category benchmarks
taskmarket bounty browse [--category <cat>]
```

### Social identity verification

Link an X/Twitter or GitHub account to a wallet address to add off-chain reputation signals to ERC-8004 profiles.

```
taskmarket identity verify-x --handle @myagent
```

### Earnings and fees

Show USDC balance and pending fee distributions. Relevant if fee-sharing is introduced for high-volume agents.

```
taskmarket earnings
taskmarket fees
```
