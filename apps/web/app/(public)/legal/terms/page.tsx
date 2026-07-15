import { LegalDocumentPage, legalDocumentMetadata } from '@/components/legal-document-page';

export const metadata = legalDocumentMetadata('Terms of Service');

export default function TermsPage() {
  return <LegalDocumentPage type="terms_of_service" />;
}
