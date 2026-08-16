'use client';

import {
  GameCurationResolveTaskInputSchema,
  GameCurationUpsertInputSchema,
  MAX_GAME_COVER_BYTES,
  MAX_GAME_COVER_DIMENSION,
  type GameCurationArtifact,
  type GameCurationGame,
  type GameCurationResolvedTask,
  type GameCurationUpsertInput,
} from '@taskmarket/shared';
import type { InteractiveHtmlRuntimeOutcome } from '@taskmarket/html-sandbox';
import { type ChangeEvent, type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

import { AppShell } from '@/components/app-shell';
import { CuratorArtifactPreview } from '@/components/curate/curator-artifact-preview';
import { CurationApiError, type CurationApi } from '@/lib/curation-api';

const SUPPORTED_COVER_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export type CuratorAuth = {
  authenticated: boolean;
  configured: boolean;
  getAccessToken: () => Promise<string | null>;
  login: () => void;
  ready: boolean;
};

type CurationWorkspaceProps = {
  api: CurationApi;
  auth: CuratorAuth;
};

type MetadataFields = {
  coverAltText: string;
  creatorName: string;
  description: string;
  slug: string;
  tags: string;
  title: string;
};

type CatalogCoverDraft = {
  dataBase64: string;
  height: number;
  mimeType: 'image/gif' | 'image/jpeg' | 'image/png' | 'image/webp';
  name: string;
  sizeBytes: number;
  width: number;
};

type Notice = {
  detail: string;
  kind: 'error' | 'success';
  title: string;
};

type PendingOperation = 'hide' | 'publish' | 'resolve' | 'save' | null;
type PendingConfirmation = 'hide' | 'publish' | null;

const emptyMetadata: MetadataFields = {
  coverAltText: '',
  creatorName: '',
  description: '',
  slug: '',
  tags: '',
  title: '',
};

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function metadataFromGame(game: GameCurationGame | null): MetadataFields {
  if (!game) return emptyMetadata;
  return {
    coverAltText: game.coverAltText ?? '',
    creatorName: game.creatorName ?? '',
    description: game.description ?? '',
    slug: game.slug,
    tags: game.tags.join(', '),
    title: game.title,
  };
}

function tagsFromField(value: string): string[] {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('The cover file could not be read.'));
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('The cover file could not be read.'));
        return;
      }
      resolve(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function readImageDimensions(dataUrl: string): Promise<{ height: number; width: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onerror = () => reject(new Error('The cover file is not a readable image.'));
    image.onload = () => resolve({ height: image.naturalHeight, width: image.naturalWidth });
    image.src = dataUrl;
  });
}

async function validateCatalogCover(file: File): Promise<CatalogCoverDraft> {
  const mimeType = file.type.toLowerCase();
  if (!SUPPORTED_COVER_MIME_TYPES.has(mimeType)) {
    throw new Error('Choose a PNG, JPEG, GIF, or WebP cover image.');
  }
  if (file.size === 0 || file.size > MAX_GAME_COVER_BYTES) {
    throw new Error(`Cover files must be between 1 byte and ${formatBytes(MAX_GAME_COVER_BYTES)}.`);
  }

  const dataUrl = await readFileAsDataUrl(file);
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex < 0) throw new Error('The cover file could not be read.');

  const dimensions = await readImageDimensions(dataUrl);
  if (dimensions.width === 0 || dimensions.width !== dimensions.height) {
    throw new Error('Cover images must be square.');
  }
  if (dimensions.width > MAX_GAME_COVER_DIMENSION) {
    throw new Error(
      `Cover dimensions must not exceed ${MAX_GAME_COVER_DIMENSION} by ${MAX_GAME_COVER_DIMENSION} pixels.`
    );
  }

  return {
    dataBase64: dataUrl.slice(commaIndex + 1),
    height: dimensions.height,
    mimeType: mimeType as CatalogCoverDraft['mimeType'],
    name: file.name,
    sizeBytes: file.size,
    width: dimensions.width,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Taskmarket could not finish this curation request.';
}

function selectedArtifactFromTask(
  task: GameCurationResolvedTask | null,
  artifactId: string | null
): { artifact: GameCurationArtifact; submissionId: string } | null {
  if (!task || !artifactId) return null;

  for (const submission of task.submissions) {
    const artifact = submission.artifacts.find((candidate) => candidate.id === artifactId);
    if (artifact) return { artifact, submissionId: submission.id };
  }

  return null;
}

