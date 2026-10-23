'use client';

import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Download, FileDown, ImageUp, Plus, RotateCcw, Save, Trash2, X } from 'lucide-react';
import type { LineRemoval } from '@/lib/scan/clean';
import { buildPdf, type Paper } from '@/lib/scan/pdf';
import { isPdf, MAX_PDF_PAGES, pdfToImages } from '@/lib/scan/pdf-pages';
import { deleteScan, listScans, saveScan, scanFileName, type SavedScan } from '@/lib/scan/library';
import type { ScanRequest, ScanResponse } from '@/lib/scan/worker';
import { uid } from '@/lib/utils';

/** IndexedDB, or null where the browser does not offer it. */
const scanStore = () => (typeof indexedDB === 'undefined' ? null : indexedDB);

interface Cleaned {
  pngUrl: string;
  jpeg: Blob;
  width: number;
  height: number;
  pageFound: boolean;
  skewDegrees: number;
}

interface ScanPage {
  id: string;
  file: File;
  originalUrl: string;
  /** The worker request whose answer this page is waiting for. */
  request: string | null;
  cleaned: Cleaned | null;
  error: string | null;
}

/** Letter in the countries that use it, A4 everywhere else. */
function defaultPaper(): Paper {
  const region = typeof navigator === 'undefined' ? '' : navigator.language.split('-')[1] ?? '';
  return ['US', 'CA', 'MX', 'PH'].includes(region.toUpperCase()) ? 'letter' : 'a4';
}

function describe(page: ScanPage): string {
  if (page.error) return page.error;
  if (!page.cleaned || page.request) return 'Cleaning the page…';
  const { pageFound, skewDegrees } = page.cleaned;
  return [
    pageFound ? 'Found the page edges and straightened it.' : 'No page edge stood out, so the whole photo was used.',
    Math.abs(skewDegrees) >= 0.5 ? ` Levelled the writing by ${Math.abs(skewDegrees).toFixed(1)}°.` : '',
  ].join('');
}

