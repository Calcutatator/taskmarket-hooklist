import type { PendingAction, TaskDetailResponse, TaskResponse } from '@taskmarket/shared';

/** Props every action component receives from TaskActionsPanel. */
export type TaskActionComponentProps = {
  /** True when the connected wallet is not the role this action is for. */
  disabled: boolean;
  /** The pendingAction this component renders. Provides the CLI command for "Show CLI". */
  action: PendingAction;
  /** The full task — actions read mode/status/deadlines from this. */
  task: TaskDetailResponse | TaskResponse;
};
