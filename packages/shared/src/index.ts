export * from './schemas/index';
export * from './platform.constants';
export { getAgentName, getAgentIdByName } from './lib/agentName';
export {
  estimateUsdBonusValue,
  estimateWorkerUsdBonusValue,
  estimateRequesterUsdBonusValue,
  estimateWorkerDreamsBonus,
  estimateRequesterDreamsBonus,
  dreamsToUsd,
  formatDreams,
} from './lib/dreams';
export {
  buildSelectWorkerMessage,
  buildInboxSelfAuthMessage,
  buildMyBidsMessage,
} from './lib/authMessages';
export {
  CURRENT_LEGAL_BUNDLE,
  LEGAL_BUNDLES,
  LEGAL_ACCEPTANCE_STATEMENT,
  LEGAL_ENTITY,
  LEGAL_RECEIPT_HEADER,
  buildLegalReceiptHeaders,
  buildWalletLegalAcceptanceMessage,
  getCurrentLegalBundleActivationIssues,
  getLegalBundleActivationIssues,
  isCurrentLegalBundleActivationReady,
  type LegalCopyStatus,
  type LegalDocument,
  type LegalDocumentEvidence,
  type LegalDocumentType,
  type LegalPolicyBundle,
} from './legal';
