// Copies the pinned ONNX Runtime Web files from node_modules into
// public/vendor/onnxruntime-web/<version> so the model worker loads them from
// this app's origin, with the licence and source notices beside them. Runs
// before dev and build (see package.json). Every file is checked before any is
// written, and the script fails if the installed package or any file differs
// from src/lib/model-host/runtime-pin.json. The copy is generated, so it is gitignored.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pin = JSON.parse(readFileSync(join(root, 'src', 'lib', 'model-host', 'runtime-pin.json'), 'utf8'));
const source = join(root, 'node_modules', 'onnxruntime-web');
const notices = join(root, 'third_party', 'onnxruntime-web');
const target = join(root, 'public', 'vendor', 'onnxruntime-web', pin.version);
const NOTICES = ['LICENSE', 'ThirdPartyNotices.txt', 'SOURCE.txt'];

const fail = (message) => {
  console.error(`copy-onnxruntime: ${message}`);
  process.exit(1);
};

if (!existsSync(join(source, 'package.json'))) fail('onnxruntime-web is not installed. Run npm ci first.');
const installed = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')).version;
if (installed !== pin.version) fail(`onnxruntime-web ${installed} is installed, but runtime-pin.json pins ${pin.version}.`);

const files = new Map();
for (const { file, sha256, size } of [pin.entry, pin.glue, pin.wasm]) {
  const path = join(source, 'dist', file);
  if (!existsSync(path)) fail(`node_modules/onnxruntime-web/dist/${file} is missing.`);
  const bytes = readFileSync(path);
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (bytes.length !== size || actual !== sha256) fail(`${file} is ${bytes.length} bytes with SHA-256 ${actual}, not the pinned ${size} and ${sha256}.`);
  files.set(file, bytes);
}
for (const file of NOTICES) {
  const path = join(notices, file);
  if (!existsSync(path)) fail(`third_party/onnxruntime-web/${file} is missing.`);
  files.set(file, readFileSync(path));
}
// The notices name the release they were taken from. A new pin needs them taken again from its tag.
if (!files.get('SOURCE.txt').toString('utf8').includes(`ONNX Runtime Web ${pin.version} is built from https://github.com/microsoft/onnxruntime/tree/v${pin.version}`)) {
  fail(`third_party/onnxruntime-web is not from v${pin.version}. Take LICENSE, ThirdPartyNotices.txt and the Eigen commit in SOURCE.txt from that tag.`);
}

rmSync(join(root, 'public', 'vendor', 'onnxruntime-web'), { recursive: true, force: true });
mkdirSync(target, { recursive: true });
for (const [file, bytes] of files) writeFileSync(join(target, file), bytes);

console.log(`copy-onnxruntime: ${files.size - NOTICES.length} files and ${NOTICES.length} notices to public/vendor/onnxruntime-web/${pin.version}`);
