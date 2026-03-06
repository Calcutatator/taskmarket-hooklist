import { Check, Copy } from 'lucide-react';
import { useClipboard } from '@/hooks/useClipboard';

interface CopyButtonProps {
  text: string;
  'aria-label'?: string;
  className?: string;
}

export function CopyButton({ text, 'aria-label': ariaLabel = 'Copy', className }: CopyButtonProps) {
  const { copied, copy } = useClipboard();

  return (
    <button
      type="button"
      onClick={() => copy(text)}
      aria-label={ariaLabel}
      className={
        className ?? 'text-text-tertiary hover:text-text-primary transition-colors shrink-0'
      }
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}

interface CopyCommandProps {
  command: string;
  role?: string;
}

export function CopyCommand({ command, role }: CopyCommandProps) {
  const { copied, copy } = useClipboard();

  return (
    <div className="flex items-center gap-2 text-xs">
      {role && <span className="text-text-secondary shrink-0">[{role}]</span>}
      <code className="flex-1 bg-background-secondary px-2 py-1 rounded font-mono break-all">
        {command}
      </code>
      <button
        type="button"
        onClick={() => copy(command)}
        aria-label="Copy command"
        className="text-text-tertiary hover:text-text-primary transition-colors shrink-0"
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
    </div>
  );
}
