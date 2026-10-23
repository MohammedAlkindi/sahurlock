import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

/** What the fake face does: present or not, head turn and nod in degrees, and gaze as a fraction of the eye's width or height. */
export interface FakePose {
  present?: boolean;
  yaw?: number;
  pitch?: number;
  gazeX?: number;
  gazeY?: number;
}

const CANONICAL: number[][] = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'canonical-face.json'), 'utf8'));

/**
 * Runs in the page in place of MediaPipe's face_mesh.js. It answers each frame
 * with MediaPipe's canonical face model, posed as window.__fakeFace says, seen
 * through a 65° webcam 40 cm away, and expressed in the detector's crop
 * (window.__detectorRoi) the way the real model would see it.
 */
function installFakeFaceMesh(vertices: number[][]) {
  type Pose = { present: boolean; yaw: number; pitch: number; gazeX: number; gazeY: number };
  type Roi = { x: number; y: number; w: number; h: number; frameW: number; frameH: number };
  type Results = { multiFaceLandmarks: { x: number; y: number; z: number }[][] };
  const page = window as unknown as { FaceMesh: unknown; __fakeFace: Pose; __detectorRoi?: Roi };
  const rad = (deg: number) => (deg * Math.PI) / 180;

  // Iris landmarks 468 to 477 are not in the canonical mesh. Each iris sits at
  // the centre of its eye opening, moved by the gaze, with a 0.55 cm radius.
  const irises = (pose: Pose) => [[33, 133, 159, 145], [362, 263, 386, 374]].flatMap(([outer, inner, top, bottom]) => {
    const width = Math.abs(vertices[outer][0] - vertices[inner][0]);
    const height = Math.abs(vertices[top][1] - vertices[bottom][1]);
    const x = (vertices[outer][0] + vertices[inner][0]) / 2 + pose.gazeX * width;
    const y = (vertices[top][1] + vertices[bottom][1]) / 2 - pose.gazeY * height;
    const z = (vertices[outer][2] + vertices[inner][2]) / 2 + 0.3;
    const r = 0.55;
    return [[x, y, z], [x, y + r, z], [x, y - r, z], [x + r, y, z], [x - r, y, z]];
  });

  const project = ([x0, y0, z0]: number[], pose: Pose, roi: Roi) => {
    const x1 = x0 * Math.cos(rad(pose.yaw)) + z0 * Math.sin(rad(pose.yaw));
    const z1 = -x0 * Math.sin(rad(pose.yaw)) + z0 * Math.cos(rad(pose.yaw));
    const y2 = y0 * Math.cos(rad(pose.pitch)) - z1 * Math.sin(rad(pose.pitch));
    const z2 = y0 * Math.sin(rad(pose.pitch)) + z1 * Math.cos(rad(pose.pitch));
    const focal = roi.frameW / 2 / Math.tan(rad(65) / 2);
    const depth = 40 - z2;
    const px = roi.frameW / 2 + (focal * x1) / depth;
    const py = roi.frameH / 2 - (focal * y2) / depth;
    return { x: (px - roi.x) / roi.w, y: (py - roi.y) / roi.h, z: 0 };
  };

  page.__fakeFace = { present: true, yaw: 0, pitch: 0, gazeX: 0, gazeY: 0 };
  page.FaceMesh = class {
    private listener: (results: Results) => void = () => {};
    setOptions() {}
    onResults(listener: (results: Results) => void) { this.listener = listener; }
    async send() {
      const pose = page.__fakeFace;
      const roi = page.__detectorRoi;
      if (!pose.present || !roi) { this.listener({ multiFaceLandmarks: [] }); return; }
      const points = [...vertices, ...irises(pose)].map((v) => project(v, pose, roi));
      this.listener({ multiFaceLandmarks: [points] });
    }
  };
}

/** Records the crop the detector draws from the video, so the fake can answer in its coordinates. */
function recordDetectorCrop() {
  const drawImage = CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage = function (this: CanvasRenderingContext2D, ...args: unknown[]) {
    const [source, x, y, w, h] = args;
    if (source instanceof HTMLVideoElement && args.length === 9) {
      (window as unknown as { __detectorRoi: unknown }).__detectorRoi = {
        x, y, w, h, frameW: source.videoWidth, frameH: source.videoHeight,
      };
    }
    return (drawImage as (...a: unknown[]) => void).apply(this, args);
  } as typeof drawImage;
}

/** Put a synthetic face in front of the detector for this page. */
export async function installFakeFace(page: Page) {
  await page.addInitScript(recordDetectorCrop);
  await page.route('**/vendor/mediapipe/face_mesh/face_mesh.js', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `(${installFakeFaceMesh.toString()})(${JSON.stringify(CANONICAL)});`,
  }));
}

export async function setFace(page: Page, pose: FakePose) {
  await page.evaluate((p) => Object.assign((window as unknown as { __fakeFace: FakePose }).__fakeFace, p), pose);
}
