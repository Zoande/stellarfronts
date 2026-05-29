from __future__ import annotations

import argparse
import shutil
from pathlib import Path

from collections import deque

from PIL import Image
from PIL import ImageOps

ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "source_materials"

PLANET_QUALITY = 80
BANNER_QUALITY = 30
ICON_QUALITY = 50
BRANDING_QUALITY = 80
RESOURCE_FULL_QUALITY = 80
RESOURCE_NOBG_QUALITY = 90
WEBP_METHOD = 6
SIDEBAR_ICON_CANVAS = 1024
SIDEBAR_ICON_PADDING = 10
SIDEBAR_ICON_WHITE_THRESHOLD = 245
RESOURCE_NOBG_WHITE_THRESHOLD = 240

RESOURCE_ICON_NAME_MAP = {
    "mineral": "minerals",
    "alloy": "alloys",
}

RESOURCE_FULL_FILES = [
    "food_full_icon.png",
    "mineral_full_icon.png",
    "energy_full_icon.png",
    "goods_full_icon.png",
    "alloy_full_icon.png",
    "research_full_icon.png",
]

RESOURCE_NOBG_FILES = [
    "food_nobg_icon.png",
    "minerals_nobg_icon.png",
    "energy_nobg_icon.png",
    "goods_nobg_icon.png",
    "alloy_nobg_icon.png",
    "research_nobg_icon.png",
]


