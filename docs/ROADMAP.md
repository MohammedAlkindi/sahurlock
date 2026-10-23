# Roadmap

SahurLock is growing from a focus timer into a student toolkit: focus sessions,
tasks, notes, flashcards and scheduling in one place. The next major tool is Scan,
a notes app for handwritten and tablet notes: capturing, recognizing, organizing
and planning them all happen there, and cleanup and PDF export are only its first
steps. Everything runs in the browser. No feature depends on a paid API or a
hosted model. Recognition uses small task-specific models that run on the device,
never a general-purpose or chat language model. Camera frames and notes stay on
the device unless the user opts in.

Work top to bottom. Each item is one shippable change: lint, typecheck, tests
and build pass before it lands on `main`. Mark an item done with the commit
that shipped it.

## Phase 1: foundation

- [x] Unit tests for the pure modules: session state machine, focus score,
      flashcard scheduling, formatting (bc621ff)
- [x] Turn the camera off and stop every loop when leaving the session page (14a9a26)
- [x] Keep the camera feed alive when it is hidden (9690e98)
- [x] CI on every push: lint, typecheck, test, build (f0ac53a)
- [x] Retry Calibration reuses the existing stream instead of a new, empty `<video>`
      (6f31b68)
- [x] Play a custom punishment video from its IndexedDB copy (ae1aff0) (the session uses the
      literal string `custom` as the video source today)
- [x] Stop the timer double-counting while the window is blurred but visible, and make
      `finishSession` idempotent so one session cannot write two history entries
      (bc88013)
- [x] Stop counting uncertain frames as focused time (708dc35)
- [x] Measure head pose in units that hold at any distance, with fixtures projected from
      MediaPipe's canonical face model
- [ ] Try the head-pose limits in a real webcam session and adjust them if turning or
      nodding is flagged too early or too late (needs a person at a camera)
- [x] Self-host a pinned MediaPipe build, so no third-party script sees camera frames
      (2d29870)
- [x] Add a Content Security Policy that keeps it that way (103d70a)
- [x] Harden the scheduler: feature-detect `Notification`, split timeouts longer than
      2^31 ms, use an icon that exists, arm new schedules without a reload (c0652ce)
- [x] Move Spotify login to PKCE so no client secret is needed. The refresh route stays
      as a secretless proxy, so the client needs no new origin in the security policy
- [x] Make the README, landing page and settings text match the code (ccdd3f9) (warning
      threshold, recovery time, the "no backend" claim, the iris tracking toggle)
- [x] Export and "clear everything" cover every key and the IndexedDB video store
      (04d0371)
- [x] Validate stored data on load instead of casting it, so one malformed key can no
      longer crash every page
- [ ] Version the storage format, with migrations, when the first stored shape changes
- [x] Accessibility pass: dialog semantics and focus traps, an alert role on the
      violation overlay, reduced motion, one `<main>`, modifier-free shortcuts made
      optional, contrast, checked by an axe scan of every route in both themes, empty
      and with data (cfd2e9a, 81670b9, b89c2f9, 7c240ee)
- [x] Make Tailwind opacity modifiers work on theme colors, so backdrops, dividers and
      selected states render as written (5ffce14)
- [x] Give form fields a border that meets 3:1 against the page (WCAG 1.4.11). The
      shared `border-border` is about 1.3:1
- [x] Show row actions (edit, delete) on touch screens, where there is no hover
- [x] Browser tests for the camera lifecycle (start, hide and show, retry, leave the
      page), the detector, the security policy and the scheduler (6b05d93)
