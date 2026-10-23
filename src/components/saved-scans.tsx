'use client';

import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { FileDown, Trash2 } from 'lucide-react';
import type { SavedScan } from '@/lib/scan/library';

interface Props {
  scans: SavedScan[];
  /** A PDF is being built, so downloads wait. */
  exporting: boolean;
  onDownload: (scan: SavedScan) => void;
  /** Resolves to how many scans are left, or null when the delete failed. */
  onDelete: (scan: SavedScan) => Promise<number | null>;
}

/** The Scan page's list of scans saved on this device. */
export function SavedScans({ scans, exporting, onDownload, onDelete }: Props) {
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const deleteButtons = useRef(new Map<string, HTMLButtonElement>());
  const keepButton = useRef<HTMLButtonElement | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    const urls = Object.fromEntries(scans.map((scan) => [scan.id, URL.createObjectURL(scan.pages[0].jpeg)]));
    setThumbnails(urls);
    return () => Object.values(urls).forEach((url) => URL.revokeObjectURL(url));
  }, [scans]);

  useEffect(() => { if (confirmingDelete) keepButton.current?.focus(); }, [confirmingDelete]);

  const keep = (id: string) => {
    flushSync(() => setConfirmingDelete(null));
    deleteButtons.current.get(id)?.focus();
  };

  const remove = async (scan: SavedScan) => {
    const left = await onDelete(scan);
    if (left === null) return;
    setConfirmingDelete(null);
    // With none left this list is gone, and the page moves focus itself.
    if (left > 0) heading.current?.focus();
  };

  return (
    <section aria-labelledby="saved-scans" className="mt-10">
      <h2 id="saved-scans" ref={heading} tabIndex={-1} className="mb-1 text-base font-semibold focus:outline-none">Saved scans</h2>
      <p className="mb-4 text-xs text-muted-foreground">Kept in this browser only. Settings &gt; Data &gt; Clear everything removes them.</p>
      <ul className="space-y-2">
        {scans.map((scan) => (
          <li key={scan.id} className="flex items-center gap-3 rounded-xl border border-border bg-card p-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element -- a local blob URL, which next/image cannot optimise */}
            {thumbnails[scan.id] && <img src={thumbnails[scan.id]} alt="" className="h-14 w-11 shrink-0 rounded border border-border bg-white object-contain" />}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{scan.title}</p>
              <p className="text-xs text-muted-foreground">
                {new Date(scan.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                {' · '}{scan.pages.length} {scan.pages.length === 1 ? 'page' : 'pages'}
              </p>
            </div>
            {confirmingDelete === scan.id ? (
              <div role="group" aria-label={`Delete ${scan.title}?`} className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground" aria-hidden="true">Delete?</span>
                <button onClick={() => remove(scan)} className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-red-700">Delete</button>
                <button ref={keepButton} onClick={() => keep(scan.id)} className="rounded-md px-2.5 py-1 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground">Keep</button>
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => onDownload(scan)}
                  disabled={exporting}
                  aria-label={`Download ${scan.title} as PDF`}
                  className="rounded-md p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-40"
                >
                  <FileDown size={16} />
                </button>
                <button
                  ref={(el) => { if (el) deleteButtons.current.set(scan.id, el); else deleteButtons.current.delete(scan.id); }}
                  onClick={() => setConfirmingDelete(scan.id)}
                  aria-label={`Delete ${scan.title}`}
                  className="rounded-md p-2 text-muted-foreground transition hover:bg-muted hover:text-danger"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
