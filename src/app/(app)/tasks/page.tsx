'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Trash2, RotateCcw, ChevronRight, Plus } from 'lucide-react';
import { deleteTask, loadTasks, saveTask, updateTask } from '@/lib/storage';
import { Task } from '@/lib/types';
import { uid } from '@/lib/utils';

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function TasksPage() {
  const [tasks,     setTasks]     = useState<Task[]>([]);
  const [input,     setInput]     = useState('');
  const [showDone,  setShowDone]  = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const editRef  = useRef<HTMLInputElement>(null);

  const reload = () => setTasks(loadTasks());
  useEffect(() => { reload(); }, []);
  useEffect(() => { if (editingId && editRef.current) editRef.current.focus(); }, [editingId]);

  const active = tasks.filter((t) => t.status === 'active');
  const done   = tasks.filter((t) => t.status === 'done');

  const addTask = () => {
    const title = input.trim();
    if (!title) return;
    saveTask({ id: uid(), title, createdAt: new Date().toISOString(), sessionCount: 0, status: 'active' });
    setInput('');
    reload();
    inputRef.current?.focus();
  };

  const completeTask = (id: string) => { updateTask(id, { status: 'done', completedAt: new Date().toISOString() }); reload(); };
  const restoreTask  = (id: string) => { updateTask(id, { status: 'active', completedAt: undefined }); reload(); };
  const removeTask   = (id: string) => { deleteTask(id); reload(); };

  const startEdit  = (task: Task) => { setEditingId(task.id); setEditValue(task.title); };
  const commitEdit = (id: string) => {
    const title = editValue.trim();
    if (title) updateTask(id, { title });
    setEditingId(null);
    reload();
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-7 flex items-center justify-between">
        <h1 className="text-2xl font-black tracking-tight">Tasks</h1>
      </div>

      {/* Add task */}
      <div className="mb-6 flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addTask()}
          placeholder="Add a task…"
          className="flex-1 rounded-xl border border-input bg-card px-4 py-2.5 text-sm text-foreground placeholder-muted-foreground focus:border-accent focus:outline-hidden focus:ring-1 focus:ring-ring"
        />
        <button
          onClick={addTask}
          disabled={!input.trim()}
          className="flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2.5 text-sm font-bold text-accent-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus size={15} />
          Add
        </button>
      </div>

      {/* Active tasks */}
      {active.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card/50 py-14 text-center">
          <p className="text-sm text-muted-foreground">No active tasks. Add one above.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          {active.map((task, i) => (
            <div
              key={task.id}
              className={`group flex items-center gap-3 px-4 py-3.5 transition hover:bg-muted/40 ${i < active.length - 1 ? 'border-b border-border/60' : ''}`}
            >
              <button
                onClick={() => completeTask(task.id)}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border border-border text-transparent transition hover:border-accent hover:bg-accent/10 hover:text-accent"
                aria-label="Mark complete"
              >
                <Check size={12} />
              </button>

              {editingId === task.id ? (
                <input
                  ref={editRef}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={() => commitEdit(task.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitEdit(task.id);
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                  className="flex-1 bg-transparent text-sm text-foreground focus:outline-hidden"
                />
              ) : (
                <span
                  className="flex-1 cursor-text text-sm text-foreground"
                  onDoubleClick={() => startEdit(task)}
                >
                  {task.title}
                </span>
              )}

              <div className="flex items-center gap-3 transition [@media(hover:hover)]:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
                {task.sessionCount > 0 && (
                  <span className="text-[10px] text-muted-foreground">
                    {task.sessionCount} session{task.sessionCount !== 1 ? 's' : ''}
                  </span>
                )}
                <span className="text-[10px] text-muted-foreground">{formatDate(task.createdAt)}</span>
                <button onClick={() => removeTask(task.id)} className="text-muted-foreground transition hover:text-danger" aria-label="Delete">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Completed */}
      {done.length > 0 && (
        <div className="mt-6">
          <button
            onClick={() => setShowDone((v) => !v)}
            className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground transition hover:text-foreground"
          >
            <ChevronRight size={12} className={`transition-transform ${showDone ? 'rotate-90' : ''}`} />
            {done.length} completed
          </button>

          {showDone && (
            <div className="overflow-hidden rounded-2xl border border-border/50">
              {done.map((task, i) => (
                <div
                  key={task.id}
                  className={`group flex items-center gap-3 px-4 py-3 transition hover:bg-muted/20 ${i < done.length - 1 ? 'border-b border-border/40' : ''}`}
                >
                  <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border border-accent/30 bg-accent/10 text-accent">
                    <Check size={12} />
                  </div>
                  <span className="flex-1 text-sm text-muted-foreground line-through">{task.title}</span>
                  <div className="flex items-center gap-3 transition [@media(hover:hover)]:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
                    {task.completedAt && (
                      <span className="text-[10px] text-muted-foreground">{formatDate(task.completedAt)}</span>
                    )}
                    <button onClick={() => restoreTask(task.id)} className="text-muted-foreground transition hover:text-foreground" aria-label="Restore">
                      <RotateCcw size={13} />
                    </button>
                    <button onClick={() => removeTask(task.id)} className="text-muted-foreground transition hover:text-danger" aria-label="Delete">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {active.length > 0 && (
        <p className="mt-5 text-center text-xs text-muted-foreground">
          Double-click to rename · Select tasks when starting a session
        </p>
      )}
    </div>
  );
}
