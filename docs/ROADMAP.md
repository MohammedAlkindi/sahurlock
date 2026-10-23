# Roadmap

SahurLock is growing from a focus timer into a student toolkit: focus sessions,
tasks, notes, flashcards and scheduling in one place, with a handwritten-notes
converter as the next major tool. Everything runs in the browser. No feature
depends on a paid API or a hosted language model, and camera frames and notes
stay on the device unless the user opts in.

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
- [ ] Scale head-pose thresholds by face size, with recorded-landmark test fixtures
- [x] Self-host a pinned MediaPipe build, so no third-party script sees camera frames
- [ ] Add a Content Security Policy that keeps it that way
- [ ] Harden the scheduler: feature-detect `Notification`, split timeouts longer than
      2^31 ms, use an icon that exists, arm new schedules without a reload
- [ ] Move Spotify to PKCE and remove the server-side refresh route
- [ ] Make the README, landing page and settings text match the code (warning
      threshold, recovery time, the "no backend" claim, the iris tracking toggle)
- [ ] Versioned storage schemas, with export and "clear everything" covering every
      key and the IndexedDB video store
- [ ] Accessibility pass: dialog semantics and focus traps, an alert role on the
      violation overlay, reduced motion, one `<main>`, modifier-free shortcuts made
      optional, contrast
- [ ] Browser tests for the camera lifecycle (start, hide and show, retry, leave the
      page) with a fake camera and a stubbed detector
- [ ] Remove dead code and keep a single default configuration
- [ ] Upgrade Next.js to the latest 14.2 release and pin the Node version
- [ ] Split the app into `tools/` and `core/` with a tool registry that drives the
      sidebar and command palette, with no behaviour change

## Phase 2: notes import, no ML yet

- [ ] Upload a photo or PDF page and see it cleaned: page detection, perspective
      correction, illumination flattening, deskew, ruled-line removal, before and
      after view
- [ ] Versioned Document JSON for a converted page: blocks with bounding boxes,
      content, per-token confidence and alternatives
- [ ] Layout styles (outline, Cornell, two-column) with print-ready PDF and
      Markdown export

## Phase 3: handwriting to text

- [ ] Web Worker model host: ONNX Runtime Web and transformers.js, WebGPU with a
      WASM fallback, weights pinned by hash in a manifest and cached locally
- [ ] Line detection and handwriting recognition with per-line confidence, shown as
      a research preview
- [ ] Review screen: low-confidence spans highlighted with the source crop and
      alternatives. Anything skipped keeps the original image, so nothing is lost

## Phase 4: math, diagrams and graphs

- [ ] Math regions to LaTeX, rendered with KaTeX. A failed parse counts as low
      confidence
- [ ] Diagrams, graphs and drawings kept as cleaned, optionally vectorized crops
- [ ] Word (.docx) export

## Phase 5: learning from corrections

- [ ] Corrections stored on the device by default
- [ ] Opt-in donation per document: crops only, location data stripped, redaction
      preview, consent record, revocation and an age gate
- [ ] Offline fine-tuning on donated and licence-clean data, outside this repository,
      published as versioned weights the app downloads

## Phase 6: search

- [ ] Search across converted notes with page-level citations

Design notes for phases 2 to 5 are in [notes-converter.md](notes-converter.md).
