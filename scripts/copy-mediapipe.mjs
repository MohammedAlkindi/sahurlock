// Copies the pinned MediaPipe Face Mesh runtime from node_modules into
// public/vendor so the app serves it from its own origin. Runs before dev and
// build (see package.json). The copy is generated, so it is gitignored.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'node_modules', '@mediapipe', 'face_mesh');
const target = join(root, 'public', 'vendor', 'mediapipe', 'face_mesh');

if (!existsSync(source)) {
  console.error('copy-mediapipe: @mediapipe/face_mesh is not installed. Run npm ci first.');
  process.exit(1);
}

const runtime = readdirSync(source).filter((file) =>
  /\.(js|wasm|data|binarypb)$/.test(file),
);

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
for (const file of runtime) cpSync(join(source, file), join(target, file));

console.log(`copy-mediapipe: ${runtime.length} files to public/vendor/mediapipe/face_mesh`);
