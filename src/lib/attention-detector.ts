import { AttentionReading, BaselinePose, CalibrationReport, EyeData, PixelBox } from '@/lib/types';
import { clamp } from '@/lib/utils';
import { headPose, headTurn } from '@/lib/head-pose';

interface Landmark {
  x: number;
  y: number;
  z?: number;
}

interface FaceMeshResult {
  multiFaceLandmarks?: Landmark[][];
}

type FaceMeshInstance = {
  setOptions: (opts: Record<string, unknown>) => void;
  onResults: (cb: (results: FaceMeshResult) => void) => void;
  send: (input: { image: HTMLCanvasElement }) => Promise<void>;
};

declare global {
  interface Window {
    FaceMesh?: new (opts: { locateFile: (file: string) => string }) => FaceMeshInstance;
  }
}

const INPUT_SIZE = 320;
const ROI_PADDING = 1.3;

// Calibration quality gates — intentionally lenient so poor-lighting rooms still succeed
const MIN_CALIBRATION_DETECTION_RATE = 0.55; // was 0.65
const MIN_CALIBRATION_CONFIDENCE     = 0.42; // was 0.55

const LANDMARK_SMOOTH = 0.38; // EMA alpha (lower = smoother, higher = more responsive)

// Key eye landmarks: [outer, inner, top, bottom, iris_center, iris_top, iris_bottom, iris_right, iris_left]
const LEFT_EYE  = [33,  133, 159, 145, 468, 469, 470, 471, 472] as const;
const RIGHT_EYE = [362, 263, 386, 374, 473, 474, 475, 476, 477] as const;

// Full eyelid contour landmarks (MediaPipe Face Mesh v2 with refineLandmarks=true)
const LEFT_CONTOUR  = [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7];
const RIGHT_CONTOUR = [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398];

// Attention classification thresholds (delta from baseline)
const GAZE_OFFSCREEN_X = 0.20;
const GAZE_OFFSCREEN_Y = 0.25;
const GAZE_WARNING_X   = 0.12;
const GAZE_WARNING_Y   = 0.16;
const EYE_CLOSED_RATIO = 0.45; // fraction of calibrated open-ratio that counts as closed
const MIN_CONFIDENCE   = 0.35;

// Served from this app's origin, copied from the pinned npm package by
// scripts/copy-mediapipe.mjs, so no third-party script runs next to the camera.
const FACE_MESH_ASSETS = '/vendor/mediapipe/face_mesh';

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload  = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

// ── Pre-built LUT for dark/backlit enhancement ──────────────────────────────
function buildLut(dark: boolean, backlit: boolean): Uint8Array {
  const lut = new Uint8Array(256);
  if (dark) {
    // Gamma ≈ 0.5 — boosts midtones without blowing highlights
    for (let i = 0; i < 256; i++) lut[i] = Math.min(255, Math.round(Math.pow(i / 255, 0.52) * 255));
  } else if (backlit) {
    // S-curve that lifts crushed shadows, preserves highlights
    for (let i = 0; i < 256; i++) {
      const t = i / 255;
      lut[i] = Math.min(255, Math.round((t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t) * 195 + 20));
    }
  } else {
    for (let i = 0; i < 256; i++) lut[i] = i;
  }
  return lut;
}

// ── Blank reading helpers ───────────────────────────────────────────────────
function blankReading(
  guidance: string[],
  lightingCondition: AttentionReading['lightingCondition'] = 'normal'
): AttentionReading {
  return {
    facePresent: false,
    confidence: 0,
    yaw: 0, pitch: 0, roll: 0,
    attention: 'uncertain',
    guidance,
    faceBox: null,
    eyeDirectionX: 0,
    eyeDirectionY: 0,
    eyeOpenRatio: 0,
    eyesFocused: false,
    leftEye: null,
    rightEye: null,
    lightingCondition
  };
}

// ── AttentionDetector ───────────────────────────────────────────────────────
export class AttentionDetector {
  private mesh: FaceMeshInstance | null = null;
  private analysisCanvas: HTMLCanvasElement;
  private analysisCtx: CanvasRenderingContext2D;
  private roi: PixelBox | null = null;
  private previousLandmarks: Landmark[] | null = null;
  private smoothedLandmarks: Landmark[] | null = null;
  private manualZoom = 1;

  // Serialise concurrent estimate() calls — prevents MediaPipe onResults callback collisions
  // when the rAF tracking loop and the calibration interval fire simultaneously.
  private isEstimating = false;
  private lastReading: AttentionReading | null = null;

