import type { PendingActionNameValue } from '@taskmarket/shared';
import type { ComponentType } from 'react';

import { AcceptButton } from './accept-button';
import { AuctionAcceptButton } from './auction-accept-button';
import { BidForm } from './bid-form';
import { CancelButton } from './cancel-button';
import { ClaimButton } from './claim-button';
import { ForfeitButton } from './forfeit-button';
import { PitchForm } from './pitch-form';
import { ProofForm } from './proof-form';
import { RateForm } from './rate-form';
import { SelectWinnerButton } from './select-winner-button';
import { SelectWorkerPicker } from './select-worker-picker';
import { SubmitArtifactsForm } from './submit-artifacts-form';
import type { TaskActionComponentProps } from './types';
import { UpdateForm } from './update-form';

export { ConfirmDialog } from './confirm-dialog';
export { ConnectPrompt } from './connect-prompt';
export type { TaskActionComponentProps } from './types';

/**
 * Typed dispatcher map: every PendingActionNameValue MUST be present.
 * Adding a new pendingAction key is a compile error until a component
 * is wired in here.
 */
export const COMPONENT_BY_ACTION: Record<
  PendingActionNameValue,
  ComponentType<TaskActionComponentProps>
> = {
  accept: AcceptButton,
  auction_accept: AuctionAcceptButton,
  bid: BidForm,
  cancel: CancelButton,
  claim: ClaimButton,
  forfeit: ForfeitButton,
  pitch: PitchForm,
  rate: RateForm,
  select_winner: SelectWinnerButton,
  select_worker: SelectWorkerPicker,
  submit: SubmitArtifactsForm,
  submit_proof: ProofForm,
  update: UpdateForm,
};