- [ ] Run the browser tests in CI (a CI change, so it needs the owner's OK)
- [x] A synthetic-face fixture so browser tests can reach the focused state: MediaPipe's
      canonical face, posed and projected, stands in for the face mesh model in tests
- [x] Remove dead code and keep a single default configuration (6ede0dd)
- [x] Upgrade Next.js to the latest 14.2 release and pin the Node version (b457065)
- [x] Move to Next.js 15.5.28 (React 19) to clear the advisories 14.2 will not get
      fixes for. The unused image optimizer stays off
- [x] Replace `next lint` with the ESLint CLI before Next.js 16, which removes it
- [x] Upgrade Vitest to 5, clearing the two critical tinypool advisories
- [ ] Upgrade the dev tools that still carry advisories: Tailwind CSS 4 (braces,
      micromatch), and the Next.js ESLint plugin once a release drops its old fast-glob.
      Neither ships to the browser
- [x] A tool registry (`src/lib/tools.ts`) that drives the sidebar, command palette and
      breadcrumb, so a new tool is registered in one place
- [ ] Move tool code into `tools/` and shared code into `core/` once Scan
      shows where the seams are. Moving files before then is churn without a payoff

## Phase 2: notes import, no ML yet

- [x] Upload a photo and see it cleaned: page detection, perspective correction,
      illumination flattening, deskew, ruled-line removal, before and after view
- [x] Scan several pages and save them as one PDF on A4 or Letter
- [x] Accept PDF pages too, through pdf.js (its legacy build, for older browsers)
- [x] Save scans to an on-device library, covered by Clear everything
- [ ] Organize saved scans: rename, reorder and regroup pages, file them by course
- [ ] Versioned Document JSON for a converted page: blocks with bounding boxes,
      content, per-token confidence and alternatives
- [ ] Layout styles (outline, Cornell, two-column) with print-ready PDF and
      Markdown export

## How the models are built

Phases 3 to 7 follow one plan:

- Fine-tune small open models whose licences have been checked. Never train from
  scratch. Each release replaces the previous starting point with SahurLock's own
  fine-tuned version.
- The first training set is the maintainer's own course notes: handwriting,
  equations, graphs and diagrams. Anyone else's pages arrive only by opt-in
  donation (phase 8).
- The correction screen is the labeling tool, so daily use builds the training set.
- A held-out set of real pages that no model trains on decides every release: a new
  version ships only when it beats the current one there.
- Training code lives in this repository and runs on a hosted notebook GPU, never
  in the app or in CI.

## Phase 3: model groundwork

- [ ] Web Worker model host: ONNX Runtime Web and transformers.js, WebGPU with a
      WASM fallback, weights pinned by SHA-256 in a manifest and cached locally
- [ ] Correction screen: draw a box around a region, mark it as text, math, graph,
      diagram, table or heading, and fix a misread word. Each change saves a
      labeled example on the device (the crop, the label, the model version and its
      confidence), and the examples export as a dataset file. Ships with the first
      model at the latest
- [ ] Held-out evaluation set with character error rate for text, expression error
      rate for math, and precision and recall for regions
- [ ] Training code under `training/`, with a model card for every published version

## Phase 4: region detection

- [ ] Fine-tune a layout detector on note pages: text, math, graph, diagram, table,
      heading. Existing layout models were trained on printed pages, so this step
      helps most
- [ ] Reading order across regions (XY-cut)

## Phase 5: handwriting

- [ ] Line detection and handwriting recognition with per-line confidence
- [ ] Review: low-confidence spans highlighted with the source crop and
      alternatives. Anything skipped keeps the original image, so nothing is lost

## Phase 6: math

- [ ] Math regions to LaTeX, rendered with KaTeX. A failed parse counts as low
      confidence
- [ ] Word (.docx) export, with equations as native Word math

## Phase 7: graphs and diagrams

- [ ] Graphs, diagrams and drawings kept as cleaned, optionally vectorized crops
      with their labels recognized
- [ ] Recognize shapes and arrows

## Phase 8: learning from other users

- [ ] Opt-in donation per document: crops only, location data stripped, redaction
      preview, consent record, revocation and an age gate

## Phase 9: search

- [ ] Search across converted notes with page-level citations

Design notes for phases 2 to 8 are in [notes-converter.md](notes-converter.md).
