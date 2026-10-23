import { describe, expect, it } from 'vitest';
import { frameCountsAsFocused, getDerivedState } from '@/lib/session-machine';
import type { AttentionLevel, AttentionReading } from '@/lib/types';

const reading = (attention: AttentionLevel): AttentionReading => ({
  facePresent: attention !== 'offscreen',
  confidence: 0.9,
  yaw: 0,
  pitch: 0,
  roll: 0,
  attention,
  guidance: [],
  faceBox: null,
  eyeDirectionX: 0,
  eyeDirectionY: 0,
  eyeOpenRatio: 0.3,
  eyesFocused: attention === 'focused',
  leftEye: null,
  rightEye: null,
  lightingCondition: 'normal',
});

const base = {
  attention: reading('focused'),
  offscreenMs: 0,
  thresholdMs: 10_000,
  onBreak: false,
  violationActive: false,
};

describe('getDerivedState', () => {
  it('reports focused when attention is on screen', () => {
    expect(getDerivedState(base)).toBe('focused');
  });

  it('puts a break ahead of every other state', () => {
    expect(getDerivedState({ ...base, onBreak: true, violationActive: true })).toBe('break');
  });

  it('keeps an active violation until it is cleared', () => {
    expect(getDerivedState({ ...base, violationActive: true })).toBe('violated');
  });

  it('warns when there is no reading or the reading is uncertain', () => {
    expect(getDerivedState({ ...base, attention: null })).toBe('warning');
    expect(getDerivedState({ ...base, attention: reading('uncertain') })).toBe('warning');
  });

  it('passes a detector warning straight through', () => {
    expect(getDerivedState({ ...base, attention: reading('warning') })).toBe('warning');
  });

  it('stays focused while off screen for less than half the threshold', () => {
    expect(
      getDerivedState({ ...base, attention: reading('offscreen'), offscreenMs: 4_999 }),
    ).toBe('focused');
  });

  it('warns once off-screen time reaches half the threshold', () => {
    expect(
      getDerivedState({ ...base, attention: reading('offscreen'), offscreenMs: 5_000 }),
    ).toBe('warning');
  });
});

describe('frameCountsAsFocused', () => {
  it('counts a confident, on-screen, focused reading', () => {
    expect(frameCountsAsFocused(reading('focused'))).toBe(true);
  });

  it('does not count an uncertain reading even with a face present', () => {
    expect(frameCountsAsFocused({ ...reading('uncertain'), facePresent: true })).toBe(false);
  });

  it('does not count warnings, off-screen readings or a missing reading', () => {
    expect(frameCountsAsFocused(reading('warning'))).toBe(false);
    expect(frameCountsAsFocused(reading('offscreen'))).toBe(false);
    expect(frameCountsAsFocused(null)).toBe(false);
  });

  it('does not count a focused label without a face', () => {
    expect(frameCountsAsFocused({ ...reading('focused'), facePresent: false })).toBe(false);
  });
});
