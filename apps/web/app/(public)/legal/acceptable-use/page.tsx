import { LegalDocumentPage, legalDocumentMetadata } from '@/components/legal-document-page';

export const metadata = legalDocumentMetadata('Acceptable Use Policy');

export default function AcceptableUsePage() {
  return <LegalDocumentPage type="acceptable_use_policy" />;
}
