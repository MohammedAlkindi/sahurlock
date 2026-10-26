'use client';

import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Archive, FileDown, FolderOpen, Trash2 } from 'lucide-react';
import { PaperSelect } from '@/components/paper-select';
import { labeledPages } from '@/lib/scan/dataset';
import { groupByCourse, type SavedScan } from '@/lib/scan/library';
import type { Paper } from '@/lib/scan/pdf';

type Action = 'open' | 'delete';

interface Props {
  scans: SavedScan[];
  /** A PDF is being built, so downloads wait. */
  exporting: boolean;
  /** A page is being moved between saved scans, so opening and deleting wait. */
  busy: boolean;
  /** The paper control to show with the list, or null when the page shows its own. */
  paper: { value: Paper; onChange: (paper: Paper) => void } | null;
  /** Opening a scan would replace work that is not saved, so ask first. */
  openNeedsConfirm: boolean;
  onOpen: (scan: SavedScan) => void;
  onDownload: (scan: SavedScan) => void;
  /** Download every labeled page as one dataset file. */
  onDownloadLabels: () => void;
  /** Resolves to how many scans are left, or null when the delete failed. */
  onDelete: (scan: SavedScan) => Promise<number | null>;
}

/** The Scan page's list of scans saved on this device, grouped by course. */
export function SavedScans({ scans, exporting, busy, paper, openNeedsConfirm, onOpen, onDownload, onDownloadLabels, onDelete }: Props) {
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

  // An open confirm goes away by itself once there is nothing left to lose.
  const shown = confirming && (confirming.action === 'delete' || openNeedsConfirm) ? confirming : null;

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
    if (busy) return;
    if (openNeedsConfirm && shown?.id !== scan.id) {
      setConfirming({ id: scan.id, action: 'open' });
      return;
    }
    setConfirming(null);
    onOpen(scan);
  };

  const remove = async (scan: SavedScan) => {
    if (busy) return;
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
      {shown?.id === scan.id ? (
        // Keyed so React builds the confirm fresh. Reusing an icon button's element for
        // the coloured button would animate its colours through an unreadable pairing.
        <div
          key={`confirm-${shown.action}`}
          role="group"
          aria-label={shown.action === 'delete' ? `Delete ${scan.title}?` : `Open ${scan.title} in place of the scan you are working on? Its changes are not saved.`}
          className="flex items-center gap-2 text-sm"
        >
          <span className="text-muted-foreground" aria-hidden="true">{shown.action === 'delete' ? 'Delete?' : 'Not saved. Replace?'}</span>
          {shown.action === 'delete'
            ? <button onClick={() => remove(scan)} aria-disabled={busy} className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-red-700 aria-disabled:cursor-not-allowed aria-disabled:opacity-40">Delete</button>
            : <button onClick={() => open(scan)} aria-disabled={busy} className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground transition hover:opacity-90 aria-disabled:cursor-not-allowed aria-disabled:opacity-40">Replace</button>}
          <button ref={cancelButton} onClick={cancel} className="rounded-md px-2.5 py-1 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground">
            {shown.action === 'delete' ? 'Keep' : 'Cancel'}
          </button>
        </div>
      ) : (
        <div key="actions" className="flex items-center gap-1">
          <button
            ref={buttonRef('open', scan.id)}
            onClick={() => open(scan)}
            aria-disabled={busy}
            aria-label={`Open ${scan.title}`}
            className="rounded-md p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
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
      {/* Plain text: the Scan page's announcer reads each failure, so a second one is read too. */}
      {failedDelete === scan.id && (
        <p className="w-full text-xs text-danger">This scan could not be deleted. Try again.</p>
      )}
    </li>
  );

  const groups = groupByCourse(scans);
  const filed = groups.some((g) => g.course);
  const labeled = labeledPages(scans).length;

  return (
    <section aria-labelledby="saved-scans" className="mt-10">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="saved-scans" ref={heading} tabIndex={-1} className="mb-1 text-base font-semibold focus:outline-none">Saved scans</h2>
          <p className="text-xs text-muted-foreground">Kept in this browser only. Settings &gt; Data &gt; Clear all data removes them.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {paper && <PaperSelect value={paper.value} onChange={paper.onChange} />}
          <button
            onClick={onDownloadLabels}
            disabled={labeled === 0}
            // aria-disabled, not disabled, while busy, so focus stays here while the file is built.
            aria-disabled={exporting}
            aria-describedby={labeled === 0 ? 'labels-hint' : undefined}
            className="inline-flex items-center gap-1.5 rounded-lg border border-input px-3 py-1.5 text-sm text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40 aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
          >
            <Archive size={14} aria-hidden="true" /> Download labels ({labeled} {labeled === 1 ? 'page' : 'pages'})
          </button>
        </div>
      </div>
      {labeled === 0 && (
        <p id="labels-hint" className="-mt-2 mb-4 text-xs text-muted-foreground">
          A page counts once it has a marked region and its scan is saved. Nothing is uploaded.
        </p>
      )}
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
