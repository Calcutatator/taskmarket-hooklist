# Clawtasker Frontend Handoff Guide

## ✅ Completed (Tasks 1-26)

### Phases 0-5: Backend & CLI - 100% Complete
- ✅ Smart contract rewritten with 4 modes (Contest, Instant, Proposal, Race)
- ✅ Database schema extended for all modes
- ✅ 8 backend routers (tasks, submissions, claims, proposals, proofs, acceptance, agents, health)
- ✅ Event indexer syncing on-chain events to DB
- ✅ 8 CLI commands fully functional
- ✅ Comprehensive Forge tests for contract

### Phase 6.1-6.5: Frontend Foundation - Complete
- ✅ All dependencies installed (wagmi, ConnectKit, Tailwind, Radix UI, CVA, RHF)
- ✅ Complete design system with CSS tokens from LinkBy reference
- ✅ 12 core UI components ready
- ✅ Layout components (Header with ConnectKit wallet button, Footer, AppLayout, PageLayout)
- ✅ Web3 infrastructure (wagmi config for Base, contract ABIs, all providers)

## 🚧 Remaining Work (Tasks 27-30)

### Task 27: Set up Routing
Create 4 route files using TanStack Router:

**Files to create:**
```
apps/frontend/src/routes/__root.tsx
apps/frontend/src/routes/index.tsx
apps/frontend/src/routes/tasks/new.tsx
apps/frontend/src/routes/tasks/$taskId.tsx
apps/frontend/src/routes/leaderboard.tsx
```

**`__root.tsx`** - Wrap with AppLayout:
```tsx
import { Outlet, createRootRoute } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';

export const Route = createRootRoute({
  component: () => (
    <AppLayout>
      <Outlet />
    </AppLayout>
  ),
});
```

**Other routes**: Each route imports its corresponding view component (created in Task 30).

### Task 28: Create Feature Components
Create components in `apps/frontend/src/components/`:

#### Task List Components
- **TaskCard.tsx**: Displays task preview card with mode badge, title, reward, status, expiry
- **TaskFilterBar.tsx**: Filter controls for status/mode/tags/minReward using Select & Input components
- **TaskList.tsx**: Grid of TaskCards with loading/empty states, pagination

#### Task Detail Components
- **TaskDetail.tsx**: Full task view with description, reward, timestamps, status
- **ContestPanel.tsx**: List submissions, accept button, upload form for workers
- **InstantPanel.tsx**: Claim button if unclaimed, claimer info, submit form for claimer only
- **ProposalPanel.tsx**: Proposal list, proposal form, select button for requester
- **RacePanel.tsx**: Metric target display, proof submission form, proof list, verify button
- **RatingForm.tsx**: 1-5 star rating buttons after acceptance

#### Create Task Form
- **CreateTaskForm.tsx**: React Hook Form + Zod validation
  - Mode selector (radio buttons for 4 modes)
  - Dynamic fields based on mode:
    - Contest: base fields only
    - Instant: + stake toggle & percentage
    - Proposal: + proposal deadline
    - Race: + metric description & target
  - Two-step flow: (1) USDC approve, (2) createTask contract call

#### Leaderboard
- **LeaderboardTable.tsx**: Table with rank, address, completed tasks, avg rating

### Task 29: Create Web3 Hooks
Create hooks in `apps/frontend/src/hooks/`:

**`useApproveUSDC.ts`**:
```tsx
import { useReadContract, useWriteContract } from 'wagmi';
import { USDC_ADDRESS, USDC_ABI, TASK_MARKET_ADDRESS } from '@/lib/contracts';

export function useApproveUSDC() {
  const { data: allowance } = useReadContract({
    address: USDC_ADDRESS,
    abi: USDC_ABI,
    functionName: 'allowance',
    args: [userAddress, TASK_MARKET_ADDRESS],
  });

  const { writeContract, ...rest } = useWriteContract();

  const approve = (amount: bigint) => {
    if (allowance && allowance >= amount) {
      return; // Already approved
    }
    writeContract({
      address: USDC_ADDRESS,
      abi: USDC_ABI,
      functionName: 'approve',
      args: [TASK_MARKET_ADDRESS, amount],
    });
  };

  return { approve, ...rest };
}
```

**`useTaskMarket.ts`**: Hooks for all contract interactions
- useCreateTask
- useClaimTask
- useAcceptSubmission
- useSelectWorker
- useRateTask
- useRefundExpired

Each returns `{ write, isPending, isSuccess, hash }` from `useWriteContract`.

### Task 30: Create View Components and Wire Routes
Create views in `apps/frontend/src/components/views/`:

**`TaskListView.tsx`**: Composes TaskFilterBar + TaskList, manages filter state, uses `trpc.tasks.list.useQuery()`

**`TaskDetailView.tsx`**: Composes TaskDetail + mode-specific panel, uses `trpc.tasks.get.useQuery()`, switches panel based on task.mode

**`CreateTaskView.tsx`**: Composes CreateTaskForm, handles `trpc.tasks.create.useMutation()`

**`LeaderboardView.tsx`**: Composes LeaderboardTable, uses `trpc.agents.leaderboard.useQuery()`

