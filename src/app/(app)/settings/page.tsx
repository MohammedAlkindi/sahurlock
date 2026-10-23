'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Upload, Trash2, Play, RefreshCw,
  CheckCircle2, AlertCircle, ChevronDown, Video,
  Download, Plus,
} from 'lucide-react';
import {
  loadSettings, saveSettings,
  loadCustomVideoMeta, saveCustomVideoMeta, clearCustomVideoMeta, setCustomVideoBlobUrl,
  loadTemplates, saveTemplate, deleteTemplate,
  loadGoals, saveGoals,
  clearAllData,
} from '@/lib/storage';
import { collectExport } from '@/lib/data-management';
import { getVideoBlob, saveVideoBlob, deleteVideoBlob } from '@/lib/video-storage';
import { SessionConfig, CustomVideoMeta, SessionPreset } from '@/lib/types';
import { DEFAULT_CONFIG } from '@/lib/defaults';
import { CUSTOM_PUNISHMENT_MEDIA, DEFAULT_PUNISHMENT_MEDIA } from '@/lib/punishment-media';
import { PUNISHMENT_CLIPS } from '@/components/session-config';
import { uid } from '@/lib/utils';

// ── Constants ──────────────────────────────────────────────────────────────────


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
  { keys: ['Esc'],       action: 'Close the palette or a dialog' },
  { keys: ['↑', '↓'],   action: 'Navigate palette' },
  { keys: ['Enter'],     action: 'Select item' },
];

