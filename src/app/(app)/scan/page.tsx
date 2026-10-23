'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Check, ChevronLeft, ChevronRight, Download, FileDown, ImageUp, Plus, RotateCcw, Save, SquareDashed, X } from 'lucide-react';
import { PaperSelect } from '@/components/paper-select';
import { RegionEditor } from '@/components/region-editor';
import { SavedScans } from '@/components/saved-scans';
import type { LineRemoval } from '@/lib/scan/clean';
import { type Block, DOCUMENT_VERSION } from '@/lib/scan/document';
import { buildPdf, type Paper } from '@/lib/scan/pdf';
import { isPdf, MAX_PDF_PAGES, pdfToImages } from '@/lib/scan/pdf-pages';
import { deleteScan, groupByCourse, listScans, saveScan, scanFileName, type SavedScan } from '@/lib/scan/library';
import { scanKey } from '@/lib/scan/scan-key';
import type { ScanRequest, ScanResponse } from '@/lib/scan/worker';
import { uid } from '@/lib/utils';

/** IndexedDB, or null where the browser does not offer it. */
const scanStore = () => (typeof indexedDB === 'undefined' ? null : indexedDB);

const pad = (n: number) => String(n).padStart(2, '0');
/** The date where the user is, such as 2026-10-23. toISOString would give the date in UTC. */
const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localTime = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

interface Cleaned {
  /** Object URL of the cleaned image: the worker's PNG, or the stored JPEG of a saved page. */
  url: string;
  format: 'png' | 'jpeg';
  jpeg: Blob;
  width: number;
  height: number;
  pageFound: boolean;
  skewDegrees: number;
}

interface ScanPage {
  id: string;
  /** The photo, or null for a page opened from Saved scans, which keep only the cleaned image. */
  file: File | null;
  originalUrl: string | null;
  /** The worker request whose answer this page is waiting for. */
  request: string | null;
  cleaned: Cleaned | null;
  error: string | null;
  /** Regions marked on the cleaned page, in its pixels. They follow the page when it moves. */
  blocks: Block[];
  regionsComplete: boolean;
}

/** Letter in the countries that use it, A4 everywhere else. */
function defaultPaper(): Paper {
  const region = typeof navigator === 'undefined' ? '' : navigator.language.split('-')[1] ?? '';
  return ['US', 'CA', 'MX', 'PH'].includes(region.toUpperCase()) ? 'letter' : 'a4';
}

function describe(page: ScanPage): string {
  if (page.error) return page.error;
  if (!page.cleaned || page.request) return 'Cleaning the page…';
  if (!page.file) return 'Opened from Saved scans.';
  const { pageFound, skewDegrees } = page.cleaned;
  return [
    pageFound ? 'Found the page edges and straightened it.' : 'No page edge stood out, so the whole photo was used.',
    Math.abs(skewDegrees) >= 0.5 ? ` Levelled the writing by ${Math.abs(skewDegrees).toFixed(1)}°.` : '',
  ].join('');
}

