'use client';

import type { RefObject } from 'react';
import { useEffect, useRef } from 'react';
import { AttentionReading } from '@/lib/types';
import type { PhoneReading } from '@/lib/phone-detector';

interface Props {
  videoRef: RefObject<HTMLVideoElement>;
  attention: AttentionReading | null;
  // Calibration state
  calibrating: boolean;
  calibrationGoodSamples: number;
  calibrationNeeded: number;
  calibrationStalled: boolean;
  // Countdown overlay
  countdownLeft: number;
  // Zoom
  onZoomIn: () => void;
  onZoomOut: () => void;
  zoomLevel: number;
  // Phone detection
  phoneReading?: PhoneReading | null;
  phoneCheckMs?: number;
  phoneCheckThresholdMs?: number;
}

const ATTN_COLOR: Record<string, string> = {
  focused:  '#10b981',
  warning:  '#f59e0b',
  offscreen:'#ef4444',
  uncertain:'#64748b'
};

function drawRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawFrame(canvas: HTMLCanvasElement, vW: number, vH: number, attention: AttentionReading, phoneReading?: PhoneReading | null) {
  canvas.width  = vW;
  canvas.height = vH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, vW, vH);

  const col = ATTN_COLOR[attention.attention] ?? ATTN_COLOR.uncertain;

  if (attention.faceBox) {
    const { x, y, width, height } = attention.faceBox;
    ctx.save();
    ctx.strokeStyle = col + 'bb';
    ctx.lineWidth = 2;
    drawRoundRect(ctx, x, y, width, height, 10);
    ctx.stroke();
    ctx.restore();
  }

  // Phone detection zone
  if (phoneReading?.zone) {
    const { x, y, width, height } = phoneReading.zone;
    ctx.save();
    if (phoneReading.detected) {
      // Solid orange border + tinted fill when a hand is detected
      ctx.strokeStyle = '#f97316cc';
      ctx.lineWidth = 2;
      drawRoundRect(ctx, x, y, width, height, 6);
      ctx.stroke();
      ctx.fillStyle = '#f9731622';
      ctx.fill();
    } else {
      // Subtle dashed outline when monitoring but nothing detected
      ctx.strokeStyle = '#78716c55';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      drawRoundRect(ctx, x, y, width, height, 6);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  const eyes = [attention.leftEye, attention.rightEye];
  for (const eye of eyes) {
    if (!eye) continue;
    const ix = eye.irisX * vW;
    const iy = eye.irisY * vH;
    const ir = Math.max(eye.irisRadius * vW, 4);

    if (eye.contour.length >= 3) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(eye.contour[0].x * vW, eye.contour[0].y * vH);
      for (let i = 1; i < eye.contour.length; i++) {
        ctx.lineTo(eye.contour[i].x * vW, eye.contour[i].y * vH);
      }
      ctx.closePath();
      ctx.strokeStyle = col + 'cc';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = col + '18';
      ctx.fill();
      ctx.restore();
    }

    ctx.save();
    const glow = ctx.createRadialGradient(ix, iy, 0, ix, iy, ir * 3);
    glow.addColorStop(0, '#67e8f966');
    glow.addColorStop(1, '#67e8f900');
    ctx.beginPath();
    ctx.arc(ix, iy, ir * 3, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.arc(ix, iy, ir, 0, Math.PI * 2);
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.arc(ix, iy, Math.max(2.5, ir * 0.38), 0, Math.PI * 2);
    ctx.fillStyle = '#0c4a6e';
    ctx.fill();
    ctx.restore();

    const gMag = Math.hypot(eye.gazeX, eye.gazeY);
    if (gMag > 0.05) {
      const scale = ir * 4.5;
      const ex = ix + (eye.gazeX / Math.max(gMag, 0.001)) * gMag * scale;
      const ey = iy + (eye.gazeY / Math.max(gMag, 0.001)) * gMag * scale;
      ctx.save();
      ctx.strokeStyle = '#fbbf2499';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(ix, iy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(ex, ey, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#fbbf24cc';
      ctx.fill();
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  const pct = Math.round(attention.confidence * 100);
  ctx.save();
  ctx.font = `bold ${Math.round(vH * 0.028)}px monospace`;
  ctx.fillStyle = col + 'dd';
  ctx.fillText(`${pct}%`, 10, Math.round(vH * 0.038));
  ctx.restore();
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full transition-colors duration-300 ${ok ? 'bg-accent' : 'bg-border'}`} />
  );
}

export function CameraPanel({
  videoRef,
  attention,
  calibrating,
  calibrationGoodSamples,
  calibrationNeeded,
  calibrationStalled,
  countdownLeft,
  onZoomIn,
  onZoomOut,
  zoomLevel,
  phoneReading,
  phoneCheckMs = 0,
  phoneCheckThresholdMs = 2500,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const video  = videoRef.current;
    if (!canvas) return;
    if (!attention?.facePresent || !video?.videoWidth) {
      canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    drawFrame(canvas, video.videoWidth, video.videoHeight, attention, phoneReading);
  }, [attention, videoRef, phoneReading]);

  const leftOpen  = attention?.leftEye?.openRatio  ?? 0;
  const rightOpen = attention?.rightEye?.openRatio ?? 0;

  const faceOk           = attention?.facePresent ?? false;
  const confidenceOk     = (attention?.confidence ?? 0) >= 0.5;
  const confidencePct    = Math.round((attention?.confidence ?? 0) * 100);
  const guidance         = attention?.guidance?.[0] ?? null;
  const lightingCondition = attention?.lightingCondition ?? 'normal';
  const calibPct         = Math.min(100, (calibrationGoodSamples / calibrationNeeded) * 100);

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Live Feed</h3>
        {!calibrating && (attention?.leftEye || attention?.rightEye) && (
          <span className="font-mono text-xs text-muted-foreground">
            EAR {leftOpen.toFixed(2)} / {rightOpen.toFixed(2)}
          </span>
        )}
      </div>

      {/* Video + canvas overlay stack — intentionally dark media surface */}
      <div className="relative overflow-hidden rounded-xl border border-zinc-800 bg-[#1A1A1A]">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="aspect-video w-full object-cover transition-transform duration-150"
          style={{ transform: `scale(${zoomLevel})`, transformOrigin: 'center center' }}
        />

        {/* Eye tracking canvas — always visible, even during calibration */}
        <canvas
          ref={canvasRef}
          className="pointer-events-none absolute inset-0 h-full w-full"
        />

        {/* ── Calibration progress panel (bottom docked, semi-transparent) ── */}
        {calibrating && (
          <div className="absolute inset-x-0 bottom-0 bg-[#111111]/90 px-4 py-3 backdrop-blur-sm">
            {/* Stall / lighting warning */}
            {(calibrationStalled || guidance) && (
              <p className="mb-2 text-xs text-amber-400">
                {calibrationStalled
                  ? `Detection slow. ${guidance ?? 'Try adjusting your position or lighting.'}`
                  : guidance}
              </p>
            )}

            {/* Status indicators + lighting badge + progress */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <StatusDot ok={faceOk} />
                <span className="text-xs text-zinc-400">Face</span>
              </div>
              <div className="flex items-center gap-1.5">
                <StatusDot ok={confidenceOk} />
                <span className="text-xs text-zinc-400">{confidencePct}%</span>
              </div>

              {/* Lighting condition badge */}
              {lightingCondition !== 'normal' && (
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                  lightingCondition === 'dark'
                    ? 'bg-zinc-800 text-zinc-400'
                    : 'bg-amber-900/60 text-amber-300'
                }`}>
                  {lightingCondition === 'dark' ? 'dim' : 'backlit'}
                </span>
              )}

              {/* Progress bar */}
              <div className="ml-auto flex items-center gap-2">
                <div className="h-1 w-20 overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full rounded-full bg-accent transition-all duration-300"
                    style={{ width: `${calibPct}%` }}
                  />
                </div>
                <span className="font-mono text-xs tabular-nums text-zinc-500">
                  {calibrationGoodSamples}/{calibrationNeeded}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* ── Phone detection badge ─────────────────────────────────────── */}
        {phoneReading?.detected && (
          <div className="absolute right-2 top-2 rounded bg-orange-500/90 px-2 py-0.5 text-xs font-bold text-white">
            PHONE?
          </div>
        )}

        {/* ── Countdown overlay ─────────────────────────────────────────── */}
        {countdownLeft > 0 && !calibrating && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#1A1A1A]/60 backdrop-blur-[2px]">
            <span className="text-7xl font-black tabular-nums text-white leading-none">
              {countdownLeft}
            </span>
            <span className="mt-2 text-xs font-medium uppercase tracking-widest text-zinc-400">
              Starting
            </span>
          </div>
        )}
      </div>

      {/* Eye openness bars — only during active session */}
      {!calibrating && countdownLeft === 0 && (attention?.leftEye || attention?.rightEye) && (
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
          {(['Left', 'Right'] as const).map((side) => {
            const ratio = side === 'Left' ? leftOpen : rightOpen;
            const pct   = Math.min(100, Math.round(ratio * 600));
            return (
              <div key={side}>
                <div className="mb-1">{side}</div>
                <div className="h-1 w-full rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-cyan-500/70 transition-all duration-100"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Phone detection progress bar */}
      {!calibrating && countdownLeft === 0 && phoneReading !== undefined && phoneReading !== null && (
        <div className="mt-3">
          <div className="mb-1 flex justify-between text-xs text-muted-foreground">
            <span className={phoneReading.detected ? 'text-orange-500' : ''}>
              {phoneReading.detected ? 'Hand detected' : 'Phone zone'}
            </span>
            <span>{Math.round(phoneReading.skinDensity * 100)}% skin</span>
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full transition-all duration-150 ${phoneCheckMs > 0 ? 'bg-orange-500' : 'bg-border'}`}
              style={{ width: `${Math.min(100, (phoneCheckMs / phoneCheckThresholdMs) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Zoom controls */}
      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={onZoomOut}
          className="rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:border-foreground/20 hover:text-foreground transition"
        >
          −
        </button>
        <button
          onClick={onZoomIn}
          className="rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:border-foreground/20 hover:text-foreground transition"
        >
          +
        </button>
        <span className="text-xs text-muted-foreground">{zoomLevel.toFixed(1)}×</span>
      </div>

      {/* Active session guidance hints */}
      {!calibrating && attention?.guidance?.length ? (
        <ul className="mt-3 space-y-0.5 text-xs text-amber-600">
          {attention.guidance.slice(0, 2).map((hint) => (
            <li key={hint} className="flex gap-1.5">
              <span className="text-amber-500">!</span>
              <span>{hint}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
