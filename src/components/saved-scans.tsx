'use client';

import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { FileDown, FolderOpen, Trash2 } from 'lucide-react';
import { PaperSelect } from '@/components/paper-select';
import { groupByCourse, type SavedScan } from '@/lib/scan/library';
import type { Paper } from '@/lib/scan/pdf';

type Action = 'open' | 'delete';

interface Props {
  scans: SavedScan[];
  /** A PDF is being built, so downloads wait. */
  exporting: boolean;
  /** The paper control to show with the list, or null when the page shows its own. */
  paper: { value: Paper; onChange: (paper: Paper) => void } | null;
  /** Opening a scan would replace pages that are not saved, so ask first. */
  openNeedsConfirm: boolean;
  onOpen: (scan: SavedScan) => void;
  onDownload: (scan: SavedScan) => void;
  /** Resolves to how many scans are left, or null when the delete failed. */
  onDelete: (scan: SavedScan) => Promise<number | null>;
}

/** The Scan page's list of scans saved on this device, grouped by course. */
export function SavedScans({ scans, exporting, paper, openNeedsConfirm, onOpen, onDownload, onDelete }: Props) {
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<{ id: string; action: Action } | null>(null);
  const [failedDelete, setFailedDelete] = useState<string | null>(null);
  const actionButtons = useRef(new Map<string, HTMLButtonElement>());
  const cancelButton = useRef<HTMLButtonElement | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    const urls = Object.fromEntries(scans.map((scan) => [scan.id, URL.createObjectURL(scan.pages[0].jpeg)]));
    setThumbnails(urls);
    return () => Object.values(urls).forEach((url) => URL.revokeObjectURL(url));
  }, [scans]);

  useEffect(() => { if (confirming) cancelButton.current?.focus(); }, [confirming]);

  const buttonRef = (action: Action, id: string) => (el: HTMLButtonElement | null) => {
    if (el) actionButtons.current.set(`${action}:${id}`, el);
    else actionButtons.current.delete(`${action}:${id}`);
  };

  /** Close the confirm and put focus back on the button that opened it. */
  const cancel = () => {
    if (!confirming) return;
    const { action, id } = confirming;
    flushSync(() => setConfirming(null));
    actionButtons.current.get(`${action}:${id}`)?.focus();
  };

  const open = (scan: SavedScan) => {
    if (openNeedsConfirm && confirming?.id !== scan.id) {
      setConfirming({ id: scan.id, action: 'open' });
      return;
    }
    setConfirming(null);
    onOpen(scan);
  };

  const remove = async (scan: SavedScan) => {
    const left = await onDelete(scan);
    if (left === null) {
      setFailedDelete(scan.id);
      return;
    }
    setFailedDelete(null);
    setConfirming(null);
    // With none left this list is gone, and the page moves focus itself.
    if (left > 0) heading.current?.focus();
  };

  const row = (scan: SavedScan) => (
    <li key={scan.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-2.5">
      {/* eslint-disable-next-line @next/next/no-img-element -- a local blob URL, which next/image cannot optimise */}
      {thumbnails[scan.id] && <img src={thumbnails[scan.id]} alt="" className="h-14 w-11 shrink-0 rounded border border-border bg-white object-contain" />}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{scan.title}</p>
        <p className="text-xs text-muted-foreground">
          {new Date(scan.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
          {' · '}{scan.pages.length} {scan.pages.length === 1 ? 'page' : 'pages'}
        </p>
      </div>
      {confirming?.id === scan.id ? (
        // Keyed so React builds the confirm fresh. Reusing an icon button's element for
        // the coloured button would animate its colours through an unreadable pairing.
        <div
          key={`confirm-${confirming.action}`}
          role="group"
          aria-label={confirming.action === 'delete' ? `Delete ${scan.title}?` : `Replace the unsaved pages with ${scan.title}?`}
          className="flex items-center gap-2 text-sm"
        >
          <span className="text-muted-foreground" aria-hidden="true">{confirming.action === 'delete' ? 'Delete?' : 'Replace unsaved pages?'}</span>
          {confirming.action === 'delete'
            ? <button onClick={() => remove(scan)} className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-red-700">Delete</button>
            : <button onClick={() => open(scan)} className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground transition hover:opacity-90">Replace</button>}
          <button ref={cancelButton} onClick={cancel} className="rounded-md px-2.5 py-1 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground">
            {confirming.action === 'delete' ? 'Keep' : 'Cancel'}
          </button>
        </div>
      ) : (
        <div key="actions" className="flex items-center gap-1">
          <button
            ref={buttonRef('open', scan.id)}
            onClick={() => open(scan)}
            aria-label={`Open ${scan.title}`}
            className="rounded-md p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <FolderOpen size={16} />
          </button>
          <button
            onClick={() => onDownload(scan)}
            // aria-disabled, not disabled, so focus stays here while the PDF is built.
            aria-disabled={exporting}
            aria-label={`Download ${scan.title} as PDF`}
            className="rounded-md p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
          >
            <FileDown size={16} />
          </button>
          <button
            ref={buttonRef('delete', scan.id)}
            onClick={() => setConfirming({ id: scan.id, action: 'delete' })}
            aria-label={`Delete ${scan.title}`}
            className="rounded-md p-2 text-muted-foreground transition hover:bg-muted hover:text-danger"
          >
            <Trash2 size={16} />
          </button>
        </div>
      )}
      {failedDelete === scan.id && (
        <p role="alert" className="w-full text-xs text-danger">This scan could not be deleted. Try again.</p>
      )}
    </li>
  );

  const groups = groupByCourse(scans);
  const filed = groups.some((g) => g.course);

  return (
    <section aria-labelledby="saved-scans" className="mt-10">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="saved-scans" ref={heading} tabIndex={-1} className="mb-1 text-base font-semibold focus:outline-none">Saved scans</h2>
          <p className="text-xs text-muted-foreground">Kept in this browser only. Settings &gt; Data &gt; Clear all data removes them.</p>
        </div>
        {paper && <PaperSelect value={paper.value} onChange={paper.onChange} />}
      </div>
      {filed ? (
        <div className="space-y-5">
          {groups.map((group) => (
            <div key={group.course}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.course || 'No course'}</h3>
              <ul className="space-y-2">{group.scans.map(row)}</ul>
            </div>
          ))}
        </div>
      ) : (
        <ul className="space-y-2">{scans.map(row)}</ul>
      )}
    </section>
  );
}
