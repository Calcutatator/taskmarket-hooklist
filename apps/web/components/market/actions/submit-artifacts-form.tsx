'use client';

import { useCallback, useRef, useState } from 'react';
import { useAccount, useSignMessage } from 'wagmi';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { getBrowserApiBaseUrl } from '@/lib/api/config';
import { signAndPost } from '@/lib/wallet-sign-action';

import { ConnectPrompt } from './connect-prompt';
import type { TaskActionComponentProps } from './types';

const ARTIFACT_ROLES = ['preview', 'source', 'final', 'attachment'] as const;
type ArtifactRole = (typeof ARTIFACT_ROLES)[number];

const MAX_FILES = 20;
const MAX_FILE_SIZE = 5 * 1024 * 1024;

type Staged = {
  id: string;
  file: File;
  role: ArtifactRole;
};

function detectMimeType(file: File): string {
  return file.type || 'application/octet-stream';
}

function bytesToDisplay(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('FileReader produced non-string result'));
        return;
      }
      const idx = result.indexOf(',');
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

export function SubmitArtifactsForm({ disabled, task }: TaskActionComponentProps) {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [staged, setStaged] = useState<Staged[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [dragging, setDragging] = useState(false);

  const addFiles = useCallback((files: FileList | File[]) => {
    setError(null);
    setStaged((current) => {
      const list = Array.from(files);
      const oversized = list.filter((f) => f.size > MAX_FILE_SIZE);
      const fitting = list.filter((f) => f.size <= MAX_FILE_SIZE);
      const remaining = MAX_FILES - current.length;
      const messages: string[] = [];
      if (oversized.length > 0) {
        messages.push(
          oversized.length === 1
            ? `File "${oversized[0].name}" exceeds 5 MB and was skipped.`
            : `${oversized.length} files exceed 5 MB and were skipped.`
        );
      }
      if (fitting.length > remaining) {
        messages.push(`At most ${MAX_FILES} files per submission — extra files were dropped.`);
      }
      if (messages.length > 0) setError(messages.join(' '));
      const accepted = fitting.slice(0, remaining).map((file, i) => ({
        id: `${Date.now()}-${i}-${file.name}`,
        file,
        role: 'attachment' as ArtifactRole,
      }));
      return [...current, ...accepted];
    });
  }, []);

  if (!isConnected || !address) {
    return <ConnectPrompt label="Connect a worker wallet to submit artifacts." />;
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files) addFiles(event.dataTransfer.files);
  }

  function setRole(id: string, role: ArtifactRole) {
    setStaged((current) => current.map((s) => (s.id === id ? { ...s, role } : s)));
  }

  function removeStaged(id: string) {
    setStaged((current) => current.filter((s) => s.id !== id));
  }

  async function handleSubmit() {
    if (staged.length === 0) {
      setError('Add at least one file before submitting');
      return;
    }
    setPending(true);
    setError(null);

    let artifacts: Array<{ fileName: string; mimeType: string; role: ArtifactRole; file: string }>;
    try {
      artifacts = await Promise.all(
        staged.map(async (s) => ({
          fileName: s.file.name,
          mimeType: detectMimeType(s.file),
          role: s.role,
          file: await fileToBase64(s.file),
        }))
      );
    } catch (err) {
      setPending(false);
      setError(err instanceof Error ? err.message : 'Failed to read files');
      return;
    }

    const result = await signAndPost<{ submissionId: string }>({
      deps: { address: address!, apiUrl: getBrowserApiBaseUrl(), signMessageAsync },
      extraBody: { artifacts },
      path: `/api/tasks/${task.id}/submissions`,
      taskId: task.id,
      verbForMessage: 'submit',
    });
    setPending(false);
    if (result.ok) {
      setDone(true);
    } else if (!result.rejected) {
      setError(result.error);
    }
  }

  if (done) {
    return <span className="font-mono text-sm text-primary">✓ Submission posted</span>;
  }

  return (
    <div className="grid gap-3">
      <div
        className={`rounded-md border border-dashed p-4 text-center transition-colors ${
          dragging ? 'border-primary bg-primary/5' : 'border-border/70 bg-surface/40'
        }`}
        onDragLeave={() => setDragging(false)}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDrop={handleDrop}
      >
        <p className="hidden text-sm text-muted-foreground sm:block">Drag files here or</p>
        <Button
          className="mt-2 w-full sm:w-auto"
          onClick={() => inputRef.current?.click()}
          size="sm"
          type="button"
          variant="outline"
        >
          Choose files
        </Button>
        <input
          className="sr-only"
          multiple
          onChange={(e) => {
            if (e.currentTarget.files) addFiles(e.currentTarget.files);
            e.currentTarget.value = '';
          }}
          ref={inputRef}
          type="file"
        />
        <p className="mt-2 text-xs text-muted-foreground">Up to {MAX_FILES} files, ~5 MB each.</p>
      </div>

      {staged.length > 0 ? (
        <div className="grid gap-2">
          {staged.map((s) => (
            <div
              className="grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded-md border border-border/60 bg-surface/40 px-3 py-2 text-sm"
              key={s.id}
            >
              <div className="min-w-0">
                <p className="truncate font-mono text-xs">{s.file.name}</p>
                <p className="text-xs text-muted-foreground">
                  {bytesToDisplay(s.file.size)} · {detectMimeType(s.file)}
                </p>
              </div>
              <Select onValueChange={(v) => setRole(s.id, v as ArtifactRole)} value={s.role}>
                <SelectTrigger className="h-8 w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ARTIFACT_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={() => removeStaged(s.id)} size="sm" type="button" variant="ghost">
                Remove
              </Button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="grid gap-1">
        <Label className="text-xs text-muted-foreground" htmlFor="submit-info">
          {staged.length} of {MAX_FILES} files staged
        </Label>
      </div>
      <Button
        disabled={disabled || pending || staged.length === 0}
        onClick={handleSubmit}
        size="sm"
      >
        {pending ? 'Submitting…' : 'Submit work'}
      </Button>
      <p className="text-xs text-muted-foreground">Wallet signature only. No payment needed.</p>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