def resource_icon_paths(file_names: list[str]) -> list[Path]:
    return [ROOT / name for name in file_names] + [SOURCE_DIR / name for name in file_names]

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
        "label": "branding",
        "quality": BRANDING_QUALITY,
        "dirs": [
            ROOT / "public" / "branding",
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
            ROOT / "side_bar_tech_icon.png",
            SOURCE_DIR / "sidebar_government_icon.png",
            SOURCE_DIR / "sidebar_society_icon.png",
            SOURCE_DIR / "sidebar_leaders_icon.png",
            SOURCE_DIR / "sidebar_planets_icon.png",
            SOURCE_DIR / "sidebar_diplomacy_icon.png",
            SOURCE_DIR / "sidebar_espionage_icon.png",
            SOURCE_DIR / "sidebar_market_icon.png",
        ],
    },
    {
        "label": "resource-full",
        "quality": RESOURCE_FULL_QUALITY,
        "dirs": [],
        "files": resource_icon_paths(RESOURCE_FULL_FILES),
    },
    {
        "label": "resource-nobg",
        "quality": RESOURCE_NOBG_QUALITY,
        "dirs": [],
        "files": resource_icon_paths(RESOURCE_NOBG_FILES),
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


def prepare_sidebar_icon(source_path: Path) -> Image.Image:
    with Image.open(source_path) as image:
        image = to_rgb_or_rgba(image).convert("RGBA")

    pixels = image.load()
    for y in range(image.height):
        for x in range(image.width):
            red, green, blue, alpha = pixels[x, y]
            if red >= SIDEBAR_ICON_WHITE_THRESHOLD and green >= SIDEBAR_ICON_WHITE_THRESHOLD and blue >= SIDEBAR_ICON_WHITE_THRESHOLD:
                pixels[x, y] = (255, 255, 255, 0)

    bbox = image.getbbox()
    if bbox is not None:
        image = image.crop(bbox)

    target_size = SIDEBAR_ICON_CANVAS - (SIDEBAR_ICON_PADDING * 2)
    image = ImageOps.contain(image, (target_size, target_size), method=Image.Resampling.LANCZOS)

    canvas = Image.new("RGBA", (SIDEBAR_ICON_CANVAS, SIDEBAR_ICON_CANVAS), (0, 0, 0, 0))
    offset_x = (SIDEBAR_ICON_CANVAS - image.width) // 2
    offset_y = (SIDEBAR_ICON_CANVAS - image.height) // 2
    canvas.paste(image, (offset_x, offset_y), image)
    return canvas


def convert_sidebar_icon_to_webp(source_path: Path, dest_path: Path, quality: int) -> None:
    image = prepare_sidebar_icon(source_path)
    image.save(
        dest_path,
        format="WEBP",
        quality=quality,
        method=WEBP_METHOD,
    )


def prepare_resource_nobg_icon(source_path: Path) -> Image.Image:
    with Image.open(source_path) as image:
        image = to_rgb_or_rgba(image).convert("RGBA")

    pixels = image.load()
    width, height = image.size

    def is_near_white(color: tuple[int, int, int, int]) -> bool:
        red, green, blue, alpha = color
        if alpha == 0:
            return False
        return red >= RESOURCE_NOBG_WHITE_THRESHOLD and green >= RESOURCE_NOBG_WHITE_THRESHOLD and blue >= RESOURCE_NOBG_WHITE_THRESHOLD

    queue: deque[tuple[int, int]] = deque()
    visited = [[False] * width for _ in range(height)]

    def enqueue_if_white(x: int, y: int) -> None:
        if visited[y][x]:
            return
        if not is_near_white(pixels[x, y]):
            return
        visited[y][x] = True
        queue.append((x, y))

    for x in range(width):
        enqueue_if_white(x, 0)
        enqueue_if_white(x, height - 1)
    for y in range(1, height - 1):
        enqueue_if_white(0, y)
        enqueue_if_white(width - 1, y)

    while queue:
        x, y = queue.popleft()
        red, green, blue, _ = pixels[x, y]
        pixels[x, y] = (red, green, blue, 0)
        if x > 0:
            enqueue_if_white(x - 1, y)
        if x < width - 1:
            enqueue_if_white(x + 1, y)
        if y > 0:
            enqueue_if_white(x, y - 1)
        if y < height - 1:
            enqueue_if_white(x, y + 1)

    return image


def convert_resource_nobg_icon_to_webp(source_path: Path, dest_path: Path, quality: int) -> None:
    image = prepare_resource_nobg_icon(source_path)
    image.save(
        dest_path,
        format="WEBP",
        quality=quality,
        method=WEBP_METHOD,
    )


def move_to_source_materials(png_path: Path, overwrite: bool) -> Path:
    if SOURCE_DIR in png_path.parents:
        return png_path

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
    resource_output = get_resource_icon_output(source_path)
    if resource_output is not None:
        return resource_output
    if "branding" in source_path.parts or source_path.name in {"stellarfrontslogo.png", "stellarfrontslogonotext.png"}:
        branding_dir = ROOT / "public" / "branding"
        branding_dir.mkdir(parents=True, exist_ok=True)
        return branding_dir / source_path.with_suffix(".webp").name

    icons_dir = ROOT / "public" / "textures" / "sidebar-icons"
    icons_dir.mkdir(parents=True, exist_ok=True)
    if source_path.name == "side_bar_fleet icon.png":
        return icons_dir / "side_bar_fleet_icon.webp"
    if source_path.name == "side_bar_tech_icon.png":
        return icons_dir / "side_bar_tech_icon.webp"
    return icons_dir / source_path.with_suffix(".webp").name


def get_resource_icon_output(source_path: Path) -> Path | None:
    name = source_path.name
    if name.endswith("_full_icon.png"):
        variant = "full"
        base = name[: -len("_full_icon.png")]
    elif name.endswith("_nobg_icon.png"):
        variant = "nobg"
        base = name[: -len("_nobg_icon.png")]
    else:
        return None

    resource = RESOURCE_ICON_NAME_MAP.get(base, base)
    resource_dir = ROOT / "public" / "textures" / "resource-icons" / variant
    resource_dir.mkdir(parents=True, exist_ok=True)
    return resource_dir / f"{resource}.webp"


def process_group(label: str, quality: int, dirs: list[Path], files: list[Path], dry_run: bool, overwrite: bool) -> dict:
    pngs = iter_pngs(dirs, files)
    converted = 0
    skipped = 0

    for png_path in pngs:
        effective_quality = 80 if png_path.name in {"side_bar_fleet icon.png", "side_bar_tech_icon.png"} else quality
        webp_path = get_output_path(png_path)
        if webp_path.exists() and not overwrite:
            skipped += 1
            continue

        if dry_run:
            converted += 1
            continue

        source_path = move_to_source_materials(png_path, overwrite)
        if source_path.name.startswith("sidebar_"):
            convert_sidebar_icon_to_webp(source_path, webp_path, effective_quality)
        elif label == "resource-nobg":
            convert_resource_nobg_icon_to_webp(source_path, webp_path, effective_quality)
        else:
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
