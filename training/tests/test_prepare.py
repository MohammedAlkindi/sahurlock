import hashlib
import io
import json
import random
import sys
import zipfile
from pathlib import Path

import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import prepare  # noqa: E402

MANIFEST = {"format": "sahurlock-labels", "formatVersion": 1, "documentVersion": 1, "exportedAt": "2026-10-23T19:40:00.000Z", "kinds": prepare.KINDS}


def jpeg(seed: int, size=(60, 80), quality=90) -> bytes:
    """A noisy test page, different for each seed."""
    rng = random.Random(seed)
    image = Image.new("L", size)
    image.putdata([rng.randrange(256) for _ in range(size[0] * size[1])])
    out = io.BytesIO()
    image.save(out, "JPEG", quality=quality)
    return out.getvalue()


def block(kind="text", box=(5, 5, 20, 10), id="r1"):
    x, y, w, h = box
    return {"id": id, "kind": kind, "box": {"x": x, "y": y, "width": w, "height": h}, "content": None, "tokens": [], "origin": {"by": "user"}, "reviewed": True}


def line(image: bytes, blocks=(), complete=True, **overrides):
    sha = hashlib.sha256(image).hexdigest()
    width, height = Image.open(io.BytesIO(image)).size
    value = {"image": f"images/{sha}.jpg", "sha256": sha, "width": width, "height": height, "scan": "s1", "position": 0, "course": "", "savedAt": "2026-10-23T19:12:00.000Z", "regionsComplete": complete, "blocks": list(blocks)}
    value.update(overrides)
    return value


def labels_zip(tmp_path: Path, pages, manifest=MANIFEST, images=None) -> Path:
    """A labels download in the app's layout, written with Python's own zipfile."""
    path = tmp_path / "labels.zip"
    with zipfile.ZipFile(path, "w", zipfile.ZIP_STORED) as z:
        z.writestr("manifest.json", json.dumps(manifest))
        z.writestr("pages.jsonl", "".join(json.dumps(l) + "\n" for l, _ in pages))
        for l, data in pages:
            z.writestr(f"images/{l['sha256']}.jpg", data if images is None else images.get(l["sha256"], data))
    return path


def test_jpeg_size_reads_the_frame_header():
    assert prepare.jpeg_size(jpeg(1, (60, 80))) == (60, 80)
    with pytest.raises(prepare.LabelsError):
        prepare.jpeg_size(b"not a jpeg")


def test_split_depends_on_the_hash_alone():
    assert prepare.split_of("00000005" + "0" * 56) == "test"
    assert prepare.split_of("0000000f" + "0" * 56) == "val"
    assert prepare.split_of("00000063" + "0" * 56) == "train"
    shas = [hashlib.sha256(str(i).encode()).hexdigest() for i in range(2000)]
    share = {s: sum(prepare.split_of(h) == s for h in shas) / len(shas) for s in ("train", "val", "test")}
    assert 0.07 < share["test"] < 0.13 and 0.07 < share["val"] < 0.13


def test_check_accepts_a_good_download(tmp_path):
    a, b = jpeg(1), jpeg(2)
    path = labels_zip(tmp_path, [(line(a, [block()]), a), (line(b, complete=False, blocks=[block("math")]), b)])
    manifest, pages, _ = prepare.read_labels(path)
    assert manifest["format"] == "sahurlock-labels"
    assert [p.regions_complete for p in pages] == [True, False]
    assert prepare.main(["check", str(path)]) == 0


@pytest.mark.parametrize("bad, message", [
    ({"kinds": ["text", "math"]}, "kinds"),
    ({"formatVersion": 2}, "format version"),
    ({"format": "something-else"}, "not a SahurLock"),
])
def test_check_refuses_a_manifest_it_cannot_read(tmp_path, bad, message):
    a = jpeg(1)
    path = labels_zip(tmp_path, [(line(a), a)], manifest={**MANIFEST, **bad})
    with pytest.raises(prepare.LabelsError, match=message):
        prepare.read_labels(path)
    assert prepare.main(["check", str(path)]) == 1


