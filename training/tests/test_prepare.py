import hashlib
import io
import json
import random
import sys
import zipfile
from pathlib import Path

import numpy as np
import pytest
from PIL import Image, ImageDraw

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


def note(seed: int, lines: int, size=(450, 600), quality=92, shift=(0, 0), scale=1.0) -> bytes:
    """
    A cleaned note page: white paper and a few lines of scribble at rows
    chosen by the seed. The same seed with another size, shift or scale is
    the same page cleaned or photographed again.
    """
    rng = random.Random(seed)
    width, height = size
    image = Image.new("L", size, 255)
    draw = ImageDraw.Draw(image)
    place = lambda x, y: (((x - 0.5) * scale + 0.5) * width + shift[0], ((y - 0.5) * scale + 0.5) * height + shift[1])
    for row in sorted(rng.sample(range(2, 28), lines)):
        x, end = rng.uniform(0.08, 0.3), rng.uniform(0.5, 0.92)
        while x < end:
            word = rng.uniform(0.02, 0.08)
            draw.line([place(x + word * i / 11, row / 30 + rng.uniform(-0.012, 0.012)) for i in range(12)], fill=20, width=max(2, width // 300))
            x += word + rng.uniform(0.01, 0.03)
    out = io.BytesIO()
    image.save(out, "JPEG", quality=quality)
    return out.getvalue()


def blank(size=(450, 600), specks=0) -> bytes:
    """A cleaned page with nothing written on it, bar a few specks of dust."""
    image = Image.new("L", size, 255)
    for i in range(specks):
        image.putpixel((40 + 37 * i, 50 + 23 * i), 0)
    out = io.BytesIO()
    image.save(out, "JPEG", quality=92)
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


def test_check_keeps_a_line_whole_around_unicode_line_separators(tmp_path):
    # JSON.stringify leaves U+2028, U+2029 and U+0085 unescaped, and str.splitlines() breaks on each.
    a = jpeg(1)
    content = "x\u2028y\u2029z\x85w"
    l = line(a, [{**block(), "content": content}])
    path = tmp_path / "labels.zip"
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("manifest.json", json.dumps(MANIFEST))
        z.writestr("pages.jsonl", json.dumps(l, ensure_ascii=False) + "\n")
        z.writestr(f"images/{l['sha256']}.jpg", a)
    _, pages, _ = prepare.read_labels(path)
    assert [p.blocks[0]["content"] for p in pages] == [content]


def test_near_duplicates_drop_the_train_copy_and_never_move_held_out_pages():
    unit = lambda *v: np.array(v, dtype=float) / np.linalg.norm(v)
    splits = {"train-near": "train", "train-far": "train", "train-blank": "train", "test-page": "test", "val-page": "val", "val-blank": "val"}
    signatures = {
        "train-near": unit(1, 0.1, 0), "train-far": unit(0, 0, 1), "train-blank": None,
        "test-page": unit(1, 0, 0), "val-page": unit(0, 1, 0.2), "val-blank": None,
    }
    assert prepare.drop_near_duplicates(splits, signatures) == [{"train": "train-near", "held_out": "test-page", "similarity": 0.995}]


def test_near_duplicates_keep_distinct_sparse_pages_and_blank_ones():
    # Cleaned pages are mostly white. A signature of the whole page saw all of these as one page.
    pages = [note(seed, lines) for seed in range(16) for lines in (1, 2, 3)] + [blank(), blank(specks=5), blank((600, 800), specks=5)]
    signatures = {hashlib.sha256(p).hexdigest(): prepare.ink_signature(p) for p in pages}
    assert len(signatures) == len(pages)
    assert [s is None for s in list(signatures.values())[-3:]] == [True, True, True]
    shas = list(signatures)
    # Half the pages held out, and blank pages on both sides.
    splits = {sha: ("test", "val", "train", "train")[i % 4] for i, sha in enumerate(shas)}
    assert [splits[s] for s in shas[-3:]] == ["test", "val", "train"]
    assert prepare.drop_near_duplicates(splits, signatures) == []


def test_near_duplicates_find_the_same_page_cleaned_or_photographed_again():
    for lines in (1, 2, 5, 20):
        page = prepare.ink_signature(note(7, lines))
        for again in (note(7, lines, size=(600, 800), quality=80), note(7, lines, size=(440, 590), shift=(6, -4), scale=0.97)):
            assert float(page @ prepare.ink_signature(again)) >= prepare.NEAR_DUPLICATE_SIMILARITY


def test_detector_set_is_valid_coco_with_no_held_out_page_in_training(tmp_path, monkeypatch):
    images = [note(i, 3 + i) for i in range(6)]
    # Page 0 cleaned again at another size: a different file, the same page.
    images.append(note(0, 3, size=(600, 800), quality=80))
    shas = [hashlib.sha256(i).hexdigest() for i in images]
    forced = {shas[0]: "test", shas[1]: "val", shas[6]: "train"}
    # Everything else goes to train, so the planted copy has a held-out page to collide with.
    monkeypatch.setattr(prepare, "split_of", lambda sha: forced.get(sha, "train"))

    lines = [(line(img, [block("text", id=f"t{i}"), block("math", (10, 30, 15, 12), id=f"m{i}")]), img) for i, img in enumerate(images)]
    # One partly marked page, which must stay out of the detector set, and one complete page with nothing on it.
    partial = note(50, 4)
    empty = blank()
    lines += [(line(partial, [block()], complete=False), partial), (line(empty, []), empty)]
    out = tmp_path / "out"
    summary = prepare.build_detector(labels_zip(tmp_path, lines), out)

    assert [(d["train"], d["held_out"]) for d in summary["dropped_near_duplicates"]] == [(shas[6], shas[0])]
    split = json.loads((out / "split.json").read_text())
    assert split["rule"] == "sha256-mod100-v1"
    assert hashlib.sha256(partial).hexdigest() not in split["pages"]

    from pycocotools.coco import COCO
    from pycocotools.cocoeval import COCOeval

    seen = {}
    for name, folder in (("train", "detector"), ("val", "detector"), ("test", "held-out")):
        path = out / folder / "annotations" / f"instance_{name}.json"
        data = json.loads(path.read_text())
        assert [c["id"] for c in data["categories"]] == [1, 2, 3, 4, 5, 6]
        for a in data["annotations"]:
            assert a["area"] == a["bbox"][2] * a["bbox"][3] and a["iscrowd"] == 0
        seen[name] = {i["sha256"] for i in data["images"]}
        for sha in seen[name]:
            assert (out / folder / "images" / f"{sha}.jpg").exists()
        if data["annotations"]:
            gt = COCO(str(path))
            dt = gt.loadRes([{**a, "score": 1.0} for a in data["annotations"]])
            evaluation = COCOeval(gt, dt, "bbox")
            evaluation.evaluate(); evaluation.accumulate()
    assert seen["test"] == {shas[0]} and seen["val"] == {shas[1]}
    assert not (seen["test"] | seen["val"]) & seen["train"]
    assert shas[6] not in seen["train"]
    assert hashlib.sha256(empty).hexdigest() in seen["train"]
    # Nothing a training job is given holds a test page.
    assert sorted(p.name for p in (out / "detector" / "annotations").iterdir()) == ["instance_train.json", "instance_val.json"]
    assert sorted(p.name for p in (out / "detector" / "images").iterdir()) == sorted(f"{s}.jpg" for s in seen["train"] | seen["val"])
    assert sorted(p.name for p in (out / "held-out" / "images").iterdir()) == [f"{shas[0]}.jpg"]
