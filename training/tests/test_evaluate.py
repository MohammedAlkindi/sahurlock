import hashlib
import io
import json
import sys
import zipfile
from pathlib import Path

import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import evaluate  # noqa: E402
import prepare  # noqa: E402


def sha(bucket: int, n: int = 0) -> str:
    """A page hash whose split under sha256-mod100-v1 is set by `bucket`: under 10 test, under 20 val, else train."""
    return f"{bucket:08x}" + f"{n:056x}"


def region(kind: str, box, id: str):
    x, y, w, h = box
    return {"id": id, "kind": kind, "box": {"x": x, "y": y, "width": w, "height": h}, "content": None, "tokens": [], "origin": {"by": "user"}, "reviewed": True}


def held_out(pages) -> dict:
    """COCO ground truth as prepare.py writes it, from (sha, [(kind, box)]) pairs on 400 x 500 pages."""
    return prepare.coco([
        prepare.Page(s, 400, 500, True, [region(kind, box, f"r{i}") for i, (kind, box) in enumerate(boxes)], {})
        for s, boxes in pages
    ])


def predicted(truth: dict, image: int, kind: str, box, score: float) -> dict:
    """A COCO result on the `image`-th page of `truth` (counting from 0, in the file's order)."""
    return {"image_id": truth["images"][image]["id"], "category_id": prepare.KINDS.index(kind) + 1, "bbox": list(box), "score": score}


def row(result: dict, kind: str):
    r = result["kinds"][kind]
    return r["boxes"], r["true_positives"], r["false_positives"], r["precision"], r["recall"]


def test_exact_predictions_score_full_marks():
    truth = held_out([(sha(1), [("text", (10, 10, 200, 40)), ("math", (10, 80, 120, 30))]), (sha(2), [("text", (20, 20, 300, 50))])])
    found = [{**predicted(truth, 0, "text", (10, 10, 200, 40), 0.9)}, predicted(truth, 0, "math", (10, 80, 120, 30), 0.8), predicted(truth, 1, "text", (20, 20, 300, 50), 0.7)]
    result = evaluate.score(truth, found)
    assert row(result, "text") == (2, 2, 0, 1.0, 1.0)
    assert row(result, "math") == (1, 1, 0, 1.0, 1.0)
    assert result["kinds"]["text"]["ap"] == 1.0 and result["kinds"]["math"]["ap50"] == 1.0
    # A kind with nothing on these pages has no rates rather than a zero.
    assert row(result, "heading") == (0, 0, 0, None, None) and result["kinds"]["heading"]["ap"] is None
    assert (result["all"]["boxes"], result["all"]["true_positives"], result["all"]["precision"], result["all"]["recall"]) == (3, 3, 1.0, 1.0)


def test_all_kinds_together_get_coco_average_precision_too():
    truth = held_out([(sha(1), [("text", (10, 10, 200, 40)), ("math", (10, 80, 120, 30))])])
    exact = [predicted(truth, 0, "text", (10, 10, 200, 40), 0.9), predicted(truth, 0, "math", (10, 80, 120, 30), 0.8)]
    assert (evaluate.score(truth, exact)["all"]["ap"], evaluate.score(truth, exact)["all"]["ap50"]) == (1.0, 1.0)
    # Text found, math missed: COCO's mean over the two kinds.
    half = evaluate.score(truth, exact[:1])
    assert half["kinds"]["math"]["ap"] == 0.0
    assert half["all"]["ap"] == 0.5


def test_no_predictions_score_zero_for_the_kinds_on_the_pages():
    truth = held_out([(sha(1), [("text", (10, 10, 200, 40))])])
    result = evaluate.score(truth, [])
    assert row(result, "text") == (1, 0, 0, None, 0.0)
    assert (result["kinds"]["text"]["ap"], result["kinds"]["text"]["ap50"]) == (0.0, 0.0)
    assert result["kinds"]["math"]["ap"] is None
    assert (result["all"]["ap"], result["all"]["ap50"]) == (0.0, 0.0)


