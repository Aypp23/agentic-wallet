/* global console */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));

const TITLE = 'Welcome to Agentic Wallet';
const SUBTITLE = 'Command-line interface for autonomous wallet agents';
const TAGLINE = 'Plan, execute, and govern onchain intents with policy + proofs.';

const WIDE_LOGO = [
  ' █████╗  ██████╗ ███████╗███╗   ██╗████████╗██╗ ██████╗',
  '██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝██║██╔════╝',
  '███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   ██║██║     ',
  '██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   ██║██║     ',
  '██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   ██║╚██████╗',
  '╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚═╝ ╚═════╝',
];

const COMPACT_LOGO = [
  ' █▀█ █▀▀ █▀▀ █▄░█ ▀█▀ █ █▀▀',
  ' █▀█ █▄█ ██▄ █░▀█ ░█░ █ █▄▄',
];

const MASCOT_TEMPLATE = [
  '      HHHHHHHH      ',
  '   HHHGGGGGGGGHHH   ',
  '  HHGGGGGGGGGGGGHH  ',
  ' HHGGGG  GG  GGGGHH ',
  ' HHGGGG  GG  GGGGHH ',
  ' HHGGGG  EE  GGGGHH ',
  '  HHGGGGGGGGGGGGHH  ',
  '   HHHHHHHHHHHHHH   ',
];

const LEGEND = {
  '.': 'plain',
  F: 'frame',
  M: 'meta',
  T: 'title',
  L: 'logoMain',
  S: 'logoShadow',
  U: 'subtitle',
  P: 'prompt',
  K: 'spark',
  H: 'mascotHead',
  G: 'mascotGoggles',
  E: 'mascotEyes',
};

const INVERSE_LEGEND = Object.fromEntries(Object.entries(LEGEND).map(([token, role]) => [role, token]));

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const eased = (t) => {
  const x = clamp(t, 0, 1);
  return 1 - (1 - x) * (1 - x);
};

const makeCanvas = (width, height) =>
  Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({ char: ' ', role: 'plain' })),
  );

const setCell = (canvas, x, y, char, role) => {
  const width = canvas[0]?.length ?? 0;
  if (width === 0) return;
  if (x < 0 || x >= width || y < 0 || y >= canvas.length) return;
  canvas[y][x] = { char, role };
};

const drawText = (canvas, x, y, text, role) => {
  for (let i = 0; i < text.length; i += 1) {
    setCell(canvas, x + i, y, text[i] ?? ' ', role);
  }
};

const drawOuterFrame = (canvas) => {
  const width = canvas[0]?.length ?? 0;
  const height = canvas.length;
  for (let x = 0; x < width; x += 1) {
    setCell(canvas, x, 0, x === 0 ? '╭' : x === width - 1 ? '╮' : '─', 'frame');
    setCell(canvas, x, height - 1, x === 0 ? '╰' : x === width - 1 ? '╯' : '─', 'frame');
  }
  for (let y = 1; y < height - 1; y += 1) {
    setCell(canvas, 0, y, '│', 'frame');
    setCell(canvas, width - 1, y, '│', 'frame');
  }
};

const drawCornerBrackets = (canvas) => {
  const width = canvas[0]?.length ?? 0;
  const height = canvas.length;
  if (width < 30 || height < 10) return;
  drawText(canvas, 2, 2, '┌──', 'frame');
  drawText(canvas, 2, 3, '│', 'frame');
  drawText(canvas, width - 5, 2, '──┐', 'frame');
  drawText(canvas, width - 3, 3, '│', 'frame');
  drawText(canvas, 2, height - 3, '│', 'frame');
  drawText(canvas, 2, height - 2, '└──', 'frame');
  drawText(canvas, width - 3, height - 3, '│', 'frame');
  drawText(canvas, width - 5, height - 2, '──┘', 'frame');
};

const drawLogo = (canvas, x, y, compact) => {
  const art = compact ? COMPACT_LOGO : WIDE_LOGO;
  for (let row = 0; row < art.length; row += 1) {
    const line = art[row] ?? '';
    for (let col = 0; col < line.length; col += 1) {
      const ch = line[col] ?? ' ';
      if (ch === ' ') continue;
      const shadowX = x + col + 1;
      const shadowY = y + row + 1;
      const shadowCell = canvas[shadowY]?.[shadowX];
      if (shadowCell?.char === ' ') {
        setCell(canvas, shadowX, shadowY, '░', 'logoShadow');
      }
      setCell(canvas, x + col, y + row, ch, 'logoMain');
    }
  }
};

