export type FirstRunStepKey = 'postedTask' | 'respondedToTask';
export type FirstRunVisibility = 'open' | 'minimized' | 'dismissed';

export type FirstRunCompletedState = Record<FirstRunStepKey, boolean>;

export type FirstRunLocalState = {
  completed: FirstRunCompletedState;
  visibility: FirstRunVisibility;
  dismissedAt: string | null;
  minimizedAt: string | null;
  completedAt: string | null;
  lastSeenAt: string;
};

export type FirstRunProgress = {
  completed: FirstRunCompletedState;
  nextStep: FirstRunStepKey | null;
  points: number;
  stepsCompleted: number;
};

export const FIRST_RUN_STORAGE_KEY = 'taskmarket:first-run:v1';

export const FIRST_RUN_POINTS: Record<FirstRunStepKey, number> = {
  postedTask: 60,
  respondedToTask: 40,
};

const STEP_ORDER: FirstRunStepKey[] = ['postedTask', 'respondedToTask'];

export const FIRST_RUN_TOTAL_POINTS = STEP_ORDER.reduce(
  (total, step) => total + FIRST_RUN_POINTS[step],
  0
);

function isoNow() {
  return new Date().toISOString();
}

export function createDefaultFirstRunState(): FirstRunLocalState {
  return {
    completed: {
      postedTask: false,
      respondedToTask: false,
    },
    visibility: 'open',
    dismissedAt: null,
    minimizedAt: null,
    completedAt: null,
    lastSeenAt: isoNow(),
  };
}

export function calculateFirstRunPoints(completed: FirstRunCompletedState): number {
  return STEP_ORDER.reduce(
    (total, step) => total + (completed[step] ? FIRST_RUN_POINTS[step] : 0),
    0
  );
}

export function deriveFirstRunProgress({
  localState,
  publishedTask,
  walletProgress,
}: {
  localState: FirstRunLocalState;
  publishedTask?: boolean;
  walletProgress?: Partial<FirstRunCompletedState>;
}): FirstRunProgress {
  const completed = {
    postedTask: Boolean(
      localState.completed.postedTask || publishedTask || walletProgress?.postedTask
    ),
    respondedToTask: Boolean(
      localState.completed.respondedToTask || walletProgress?.respondedToTask
    ),
  };
  const points = calculateFirstRunPoints(completed);
  const nextStep = STEP_ORDER.find((step) => !completed[step]) ?? null;

  return {
    completed,
    nextStep,
    points,
    stepsCompleted: STEP_ORDER.filter((step) => completed[step]).length,
  };
}

export function setFirstRunVisibility(
  state: FirstRunLocalState,
  visibility: FirstRunVisibility
): FirstRunLocalState {
  const now = isoNow();
  return {
    ...state,
    visibility,
    dismissedAt: visibility === 'dismissed' ? now : state.dismissedAt,
    minimizedAt: visibility === 'minimized' ? now : state.minimizedAt,
    lastSeenAt: now,
  };
}

export function mergeFirstRunCompletion(
  state: FirstRunLocalState,
  completed: FirstRunCompletedState
): FirstRunLocalState {
  const next = {
    ...state,
    completed,
    completedAt:
      calculateFirstRunPoints(completed) === FIRST_RUN_TOTAL_POINTS
        ? (state.completedAt ?? isoNow())
        : null,
    lastSeenAt: isoNow(),
  };
  return next;
}

function storageKey(walletAddress?: string): string {
  return `${FIRST_RUN_STORAGE_KEY}:${walletAddress?.toLowerCase() ?? 'anonymous'}`;
}

export function readFirstRunState(
  storage: Storage | undefined,
  walletAddress?: string
): FirstRunLocalState {
  if (!storage) {
    return createDefaultFirstRunState();
  }

  try {
    const raw = storage.getItem(storageKey(walletAddress));
    if (!raw) {
      return createDefaultFirstRunState();
    }
    const parsed = JSON.parse(raw) as Partial<FirstRunLocalState>;
    const fallback = createDefaultFirstRunState();
    const parsedCompleted = parsed.completed as Partial<FirstRunCompletedState> | undefined;
    return {
      completed: {
        postedTask: Boolean(parsedCompleted?.postedTask),
        respondedToTask: Boolean(parsedCompleted?.respondedToTask),
      },
      visibility:
        parsed.visibility === 'minimized' || parsed.visibility === 'dismissed'
          ? parsed.visibility
          : 'open',
      dismissedAt: parsed.dismissedAt ?? null,
      minimizedAt: parsed.minimizedAt ?? null,
      completedAt: parsed.completedAt ?? null,
      lastSeenAt: parsed.lastSeenAt ?? fallback.lastSeenAt,
    };
  } catch {
    return createDefaultFirstRunState();
  }
}

export function writeFirstRunState(
  storage: Storage | undefined,
  state: FirstRunLocalState,
  walletAddress?: string
): void {
  if (!storage) {
    return;
  }

  try {
    storage.setItem(storageKey(walletAddress), JSON.stringify(state));
  } catch {
    // Ignore unavailable storage. The window still works for the current render.
  }
}
