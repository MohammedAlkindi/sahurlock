'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Upload, Trash2, Play, RefreshCw,
  CheckCircle2, AlertCircle, ChevronDown, Eye, Video,
} from 'lucide-react';
import {
  loadSettings, saveSettings,
  loadCustomVideoMeta, saveCustomVideoMeta, clearCustomVideoMeta, setCustomVideoBlobUrl,
} from '@/lib/storage';
import { getVideoBlob, saveVideoBlob, deleteVideoBlob } from '@/lib/video-storage';
import { SessionConfig, CustomVideoMeta } from '@/lib/types';
import { PUNISHMENT_CLIPS } from '@/components/session-config';

const DEFAULTS: SessionConfig = {
  durationMinutes: 25,
  offscreenThresholdSec: 6,
  breakLimit: 3,
  breakDurationSec: 300,
  punishmentEnabled: false,
  punishmentMedia: '/media/sahur.mp4',
  pomodoroEnabled: false,
  phoneDetectionEnabled: false,
  advancedEyeTrackingEnabled: false,
  tabSwitchViolationEnabled: false,
};

const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
const ALLOWED_TYPES   = ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'];

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Primitives ─────────────────────────────────────────────────────────────────

function PillToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
        checked ? 'bg-accent' : 'bg-border'
      }`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${checked ? 'translate-x-4' : 'translate-x-0'}`} />
    </button>
  );
}

function Row({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground leading-none">{label}</p>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function CompactRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <p className="text-xs font-medium text-foreground">{label}</p>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function SectionLabel({ title }: { title: string }) {
  return (
    <p className="pt-4 pb-0.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 first:pt-0">
      {title}
    </p>
  );
}

function Disclosure({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-border/50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        <span>{label}</span>
        <ChevronDown size={12} className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="pb-3">{children}</div>}
    </div>
  );
}

// ── Punishment media panel ─────────────────────────────────────────────────────

type UploadStatus = 'idle' | 'uploading' | 'success' | 'error';