function curationErrorNotice(error: unknown): Notice {
  if (error instanceof CurationApiError) {
    if (error.kind === 'conflict') {
      return {
        detail:
          'Another curator action changed this record. Resolve or save again before continuing.',
        kind: 'error',
        title: 'Curation conflict',
      };
    }
    if (error.kind === 'invalid') {
      return { detail: error.message, kind: 'error', title: 'Review the curation details' };
    }
    if (error.kind === 'not-found') {
      return { detail: error.message, kind: 'error', title: 'Source no longer available' };
    }
  }

  return {
    detail: 'Taskmarket could not finish this request. Your local edits are still here.',
    kind: 'error',
    title: 'Curation server error',
  };
}

function accessPanelCopy(kind: 'denied' | 'expired' | 'loading' | 'signin' | 'unavailable') {
  if (kind === 'unavailable') {
    return {
      detail:
        'Curator sign-in is not configured for this deployment. Curation stays closed until the trusted Privy configuration is available.',
      title: 'Curator access unavailable',
    };
  }
  if (kind === 'loading') {
    return {
      detail: 'Checking the Privy session before any curator data or action is available.',
      title: 'Checking curator access',
    };
  }
  if (kind === 'signin') {
    return {
      detail:
        'Sign in with the Privy identity that has been authorized by the server-side curator allowlist.',
      title: 'Curator sign-in required',
    };
  }
  if (kind === 'expired') {
    return {
      detail:
        'The server could no longer verify this curator session. Sign in again before requesting any task data.',
      title: 'Curator session expired',
    };
  }
  return {
    detail:
      'This Privy identity is not in the server-side curator allowlist. No task, artifact, or draft data is available here.',
    title: 'Curator access denied',
  };
}

