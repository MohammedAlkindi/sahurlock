'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Upload, Trash2, Play, RefreshCw,
  CheckCircle2, AlertCircle, ChevronDown, Eye, Video,
  Download, Plus,
} from 'lucide-react';
import {
  loadSettings, saveSettings,
  loadCustomVideoMeta, saveCustomVideoMeta, clearCustomVideoMeta, setCustomVideoBlobUrl,
  loadTemplates, saveTemplate, deleteTemplate,
  loadGoals, saveGoals,
  loadHistory, loadAggregate, loadTasks,
  clearAllData,
} from '@/lib/storage';
import { getVideoBlob, saveVideoBlob, deleteVideoBlob } from '@/lib/video-storage';
import { SessionConfig, CustomVideoMeta, SessionPreset } from '@/lib/types';
import { PUNISHMENT_CLIPS } from '@/components/session-config';
import { uid } from '@/lib/utils';

// ── Constants ──────────────────────────────────────────────────────────────────

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

const BUILTIN_TEMPLATES: SessionPreset[] = [
  {
    id: 'builtin_deep',
    name: 'Deep Work',
    description: '90 min · no breaks · strict',
    config: { durationMinutes: 90, breakLimit: 0, offscreenThresholdSec: 4, tabSwitchViolationEnabled: true },
  },
  {
    id: 'builtin_pomodoro',
    name: 'Pomodoro',
    description: '25 min · 3 breaks · 5 min each',
    config: { durationMinutes: 25, breakLimit: 3, breakDurationSec: 300, pomodoroEnabled: true },
  },
  {
    id: 'builtin_light',
    name: 'Light Focus',
    description: '45 min · relaxed threshold',
    config: { durationMinutes: 45, breakLimit: 5, offscreenThresholdSec: 10 },
  },
];

const SHORTCUTS = [
  { keys: ['Ctrl', 'K'], action: 'Open command palette' },
  { keys: ['Esc'],       action: 'Close palette / dialogs' },
  { keys: ['↑', '↓'],   action: 'Navigate palette' },
  { keys: ['Enter'],     action: 'Select item' },
  { keys: ['Space'],     action: 'Reveal flashcard answer' },
];

const CATS = [
  { id: 'focus',       label: 'Focus' },
  { id: 'enforcement', label: 'Enforcement' },
  { id: 'detection',   label: 'Detection' },
  { id: 'templates',   label: 'Templates' },
  { id: 'shortcuts',   label: 'Shortcuts' },
  { id: 'data',        label: 'Data' },
] as const;

