'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChartLine, ChevronLeft, ChevronRight, Heading, Plus, Sigma, Table, Trash2, Type, Workflow,
} from 'lucide-react';
import { useDialog } from '@/hooks/use-dialog';
import { type Block, BLOCK_KINDS, type BlockKind, isReadKind, userBlock, withContent, withKind } from '@/lib/scan/document';
import { KIND_LABELS, moveBox, newBoxBelow, position, resizeBox, stepSize, summary } from '@/lib/scan/regions';
import { uid } from '@/lib/utils';

export interface EditorPage {
  id: string;
  /** The cleaned image. Regions are in its pixels. */
  url: string;
  width: number;
  height: number;
  blocks: Block[];
  regionsComplete: boolean;
}

interface Props {
  /** Cleaned pages only, in scan order. */
  pages: EditorPage[];
  startId: string;
  onChange: (pageId: string, blocks: Block[], regionsComplete: boolean) => void;
  /** Called with the page shown last, so the Scan page can select it. */
  onClose: (pageId: string) => void;
}

const ICONS: Record<BlockKind, typeof Type> = { text: Type, heading: Heading, math: Sigma, table: Table, graph: ChartLine, diagram: Workflow };

// Full class names, so Tailwind finds them.
const KIND_STYLE: Record<BlockKind, { tag: string; border: string; tint: string }> = {
  text: { tag: 'bg-region-text', border: 'border-region-text', tint: 'bg-region-text/10' },
  heading: { tag: 'bg-region-heading', border: 'border-region-heading', tint: 'bg-region-heading/10' },
  math: { tag: 'bg-region-math', border: 'border-region-math', tint: 'bg-region-math/10' },
  table: { tag: 'bg-region-table', border: 'border-region-table', tint: 'bg-region-table/10' },
  graph: { tag: 'bg-region-graph', border: 'border-region-graph', tint: 'bg-region-graph/10' },
  diagram: { tag: 'bg-region-diagram', border: 'border-region-diagram', tint: 'bg-region-diagram/10' },
};

const pct = (n: number, of: number) => `${(100 * n) / of}%`;

function Tag({ kind, children }: { kind: BlockKind; children: ReactNode }) {
  const Icon = ICONS[kind];
  return (
    <span className={`inline-flex items-center gap-1 rounded-sm px-1 py-0.5 text-[11px] font-semibold leading-none text-white ${KIND_STYLE[kind].tag}`}>
      <Icon size={11} aria-hidden="true" />
      {children}
    </span>
  );
}

const control = 'tap-target inline-flex min-h-6 min-w-6 items-center justify-center gap-1 rounded-md border border-input px-2 py-1 text-sm text-foreground transition hover:bg-muted aria-disabled:cursor-not-allowed aria-disabled:opacity-40';

/**
 * Mark regions on cleaned pages: a box and a kind for each, and for text,
 * headings and math, what it says. Every action works with the keyboard alone
 * and with single clicks or taps alone.
 */
