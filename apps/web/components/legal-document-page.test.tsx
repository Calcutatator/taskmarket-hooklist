import { describe, expect, it } from 'vitest';

import { legalDocumentMetadata } from './legal-document-page';

describe('legal document metadata', () => {
  it('keeps counsel-review drafts out of search indexes', () => {
    expect(legalDocumentMetadata('Terms of Service')).toMatchObject({
      robots: { follow: false, index: false },
      title: 'Terms of Service',
    });
  });
});
