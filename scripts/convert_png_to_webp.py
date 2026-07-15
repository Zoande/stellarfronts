from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


def png_path(value: str) -> Path:
    path = Path(value).expanduser()
    if path.suffix.lower() != ".png":
        raise argparse.ArgumentTypeError(f"not a PNG file: {value}")
    if not path.is_file():
        raise argparse.ArgumentTypeError(f"file does not exist: {value}")
    return path


def percentage(value: str) -> int:
    number = int(value)
    if not 0 <= number <= 100:
        raise argparse.ArgumentTypeError("must be between 0 and 100")
    return number


def compression_method(value: str) -> int:
    number = int(value)
    if not 0 <= number <= 6:
        raise argparse.ArgumentTypeError("must be between 0 and 6")
    return number


def output_path(source: Path, output_dir: Path | None) -> Path:
    if output_dir is None:
        return source.with_suffix(".webp")
    return output_dir / source.with_suffix(".webp").name


def convert(
    source: Path,
    destination: Path,
    *,
    quality: int,
    method: int,
    lossless: bool,
    exact: bool,
) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(source) as image:
        if image.format != "PNG":
            raise ValueError(f"file contents are not PNG: {source}")
        image.save(
            destination,
            format="WEBP",
            quality=quality,
            method=method,
            lossless=lossless,
            exact=exact,
        )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Convert only the specified PNG files to WebP."
    )
    parser.add_argument(
        "files",
        nargs="+",
        type=png_path,
        metavar="PNG",
        help="exact path to a PNG file (provide more than one path to convert several)",
    )
    parser.add_argument(
        "-q",
        "--quality",
        type=percentage,
        default=80,
        metavar="0-100",
        help="WebP quality (default: 80)",
    )
    parser.add_argument(
        "-m",
        "--method",
        type=compression_method,
        default=6,
        metavar="0-6",
        help="compression effort: 0 is fastest, 6 is slowest/best (default: 6)",
    )
    parser.add_argument(
        "--lossless",
        action="store_true",
        help="use lossless WebP compression",
    )
    parser.add_argument(
        "--exact",
        action="store_true",
        help="preserve RGB values in fully transparent pixels",
    )
    parser.add_argument(
        "-o",
        "--output-dir",
        type=Path,
        help="place all WebP files here (default: beside each PNG)",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="replace WebP files that already exist",
    )
    args = parser.parse_args()

    conversions = [
        (source, output_path(source, args.output_dir)) for source in args.files
    ]
    destinations = [destination.resolve() for _, destination in conversions]
    if len(destinations) != len(set(destinations)):
        parser.error("multiple inputs would write to the same output file")

    existing = [destination for _, destination in conversions if destination.exists()]
    if existing and not args.overwrite:
        parser.error(
            "output already exists (use --overwrite): "
            + ", ".join(str(path) for path in existing)
        )

    for source, destination in conversions:
        convert(
            source,
            destination,
            quality=args.quality,
            method=args.method,
            lossless=args.lossless,
            exact=args.exact,
        )
        print(f"{source} -> {destination}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
