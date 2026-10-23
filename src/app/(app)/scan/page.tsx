'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, ImageUp, RotateCcw } from 'lucide-react';
import type { LineRemoval } from '@/lib/scan/clean';
import type { ScanRequest, ScanResponse } from '@/lib/scan/worker';

type Status =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'error'; message: string }
  | { kind: 'done'; cleanedUrl: string; width: number; height: number; pageFound: boolean; skewDegrees: number };

export default function ScanPage() {
  const workerRef = useRef<Worker | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [lines, setLines] = useState<LineRemoval>({ horizontal: true, vertical: false });
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const worker = new Worker(new URL('../../../lib/scan/worker.ts', import.meta.url));
    workerRef.current = worker;
    return () => worker.terminate();
  }, []);

  // Clean the current photo whenever it or the options change.
  useEffect(() => {
    const worker = workerRef.current;
    if (!file || !worker) return;
    let cancelled = false;
    let cleanedUrl: string | null = null;
    setStatus({ kind: 'working' });
    worker.onmessage = (event: MessageEvent<ScanResponse>) => {
      if (cancelled) return;
      const r = event.data;
      if (!r.ok) { setStatus({ kind: 'error', message: r.error }); return; }
      cleanedUrl = URL.createObjectURL(r.png);
      setStatus({ kind: 'done', cleanedUrl, width: r.width, height: r.height, pageFound: r.pageFound, skewDegrees: r.skewDegrees });
    };
    const request: ScanRequest = { file, lines };
    worker.postMessage(request);
    return () => {
      cancelled = true;
      if (cleanedUrl) URL.revokeObjectURL(cleanedUrl);
    };
  }, [file, lines]);

  useEffect(() => {
    if (!file) { setOriginalUrl(null); return; }
    const url = URL.createObjectURL(file);
    setOriginalUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const choose = useCallback((files: FileList | null) => {
    const picked = files?.[0];
    if (picked) setFile(picked);
  }, []);

  const reset = () => {
    setFile(null);
    setStatus({ kind: 'idle' });
    if (inputRef.current) inputRef.current.value = '';
  };

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-2 flex items-center justify-between">
        <h1 className="text-2xl font-black tracking-tight">Scan notes</h1>
        {file && (
          <button onClick={reset} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground">
            <RotateCcw size={14} /> Start over
          </button>
        )}
      </div>
      <p className="mb-6 max-w-2xl text-sm text-muted-foreground">
        Photograph a page of handwritten notes. SahurLock straightens the page, evens out the light, levels the
        writing and removes ruled lines, all on this device. The photo is not uploaded anywhere.
      </p>

      {!file && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); choose(e.dataTransfer.files); }}
          className={`flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-14 text-center transition ${dragging ? 'border-accent bg-accent/5' : 'border-input'}`}
        >
          <ImageUp size={28} className="text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">Drop a photo here, or</p>
          <label className="cursor-pointer rounded-xl bg-accent px-4 py-2.5 text-sm font-bold text-accent-foreground transition hover:opacity-90 focus-within:ring-2 focus-within:ring-accent focus-within:ring-offset-2 focus-within:ring-offset-background">
            Choose a photo
            <input ref={inputRef} type="file" accept="image/*" className="sr-only" onChange={(e) => choose(e.target.files)} />
          </label>
          <p className="text-xs text-muted-foreground">JPEG, PNG or WebP. Shoot from above with the whole page in view.</p>
        </div>
      )}

      {file && (
        <>
          <fieldset className="mb-5 flex flex-wrap gap-x-6 gap-y-2">
            <legend className="sr-only">Cleanup options</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={lines.horizontal} onChange={(e) => setLines((l) => ({ ...l, horizontal: e.target.checked }))} className="h-4 w-4 accent-accent" />
              Remove ruled lines
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={lines.vertical} onChange={(e) => setLines((l) => ({ ...l, vertical: e.target.checked }))} className="h-4 w-4 accent-accent" />
              Remove grid lines
            </label>
          </fieldset>

          <p role="status" aria-live="polite" className="mb-4 min-h-5 text-sm text-muted-foreground">
            {status.kind === 'working' && 'Cleaning the page…'}
            {status.kind === 'done' && [
              status.pageFound ? 'Found the page edges and straightened it.' : 'No page edge stood out, so the whole photo was used.',
              Math.abs(status.skewDegrees) >= 0.5 ? ` Levelled the writing by ${Math.abs(status.skewDegrees).toFixed(1)}°.` : '',
            ].join('')}
          </p>
          {status.kind === 'error' && <p role="alert" className="mb-4 text-sm text-danger">{status.message}</p>}

          <div className="grid gap-4 md:grid-cols-2">
            <figure className="overflow-hidden rounded-xl border border-border bg-card">
              {/* eslint-disable-next-line @next/next/no-img-element -- a local blob URL, which next/image cannot optimise */}
              {originalUrl && <img src={originalUrl} alt="The photo as taken" className="max-h-[70vh] w-full object-contain" />}
              <figcaption className="border-t border-border px-3 py-2 text-xs text-muted-foreground">Original</figcaption>
            </figure>
            <figure className="overflow-hidden rounded-xl border border-border bg-card">
              {status.kind === 'done'
                // eslint-disable-next-line @next/next/no-img-element -- a local blob URL, which next/image cannot optimise
                ? <img src={status.cleanedUrl} alt="The cleaned page" className="max-h-[70vh] w-full bg-white object-contain" />
                : <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">{status.kind === 'working' ? 'Cleaning…' : ''}</div>}
              <figcaption className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
                Cleaned{status.kind === 'done' ? `, ${status.width} × ${status.height} px` : ''}
              </figcaption>
            </figure>
          </div>

          {status.kind === 'done' && (
            <a
              href={status.cleanedUrl}
              download={`notes-${today}.png`}
              className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2.5 text-sm font-bold text-accent-foreground transition hover:opacity-90"
            >
              <Download size={15} /> Download PNG
            </a>
          )}
        </>
      )}
    </div>
  );
}
