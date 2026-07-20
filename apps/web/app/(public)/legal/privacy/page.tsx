import { LegalDocumentPage, legalDocumentMetadata } from '@/components/legal-document-page';

export const metadata = legalDocumentMetadata('Privacy Policy');

export default function PrivacyPage() {
  return <LegalDocumentPage type="privacy_policy" />;
}
