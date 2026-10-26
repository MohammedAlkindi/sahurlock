# Training

Turns a labels download from Scan ("Download labels" under Saved scans) into
training sets for SahurLock's own models. It runs on a laptop or a hosted notebook
GPU, never in the app and not in CI. The download's format is described in
[docs/notes-converter.md](../docs/notes-converter.md) and written by
`src/lib/scan/dataset.ts`.

## Setup

```bash
python -m venv training/.venv
. training/.venv/bin/activate
pip install -r training/requirements.txt
```

On Windows, in Git Bash, the venv keeps its programs in `Scripts` instead of `bin`.
Ask pip for wheels only, since there is no C compiler to build pycocotools from source:

```bash
python -m venv training/.venv
training/.venv/Scripts/python -m pip install --only-binary=:all: -r training/requirements.txt
training/.venv/Scripts/python training/prepare.py check sahurlock-labels-2026-10-23.zip
```

## Check a download

```bash
python training/prepare.py check sahurlock-labels-2026-10-23.zip
```

It stops with a message if the file's format or Document version is not one it
knows, if its kinds differ from this script's (class numbers would shift), or if
any image's hash, size, or region boxes do not add up.

## Build the region detector's set

```bash
python training/prepare.py detector sahurlock-labels-2026-10-23.zip out
```

- `out/detector/` is the COCO detection set to train on:
  `annotations/instance_train.json`, `instance_val.json` and `images/<sha256>.jpg`.
  That is the folder layout PaddleX's COCO detection datasets use.
- `out/held-out/` holds the test pages the same way (`annotations/instance_test.json`
  and their images). They sit in a folder of their own so that nothing a training job
  is given contains a test page.
- Category ids are the app's kinds in order, starting at 1: text, heading, math,
  table, graph, diagram. Every file lists all six.
- Only pages marked "Every region on this page is marked" go in, since anything
  unboxed on them is background. Such a page with no regions is kept as a
  negative example, and PaddleDetection needs `allow_empty: true` to use it.
- `out/split.json` records each page's split under the rule `sha256-mod100-v1`:
  the first 8 hex digits of the image's SHA-256, modulo 100, under 10 is test,
  under 20 is val, the rest train. A page keeps its split in every export.
- A train page that looks like a val or test page is dropped and listed with the
  page it matched, since it is likely the same page cleaned or photographed twice.
  Held-out pages are never moved into training. The comparison uses the ink alone,
  cropped to its bounds, as a 32 x 32 grid with each row's and column's mean taken
  out, and drops at a correlation of 0.5 or more. A whole-page hash would not do
  here: cleaned pages are mostly white, so it sees most sparse pages as one. Pages
  with almost no ink, blank negatives among them, are left out of the comparison.
  The threshold was set on synthetic pages, so look over the listed matches on
  real ones.

## Score a detector on the held-out pages

```bash
python training/evaluate.py out/held-out/annotations/instance_test.json predictions.json
```

`predictions.json` is the model's output on the held-out images as a COCO results
list: one `{"image_id", "category_id", "bbox": [x, y, width, height], "score"}` per
box, with the image ids from `instance_test.json`. It prints, for each kind and for
all of them, the true boxes, true and false positives, precision and recall at an IoU
of 0.5 among boxes scoring 0.5 or more, and COCO average precision (AP over IoU 0.5 to
0.95, and AP50) over every box. `--iou`, `--min-score` and `--json` change those, and
`--split val` scores the val pages while tuning.

It refuses a file that is not that split under `sha256-mod100-v1`, so a training or
val file cannot be scored as the held-out set by mistake, and predictions on images
the file does not have.

## Training notes

- Fine-tune, never train from scratch. For regions, start from PP-DocLayout-S or
  -M (Apache-2.0) through PaddleX, with `out/detector` as the dataset folder.
- Never give a training job `out/held-out`. Score on it in a separate step with
  `evaluate.py`, never as the validation set, and ship a model only when it beats the
  current one there.
- Do not use the `ultralytics` or DocLayout-YOLO packages: their code is AGPL-3.0.
- Handwriting models fine-tuned on IAM are for non-commercial research only.
- Each published model gets a model card listing the SHA-256 of every page it
  trained on, and a SHA-256 in the app's weight manifest.

The recognizers' sets (line crops and text for handwriting, crops and LaTeX for
math) come later, built from the same `pages.jsonl`. TexTeller's example training
script makes its own random split and starts from scratch by default, so it must be
given train-split crops only and pointed at the pretrained checkpoint.

## Tests

```bash
pip install -r training/requirements-dev.txt
python -m pytest training/tests
```

They build downloads with Python's own `zipfile` in the app's layout, load the COCO
files with pycocotools, and score synthetic predictions with `evaluate.py`.
