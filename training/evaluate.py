"""Score a region detector's predictions on the held-out test pages.

    python training/evaluate.py out/held-out/annotations/instance_test.json predictions.json

The first file is the held-out set `prepare.py detector` wrote. The second is a
COCO results list, one {"image_id", "category_id", "bbox": [x, y, width, height],
"score"} per predicted box, with image ids from the first file. It prints, per kind,
precision and recall at an IoU of 0.5 among boxes scoring 0.5 or more, and COCO
average precision over all scores. Run it on the test pages only after training
is finished, and never feed its results back into training.
"""

from __future__ import annotations

import argparse
import contextlib
import io
import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from prepare import KINDS, SPLIT_RULE, split_of  # noqa: E402

IOU = 0.5
MIN_SCORE = 0.5


class EvaluationError(Exception):
    """The files cannot be scored as they are."""


# ---- Checks: no pycocotools, so they are tested directly. ----


def check_held_out(ground_truth: dict, split: str = "test") -> None:
    """Refuse a file that is not the split it is scored as: every image must fall in `split` under the split rule."""
    if (ground_truth.get("info") or {}).get("version") != SPLIT_RULE:
        raise EvaluationError(f"the file was not split by {SPLIT_RULE}, so its pages may have been trained on")
    categories = sorted(ground_truth.get("categories") or [], key=lambda c: c.get("id", 0))
    if [(c.get("id"), c.get("name")) for c in categories] != [(i + 1, kind) for i, kind in enumerate(KINDS)]:
        raise EvaluationError(f"the file's categories differ from this script's kinds {KINDS}")
    is_sha = lambda s: isinstance(s, str) and len(s) == 64
    outside = [image for image in ground_truth.get("images") or [] if not is_sha(image.get("sha256")) or split_of(image["sha256"]) != split]
    if outside:
        raise EvaluationError(f"{len(outside)} of the file's pages are not {split} pages under {SPLIT_RULE}")


def check_predictions(predictions: object, ground_truth: dict) -> list[dict]:
    """The predictions as a list of boxes, each on an image of the file and one of the kinds."""
    if not isinstance(predictions, list):
        raise EvaluationError("the predictions are not a COCO results list")
    images = {image["id"] for image in ground_truth.get("images") or []}
    whole = lambda v: isinstance(v, int) and not isinstance(v, bool)
    for number, p in enumerate(predictions, start=1):
        if not isinstance(p, dict) or not whole(p.get("image_id")) or p["image_id"] not in images:
            raise EvaluationError(f"prediction {number} is not on an image of the held-out file")
        if not whole(p.get("category_id")) or not 1 <= p["category_id"] <= len(KINDS):
            raise EvaluationError(f"prediction {number} has an unknown category {p.get('category_id')!r}")
        box = p.get("bbox")
        if not (isinstance(box, list) and len(box) == 4 and all(isinstance(v, (int, float)) for v in box) and box[2] > 0 and box[3] > 0):
            raise EvaluationError(f"prediction {number} has no proper bbox")
        score = p.get("score")
        if not isinstance(score, (int, float)) or not 0 <= score <= 1:
            raise EvaluationError(f"prediction {number} has no score between 0 and 1")
    return predictions


# ---- Scoring, through pycocotools. ----