@pytest.mark.parametrize("change, message", [
    (lambda l, a: (l, a[:-2] + b"\x00\x00"), "does not match its hash"),
    (lambda l, a: ({**l, "width": l["width"] + 1}, a), "is not"),
    (lambda l, a: ({**l, "blocks": [block(box=(50, 70, 20, 20))]}, a), "outside the page"),
    (lambda l, a: ({**l, "blocks": [block(kind="doodle")]}, a), "unknown kind"),
    (lambda l, a: ({**l, "blocks": [{**block(), "origin": {"by": "someone"}}]}, a), "unknown origin"),
    (lambda l, a: ({**l, "image": "images/other.jpg"}, a), "wrong image"),
])
def test_check_refuses_a_page_that_does_not_add_up(tmp_path, change, message):
    a = jpeg(1)
    l, data = change(line(a), a)
    path = labels_zip(tmp_path, [(l, a)], images={l["sha256"]: data})
    with pytest.raises(prepare.LabelsError, match=message):
        prepare.read_labels(path)


def test_near_duplicates_drop_the_train_copy_and_never_move_held_out_pages():
    splits = {"train-near": "train", "train-far": "train", "test-page": "test", "val-page": "val"}
    hashes = {"train-near": 0b1111, "train-far": (1 << 64) - 1, "test-page": 0b0000, "val-page": 1 << 40}
    assert prepare.drop_near_duplicates(splits, hashes) == ["train-near"]


def test_detector_set_is_valid_coco_with_no_held_out_page_in_training(tmp_path, monkeypatch):
    images = [jpeg(i) for i in range(6)]
    # A second photo of page 0, saved again at another quality: a different file, the same page.
    images.append(jpeg(0, quality=70))
    shas = [hashlib.sha256(i).hexdigest() for i in images]
    forced = {shas[0]: "test", shas[1]: "val", shas[6]: "train"}
    # Everything else goes to train, so the planted copy has a held-out page to collide with.
    monkeypatch.setattr(prepare, "split_of", lambda sha: forced.get(sha, "train"))

    lines = [(line(img, [block("text", id=f"t{i}"), block("math", (10, 30, 15, 12), id=f"m{i}")]), img) for i, img in enumerate(images)]
    # One partly marked page, which must stay out of the detector set, and one complete page with nothing on it.
    partial = jpeg(50)
    empty = jpeg(51)
    lines += [(line(partial, [block()], complete=False), partial), (line(empty, []), empty)]
    out = tmp_path / "out"
    summary = prepare.build_detector(labels_zip(tmp_path, lines), out)

    assert summary["dropped_near_duplicates"] == [shas[6]]
    split = json.loads((out / "split.json").read_text())
    assert split["rule"] == "sha256-mod100-v1"
    assert hashlib.sha256(partial).hexdigest() not in split["pages"]

    from pycocotools.coco import COCO
    from pycocotools.cocoeval import COCOeval

    seen = {}
    for name in ("train", "val", "test"):
        path = out / "detector" / "annotations" / f"instance_{name}.json"
        data = json.loads(path.read_text())
        assert [c["id"] for c in data["categories"]] == [1, 2, 3, 4, 5, 6]
        for a in data["annotations"]:
            assert a["area"] == a["bbox"][2] * a["bbox"][3] and a["iscrowd"] == 0
        seen[name] = {i["sha256"] for i in data["images"]}
        for sha in seen[name]:
            assert (out / "detector" / "images" / f"{sha}.jpg").exists()
        if data["annotations"]:
            gt = COCO(str(path))
            dt = gt.loadRes([{**a, "score": 1.0} for a in data["annotations"]])
            evaluation = COCOeval(gt, dt, "bbox")
            evaluation.evaluate(); evaluation.accumulate()
    assert seen["test"] == {shas[0]} and seen["val"] == {shas[1]}
    assert not (seen["test"] | seen["val"]) & seen["train"]
    assert shas[6] not in seen["train"]
    assert hashlib.sha256(empty).hexdigest() in seen["train"]
