import type { ArtifactResponse } from '@taskmarket/shared';
import { IdentityBadge } from './IdentityBadge';

const TEXT_PREVIEW_LIMIT = 2000;

interface ArtifactGalleryProps {
  artifacts: ArtifactResponse[];
  previewUrls?: Record<string, string>;
  textPreviews?: Record<string, string>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function textPreviewFor(artifact: ArtifactResponse, textPreviews?: Record<string, string>) {
  const value = artifact.textPreview ?? textPreviews?.[artifact.id] ?? '';
  if (value.length <= TEXT_PREVIEW_LIMIT) {
    return { value, truncated: false };
  }
  return { value: value.slice(0, TEXT_PREVIEW_LIMIT), truncated: true };
}

export function ArtifactGallery({
  artifacts,
  previewUrls = {},
  textPreviews = {},
}: ArtifactGalleryProps) {
  if (artifacts.length === 0) {
    return null;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {artifacts.map((artifact) => {
        const previewUrl = previewUrls[artifact.id];
        const label = `${artifact.fileName} (${formatBytes(artifact.sizeBytes)})`;

        return (
          <div
            key={artifact.id}
            className="overflow-hidden rounded-md border border-border-primary bg-background-secondary"
          >
            <div className="border-b border-border-primary px-3 py-2">
              <p className="truncate text-sm font-semibold text-text-primary">
                {artifact.fileName}
              </p>
              <p className="text-xs text-text-tertiary">
                {artifact.mediaKind} · {formatBytes(artifact.sizeBytes)}
              </p>
              <div className="mt-1">
                <IdentityBadge agentId={artifact.workerAgentId} address={artifact.workerAddress} />
              </div>
            </div>

            <div className="p-3">
              {artifact.mediaKind === 'image' && previewUrl && (
                <img
                  src={previewUrl}
                  alt={artifact.fileName}
                  className="aspect-video w-full rounded border border-border-primary object-contain bg-background-primary"
                />
              )}

              {artifact.mediaKind === 'video' && previewUrl && (
                <video
                  data-testid={`artifact-video-${artifact.id}`}
                  src={previewUrl}
                  controls
                  className="aspect-video w-full rounded border border-border-primary bg-background-primary"
                />
              )}

              {artifact.mediaKind === 'audio' && previewUrl && (
                <audio
                  data-testid={`artifact-audio-${artifact.id}`}
                  src={previewUrl}
                  controls
                  className="w-full"
                />
              )}

              {artifact.mediaKind === 'pdf' && previewUrl && (
                <iframe
                  title={artifact.fileName}
                  src={previewUrl}
                  className="h-64 w-full rounded border border-border-primary bg-background-primary"
                />
              )}

              {artifact.mediaKind === 'text' && (
                <div>
                  {(() => {
                    const preview = textPreviewFor(artifact, textPreviews);
                    return preview.value ? (
                      <>
                        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded border border-border-primary bg-background-primary p-3 text-xs text-text-secondary">
                          {preview.value}
                        </pre>
                        {preview.truncated && (
                          <p className="mt-2 text-xs text-text-tertiary">Preview truncated</p>
                        )}
                      </>
                    ) : (
                      <p className="text-sm text-text-tertiary">Text preview unavailable</p>
                    );
                  })()}
                </div>
              )}

              {!previewUrl && artifact.mediaKind !== 'text' && (
                <p className="text-sm text-text-tertiary">Preview unavailable until authorized</p>
              )}

              {previewUrl && (
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex text-sm font-semibold text-brand-primary hover:text-brand-secondary"
                >
                  Download {artifact.fileName}
                </a>
              )}

              {!previewUrl && artifact.mediaKind !== 'text' && (
                <p className="mt-3 text-xs text-text-tertiary">{label}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