/** Free the object URLs a page holds. */
function release(page: ScanPage) {
  if (page.originalUrl) URL.revokeObjectURL(page.originalUrl);
  if (page.cleaned) URL.revokeObjectURL(page.cleaned.url);
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
  const [title, setTitle] = useState('');
  const [course, setCourse] = useState('');
  /** The library entry these pages were saved as, and what they looked like then. */
  const [savedAs, setSavedAs] = useState<{ id: string; key: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  /** The page the region editor opened on, while it is open. */
  const [markingFrom, setMarkingFrom] = useState<string | null>(null);
  const pageHeading = useRef<HTMLHeadingElement | null>(null);
  // Async work checks these when it finishes, so it lands only where it started.
  /** Changes when the pages are replaced as a whole (Open, Start over). Imports in flight are dropped. */
  const pageSet = useRef(0);
  /** Changes whenever the editor stops editing the scan it had. A save in flight then leaves the editor alone. */
  const editing = useRef(0);

  const reloadLibrary = async () => {
    const idb = scanStore();
    const next = idb ? await listScans(idb).catch(() => []) : [];
    setLibrary(next);
    return next;
  };
  useEffect(() => { reloadLibrary(); }, []);

  useEffect(() => { pagesRef.current = pages; }, [pages]);
  useEffect(() => { setPaper(defaultPaper()); }, []);

  useEffect(() => {
    const worker = new Worker(new URL('../../../lib/scan/worker.ts', import.meta.url));
    worker.onmessage = (event: MessageEvent<ScanResponse>) => {
      const r = event.data;
      setPages((all) => all.map((page) => {
        if (page.request !== r.id) return page;
        if (!r.ok) return { ...page, request: null, error: r.error };
        if (page.cleaned) URL.revokeObjectURL(page.cleaned.url);
        return {
          ...page, request: null, error: null,
          cleaned: { url: URL.createObjectURL(r.png), format: 'png', jpeg: r.jpeg, width: r.width, height: r.height, pageFound: r.pageFound, skewDegrees: r.skewDegrees },
        };
      }));
    };
    workerRef.current = worker;
    return () => {
      worker.terminate();
      pagesRef.current.forEach(release);
    };
  }, []);

  const send = (page: ScanPage, options: LineRemoval): ScanPage => {
    // A page opened from Saved scans was cleaned when it was scanned, and its photo is not kept.
    if (!page.file) return page;
    const request: ScanRequest = { id: uid(), file: page.file, lines: options };
    workerRef.current?.postMessage(request);
    return { ...page, request: request.id, error: null };
  };

  const addImages = (files: File[]) => {
    const added = files.map((file) =>
      send({ id: uid(), file, originalUrl: URL.createObjectURL(file), request: null, cleaned: null, error: null, blocks: [], regionsComplete: false }, lines));
    if (added.length === 0) return;
    setPages((all) => [...all, ...added]);
    setSelectedId((current) => current ?? added[0].id);
  };

  const addFiles = async (list: FileList | null) => {
    const files = Array.from(list ?? []);
    const set = pageSet.current;
    setNotice(null);
    for (const file of files) {
      if (pageSet.current !== set) return;
      if (!isPdf(file)) { addImages([file]); continue; }
      setNotice({ kind: 'reading', text: `Reading ${file.name}…` });
      try {
        const { images, skipped } = await pdfToImages(file);
        // Another scan was opened, or Start over pressed, while this PDF was read.
        if (pageSet.current !== set) return;
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

  const movePage = (id: string, step: -1 | 1) => {
    setPages((all) => {
      const from = all.findIndex((p) => p.id === id);
      const to = from + step;
      if (from < 0 || to < 0 || to >= all.length) return all;
      const next = [...all];
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
  };

  const removePage = (id: string) => {
    const page = pages.find((p) => p.id === id);
    if (page) release(page);
    const rest = pages.filter((p) => p.id !== id);
    setPages(rest);
    if (selectedId === id) setSelectedId(rest[0]?.id ?? null);
    // With no pages left, whatever comes next is a new scan, not a change to the saved one.
    if (rest.length === 0) forgetSavedScan();
  };

  const forgetSavedScan = () => {
    editing.current += 1;
    setTitle('');
    setCourse('');
    setSavedAs(null);
    setSaveError(null);
  };

  const startOver = () => {
    pageSet.current += 1;
    pages.forEach(release);
    setPages([]);
    setSelectedId(null);
    setNotice(null);
    forgetSavedScan();
  };

  /** Clear the status region first, so the same words twice are announced twice. */
  const announce = (text: string) => {
    flushSync(() => setAnnouncement(''));
    setAnnouncement(text);
  };

  const today = localDate();
  const ready = pages.length > 0 && pages.every((p) => p.cleaned && !p.request && !p.error);
  const keyOf = (name: string, courseName: string, list: ScanPage[]) =>
    scanKey(name, courseName, list.map((p) => ({ url: p.cleaned?.url ?? '', regionsComplete: p.regionsComplete, blocks: p.blocks })));
  const currentKey = useMemo(() => keyOf(title.trim(), course, pages), [title, course, pages]);
  const upToDate = savedAs !== null && savedAs.key === currentKey;
  const courses = groupByCourse(library).map((g) => g.course).filter(Boolean);

  const savePdf = async (jpegs: Blob[], filename: string) => {
    if (exporting) return;
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
    if (!ready || saving || upToDate) return;
    const idb = scanStore();
    if (!idb) {
      setSaveError('This browser cannot keep scans. Download them as a PDF instead.');
      return;
    }
    // Saving again after a change replaces the earlier copy instead of adding another.
    const id = savedAs?.id ?? uid();
    const replacing = savedAs !== null;
    // An untitled scan is named when it is saved, and the name shows in the field.
    const name = title.trim() || `Notes ${localDate()} ${localTime()}`;
    const key = keyOf(name, course, pages);
    const scan = editing.current;
    setSaving(true);
    setSaveError(null);
    try {
      await saveScan(idb, {
        id,
        title: name,
        course: course.trim(),
        createdAt: new Date().toISOString(),
        pages: pages.map((p) => ({ jpeg: p.cleaned!.jpeg, width: p.cleaned!.width, height: p.cleaned!.height })),
        document: {
          version: DOCUMENT_VERSION,
          pages: pages.map((p) => ({ width: p.cleaned!.width, height: p.cleaned!.height, regionsComplete: p.regionsComplete, blocks: p.blocks })),
        },
      });
      // The editor may hold another scan by now. Linking it to this save would let
      // its next save overwrite this one.
      if (editing.current === scan) {
        setTitle(name);
        setSavedAs({ id, key });
      }
      announce(replacing ? `Saved the changes to ${name}.` : `Saved ${name} to this device.`);
      await reloadLibrary();
    } catch (error) {
      const full = error instanceof DOMException && error.name === 'QuotaExceededError';
      if (editing.current === scan) {
        setSaveError(full
          ? 'This browser is out of room for saved scans. Delete an older one, or download this one as a PDF.'
          : 'This scan could not be saved. Download it as a PDF instead.');
      } else {
        setNotice({ kind: 'error', text: full ? `${name} was not saved, because this browser is out of room for saved scans.` : `${name} could not be saved.` });
      }
    } finally {
      setSaving(false);
    }
  };

  const openSaved = (scan: SavedScan) => {
    pageSet.current += 1;
    editing.current += 1;
    pages.forEach(release);
    const opened: ScanPage[] = scan.pages.map((p, i) => ({
      id: uid(), file: null, originalUrl: null, request: null, error: null,
      cleaned: { url: URL.createObjectURL(p.jpeg), format: 'jpeg', jpeg: p.jpeg, width: p.width, height: p.height, pageFound: true, skewDegrees: 0 },
      blocks: scan.document.pages[i].blocks,
      regionsComplete: scan.document.pages[i].regionsComplete,
    }));
    setPages(opened);
    setSelectedId(opened[0].id);
    setNotice(scan.labelsUnreadable
      ? { kind: 'info', text: "This scan's marked regions could not be read, so it opened without them." }
      : null);
    setSaveError(null);
    setTitle(scan.title);
    setCourse(scan.course);
    setSavedAs({ id: scan.id, key: keyOf(scan.title, scan.course, opened) });
    announce(`Opened ${scan.title}.`);
    pageHeading.current?.focus();
  };

  const removeSaved = async (scan: SavedScan) => {
    const idb = scanStore();
    if (!idb) return null;
    try {
      await deleteScan(idb, scan.id);
    } catch {
      return null;
    }
    if (savedAs?.id === scan.id) setSavedAs(null);
    announce(`Deleted ${scan.title}.`);
    const rest = await reloadLibrary();
    if (rest.length === 0) pageHeading.current?.focus();
    return rest.length;
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
            {pages.some((p) => !p.file) && (
              <p className="w-full text-xs text-muted-foreground">Pages opened from Saved scans are already cleaned, so these options apply to photos you add.</p>
            )}
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
                    ? <img src={page.cleaned.url} alt="" className="h-full w-full object-contain" />
                    : <span className="text-[10px] text-muted-foreground">{page.error ? 'Error' : '…'}</span>}
                  <span className="sr-only">
                    Page {i + 1}
                    {page.blocks.length > 0 && `, ${page.blocks.length} ${page.blocks.length === 1 ? 'region' : 'regions'}`}
                    {page.regionsComplete && ', every region marked'}
                  </span>
                  {(page.blocks.length > 0 || page.regionsComplete) && (
                    <span aria-hidden="true" className="absolute bottom-1 right-1 inline-flex items-center gap-0.5 rounded bg-foreground px-1 text-[10px] font-semibold leading-4 text-background">
                      {page.blocks.length > 0 && page.blocks.length}
                      {page.regionsComplete && <Check size={10} />}
                    </span>
                  )}
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

              {pages.length > 1 && (
                <div className="mb-4 flex gap-2">
                  {/* aria-disabled at the ends, so the button keeps focus after the last move. */}
                  <button
                    onClick={() => movePage(selected.id, -1)}
                    aria-disabled={selectedNumber === 1}
                    className="inline-flex items-center gap-1 rounded-lg border border-input px-3 py-1.5 text-sm text-foreground transition hover:bg-muted aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
                  >
                    <ChevronLeft size={14} aria-hidden="true" /> Move earlier
                  </button>
                  <button
                    onClick={() => movePage(selected.id, 1)}
                    aria-disabled={selectedNumber === pages.length}
                    className="inline-flex items-center gap-1 rounded-lg border border-input px-3 py-1.5 text-sm text-foreground transition hover:bg-muted aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
                  >
                    Move later <ChevronRight size={14} aria-hidden="true" />
                  </button>
                </div>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <figure className="overflow-hidden rounded-xl border border-border bg-card">
                  {selected.originalUrl
                    // eslint-disable-next-line @next/next/no-img-element -- a local blob URL, which next/image cannot optimise
                    ? <img src={selected.originalUrl} alt="The photo as taken" className="max-h-[70vh] w-full object-contain" />
                    : <div className="flex h-64 items-center justify-center px-6 text-center text-sm text-muted-foreground">Saved scans keep only the cleaned page, not the photo.</div>}
                  <figcaption className="border-t border-border px-3 py-2 text-xs text-muted-foreground">Original</figcaption>
                </figure>
                <figure className="overflow-hidden rounded-xl border border-border bg-card">
                  {selected.cleaned
                    // eslint-disable-next-line @next/next/no-img-element -- a local blob URL, which next/image cannot optimise
                    ? <img src={selected.cleaned.url} alt="The cleaned page" className="max-h-[70vh] w-full bg-white object-contain" />
                    : <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">{selected.error ? '' : 'Cleaning…'}</div>}
                  <figcaption className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
                    Cleaned{selected.cleaned ? `, ${selected.cleaned.width} × ${selected.cleaned.height} px` : ''}
                  </figcaption>
                </figure>
              </div>

              {selected.cleaned && !selected.request && !selected.error && (
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    onClick={() => setMarkingFrom(selected.id)}
                    aria-label={`Mark regions on page ${selectedNumber}`}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-input px-3 py-2 text-sm font-medium text-foreground transition hover:bg-muted"
                  >
                    <SquareDashed size={14} aria-hidden="true" /> Mark regions
                  </button>
                  <p className="text-xs text-muted-foreground">
                    Optional. Box each part of the page and say what it is. Labels stay on this device, and can later train SahurLock&apos;s own recognizer.
                  </p>
                </div>
              )}
            </>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              onClick={downloadPdf}
              disabled={!ready}
              // aria-disabled, not disabled, while busy: a disabled button drops keyboard focus.
              aria-disabled={exporting}
              className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2.5 text-sm font-bold text-accent-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
            >
              <FileDown size={15} /> Download PDF{pages.length > 1 ? ` (${pages.length} pages)` : ''}
            </button>
            <PaperSelect value={paper} onChange={setPaper} />
            {selected?.cleaned && (
              <a
                href={selected.cleaned.url}
                download={`notes-${today}-page-${selectedNumber}.${selected.cleaned.format === 'png' ? 'png' : 'jpg'}`}
                className="inline-flex items-center gap-1.5 rounded-xl border border-input px-4 py-2.5 text-sm font-medium text-foreground transition hover:bg-muted"
              >
                <Download size={15} /> Download this page as {selected.cleaned.format === 'png' ? 'PNG' : 'JPEG'}
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
            <label htmlFor="scan-course" className="text-sm text-muted-foreground">Course</label>
            <input
              id="scan-course"
              value={course}
              onChange={(e) => setCourse(e.target.value)}
              list="scan-courses"
              placeholder="Optional"
              maxLength={60}
              className="w-36 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground focus:border-accent focus:outline-none"
            />
            <datalist id="scan-courses">
              {courses.map((c) => <option key={c} value={c} />)}
            </datalist>
            <button
              onClick={saveToLibrary}
              disabled={!ready}
              aria-disabled={saving || upToDate}
              className="inline-flex items-center gap-1.5 rounded-lg border border-input px-3 py-2 text-sm font-medium text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40 aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
            >
              <Save size={14} /> {upToDate ? 'Saved' : savedAs ? 'Save changes' : 'Save to this device'}
            </button>
          </div>
          {saveError && <p role="alert" className="mt-2 text-sm text-danger">{saveError}</p>}
        </>
      )}

      <p role="status" className="sr-only">{announcement}</p>

      {markingFrom && (
        <RegionEditor
          pages={pages.filter((p) => p.cleaned && !p.request && !p.error).map((p) => ({
            id: p.id, url: p.cleaned!.url, width: p.cleaned!.width, height: p.cleaned!.height, blocks: p.blocks, regionsComplete: p.regionsComplete,
          }))}
          startId={markingFrom}
          onChange={(id, blocks, regionsComplete) => setPages((all) => all.map((p) => (p.id === id ? { ...p, blocks, regionsComplete } : p)))}
          onClose={(id) => { setMarkingFrom(null); setSelectedId(id); }}
        />
      )}

      {library.length > 0 && (
        <SavedScans
          scans={library}
          exporting={exporting}
          // The editor has its own paper control. Without it open, the list shows one.
          paper={pages.length === 0 ? { value: paper, onChange: setPaper } : null}
          // Opening over pages that are not saved as they are, or while a PDF is still being read, asks first.
          openNeedsConfirm={(pages.length > 0 && !upToDate) || notice?.kind === 'reading'}
          onOpen={openSaved}
          onDownload={(scan) => savePdf(scan.pages.map((pg) => pg.jpeg), scanFileName(scan.title))}
          onDelete={removeSaved}
        />
      )}
    </div>
  );
}
