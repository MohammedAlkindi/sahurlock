"""Check a SahurLock labels download and build training sets from it.

    python training/prepare.py check <labels.zip>
    python training/prepare.py detector <labels.zip> <out>

`check` validates the file the Scan tool's "Download labels" writes.
`detector` builds the region detector's COCO files and the held-out split
from it. The format is described in docs/notes-converter.md and written by
src/lib/scan/dataset.ts.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import sys
import zipfile
from dataclasses import dataclass
from pathlib import Path

FORMAT = "sahurlock-labels"
FORMAT_VERSION = 1
DOCUMENT_VERSION = 1
# The app's BLOCK_KINDS. COCO category id = position + 1. Kinds are only ever appended.
KINDS = ["text", "heading", "math", "table", "graph", "diagram"]
ORIGINS = {"user", "model"}

SPLIT_RULE = "sha256-mod100-v1"
# A val or test page this close to a train page in dHash bits counts as the same page photographed twice.
NEAR_DUPLICATE_BITS = 6


class LabelsError(Exception):
    """The file is not a labels download this script can read."""


@dataclass(frozen=True)
class Page:
    sha256: str
    width: int
    height: int
    regions_complete: bool
    blocks: list[dict]
    line: dict


# ---- Pure parts: no files, so they are tested directly. ----


def jpeg_size(data: bytes) -> tuple[int, int]:
    """Width and height from a JPEG's start-of-frame header."""
    if data[:2] != b"\xff\xd8":
        raise LabelsError("an image is not a JPEG")
    i = 2
    while i + 9 < len(data):
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        length = (data[i + 2] << 8) | data[i + 3]
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            return (data[i + 7] << 8) | data[i + 8], (data[i + 5] << 8) | data[i + 6]
        i += 2 + length
    raise LabelsError("a JPEG has no frame header")


def split_of(sha256: str) -> str:
    """The page's split under sha256-mod100-v1: 10% test, 10% val, 80% train. Fixed by the image alone."""
    bucket = int(sha256[:8], 16) % 100
    return "test" if bucket < 10 else "val" if bucket < 20 else "train"


def check_page(line: dict, image: bytes | None) -> Page:
    """One pages.jsonl line, checked against its image bytes."""
    sha = line.get("sha256")
    if not isinstance(sha, str) or len(sha) != 64:
        raise LabelsError("a page has no sha256")
    if line.get("image") != f"images/{sha}.jpg":
        raise LabelsError(f"page {sha[:12]} names the wrong image")
    if image is None:
        raise LabelsError(f"page {sha[:12]} has no image in the file")
    if hashlib.sha256(image).hexdigest() != sha:
        raise LabelsError(f"page {sha[:12]}'s image does not match its hash")
    width, height = line.get("width"), line.get("height")
    if jpeg_size(image) != (width, height):
        raise LabelsError(f"page {sha[:12]}'s image is not {width} x {height}")
    blocks = line.get("blocks")
    if not isinstance(blocks, list):
        raise LabelsError(f"page {sha[:12]} has no blocks list")
    for block in blocks:
        if block.get("kind") not in KINDS:
            raise LabelsError(f"page {sha[:12]} has a region of unknown kind {block.get('kind')!r}")
        if (block.get("origin") or {}).get("by") not in ORIGINS:
            raise LabelsError(f"page {sha[:12]} has a region of unknown origin")
        box = block.get("box") or {}
        x, y, w, h = (box.get(k) for k in ("x", "y", "width", "height"))
        if not all(isinstance(v, (int, float)) for v in (x, y, w, h)) or w <= 0 or h <= 0:
            raise LabelsError(f"page {sha[:12]} has a region without a proper box")
        if x < 0 or y < 0 or x + w > width or y + h > height:
            raise LabelsError(f"page {sha[:12]} has a region outside the page")
    return Page(sha, width, height, line.get("regionsComplete") is True, blocks, line)


def check_manifest(manifest: dict) -> None:
    if manifest.get("format") != FORMAT:
        raise LabelsError("this is not a SahurLock labels download")
    if manifest.get("formatVersion") != FORMAT_VERSION or manifest.get("documentVersion") != DOCUMENT_VERSION:
        raise LabelsError(
            f"format version {manifest.get('formatVersion')}, document version {manifest.get('documentVersion')}: "
            f"this script reads {FORMAT_VERSION} and {DOCUMENT_VERSION}"
        )
    if manifest.get("kinds") != KINDS:
        raise LabelsError(f"the file's kinds {manifest.get('kinds')} differ from this script's {KINDS}")


def hamming(a: int, b: int) -> int:
    return bin(a ^ b).count("1")


def drop_near_duplicates(splits: dict[str, str], hashes: dict[str, int]) -> list[str]:
    """
    Train pages within NEAR_DUPLICATE_BITS of a val or test page, which would
    leak the held-out page into training. Held-out pages never move, so the
    train side is the one dropped.
    """
    held_out = [hashes[s] for s, split in splits.items() if split != "train"]
    return sorted(
        s for s, split in splits.items()
        if split == "train" and any(hamming(hashes[s], h) <= NEAR_DUPLICATE_BITS for h in held_out)
    )


