import {
  BarChart2, CalendarClock, CheckSquare, Clock, Layers, Music2, NotebookPen, Timer,
  type LucideIcon,
} from 'lucide-react';

export interface Tool {
  /** The route segment under the app layout, e.g. `tasks` for /tasks. */
  id: string;
  label: string;
  icon: LucideIcon;
  /** Extra words the command palette matches on. */
  keywords: string;
}

/**
 * Every tool in the app, in sidebar order. The sidebar, command palette and
 * breadcrumb read this list, so a new tool is added here and in its route.
 */
export const TOOLS: readonly Tool[] = [
  { id: 'session',    label: 'Session',    icon: Timer,         keywords: 'start focus work pomodoro' },
  { id: 'tasks',      label: 'Tasks',      icon: CheckSquare,   keywords: 'checklist todo add task' },
  { id: 'stats',      label: 'Stats',      icon: BarChart2,     keywords: 'history performance score' },
  { id: 'schedule',   label: 'Schedule',   icon: CalendarClock, keywords: 'plan reminder calendar later' },
  { id: 'notes',      label: 'Notes',      icon: NotebookPen,   keywords: 'scratchpad write journal' },
  { id: 'flashcards', label: 'Flashcards', icon: Layers,        keywords: 'cards review study spaced' },
  { id: 'timer',      label: 'Timer',      icon: Clock,         keywords: 'countdown stopwatch' },
  { id: 'sounds',     label: 'Sounds',     icon: Music2,        keywords: 'ambient noise rain music' },
];

export const toolHref = (tool: Tool) => `/${tool.id}`;
