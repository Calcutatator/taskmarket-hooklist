import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ArtifactGallery } from './ArtifactGallery';

const baseArtifact = {
  id: 'artifact-1',
  taskId: '0xtask',
  submissionId: 'submission-1',
  role: 'attachment',
  fileName: 'artifact.bin',
  mimeType: 'application/octet-stream',
  mediaKind: 'unknown',
  sizeBytes: 12,
  storageUri: 's3://bucket/artifact.bin',
  sha256Hash: 'a'.repeat(64),
  keccak256Hash: `0x${'b'.repeat(64)}`,
  displayOrder: 0,
} as const;

describe('ArtifactGallery', () => {
  it('renders image, video, audio, PDF, text, and unknown artifacts with generic controls', () => {
    render(
      <ArtifactGallery
        artifacts={[
          {
            ...baseArtifact,
            id: 'image-1',
            fileName: 'logo.png',
            mimeType: 'image/png',
            mediaKind: 'image',
          },
          {
            ...baseArtifact,
            id: 'video-1',
            fileName: 'demo.mp4',
            mimeType: 'video/mp4',
            mediaKind: 'video',
          },
          {
            ...baseArtifact,
            id: 'audio-1',
            fileName: 'voice.mp3',
            mimeType: 'audio/mpeg',
            mediaKind: 'audio',
          },
          {
            ...baseArtifact,
            id: 'pdf-1',
            fileName: 'brief.pdf',
            mimeType: 'application/pdf',
            mediaKind: 'pdf',
          },
          {
            ...baseArtifact,
            id: 'text-1',
            fileName: 'notes.md',
            mimeType: 'text/markdown',
            mediaKind: 'text',
          },
          {
            ...baseArtifact,
            id: 'zip-1',
            fileName: 'source.zip',
            mimeType: 'application/zip',
            mediaKind: 'archive',
          },
        ]}
        previewUrls={{
          'image-1': 'https://example.com/logo.png',
          'video-1': 'https://example.com/demo.mp4',
          'audio-1': 'https://example.com/voice.mp3',
          'pdf-1': 'https://example.com/brief.pdf',
          'text-1': 'https://example.com/notes.md',
          'zip-1': 'https://example.com/source.zip',
        }}
      />
    );

    expect(screen.getByAltText('logo.png')).toBeInTheDocument();
    expect(screen.getByTestId('artifact-video-video-1')).toBeInTheDocument();
    expect(screen.getByTestId('artifact-audio-audio-1')).toBeInTheDocument();
    expect(screen.getByTitle('brief.pdf')).toBeInTheDocument();
    expect(screen.getByText('notes.md')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /download source.zip/i })).toBeInTheDocument();
  });

  it('escapes text previews and caps long content', () => {
    render(
      <ArtifactGallery
        artifacts={[
          {
            ...baseArtifact,
            id: 'text-1',
            fileName: 'notes.txt',
            mimeType: 'text/plain',
            mediaKind: 'text',
            textPreview: '<script>alert("x")</script>' + 'a'.repeat(5000),
          },
        ]}
      />
    );

    expect(screen.getByText(/<script>alert/)).toBeInTheDocument();
    expect(screen.queryByRole('script')).not.toBeInTheDocument();
    expect(screen.getByText(/Preview truncated/)).toBeInTheDocument();
  });
});