export function RegionEditor({ pages, startId, onChange, onClose }: Props) {
  const [index, setIndex] = useState(() => Math.max(0, pages.findIndex((p) => p.id === startId)));
  const page = pages[Math.min(index, pages.length - 1)];
  const [selectedId, setSelectedId] = useState<string | null>(page.blocks[0]?.id ?? null);
  const [newKind, setNewKind] = useState<BlockKind>('text');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  // What was typed for each region this session, so switching a region to a kind
  // kept as an image and back again does not lose it.
  const drafts = useRef(new Map<string, string>());
  const moveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dialog = useRef<HTMLDivElement | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const selectedBox = useRef<HTMLButtonElement | null>(null);
  const addButton = useRef<HTMLButtonElement | null>(null);
  const kindSelect = useRef<HTMLSelectElement | null>(null);
  const deleteButton = useRef<HTMLButtonElement | null>(null);
  const keepButton = useRef<HTMLButtonElement | null>(null);

  const selectedIndex = page.blocks.findIndex((b) => b.id === selectedId);
  const selected = selectedIndex >= 0 ? page.blocks[selectedIndex] : null;

  const announce = (text: string) => {
    flushSync(() => setAnnouncement(''));
    setAnnouncement(text);
  };

  const close = () => onClose(page.id);
  // Escape closes the delete confirm first, and only then the editor.
  useDialog(dialog, () => {
    if (confirmingDelete) {
      flushSync(() => setConfirmingDelete(false));
      deleteButton.current?.focus();
    } else close();
  }, true, heading);

  useEffect(() => { if (confirmingDelete) keepButton.current?.focus(); }, [confirmingDelete]);
  useEffect(() => () => { if (moveTimer.current) clearTimeout(moveTimer.current); }, []);

  const update = (blocks: Block[], complete = page.regionsComplete) => onChange(page.id, blocks, complete);
  const replace = (block: Block) => update(page.blocks.map((b) => (b.id === block.id ? block : b)));
  const describe = (b: Block, n: number) => `Region ${n}, ${KIND_LABELS[b.kind].toLowerCase()}, ${position(b.box, page)}`;

  const goTo = (next: number) => {
    if (next < 0 || next >= pages.length) return;
    setIndex(next);
    setSelectedId(pages[next].blocks[0]?.id ?? null);
    setConfirmingDelete(false);
    announce(`Page ${next + 1} of ${pages.length}.`);
  };

  const addRegion = () => {
    const taken = new Set(pages.flatMap((p) => p.blocks.map((b) => b.id)));
    let id = uid();
    while (taken.has(id)) id = uid();
    const block = userBlock(id, newKind, newBoxBelow(page.blocks, page));
    flushSync(() => {
      update([...page.blocks, block]);
      setSelectedId(id);
      setConfirmingDelete(false);
    });
    selectedBox.current?.focus();
    announce(`Added ${describe(block, page.blocks.length + 1)}. Move it with the arrow keys.`);
  };

  /** Move or resize the selected region, and say where it ended up once the keys stop. */
  const reshape = (change: (box: Block['box']) => Block['box']) => {
    if (!selected) return;
    const moved = { ...selected, box: change(selected.box) };
    replace(moved);
    if (moveTimer.current) clearTimeout(moveTimer.current);
    moveTimer.current = setTimeout(() => {
      announce(`${describe(moved, selectedIndex + 1)}, ${moved.box.width} by ${moved.box.height} pixels.`);
    }, 500);
  };
  const step = stepSize(page);
  const move = (dx: number, dy: number) => reshape((box) => moveBox(box, dx, dy, page));
  const resize = (dw: number, dh: number) => reshape((box) => resizeBox(box, dw, dh, page));

  const typed = (b: Block) => drafts.current.get(b.id) ?? b.content ?? '';

  const deleteSelected = () => {
    if (!selected) return;
    const rest = page.blocks.filter((b) => b.id !== selected.id);
    const next = rest[selectedIndex] ?? rest[selectedIndex - 1] ?? null;
    flushSync(() => {
      update(rest);
      setSelectedId(next?.id ?? null);
      setConfirmingDelete(false);
    });
    drafts.current.delete(selected.id);
    // Focus moves to the next region, or to Add region when none are left.
    (next ? selectedBox.current : addButton.current)?.focus();
    announce(`Deleted region ${selectedIndex + 1}.${next ? '' : ' No regions left on this page.'}`);
  };
  const requestDelete = () => (selected && typed(selected).trim() ? setConfirmingDelete(true) : deleteSelected());

  const onBoxKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[e.key]) {
      e.preventDefault();
      const [dx, dy] = arrows[e.key];
      if (e.shiftKey) resize(dx * step, dy * step);
      else move(dx * step, dy * step);
    } else if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
      move(0, (e.key === 'PageUp' ? -0.1 : 0.1) * page.height);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      requestDelete();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      kindSelect.current?.focus();
    }
  };

  const changeKind = (b: Block, kind: BlockKind) => {
    const draft = drafts.current.get(b.id);
    let next = withKind(b, kind);
    if (isReadKind(kind) && draft) next = withContent(next, draft);
    replace(next);
  };

  const changeContent = (b: Block, text: string) => {
    drafts.current.set(b.id, text);
    replace(withContent(b, text));
  };

  const pageNumber = index + 1;
  const fieldClass = 'w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground focus:border-accent focus:outline-none';
  const contentField = (b: Block) => {
    const common = {
      id: 'region-content', value: typed(b), autoComplete: 'off', autoCorrect: 'off', autoCapitalize: 'off',
      onChange: (e: { target: { value: string } }) => changeContent(b, e.target.value),
    };
    if (b.kind === 'heading') return <input {...common} className={fieldClass} />;
    if (b.kind === 'math') return <textarea {...common} rows={3} dir="ltr" spellCheck={false} className={`${fieldClass} font-mono`} />;
    return <textarea {...common} rows={4} className={fieldClass} />;
  };

  return (
    <div
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-labelledby="region-editor-title"
      className="fixed inset-0 z-50 flex h-[100dvh] flex-col bg-background text-foreground"
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <h2 id="region-editor-title" ref={heading} tabIndex={-1} className="mr-auto text-base font-semibold focus:outline-none">
          Mark regions on page {pageNumber} of {pages.length}
        </h2>
        <button onClick={() => goTo(index - 1)} aria-disabled={index === 0} className={control}>
          <ChevronLeft size={14} aria-hidden="true" /> Previous page
        </button>
        <button onClick={() => goTo(index + 1)} aria-disabled={index === pages.length - 1} className={control}>
          Next page <ChevronRight size={14} aria-hidden="true" />
        </button>
        <button onClick={close} className="tap-target rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-accent-foreground transition hover:opacity-90">
          Done
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
        <section aria-label="Page" className="flex min-w-0 flex-1 flex-col gap-3 p-4 md:overflow-y-auto">
          <fieldset className="flex flex-wrap items-center gap-2">
            <legend className="mb-1 text-sm text-muted-foreground">Mark new regions as</legend>
            {BLOCK_KINDS.map((k) => {
              const Icon = ICONS[k];
              return (
                <label key={k} className={`tap-target inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-sm focus-within:ring-2 focus-within:ring-accent ${newKind === k ? 'border-foreground bg-muted font-semibold' : 'border-input'}`}>
                  <input type="radio" name="new-region-kind" value={k} checked={newKind === k} onChange={() => setNewKind(k)} className="sr-only" />
                  <Icon size={14} aria-hidden="true" /> {KIND_LABELS[k]}
                </label>
              );
            })}
          </fieldset>
          <div className="flex flex-wrap items-center gap-3">
            <button ref={addButton} onClick={addRegion} className={control}>
              <Plus size={14} aria-hidden="true" /> Add region
            </button>
            <p id="region-keys" className="text-xs text-muted-foreground">
              On a selected region, the arrow keys move it, Shift and the arrow keys resize it, and Delete removes it.
            </p>
          </div>

          <div
            className="relative mx-auto max-w-full select-none bg-white shadow-sm"
            style={{ aspectRatio: `${page.width} / ${page.height}`, width: `min(100%, calc((100dvh - 15rem) * ${page.width / page.height}))` }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- a local blob URL, which next/image cannot optimise */}
            <img src={page.url} alt={`The cleaned page ${pageNumber}`} draggable={false} className="absolute inset-0 h-full w-full" />
            {page.blocks.map((b, i) => {
              const style = { left: pct(b.box.x, page.width), top: pct(b.box.y, page.height), width: pct(b.box.width, page.width), height: pct(b.box.height, page.height) };
              const look = KIND_STYLE[b.kind];
              const tag = <span className="absolute left-0 top-0"><Tag kind={b.kind}>{i + 1}</Tag></span>;
              // Only the selected region takes focus. The list beside the page reaches the others.
              return b.id === selectedId ? (
                <button
                  key={b.id}
                  ref={selectedBox}
                  onKeyDown={onBoxKey}
                  aria-label={describe(b, i + 1)}
                  aria-describedby="region-keys"
                  style={style}
                  className={`region-focus absolute border-[3px] ${look.border} ${look.tint}`}
                >
                  {tag}
                </button>
              ) : (
                <div key={b.id} aria-hidden="true" style={style} className={`absolute border-2 ${look.border}`}>{tag}</div>
              );
            })}
          </div>
        </section>

        <aside aria-label="Regions" className="flex w-full shrink-0 flex-col gap-4 border-t border-border p-4 md:w-80 md:overflow-y-auto md:border-l md:border-t-0">
          {selected ? (
            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold">Region {selectedIndex + 1}</h3>
              <figure className="overflow-hidden rounded-md border border-border bg-white">
                <div className="relative mx-auto max-h-32 overflow-hidden" style={{ aspectRatio: `${selected.box.width} / ${selected.box.height}` }}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- a local blob URL, which next/image cannot optimise */}
                  <img
                    src={page.url}
                    alt=""
                    draggable={false}
                    className="absolute max-w-none"
                    style={{
                      width: pct(page.width, selected.box.width),
                      left: `-${pct(selected.box.x, selected.box.width)}`,
                      top: `-${pct(selected.box.y, selected.box.height)}`,
                    }}
                  />
                </div>
                <figcaption className="border-t border-border px-2 py-1 text-xs text-muted-foreground">As written</figcaption>
              </figure>
              <label className="flex flex-col gap-1 text-sm">
                Kind
                <select ref={kindSelect} value={selected.kind} onChange={(e) => changeKind(selected, e.target.value as BlockKind)} className={fieldClass}>
                  {BLOCK_KINDS.map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
                </select>
              </label>
              {isReadKind(selected.kind) ? (
                <div className="flex flex-col gap-1 text-sm">
                  <label htmlFor="region-content">{selected.kind === 'math' ? 'LaTeX' : 'What it says'}</label>
                  {contentField(selected)}
                  <p className="text-xs text-muted-foreground">Optional. Type it as written, including mistakes.</p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Kept as an image. Only its box and kind are saved.</p>
              )}
              <div role="group" aria-label="Move region" className="flex flex-wrap items-center gap-1">
                <span className="mr-1 w-10 text-xs text-muted-foreground" aria-hidden="true">Move</span>
                <button onClick={() => move(0, -step)} aria-label="Move up" className={control}><ArrowUp size={14} aria-hidden="true" /></button>
                <button onClick={() => move(0, step)} aria-label="Move down" className={control}><ArrowDown size={14} aria-hidden="true" /></button>
                <button onClick={() => move(-step, 0)} aria-label="Move left" className={control}><ArrowLeft size={14} aria-hidden="true" /></button>
                <button onClick={() => move(step, 0)} aria-label="Move right" className={control}><ArrowRight size={14} aria-hidden="true" /></button>
              </div>
              <div role="group" aria-label="Resize region" className="flex flex-wrap items-center gap-1">
                <span className="mr-1 w-10 text-xs text-muted-foreground" aria-hidden="true">Size</span>
                <button onClick={() => resize(step, 0)} className={control}>Wider</button>
                <button onClick={() => resize(-step, 0)} className={control}>Narrower</button>
                <button onClick={() => resize(0, step)} className={control}>Taller</button>
                <button onClick={() => resize(0, -step)} className={control}>Shorter</button>
              </div>
              {confirmingDelete ? (
                <div key="confirm" role="group" aria-label={`Delete region ${selectedIndex + 1}? What you typed goes too.`} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-muted-foreground" aria-hidden="true">Delete it and what you typed?</span>
                  <button onClick={deleteSelected} className="tap-target rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-red-700">Delete</button>
                  <button ref={keepButton} onClick={() => { flushSync(() => setConfirmingDelete(false)); deleteButton.current?.focus(); }} className="tap-target rounded-md px-2.5 py-1 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground">Keep</button>
                </div>
              ) : (
                <button key="delete" ref={deleteButton} onClick={requestDelete} className={`${control} self-start hover:text-danger`}>
                  <Trash2 size={14} aria-hidden="true" /> Delete region
                </button>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Choose a kind, then Add region to mark the first one.</p>
          )}

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">On this page</h3>
            {page.blocks.length > 0 && (
              <ol aria-label="Regions on this page" className="flex flex-col gap-1">
                {page.blocks.map((b, i) => (
                  <li key={b.id}>
                    <button
                      onClick={() => setSelectedId(b.id)}
                      aria-current={b.id === selectedId ? 'true' : undefined}
                      className={`tap-target flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-sm ${b.id === selectedId ? 'border-foreground bg-muted' : 'border-border hover:bg-muted'}`}
                    >
                      <span aria-hidden="true"><Tag kind={b.kind}>{i + 1}</Tag></span>
                      <span className="min-w-0 flex-1 truncate">
                        <span className="sr-only">{describe(b, i + 1)}. </span>
                        {isReadKind(b.kind) ? (b.content ?? <span className="text-muted-foreground">Nothing typed yet</span>) : <span className="text-muted-foreground">Kept as an image</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
            <p className="text-sm text-muted-foreground">{summary(page.blocks)}</p>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={page.regionsComplete}
                onChange={(e) => update(page.blocks, e.target.checked)}
                className="h-4 w-4 accent-accent"
              />
              Every region on this page is marked
            </label>
          </div>
        </aside>
      </div>

      <p role="status" className="sr-only">{announcement}</p>
    </div>
  );
}