// Implements: ADR-0087 and ADR-0088. This private control plane only ever asks the backend for
// curator data after Privy sign-in, shows exact immutable source pins, and records a preview
// attestation only after the shared production runtime has successfully verified the selected bytes.
export function CurationWorkspace({ api, auth }: Readonly<CurationWorkspaceProps>) {
  const [reference, setReference] = useState('');
  const [resolution, setResolution] = useState<GameCurationResolvedTask | null>(null);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [previewOutcome, setPreviewOutcome] = useState<InteractiveHtmlRuntimeOutcome | null>(null);
  const [metadata, setMetadata] = useState<MetadataFields>(emptyMetadata);
  const [catalogCover, setCatalogCover] = useState<CatalogCoverDraft | null>(null);
  const [coverRemoved, setCoverRemoved] = useState(false);
  const [draft, setDraft] = useState<GameCurationGame | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const [operation, setOperation] = useState<PendingOperation>(null);
  const [confirmation, setConfirmation] = useState<PendingConfirmation>(null);
  const [accessFailure, setAccessFailure] = useState<'expired-session' | 'unauthorized' | null>(
    null
  );

  const selected = useMemo(
    () => selectedArtifactFromTask(resolution, selectedArtifactId),
    [resolution, selectedArtifactId]
  );
  const previewReady = previewOutcome?.kind === 'ready';
  const persistedCoverExists = !coverRemoved && Boolean(draft?.coverSource);
  const hasCover = Boolean(catalogCover) || persistedCoverExists;
  const isPublished = draft?.status === 'published';
  const workspaceBusy = operation !== null;

  const clearCuratorData = useCallback(() => {
    setResolution(null);
    setSelectedArtifactId(null);
    setPreviewOutcome(null);
    setMetadata(emptyMetadata);
    setCatalogCover(null);
    setCoverRemoved(false);
    setDraft(null);
    setFieldErrors({});
    setConfirmation(null);
  }, []);

  useEffect(() => {
    if (!auth.ready || !auth.authenticated) {
      clearCuratorData();
    }
  }, [auth.authenticated, auth.ready, clearCuratorData]);

  const handleAuthFailure = useCallback(
    (error: unknown): boolean => {
      if (!(error instanceof CurationApiError)) return false;
      if (error.kind !== 'expired-session' && error.kind !== 'unauthorized') return false;

      setAccessFailure(error.kind);
      clearCuratorData();
      setNotice(null);
      return true;
    },
    [clearCuratorData]
  );

  const getAccessToken = useCallback(async (): Promise<string | null> => {
    try {
      const accessToken = await auth.getAccessToken();
      if (!accessToken) {
        setAccessFailure('expired-session');
        clearCuratorData();
        setNotice(null);
        return null;
      }
      return accessToken;
    } catch {
      setAccessFailure('expired-session');
      clearCuratorData();
      setNotice(null);
      return null;
    }
  }, [auth, clearCuratorData]);

  const handlePreviewOutcome = useCallback((outcome: InteractiveHtmlRuntimeOutcome | null) => {
    setPreviewOutcome(outcome);
  }, []);

  function selectArtifact(artifactId: string) {
    if (isPublished || workspaceBusy) return;
    setSelectedArtifactId(artifactId);
    setPreviewOutcome(null);
    setConfirmation(null);
    setNotice(null);
  }

  function setMetadataField(field: keyof MetadataFields, value: string) {
    if (isPublished || workspaceBusy) return;
    setMetadata((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => {
      const remaining = { ...current };
      delete remaining[field];
      return remaining;
    });
  }

  function preparedInput(requirePublicationRequirements: boolean): GameCurationUpsertInput | null {
    if (!resolution || !selected) {
      setFieldErrors({ source: 'Select an accepted playable artifact before saving.' });
      return null;
    }

    const input = {
      artifactId: selected.artifact.id,
      cover: coverRemoved
        ? null
        : catalogCover
          ? {
              dataBase64: catalogCover.dataBase64,
              mimeType: catalogCover.mimeType,
              source: 'catalog_asset' as const,
            }
          : undefined,
      coverAltText: metadata.coverAltText || null,
      creatorName: metadata.creatorName || null,
      description: metadata.description || null,
      gameId: draft?.id,
      previewed: previewReady,
      slug: metadata.slug,
      submissionId: selected.submissionId,
      tags: tagsFromField(metadata.tags),
      taskId: resolution.task.id,
      title: metadata.title,
    };
    const parsed = GameCurationUpsertInputSchema.safeParse(input);
    const errors: Record<string, string> = {};

    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0] ?? 'metadata');
        errors[field] ??= issue.message;
      }
    }
    if (requirePublicationRequirements && !previewReady) {
      errors.preview = 'Load and verify the selected artifact in the production sandbox first.';
    }
    if (requirePublicationRequirements && !hasCover) {
      errors.cover = 'Choose a verified square cover before publishing.';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0 && parsed.success ? parsed.data : null;
  }

  async function handleResolve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedReference = GameCurationResolveTaskInputSchema.safeParse({ reference });
    if (!parsedReference.success) {
      setFieldErrors({
        reference: parsedReference.error.issues[0]?.message ?? 'Enter a task URL or ID.',
      });
      return;
    }

    const accessToken = await getAccessToken();
    if (!accessToken) return;

    setOperation('resolve');
    setFieldErrors({});
    setNotice(null);
    setConfirmation(null);
    try {
      const nextResolution = await api.resolveTask(parsedReference.data.reference, accessToken);
      setResolution(nextResolution);
      setSelectedArtifactId(null);
      setPreviewOutcome(null);
      setDraft(null);
      setCatalogCover(null);
      setCoverRemoved(false);
      setMetadata({ ...emptyMetadata, tags: nextResolution.task.tags.join(', ') });
      setReference(nextResolution.task.id);
      if (!nextResolution.eligible) {
        setNotice({
          detail:
            nextResolution.eligibilityReason ?? 'This task has no eligible playable artifact.',
          kind: 'error',
          title: 'No eligible artifact',
        });
      }
    } catch (error) {
      if (!handleAuthFailure(error)) setNotice(curationErrorNotice(error));
    } finally {
      setOperation(null);
    }
  }

  async function handleCoverChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || isPublished || workspaceBusy) return;

    try {
      const cover = await validateCatalogCover(file);
      setCatalogCover(cover);
      setCoverRemoved(false);
      setFieldErrors((current) => {
        const remaining = { ...current };
        delete remaining.cover;
        return remaining;
      });
    } catch (error) {
      setFieldErrors((current) => ({ ...current, cover: errorMessage(error) }));
    }
  }

  async function saveDraft() {
    const input = preparedInput(false);
    if (!input) return;
    const accessToken = await getAccessToken();
    if (!accessToken) return;

    setOperation('save');
    setNotice(null);
    try {
      const result = await api.upsert(input, accessToken);
      setDraft(result.game);
      setMetadata(metadataFromGame(result.game));
      setCatalogCover(null);
      setCoverRemoved(false);
      setNotice({
        detail:
          'The selected Taskmarket source remains pinned by its IDs and hashes. No HTML was copied or edited.',
        kind: 'success',
        title: 'Draft saved',
      });
    } catch (error) {
      if (!handleAuthFailure(error)) setNotice(curationErrorNotice(error));
    } finally {
      setOperation(null);
    }
  }

  function requestPublishConfirmation() {
    if (!preparedInput(true)) return;
    setConfirmation('publish');
    setNotice(null);
  }

  async function publish() {
    const input = preparedInput(true);
    if (!input) {
      setConfirmation(null);
      return;
    }
    const accessToken = await getAccessToken();
    if (!accessToken) return;
    const wasHidden = draft?.status === 'hidden';

    setOperation('publish');
    setNotice(null);
    try {
      const saved = await api.upsert(input, accessToken);
      const published = await api.publish({ gameId: saved.game.id }, accessToken);
      setDraft(published.game);
      setMetadata(metadataFromGame(published.game));
      setCatalogCover(null);
      setCoverRemoved(false);
      setConfirmation(null);
      setNotice({
        detail:
          'The public catalog now points to the reviewed Taskmarket artifact pin and immutable cover reference.',
        kind: 'success',
        title: wasHidden ? 'Game republished' : 'Game published',
      });
    } catch (error) {
      if (!handleAuthFailure(error)) setNotice(curationErrorNotice(error));
    } finally {
      setOperation(null);
    }
  }

  function requestHideConfirmation() {
    if (!draft || draft.status !== 'published') return;
    setConfirmation('hide');
    setNotice(null);
  }

  async function hide() {
    if (!draft) return;
    const accessToken = await getAccessToken();
    if (!accessToken) return;

    setOperation('hide');
    setNotice(null);
    try {
      const hidden = await api.hide({ gameId: draft.id }, accessToken);
      setDraft(hidden.game);
      setMetadata(metadataFromGame(hidden.game));
      setConfirmation(null);
      setNotice({
        detail:
          'The game is hidden from the public catalog. Its source and cover pins remain intact for review or re-publication.',
        kind: 'success',
        title: 'Game hidden',
      });
    } catch (error) {
      if (!handleAuthFailure(error)) setNotice(curationErrorNotice(error));
    } finally {
      setOperation(null);
    }
  }

  const accessKind = !auth.configured
    ? 'unavailable'
    : !auth.ready
      ? 'loading'
      : accessFailure === 'expired-session'
        ? 'expired'
        : accessFailure === 'unauthorized'
          ? 'denied'
          : !auth.authenticated
            ? 'signin'
            : null;

  if (accessKind) {
    const copy = accessPanelCopy(accessKind);
    return (
      <AppShell
        rail={
          <span className="border-l border-catalog-border px-3 text-xs text-catalog-muted">
            Curate
          </span>
        }
      >
        <section className="grid min-h-[calc(100dvh-2.75rem)] place-items-center p-4">
          <div className="max-w-md border border-catalog-border bg-catalog-surface p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-catalog-muted">
              Private workspace
            </p>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight">{copy.title}</h1>
            <p className="mt-3 text-sm leading-6 text-catalog-muted">{copy.detail}</p>
            {accessKind === 'signin' || accessKind === 'expired' ? (
              <button
                className="mt-5 min-h-11 bg-catalog-ink px-4 text-sm font-semibold text-catalog-canvas hover:opacity-90"
                onClick={() => {
                  setAccessFailure(null);
                  auth.login();
                }}
                type="button"
              >
                {accessKind === 'expired' ? 'Sign in again' : 'Sign in to curate'}
              </button>
            ) : null}
          </div>
        </section>
      </AppShell>
    );
  }

  return (
    <AppShell
      rail={
        <span className="border-l border-catalog-border px-3 text-xs text-catalog-muted">
          Curate
        </span>
      }
    >
      <section
        aria-labelledby="curation-workspace-title"
        className="border-b border-catalog-border px-4 py-5 sm:px-6"
      >
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-catalog-muted">
          Private workspace
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight" id="curation-workspace-title">
          Curate a Taskmarket game
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-catalog-muted">
          Resolve an accepted artifact, review the exact source in the production sandbox, then pin
          its metadata and cover for Slap-Chop. This workspace never copies or edits the HTML.
        </p>
      </section>

      <div className="grid gap-px bg-catalog-border xl:grid-cols-[minmax(22rem,0.85fr)_minmax(28rem,1.15fr)]">
        <section className="min-w-0 bg-catalog-canvas p-4 sm:p-6">
          <form
            className="border border-catalog-border bg-catalog-surface p-4"
            onSubmit={handleResolve}
          >
            <label className="block text-sm font-semibold" htmlFor="task-reference">
              Task URL or ID
            </label>
            <p className="mt-1 text-xs leading-5 text-catalog-muted">
              Paste a canonical taskmarket.dev task URL or its exact Taskmarket ID.
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                aria-describedby={fieldErrors.reference ? 'task-reference-error' : undefined}
                className="min-h-11 min-w-0 flex-1 border border-catalog-border bg-catalog-canvas px-3 text-sm text-catalog-ink placeholder:text-catalog-muted"
                disabled={workspaceBusy}
                id="task-reference"
                onChange={(event) => setReference(event.target.value)}
                placeholder="https://taskmarket.dev/tasks/..."
                type="text"
                value={reference}
              />
              <button
                className="min-h-11 border border-catalog-ink px-4 text-sm font-semibold text-catalog-ink hover:bg-catalog-ink hover:text-catalog-canvas disabled:cursor-wait disabled:border-catalog-border disabled:text-catalog-muted"
                disabled={workspaceBusy}
                type="submit"
              >
                {operation === 'resolve' ? 'Resolving' : 'Resolve task'}
              </button>
            </div>
            {fieldErrors.reference ? (
              <p className="mt-2 text-sm text-catalog-ink" id="task-reference-error" role="alert">
                {fieldErrors.reference}
              </p>
            ) : null}
          </form>

          {resolution ? (
            <TaskResolution
              disabled={isPublished || workspaceBusy}
              onSelectArtifact={selectArtifact}
              resolution={resolution}
              selectedArtifactId={selectedArtifactId}
            />
          ) : (
            <section className="mt-4 border border-dashed border-catalog-border p-4">
              <h2 className="text-base font-semibold tracking-tight">
                Start with an accepted task
              </h2>
              <p className="mt-2 text-sm leading-6 text-catalog-muted">
                The backend filters this view to public resolved tasks, accepted submissions, and
                playable HTML artifacts with deliverable provenance.
              </p>
            </section>
          )}
        </section>

        <section className="min-w-0 bg-catalog-canvas p-4 sm:p-6">
          <CuratorArtifactPreview
            artifact={selected?.artifact ?? null}
            onOutcomeChange={handlePreviewOutcome}
          />

          <MetadataEditor
            catalogCover={catalogCover}
            coverError={fieldErrors.cover}
            coverRemoved={coverRemoved}
            disabled={isPublished || workspaceBusy || !selected}
            draft={draft}
            errors={fieldErrors}
            hasPersistedCover={persistedCoverExists}
            metadata={metadata}
            onCoverChange={(event) => void handleCoverChange(event)}
            onFieldChange={setMetadataField}
            onRemoveCover={() => {
              setCatalogCover(null);
              setCoverRemoved(true);
              setFieldErrors((current) => {
                const remaining = { ...current };
                delete remaining.cover;
                return remaining;
              });
            }}
          />

          {selected ? (
            <PublicationControls
              canPublish={previewReady && hasCover}
              confirmation={confirmation}
              draft={draft}
              errors={fieldErrors}
              onCancelConfirmation={() => setConfirmation(null)}
              onConfirmHide={() => void hide()}
              onConfirmPublish={() => void publish()}
              onHide={requestHideConfirmation}
              onPublish={requestPublishConfirmation}
              onSave={() => void saveDraft()}
              operation={operation}
              previewReady={previewReady}
            />
          ) : null}

          {notice ? <NoticePanel notice={notice} /> : null}
        </section>
      </div>
    </AppShell>
  );
}

