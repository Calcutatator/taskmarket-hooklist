'use client';

// Implements: ADR-0096
// Implements: ADR-0099

import { SearchIcon, XIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useUrlState } from '@/lib/url-state/use-url-state';

/**
 * The marketplace search box.
 *
 * The committed query lives in `?q=` and nowhere else, so a search is shareable and survives a
 * reload. The one piece of local state here is the *uncommitted* text between keystrokes: an
 * input has to stay responsive at typing speed, and a router round trip per character would not
 * be. That draft is ephemeral by the ADR-0096 taxonomy -- it is what the user is still typing,
 * not what they are looking at -- and it is reconciled to the URL whenever the URL changes
 * beneath it, so Back, Forward and a pasted link all win over a stale draft.
 *
 * Writes are debounced and use `replace`, so typing a five-character query leaves one history
 * entry rather than five and Back returns to the pre-search view.
 */
export function TaskSearchInput({
  className,
  placeholder = 'Search tasks, or paste a reference code',
}: {
  className?: string;
  placeholder?: string;
}) {
  const [committed, setCommitted] = useUrlState('q', { debounceMs: 300, history: 'refine' });
  const [draft, setDraft] = useState(committed);

  // The URL is authoritative: a Back press, a Forward press or a pasted link must be reflected in
  // the box rather than being overwritten by whatever was last typed into it.
  useEffect(() => {
    setDraft(committed);
  }, [committed]);

  return (
    <div className={className}>
      <div className="relative">
        <SearchIcon
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          aria-label="Search tasks"
          className="pl-9 pr-9"
          onChange={(event) => {
            setDraft(event.target.value);
            setCommitted(event.target.value);
          }}
          // Enter and blur flush immediately, so the address is never behind what the user sees.
          onBlur={() => setCommitted(draft)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              setCommitted(draft);
            }
            if (event.key === 'Escape' && draft) {
              event.preventDefault();
              setDraft('');
              setCommitted('');
            }
          }}
          placeholder={placeholder}
          type="search"
          value={draft}
        />
        {draft ? (
          <Button
            aria-label="Clear search"
            className="absolute right-1 top-1/2 size-7 -translate-y-1/2"
            onClick={() => {
              setDraft('');
              setCommitted('');
            }}
            size="icon"
            type="button"
            variant="ghost"
          >
            <XIcon className="size-4" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