function PunishmentMediaPanel({
  config,
  update,
}: {
  config: SessionConfig;
  update: (patch: Partial<SessionConfig>) => void;
}) {
  const [meta,         setMeta]         = useState<CustomVideoMeta | null>(null);
  const [previewUrl,   setPreviewUrl]   = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>('idle');
  const [errorMsg,     setErrorMsg]     = useState('');
  const [showPreview,  setShowPreview]  = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const m = loadCustomVideoMeta();
    setMeta(m);
    if (m) {
      getVideoBlob(m.id).then((blob) => {
        if (blob) {
          const url = URL.createObjectURL(blob);
          setPreviewUrl(url);
          setCustomVideoBlobUrl(url);
        }
      }).catch(() => {});
    }
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFile = async (file: File) => {
    setErrorMsg('');
    if (!ALLOWED_TYPES.includes(file.type)) { setErrorMsg('Use MP4, WebM, OGG, or MOV.'); return; }
    if (file.size > MAX_VIDEO_BYTES) { setErrorMsg(`Max ${formatFileSize(MAX_VIDEO_BYTES)}.`); return; }
    setUploadStatus('uploading');
    try {
      if (meta) { await deleteVideoBlob(meta.id); if (previewUrl) URL.revokeObjectURL(previewUrl); }
      const id = `custom_${Date.now()}`;
      await saveVideoBlob(id, file.slice(0, file.size, file.type));
      const newMeta: CustomVideoMeta = { id, name: file.name, size: file.size, type: file.type, addedAt: new Date().toISOString() };
      saveCustomVideoMeta(newMeta);
      setMeta(newMeta);
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
      setCustomVideoBlobUrl(url);
      update({ punishmentMedia: 'custom' });
      setUploadStatus('success');
      setTimeout(() => setUploadStatus('idle'), 2500);
    } catch {
      setUploadStatus('error');
      setErrorMsg('Failed to save. Try again.');
    }
  };

  const handleDelete = async () => {
    if (!meta) return;
    try { await deleteVideoBlob(meta.id); } catch {}
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    clearCustomVideoMeta();
    setCustomVideoBlobUrl(null);
    setMeta(null); setPreviewUrl(null); setShowPreview(false);
    if (config.punishmentMedia === 'custom') update({ punishmentMedia: '/media/sahur.mp4' });
  };

  const hasCustom = !!meta && config.punishmentMedia === 'custom';

  return (
    <div className="space-y-2">
      {!hasCustom && (
        <select
          value={config.punishmentMedia === 'custom' ? '/media/sahur.mp4' : config.punishmentMedia}
          onChange={(e) => update({ punishmentMedia: e.target.value })}
          className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:border-accent focus:outline-none"
        >
          {PUNISHMENT_CLIPS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      )}

      {meta ? (
        <div className="rounded-lg border border-border bg-muted/20 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Video size={12} className="shrink-0 text-muted-foreground" />
              <span className="truncate text-xs text-foreground">{meta.name}</span>
              <span className="shrink-0 text-[10px] text-muted-foreground/50">{formatFileSize(meta.size)}</span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {previewUrl && (
                <button onClick={() => setShowPreview((v) => !v)} className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground transition">
                  <Play size={9} className="inline mr-0.5" />preview
                </button>
              )}
              <button onClick={() => fileInputRef.current?.click()} className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground transition">
                <RefreshCw size={9} className="inline mr-0.5" />replace
              </button>
              <button onClick={handleDelete} className="rounded px-1 py-0.5 text-[10px] text-red-500 hover:text-red-600 transition">
                <Trash2 size={9} />
              </button>
            </div>
          </div>
          {showPreview && previewUrl && (
            <div className="mt-2 overflow-hidden rounded border border-border">
              <video src={previewUrl} controls className="w-full max-h-28 bg-black" />
            </div>
          )}
          <div className="mt-1.5 flex items-center justify-between">
            {hasCustom
              ? <><span className="flex items-center gap-1 text-[10px] text-green-600"><CheckCircle2 size={9} />Active</span>
                  <button onClick={() => update({ punishmentMedia: '/media/sahur.mp4' })} className="text-[10px] text-muted-foreground hover:text-foreground transition">Use built-in</button></>
              : <button onClick={() => update({ punishmentMedia: 'custom' })} className="text-[10px] font-medium text-accent hover:underline">Use this video</button>
            }
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadStatus === 'uploading'}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/10 py-2.5 text-xs text-muted-foreground transition hover:border-accent/40 hover:text-foreground disabled:opacity-50"
        >
          {uploadStatus === 'uploading'
            ? <><div className="h-3 w-3 animate-spin rounded-full border border-accent border-t-transparent" />Saving…</>
            : <><Upload size={12} />Upload custom video — MP4 · WebM · up to 200 MB</>
          }
        </button>
      )}

      {uploadStatus === 'success' && <p className="flex items-center gap-1 text-[10px] text-green-600"><CheckCircle2 size={9} />Saved</p>}
      {(uploadStatus === 'error' || errorMsg) && <p className="flex items-center gap-1 text-[10px] text-red-600"><AlertCircle size={9} />{errorMsg || 'Error'}</p>}

      <input ref={fileInputRef} type="file" accept="video/mp4,video/webm,video/ogg,video/quicktime" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />
    </div>
  );
}

// ── Advanced section — collapsed by default ────────────────────────────────────