def score(ground_truth: dict, predictions: list[dict], iou: float = IOU, min_score: float = MIN_SCORE) -> dict:
    """
    Per kind, and for all kinds together: the true boxes, true and false
    positives at `iou` among predictions scoring `min_score` or more,
    precision and recall from those, and COCO AP (IoU 0.5 to 0.95) and AP50
    over every prediction, which for all kinds is their mean, as COCO reports
    it. A rate with nothing to divide by is None, and AP is 0 for a kind with
    boxes but no predictions.
    """
    import numpy as np
    from pycocotools.coco import COCO
    from pycocotools.cocoeval import COCOeval

    with contextlib.redirect_stdout(io.StringIO()):
        gt = COCO()
        gt.dataset = json.loads(json.dumps(ground_truth))
        gt.createIndex()
        tally = {kind: {"boxes": 0, "true_positives": 0, "false_positives": 0, "ap": None, "ap50": None} for kind in KINDS}
        for a in ground_truth.get("annotations") or []:
            if not a.get("iscrowd"):
                tally[KINDS[a["category_id"] - 1]]["boxes"] += 1
        overall = {"ap": None, "ap50": None}
        if not predictions:
            # Nothing was found, so every kind on these pages scores 0.
            for row in tally.values():
                if row["boxes"]:
                    row["ap"] = row["ap50"] = 0.0
            if any(row["boxes"] for row in tally.values()):
                overall = {"ap": 0.0, "ap50": 0.0}
        else:
            # AP and AP50 as COCO scores them, over every prediction and at most 100 per page and kind.
            evaluation = COCOeval(gt, gt.loadRes(json.loads(json.dumps(predictions))), "bbox")
            evaluation.params.catIds = list(range(1, len(KINDS) + 1))
            evaluation.evaluate()
            evaluation.accumulate()
            thresholds = evaluation.params.iouThrs
            t = int(np.argmin(np.abs(thresholds - iou)))
            if abs(thresholds[t] - iou) > 1e-9:
                raise EvaluationError(f"IoU {iou} is not one of COCO's thresholds 0.5, 0.55, ... 0.95")
            t50 = int(np.argmin(np.abs(thresholds - 0.5)))
            precision = evaluation.eval["precision"]
            for k, kind in enumerate(KINDS):
                every = precision[:, :, k, 0, -1]
                at50 = precision[t50, :, k, 0, -1]
                if (every > -1).any():
                    tally[kind]["ap"] = round(float(every[every > -1].mean()), 4)
                    tally[kind]["ap50"] = round(float(at50[at50 > -1].mean()), 4)
            every = precision[:, :, :, 0, -1]
            at50 = precision[t50, :, :, 0, -1]
            if (every > -1).any():
                overall = {"ap": round(float(every[every > -1].mean()), 4), "ap50": round(float(at50[at50 > -1].mean()), 4)}

            # True and false positives among the predictions scoring min_score or more, with no cap on how
            # many a page holds. Matching goes from the highest score down, so leaving out the low scores
            # does not change what the rest match.
            kept = [p for p in predictions if p["score"] >= min_score]
            if kept:
                counting = COCOeval(gt, gt.loadRes(json.loads(json.dumps(kept))), "bbox")
                counting.params.catIds = list(range(1, len(KINDS) + 1))
                counting.params.areaRng = counting.params.areaRng[:1]
                counting.params.areaRngLbl = counting.params.areaRngLbl[:1]
                counting.params.maxDets = [max(Counter((p["image_id"], p["category_id"]) for p in kept).values())]
                counting.evaluate()
                for e in counting.evalImgs:
                    if e is None:
                        continue
                    kind = tally[KINDS[e["category_id"] - 1]]
                    for matched, ignored in zip(e["dtMatches"][t], e["dtIgnore"][t]):
                        if not ignored:
                            kind["true_positives" if matched > 0 else "false_positives"] += 1

    def rates(row: dict) -> dict:
        found = row["true_positives"] + row["false_positives"]
        return {
            **row,
            "precision": round(row["true_positives"] / found, 4) if found else None,
            "recall": round(row["true_positives"] / row["boxes"], 4) if row["boxes"] else None,
        }

    total = {key: sum(tally[k][key] for k in KINDS) for key in ("boxes", "true_positives", "false_positives")}
    return {
        "iou": iou,
        "min_score": min_score,
        "pages": len(ground_truth.get("images") or []),
        "kinds": {kind: rates(row) for kind, row in tally.items()},
        "all": rates({**total, **overall}),
    }


def table(result: dict) -> str:
    """The result as a plain table, one row per kind and one for all of them."""
    show = lambda v: "-" if v is None else f"{v:.3f}" if isinstance(v, float) else str(v)
    rows = [("kind", "boxes", "TP", "FP", "precision", "recall", "AP", "AP50")]
    for name, row in [*result["kinds"].items(), ("all", result["all"])]:
        rows.append((name, *(show(row[k]) for k in ("boxes", "true_positives", "false_positives", "precision", "recall", "ap", "ap50"))))
    widths = [max(len(r[i]) for r in rows) for i in range(len(rows[0]))]
    head = f"{result['pages']} pages, IoU {result['iou']}, score {result['min_score']} or more"
    return "\n".join([head, *("  ".join(cell.ljust(w) for cell, w in zip(r, widths)).rstrip() for r in rows)])


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("ground_truth", type=Path, help="instance_test.json from prepare.py detector")
    parser.add_argument("predictions", type=Path, help="COCO results JSON")
    parser.add_argument("--split", choices=("test", "val"), default="test", help="the split the file holds (val while tuning)")
    parser.add_argument("--iou", type=float, default=IOU)
    parser.add_argument("--min-score", type=float, default=MIN_SCORE)
    parser.add_argument("--json", action="store_true", help="print the result as JSON")
    args = parser.parse_args(argv)
    try:
        try:
            ground_truth = json.loads(args.ground_truth.read_text(encoding="utf-8"))
            predictions = json.loads(args.predictions.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise EvaluationError(f"cannot read the files: {error}") from error
        check_held_out(ground_truth, args.split)
        result = score(ground_truth, check_predictions(predictions, ground_truth), args.iou, args.min_score)
    except EvaluationError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    print(json.dumps(result, indent=1) if args.json else table(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
