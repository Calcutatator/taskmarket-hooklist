import { LegalDocumentPage, legalDocumentMetadata } from '@/components/legal-document-page';

export const metadata = legalDocumentMetadata('Risk Disclosure');

export default function RisksPage() {
  return <LegalDocumentPage type="risk_disclosure" />;
}
