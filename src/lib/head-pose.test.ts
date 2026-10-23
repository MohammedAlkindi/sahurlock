import { describe, expect, it } from 'vitest';
import { headPose, headTurn, type HeadPose } from '@/lib/head-pose';
import type { NormPoint } from '@/lib/types';

// Landmarks 1, 33 and 263 of MediaPipe's canonical face model, in centimetres
// (mediapipe/modules/face_geometry/data/canonical_face_model.obj). +y is up and
// +z points toward the camera.
const CANONICAL = {
  nose:     [0, -1.126865, 7.475604],
  leftEye:  [-4.445859, 2.663991, 3.173422],
  rightEye: [4.445859, 2.663991, 3.173422],
} as const;

interface View { width: number; height: number; distanceCm: number }
interface Turn { yaw?: number; pitch?: number; roll?: number }

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Where a webcam with a 65° horizontal field of view sees the landmarks, as frame fractions. */
function project([x0, y0, z0]: readonly number[], view: View, turn: Turn): NormPoint {
  const { yaw = 0, pitch = 0, roll = 0 } = turn;
  const x1 = x0 * Math.cos(rad(roll)) - y0 * Math.sin(rad(roll));
  const y1 = x0 * Math.sin(rad(roll)) + y0 * Math.cos(rad(roll));
  const x2 = x1 * Math.cos(rad(yaw)) + z0 * Math.sin(rad(yaw));
  const z2 = -x1 * Math.sin(rad(yaw)) + z0 * Math.cos(rad(yaw));
  const y3 = y1 * Math.cos(rad(pitch)) - z2 * Math.sin(rad(pitch));
  const z3 = y1 * Math.sin(rad(pitch)) + z2 * Math.cos(rad(pitch));
  const focal = view.width / 2 / Math.tan(rad(65) / 2);
  const depth = view.distanceCm - z3;
  return {
    x: (view.width / 2 + (focal * x2) / depth) / view.width,
    y: (view.height / 2 - (focal * y3) / depth) / view.height,
  };
}

function poseFor(view: View, turn: Turn = {}): HeadPose {
  const p = (point: readonly number[]) => project(point, view, turn);
  return headPose(p(CANONICAL.nose), p(CANONICAL.leftEye), p(CANONICAL.rightEye), view.width, view.height);
}

const VIEWS: View[] = [40, 55, 75].flatMap((distanceCm) => [
  { width: 1280, height: 720, distanceCm },
  { width: 640, height: 480, distanceCm },
]);

describe('headPose', () => {
  it('reads the same turn about the same at any distance', () => {
    const near = poseFor({ width: 1280, height: 720, distanceCm: 40 }, { yaw: 30 }).yaw - poseFor({ width: 1280, height: 720, distanceCm: 40 }).yaw;
    const far  = poseFor({ width: 1280, height: 720, distanceCm: 75 }, { yaw: 30 }).yaw - poseFor({ width: 1280, height: 720, distanceCm: 75 }).yaw;
    expect(near / far).toBeGreaterThan(1);
    expect(near / far).toBeLessThan(1.2);
  });

  it('does not depend on the frame aspect ratio', () => {
    const wide = poseFor({ width: 1280, height: 720, distanceCm: 55 }, { yaw: 20, pitch: -15, roll: 10 });
    const box  = poseFor({ width: 640, height: 480, distanceCm: 55 }, { yaw: 20, pitch: -15, roll: 10 });
    expect(wide.yaw).toBeCloseTo(box.yaw, 9);
    expect(wide.pitch).toBeCloseTo(box.pitch, 9);
    expect(wide.roll).toBeCloseTo(box.roll, 5);
  });

  it('measures roll in true radians', () => {
    const view = { width: 1280, height: 720, distanceCm: 55 };
    // Image y points down, so the sign flips. The size is what the limits use.
    expect(Math.abs(poseFor(view, { roll: 20 }).roll - poseFor(view).roll)).toBeCloseTo(rad(20), 2);
  });
});

describe('headTurn', () => {
  const cases: [string, Turn, ReturnType<typeof headTurn>][] = [
    ['facing the screen',        {},              'none'],
    ['a 10° glance aside',       { yaw: 10 },     'none'],
    ['turning 30°',              { yaw: 30 },     'moderate'],
    ['turning 45° to a phone',   { yaw: -45 },    'extreme'],
    ['nodding 15°',              { pitch: -15 },  'none'],
    ['looking 35° down',         { pitch: -35 },  'moderate'],
    ['looking 50° down at a lap', { pitch: -50 }, 'extreme'],
    ['tilting 10°',              { roll: 10 },    'none'],
    ['tilting 22°',              { roll: 22 },    'moderate'],
    ['tilting 35°',              { roll: 35 },    'extreme'],
  ];

  for (const view of VIEWS) {
    const label = `${view.width}x${view.height} at ${view.distanceCm} cm`;
    it(`classifies head movement the same way at ${label}`, () => {
      const baseline = poseFor(view);
      for (const [name, turn, expected] of cases) {
        expect(headTurn(poseFor(view, turn), baseline), name).toBe(expected);
      }
    });
  }
});
