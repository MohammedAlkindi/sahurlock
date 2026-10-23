# Notes converter: design notes

Goal: a student uploads handwritten or tablet notes, picks a layout, and gets
clean notes to print or keep as a PDF and as a format most devices open. Text,
math, diagrams and graphs are recognized by models the project controls. No
third-party API and no hosted language model.

These notes record the constraints found while planning. Re-check every licence
and platform limit before shipping the step that depends on it.

## Where inference runs

In the browser, in a Web Worker. Vercel Functions have no GPU and limits on
bundle size, request body and duration that do not fit 100 to 300 MB of model
weights plus multi-megabyte photos. Check the current limits in Vercel's
documentation before relying on that comparison.

- ONNX Runtime Web for detectors, transformers.js for encoder-decoder
  recognizers, WebGPU first with a WASM fallback.
- Quantized (q8 or fp16) ONNX weights served from storage the project controls,
  pinned by SHA-256 in a manifest and cached in the browser. Never in git.

## Pipeline

1. Decode: images directly, PDFs through pdf.js, which also reads vector ink from
   GoodNotes and Notability exports. HEIC decodes natively only in Safari.
2. Find the page outline and correct perspective.
3. Flatten illumination by estimating the background and dividing it out.
4. Deskew with a projection-profile search.
5. Binarize for analysis only. Recognizers still get grayscale.
6. Remove ruled and grid lines with a morphological opening.
7. Detect regions: text, math, diagram, graph, table, heading.
8. Detect lines in text regions and run the recognizer for each region type.
9. Order regions for reading (XY-cut).
10. Write the Document JSON: per block, its box, crop reference, content,
    per-token confidence and alternatives.

## Unreadable regions

Confidence comes from token probabilities, calibrated on held-out data. LaTeX
that fails to parse is low confidence by definition. Low-confidence spans are
highlighted next to the source crop with alternatives and an edit box. A span
the user skips keeps the original crop in the output, so nothing is guessed and
nothing is dropped. Each correction is stored on the device as crop, prediction,
label, model version and confidence, and becomes training data only if the user
donates it.

## Candidate models

| Job | Candidate | Licence note |
|---|---|---|
| Text detection | PP-OCRv5 detection, docTR or OnnxTR | Apache-2.0 |
| Handwriting | TrOCR small handwritten (ONNX port), PyLaia IAM | Model cards say MIT, but both are fine-tuned on IAM (see the data note below) |
| Math | TexTeller, pix2tex | Apache-2.0 and MIT. pix2tex is weaker on handwriting |
| Layout | PP-DocLayout, DocLayout-YOLO weights | Apache-2.0. DocLayout-YOLO's package derives from AGPL code, so export to ONNX and do not ship or train with that package. Both were trained on printed documents and need fine-tuning on notes |

Avoid: Surya (non-commercial weights, GPL code), potrace and Pandoc builds (GPL)
in the shipped app.

The recognizers above have small task-specific decoders. They are not general
language models, but where to draw that line is a product decision to make
explicitly.

## Training data

- IAM and IAM-OnDB: non-commercial research only. Models fine-tuned on them carry
  that restriction whatever their model card says, so they are a research
  preview, not the shipped default.
- MathWriting: CC BY-NC-SA. HME100K: redistribution restricted. CROHME: research
  distribution with unclear commercial terms. Get written permission first.
- Usable: GNHK (photographed English notes, CC BY 4.0), DocLayNet (printed layout,
  CDLA-Permissive), synthetic pages rendered from open handwriting fonts and LaTeX
  with paper and lighting augmentation, and consented user donations.

## Output formats

- PDF: print CSS with KaTeX first. Later, Typst compiled to WebAssembly or pdf-lib
  for byte-identical files.
- Portable notes: Markdown with `$...$` math and an assets folder, zipped. Obsidian,
  Notion, Joplin, Typora and Pandoc read it.
- Word: the `docx` package. Converting LaTeX to Word's native equations is the hard
  part.
- GoodNotes and Notability formats are proprietary, so import the PDF instead.

## Learning without collecting by default

Training in the browser is not practical. In order of adoption:

1. Personalize without training: bias decoding toward a lexicon built from the
   user's own corrections and keep per-user thresholds.
2. Opt-in donation per document, crops only, with location data stripped, a
   redaction preview, a consent record (scope, policy version, item hashes,
   time), revocation and an age gate. Fine-tune offline and publish model cards.
3. Per-user adapters later. They need stored data and larger downloads.
4. Federated learning only with a native client.

## Scope

A weekend gets one page: cleanup with a before and after view, line detection
and a small handwriting model in a worker, highlighted low-confidence text with
editing, math and diagrams boxed by hand and kept as cleaned images, and PDF
plus Markdown export. Expect neat print-like handwriting to work and cursive,
math and dense layouts to fail.

A quarter gets multi-page PDFs, a layout detector fine-tuned on one to two
thousand labelled pages, math recognition with KaTeX validation, diagram
cleanup, layout templates, Word export, the correction store and donation flow,
a handwriting model fine-tuned on licence-clean data, and character and
expression error rates measured in CI.