function TaskResolution({
  disabled,
  onSelectArtifact,
  resolution,
  selectedArtifactId,
}: Readonly<{
  disabled: boolean;
  onSelectArtifact: (artifactId: string) => void;
  resolution: GameCurationResolvedTask;
  selectedArtifactId: string | null;
}>) {
  return (
    <section
      aria-labelledby="resolved-task-title"
      className="mt-4 border border-catalog-border bg-catalog-surface"
    >
      <header className="border-b border-catalog-border px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-catalog-muted">
          Task source
        </p>
        <h2 className="mt-1 text-lg font-semibold tracking-tight" id="resolved-task-title">
          {resolution.task.id}
        </h2>
        <p className="mt-2 text-sm leading-6 text-catalog-muted">{resolution.task.description}</p>
      </header>

      {!resolution.eligible ? (
        <div className="p-4">
          <p className="text-sm font-semibold">No eligible playable artifact</p>
          <p className="mt-2 text-sm leading-6 text-catalog-muted">
            {resolution.eligibilityReason ??
              'This task cannot be curated into the public game catalog.'}
          </p>
        </div>
      ) : (
        <fieldset className="p-4">
          <legend className="text-sm font-semibold">Choose one accepted HTML artifact</legend>
          <p className="mt-1 text-xs leading-5 text-catalog-muted">
            The selected IDs and hashes become the immutable catalog source pin. They are not a copy
            of the Taskmarket file.
          </p>
          <div className="mt-4 space-y-4">
            {resolution.submissions.map((submission) => (
              <section className="border border-catalog-border" key={submission.id}>
                <header className="border-b border-catalog-border px-3 py-2">
                  <p className="font-mono text-xs text-catalog-muted">Submission {submission.id}</p>
                  <p className="mt-1 text-xs text-catalog-muted">
                    {submission.workerAddress} · submitted {formatDate(submission.submittedAt)}
                  </p>
                </header>
                <ul>
                  {submission.artifacts.map((artifact) => {
                    const inputId = `artifact-${artifact.id}`;
                    return (
                      <li
                        className="border-b border-catalog-border last:border-b-0"
                        key={artifact.id}
                      >
                        <label
                          className="block cursor-pointer px-3 py-3 has-[:checked]:bg-catalog-canvas"
                          htmlFor={inputId}
                        >
                          <span className="flex items-start gap-3">
                            <input
                              checked={selectedArtifactId === artifact.id}
                              disabled={disabled}
                              id={inputId}
                              name="curation-artifact"
                              onChange={() => onSelectArtifact(artifact.id)}
                              type="radio"
                              value={artifact.id}
                            />
                            <span className="min-w-0">
                              <span className="block break-all text-sm font-semibold">
                                {artifact.fileName}
                              </span>
                              <span className="mt-1 block text-xs text-catalog-muted">
                                {artifact.role} · {artifact.mimeType} ·{' '}
                                {formatBytes(artifact.sizeBytes)}
                              </span>
                              <span className="mt-2 block break-all font-mono text-[0.6875rem] leading-5 text-catalog-muted">
                                SHA-256 {artifact.sha256Hash}
                              </span>
                              <span className="block break-all font-mono text-[0.6875rem] leading-5 text-catalog-muted">
                                Keccak-256 {artifact.keccak256Hash}
                              </span>
                            </span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        </fieldset>
      )}
    </section>
  );
}

function MetadataEditor({
  catalogCover,
  coverError,
  coverRemoved,
  disabled,
  draft,
  errors,
  hasPersistedCover,
  metadata,
  onCoverChange,
  onFieldChange,
  onRemoveCover,
}: Readonly<{
  catalogCover: CatalogCoverDraft | null;
  coverError?: string;
  coverRemoved: boolean;
  disabled: boolean;
  draft: GameCurationGame | null;
  errors: Record<string, string>;
  hasPersistedCover: boolean;
  metadata: MetadataFields;
  onCoverChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onFieldChange: (field: keyof MetadataFields, value: string) => void;
  onRemoveCover: () => void;
}>) {
  const coverSummary = catalogCover
    ? `${catalogCover.name} · ${catalogCover.width} × ${catalogCover.height} · ${formatBytes(catalogCover.sizeBytes)}`
    : hasPersistedCover
      ? `${draft?.coverSource === 'artifact' ? 'Pinned Taskmarket artifact cover' : 'Pinned catalog-owned cover'} · ${draft?.coverWidth} × ${draft?.coverHeight}`
      : coverRemoved
        ? 'Cover removed. Choose another square image before publishing.'
        : 'No cover selected.';

  return (
    <section
      aria-labelledby="metadata-title"
      className="mt-4 border border-catalog-border bg-catalog-surface p-4"
    >
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-catalog-muted">
        Catalog metadata
      </p>
      <h2 className="mt-1 text-lg font-semibold tracking-tight" id="metadata-title">
        Describe the pinned game
      </h2>
      {draft?.status === 'published' ? (
        <p className="mt-2 text-sm leading-6 text-catalog-muted">
          Hide the public game before changing its source or metadata.
        </p>
      ) : null}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field
          error={errors.title}
          id="curation-title"
          label="Title"
          maxLength={120}
          onChange={(value) => onFieldChange('title', value)}
          required
          value={metadata.title}
          disabled={disabled}
        />
        <Field
          error={errors.slug}
          id="curation-slug"
          label="Unique slug"
          maxLength={120}
          onChange={(value) => onFieldChange('slug', value)}
          placeholder="lowercase-kebab-case"
          required
          value={metadata.slug}
          disabled={disabled}
        />
        <Field
          error={errors.creatorName}
          id="curation-creator"
          label="Creator name"
          maxLength={120}
          onChange={(value) => onFieldChange('creatorName', value)}
          value={metadata.creatorName}
          disabled={disabled}
        />
        <Field
          error={errors.tags}
          id="curation-tags"
          label="Tags"
          maxLength={1_280}
          onChange={(value) => onFieldChange('tags', value)}
          placeholder="arcade, puzzle"
          value={metadata.tags}
          disabled={disabled}
        />
      </div>
      <Field
        error={errors.description}
        id="curation-description"
        label="Description"
        maxLength={2_000}
        multiline
        onChange={(value) => onFieldChange('description', value)}
        value={metadata.description}
        disabled={disabled}
      />

      <div className="mt-4 border border-catalog-border p-3">
        <label className="block text-sm font-semibold" htmlFor="curation-cover">
          Square cover image
        </label>
        <p className="mt-1 text-xs leading-5 text-catalog-muted">
          PNG, JPEG, GIF, or WebP. At most {formatBytes(MAX_GAME_COVER_BYTES)} and{' '}
          {MAX_GAME_COVER_DIMENSION} by {MAX_GAME_COVER_DIMENSION} pixels. Curator-supplied covers
          are verified and stored under an immutable catalog-owned digest key.
        </p>
        <input
          accept="image/png,image/jpeg,image/gif,image/webp"
          className="mt-3 block w-full text-sm text-catalog-muted file:mr-3 file:min-h-10 file:border file:border-catalog-border file:bg-catalog-canvas file:px-3 file:text-sm file:font-semibold file:text-catalog-ink hover:file:bg-catalog-surface"
          disabled={disabled}
          id="curation-cover"
          onChange={onCoverChange}
          type="file"
        />
        <p className="mt-3 text-sm leading-6 text-catalog-muted">{coverSummary}</p>
        {(catalogCover || hasPersistedCover) && !disabled ? (
          <button
            className="mt-2 min-h-9 text-sm font-semibold text-catalog-ink underline underline-offset-4"
            onClick={onRemoveCover}
            type="button"
          >
            Remove cover
          </button>
        ) : null}
        {coverError ? (
          <p className="mt-2 text-sm text-catalog-ink" role="alert">
            {coverError}
          </p>
        ) : null}
      </div>

      <Field
        error={errors.coverAltText}
        id="curation-cover-alt"
        label="Cover alt text"
        maxLength={240}
        onChange={(value) => onFieldChange('coverAltText', value)}
        value={metadata.coverAltText}
        disabled={disabled}
      />
    </section>
  );
}

function Field({
  disabled,
  error,
  id,
  label,
  maxLength,
  multiline = false,
  onChange,
  placeholder,
  required = false,
  value,
}: Readonly<{
  disabled: boolean;
  error?: string;
  id: string;
  label: string;
  maxLength: number;
  multiline?: boolean;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  value: string;
}>) {
  const inputClassName =
    'mt-2 w-full border border-catalog-border bg-catalog-canvas px-3 py-2 text-sm text-catalog-ink placeholder:text-catalog-muted disabled:cursor-not-allowed disabled:text-catalog-muted';
  const errorId = `${id}-error`;

  return (
    <div className={multiline ? 'mt-4' : ''}>
      <label className="block text-sm font-semibold" htmlFor={id}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {multiline ? (
        <textarea
          aria-describedby={error ? errorId : undefined}
          className={`${inputClassName} min-h-28 resize-y`}
          disabled={disabled}
          id={id}
          maxLength={maxLength}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          value={value}
        />
      ) : (
        <input
          aria-describedby={error ? errorId : undefined}
          className={inputClassName}
          disabled={disabled}
          id={id}
          maxLength={maxLength}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          required={required}
          type="text"
          value={value}
        />
      )}
      {error ? (
        <p className="mt-1 text-sm text-catalog-ink" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function PublicationControls({
  canPublish,
  confirmation,
  draft,
  errors,
  onCancelConfirmation,
  onConfirmHide,
  onConfirmPublish,
  onHide,
  onPublish,
  onSave,
  operation,
  previewReady,
}: Readonly<{
  canPublish: boolean;
  confirmation: PendingConfirmation;
  draft: GameCurationGame | null;
  errors: Record<string, string>;
  onCancelConfirmation: () => void;
  onConfirmHide: () => void;
  onConfirmPublish: () => void;
  onHide: () => void;
  onPublish: () => void;
  onSave: () => void;
  operation: PendingOperation;
  previewReady: boolean;
}>) {
  const pending = operation !== null;
  const published = draft?.status === 'published';

  return (
    <section
      aria-labelledby="publication-title"
      className="mt-4 border border-catalog-border bg-catalog-surface p-4"
    >
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-catalog-muted">
        Publication
      </p>
      <h2 className="mt-1 text-lg font-semibold tracking-tight" id="publication-title">
        {published ? 'Public catalog status' : 'Draft and publication'}
      </h2>
      <p className="mt-2 text-sm leading-6 text-catalog-muted">
        {draft
          ? `Current state: ${draft.status}.`
          : 'Save a draft to create the catalog record before publication.'}
      </p>

      {!published ? (
        <ul className="mt-3 space-y-1 text-sm text-catalog-muted">
          <li>
            {previewReady ? 'Verified preview complete.' : 'Production preview still required.'}
          </li>
          <li>{canPublish ? 'Square cover ready.' : 'Verified square cover still required.'}</li>
          {errors.preview ? <li>{errors.preview}</li> : null}
          {errors.cover ? <li>{errors.cover}</li> : null}
        </ul>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {published ? (
          <button
            className="min-h-11 border border-catalog-ink px-4 text-sm font-semibold text-catalog-ink hover:bg-catalog-ink hover:text-catalog-canvas disabled:cursor-wait disabled:border-catalog-border disabled:text-catalog-muted"
            disabled={pending}
            onClick={onHide}
            type="button"
          >
            Hide from catalog
          </button>
        ) : (
          <>
            <button
              className="min-h-11 border border-catalog-border px-4 text-sm font-semibold text-catalog-ink hover:bg-catalog-canvas disabled:cursor-wait disabled:text-catalog-muted"
              disabled={pending}
              onClick={onSave}
              type="button"
            >
              {operation === 'save' ? 'Saving draft' : 'Save draft'}
            </button>
            <button
              className="min-h-11 bg-catalog-ink px-4 text-sm font-semibold text-catalog-canvas hover:opacity-90 disabled:cursor-not-allowed disabled:bg-catalog-border disabled:text-catalog-muted"
              disabled={pending || !canPublish}
              onClick={onPublish}
              type="button"
            >
              {draft?.status === 'hidden' ? 'Review re-publication' : 'Review publication'}
            </button>
          </>
        )}
      </div>

      {confirmation === 'publish' ? (
        <ConfirmationPanel
          confirmLabel={draft?.status === 'hidden' ? 'Re-publish game' : 'Publish game'}
          detail="This saves the visible metadata and exact source pin, then makes that reviewed pin public. The HTML source stays in Taskmarket and cannot be edited here."
          disabled={operation === 'publish'}
          onCancel={onCancelConfirmation}
          onConfirm={onConfirmPublish}
          title={draft?.status === 'hidden' ? 'Confirm re-publication' : 'Confirm publication'}
        />
      ) : null}
      {confirmation === 'hide' ? (
        <ConfirmationPanel
          confirmLabel="Hide game"
          detail="This immediately removes the game from the public catalog. The immutable source and cover pins remain available for a later re-publication."
          disabled={operation === 'hide'}
          onCancel={onCancelConfirmation}
          onConfirm={onConfirmHide}
          title="Confirm hide"
        />
      ) : null}
    </section>
  );
}

function ConfirmationPanel({
  confirmLabel,
  detail,
  disabled,
  onCancel,
  onConfirm,
  title,
}: Readonly<{
  confirmLabel: string;
  detail: string;
  disabled: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
}>) {
  return (
    <section
      aria-labelledby="curation-confirmation-title"
      className="mt-4 border border-catalog-ink bg-catalog-canvas p-4"
    >
      <h3 className="text-base font-semibold" id="curation-confirmation-title">
        {title}
      </h3>
      <p className="mt-2 text-sm leading-6 text-catalog-muted">{detail}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          className="min-h-10 bg-catalog-ink px-3 text-sm font-semibold text-catalog-canvas disabled:cursor-wait disabled:bg-catalog-border"
          disabled={disabled}
          onClick={onConfirm}
          type="button"
        >
          {disabled ? 'Working' : confirmLabel}
        </button>
        <button
          className="min-h-10 border border-catalog-border px-3 text-sm font-semibold text-catalog-ink disabled:cursor-wait"
          disabled={disabled}
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
      </div>
    </section>
  );
}

function NoticePanel({ notice }: Readonly<{ notice: Notice }>) {
  return (
    <section
      aria-live={notice.kind === 'error' ? 'assertive' : 'polite'}
      className="mt-4 border border-catalog-border bg-catalog-surface p-4"
      role={notice.kind === 'error' ? 'alert' : 'status'}
    >
      <h2 className="text-base font-semibold">{notice.title}</h2>
      <p className="mt-2 text-sm leading-6 text-catalog-muted">{notice.detail}</p>
    </section>
  );
}
