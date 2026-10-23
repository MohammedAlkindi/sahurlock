import type { SessionConfig } from '@/lib/types';
import { DEFAULT_PUNISHMENT_MEDIA } from '@/lib/punishment-media';

/** Settings a first-time user starts with, shared by every page that reads settings. */
export const DEFAULT_CONFIG: SessionConfig = {
  durationMinutes:           25,
  offscreenThresholdSec:     6,
  breakLimit:                3,
  breakDurationSec:          300,
  punishmentEnabled:         true,
  punishmentMedia:           DEFAULT_PUNISHMENT_MEDIA,
  pomodoroEnabled:           true,
  phoneDetectionEnabled:     false,
  tabSwitchViolationEnabled: false,
};
