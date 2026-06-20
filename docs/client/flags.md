# Flags

Each faction/country has a procedurally generated flag, used in join/selection and throughout the UI.
The system is small and self-contained in [`src/flags/`](../../src/flags/).

## Pieces

- [`flagTypes.ts`](../../src/flags/flagTypes.ts) — the `FlagDesign` shape (container/pattern/symbol +
  colors) and related types.
- [`flagPresets.ts`](../../src/flags/flagPresets.ts) — the libraries of symbols, color palettes, and
  patterns to draw from.
- [`flagGenerator.ts`](../../src/flags/flagGenerator.ts) — builds a `FlagDesign` from parameters
  (deterministic given the same inputs).
- [`renderFlagSvg.ts`](../../src/flags/renderFlagSvg.ts) — renders a `FlagDesign` to SVG for display.

Preview images for presets live under `public/flag-previews/`; the join form
([`src/components/FlagJoinForm.tsx`](../../src/components/FlagJoinForm.tsx)) lets a player pick/compose
a flag when claiming a country. There is a generation script at
[`scripts/generate-flag-previews.mjs`](../../scripts/generate-flag-previews.mjs).

## How to extend / rules

- Add symbols/colors/patterns to [`flagPresets.ts`](../../src/flags/flagPresets.ts); keep
  [`flagTypes.ts`](../../src/flags/flagTypes.ts) and the renderer in sync.
- A flag is data (`FlagDesign`) — persist/transmit the design, render it with `renderFlagSvg` where
  needed, rather than baking raster images.
- Regenerate preset previews with the script if you change the preset libraries.

## Key files

- [`src/flags/`](../../src/flags/) — types, presets, generator, SVG renderer.
- [`src/components/FlagJoinForm.tsx`](../../src/components/FlagJoinForm.tsx) — selection UI.
- [`scripts/generate-flag-previews.mjs`](../../scripts/generate-flag-previews.mjs) — preview generator.