type CatId = (typeof CATS)[number]['id'];

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Design primitives ──────────────────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-150 focus:outline-none ${
        checked ? 'bg-foreground' : 'bg-border'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full shadow transition duration-150 ${
          checked ? 'translate-x-4 bg-background' : 'translate-x-0 bg-white'
        }`}
      />
    </button>
  );
}

function Row({
  label,
  description,
  last,
  children,
}: {
  label: string;
  description?: string;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`flex items-start justify-between gap-8 py-4 ${last ? '' : 'border-b border-border/20'}`}>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-foreground">{label}</p>
        {description && (
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground/70">{description}</p>
        )}
      </div>
      <div className="shrink-0 pt-0.5">{children}</div>
    </div>
  );
}

function SectionHeading({ title }: { title: string }) {
  return (
    <p className="mb-1 mt-7 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/50 first:mt-0">
      {title}
    </p>
  );
}

function InlineDisclosure({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs text-muted-foreground/60 transition hover:text-muted-foreground"
      >
        <ChevronDown size={11} className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
        {label}
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}

// ── Punishment media picker ────────────────────────────────────────────────────

type UploadStatus = 'idle' | 'uploading' | 'success' | 'error';

function PunishmentMediaPicker({
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
  const fileRef    = useRef<HTMLInputElement>(null);
  const previewRef = useRef<string | null>(null);

  const setUrl = (url: string | null) => { previewRef.current = url; setPreviewUrl(url); };

  useEffect(() => {
    const m = loadCustomVideoMeta();
    setMeta(m);
    if (m) {
      getVideoBlob(m.id).then((blob) => {
        if (blob) { const u = URL.createObjectURL(blob); setUrl(u); setCustomVideoBlobUrl(u); }
      }).catch(() => {});
    }
    return () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFile = async (file: File) => {
    setErrorMsg('');
    if (!ALLOWED_TYPES.includes(file.type)) { setErrorMsg('Use MP4, WebM, OGG, or MOV.'); return; }
    if (file.size > MAX_VIDEO_BYTES) { setErrorMsg(`Max ${formatFileSize(MAX_VIDEO_BYTES)}.`); return; }
    setUploadStatus('uploading');
    try {
      if (meta) { await deleteVideoBlob(meta.id); if (previewRef.current) { URL.revokeObjectURL(previewRef.current); previewRef.current = null; } }
      const id = `custom_${Date.now()}`;
      await saveVideoBlob(id, file.slice(0, file.size, file.type));
      const newMeta: CustomVideoMeta = { id, name: file.name, size: file.size, type: file.type, addedAt: new Date().toISOString() };
      saveCustomVideoMeta(newMeta);
      setMeta(newMeta);
      const u = URL.createObjectURL(file);
      setUrl(u); setCustomVideoBlobUrl(u);
      update({ punishmentMedia: 'custom' });
      setUploadStatus('success');
      setTimeout(() => setUploadStatus('idle'), 2000);
    } catch { setUploadStatus('error'); setErrorMsg('Failed to save.'); }
  };

  const handleDelete = async () => {
    if (!meta) return;
    try { await deleteVideoBlob(meta.id); } catch {}
    if (previewRef.current) { URL.revokeObjectURL(previewRef.current); previewRef.current = null; }
    clearCustomVideoMeta(); setCustomVideoBlobUrl(null);
    setMeta(null); setUrl(null); setShowPreview(false);
    if (config.punishmentMedia === 'custom') update({ punishmentMedia: '/media/sahur.mp4' });
  };

  const hasCustom = !!meta && config.punishmentMedia === 'custom';

  return (
    <div className="space-y-2.5">
      {!hasCustom && (
        <select
          value={config.punishmentMedia === 'custom' ? '/media/sahur.mp4' : config.punishmentMedia}
          onChange={(e) => update({ punishmentMedia: e.target.value })}
          className="w-full rounded-md border border-border/60 bg-background px-3 py-1.5 text-sm text-foreground focus:border-foreground/40 focus:outline-none"
        >
          {PUNISHMENT_CLIPS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      )}

      {meta ? (
        <div className="rounded-md border border-border/40 bg-muted/20 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Video size={12} className="shrink-0 text-muted-foreground/60" />
              <span className="truncate text-xs text-foreground">{meta.name}</span>
              <span className="shrink-0 text-[10px] text-muted-foreground/40">{formatFileSize(meta.size)}</span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {previewUrl && (
                <button onClick={() => setShowPreview((v) => !v)} className="text-[11px] text-muted-foreground/60 hover:text-foreground transition">
                  <Play size={10} className="inline mr-0.5" />preview
                </button>
              )}
              <button onClick={() => fileRef.current?.click()} className="text-[11px] text-muted-foreground/60 hover:text-foreground transition">
                <RefreshCw size={10} className="inline mr-0.5" />replace
              </button>
              <button onClick={handleDelete} className="text-[11px] text-muted-foreground/40 hover:text-red-500 transition">
                <Trash2 size={10} />
              </button>
            </div>
          </div>
          {showPreview && previewUrl && (
            <div className="mt-2 overflow-hidden rounded border border-border/30">
              <video src={previewUrl} controls className="w-full max-h-28 bg-black" />
            </div>
          )}
          <div className="mt-2 flex items-center justify-between">
            {hasCustom
              ? <span className="flex items-center gap-1 text-[10px] text-green-600 dark:text-green-500"><CheckCircle2 size={9} />Active</span>
              : <button onClick={() => update({ punishmentMedia: 'custom' })} className="text-[11px] text-foreground/70 underline underline-offset-2 hover:text-foreground transition">Use this video</button>
            }
            {hasCustom && (
              <button onClick={() => update({ punishmentMedia: '/media/sahur.mp4' })} className="text-[11px] text-muted-foreground/60 hover:text-foreground transition">
                Switch to built-in
              </button>
            )}
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploadStatus === 'uploading'}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-border/50 bg-muted/10 py-2.5 text-xs text-muted-foreground transition hover:border-foreground/20 hover:text-foreground disabled:opacity-50"
        >
          {uploadStatus === 'uploading'
            ? <><div className="h-3 w-3 animate-spin rounded-full border border-foreground/40 border-t-transparent" />Saving…</>
            : <><Upload size={12} />Upload custom video — MP4 · WebM · up to 200 MB</>}
        </button>
      )}

      {uploadStatus === 'success' && <p className="flex items-center gap-1 text-[11px] text-green-600"><CheckCircle2 size={9} />Saved</p>}
      {(uploadStatus === 'error' || errorMsg) && <p className="flex items-center gap-1 text-[11px] text-red-500"><AlertCircle size={9} />{errorMsg || 'Error'}</p>}
      <input ref={fileRef} type="file" accept="video/mp4,video/webm,video/ogg,video/quicktime" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />
    </div>
  );
}

// ── Panel: Focus ───────────────────────────────────────────────────────────────

function FocusPanel({
  config, update, goals, updateGoal,
}: {
  config: SessionConfig;
  update: (p: Partial<SessionConfig>) => void;
  goals: { dailyGoalMinutes: number };
  updateGoal: (m: number) => void;
}) {
  return (
    <>
      <Row label="Pomodoro mode" description="Enforces structured work-break intervals automatically.">
        <Toggle checked={config.pomodoroEnabled} onChange={(v) => update({ pomodoroEnabled: v })} />
      </Row>
      <Row label="Daily goal" description="Target focus minutes per day. Tracked in your stats." last>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            max={480}
            value={goals.dailyGoalMinutes || ''}
            onChange={(e) => updateGoal(Math.max(0, Math.min(480, Number(e.target.value) || 0)))}
            placeholder="—"
            className="w-14 rounded-md border border-border/60 bg-background px-2 py-1 text-center text-sm text-foreground focus:border-foreground/40 focus:outline-none"
          />
          <span className="text-xs text-muted-foreground">min</span>
        </div>
      </Row>
    </>
  );
}

// ── Panel: Enforcement ─────────────────────────────────────────────────────────

function EnforcementPanel({
  config, update,
}: {
  config: SessionConfig;
  update: (p: Partial<SessionConfig>) => void;
}) {
  return (
    <>
      <Row
        label="Punishment clip"
        description="Plays a video clip when a violation is detected."
        last={!config.punishmentEnabled}
      >
        <Toggle checked={config.punishmentEnabled} onChange={(v) => update({ punishmentEnabled: v })} />
      </Row>

      {config.punishmentEnabled && (
        <div className="py-4">
          <p className="mb-3 text-xs text-muted-foreground/60">Choose which clip plays on violation.</p>
          <PunishmentMediaPicker config={config} update={update} />
        </div>
      )}
    </>
  );
}

// ── Panel: Detection ───────────────────────────────────────────────────────────

function DetectionPanel({
  config, update,
}: {
  config: SessionConfig;
  update: (p: Partial<SessionConfig>) => void;
}) {
  return (
    <>
      <Row
        label="Phone detection"
        description="Flags hand-to-face posture as a distraction."
      >
        <Toggle checked={config.phoneDetectionEnabled} onChange={(v) => update({ phoneDetectionEnabled: v })} />
      </Row>
      <Row
        label="Tab switch violation"
        description="Triggers a violation when you leave the tab."
      >
        <Toggle checked={!!config.tabSwitchViolationEnabled} onChange={(v) => update({ tabSwitchViolationEnabled: v })} />
      </Row>
      <Row
        label="Iris gaze tracking"
        description="Monitors eye direction, not just face position. More sensitive."
        last
      >
        <Toggle checked={!!config.advancedEyeTrackingEnabled} onChange={(v) => update({ advancedEyeTrackingEnabled: v })} />
      </Row>

      {config.advancedEyeTrackingEnabled && (
        <div className="pb-4">
          <InlineDisclosure label="How iris tracking works">
            <div className="space-y-3 text-xs text-muted-foreground/70 leading-relaxed">
              <p>
                Standard mode passes as long as your face is detected. Iris mode also checks
                that your eyes are directed at the screen — you can fail even with your head
                forward if your gaze drifts.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md border border-border/30 bg-muted/20 p-3">
                  <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/40">Standard</p>
                  <p className="text-[11px]">Face present → pass</p>
                  <p className="text-[11px] text-muted-foreground/40">Eyes not checked</p>
                </div>
                <div className="rounded-md border border-border/30 bg-muted/20 p-3">
                  <p className="mb-1.5 flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/40">
                    <Eye size={9} />Iris
                  </p>
                  <p className="text-[11px]">Face present → pass</p>
                  <p className="text-[11px]">Eyes on screen → pass</p>
                </div>
              </div>
            </div>
          </InlineDisclosure>
        </div>
      )}
    </>
  );
}

// ── Panel: Templates ───────────────────────────────────────────────────────────

function TemplatesPanel({
  config, update,
}: {
  config: SessionConfig;
  update: (p: Partial<SessionConfig>) => void;
}) {
  const [custom,  setCustom]  = useState<SessionPreset[]>([]);
  const [saving,  setSaving]  = useState(false);
  const [newName, setNewName] = useState('');

  useEffect(() => { setCustom(loadTemplates()); }, []);

  const handleSave = () => {
    if (!newName.trim()) return;
    const preset: SessionPreset = {
      id: uid(),
      name: newName.trim(),
      description: `${config.durationMinutes} min · ${config.breakLimit} breaks`,
      config: { ...config },
    };
    saveTemplate(preset);
    setCustom(loadTemplates());
    setNewName(''); setSaving(false);
  };

  const handleDelete = (id: string) => {
    deleteTemplate(id);
    setCustom(loadTemplates());
  };

  const allTemplates = [...BUILTIN_TEMPLATES, ...custom];

  return (
    <>
      <p className="mb-5 text-xs text-muted-foreground/60 leading-relaxed">
        Apply a preset to overwrite the current session config. Built-in presets cannot be deleted.
      </p>

      <div className="space-y-px">
        {allTemplates.map((t, i) => (
          <div
            key={t.id}
            className={`flex items-center justify-between gap-4 py-3 ${
              i < allTemplates.length - 1 ? 'border-b border-border/20' : ''
            }`}
          >
            <div className="min-w-0">
              <p className="text-sm text-foreground">{t.name}</p>
              <p className="text-xs text-muted-foreground/60">{t.description}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => update(t.config)}
                className="rounded-md border border-border/50 px-3 py-1 text-xs text-foreground/80 transition hover:bg-muted/40 hover:text-foreground"
              >
                Apply
              </button>
              {!t.id.startsWith('builtin_') && (
                <button
                  onClick={() => handleDelete(t.id)}
                  className="text-muted-foreground/30 transition hover:text-red-500"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 border-t border-border/20 pt-5">
        {saving ? (
          <div className="flex items-center gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setSaving(false); }}
              placeholder="Template name…"
              autoFocus
              className="flex-1 rounded-md border border-border/60 bg-background px-3 py-1.5 text-sm text-foreground placeholder-muted-foreground/40 focus:border-foreground/40 focus:outline-none"
            />
            <button onClick={handleSave} className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition hover:opacity-80">
              Save
            </button>
            <button onClick={() => setSaving(false)} className="text-xs text-muted-foreground/60 hover:text-foreground transition">
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setSaving(true)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground/60 transition hover:text-foreground"
          >
            <Plus size={12} />Save current config as template
          </button>
        )}
      </div>
    </>
  );
}

// ── Panel: Shortcuts ───────────────────────────────────────────────────────────

function ShortcutsPanel() {
  return (
    <div className="space-y-px">
      {SHORTCUTS.map(({ keys, action }, i) => (
        <div
          key={action}
          className={`flex items-center justify-between py-3 ${i < SHORTCUTS.length - 1 ? 'border-b border-border/20' : ''}`}
        >
          <span className="text-sm text-foreground">{action}</span>
          <div className="flex items-center gap-1">
            {keys.map((k) => (
              <kbd
                key={k}
                className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground/80 border border-border/40"
              >
                {k}
              </kbd>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Panel: Data ────────────────────────────────────────────────────────────────

function DataPanel() {
  const [confirming, setConfirming] = useState(false);

  const handleExport = () => {
    const data = {
      exportedAt: new Date().toISOString(),
      aggregate: loadAggregate(),
      sessions: loadHistory(),
      tasks: loadTasks(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sahurlock-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <SectionHeading title="Export" />
      <Row
        label="Download data"
        description="All sessions, stats, and tasks as a JSON file."
        last
      >
        <button
          onClick={handleExport}
          className="flex items-center gap-1.5 rounded-md border border-border/60 px-3 py-1.5 text-xs text-foreground/80 transition hover:bg-muted/40 hover:text-foreground"
        >
          <Download size={12} />Export
        </button>
      </Row>

      <SectionHeading title="Danger zone" />
      {confirming ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-red-200/60 bg-red-50/40 px-4 py-3 dark:border-red-900/30 dark:bg-red-950/20">
          <p className="text-xs text-red-700 dark:text-red-400">
            This permanently deletes all sessions, stats, and settings.
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => { clearAllData(); setConfirming(false); }}
              className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-red-500"
            >
              Clear everything
            </button>
            <button onClick={() => setConfirming(false)} className="text-xs text-muted-foreground/60 hover:text-foreground transition">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <Row label="Clear all data" description="Permanently remove all sessions, stats, and settings." last>
          <button
            onClick={() => setConfirming(true)}
            className="rounded-md border border-border/60 px-3 py-1.5 text-xs text-muted-foreground transition hover:border-red-200 hover:text-red-600"
          >
            Clear
          </button>
        </Row>
      )}
    </>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [config,  setConfig]  = useState<SessionConfig>(DEFAULTS);
  const [goals,   setGoals]   = useState({ dailyGoalMinutes: 0 });
  const [active,  setActive]  = useState<CatId>('focus');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setConfig(loadSettings(DEFAULTS));
    setGoals(loadGoals());
    setMounted(true);
  }, []);

  const update = (patch: Partial<SessionConfig>) => {
    const next = { ...config, ...patch };
    setConfig(next);
    saveSettings(next);
  };

  const updateGoal = (dailyGoalMinutes: number) => {
    const next = { dailyGoalMinutes };
    setGoals(next);
    saveGoals(next);
  };

  if (!mounted) return null;

  const activeLabel = CATS.find((c) => c.id === active)?.label ?? '';

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">

      {/* Page title */}
      <h1 className="mb-8 text-base font-semibold text-foreground">Settings</h1>

      <div className="flex gap-10">

        {/* ── Sidebar ─────────────────────────────────────────── */}
        <nav className="hidden w-36 shrink-0 md:block">
          <div className="space-y-0.5">
            {CATS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setActive(id)}
                className={`block w-full rounded-md px-3 py-1.5 text-left text-sm transition ${
                  active === id
                    ? 'bg-muted/70 text-foreground font-medium'
                    : 'text-muted-foreground hover:bg-muted/30 hover:text-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </nav>

        {/* ── Mobile tab strip ────────────────────────────────── */}
        <div className="md:hidden -mx-6 mb-6 flex overflow-x-auto border-b border-border/30 px-6">
          {CATS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActive(id)}
              className={`shrink-0 border-b-2 pb-2.5 pr-5 text-sm transition ${
                active === id
                  ? 'border-foreground font-medium text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── Right panel ─────────────────────────────────────── */}
        <div className="flex-1 min-w-0">

          {/* Panel heading */}
          <h2 className="mb-5 text-sm font-medium text-foreground">{activeLabel}</h2>

          {/* Panel body */}
          {active === 'focus' && (
            <FocusPanel config={config} update={update} goals={goals} updateGoal={updateGoal} />
          )}
          {active === 'enforcement' && (
            <EnforcementPanel config={config} update={update} />
          )}
          {active === 'detection' && (
            <DetectionPanel config={config} update={update} />
          )}
          {active === 'templates' && (
            <TemplatesPanel config={config} update={update} />
          )}
          {active === 'shortcuts' && <ShortcutsPanel />}
          {active === 'data'      && <DataPanel />}

        </div>
      </div>
    </div>
  );
}
