export type ViolationSource = 'camera' | 'tab_switch' | 'phone';

export type AppState =
  | 'idle'
  | 'requesting_permission'
  | 'calibrating'
  | 'countdown'
  | 'focused'
  | 'warning'
  | 'break'
  | 'violated'
  | 'session_complete'
  | 'camera_error';

export type AttentionLevel = 'focused' | 'warning' | 'offscreen' | 'uncertain';

export interface SessionConfig {
  durationMinutes: number;
  offscreenThresholdSec: number;
  breakLimit: number;
  breakDurationSec: number;
  punishmentEnabled: boolean;
  punishmentMedia: string;
  pomodoroEnabled: boolean;
  phoneDetectionEnabled: boolean;
  advancedEyeTrackingEnabled?: boolean;
  tabSwitchViolationEnabled?: boolean;
}

export interface CustomVideoMeta {
  id: string;
  name: string;
  size: number;
  type: string;
  addedAt: string;
}

export interface SessionPreset {
  id: string;
  name: string;
  description: string;
  config: Partial<SessionConfig>;
}

export interface SessionStats {
  startedAt: string;
  endedAt?: string;
  totalFocusedMs: number;
  violationCount: number;
  longestDistractionMs: number;
  breakUsed: number;
  breakTimeUsedMs: number;
  focusScore?: number;
  taskTitle?: string;
  notes?: string;
  phoneCheckCount?: number;
  tabSwitchCount?: number;
  /** Recovery duration (ms) for each violation — used by the detailed score formula */
  recoveryTimes?: number[];
  /** Count of distinct "warning" state entries — used as stability metric */
  focusTransitions?: number;
}

export interface AggregateStats {
  sessions: number;
  totalFocusedMs: number;
  totalViolations: number;
  totalBreakTimeMs: number;
  longestDistractionMs: number;
  currentStreak: number;
  longestStreak: number;
  lastSessionDate: string;
  totalFocusScore: number;
}

export interface SessionHistoryItem {
  id: string;
  config: SessionConfig;
  stats: SessionStats;
}

export interface PixelBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NormPoint {
  x: number;
  y: number;
}

export interface EyeData {
  x: number;
  y: number;
  width: number;
  height: number;
  irisX: number;
  irisY: number;
  irisRadius: number;
  gazeX: number;
  gazeY: number;
  openRatio: number;
  contour: NormPoint[];
}

export interface BaselinePose {
  centerX: number;
  centerY: number;
  yaw: number;
  pitch: number;
  roll: number;
  eyeCenterX: number;
  eyeCenterY: number;
  eyeOpenRatio: number;
  faceBox: PixelBox;
}

export interface AttentionReading {
  facePresent: boolean;
  confidence: number;
  yaw: number;
  pitch: number;
  roll: number;
  attention: AttentionLevel;
  guidance: string[];
  faceBox: PixelBox | null;
  eyeDirectionX: number;
  eyeDirectionY: number;
  eyeOpenRatio: number;
  eyesFocused: boolean;
  leftEye: EyeData | null;
  rightEye: EyeData | null;
  lightingCondition: 'dark' | 'backlit' | 'normal';
}

export interface CalibrationReport {
  ok: boolean;
  confidence: number;
  reason: string;
  baseline: BaselinePose | null;
  sampleCount: number;
  detectionRate: number;
}

export interface RuntimeState {
  appState: AppState;
  attention: AttentionReading | null;
  remainingMs: number;
  offscreenMs: number;
  violationActive: boolean;
}

// ── Tasks ──────────────────────────────────────────────────────────────────────

export type TaskStatus = 'active' | 'done';

export interface Task {
  id: string;
  title: string;
  createdAt: string;
  completedAt?: string;
  sessionCount: number;
  status: TaskStatus;
}
