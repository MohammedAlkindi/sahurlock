'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Check, ChevronLeft, ChevronRight, Download, FileDown, FolderInput, ImageUp, Plus, RotateCcw, Save, SquareDashed, X } from 'lucide-react';
import { PaperSelect } from '@/components/paper-select';
import { type EditorPage, RegionEditor } from '@/components/region-editor';
import { SavedScans } from '@/components/saved-scans';
import type { LineRemoval } from '@/lib/scan/clean';
import { type Block, DOCUMENT_VERSION } from '@/lib/scan/document';
import { buildPdf, type Paper } from '@/lib/scan/pdf';
import { buildLabelsZip, labelsFileName, LabelsTooLargeError } from '@/lib/scan/dataset';
import { downloadBlob } from '@/lib/download';
import { endRead, readingLine, type Reads, type ScanNotice, startRead } from '@/lib/scan/imports';
import { isPdf, MAX_PDF_PAGES, pdfToImages } from '@/lib/scan/pdf-pages';
import {
  deleteScan, groupByCourse, listScans, type MoveSource, movePageToScan, saveScan, ScanChangedError, scanFileName, type SavedScan,
} from '@/lib/scan/library';
import { scanKey } from '@/lib/scan/scan-key';
import type { ScanRequest, ScanResponse } from '@/lib/scan/worker';
import { localDate, localTime, uid } from '@/lib/utils';