def test_every_box_counts_even_past_cocos_hundred_per_page():
    truth = held_out([(sha(1), [("text", (0, 0, 10, 10))])])
    stray = [predicted(truth, 0, "text", (20 + (i % 12) * 30, 20 + (i // 12) * 30, 10, 10), 0.9) for i in range(150)]
    result = evaluate.score(truth, [predicted(truth, 0, "text", (0, 0, 10, 10), 0.6), *stray])
    assert row(result, "text") == (1, 1, 150, round(1 / 151, 4), 1.0)
    # And a page with more than 100 regions of one kind, each found.
    many = [("text", ((i % 10) * 40, (i // 10) * 40, 30, 30)) for i in range(120)]
    crowded = held_out([(sha(2), many)])
    found = [predicted(crowded, 0, "text", box, 0.9) for _, box in many]
    assert row(evaluate.score(crowded, found), "text") == (120, 120, 0, 1.0, 1.0)


def test_a_missed_box_a_stray_box_and_a_wrong_kind_each_count_against_it():
    truth = held_out([(sha(1), [("text", (10, 10, 200, 40)), ("math", (10, 80, 120, 30))]), (sha(2), [("text", (20, 20, 300, 50))])])
    found = [
        predicted(truth, 0, "text", (10, 10, 200, 40), 0.9),
        predicted(truth, 0, "table", (10, 80, 120, 30), 0.8),  # the math region, called a table
        predicted(truth, 1, "text", (50, 400, 100, 40), 0.7),  # nothing there
    ]
    result = evaluate.score(truth, found)
    assert row(result, "text") == (2, 1, 1, 0.5, 0.5)
    assert row(result, "math") == (1, 0, 0, None, 0.0)
    assert row(result, "table") == (0, 0, 1, 0.0, None)
    assert result["kinds"]["math"]["ap"] == 0.0


def test_low_scores_count_toward_average_precision_but_not_precision_and_recall():
    truth = held_out([(sha(1), [("text", (10, 10, 200, 40))])])
    result = evaluate.score(truth, [predicted(truth, 0, "text", (10, 10, 200, 40), 0.3)])
    assert row(result, "text") == (1, 0, 0, None, 0.0)
    assert result["kinds"]["text"]["ap50"] == 1.0
    assert row(evaluate.score(truth, [predicted(truth, 0, "text", (10, 10, 200, 40), 0.3)], min_score=0.25), "text") == (1, 1, 0, 1.0, 1.0)


def test_a_loose_box_matches_at_iou_one_half_and_not_at_three_quarters():
    truth = held_out([(sha(1), [("graph", (0, 0, 100, 100))])])
    loose = [predicted(truth, 0, "graph", (25, 0, 100, 100), 0.9)]  # IoU 7500 / 12500 = 0.6
    assert row(evaluate.score(truth, loose), "graph") == (1, 1, 0, 1.0, 1.0)
    assert row(evaluate.score(truth, loose, iou=0.75), "graph") == (1, 0, 1, 0.0, 0.0)
    with pytest.raises(evaluate.EvaluationError, match="thresholds"):
        evaluate.score(truth, loose, iou=0.62)


@pytest.mark.parametrize("pages, version, split, message", [
    ([sha(30)], prepare.SPLIT_RULE, "test", "not test pages"),  # a train page
    ([sha(1), sha(15)], prepare.SPLIT_RULE, "test", "1 of the file's pages are not test pages"),  # a val page among test ones
    ([sha(1)], "random-v0", "test", "was not split by"),
    ([sha(1)], prepare.SPLIT_RULE, "val", "not val pages"),
])
def test_only_the_held_out_split_is_scored(pages, version, split, message):
    truth = held_out([(s, [("text", (10, 10, 50, 20))]) for s in pages])
    truth["info"]["version"] = version
    with pytest.raises(evaluate.EvaluationError, match=message):
        evaluate.check_held_out(truth, split)


def test_val_pages_can_be_scored_as_val_while_tuning():
    evaluate.check_held_out(held_out([(sha(12), [("text", (10, 10, 50, 20))])]), "val")


def test_a_file_with_other_categories_is_refused():
    truth = held_out([(sha(1), [])])
    truth["categories"] = truth["categories"][:5]
    with pytest.raises(evaluate.EvaluationError, match="categories"):
        evaluate.check_held_out(truth)


@pytest.mark.parametrize("change, message", [
    ({"image_id": 99}, "not on an image"),
    ({"image_id": True}, "not on an image"),
    ({"category_id": 7}, "unknown category"),
    ({"bbox": [1, 2, 0, 5]}, "no proper bbox"),
    ({"bbox": [1, 2, 3]}, "no proper bbox"),
    ({"score": 1.5}, "no score"),
])
def test_predictions_that_do_not_fit_the_file_are_refused(change, message):
    truth = held_out([(sha(1), [("text", (10, 10, 50, 20))])])
    with pytest.raises(evaluate.EvaluationError, match=message):
        evaluate.check_predictions([{**predicted(truth, 0, "text", (10, 10, 50, 20), 0.9), **change}], truth)


def page_jpeg(seed: int) -> bytes:
    image = Image.new("L", (400, 500), 255)
    for i in range(40):
        image.putpixel((20 + 7 * i, 30 + seed % 200), 0)
    out = io.BytesIO()
    image.save(out, "JPEG", quality=90)
    return out.getvalue()


def test_the_held_out_file_prepare_writes_scores_from_the_command_line(tmp_path, capsys):
    # Real images whose hashes fall in the test split, so nothing is patched.
    test_pages = [data for data in (page_jpeg(seed) for seed in range(400)) if prepare.split_of(hashlib.sha256(data).hexdigest()) == "test"][:2]
    assert len(test_pages) == 2
    lines = []
    for i, data in enumerate(test_pages):
        digest = hashlib.sha256(data).hexdigest()
        lines.append({"image": f"images/{digest}.jpg", "sha256": digest, "width": 400, "height": 500, "scan": "s1", "position": i, "course": "",
                      "savedAt": "2026-10-24T20:00:00.000Z", "regionsComplete": True, "blocks": [region("text", (10, 10, 200, 40), "r1")]})
    labels = tmp_path / "labels.zip"
    with zipfile.ZipFile(labels, "w") as z:
        z.writestr("manifest.json", json.dumps({"format": "sahurlock-labels", "formatVersion": 1, "documentVersion": 1, "exportedAt": "2026-10-24T20:00:00.000Z", "kinds": prepare.KINDS}))
        z.writestr("pages.jsonl", "".join(json.dumps(l) + "\n" for l in lines))
        for l, data in zip(lines, test_pages):
            z.writestr(l["image"], data)
    prepare.build_detector(labels, tmp_path / "out")
    held = tmp_path / "out" / "held-out" / "annotations" / "instance_test.json"
    truth = json.loads(held.read_text())
    found = tmp_path / "predictions.json"
    found.write_text(json.dumps([predicted(truth, 0, "text", (10, 10, 200, 40), 0.9)]))

    assert evaluate.main([str(held), str(found)]) == 0
    printed = capsys.readouterr().out
    assert printed.splitlines()[0] == "2 pages, IoU 0.5, score 0.5 or more"
    # COCO averages precision over 101 recall points, and 51 of them (0 to 0.5) are reached here.
    assert printed.splitlines()[2].split() == ["text", "2", "1", "0", "1.000", "0.500", "0.505", "0.505"]

    assert evaluate.main([str(held), str(found), "--json"]) == 0
    assert json.loads(capsys.readouterr().out)["kinds"]["text"]["recall"] == 0.5

    # The training set's own files are refused.
    train = tmp_path / "out" / "detector" / "annotations" / "instance_train.json"
    train.write_text(json.dumps(held_out([(sha(40), [("text", (10, 10, 50, 20))])])))
    assert evaluate.main([str(train), str(found)]) == 1
    assert "not test pages" in capsys.readouterr().err
