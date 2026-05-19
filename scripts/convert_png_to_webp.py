from __future__ import annotations

import argparse
import shutil
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "source_materials"

PLANET_QUALITY = 80
BANNER_QUALITY = 30
ICON_QUALITY = 50
WEBP_METHOD = 6

TARGETS = [
    {
        "label": "planet",
        "quality": PLANET_QUALITY,
        "dirs": [
            ROOT / "public" / "textures" / "planets",
        ],
        "files": [
            ROOT / "public" / "textures" / "gas_giant.png",
            ROOT / "public" / "textures" / "rocky_planet.png",
            ROOT / "public" / "textures" / "ice_planet.png",
            ROOT / "public" / "textures" / "galaxy_bg.png",
            ROOT / "public" / "textures" / "star.glow.png",
            ROOT / "public" / "textures" / "star_surface.png",
        ],
    },
    {
        "label": "banner",
        "quality": BANNER_QUALITY,
        "dirs": [
            ROOT / "public" / "textures" / "planet-banners",
            ROOT / "public" / "textures" / "starbase",
        ],
        "files": [],
    },
    {
        "label": "icon",
        "quality": ICON_QUALITY,
        "dirs": [
            ROOT / "public" / "flag-previews",
            ROOT / "public" / "textures" / "districts",
            ROOT / "public" / "textures" / "buildings",
        ],
        "files": [
            ROOT / "public" / "textures" / "own_ship_icon.png",
            ROOT / "own_starbase_icon.png",
            ROOT / "own_ship_icon.png",
            ROOT / "side_bar_fleet icon.png",
        ],
    },
]


def iter_pngs(base_dirs: list[Path], base_files: list[Path]) -> list[Path]:
    seen: set[Path] = set()

    for base in base_dirs:
        if not base.exists():
            continue
        for path in base.rglob("*.png"):
            if SOURCE_DIR in path.parents:
                continue
            seen.add(path)

    for file_path in base_files:
        if SOURCE_DIR in file_path.parents:
            continue
        if file_path.suffix.lower() != ".png":
            continue
        if file_path.exists():
            seen.add(file_path)

    return sorted(seen)


def to_rgb_or_rgba(image: Image.Image) -> Image.Image:
    if image.mode in {"RGB", "RGBA"}:
        return image
    if "A" in image.getbands():
        return image.convert("RGBA")
    return image.convert("RGB")


def convert_to_webp(source_path: Path, dest_path: Path, quality: int) -> None:
    with Image.open(source_path) as image:
        image = to_rgb_or_rgba(image)
        image.save(
            dest_path,
            format="WEBP",
            quality=quality,
            method=WEBP_METHOD,
        )


def move_to_source_materials(png_path: Path, overwrite: bool) -> Path:
    relative = png_path.relative_to(ROOT)
    source_path = SOURCE_DIR / relative
    source_path.parent.mkdir(parents=True, exist_ok=True)

    if source_path.exists() and not overwrite:
        return source_path

    if source_path.exists() and overwrite:
        source_path.unlink()

    shutil.move(str(png_path), str(source_path))
    return source_path


def get_output_path(source_path: Path) -> Path:
    if source_path.name == "side_bar_fleet icon.png":
        return ROOT / "side_bar_fleet_icon.webp"
    return source_path.with_suffix(".webp")


def process_group(label: str, quality: int, dirs: list[Path], files: list[Path], dry_run: bool, overwrite: bool) -> dict:
    pngs = iter_pngs(dirs, files)
    converted = 0
    skipped = 0

    for png_path in pngs:
        effective_quality = 80 if png_path.name == "side_bar_fleet icon.png" else quality
        webp_path = get_output_path(png_path)
        if webp_path.exists() and not overwrite:
            skipped += 1
            continue

        if dry_run:
            converted += 1
            continue

        source_path = move_to_source_materials(png_path, overwrite)
        convert_to_webp(source_path, webp_path, effective_quality)
        converted += 1

    return {
        "label": label,
        "quality": quality,
        "found": len(pngs),
        "converted": converted,
        "skipped": skipped,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Convert PNG banners/icons to WebP and archive originals.")
    parser.add_argument("--dry-run", action="store_true", help="Report conversions without changing files.")
    parser.add_argument("--overwrite", action="store_true", help="Overwrite existing WebP and source files.")
    args = parser.parse_args()

    SOURCE_DIR.mkdir(parents=True, exist_ok=True)

    results = []
    for target in TARGETS:
        results.append(
            process_group(
                target["label"],
                target["quality"],
                target["dirs"],
                target["files"],
                args.dry_run,
                args.overwrite,
            )
        )

    total_found = sum(result["found"] for result in results)
    total_converted = sum(result["converted"] for result in results)
    total_skipped = sum(result["skipped"] for result in results)

    print("PNG -> WebP conversion complete.")
    for result in results:
        print(
            f"{result['label']}: found {result['found']}, "
            f"converted {result['converted']}, skipped {result['skipped']} (quality {result['quality']})"
        )
    print(f"total: found {total_found}, converted {total_converted}, skipped {total_skipped}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