  constructor() {
    this.analysisCanvas = document.createElement('canvas');
    this.analysisCanvas.width  = INPUT_SIZE;
    this.analysisCanvas.height = INPUT_SIZE;
    const ctx = this.analysisCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Unable to create analysis canvas.');
    this.analysisCtx = ctx;
  }

  async init() {
    await loadScript(`${FACE_MESH_ASSETS}/face_mesh.js`);
    if (!window.FaceMesh) throw new Error('MediaPipe Face Mesh API unavailable.');

    this.mesh = new window.FaceMesh({
      locateFile: (file) => `${FACE_MESH_ASSETS}/${file}`
    });
    this.mesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      // Lowered from 0.5 — our own confidence scoring gates quality, not MediaPipe's
      minDetectionConfidence: 0.3,
      minTrackingConfidence:  0.3
    });
  }

  setManualZoom(multiplier: number) {
    this.manualZoom = clamp(multiplier, 1, 2);
  }

  // ── Private: send current analysisCanvas to MediaPipe ───────────────────
  private detectWithMesh(): Promise<FaceMeshResult | null> {
    if (!this.mesh) return Promise.resolve(null);
    return new Promise<FaceMeshResult | null>((resolve) => {
      this.mesh!.onResults((results) => resolve(results));
      this.mesh!.send({ image: this.analysisCanvas }).catch(() => resolve(null));
    });
  }

  // ── Private: measure luminance of the current analysisCanvas ────────────
  // Called BEFORE sending to MediaPipe so we know whether to enhance.
  private analyzeLighting(): { dark: boolean; backlit: boolean; lightingCondition: AttentionReading['lightingCondition'] } {
    const w = INPUT_SIZE, h = INPUT_SIZE;
    const img = this.analysisCtx.getImageData(0, 0, w, h).data;

    // Sample at stride 4 (80×80 grid = 6 400 points — fast enough for 60 fps)
    const cx1 = Math.floor(w * 0.20), cx2 = Math.floor(w * 0.80);
    const cy1 = Math.floor(h * 0.10), cy2 = Math.floor(h * 0.90);
    let center = 0, edge = 0, centerCount = 0, edgeCount = 0;

    for (let y = 0; y < h; y += 4) {
      for (let x = 0; x < w; x += 4) {
        const idx = (y * w + x) * 4;
        const lum = img[idx] * 0.2126 + img[idx + 1] * 0.7152 + img[idx + 2] * 0.0722;
        if (x >= cx1 && x < cx2 && y >= cy1 && y < cy2) { center += lum; centerCount++; }
        else                                              { edge   += lum; edgeCount++;   }
      }
    }

    const centerAvg = center / Math.max(centerCount, 1);
    const edgeAvg   = edge   / Math.max(edgeCount,   1);
    const dark      = centerAvg < 52;          // face region too dim
    const backlit   = edgeAvg > centerAvg * 1.45; // bright background swamps face

    return {
      dark,
      backlit,
      lightingCondition: dark ? 'dark' : backlit ? 'backlit' : 'normal'
    };
  }

  // ── Private: apply pixel enhancement in-place to analysisCanvas ─────────
  private enhanceCanvas(dark: boolean, backlit: boolean) {
    if (!dark && !backlit) return;
    const lut = buildLut(dark, backlit);
    const w = INPUT_SIZE, h = INPUT_SIZE;
    const imageData = this.analysisCtx.getImageData(0, 0, w, h);
    const d = imageData.data;
    for (let i = 0; i < d.length - 3; i += 4) {
      d[i]   = lut[d[i]];
      d[i+1] = lut[d[i+1]];
      d[i+2] = lut[d[i+2]];
      // alpha unchanged
    }
    this.analysisCtx.putImageData(imageData, 0, 0);
  }

  // ── Private: compute detection ROI for next frame ───────────────────────
  private getDetectionRoi(frameW: number, frameH: number) {
    if (!this.roi) return { x: 0, y: 0, width: frameW, height: frameH };
    const cx = this.roi.x + this.roi.width  / 2;
    const cy = this.roi.y + this.roi.height / 2;
    const zW = clamp(this.roi.width  * ROI_PADDING / this.manualZoom, 80, frameW);
    const zH = clamp(this.roi.height * ROI_PADDING / this.manualZoom, 80, frameH);
    return {
      x: clamp(cx - zW / 2, 0, frameW - zW),
      y: clamp(cy - zH / 2, 0, frameH - zH),
      width: zW,
      height: zH
    };
  }

  // ── Private: extract eye metrics from raw + smoothed landmarks ──────────
  private getEyeMetrics(raw: Landmark[], vis: Landmark[]) {
    const lOuter = raw[LEFT_EYE[0]],  lInner = raw[LEFT_EYE[1]];
    const lTop   = raw[LEFT_EYE[2]],  lBot   = raw[LEFT_EYE[3]];
    const lIris  = raw[LEFT_EYE[4]];

    const rOuter = raw[RIGHT_EYE[0]], rInner = raw[RIGHT_EYE[1]];
    const rTop   = raw[RIGHT_EYE[2]], rBot   = raw[RIGHT_EYE[3]];
    const rIris  = raw[RIGHT_EYE[4]];

    const lW = Math.max(Math.abs(lOuter.x - lInner.x), 0.001);
    const rW = Math.max(Math.abs(rOuter.x - rInner.x), 0.001);
    const lH = Math.max(Math.abs(lTop.y   - lBot.y),   0.001);
    const rH = Math.max(Math.abs(rTop.y   - rBot.y),   0.001);

    const lCX = (lOuter.x + lInner.x) / 2, lCY = (lTop.y + lBot.y) / 2;
    const rCX = (rOuter.x + rInner.x) / 2, rCY = (rTop.y + rBot.y) / 2;

    const leftOpenRatio  = lH / lW;
    const rightOpenRatio = rH / rW;
    const eyeOpenRatio   = (leftOpenRatio + rightOpenRatio) / 2;

    const gazeLX = (lIris.x - lCX) / lW, gazeLY = (lIris.y - lCY) / lH;
    const gazeRX = (rIris.x - rCX) / rW, gazeRY = (rIris.y - rCY) / rH;

    const eyeCenterX = (lCX + rCX) / 2;
    const eyeCenterY = (lCY + rCY) / 2;

    // Visualization uses smoothed landmarks
    const vlOuter = vis[LEFT_EYE[0]], vlInner = vis[LEFT_EYE[1]];
    const vlTop   = vis[LEFT_EYE[2]], vlBot   = vis[LEFT_EYE[3]];
    const vlIris  = vis[LEFT_EYE[4]];
    const vlIrisT = vis[LEFT_EYE[5]], vlIrisB = vis[LEFT_EYE[6]];
    const vlIrisR = vis[LEFT_EYE[7]], vlIrisL = vis[LEFT_EYE[8]];

    const vrOuter = vis[RIGHT_EYE[0]], vrInner = vis[RIGHT_EYE[1]];
    const vrTop   = vis[RIGHT_EYE[2]], vrBot   = vis[RIGHT_EYE[3]];
    const vrIris  = vis[RIGHT_EYE[4]];
    const vrIrisT = vis[RIGHT_EYE[5]], vrIrisB = vis[RIGHT_EYE[6]];
    const vrIrisR = vis[RIGHT_EYE[7]], vrIrisL = vis[RIGHT_EYE[8]];

    const leftIrisRadius = (
      Math.hypot(vlIrisT.x - vlIris.x, vlIrisT.y - vlIris.y) +
      Math.hypot(vlIrisB.x - vlIris.x, vlIrisB.y - vlIris.y) +
      Math.hypot(vlIrisR.x - vlIris.x, vlIrisR.y - vlIris.y) +
      Math.hypot(vlIrisL.x - vlIris.x, vlIrisL.y - vlIris.y)
    ) / 4;

    const rightIrisRadius = (
      Math.hypot(vrIrisT.x - vrIris.x, vrIrisT.y - vrIris.y) +
      Math.hypot(vrIrisB.x - vrIris.x, vrIrisB.y - vrIris.y) +
      Math.hypot(vrIrisR.x - vrIris.x, vrIrisR.y - vrIris.y) +
      Math.hypot(vrIrisL.x - vrIris.x, vrIrisL.y - vrIris.y)
    ) / 4;

    const vlCX = (vlOuter.x + vlInner.x) / 2, vlCY = (vlTop.y + vlBot.y) / 2;
    const vrCX = (vrOuter.x + vrInner.x) / 2, vrCY = (vrTop.y + vrBot.y) / 2;
    const vlW  = Math.max(Math.abs(vlOuter.x - vlInner.x), 0.001);
    const vrW  = Math.max(Math.abs(vrOuter.x - vrInner.x), 0.001);
    const vlH  = Math.max(Math.abs(vlTop.y   - vlBot.y),   0.001);
    const vrH  = Math.max(Math.abs(vrTop.y   - vrBot.y),   0.001);

    const lGX = (vlIris.x - vlCX) / vlW, lGY = (vlIris.y - vlCY) / vlH;
    const rGX = (vrIris.x - vrCX) / vrW, rGY = (vrIris.y - vrCY) / vrH;

    const leftContour  = LEFT_CONTOUR.map (i => ({ x: vis[i]?.x ?? 0, y: vis[i]?.y ?? 0 }));
    const rightContour = RIGHT_CONTOUR.map(i => ({ x: vis[i]?.x ?? 0, y: vis[i]?.y ?? 0 }));

    const lPad = vlH * 0.55, rPad = vrH * 0.55;

    const leftEye: EyeData = {
      x: Math.min(vlOuter.x, vlInner.x) - lPad, y: vlTop.y - lPad,
      width: vlW + lPad * 2, height: vlH + lPad * 2,
      irisX: vlIris.x, irisY: vlIris.y, irisRadius: leftIrisRadius,
      gazeX: lGX, gazeY: lGY, openRatio: leftOpenRatio, contour: leftContour
    };
    const rightEye: EyeData = {
      x: Math.min(vrOuter.x, vrInner.x) - rPad, y: vrTop.y - rPad,
      width: vrW + rPad * 2, height: vrH + rPad * 2,
      irisX: vrIris.x, irisY: vrIris.y, irisRadius: rightIrisRadius,
      gazeX: rGX, gazeY: rGY, openRatio: rightOpenRatio, contour: rightContour
    };

    return { eyeCenterX, eyeCenterY, eyeOpenRatio, eyeDirectionX: (gazeLX + gazeRX) / 2, eyeDirectionY: (gazeLY + gazeRY) / 2, leftEye, rightEye };
  }

  // ── Public: estimate attention for current video frame ───────────────────
  // Serialised — if called while a previous estimate is in flight, returns the
  // last cached reading instead of racing with MediaPipe's onResults callback.
  async estimate(video: HTMLVideoElement, baseline: BaselinePose | null): Promise<AttentionReading> {
    if (this.isEstimating) {
      return this.lastReading ?? blankReading(['Camera initialising…']);
    }
    if (!this.mesh || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      return blankReading(['Camera is still warming up.']);
    }

    this.isEstimating = true;
    try {
      const reading = await this._estimate(video, baseline);
      this.lastReading = reading;
      return reading;
    } finally {
      this.isEstimating = false;
    }
  }

  private async _estimate(video: HTMLVideoElement, baseline: BaselinePose | null): Promise<AttentionReading> {
    const frameW = video.videoWidth;
    const frameH = video.videoHeight;
    const roi = this.getDetectionRoi(frameW, frameH);

    // 1. Draw face ROI into analysis canvas
    this.analysisCtx.drawImage(video, roi.x, roi.y, roi.width, roi.height, 0, 0, INPUT_SIZE, INPUT_SIZE);

    // 2. Analyse lighting from the face ROI — BEFORE enhancement so we measure raw conditions
    const { dark, backlit, lightingCondition } = this.analyzeLighting();

    // 3. Enhance if needed (gamma boost for dark, shadow-lift for backlit)
    this.enhanceCanvas(dark, backlit);

    // 4. Send enhanced frame to MediaPipe
    const result    = await this.detectWithMesh();
    const landmarks = result?.multiFaceLandmarks?.[0];

    if (!landmarks || landmarks.length < 10) {
      this.smoothedLandmarks = null;
      const guidance: string[] = [];
      if (dark)    guidance.push('Too dark — move to a brighter spot or turn on a light');
      if (backlit) guidance.push('Backlit — move the bright light source from behind you');
      if (!dark && !backlit) guidance.push('No face detected — centre yourself in the camera');
      return blankReading(guidance, lightingCondition);
    }

    // 5. Map normalised landmarks back to full-frame coordinates
    const mapped = landmarks.map((p) => ({
      x: (roi.x + p.x * roi.width)  / frameW,
      y: (roi.y + p.y * roi.height) / frameH,
      z: p.z
    }));

    // 6. EMA smoothing for stable visualisation
    if (!this.smoothedLandmarks || this.smoothedLandmarks.length !== mapped.length) {
      this.smoothedLandmarks = mapped.map((p) => ({ ...p }));
    } else {
      for (let i = 0; i < mapped.length; i++) {
        this.smoothedLandmarks[i].x += LANDMARK_SMOOTH * (mapped[i].x - this.smoothedLandmarks[i].x);
        this.smoothedLandmarks[i].y += LANDMARK_SMOOTH * (mapped[i].y - this.smoothedLandmarks[i].y);
        this.smoothedLandmarks[i].z  = mapped[i].z;
      }
    }
    const vis = this.smoothedLandmarks;

    // 7. Face bounding box
    const xs = mapped.map((p) => p.x);
    const ys = mapped.map((p) => p.y);
    const minX = clamp(Math.min(...xs), 0, 1);
    const maxX = clamp(Math.max(...xs), 0, 1);
    const minY = clamp(Math.min(...ys), 0, 1);
    const maxY = clamp(Math.max(...ys), 0, 1);

    const faceBox: PixelBox = {
      x: minX * frameW, y: minY * frameH,
      width:  (maxX - minX) * frameW,
      height: (maxY - minY) * frameH
    };
    this.roi = faceBox;

    // 8. Head pose, in units that do not change with distance or aspect ratio
    const lEye = mapped[33]  ?? mapped[0];
    const rEye = mapped[263] ?? mapped[0];
    const nose = mapped[1]   ?? mapped[4] ?? mapped[0];
    const { yaw, pitch, roll } = headPose(nose, lEye, rEye, frameW, frameH);

    // 9. Landmark stability (for confidence scoring)
    let landmarkStability = 0.7;
    if (this.previousLandmarks) {
      let sumDelta = 0;
      const n = Math.min(this.previousLandmarks.length, mapped.length);
      for (let i = 0; i < n; i++) {
        sumDelta += Math.hypot(
          mapped[i].x - this.previousLandmarks[i].x,
          mapped[i].y - this.previousLandmarks[i].y
        );
      }
      landmarkStability = clamp(1 - (sumDelta / Math.max(n, 1)) * 18, 0, 1);
    }
    this.previousLandmarks = mapped;

    // 10. Eye metrics
    const eye = this.getEyeMetrics(mapped, vis);

    // 11. Composite confidence score
    const sizeScore    = clamp((faceBox.width * faceBox.height) / (frameW * frameH * 0.12), 0, 1);
    // Weights put a face 55 cm from a 16:9 webcam where the old frame-unit formula did.
    const poseScore    = clamp(1 - Math.abs(yaw) * 0.4 - Math.abs(pitch) * 0.6, 0, 1);
    const eyeOpenScore = clamp(eye.eyeOpenRatio / 0.13, 0, 1);
    // Light score less punishing now that we enhance the frame
    const lightScore   = (dark || backlit) ? 0.80 : 1.0;
    const confidence   = clamp(
      sizeScore * 0.35 + landmarkStability * 0.30 + poseScore * 0.20 + eyeOpenScore * 0.10 + lightScore * 0.05,
      0, 1
    );

    // 12. Guidance hints
    const guidance: string[] = [];
    if (sizeScore < 0.45) guidance.push('Face too small — move closer');

    const faceNearEdge =
      minX < 0.04 || minY < 0.04 || maxX > 0.96 || maxY > 0.96;
    const faceHardOff  =
      minX < 0.01 || maxX > 0.99; // face centre is mostly off-frame

    if (faceNearEdge && !faceHardOff) guidance.push('Face near edge — centre yourself');
    if (dark)    guidance.push('Low light — try a brighter room or face a lamp');
    if (backlit) guidance.push('Backlit — avoid strong lights behind you');
    if (confidence < 0.45 && !dark && !backlit) guidance.push('Low detection confidence');

    // 13. Early return without baseline (calibration phase)
    if (!baseline) {
      return {
        facePresent: true, confidence, yaw, pitch, roll,
        attention: 'uncertain', guidance, faceBox,
        eyeDirectionX: eye.eyeDirectionX, eyeDirectionY: eye.eyeDirectionY,
        eyeOpenRatio: eye.eyeOpenRatio,
        eyesFocused: true,
        leftEye: eye.leftEye, rightEye: eye.rightEye,
        lightingCondition
      };
    }

    // 14. Classify attention relative to calibration baseline
    const eyeDeltaX  = Math.abs(eye.eyeDirectionX - baseline.eyeCenterX);
    const eyeDeltaY  = Math.abs(eye.eyeDirectionY - baseline.eyeCenterY);
    const eyesClosed = eye.eyeOpenRatio < baseline.eyeOpenRatio * EYE_CLOSED_RATIO;
    const eyesFocused = !eyesClosed && eyeDeltaX <= GAZE_OFFSCREEN_X && eyeDeltaY <= GAZE_OFFSCREEN_Y;

    const turn = headTurn({ yaw, pitch, roll }, { yaw: baseline.yaw, pitch: baseline.pitch, roll: baseline.roll ?? 0 });
    const extremeHead  = turn === 'extreme';
    const moderateHead = turn !== 'none';

    let attention: AttentionReading['attention'] = 'focused';

    if (confidence < MIN_CONFIDENCE) {
      attention = 'uncertain';
    } else if (faceHardOff) {
      // Face has largely left the camera frame
      attention = 'offscreen';
      guidance.push('Face off screen — return to camera');
    } else if (eyesClosed || eyeDeltaX > GAZE_OFFSCREEN_X || eyeDeltaY > GAZE_OFFSCREEN_Y || extremeHead) {
      attention = 'offscreen';
    } else if (eyeDeltaX > GAZE_WARNING_X || eyeDeltaY > GAZE_WARNING_Y || moderateHead) {
      attention = 'warning';
      if (!guidance.length) guidance.push('Gaze shifted — look at the screen');
    }

    return {
      facePresent: true, confidence, yaw, pitch, roll,
      attention, guidance, faceBox,
      eyeDirectionX: eye.eyeDirectionX, eyeDirectionY: eye.eyeDirectionY,
      eyeOpenRatio: eye.eyeOpenRatio,
      eyesFocused,
      leftEye: eye.leftEye, rightEye: eye.rightEye,
      lightingCondition
    };
  }

  // ── Static: build a baseline pose from calibration readings ─────────────
  static buildCalibration(
    readings: AttentionReading[],
    frameW: number,
    frameH: number
  ): CalibrationReport {
    if (!readings.length) {
      return { ok: false, reason: 'No calibration frames captured.', confidence: 0, baseline: null, sampleCount: 0, detectionRate: 0 };
    }

    const present       = readings.filter((r) => r.facePresent && r.faceBox);
    const detectionRate = present.length / readings.length;

    if (detectionRate < MIN_CALIBRATION_DETECTION_RATE) {
      return {
        ok: false,
        reason: `Face detected in ${present.length}/${readings.length} frames (${Math.round(detectionRate * 100)}%). Hold still, face the camera, and improve lighting.`,
        confidence: detectionRate,
        baseline: null,
        sampleCount: readings.length,
        detectionRate
      };
    }

    const avgConfidence = present.reduce((s, r) => s + r.confidence, 0) / present.length;
    if (avgConfidence < MIN_CALIBRATION_CONFIDENCE) {
      return {
        ok: false,
        reason: 'Detection quality too low. Move closer to the camera or improve lighting.',
        confidence: avgConfidence,
        baseline: null,
        sampleCount: readings.length,
        detectionRate
      };
    }

    const avg = <K extends keyof AttentionReading>(key: K) =>
      present.reduce((s, r) => s + (r[key] as number), 0) / present.length;

    const sumBox = present.reduce(
      (acc, r) => {
        const b = r.faceBox!;
        acc.x += b.x; acc.y += b.y; acc.width += b.width; acc.height += b.height;
        return acc;
      },
      { x: 0, y: 0, width: 0, height: 0 }
    );
    const n = present.length;

    const baseline: BaselinePose = {
      centerX:     clamp((sumBox.x / n + sumBox.width  / n / 2) / frameW, 0, 1),
      centerY:     clamp((sumBox.y / n + sumBox.height / n / 2) / frameH, 0, 1),
      yaw:         avg('yaw'),
      pitch:       avg('pitch'),
      roll:        avg('roll'),
      eyeCenterX:  avg('eyeDirectionX'),
      eyeCenterY:  avg('eyeDirectionY'),
      eyeOpenRatio: avg('eyeOpenRatio'),
      faceBox: {
        x:      sumBox.x      / n,
        y:      sumBox.y      / n,
        width:  sumBox.width  / n,
        height: sumBox.height / n
      }
    };

    return { ok: true, confidence: avgConfidence, reason: '', baseline, sampleCount: readings.length, detectionRate };
  }
}