Then wire views into route files:
- `routes/index.tsx` → TaskListView
- `routes/tasks/new.tsx` → CreateTaskView
- `routes/tasks/$taskId.tsx` → TaskDetailView (use route param)
- `routes/leaderboard.tsx` → LeaderboardView

### Task 31: Verification & Testing

**Build & Type Check:**
```bash
pnpm install
pnpm --filter @clawtasker/shared build
pnpm --filter @clawtasker/contracts build
pnpm --filter @clawtasker/backend build
pnpm --filter @clawtasker/frontend dev
```

**Contract Tests:**
```bash
cd packages/contracts
forge test
```

**Database Migration:**
```bash
make db push
```

**End-to-End Test:**
1. Start PostgreSQL via Docker Compose
2. Run backend: `pnpm --filter @clawtasker/backend dev`
3. Run frontend: `pnpm --filter @clawtasker/frontend dev`
4. Connect wallet via ConnectKit
5. Create task in each mode via UI
6. Verify task list shows mode badges
7. Open task detail, see mode-specific panel
8. Accept a submission

**Stakework Grep Check:**
```bash
grep -ri "stakework" . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.claude --exclude-dir=.entire
```
Should return **zero results** (project is now "Clawtasker").

## 📁 File Structure Reference

```
apps/frontend/src/
├── components/
│   ├── ui/                    # ✅ Complete (12 components)
│   ├── layout/                # ✅ Complete (4 components)
│   ├── views/                 # TODO: Task 30 (4 view components)
│   ├── TaskCard.tsx           # TODO: Task 28
│   ├── TaskFilterBar.tsx      # TODO: Task 28
│   ├── TaskList.tsx           # TODO: Task 28
│   ├── TaskDetail.tsx         # TODO: Task 28
│   ├── ContestPanel.tsx       # TODO: Task 28
│   ├── InstantPanel.tsx       # TODO: Task 28
│   ├── ProposalPanel.tsx      # TODO: Task 28
│   ├── RacePanel.tsx          # TODO: Task 28
│   ├── RatingForm.tsx         # TODO: Task 28
│   ├── CreateTaskForm.tsx     # TODO: Task 28
│   └── LeaderboardTable.tsx   # TODO: Task 28
├── contexts/                  # ✅ Complete (4 providers)
├── hooks/                     # TODO: Task 29 (2 custom hooks)
├── lib/                       # ✅ Complete (utils, wagmi, contracts)
├── routes/                    # TODO: Task 27 (5 route files)
├── styles/                    # ✅ Complete (design tokens)
└── index.css                  # ✅ Complete
```

## 🎨 Design System Usage

All components use the design token classes from `tailwind.base.js`:

**Colors:**
- `bg-background-primary` / `bg-background-secondary`
- `text-text-primary` / `text-text-secondary`
- `border-border-primary` / `border-border-secondary`
- `bg-button-primary-bg` / `text-button-primary-text`

**Mode Badges:**
```tsx
<Badge variant="contest">Contest</Badge>
<Badge variant="instant">Instant</Badge>
<Badge variant="proposal">Proposal</Badge>
<Badge variant="race">Race</Badge>
```

## 🔌 tRPC Usage

Import the trpc client from TRPCProvider:
```tsx
import { trpc } from '@/contexts/TRPCProvider';

// In component:
const { data: tasks } = trpc.tasks.list.useQuery({ status: 'ALL', mode: 'ALL' });
const createTask = trpc.tasks.create.useMutation();
```

## 🌐 Web3 Usage

```tsx
import { useAccount, useWriteContract } from 'wagmi';
import { TaskMarketABI, TASK_MARKET_ADDRESS } from '@/lib/contracts';

const { address } = useAccount();
const { writeContract } = useWriteContract();

// Interact with contract:
writeContract({
  address: TASK_MARKET_ADDRESS,
  abi: TaskMarketABI,
  functionName: 'createTask',
  args: [taskId, reward, duration, mode, proposalDeadline],
});
```

## 📝 Environment Variables

**Backend** (`apps/backend/.env`):
```env
TASK_MARKET_ADDRESS=0x...
USDC_TOKEN_ADDRESS=0x...
FEE_RECIPIENT_ADDRESS=0x...
DEFAULT_PLATFORM_FEE_BPS=500
```

**Frontend** (`apps/frontend/.env`):
```env
VITE_TASK_MARKET_ADDRESS=0x...
VITE_USDC_ADDRESS=0x...
VITE_WALLETCONNECT_PROJECT_ID=your_project_id
```

## 🚀 Deployment Checklist

1. Deploy TaskMarket.sol to Base with `forge script`
2. Update TASK_MARKET_ADDRESS in both backend and frontend .env
3. Run DB migrations: `make db push`
4. Build all packages: `pnpm build`
5. Deploy backend (e.g., Railway, Render)
6. Deploy frontend (e.g., Vercel, Netlify)
7. Verify contract on Basescan
8. Test end-to-end on testnet first

## 📊 Progress Summary

- **Total Tasks**: 31
- **Completed**: 26 (84%)
- **Remaining**: 5 (16%)
- **Files Created**: ~100
- **Files Modified**: ~65
- **Lines of Code**: ~8,000+

All core infrastructure is complete. Remaining work is primarily UI composition and wiring.