function AdvancedSection({
  config,
  update,
}: {
  config: SessionConfig;
  update: (patch: Partial<SessionConfig>) => void;
}) {
  const [open, setOpen] = useState(false);

  const activeCount = [
    config.tabSwitchViolationEnabled,
    config.advancedEyeTrackingEnabled,
  ].filter(Boolean).length;

  return (
    <div className="mt-2">
      {/* Trigger row */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-xl border border-border/60 bg-muted/10 px-3.5 py-2.5 text-xs font-medium text-muted-foreground transition hover:bg-muted/20 hover:text-foreground"
      >
        <span>Advanced settings</span>
        <div className="flex items-center gap-2">
          {activeCount > 0 && (
            <span className="rounded-full bg-accent/15 px-1.5 py-px text-[10px] font-semibold text-accent">
              {activeCount} on
            </span>
          )}
          <ChevronDown size={12} className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {/* Expanded panel */}
      {open && (
        <div className="mt-1 rounded-xl border border-border/60 bg-card px-4 pb-2">

          {/* Detection group */}
          <p className="pt-3 pb-px text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/40">
            Detection
          </p>
          <div className="divide-y divide-border/40">
            <CompactRow label="Tab switch violation">
              <PillToggle
                checked={!!config.tabSwitchViolationEnabled}
                onChange={(v) => update({ tabSwitchViolationEnabled: v })}
              />
            </CompactRow>

            <CompactRow label="Iris gaze tracking">
              <PillToggle
                checked={!!config.advancedEyeTrackingEnabled}
                onChange={(v) => update({ advancedEyeTrackingEnabled: v })}
              />
            </CompactRow>

            {config.advancedEyeTrackingEnabled && (
              <Disclosure label="About iris tracking">
                <div className="space-y-2 text-[11px] text-muted-foreground leading-relaxed">
                  <p>Reads iris position on every frame — you can fail even if your face is forward but your eyes drift off screen. More sensitive than head-pose-only tracking.</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    <div className="rounded-lg border border-border bg-background p-2">
                      <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground/50 mb-1">Standard</p>
                      <div className="space-y-0.5 text-[10px]">
                        <div className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-green-500 shrink-0" />Face detected</div>
                        <div className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-border shrink-0" />Eyes ignored</div>
                      </div>
                    </div>
                    <div className="rounded-lg border border-accent/30 bg-background p-2">
                      <p className="text-[9px] font-semibold uppercase tracking-wide text-accent/60 mb-1">Advanced</p>
                      <div className="space-y-0.5 text-[10px]">
                        <div className="flex items-center gap-1.5"><Eye size={8} className="text-accent shrink-0" />Face detected</div>
                        <div className="flex items-center gap-1.5"><Eye size={8} className="text-accent shrink-0" />Eyes on screen</div>
                      </div>
                    </div>
                  </div>
                </div>
              </Disclosure>
            )}
          </div>

        </div>
      )}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [config,  setConfig]  = useState<SessionConfig>(DEFAULTS);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setConfig(loadSettings(DEFAULTS));
    setMounted(true);
  }, []);

  const update = (patch: Partial<SessionConfig>) => {
    const next = { ...config, ...patch };
    setConfig(next);
    saveSettings(next);
  };

  if (!mounted) return null;

  return (
    <div className="mx-auto max-w-md px-4 py-7">
      <div className="mb-5">
        <h1 className="text-xl font-black tracking-tight">Settings</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">Global defaults for every session.</p>
      </div>

      {/* ── Core settings ─────────────────────────────────── */}
      <div className="rounded-2xl border border-border bg-card px-4">

        <SectionLabel title="Focus" />
        <div className="divide-y divide-border/50">
          <Row label="Pomodoro" description="Auto-breaks at interval end.">
            <PillToggle checked={config.pomodoroEnabled} onChange={(v) => update({ pomodoroEnabled: v })} />
          </Row>
        </div>

        <SectionLabel title="Enforcement" />
        <div className="divide-y divide-border/50">
          <Row label="Punishment clip" description="Plays a clip on violation.">
            <PillToggle checked={config.punishmentEnabled} onChange={(v) => update({ punishmentEnabled: v })} />
          </Row>
          {config.punishmentEnabled && (
            <Disclosure label="Configure media">
              <PunishmentMediaPanel config={config} update={update} />
            </Disclosure>
          )}
        </div>

        <SectionLabel title="Detection" />
        <div className="divide-y divide-border/50 pb-1">
          <Row label="Phone detection" description="Flags hand-to-face posture.">
            <PillToggle checked={config.phoneDetectionEnabled} onChange={(v) => update({ phoneDetectionEnabled: v })} />
          </Row>
        </div>

      </div>

      {/* ── Advanced — separate, collapsed ────────────────── */}
      <AdvancedSection config={config} update={update} />

      <p className="mt-3 text-center text-[10px] text-muted-foreground/40">
        Changes save instantly.
      </p>
    </div>
  );
}