const SESSION_SHORTCUTS = [
  { keys: ['B'], action: 'Take a break' },
  { keys: ['E'], action: 'End the session' },
  { keys: ['H'], action: 'Hide or show the camera' },
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

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
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
    <div className={`flex items-start justify-between gap-10 py-5 ${last ? '' : 'border-b border-border/20'}`}>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-foreground">{label}</p>
        {description && (
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="shrink-0 pt-0.5">{children}</div>
    </div>
  );
}

function SectionHeading({ title }: { title: string }) {
  return (
    <p className="mb-2 mt-8 text-xs font-medium uppercase tracking-wider text-muted-foreground first:mt-0">
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
        className="flex items-center gap-1 text-xs text-muted-foreground transition hover:text-muted-foreground"
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
  }, []);

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
      update({ punishmentMedia: CUSTOM_PUNISHMENT_MEDIA });
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
    if (config.punishmentMedia === CUSTOM_PUNISHMENT_MEDIA) update({ punishmentMedia: DEFAULT_PUNISHMENT_MEDIA });
  };

  const hasCustom = !!meta && config.punishmentMedia === CUSTOM_PUNISHMENT_MEDIA;

  return (
    <div className="space-y-2.5">
      {!hasCustom && (
        <select
          value={config.punishmentMedia === CUSTOM_PUNISHMENT_MEDIA ? DEFAULT_PUNISHMENT_MEDIA : config.punishmentMedia}
          onChange={(e) => update({ punishmentMedia: e.target.value })}
          className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground focus:border-accent focus:outline-none"
        >
          {PUNISHMENT_CLIPS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      )}

      {meta ? (
        <div className="rounded-md border border-border/40 bg-muted/20 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Video size={12} className="shrink-0 text-muted-foreground" />
              <span className="truncate text-xs text-foreground">{meta.name}</span>
              <span className="shrink-0 text-[10px] text-muted-foreground">{formatFileSize(meta.size)}</span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {previewUrl && (
                <button onClick={() => setShowPreview((v) => !v)} className="text-[11px] text-muted-foreground hover:text-foreground transition">
                  <Play size={10} className="inline mr-0.5" />preview
                </button>
              )}
              <button onClick={() => fileRef.current?.click()} className="text-[11px] text-muted-foreground hover:text-foreground transition">
                <RefreshCw size={10} className="inline mr-0.5" />replace
              </button>
              <button onClick={handleDelete} className="text-[11px] text-muted-foreground hover:text-danger transition">
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
              ? <span className="flex items-center gap-1 text-[10px] text-success"><CheckCircle2 size={9} />Active</span>
              : <button onClick={() => update({ punishmentMedia: CUSTOM_PUNISHMENT_MEDIA })} className="text-[11px] text-foreground underline underline-offset-2 hover:text-foreground transition">Use this video</button>
            }
            {hasCustom && (
              <button onClick={() => update({ punishmentMedia: DEFAULT_PUNISHMENT_MEDIA })} className="text-[11px] text-muted-foreground hover:text-foreground transition">
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

      {uploadStatus === 'success' && <p className="flex items-center gap-1 text-[11px] text-success"><CheckCircle2 size={9} />Saved</p>}
      {(uploadStatus === 'error' || errorMsg) && <p className="flex items-center gap-1 text-[11px] text-danger"><AlertCircle size={9} />{errorMsg || 'Error'}</p>}
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
        <Toggle label="Pomodoro mode" checked={config.pomodoroEnabled} onChange={(v) => update({ pomodoroEnabled: v })} />
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
            className="w-14 rounded-md border border-input bg-background px-2 py-1 text-center text-sm text-foreground focus:border-accent focus:outline-none"
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
        <Toggle label="Punishment clip" checked={config.punishmentEnabled} onChange={(v) => update({ punishmentEnabled: v })} />
      </Row>

      {config.punishmentEnabled && (
        <div className="py-4">
          <p className="mb-3 text-xs text-muted-foreground">Choose which clip plays on violation.</p>
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
        <Toggle label="Phone detection" checked={config.phoneDetectionEnabled} onChange={(v) => update({ phoneDetectionEnabled: v })} />
      </Row>
      <Row
        label="Tab switch violation"
        description="Triggers a violation when you leave the tab."
        last
      >
        <Toggle label="Tab switch violation" checked={!!config.tabSwitchViolationEnabled} onChange={(v) => update({ tabSwitchViolationEnabled: v })} />
      </Row>
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
      <p className="mb-6 text-sm text-muted-foreground leading-relaxed">
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
              <p className="mt-0.5 text-sm text-muted-foreground">{t.description}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => update(t.config)}
                className="rounded-md border border-border/50 px-4 py-1.5 text-sm text-foreground transition hover:bg-muted/40 hover:text-foreground"
              >
                Apply
              </button>
              {!t.id.startsWith('builtin_') && (
                <button
                  onClick={() => handleDelete(t.id)}
                  className="text-muted-foreground transition hover:text-danger"
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
              className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground placeholder-muted-foreground focus:border-accent focus:outline-none"
            />
            <button onClick={handleSave} className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition hover:opacity-80">
              Save
            </button>
            <button onClick={() => setSaving(false)} className="text-xs text-muted-foreground hover:text-foreground transition">
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setSaving(true)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground transition hover:text-foreground"
          >
            <Plus size={12} />Save current config as template
          </button>
        )}
      </div>
    </>
  );
}

// ── Panel: Shortcuts ───────────────────────────────────────────────────────────

function ShortcutList({ items }: { items: { keys: string[]; action: string }[] }) {
  return (
    <div className="space-y-px">
      {items.map(({ keys, action }, i) => (
        <div
          key={action}
          className={`flex items-center justify-between py-3 ${i < items.length - 1 ? 'border-b border-border/20' : ''}`}
        >
          <span className="text-sm text-foreground">{action}</span>
          <div className="flex items-center gap-1">
            {keys.map((k) => (
              <kbd
                key={k}
                className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground border border-border/40"
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

function ShortcutsPanel({ config, update }: { config: SessionConfig; update: (p: Partial<SessionConfig>) => void }) {
  const sessionKeysOn = config.keyboardShortcutsEnabled !== false;
  return (
    <>
      <ShortcutList items={SHORTCUTS} />
      <SectionHeading title="Session" />
      <Row
        label="Single-key shortcuts"
        description="B, E and H work during a session. Turn off if they clash with a screen reader or other key commands."
        last={!sessionKeysOn}
      >
        <Toggle label="Single-key shortcuts" checked={sessionKeysOn} onChange={(v) => update({ keyboardShortcutsEnabled: v })} />
      </Row>
      {sessionKeysOn && <ShortcutList items={SESSION_SHORTCUTS} />}
    </>
  );
}

// ── Panel: Data ────────────────────────────────────────────────────────────────

function DataPanel() {
  const [confirming, setConfirming] = useState(false);

  const handleExport = () => {
    const data = collectExport(localStorage, new Date());
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
        description="Sessions, stats, tasks, notes, flashcards, templates, goals, schedules and settings as a JSON file. Spotify sign-in is not included."
        last
      >
        <button
          onClick={handleExport}
          className="flex items-center gap-1.5 rounded-md border border-border/60 px-4 py-2 text-sm text-foreground transition hover:bg-muted/40 hover:text-foreground"
        >
          <Download size={13} />Export
        </button>
      </Row>

      <SectionHeading title="Danger zone" />
      {confirming ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-danger/30 bg-danger/10 px-4 py-3">
          <p className="text-xs text-danger">
            This permanently deletes everything SahurLock keeps in this browser, including notes, flashcards, the uploaded video and the Spotify connection.
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={async () => { await clearAllData(); window.location.reload(); }}
              className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-red-700"
            >
              Clear everything
            </button>
            <button onClick={() => setConfirming(false)} className="text-xs text-muted-foreground hover:text-foreground transition">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <Row label="Clear all data" description="Permanently remove everything SahurLock keeps in this browser." last>
          <button
            onClick={() => setConfirming(true)}
            className="rounded-md border border-border/60 px-4 py-2 text-sm text-muted-foreground transition hover:border-danger/30 hover:text-danger"
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
  const [config,  setConfig]  = useState<SessionConfig>(DEFAULT_CONFIG);
  const [goals,   setGoals]   = useState({ dailyGoalMinutes: 0 });
  const [active,  setActive]  = useState<CatId>('focus');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setConfig(loadSettings(DEFAULT_CONFIG));
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
    <div className="mx-auto max-w-4xl px-8 py-10">

      {/* Page title */}
      <h1 className="mb-10 text-xl font-semibold text-foreground">Settings</h1>

      <div className="flex gap-16">

        {/* ── Sidebar ─────────────────────────────────────────── */}
        <nav className="hidden w-48 shrink-0 md:block">
          <div className="space-y-0.5">
            {CATS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setActive(id)}
                className={`block w-full rounded-md px-3 py-2 text-left text-sm transition ${
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
        <div className="md:hidden -mx-8 mb-6 flex overflow-x-auto border-b border-border/30 px-8">
          {CATS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActive(id)}
              className={`shrink-0 border-b-2 pb-3 pr-6 text-sm transition ${
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
          <h2 className="mb-6 text-base font-semibold text-foreground">{activeLabel}</h2>

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
          {active === 'shortcuts' && <ShortcutsPanel config={config} update={update} />}
          {active === 'data'      && <DataPanel />}

        </div>
      </div>
    </div>
  );
}
