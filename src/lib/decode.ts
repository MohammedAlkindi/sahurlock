import type {
  AggregateStats, CustomVideoMeta, Goals, Note, ScheduledSession, SessionConfig,
  SessionHistoryItem, SessionPreset, SessionStats, Task,
} from '@/lib/types';
import type { CardDifficulty, Flashcard } from '@/lib/flashcards';

/**
 * Decoders for what the app reads back from localStorage. Stored data can be
 * from an older version, edited by hand, or cut short by a full quota, so
 * nothing is trusted. An item without its identity (an id and its main
 * content) is dropped, a missing or mistyped field gets its default, and a
 * value of the wrong shape becomes empty. One bad record never hides the rest.
 */

type Fields = Record<string, unknown>;

const record = (v: unknown): Fields | undefined =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Fields) : undefined;
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);
const numList = (v: unknown): number[] | undefined =>
  Array.isArray(v) ? v.filter((x): x is number => num(x) !== undefined) : undefined;

const EPOCH = new Date(0).toISOString();

/** Parse stored JSON, or undefined if there is none or it does not parse. */
export function parseStored(raw: string | null): unknown {
  if (raw === null) return undefined;
  try { return JSON.parse(raw); } catch { return undefined; }
}

/** The items `decode` accepts. Anything that is not an array gives []. */
export function listOf<T>(value: unknown, decode: (item: unknown) => T | undefined): T[] {
  if (!Array.isArray(value)) return [];
  return value.map(decode).filter((x): x is T => x !== undefined);
}

export const decodeStrings = (value: unknown): string[] => listOf(value, str);

// ── Settings ──────────────────────────────────────────────────────────────────

const CONFIG_FIELDS: { [K in keyof SessionConfig]-?: (v: unknown) => SessionConfig[K] | undefined } = {
  durationMinutes:           num,
  offscreenThresholdSec:     num,
  breakLimit:                num,
  breakDurationSec:          num,
  punishmentEnabled:         bool,
  punishmentMedia:           str,
  pomodoroEnabled:           bool,
  phoneDetectionEnabled:     bool,
  tabSwitchViolationEnabled: bool,
  keyboardShortcutsEnabled:  bool,
};

/** The well-typed settings fields in `value`, and nothing else. */
export function decodePartialConfig(value: unknown): Partial<SessionConfig> {
  const v = record(value);
  if (!v) return {};
  const out: Partial<Record<keyof SessionConfig, unknown>> = {};
  for (const key of Object.keys(CONFIG_FIELDS) as (keyof SessionConfig)[]) {
    const decoded = CONFIG_FIELDS[key](v[key]);
    if (decoded !== undefined) out[key] = decoded;
  }
  return out as Partial<SessionConfig>;
}

export const decodeConfig = (value: unknown, defaults: SessionConfig): SessionConfig =>
  ({ ...defaults, ...decodePartialConfig(value) });

export function decodeTemplate(value: unknown): SessionPreset | undefined {
  const v = record(value);
  const id = str(v?.id), name = str(v?.name);
  if (!v || id === undefined || name === undefined) return undefined;
  return { id, name, description: str(v.description) ?? '', config: decodePartialConfig(v.config) };
}

// ── Sessions ──────────────────────────────────────────────────────────────────

function decodeStats(value: unknown): SessionStats | undefined {
  const v = record(value);
  const startedAt = str(v?.startedAt);
  if (!v || startedAt === undefined) return undefined;
  return {
    startedAt,
    endedAt:              str(v.endedAt),
    totalFocusedMs:       num(v.totalFocusedMs) ?? 0,
    violationCount:       num(v.violationCount) ?? 0,
    longestDistractionMs: num(v.longestDistractionMs) ?? 0,
    breakUsed:            num(v.breakUsed) ?? 0,
    breakTimeUsedMs:      num(v.breakTimeUsedMs) ?? 0,
    focusScore:           num(v.focusScore),
    taskTitle:            str(v.taskTitle),
    notes:                str(v.notes),
    phoneCheckCount:      num(v.phoneCheckCount),
    tabSwitchCount:       num(v.tabSwitchCount),
    recoveryTimes:        numList(v.recoveryTimes),
    focusTransitions:     num(v.focusTransitions),
  };
}

