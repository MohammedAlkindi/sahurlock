'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, FileDown, ImageUp, Plus, RotateCcw, X } from 'lucide-react';
import type { LineRemoval } from '@/lib/scan/clean';
import { buildPdf, type Paper } from '@/lib/scan/pdf';
import { isPdf, MAX_PDF_PAGES, pdfToImages } from '@/lib/scan/pdf-pages';
import type { ScanRequest, ScanResponse } from '@/lib/scan/worker';
import { uid } from '@/lib/utils';

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
  };

  const today = new Date().toISOString().slice(0, 10);
  const ready = pages.length > 0 && pages.every((p) => p.cleaned && !p.request && !p.error);

  const downloadPdf = async () => {
    setExporting(true);
    try {
      const jpegs = await Promise.all(pages.map(async (p) => new Uint8Array(await p.cleaned!.jpeg.arrayBuffer())));
      const bytes = buildPdf(jpegs, paper);
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `notes-${today}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } finally {
      setExporting(false);
    }
  };

  const selected = pages.find((p) => p.id === selectedId) ?? null;
  const selectedNumber = selected ? pages.indexOf(selected) + 1 : 0;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-2 flex items-center justify-between">
        <h1 className="text-2xl font-black tracking-tight">Scan notes</h1>
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
        </>
      )}
    </div>
  );
}
