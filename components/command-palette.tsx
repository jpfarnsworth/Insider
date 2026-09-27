'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, FileText, Search, User } from 'lucide-react';
import type { SearchHit } from '@/lib/search';
import { cn } from '@/lib/utils';

const ICONS = { company: Building2, insider: User, filing: FileText } as const;
const DEBOUNCE_MS = 200;

/** Global search (⌘K / Ctrl+K, or "/" outside a field): companies, insiders and accession numbers. */
export function CommandPalette() {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');

  const open = useCallback(() => {
    if (!dialog.current?.open) dialog.current?.showModal();
    input.current?.focus();
  }, []);
  const close = useCallback(() => dialog.current?.close(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName));
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        open();
      } else if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: ctl.signal });
        if (!res.ok) throw new Error(String(res.status));
        setHits(((await res.json()) as { hits: SearchHit[] }).hits);
        setActive(0);
        setState('idle');
      } catch (err) {
        if ((err as Error).name !== 'AbortError') setState('error');
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q]);

  const onChange = (value: string) => {
    setQ(value);
    if (value.trim().length < 2) {
      setHits([]);
      setState('idle');
    } else {
      setState('loading');
    }
  };

  const go = (hit: SearchHit | undefined) => {
    if (!hit) return;
    close();
    router.push(hit.href);
  };

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (hits.length) setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(hits[active]);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="text-muted-foreground hover:bg-muted flex items-center gap-2 rounded-lg border px-2.5 py-1 text-xs"
        aria-label="Search (Command K)"
      >
        <Search className="size-3.5" aria-hidden />
        <span className="hidden sm:inline">Search</span>
        <kbd className="bg-muted hidden rounded px-1.5 font-mono text-[10px] sm:inline">⌘K</kbd>
      </button>

      <dialog
        ref={dialog}
        aria-label="Search"
        onClose={() => {
          setQ('');
          setHits([]);
        }}
        onClick={(e) => e.target === e.currentTarget && close()}
        className="bg-card text-card-foreground m-auto mt-[12vh] w-[min(36rem,calc(100vw-2rem))] rounded-xl border p-0 shadow-xl backdrop:bg-black/30"
      >
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="text-muted-foreground size-4" aria-hidden />
          <input
            ref={input}
            value={q}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onInputKey}
            placeholder="Ticker, company, insider or accession number"
            role="combobox"
            aria-expanded={hits.length > 0}
            aria-controls={listId}
            aria-activedescendant={hits.length ? `${listId}-${active}` : undefined}
            autoComplete="off"
            spellCheck={false}
            className="h-11 w-full bg-transparent text-sm outline-none"
          />
        </div>
        <ul id={listId} role="listbox" className="max-h-[50vh] overflow-y-auto p-1">
          {hits.map((h, i) => {
            const Icon = ICONS[h.kind];
            return (
              <li
                key={`${h.kind}-${h.href}-${h.title}`}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseMove={() => setActive(i)}
                onClick={() => go(h)}
                className={cn('flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm', i === active && 'bg-accent text-accent-foreground')}
              >
                <Icon className="text-muted-foreground size-4 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{h.title}</span>
                <span className="text-muted-foreground shrink-0 text-xs">{h.subtitle}</span>
              </li>
            );
          })}
        </ul>
        <p className="text-muted-foreground border-t px-3 py-2 text-xs" aria-live="polite">
          {state === 'error'
            ? 'Search failed. Try again.'
            : q.trim().length < 2
              ? 'Type at least 2 characters. ↑↓ to move, Enter to open, Esc to close.'
              : state === 'loading'
                ? 'Searching…'
                : hits.length === 0
                  ? 'No matches.'
                  : `${hits.length} result${hits.length === 1 ? '' : 's'}`}
        </p>
      </dialog>
    </>
  );
}
