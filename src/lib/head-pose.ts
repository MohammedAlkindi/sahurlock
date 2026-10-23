import type { NormPoint } from '@/lib/types';

/**
 * Head pose from three face-mesh landmarks in frame-normalised coordinates: the
 * nose tip (1) and the outer eye corners (33, 263).
 *
 * Yaw and pitch are the nose tip's offset from the midpoint between the eyes,
 * measured in pixels and divided by the distance between the eyes. That keeps
 * them the same whether the user sits close or far and whatever the camera's
 * aspect ratio. Roll is the angle of the eye line in radians, also in pixels.
 */
export interface HeadPose {
  yaw: number;
  pitch: number;
  roll: number;
}

export function headPose(nose: NormPoint, leftEye: NormPoint, rightEye: NormPoint, frameW: number, frameH: number): HeadPose {
  const dx = (rightEye.x - leftEye.x) * frameW;
  const dy = (rightEye.y - leftEye.y) * frameH;
  const eyeDistance = Math.max(Math.hypot(dx, dy), 1);
  return {
    yaw:   ((nose.x - (leftEye.x + rightEye.x) / 2) * frameW) / eyeDistance,
    pitch: ((nose.y - (leftEye.y + rightEye.y) / 2) * frameH) / eyeDistance,
    roll:  Math.atan2(dy, Math.abs(dx) + 0.001),
  };
}

/**
 * How far the head may move from its calibrated pose. Set against MediaPipe's
 * canonical face model seen through a 65° webcam at 40 to 75 cm (see
 * head-pose.test.ts): yaw 0.25 is about 23° and 0.45 about 38°, pitch 0.30 is
 * about 28° down and 0.50 about 43° down. Looking up flattens out near 0.21 with
 * these landmarks, so only a downward nod reaches the pitch limits. Roll is in
 * radians, about 17° and 29°.
 */
export const HEAD_LIMITS = {
  yaw:   { moderate: 0.25, extreme: 0.45 },
  pitch: { moderate: 0.30, extreme: 0.50 },
  roll:  { moderate: 0.30, extreme: 0.50 },
} as const;

export type HeadTurn = 'none' | 'moderate' | 'extreme';

export function headTurn(pose: HeadPose, baseline: HeadPose): HeadTurn {
  const axes = ['yaw', 'pitch', 'roll'] as const;
  const delta = (axis: (typeof axes)[number]) => Math.abs(pose[axis] - baseline[axis]);
  if (axes.some((axis) => delta(axis) > HEAD_LIMITS[axis].extreme)) return 'extreme';
  if (axes.some((axis) => delta(axis) > HEAD_LIMITS[axis].moderate)) return 'moderate';
  return 'none';
}