/** IndexedDB, or null where the browser does not offer it. */
const scanStore = () => (typeof indexedDB === 'undefined' ? null : indexedDB);


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
  const [notice, setNotice] = useState<ScanNotice | null>(null);
  const [library, setLibrary] = useState<SavedScan[]>([]);
  const [title, setTitle] = useState('');
  const [course, setCourse] = useState('');
  /** The library entry these pages were saved as, what they looked like then, and the saved time stored with them. */
  const [savedAs, setSavedAs] = useState<{ id: string; key: string; savedAt: string } | null>(null);
  const [saving, setSaving] = useState(false);
  /** The saved scan chosen to move the selected page to. */
  const [moveTarget, setMoveTarget] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  /** Why the last move failed. Kept apart from import notices, so neither replaces the other. */
  const [moveError, setMoveError] = useState<string | null>(null);
  /** PDFs being read into the pages on screen, tagged with the page set they belong to, so a read that will be dropped does not count. */
  const [reading, setReading] = useState<Reads>({ set: 0, names: [] });
  /**
   * What came of each PDF read since the last pick: pages left out, or a file
   * that could not be read. Kept apart from the reading line, so a read
   * starting never hides another's result.
   */
  const [importNotes, setImportNotes] = useState<ScanNotice[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  /** The page the region editor opened on, while it is open. */
  const [markingFrom, setMarkingFrom] = useState<string | null>(null);
  /** What is waiting for a yes before marked regions are thrown away. */
  const [discarding, setDiscarding] = useState<{ action: 'start-over' } | { action: 'remove'; pageId: string } | null>(null);
  const startOverButton = useRef<HTMLButtonElement | null>(null);
  const removeButtons = useRef(new Map<string, HTMLButtonElement>());
  const pageButtons = useRef(new Map<string, HTMLButtonElement>());
  const discardCancel = useRef<HTMLButtonElement | null>(null);
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
    // Old results go. A PDF still being read by an earlier pick keeps its line, which comes from `reading`.
    setNotice(null);
    setImportNotes([]);
    for (const file of files) {
      if (pageSet.current !== set) return;
      if (!isPdf(file)) { addImages([file]); continue; }
      setReading((r) => startRead(r, set, file.name));
      try {
        const { images, skipped } = await pdfToImages(file);
        // Another scan was opened, or Start over pressed, while this PDF was read.
        if (pageSet.current !== set) return;
        addImages(images);
        if (skipped > 0) {
          setImportNotes((n) => [...n, { kind: 'info', text: `${file.name} has more than ${MAX_PDF_PAGES} pages, so only the first ${MAX_PDF_PAGES} were added.` }]);
        }
      } catch {
        if (pageSet.current === set) {
          setImportNotes((n) => [...n, { kind: 'error', text: `${file.name} could not be read as a PDF. If it has a password, export it again without one.` }]);
        }
      } finally {
        setReading((r) => endRead(r, set, file.name));
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
    // A move error is about pages that are no longer here.
    setMoveError(null);
  };

  const startOver = () => {
    pageSet.current += 1;
    setReading({ set: pageSet.current, names: [] });
    setImportNotes([]);
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
  /** Marked regions that only exist on this screen, which leaving or starting over would lose. */
  const unsavedRegions = !upToDate && pages.some((p) => p.blocks.length > 0);

  useEffect(() => {
    if (!unsavedRegions) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsavedRegions]);

  useEffect(() => { if (discarding) discardCancel.current?.focus(); }, [discarding]);

  /** Close the confirm and put focus back on the button that opened it. */
  const keepRegions = () => {
    if (!discarding) return;
    const was = discarding;
    // The Start over button is replaced by the confirm, so it only exists again after this render.
    flushSync(() => setDiscarding(null));
    (was.action === 'start-over' ? startOverButton.current : removeButtons.current.get(was.pageId))?.focus();
  };
  const askStartOver = () => (unsavedRegions ? setDiscarding({ action: 'start-over' }) : startOver());
  const askRemovePage = (id: string) => {
    const index = pages.findIndex((p) => p.id === id);
    if (pages[index]?.blocks.length) {
      setDiscarding({ action: 'remove', pageId: id });
      return;
    }
    // The button pressed goes with its page, so focus moves to the next page's, as after the confirm.
    const next = pages[index + 1] ?? pages[index - 1];
    flushSync(() => removePage(id));
    (next ? removeButtons.current.get(next.id) : pageHeading.current)?.focus();
  };
  const courses = groupByCourse(library).map((g) => g.course).filter(Boolean);

  const savePdf = async (jpegs: Blob[], filename: string) => {
    if (exporting) return;
    setExporting(true);
    try {
      const bytes = buildPdf(await Promise.all(jpegs.map(async (j) => new Uint8Array(await j.arrayBuffer()))), paper);
      downloadBlob(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), filename);
    } finally {
      setExporting(false);
    }
  };

  const downloadPdf = () => savePdf(pages.map((p) => p.cleaned!.jpeg), `notes-${today}.pdf`);

  const downloadLabels = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const now = new Date();
      const labels = await buildLabelsZip(library, now);
      downloadBlob(labels.zip, labelsFileName(now));
      const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
      const left = [
        labels.skipped.duplicateImage && plural(labels.skipped.duplicateImage, 'repeated page image', 'repeated page images'),
        labels.skipped.sizeMismatch && plural(labels.skipped.sizeMismatch, 'page whose image size did not match', 'pages whose image sizes did not match'),
        labels.skipped.unreadableLabels && plural(labels.skipped.unreadableLabels, 'scan whose labels could not be read', 'scans whose labels could not be read'),
      ].filter(Boolean);
      announce(`Downloaded labels for ${plural(labels.pages, 'page', 'pages')} from ${plural(labels.scans, 'scan', 'scans')}, ${labels.completePages} of them fully marked.${left.length ? ` Left out ${left.join(' and ')}.` : ''}`);
    } catch (error) {
      setNotice({
        kind: 'error',
        text: error instanceof LabelsTooLargeError
          ? 'The labeled pages are too large for one download. Delete some saved scans you no longer need, then try again.'
          : 'The labels could not be downloaded. Try again.',
      });
    } finally {
      setExporting(false);
    }
  };

  const saveToLibrary = async () => {
    // A page being moved is still in this scan until the move ends, so saving now would keep a copy of it here.
    if (!ready || saving || upToDate || moving) return;
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
    const savedAt = new Date().toISOString();
    const scan = editing.current;
    setSaving(true);
    setSaveError(null);
    try {
      await saveScan(idb, {
        id,
        title: name,
        course: course.trim(),
        createdAt: savedAt,
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
        setSavedAs({ id, key, savedAt });
        // A move error about these pages, such as their scan being deleted elsewhere, no longer applies.
        setMoveError(null);
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
    setReading({ set: pageSet.current, names: [] });
    setImportNotes([]);
    setMoveError(null);
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
    setSavedAs({ id: scan.id, key: keyOf(scan.title, scan.course, opened), savedAt: scan.createdAt });
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
    if (savedAs?.id === scan.id) {
      setSavedAs(null);
      // Its advice, such as opening this scan again, no longer applies.
      setMoveError(null);
    }
    announce(`Deleted ${scan.title}.`);
    const rest = await reloadLibrary();
    if (rest.length === 0) pageHeading.current?.focus();
    return rest.length;
  };

  /** Scans a page can move to: every other saved scan whose labels can be read, since moving rewrites them. */
  const moveTargets = library.filter((s) => s.id !== savedAs?.id && !s.labelsUnreadable);
  /** A move changes the saved copy of this scan, so with changes not yet saved it would undo them. */
  const moveNeedsSave = savedAs !== null && !upToDate;

  /**
   * Apply a change that can remove the focused element, and if it did, move
   * focus to `fallback`. Focus is read just before the change, so focus the
   * user moved elsewhere meanwhile stays put. With nothing focused (the body,
   * as after a mouse click in Safari) focus is left alone.
   */
  const keepFocus = (apply: () => void, fallback: () => HTMLElement | null | undefined) => {
    const before = document.activeElement;
    flushSync(apply);
    if (before instanceof HTMLElement && before !== document.body && !before.isConnected) fallback()?.focus();
  };

  /**
   * Drop a page from this screen once it lives somewhere else, and return the
   * pages left. The pages are filtered as they are when React applies it, so a
   * cleanup result that lands meanwhile is kept.
   */
  const dropMovedPage = (id: string) => {
    const now = pagesRef.current;
    const index = now.findIndex((p) => p.id === id);
    if (index >= 0) release(now[index]);
    const rest = now.filter((p) => p.id !== id);
    const next = rest[index] ?? rest[index - 1] ?? null;
    // The Move control goes when the page now selected cannot move, and the page's own buttons go with it.
    keepFocus(() => {
      setPages((all) => all.filter((p) => p.id !== id));
      setSelectedId((current) => (current === id ? next?.id ?? null : current));
      // A confirm about the page that left, or about all of them once none are left, has nothing to ask about.
      setDiscarding((d) => (rest.length === 0 || (d?.action === 'remove' && d.pageId === id) ? null : d));
    }, () => (next ? pageButtons.current.get(next.id) : pageHeading.current));
    return rest;
  };

  const moveToScan = async (pageId: string, targetId: string) => {
    const idb = scanStore();
    const index = pages.findIndex((p) => p.id === pageId);
    const page = pages[index];
    const target = library.find((s) => s.id === targetId);
    if (!idb || !page?.cleaned || !target || moving || saving || moveNeedsSave) return;
    const { cleaned } = page;
    const source: MoveSource = savedAs
      ? { scanId: savedAs.id, position: index, savedAt: savedAs.savedAt, sizes: pages.map((p) => ({ width: p.cleaned!.width, height: p.cleaned!.height })) }
      : {
          page: { jpeg: cleaned.jpeg, width: cleaned.width, height: cleaned.height },
          labels: { width: cleaned.width, height: cleaned.height, regionsComplete: page.regionsComplete, blocks: page.blocks },
        };
    // What the saved copy looks like after the move, from the pages as they were when it started.
    const keyAfter = keyOf(title.trim(), course, pages.filter((p) => p.id !== pageId));
    const sourceId = savedAs?.id ?? null;
    const scan = editing.current;
    const set = pageSet.current;
    // Cleared first, so an old error does not sit beside this result, and the same error twice is announced twice.
    flushSync(() => setMoveError(null));
    setMoving(true);
    try {
      const result = await movePageToScan(idb, source, targetId, new Date());
      // Another scan may have been opened meanwhile. Then only the library changes.
      if (editing.current === scan && pageSet.current === set) {
        const rest = dropMovedPage(pageId);
        // With nothing left on screen, what comes next is a new scan, as after removing the last page.
        if (rest.length === 0) forgetSavedScan();
        else if (savedAs && result.source) setSavedAs({ id: result.source.id, key: keyAfter, savedAt: result.source.createdAt });
        // The last page left its saved scan, which is deleted, so pages added meanwhile make a new scan.
        else if (savedAs) forgetSavedScan();
      }
      announce(`Moved page ${index + 1} to ${target.title}.${savedAs && !result.source ? ' Its scan had no pages left, so it was deleted.' : ''}`);
      // The reload can take away a Saved scans row with focus in it: the source's, when its last page left.
      const stored = await listScans(idb).catch(() => null);
      if (stored) keepFocus(() => setLibrary(stored), () => pageHeading.current);
    } catch (error) {
      const refused = error instanceof ScanChangedError ? error.scan : null;
      // After a refusal, show what is stored now, so opening a scan again opens the copy the move was
      // refused for. Not after other failures: with storage itself failing, the list would read back empty.
      const stored = refused ? await listScans(idb).catch(() => null) : null;
      const here = editing.current === scan && pageSet.current === set;
      const full = error instanceof DOMException && error.name === 'QuotaExceededError';
      const messages = {
        'source': here
          ? 'The page was not moved, because this scan was saved again in another tab or window. Open it again from Saved scans, then move the page.'
          : 'The page was not moved, because the scan it was in was saved again in another tab or window.',
        'source-gone': here
          ? 'The page was not moved, because this scan was deleted in another tab or window. Its pages are still here, so save them to keep them.'
          : 'The page was not moved, because the scan it was in was deleted in another tab or window.',
        'target': `The page was not moved, because ${target.title} was changed or deleted in another tab or window. Saved scans now shows what is stored.`,
      };
      // The reload can take the Move control away, when the refused target was the only other scan.
      keepFocus(() => {
        if (stored) setLibrary(stored);
        // These pages are now saved nowhere, so they show as unsaved: Save offers a new copy, and Open and Start over ask first.
        if (refused === 'source-gone' && here) setSavedAs((link) => (link?.id === sourceId ? null : link));
        setMoveError(refused ? messages[refused]
          : full ? 'The page was not moved, because this browser is out of room for saved scans.'
          : here ? 'The page could not be moved. Try again.' : 'The page could not be moved.');
      }, () => (here ? pageButtons.current.get(pageId) ?? pageHeading.current : pageHeading.current));
    } finally {
      setMoving(false);
    }
  };

  const selected = pages.find((p) => p.id === selectedId) ?? null;
  const selectedNumber = selected ? pages.indexOf(selected) + 1 : 0;
  // The region editor shows cleaned pages only, each numbered by its place in the scan.
  const editorPages: EditorPage[] = pages.flatMap((p, i) => (p.cleaned && !p.request && !p.error ? [{
    id: p.id, number: i + 1, url: p.cleaned.url, width: p.cleaned.width, height: p.cleaned.height, blocks: p.blocks, regionsComplete: p.regionsComplete,
  }] : []));
  // The region editor closes for good once it has no page to show, so it never opens again by itself.
  if (markingFrom && editorPages.length === 0) setMarkingFrom(null);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-2 flex items-center justify-between">
        <h1 ref={pageHeading} tabIndex={-1} className="text-2xl font-black tracking-tight focus:outline-none">Scan notes</h1>
        {pages.length > 0 && (discarding?.action === 'start-over' ? (
          <div key="confirm" role="group" aria-label="Start over? The marked regions are not saved and will be lost." className="flex flex-wrap items-center justify-end gap-2 text-sm">
            <span className="text-muted-foreground" aria-hidden="true">Unsaved regions will be lost.</span>
            <button onClick={() => { setDiscarding(null); startOver(); }} className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-red-700">Start over</button>
            <button ref={discardCancel} onClick={keepRegions} className="rounded-md px-2.5 py-1 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground">Cancel</button>
          </div>
        ) : (
          <button key="start-over" ref={startOverButton} onClick={askStartOver} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground">
            <RotateCcw size={14} /> Start over
          </button>
        ))}
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

      {/* Both live regions stay on the page, so a line added to either is announced. A region that
          arrives already holding its text often is not. Each line keeps its own key, so one arriving
          never rebuilds, and so announces again, the lines already there. */}
      <div role="status">
        {[
          ...(reading.names.length > 0 ? [{ key: 'reading', text: readingLine(reading.names) }] : []),
          ...importNotes.flatMap((n, i) => (n.kind === 'info' ? [{ key: `import-${i}`, text: n.text }] : [])),
          ...(notice?.kind === 'info' ? [{ key: 'notice', text: notice.text }] : []),
        ].map((line) => <p key={line.key} className="mb-4 text-sm text-muted-foreground">{line.text}</p>)}
      </div>
      <div role="alert">
        {[
          ...importNotes.flatMap((n, i) => (n.kind === 'error' ? [{ key: `import-${i}`, text: n.text }] : [])),
          ...(notice?.kind === 'error' ? [{ key: 'notice', text: notice.text }] : []),
          ...(moveError ? [{ key: 'move', text: moveError }] : []),
        ].map((line) => <p key={line.key} className="mb-4 text-sm text-danger">{line.text}</p>)}
      </div>

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
                  ref={(el) => { if (el) pageButtons.current.set(page.id, el); else pageButtons.current.delete(page.id); }}
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
                  ref={(el) => { if (el) removeButtons.current.set(page.id, el); else removeButtons.current.delete(page.id); }}
                  onClick={() => askRemovePage(page.id)}
                  aria-label={`Remove page ${i + 1}`}
                  // 24 px across, the smallest target WCAG 2.2 allows.
                  className="absolute -right-2 -top-2 inline-flex h-6 w-6 items-center justify-center rounded-full border border-input bg-card text-muted-foreground transition hover:text-danger"
                >
                  <X size={14} />
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

          {discarding?.action === 'remove' && (() => {
            const index = pages.findIndex((p) => p.id === discarding.pageId);
            const count = pages[index]?.blocks.length ?? 0;
            const question = `Remove page ${index + 1} and its ${count === 1 ? 'marked region' : `${count} marked regions`}?`;
            return (
              <div role="group" aria-label={question} className="mb-5 flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground" aria-hidden="true">{question}</span>
                <button
                  onClick={() => {
                    const next = pages[index + 1] ?? pages[index - 1];
                    flushSync(() => { setDiscarding(null); removePage(discarding.pageId); });
                    (next ? removeButtons.current.get(next.id) : pageHeading.current)?.focus();
                  }}
                  className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-red-700"
                >
                  Remove
                </button>
                <button ref={discardCancel} onClick={keepRegions} className="rounded-md px-2.5 py-1 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground">Keep</button>
              </div>
            );
          })()}

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
                    // A region marked now would be left behind: the move copies the page as it was when it began.
                    onClick={() => { if (!moving) setMarkingFrom(selected.id); }}
                    aria-disabled={moving}
                    aria-label={`Mark regions on page ${selectedNumber}`}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-input px-3 py-2 text-sm font-medium text-foreground transition hover:bg-muted aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
                  >
                    <SquareDashed size={14} aria-hidden="true" /> Mark regions
                  </button>
                  <p className="text-xs text-muted-foreground">
                    Optional. Box each part of the page and say what it is. Labels stay on this device, and can later train SahurLock&apos;s own recognizer.
                  </p>
                </div>
              )}

              {selected.cleaned && !selected.request && !selected.error && moveTargets.length > 0 && (() => {
                const target = moveTargets.find((s) => s.id === moveTarget) ?? moveTargets[0];
                const pageWord = (n: number) => `${n} ${n === 1 ? 'page' : 'pages'}`;
                return (
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <label htmlFor="move-target" className="text-sm text-muted-foreground">Move page {selectedNumber} to</label>
                    <select
                      id="move-target"
                      value={target.id}
                      onChange={(e) => setMoveTarget(e.target.value)}
                      className="max-w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground focus:border-accent focus:outline-none"
                    >
                      {moveTargets.map((s) => (
                        <option key={s.id} value={s.id}>{`${s.title}${s.course ? `, ${s.course}` : ''}, ${pageWord(s.pages.length)}`}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => moveToScan(selected.id, target.id)}
                      // aria-disabled, not disabled, so focus stays here while the move runs.
                      aria-disabled={moveNeedsSave || moving || saving}
                      aria-describedby={moveNeedsSave ? 'move-hint' : undefined}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-input px-3 py-1.5 text-sm text-foreground transition hover:bg-muted aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
                    >
                      <FolderInput size={14} aria-hidden="true" /> Move
                    </button>
                    {moveNeedsSave && (
                      <p id="move-hint" className="w-full text-xs text-muted-foreground">
                        Save the changes to this scan first. Moving changes its saved copy, which would undo them.
                      </p>
                    )}
                  </div>
                );
              })()}
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
              aria-disabled={saving || upToDate || moving}
              className="inline-flex items-center gap-1.5 rounded-lg border border-input px-3 py-2 text-sm font-medium text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40 aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
            >
              <Save size={14} /> {upToDate ? 'Saved' : savedAs ? 'Save changes' : 'Save to this device'}
            </button>
          </div>
          {saveError && <p role="alert" className="mt-2 text-sm text-danger">{saveError}</p>}
        </>
      )}

      <p role="status" className="sr-only">{announcement}</p>

      {markingFrom && editorPages.length > 0 && (
        <RegionEditor
          pages={editorPages}
          pageCount={pages.length}
          startId={markingFrom}
          onChange={(id, blocks, regionsComplete) => setPages((all) => all.map((p) => (p.id === id ? { ...p, blocks, regionsComplete } : p)))}
          onClose={(id) => { setMarkingFrom(null); setSelectedId(id); }}
        />
      )}

      {library.length > 0 && (
        <SavedScans
          scans={library}
          exporting={exporting}
          // A move rewrites saved scans, so opening or deleting one waits for it.
          busy={moving}
          // The editor has its own paper control. Without it open, the list shows one.
          paper={pages.length === 0 ? { value: paper, onChange: setPaper } : null}
          // Opening over pages that are not saved as they are, or while a PDF is still being read, asks first.
          openNeedsConfirm={(pages.length > 0 && !upToDate) || reading.names.length > 0}
          onOpen={openSaved}
          onDownloadLabels={downloadLabels}
          onDownload={(scan) => savePdf(scan.pages.map((pg) => pg.jpeg), scanFileName(scan.title))}
          onDelete={removeSaved}
        />
      )}
    </div>
  );
}