export function decodeHistoryItem(value: unknown, defaults: SessionConfig): SessionHistoryItem | undefined {
  const v = record(value);
  const id = str(v?.id);
  const stats = decodeStats(v?.stats);
  if (!v || id === undefined || !stats) return undefined;
  return { id, config: decodeConfig(v.config, defaults), stats };
}

export function decodeAggregate(value: unknown, defaults: AggregateStats): AggregateStats {
  const v = record(value) ?? {};
  return {
    sessions:             num(v.sessions) ?? defaults.sessions,
    totalFocusedMs:       num(v.totalFocusedMs) ?? defaults.totalFocusedMs,
    totalViolations:      num(v.totalViolations) ?? defaults.totalViolations,
    totalBreakTimeMs:     num(v.totalBreakTimeMs) ?? defaults.totalBreakTimeMs,
    longestDistractionMs: num(v.longestDistractionMs) ?? defaults.longestDistractionMs,
    currentStreak:        num(v.currentStreak) ?? defaults.currentStreak,
    longestStreak:        num(v.longestStreak) ?? defaults.longestStreak,
    lastSessionDate:      str(v.lastSessionDate) ?? defaults.lastSessionDate,
    totalFocusScore:      num(v.totalFocusScore) ?? defaults.totalFocusScore,
  };
}

export function decodeGoals(value: unknown, defaults: Goals): Goals {
  return { dailyGoalMinutes: num(record(value)?.dailyGoalMinutes) ?? defaults.dailyGoalMinutes };
}

// ── Tools ─────────────────────────────────────────────────────────────────────

export function decodeTask(value: unknown): Task | undefined {
  const v = record(value);
  const id = str(v?.id), title = str(v?.title);
  if (!v || id === undefined || title === undefined) return undefined;
  return {
    id,
    title,
    createdAt:    str(v.createdAt) ?? EPOCH,
    completedAt:  str(v.completedAt),
    sessionCount: num(v.sessionCount) ?? 0,
    status:       v.status === 'done' ? 'done' : 'active',
  };
}

export function decodeNote(value: unknown): Note | undefined {
  const v = record(value);
  const id = str(v?.id);
  if (!v || id === undefined) return undefined;
  const createdAt = str(v.createdAt) ?? EPOCH;
  return { id, title: str(v.title) ?? '', body: str(v.body) ?? '', createdAt, updatedAt: str(v.updatedAt) ?? createdAt };
}

const DIFFICULTIES: readonly CardDifficulty[] = [1, 2, 3];

export function decodeFlashcard(value: unknown): Flashcard | undefined {
  const v = record(value);
  const id = str(v?.id), front = str(v?.front), back = str(v?.back);
  if (!v || id === undefined || front === undefined || back === undefined) return undefined;
  const difficulty = DIFFICULTIES.find((d) => d === v.difficulty) ?? 2;
  return {
    id, front, back, difficulty,
    interval:     num(v.interval) ?? 1,
    easeFactor:   num(v.easeFactor) ?? 2.5,
    nextReview:   str(v.nextReview) ?? EPOCH.slice(0, 10),
    reviewCount:  num(v.reviewCount) ?? 0,
    correctCount: num(v.correctCount) ?? 0,
    lastReviewed: str(v.lastReviewed),
  };
}

export function decodeScheduledSession(value: unknown): ScheduledSession | undefined {
  const v = record(value);
  const id = str(v?.id), scheduledAt = str(v?.scheduledAt);
  if (!v || id === undefined || scheduledAt === undefined) return undefined;
  return {
    id,
    scheduledAt,
    label:           str(v.label) ?? 'Focus session',
    durationMinutes: num(v.durationMinutes) ?? 25,
    fired:           bool(v.fired) ?? false,
  };
}

export function decodeVideoMeta(value: unknown): CustomVideoMeta | null {
  const v = record(value);
  const id = str(v?.id), name = str(v?.name);
  if (!v || id === undefined || name === undefined) return null;
  return { id, name, size: num(v.size) ?? 0, type: str(v.type) ?? '', addedAt: str(v.addedAt) ?? EPOCH };
}