const drawMascot = (canvas, x, y) => {
  for (let row = 0; row < MASCOT_TEMPLATE.length; row += 1) {
    const line = MASCOT_TEMPLATE[row] ?? '';
    for (let col = 0; col < line.length; col += 1) {
      const token = line[col] ?? ' ';
      if (token === ' ') continue;
      if (token === 'H') setCell(canvas, x + col, y + row, '█', 'mascotHead');
      if (token === 'G') setCell(canvas, x + col, y + row, '█', 'mascotGoggles');
      if (token === 'E') setCell(canvas, x + col, y + row, '█', 'mascotEyes');
    }
  }
};

const toLines = (canvas) => ({
  contentLines: canvas.map((row) => row.map((cell) => cell.char).join('')),
  roleLines: canvas.map((row) =>
    row
      .map((cell) => {
        const token = INVERSE_LEGEND[cell.role];
        return typeof token === 'string' ? token : '.';
      })
      .join(''),
  ),
});

const buildFrame = (layout, state) => {
  const canvas = makeCanvas(layout.width, layout.height);
  drawOuterFrame(canvas);
  drawCornerBrackets(canvas);

  const leftSpark = state.sparkTick % 2 === 0 ? '✦' : '✧';
  const rightSpark = state.sparkTick % 3 === 0 ? '✦' : '✧';
  drawText(canvas, 3, 1, leftSpark, 'spark');
  drawText(canvas, 6, 1, TITLE, 'meta');
  drawText(canvas, layout.width - 4, 1, rightSpark, 'spark');

  drawLogo(canvas, 4, 4, layout.compact);
  drawMascot(canvas, state.mascotX, 4);

  drawText(canvas, layout.compact ? 3 : 5, layout.height - 6, SUBTITLE, 'title');
  const reveal = TAGLINE.slice(0, clamp(state.revealChars, 0, TAGLINE.length)).padEnd(TAGLINE.length, ' ');
  drawText(canvas, 4, layout.height - 4, `• ${reveal}`, 'subtitle');
  drawText(canvas, 4, layout.height - 3, '• mode: interactive', 'meta');
  drawText(canvas, 4, layout.height - 2, '> Enter @ for files, / for commands, Ctrl+C to quit', 'prompt');

  return toLines(canvas);
};

const buildStates = (layout, totalFrames) => {
  const mascotStart = layout.width + 8;
  const mascotEnd = layout.compact ? layout.width - 22 : layout.width - 24;

  return Array.from({ length: totalFrames }, (_, index) => {
    const progress = index / (totalFrames - 1);
    return {
      revealChars: Math.round(TAGLINE.length * Math.min(1, progress * 1.25)),
      mascotX: Math.round(mascotStart + (mascotEnd - mascotStart) * eased(progress)),
      glintX: Math.round((layout.width - 1) * progress),
      sparkTick: index,
    };
  });
};

const writeSequence = (name, layout, totalFrames) => {
  const baseDir = join(ROOT, name);
  const framesDir = join(baseDir, 'frames');
  const mapsDir = join(baseDir, 'maps');

  rmSync(baseDir, { recursive: true, force: true });
  mkdirSync(framesDir, { recursive: true });
  mkdirSync(mapsDir, { recursive: true });

  const states = buildStates(layout, totalFrames);

  const manifest = {
    id: `agentic-wallet-banner-${name}`,
    width: layout.width,
    height: layout.height,
    version: 1,
    compact: layout.compact,
    frames: states.map((state, index) => {
      const frameName = `frame-${String(index + 1).padStart(2, '0')}`;
      const { contentLines, roleLines } = buildFrame(layout, state);
      writeFileSync(join(framesDir, `${frameName}.txt`), `${contentLines.join('\n')}\n`, 'utf8');
      writeFileSync(
        join(mapsDir, `${frameName}.roles.json`),
        `${JSON.stringify({ legend: LEGEND, rows: roleLines }, null, 2)}\n`,
        'utf8',
      );

      return {
        name: frameName,
        duration: 75,
        glintX: state.glintX,
      };
    }),
  };

  writeFileSync(join(baseDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
};

writeSequence('wide', { width: 96, height: 17, compact: false }, 20);
writeSequence('compact', { width: 78, height: 15, compact: true }, 20);

console.log('Banner assets generated at', ROOT);