export default function ScanPage() {
  const workerRef = useRef<Worker | null>(null);
  const pagesRef = useRef<ScanPage[]>([]);
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lines, setLines] = useState<LineRemoval>({ horizontal: true, vertical: false });
  const [paper, setPaper] = useState<Paper>('a4');
  const [dragging, setDragging] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'reading' | 'error' | 'info'; text: string } | null>(null);
  const [library, setLibrary] = useState<SavedScan[]>([]);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [title, setTitle] = useState('');
  /** The library entry these pages were saved as, and what they looked like then. */
  const [savedAs, setSavedAs] = useState<{ id: string; key: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const deleteButtons = useRef(new Map<string, HTMLButtonElement>());
  const keepButton = useRef<HTMLButtonElement | null>(null);
  const libraryHeading = useRef<HTMLHeadingElement | null>(null);
  const pageHeading = useRef<HTMLHeadingElement | null>(null);

  const reloadLibrary = async () => {
    const idb = scanStore();
    const next = idb ? await listScans(idb).catch(() => []) : [];
    setLibrary(next);
    return next;
  };
  useEffect(() => { reloadLibrary(); }, []);
  useEffect(() => { if (confirmingDelete) keepButton.current?.focus(); }, [confirmingDelete]);
  useEffect(() => {
    const urls = Object.fromEntries(library.map((scan) => [scan.id, URL.createObjectURL(scan.pages[0].jpeg)]));
    setThumbnails(urls);
    return () => Object.values(urls).forEach((url) => URL.revokeObjectURL(url));
  }, [library]);

  useEffect(() => { pagesRef.current = pages; }, [pages]);
  useEffect(() => { setPaper(defaultPaper()); }, []);

  useEffect(() => {
    const worker = new Worker(new URL('../../../lib/scan/worker.ts', import.meta.url));
    worker.onmessage = (event: MessageEvent<ScanResponse>) => {
      const r = event.data;
      setPages((all) => all.map((page) => {
        if (page.request !== r.id) return page;
        if (!r.ok) return { ...page, request: null, error: r.error };
        if (page.cleaned) URL.revokeObjectURL(page.cleaned.pngUrl);
        return {
          ...page, request: null, error: null,
          cleaned: { pngUrl: URL.createObjectURL(r.png), jpeg: r.jpeg, width: r.width, height: r.height, pageFound: r.pageFound, skewDegrees: r.skewDegrees },
        };
      }));
    };
    workerRef.current = worker;
    return () => {
      worker.terminate();
      for (const page of pagesRef.current) {
        URL.revokeObjectURL(page.originalUrl);
        if (page.cleaned) URL.revokeObjectURL(page.cleaned.pngUrl);
      }
    };
  }, []);

  const send = (page: ScanPage, options: LineRemoval): ScanPage => {
    const request: ScanRequest = { id: uid(), file: page.file, lines: options };
    workerRef.current?.postMessage(request);
    return { ...page, request: request.id, error: null };
  };

  const addImages = (files: File[]) => {
    const added = files.map((file) =>
      send({ id: uid(), file, originalUrl: URL.createObjectURL(file), request: null, cleaned: null, error: null }, lines));
    if (added.length === 0) return;
    setPages((all) => [...all, ...added]);
    setSelectedId((current) => current ?? added[0].id);
  };

  const addFiles = async (list: FileList | null) => {
    const files = Array.from(list ?? []);
    setNotice(null);
    for (const file of files) {
      if (!isPdf(file)) { addImages([file]); continue; }
      setNotice({ kind: 'reading', text: `Reading ${file.name}…` });
      try {
        const { images, skipped } = await pdfToImages(file);
        addImages(images);
        setNotice(skipped > 0
          ? { kind: 'info', text: `${file.name} has more than ${MAX_PDF_PAGES} pages, so only the first ${MAX_PDF_PAGES} were added.` }
          : null);
      } catch {
        setNotice({ kind: 'error', text: `${file.name} could not be read as a PDF. If it has a password, export it again without one.` });
      }
    }
  };

  const changeLines = (next: LineRemoval) => {
    setLines(next);
    setPages(pages.map((page) => send(page, next)));
  };

  const removePage = (id: string) => {
    const page = pages.find((p) => p.id === id);
    if (page) {
      URL.revokeObjectURL(page.originalUrl);
      if (page.cleaned) URL.revokeObjectURL(page.cleaned.pngUrl);
    }
    const rest = pages.filter((p) => p.id !== id);
    setPages(rest);
    if (selectedId === id) setSelectedId(rest[0]?.id ?? null);
  };

  const startOver = () => {
    for (const page of pages) {
      URL.revokeObjectURL(page.originalUrl);
      if (page.cleaned) URL.revokeObjectURL(page.cleaned.pngUrl);
    }
    setPages([]);
    setSelectedId(null);
    setNotice(null);
    setTitle('');
    setSavedAs(null);
  };

  const today = new Date().toISOString().slice(0, 10);
  const ready = pages.length > 0 && pages.every((p) => p.cleaned && !p.request && !p.error);
  const scanTitle = title.trim() || `Notes ${today}`;
  // Each clean makes a new URL, so this changes whenever a page, the order or the title does.
  const contentKey = [scanTitle, ...pages.map((p) => p.cleaned?.pngUrl ?? '')].join('\n');
  const upToDate = savedAs !== null && savedAs.key === contentKey;

  const savePdf = async (jpegs: Blob[], filename: string) => {
    setExporting(true);
    try {
      const bytes = buildPdf(await Promise.all(jpegs.map(async (j) => new Uint8Array(await j.arrayBuffer()))), paper);
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } finally {
      setExporting(false);
    }
  };

  const downloadPdf = () => savePdf(pages.map((p) => p.cleaned!.jpeg), `notes-${today}.pdf`);

  const saveToLibrary = async () => {
    const idb = scanStore();
    if (!idb) {
      setNotice({ kind: 'error', text: 'This browser cannot keep scans. Download them as a PDF instead.' });
      return;
    }
    // Saving again after a change replaces the earlier copy instead of adding another.
    const id = savedAs?.id ?? uid();
    const key = contentKey;
    setSaving(true);
    setNotice(null);
    try {
      await saveScan(idb, {
        id,
        title: scanTitle,
        createdAt: new Date().toISOString(),
        pages: pages.map((p) => ({ jpeg: p.cleaned!.jpeg, width: p.cleaned!.width, height: p.cleaned!.height })),
      });
      setSavedAs({ id, key });
      setAnnouncement(`Saved ${scanTitle} to this device.`);
      await reloadLibrary();
    } catch (error) {
      setNotice({
        kind: 'error',
        text: error instanceof DOMException && error.name === 'QuotaExceededError'
          ? 'This browser is out of room for saved scans. Delete an older one, or download this one as a PDF.'
          : 'This scan could not be saved. Download it as a PDF instead.',
      });
    } finally {
      setSaving(false);
    }
  };

  const keepSaved = (id: string) => {
    flushSync(() => setConfirmingDelete(null));
    deleteButtons.current.get(id)?.focus();
  };

  const removeSaved = async (scan: SavedScan) => {
    const idb = scanStore();
    if (!idb) return;
    try {
      await deleteScan(idb, scan.id);
    } catch {
      setNotice({ kind: 'error', text: `${scan.title} could not be deleted.` });
      return;
    }
    if (savedAs?.id === scan.id) setSavedAs(null);
    setConfirmingDelete(null);
    setAnnouncement(`Deleted ${scan.title}.`);
    const rest = await reloadLibrary();
    (rest.length > 0 ? libraryHeading.current : pageHeading.current)?.focus();
  };

  const selected = pages.find((p) => p.id === selectedId) ?? null;
  const selectedNumber = selected ? pages.indexOf(selected) + 1 : 0;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-2 flex items-center justify-between">
        <h1 ref={pageHeading} tabIndex={-1} className="text-2xl font-black tracking-tight focus:outline-none">Scan notes</h1>
        {pages.length > 0 && (
          <button onClick={startOver} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground">
            <RotateCcw size={14} /> Start over
          </button>
        )}
      </div>
      <p className="mb-6 max-w-2xl text-sm text-muted-foreground">
        Photograph pages of handwritten notes, or open a PDF of them. SahurLock straightens each page, evens out the
        light, levels the writing and removes ruled lines, all on this device, then saves them as one PDF. Nothing is
        uploaded.
      </p>

      {pages.length === 0 && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
          className={`flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-14 text-center transition ${dragging ? 'border-accent bg-accent/5' : 'border-input'}`}
        >
          <ImageUp size={28} className="text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">Drop photos or a PDF here, or</p>
          <label className="cursor-pointer rounded-xl bg-accent px-4 py-2.5 text-sm font-bold text-accent-foreground transition hover:opacity-90 focus-within:ring-2 focus-within:ring-accent focus-within:ring-offset-2 focus-within:ring-offset-background">
            Choose photos or a PDF
            <input type="file" accept="image/*,application/pdf" multiple className="sr-only" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
          </label>
          <p className="text-xs text-muted-foreground">JPEG, PNG, WebP or PDF. Shoot from above with the whole page in view.</p>
        </div>
      )}

      {notice && (
        <p role={notice.kind === 'error' ? 'alert' : 'status'} className={`mb-4 text-sm ${notice.kind === 'error' ? 'text-danger' : 'text-muted-foreground'}`}>
          {notice.text}
        </p>
      )}

      {pages.length > 0 && (
        <>
          <fieldset className="mb-5 flex flex-wrap gap-x-6 gap-y-2">
            <legend className="sr-only">Cleanup options</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={lines.horizontal} onChange={(e) => changeLines({ ...lines, horizontal: e.target.checked })} className="h-4 w-4 accent-accent" />
              Remove ruled lines
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={lines.vertical} onChange={(e) => changeLines({ ...lines, vertical: e.target.checked })} className="h-4 w-4 accent-accent" />
              Remove grid lines
            </label>
          </fieldset>

          <ol aria-label="Pages" className="mb-5 flex flex-wrap items-center gap-2">
            {pages.map((page, i) => (
              <li key={page.id} className="relative">
                <button
                  onClick={() => setSelectedId(page.id)}
                  aria-current={page.id === selectedId ? 'true' : undefined}
                  className={`flex h-20 w-16 items-center justify-center overflow-hidden rounded-lg border-2 bg-white transition ${page.id === selectedId ? 'border-accent' : 'border-input hover:border-foreground/40'}`}
                >
                  {page.cleaned
                    // eslint-disable-next-line @next/next/no-img-element -- a local blob URL, which next/image cannot optimise
                    ? <img src={page.cleaned.pngUrl} alt="" className="h-full w-full object-contain" />
                    : <span className="text-[10px] text-muted-foreground">{page.error ? 'Error' : '…'}</span>}
                  <span className="sr-only">Page {i + 1}</span>
                </button>
                <button
                  onClick={() => removePage(page.id)}
                  aria-label={`Remove page ${i + 1}`}
                  className="absolute -right-1.5 -top-1.5 rounded-full border border-input bg-card p-0.5 text-muted-foreground transition hover:text-danger"
                >
                  <X size={12} />
                </button>
              </li>
            ))}
            <li>
              <label className="flex h-20 w-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-input text-xs text-muted-foreground transition hover:border-accent hover:text-foreground focus-within:ring-2 focus-within:ring-accent">
                <Plus size={16} aria-hidden="true" />
                Add page
                <input type="file" accept="image/*,application/pdf" multiple className="sr-only" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
              </label>
            </li>
          </ol>

          {selected && (
            <>
              {selected.error
                ? <p role="alert" className="mb-4 text-sm text-danger">Page {selectedNumber}: {selected.error}</p>
                : <p role="status" aria-live="polite" className="mb-4 min-h-5 text-sm text-muted-foreground">Page {selectedNumber}: {describe(selected)}</p>}

              <div className="grid gap-4 md:grid-cols-2">
                <figure className="overflow-hidden rounded-xl border border-border bg-card">
                  {/* eslint-disable-next-line @next/next/no-img-element -- a local blob URL, which next/image cannot optimise */}
                  <img src={selected.originalUrl} alt="The photo as taken" className="max-h-[70vh] w-full object-contain" />
                  <figcaption className="border-t border-border px-3 py-2 text-xs text-muted-foreground">Original</figcaption>
                </figure>
                <figure className="overflow-hidden rounded-xl border border-border bg-card">
                  {selected.cleaned
                    // eslint-disable-next-line @next/next/no-img-element -- a local blob URL, which next/image cannot optimise
                    ? <img src={selected.cleaned.pngUrl} alt="The cleaned page" className="max-h-[70vh] w-full bg-white object-contain" />
                    : <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">{selected.error ? '' : 'Cleaning…'}</div>}
                  <figcaption className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
                    Cleaned{selected.cleaned ? `, ${selected.cleaned.width} × ${selected.cleaned.height} px` : ''}
                  </figcaption>
                </figure>
              </div>
            </>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              onClick={downloadPdf}
              disabled={!ready || exporting}
              className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2.5 text-sm font-bold text-accent-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <FileDown size={15} /> Download PDF{pages.length > 1 ? ` (${pages.length} pages)` : ''}
            </button>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              Paper
              <select value={paper} onChange={(e) => setPaper(e.target.value as Paper)} className="rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground focus:border-accent focus:outline-none">
                <option value="a4">A4</option>
                <option value="letter">Letter</option>
              </select>
            </label>
            {selected?.cleaned && (
              <a
                href={selected.cleaned.pngUrl}
                download={`notes-${today}-page-${selectedNumber}.png`}
                className="inline-flex items-center gap-1.5 rounded-xl border border-input px-4 py-2.5 text-sm font-medium text-foreground transition hover:bg-muted"
              >
                <Download size={15} /> Download this page as PNG
              </a>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <label htmlFor="scan-title" className="text-sm text-muted-foreground">Title</label>
            <input
              id="scan-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={`Notes ${today}`}
              maxLength={120}
              className="w-56 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground focus:border-accent focus:outline-none"
            />
            <button
              onClick={saveToLibrary}
              disabled={!ready || saving || upToDate}
              className="inline-flex items-center gap-1.5 rounded-lg border border-input px-3 py-2 text-sm font-medium text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Save size={14} /> {upToDate ? 'Saved' : savedAs ? 'Save changes' : 'Save to this device'}
            </button>
          </div>
        </>
      )}

      <p role="status" className="sr-only">{announcement}</p>

      {library.length > 0 && (
        <section aria-labelledby="saved-scans" className="mt-10">
          <h2 id="saved-scans" ref={libraryHeading} tabIndex={-1} className="mb-1 text-base font-semibold focus:outline-none">Saved scans</h2>
          <p className="mb-4 text-xs text-muted-foreground">Kept in this browser only. Settings &gt; Data &gt; Clear everything removes them.</p>
          <ul className="space-y-2">
            {library.map((scan) => (
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
                    <button onClick={() => removeSaved(scan)} className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-red-700">Delete</button>
                    <button ref={keepButton} onClick={() => keepSaved(scan.id)} className="rounded-md px-2.5 py-1 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground">Keep</button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => savePdf(scan.pages.map((pg) => pg.jpeg), scanFileName(scan.title))}
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
      )}
    </div>
  );
}
