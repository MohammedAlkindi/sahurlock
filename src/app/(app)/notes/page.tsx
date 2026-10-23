'use client';

import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { uid } from '@/lib/utils';

// ── Types & storage ────────────────────────────────────────────────────────────

interface Note {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

const KEY = 'sahurlock.notes';

function load(): Note[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; }
}

function persist(notes: Note[]) {
  try { localStorage.setItem(KEY, JSON.stringify(notes)); } catch {}
}

function sortByUpdated(notes: Note[]) {
  return [...notes].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000)       return 'Just now';
  if (diff < 3_600_000)    return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000)   return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function NotesPage() {
  const [notes,    setNotes]    = useState<Note[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [status,   setStatus]   = useState<'idle' | 'saving' | 'saved'>('idle');
  const [mounted,  setMounted]  = useState(false);
  const saveTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bodyRef    = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const loaded = sortByUpdated(load());
    setNotes(loaded);
    if (loaded.length > 0) setActiveId(loaded[0].id);
    setMounted(true);
  }, []);

  const activeNote = notes.find((n) => n.id === activeId) ?? null;

  const createNote = () => {
    const note: Note = {
      id:        uid(),
      title:     '',
      body:      '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const next = sortByUpdated([note, ...notes]);
    setNotes(next);
    persist(next);
    setActiveId(note.id);
    setTimeout(() => bodyRef.current?.focus(), 50);
  };

  const updateNote = (id: string, patch: Partial<Pick<Note, 'title' | 'body'>>) => {
    setStatus('saving');
    const next = sortByUpdated(
      notes.map((n) => n.id === id ? { ...n, ...patch, updatedAt: new Date().toISOString() } : n)
    );
    setNotes(next);
    persist(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => setStatus('saved'), 600);
  };

  const deleteNote = (id: string) => {
    const next = notes.filter((n) => n.id !== id);
    setNotes(next);
    persist(next);
    setActiveId(next.length > 0 ? next[0].id : null);
  };

  if (!mounted) return null;

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Notes list ──────────────────────────────────────────────────── */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-border">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-sm font-semibold">Notes</span>
          <button
            onClick={createNote}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Plus size={13} />
            New
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {notes.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-4 py-14 text-center">
              <p className="text-xs text-muted-foreground">No notes yet.</p>
              <button onClick={createNote} className="text-xs text-accent hover:underline">
                Create one
              </button>
            </div>
          ) : (
            notes.map((note) => {
              const active = activeId === note.id;
              return (
                <button
                  key={note.id}
                  onClick={() => setActiveId(note.id)}
                  className={cn(
                    'w-full border-b border-border/40 px-4 py-3 text-left transition-colors hover:bg-muted/40',
                    active && 'border-l-2 border-l-accent bg-accent/10'
                  )}
                >
                  <p className="truncate text-xs font-semibold text-foreground">
                    {note.title.trim() || 'Untitled'}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {note.body.trim().slice(0, 55) || 'No content'}
                  </p>
                  <p className="mt-1.5 text-[10px] text-muted-foreground">
                    {timeAgo(note.updatedAt)}
                  </p>
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* ── Editor ──────────────────────────────────────────────────────── */}
      {activeNote ? (
        <div className="flex flex-1 flex-col min-w-0">

          {/* Toolbar */}
          <div className="flex h-11 items-center justify-between border-b border-border px-6">
            <span className={cn(
              'text-xs transition-opacity duration-300',
              status === 'idle'   && 'opacity-0',
              status === 'saving' && 'opacity-60 text-muted-foreground',
              status === 'saved'  && 'opacity-100 text-muted-foreground',
            )}>
              {status === 'saving' ? 'Saving…' : 'Saved'}
            </span>
            <button
              onClick={() => deleteNote(activeNote.id)}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-red-600"
            >
              <Trash2 size={13} />
              Delete
            </button>
          </div>

          {/* Title */}
          <div className="px-8 pt-8">
            <input
              type="text"
              value={activeNote.title}
              onChange={(e) => updateNote(activeNote.id, { title: e.target.value })}
              placeholder="Untitled"
              className="w-full bg-transparent text-2xl font-black text-foreground placeholder-muted-foreground focus:outline-none"
            />
          </div>

          {/* Divider */}
          <div className="mx-8 mt-4 border-t border-border/50" />

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-8 pb-8 pt-4">
            <textarea
              ref={bodyRef}
              value={activeNote.body}
              onChange={(e) => updateNote(activeNote.id, { body: e.target.value })}
              placeholder="Start writing…"
              className="h-full w-full resize-none bg-transparent text-sm leading-7 text-foreground placeholder-muted-foreground focus:outline-none"
            />
          </div>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <p className="text-sm text-muted-foreground">No note open</p>
            <button onClick={createNote} className="mt-2 text-xs text-accent hover:underline">
              New note
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
