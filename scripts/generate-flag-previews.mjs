import fs from 'node:fs';
import path from 'node:path';
import PImage from 'pureimage';
import { FLAG_PRESETS } from '../src/flags/flagPresets.ts';

const OUTPUT_DIR = path.resolve('public/flag-previews');
const PREVIEW_SIZE = 1024;
const GRID_COLUMNS = 5;
const GRID_PADDING = 32;
const CELL_SIZE = 256;

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  const value = Number.parseInt(clean.length === 3
    ? clean.split('').map((char) => char + char).join('')
    : clean,
  16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function color(hex, alpha = 1) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

function drawPolygon(ctx, points, fillStyle, strokeStyle, lineWidth = 1) {
  if (points.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i += 1) {
    ctx.lineTo(points[i][0], points[i][1]);
  }
  ctx.closePath();
  if (fillStyle) {
    ctx.fillStyle = fillStyle;
    ctx.fill();
  }
  if (strokeStyle) {
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = strokeStyle;
    ctx.stroke();
  }
}

function drawContainer(ctx, container, w, h, fillStyle) {
  ctx.save();
  ctx.fillStyle = fillStyle;
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = Math.max(4, w * 0.012);
  ctx.beginPath();

  if (container.id === 'square') {
    ctx.rect(0, 0, w, h);
  } else if (container.id === 'circle') {
    ctx.arc(w / 2, h / 2, Math.min(w, h) * 0.5, 0, Math.PI * 2);
  } else if (container.id === 'hexagon') {
    drawPolygon(ctx, [
      [w * 0.25, h * 0.08],
      [w * 0.75, h * 0.08],
      [w * 0.98, h * 0.5],
      [w * 0.75, h * 0.92],
      [w * 0.25, h * 0.92],
      [w * 0.02, h * 0.5],
    ]);
  } else if (container.id === 'octagon') {
    drawPolygon(ctx, [
      [w * 0.30, h * 0.02],
      [w * 0.70, h * 0.02],
      [w * 0.98, h * 0.30],
      [w * 0.98, h * 0.70],
      [w * 0.70, h * 0.98],
      [w * 0.30, h * 0.98],
      [w * 0.02, h * 0.70],
      [w * 0.02, h * 0.30],
    ]);
  } else if (container.id === 'shield') {
    drawPolygon(ctx, [
      [w * 0.50, h * 0.02],
      [w * 0.90, h * 0.12],
      [w * 0.98, h * 0.40],
      [w * 0.78, h * 0.98],
      [w * 0.22, h * 0.98],
      [w * 0.02, h * 0.40],
      [w * 0.10, h * 0.12],
    ]);
  }
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawPattern(ctx, pattern, w, h, colors) {
  const { backgroundColor, accentColor } = colors;
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = accentColor;
  ctx.fillStyle = accentColor;

  const drawStripe = (x1, y1, x2, y2, width) => {
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  };

  if (pattern.id === 'split-vertical') {
    ctx.fillStyle = accentColor;
    ctx.fillRect(w * 0.5 - w * 0.03, 0, w * 0.06, h);
  } else if (pattern.id === 'split-horizontal') {
    ctx.fillStyle = accentColor;
    ctx.fillRect(0, h * 0.5 - h * 0.03, w, h * 0.06);
  } else if (pattern.id === 'diagonal-band') {
    ctx.lineWidth = Math.max(18, w * 0.07);
    ctx.beginPath();
    ctx.moveTo(-w * 0.1, h * 0.2);
    ctx.lineTo(w * 1.1, h * 0.8);
    ctx.stroke();
  } else if (pattern.id === 'corner-glow') {
    ctx.globalAlpha = 0.45;
    ctx.fillRect(0, 0, w * 0.18, h * 0.18);
    ctx.fillRect(w * 0.82, 0, w * 0.18, h * 0.18);
    ctx.fillRect(0, h * 0.82, w * 0.18, h * 0.18);
    ctx.fillRect(w * 0.82, h * 0.82, w * 0.18, h * 0.18);
  } else if (pattern.id === 'dot-grid') {
    const step = Math.max(28, Math.floor(w * 0.11));
    for (let y = step * 0.5; y < h; y += step) {
      for (let x = step * 0.5; x < w; x += step) {
        ctx.beginPath();
        ctx.arc(x, y, step * 0.08, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else if (pattern.id === 'wave-lines') {
    ctx.lineWidth = Math.max(4, w * 0.012);
    for (let i = 0; i < 4; i += 1) {
      const y = h * (0.2 + i * 0.18);
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x <= w; x += w / 12) {
        const offset = Math.sin((x / w) * Math.PI * 4 + i) * h * 0.015;
        ctx.lineTo(x, y + offset);
      }
      ctx.stroke();
    }
  } else if (pattern.id === 'concentric-rings') {
    ctx.lineWidth = Math.max(4, w * 0.014);
    ctx.globalAlpha = 0.25;
    for (let ring = 1; ring <= 3; ring += 1) {
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, Math.min(w, h) * (0.18 + ring * 0.15), 0, Math.PI * 2);
      ctx.stroke();
    }
  } else if (pattern.id === 'chevron-stack') {
    ctx.lineWidth = Math.max(10, w * 0.04);
    for (let i = 0; i < 3; i += 1) {
      const top = h * (0.18 + i * 0.18);
      ctx.beginPath();
      ctx.moveTo(w * 0.18, top);
      ctx.lineTo(w * 0.5, top + h * 0.14);
      ctx.lineTo(w * 0.82, top);
      ctx.stroke();
    }
  } else if (pattern.id === 'radial-sunburst') {
    ctx.lineWidth = Math.max(4, w * 0.012);
    for (let i = 0; i < 16; i += 1) {
      const angle = (Math.PI * 2 * i) / 16;
      const cx = w / 2;
      const cy = h / 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(angle) * w * 0.45, cy + Math.sin(angle) * h * 0.45);
      ctx.stroke();
    }
  }

  ctx.restore();
}

function drawSymbol(ctx, symbol, w, h, primaryColor, accentColor) {
  const cx = w / 2;
  const cy = h / 2;
  ctx.save();
  ctx.fillStyle = primaryColor;
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = Math.max(4, w * 0.018);

  const drawVerticalSpine = (top, bottom, width) => {
    ctx.fillRect(cx - width / 2, top, width, bottom - top);
  };

  switch (symbol.id) {
    case 'starburst': {
      drawPolygon(ctx, [
        [cx, cy - h * 0.24], [cx + w * 0.05, cy - h * 0.08], [cx + w * 0.24, cy - h * 0.04],
        [cx + w * 0.09, cy + h * 0.04], [cx + w * 0.16, cy + h * 0.22], [cx, cy + h * 0.11],
        [cx - w * 0.16, cy + h * 0.22], [cx - w * 0.09, cy + h * 0.04], [cx - w * 0.24, cy - h * 0.04],
        [cx - w * 0.05, cy - h * 0.08],
      ], primaryColor, accentColor, 4);
      break;
    }
    case 'twin-spires': {
      drawPolygon(ctx, [[cx - w * 0.16, cy + h * 0.2], [cx - w * 0.05, cy - h * 0.18], [cx + 0, cy - h * 0.02], [cx + w * 0.05, cy + h * 0.2]], primaryColor, accentColor, 4);
      drawPolygon(ctx, [[cx + w * 0.16, cy + h * 0.2], [cx + w * 0.05, cy - h * 0.18], [cx + 0, cy - h * 0.02], [cx - w * 0.05, cy + h * 0.2]], primaryColor, accentColor, 4);
      break;
    }
    case 'halo-anchor': {
      ctx.beginPath(); ctx.arc(cx, cy, Math.min(w, h) * 0.18, 0, Math.PI * 2); ctx.fill();
      ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, Math.min(w, h) * 0.34, 0, Math.PI * 2); ctx.stroke();
      drawVerticalSpine(cy - h * 0.18, cy + h * 0.18, w * 0.06);
      break;
    }
    case 'crest-chevron': {
      drawPolygon(ctx, [[cx, cy - h * 0.24], [cx + w * 0.2, cy], [cx + w * 0.1, cy + h * 0.22], [cx, cy + h * 0.12], [cx - w * 0.1, cy + h * 0.22], [cx - w * 0.2, cy]], primaryColor, accentColor, 4);
      break;
    }
    case 'apex-wings': {
      drawPolygon(ctx, [[cx, cy - h * 0.24], [cx + w * 0.18, cy + h * 0.14], [cx + w * 0.04, cy + h * 0.08], [cx, cy + h * 0.2], [cx - w * 0.04, cy + h * 0.08], [cx - w * 0.18, cy + h * 0.14]], primaryColor, accentColor, 4);
      break;
    }
    case 'eye-lens': {
      drawPolygon(ctx, [[cx - w * 0.22, cy], [cx - w * 0.1, cy - h * 0.12], [cx + w * 0.1, cy - h * 0.12], [cx + w * 0.22, cy], [cx + w * 0.1, cy + h * 0.12], [cx - w * 0.1, cy + h * 0.12]], primaryColor, accentColor, 4);
      ctx.fillStyle = accentColor;
      ctx.beginPath(); ctx.arc(cx, cy, Math.min(w, h) * 0.06, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'beacon-crown': {
      drawPolygon(ctx, [[cx - w * 0.16, cy + h * 0.18], [cx - w * 0.1, cy - h * 0.04], [cx, cy - h * 0.24], [cx + w * 0.1, cy - h * 0.04], [cx + w * 0.16, cy + h * 0.18]], primaryColor, accentColor, 4);
      ctx.fillRect(cx - w * 0.05, cy + h * 0.12, w * 0.1, h * 0.1);
      break;
    }
    case 'ring-node': {
      ctx.beginPath(); ctx.arc(cx, cy, Math.min(w, h) * 0.18, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, Math.min(w, h) * 0.32, 0, Math.PI * 2); ctx.stroke();
      ctx.fillRect(cx + w * 0.18, cy - h * 0.04, w * 0.12, h * 0.08);
      break;
    }
    case 'wave-stack': {
      for (let i = 0; i < 3; i += 1) {
        const top = cy - h * 0.1 + i * h * 0.12;
        drawPolygon(ctx, [[cx - w * 0.22, top], [cx - w * 0.08, top - h * 0.05], [cx, top], [cx + w * 0.08, top - h * 0.05], [cx + w * 0.22, top], [cx + w * 0.15, top + h * 0.08], [cx - w * 0.15, top + h * 0.08]], primaryColor, accentColor, 3);
      }
      break;
    }
    case 'blade-pair': {
      drawPolygon(ctx, [[cx - w * 0.2, cy + h * 0.16], [cx - w * 0.06, cy - h * 0.22], [cx + 0, cy - h * 0.08], [cx - w * 0.08, cy + h * 0.22]], primaryColor, accentColor, 4);
      drawPolygon(ctx, [[cx + w * 0.2, cy + h * 0.16], [cx + w * 0.06, cy - h * 0.22], [cx + 0, cy - h * 0.08], [cx + w * 0.08, cy + h * 0.22]], primaryColor, accentColor, 4);
      break;
    }
    case 'crystal-shard': {
      drawPolygon(ctx, [[cx, cy - h * 0.28], [cx + w * 0.11, cy - h * 0.04], [cx + w * 0.08, cy + h * 0.22], [cx - w * 0.08, cy + h * 0.22], [cx - w * 0.11, cy - h * 0.04]], primaryColor, accentColor, 4);
      break;
    }
    case 'hex-core': {
      drawPolygon(ctx, [[cx, cy - h * 0.22], [cx + w * 0.18, cy - h * 0.11], [cx + w * 0.18, cy + h * 0.11], [cx, cy + h * 0.22], [cx - w * 0.18, cy + h * 0.11], [cx - w * 0.18, cy - h * 0.11]], primaryColor, accentColor, 4);
      ctx.fillStyle = accentColor;
      ctx.fillRect(cx - w * 0.05, cy - h * 0.05, w * 0.1, h * 0.1);
      break;
    }
    case 'split-diamond': {
      drawPolygon(ctx, [[cx, cy - h * 0.26], [cx + w * 0.2, cy], [cx, cy + h * 0.26], [cx - w * 0.2, cy]], primaryColor, accentColor, 4);
      ctx.strokeStyle = accentColor;
      ctx.beginPath();
      ctx.moveTo(cx - w * 0.15, cy - h * 0.12);
      ctx.lineTo(cx + w * 0.15, cy + h * 0.12);
      ctx.stroke();
      break;
    }
    case 'circuit-knot': {
      ctx.lineWidth = Math.max(5, w * 0.02);
      ctx.beginPath();
      ctx.moveTo(cx - w * 0.18, cy - h * 0.08);
      ctx.lineTo(cx - w * 0.05, cy - h * 0.08);
      ctx.lineTo(cx - w * 0.05, cy + h * 0.08);
      ctx.lineTo(cx + w * 0.1, cy + h * 0.08);
      ctx.lineTo(cx + w * 0.1, cy - h * 0.16);
      ctx.lineTo(cx + w * 0.22, cy - h * 0.16);
      ctx.stroke();
      break;
    }
    case 'solar-disk': {
      ctx.beginPath(); ctx.arc(cx, cy, Math.min(w, h) * 0.16, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      for (let i = 0; i < 8; i += 1) {
        const angle = (Math.PI * 2 * i) / 8;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * w * 0.18, cy + Math.sin(angle) * h * 0.18);
        ctx.lineTo(cx + Math.cos(angle) * w * 0.28, cy + Math.sin(angle) * h * 0.28);
        ctx.stroke();
      }
      break;
    }
    case 'arch-gate': {
      ctx.beginPath();
      ctx.moveTo(cx - w * 0.18, cy + h * 0.18);
      ctx.lineTo(cx - w * 0.18, cy - h * 0.1);
      ctx.quadraticCurveTo(cx, cy - h * 0.26, cx + w * 0.18, cy - h * 0.1);
      ctx.lineTo(cx + w * 0.18, cy + h * 0.18);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'loop-knot': {
      ctx.beginPath(); ctx.arc(cx - w * 0.09, cy, Math.min(w, h) * 0.12, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx + w * 0.09, cy, Math.min(w, h) * 0.12, 0, Math.PI * 2); ctx.stroke();
      break;
    }
    case 'plume-triad': {
      drawPolygon(ctx, [[cx - w * 0.16, cy + h * 0.2], [cx - w * 0.08, cy], [cx, cy - h * 0.22], [cx + w * 0.08, cy], [cx + w * 0.16, cy + h * 0.2]], primaryColor, accentColor, 4);
      break;
    }
    case 'lattice-bloom': {
      drawPolygon(ctx, [[cx, cy - h * 0.22], [cx + w * 0.17, cy - h * 0.06], [cx + w * 0.12, cy + h * 0.18], [cx - w * 0.12, cy + h * 0.18], [cx - w * 0.17, cy - h * 0.06]], primaryColor, accentColor, 4);
      ctx.strokeStyle = accentColor;
      ctx.beginPath(); ctx.moveTo(cx - w * 0.11, cy); ctx.lineTo(cx + w * 0.11, cy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, cy - h * 0.12); ctx.lineTo(cx, cy + h * 0.12); ctx.stroke();
      break;
    }
    case 'crown-prism': {
      drawPolygon(ctx, [[cx - w * 0.2, cy + h * 0.18], [cx - w * 0.12, cy - h * 0.08], [cx - w * 0.04, cy + h * 0.04], [cx, cy - h * 0.2], [cx + w * 0.04, cy + h * 0.04], [cx + w * 0.12, cy - h * 0.08], [cx + w * 0.2, cy + h * 0.18]], primaryColor, accentColor, 4);
      break;
    }
    default: {
      ctx.beginPath(); ctx.arc(cx, cy, Math.min(w, h) * 0.15, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  }

  ctx.restore();
}

function renderFlag(preset, size = PREVIEW_SIZE) {
  const image = PImage.make(size, size);
  const ctx = image.getContext('2d');
  const bg = preset.design.backgroundColor.hex;
  const accent = preset.design.accentColor.hex;
  const darker = color(bg, 1);
  const lighter = color(accent, 1);

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);

  drawPattern(ctx, preset.design.pattern, size, size, {
    backgroundColor: darker,
    accentColor: lighter,
  });

  ctx.save();
  drawContainer(ctx, preset.design.container, size, size, 'rgba(255,255,255,0.04)');
  ctx.clip();
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);
  drawPattern(ctx, preset.design.pattern, size, size, {
    backgroundColor: darker,
    accentColor: lighter,
  });
  drawSymbol(ctx, preset.design.primarySymbol, size, size, lighter, 'rgba(255,255,255,0.75)');
  if (preset.design.secondarySymbol) {
    ctx.globalAlpha = 0.85;
    drawSymbol(ctx, preset.design.secondarySymbol, size * 0.62, size * 0.62, 'rgba(255,255,255,0.84)', lighter);
  }
  ctx.restore();

  // small border accent
  ctx.lineWidth = Math.max(8, size * 0.015);
  ctx.strokeStyle = 'rgba(255,255,255,0.72)';
  if (preset.design.container.borderRadius) {
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size * 0.5 - ctx.lineWidth, 0, Math.PI * 2);
    ctx.stroke();
  } else if (preset.design.container.clipPath) {
    // outline redraw using the same shape as the container
    const c = preset.design.container.id;
    if (c === 'hexagon') {
      drawPolygon(ctx, [[size * 0.25, size * 0.08], [size * 0.75, size * 0.08], [size * 0.98, size * 0.5], [size * 0.75, size * 0.92], [size * 0.25, size * 0.92], [size * 0.02, size * 0.5]], null, 'rgba(255,255,255,0.72)', ctx.lineWidth);
    } else if (c === 'octagon') {
      drawPolygon(ctx, [[size * 0.30, size * 0.02], [size * 0.70, size * 0.02], [size * 0.98, size * 0.30], [size * 0.98, size * 0.70], [size * 0.70, size * 0.98], [size * 0.30, size * 0.98], [size * 0.02, size * 0.70], [size * 0.02, size * 0.30]], null, 'rgba(255,255,255,0.72)', ctx.lineWidth);
    } else if (c === 'shield') {
      drawPolygon(ctx, [[size * 0.50, size * 0.02], [size * 0.90, size * 0.12], [size * 0.98, size * 0.40], [size * 0.78, size * 0.98], [size * 0.22, size * 0.98], [size * 0.02, size * 0.40], [size * 0.10, size * 0.12]], null, 'rgba(255,255,255,0.72)', ctx.lineWidth);
    }
  } else {
    ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, size - ctx.lineWidth, size - ctx.lineWidth);
  }

  return image;
}

async function writePng(image, filePath) {
  await new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(filePath);
    PImage.encodePNGToStream(image, stream).then(resolve).catch(reject);
  });
}

async function main() {
  ensureDir(OUTPUT_DIR);
  const written = [];

  for (const preset of FLAG_PRESETS) {
    const fileName = `${preset.id}.png`;
    const filePath = path.join(OUTPUT_DIR, fileName);
    await writePng(renderFlag(preset), filePath);
    written.push({ preset, fileName });
  }

  const gridColumns = GRID_COLUMNS;
  const gridRows = Math.ceil(written.length / gridColumns);
  const sheetWidth = gridColumns * CELL_SIZE + GRID_PADDING * 2;
  const sheetHeight = gridRows * CELL_SIZE + GRID_PADDING * 2;
  const sheet = PImage.make(sheetWidth, sheetHeight);
  const sheetCtx = sheet.getContext('2d');
  sheetCtx.fillStyle = '#0a0e14';
  sheetCtx.fillRect(0, 0, sheetWidth, sheetHeight);

  for (let index = 0; index < written.length; index += 1) {
    const { preset } = written[index];
    const row = Math.floor(index / gridColumns);
    const column = index % gridColumns;
    const x = GRID_PADDING + column * CELL_SIZE;
    const y = GRID_PADDING + row * CELL_SIZE;
    const flag = renderFlag(preset, CELL_SIZE - 20);
    sheetCtx.drawImage(flag, x + 10, y + 10);
  }

  await writePng(sheet, path.join(OUTPUT_DIR, 'flag-preview-grid.png'));

  console.log(`Wrote ${written.length} flag previews to ${OUTPUT_DIR}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