def coco(pages: list[Page]) -> dict:
    """COCO detection JSON for these pages, all six categories listed even when unused."""
    images, annotations = [], []
    for image_id, page in enumerate(sorted(pages, key=lambda p: p.sha256), start=1):
        images.append({"id": image_id, "file_name": f"{page.sha256}.jpg", "width": page.width, "height": page.height, "sha256": page.sha256})
        for block in page.blocks:
            box = block["box"]
            annotations.append({
                "id": len(annotations) + 1,
                "image_id": image_id,
                "category_id": KINDS.index(block["kind"]) + 1,
                "bbox": [box["x"], box["y"], box["width"], box["height"]],
                "area": box["width"] * box["height"],
                "iscrowd": 0,
                "segmentation": [],
                "sahurlock_block_id": block["id"],
            })
    return {
        "info": {"description": "SahurLock region labels", "version": SPLIT_RULE},
        "licenses": [],
        "categories": [{"id": i + 1, "name": kind} for i, kind in enumerate(KINDS)],
        "images": images,
        "annotations": annotations,
    }


# ---- File handling. ----


def read_labels(path: Path) -> tuple[dict, list[Page], dict[str, bytes]]:
    """Open a labels download and check all of it. Returns the manifest, the pages and their images."""
    try:
        archive = zipfile.ZipFile(path)
    except (zipfile.BadZipFile, OSError) as error:
        raise LabelsError(f"cannot open {path}: {error}") from error
    with archive:
        bad = archive.testzip()
        if bad:
            raise LabelsError(f"{bad} is damaged")
        names = set(archive.namelist())
        if not {"manifest.json", "pages.jsonl"} <= names:
            raise LabelsError("manifest.json or pages.jsonl is missing")
        manifest = json.loads(archive.read("manifest.json"))
        check_manifest(manifest)
        images = {name[len("images/"):-len(".jpg")]: archive.read(name) for name in names if name.startswith("images/")}
        pages = []
        for number, raw in enumerate(archive.read("pages.jsonl").decode("utf-8").splitlines(), start=1):
            if not raw.strip():
                continue
            try:
                line = json.loads(raw)
            except json.JSONDecodeError as error:
                raise LabelsError(f"pages.jsonl line {number} is not JSON") from error
            pages.append(check_page(line, images.get(line.get("sha256", ""))))
    return manifest, pages, images


def dhash(image: bytes) -> int:
    """64-bit difference hash: the page shrunk to 9 x 8 grey, one bit per left-right brightness step."""
    from PIL import Image

    pixels = Image.open(io.BytesIO(image)).convert("L").resize((9, 8), Image.Resampling.LANCZOS).tobytes()
    bits = 0
    for row in range(8):
        for col in range(8):
            bits = (bits << 1) | (pixels[row * 9 + col] > pixels[row * 9 + col + 1])
    return bits


def build_detector(path: Path, out: Path) -> dict:
    """Write the detector set to `out` and return a summary of what was written and dropped."""
    _, pages, images = read_labels(path)
    complete = [p for p in pages if p.regions_complete]
    splits = {p.sha256: split_of(p.sha256) for p in complete}
    dropped = drop_near_duplicates(splits, {p.sha256: dhash(images[p.sha256]) for p in complete})
    for sha in dropped:
        del splits[sha]

    (out / "detector" / "annotations").mkdir(parents=True, exist_ok=True)
    (out / "detector" / "images").mkdir(parents=True, exist_ok=True)
    for page in complete:
        if page.sha256 in splits:
            (out / "detector" / "images" / f"{page.sha256}.jpg").write_bytes(images[page.sha256])
    counts = {}
    for split in ("train", "val", "test"):
        chosen = [p for p in complete if splits.get(p.sha256) == split]
        counts[split] = len(chosen)
        (out / "detector" / "annotations" / f"instance_{split}.json").write_text(json.dumps(coco(chosen), indent=1) + "\n")
    (out / "split.json").write_text(json.dumps({"rule": SPLIT_RULE, "pages": dict(sorted(splits.items()))}, indent=1) + "\n")
    return {"pages": len(pages), "complete": len(complete), "dropped_near_duplicates": dropped, "splits": counts}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    commands = parser.add_subparsers(dest="command", required=True)
    check = commands.add_parser("check", help="validate a labels download")
    check.add_argument("labels", type=Path)
    detector = commands.add_parser("detector", help="build the region detector's COCO set")
    detector.add_argument("labels", type=Path)
    detector.add_argument("out", type=Path)
    args = parser.parse_args(argv)
    try:
        if args.command == "check":
            manifest, pages, _ = read_labels(args.labels)
            complete = sum(p.regions_complete for p in pages)
            print(f"OK: {len(pages)} page{'' if len(pages) == 1 else 's'}, {complete} fully marked, exported {manifest.get('exportedAt')}")
        else:
            summary = build_detector(args.labels, args.out)
            print(json.dumps(summary, indent=1))
    except LabelsError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
