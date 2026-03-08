import boxen from 'boxen';
import chalk from 'chalk';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { clearLine, clearScreenDown, cursorTo } from 'node:readline';
import { fileURLToPath } from 'node:url';

type BannerBorderStyle = 'single' | 'double' | 'round' | 'bold' | 'singleDouble';
type Role =
  | 'plain'
  | 'frame'
  | 'meta'
  | 'title'
  | 'logoMain'
  | 'logoShadow'
  | 'subtitle'
  | 'prompt'
  | 'spark'
  | 'mascotHead'
  | 'mascotGoggles'
  | 'mascotEyes';

interface Cell {
  char: string;
  role: Role;
}

interface Palette {
  frame: string;
  meta: string;
  title: string;
  subtitle: string;
  prompt: string;
  spark: string;
  logoShadow: string;
  mascotHead: string;
  mascotGoggles: string;
  mascotEyes: string;
}

export interface BannerTheme {
  name: string;
  accent: (value: string) => string;
  accentSoft: (value: string) => string;
  muted: (value: string) => string;
  borderColor: string;
  bannerBorderStyle: BannerBorderStyle;
  gradientStops: [string, string, string];
}

export interface StartupBannerOptions {
  theme: BannerTheme;
  enabled: boolean;
  animated: boolean;
}

interface SequenceManifestFrame {
  name: string;
  duration: number;
  glintX: number;
}

interface SequenceManifest {
  id: string;
  width: number;
  height: number;
  version: number;
  compact: boolean;
  frames: SequenceManifestFrame[];
}

interface RoleMapAsset {
  legend: Record<string, string>;
  rows: string[];
}

interface LoadedFrame {
  duration: number;
  glintX: number;
  cells: Cell[][];
}

interface LoadedSequence {
  id: string;
  compact: boolean;
  width: number;
  height: number;
  frames: LoadedFrame[];
}

const FRAME_MS = 75;
const MAX_BANNER_MS = 3000;
const COMPACT_THRESHOLD = 100;

const PALETTES: Record<string, Palette> = {
  midnight: {
    frame: '#7c5cff',
    meta: '#a1a1aa',
    title: '#d4d4d8',
    subtitle: '#a1a1aa',
    prompt: '#e4e4e7',
    spark: '#22d3ee',
    logoShadow: '#d4d4d8',
    mascotHead: '#bb74d8',
    mascotGoggles: '#56b8df',
    mascotEyes: '#6ee7b7',
  },
  matrix: {
    frame: '#16a34a',
    meta: '#4ade80',
    title: '#bbf7d0',
    subtitle: '#86efac',
    prompt: '#dcfce7',
    spark: '#22c55e',
    logoShadow: '#4ade80',
    mascotHead: '#22c55e',
    mascotGoggles: '#86efac',
    mascotEyes: '#bbf7d0',
  },
  solarized: {
    frame: '#b58900',
    meta: '#586e75',
    title: '#073642',
    subtitle: '#657b83',
    prompt: '#073642',
    spark: '#2aa198',
    logoShadow: '#93a1a1',
    mascotHead: '#cb4b16',
    mascotGoggles: '#2aa198',
    mascotEyes: '#859900',
  },
  fire: {
    frame: '#ff5f56',
    meta: '#ffb88c',
    title: '#ffe2cf',
    subtitle: '#ffd0b1',
    prompt: '#ffece1',
    spark: '#ff9f43',
    logoShadow: '#fecaca',
    mascotHead: '#ff7f50',
    mascotGoggles: '#ffb347',
    mascotEyes: '#ffd166',
  },
};

const DEFAULT_PALETTE: Palette = PALETTES.midnight ?? {
  frame: '#7c5cff',
  meta: '#a1a1aa',
  title: '#d4d4d8',
  subtitle: '#a1a1aa',
  prompt: '#e4e4e7',
  spark: '#22d3ee',
  logoShadow: '#d4d4d8',
  mascotHead: '#bb74d8',
  mascotGoggles: '#56b8df',
  mascotEyes: '#6ee7b7',
};

const ROLE_SET = new Set<Role>([
  'plain',
  'frame',
  'meta',
  'title',
  'logoMain',
  'logoShadow',
  'subtitle',
  'prompt',
  'spark',
  'mascotHead',
  'mascotGoggles',
  'mascotEyes',
]);

let cachedSequences: { wide: LoadedSequence; compact: LoadedSequence } | null = null;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const supportsAnimation = (): boolean => {
  if (!process.stdout.isTTY || !process.stdin.isTTY) return false;
  if ((process.env.CI ?? '').toLowerCase() === 'true') return false;
  if ((process.env.TERM ?? '').toLowerCase() === 'dumb') return false;
  if ((process.env.SCREEN_READER ?? '').toLowerCase() === 'true') return false;
  if ((process.env.CLI_SCREEN_READER ?? '').toLowerCase() === 'true') return false;
  return true;
};

const clamp = (n: number, min: number, max: number): number => Math.max(min, Math.min(max, n));

const hexToRgb = (hex: string): [number, number, number] => {
  const clean = hex.replace('#', '');
  const normalized = clean.length === 3 ? clean.split('').map((v) => `${v}${v}`).join('') : clean;
  const parsed = Number.parseInt(normalized, 16);
  return [(parsed >> 16) & 255, (parsed >> 8) & 255, parsed & 255];
};

const mix = (a: number, b: number, t: number): number => Math.round(a + (b - a) * t);

const gradientRgb = (stops: [string, string, string], t: number): [number, number, number] => {
  if (t <= 0.5) {
    const [r1, g1, b1] = hexToRgb(stops[0]);
    const [r2, g2, b2] = hexToRgb(stops[1]);
    const local = t / 0.5;
    return [mix(r1, r2, local), mix(g1, g2, local), mix(b1, b2, local)];
  }
  const [r2, g2, b2] = hexToRgb(stops[1]);
  const [r3, g3, b3] = hexToRgb(stops[2]);
  const local = (t - 0.5) / 0.5;
  return [mix(r2, r3, local), mix(g2, g3, local), mix(b2, b3, local)];
};

const isRole = (value: string): value is Role => ROLE_SET.has(value as Role);

const normalizeLine = (line: string | undefined, width: number, fill: string): string =>
  (line ?? '').slice(0, width).padEnd(width, fill);

const parseTextFile = (path: string): string[] => {
  const raw = readFileSync(path, 'utf8').replace(/\r\n/g, '\n').replace(/\n$/, '');
  return raw.split('\n');
};

const parseJsonFile = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

const resolveAssetRoot = (): string | null => {
  const localFromThisFile = fileURLToPath(new URL('./banner-assets', import.meta.url));
  if (existsSync(localFromThisFile)) return localFromThisFile;

  const distFallback = fileURLToPath(new URL('../src/banner-assets', import.meta.url));
  if (existsSync(distFallback)) return distFallback;

  const cwdSrc = join(process.cwd(), 'apps', 'cli', 'src', 'banner-assets');
  if (existsSync(cwdSrc)) return cwdSrc;

  const cwdFlat = join(process.cwd(), 'src', 'banner-assets');
  if (existsSync(cwdFlat)) return cwdFlat;

  const repoFallback = join(dirname(fileURLToPath(import.meta.url)), 'banner-assets');
  if (existsSync(repoFallback)) return repoFallback;

  return null;
};

const toCells = (manifest: SequenceManifest, frameName: string): Cell[][] => {
  const root = resolveAssetRoot();
  if (root === null) {
    throw new Error('Banner assets directory was not found.');
  }

  const variant = manifest.compact ? 'compact' : 'wide';
  const framePath = join(root, variant, 'frames', `${frameName}.txt`);
  const mapPath = join(root, variant, 'maps', `${frameName}.roles.json`);

  const textRows = parseTextFile(framePath);
  const roleAsset = parseJsonFile<RoleMapAsset>(mapPath);

  const roleRows = roleAsset.rows;
  const legend = roleAsset.legend;
  const height = manifest.height;
  const width = manifest.width;

  const cells: Cell[][] = [];

  for (let y = 0; y < height; y += 1) {
    const textLine = normalizeLine(textRows[y], width, ' ');
    const roleLine = normalizeLine(roleRows[y], width, '.');
    const row: Cell[] = [];

    for (let x = 0; x < width; x += 1) {
      const token = roleLine[x] ?? '.';
      const legendValue = legend[token] ?? 'plain';
      const role = isRole(legendValue) ? legendValue : 'plain';
      row.push({ char: textLine[x] ?? ' ', role });
    }

    cells.push(row);
  }

  return cells;
};

const loadSequence = (variant: 'wide' | 'compact'): LoadedSequence => {
  const root = resolveAssetRoot();
  if (root === null) {
    throw new Error('Banner assets were not found for CLI startup animation.');
  }

  const manifestPath = join(root, variant, 'manifest.json');
  const manifest = parseJsonFile<SequenceManifest>(manifestPath);

  const frames: LoadedFrame[] = manifest.frames.map((frame) => ({
    duration: frame.duration,
    glintX: frame.glintX,
    cells: toCells(manifest, frame.name),
  }));

  return {
    id: manifest.id,
    compact: manifest.compact,
    width: manifest.width,
    height: manifest.height,
    frames,
  };
};

const getSequences = (): { wide: LoadedSequence; compact: LoadedSequence } => {
  if (cachedSequences !== null) return cachedSequences;

  cachedSequences = {
    wide: loadSequence('wide'),
    compact: loadSequence('compact'),
  };

  return cachedSequences;
};

const resolveSequence = (): LoadedSequence => {
  const columns = process.stdout.columns ?? 120;
  const { wide, compact } = getSequences();
  return columns < COMPACT_THRESHOLD ? compact : wide;
};

const clipFrame = (frame: LoadedFrame, maxWidth: number): LoadedFrame => {
  if (maxWidth <= 0) return frame;
  const width = frame.cells[0]?.length ?? 0;
  if (width <= maxWidth) return frame;

  return {
    duration: frame.duration,
    glintX: Math.min(frame.glintX, maxWidth - 1),
    cells: frame.cells.map((row) => row.slice(0, maxWidth)),
  };
};

const paintRole = (
  role: Role,
  ch: string,
  x: number,
  width: number,
  glintX: number,
  theme: BannerTheme,
  palette: Palette,
): string => {
  if (ch === ' ') return ch;
  if (role === 'logoMain') {
    if (Math.abs(x - glintX) <= 1) return chalk.whiteBright.bold(ch);
    if (chalk.level < 2) return theme.accent(ch);
    const t = width <= 1 ? 0 : x / (width - 1);
    const [r, g, b] = gradientRgb(theme.gradientStops, t);
    return chalk.rgb(r, g, b)(ch);
  }
  if (role === 'logoShadow') return chalk.hex(palette.logoShadow).dim(ch);
  if (role === 'frame') return chalk.hex(palette.frame)(ch);
  if (role === 'meta') return chalk.hex(palette.meta)(ch);
  if (role === 'title') return chalk.hex(palette.title).bold(ch);
  if (role === 'subtitle') return chalk.hex(palette.subtitle)(ch);
  if (role === 'prompt') return chalk.hex(palette.prompt).bold(ch);
  if (role === 'spark') return chalk.hex(palette.spark).bold(ch);
  if (role === 'mascotHead') return chalk.hex(palette.mascotHead)(ch);
  if (role === 'mascotGoggles') return chalk.hex(palette.mascotGoggles)(ch);
  if (role === 'mascotEyes') return chalk.hex(palette.mascotEyes).bold(ch);
  return theme.muted(ch);
};

const renderFrameBody = (frame: LoadedFrame, theme: BannerTheme): string => {
  const palette = PALETTES[theme.name] ?? DEFAULT_PALETTE;
  const width = frame.cells[0]?.length ?? 0;
  if (width === 0) return '';

  return frame.cells
    .map((row) =>
      row
        .map((cell, x) => paintRole(cell.role, cell.char, x, width, frame.glintX, theme, palette))
        .join(''),
    )
    .join('\n');
};

const frameToBanner = (frame: LoadedFrame, theme: BannerTheme): string => {
  const columns = process.stdout.columns ?? 120;
  const maxInnerWidth = clamp(columns - 12, 42, frame.cells[0]?.length ?? 42);
  const clipped = clipFrame(frame, maxInnerWidth);
  const body = renderFrameBody(clipped, theme);

  return boxen(body, {
    borderStyle: theme.bannerBorderStyle,
    borderColor: theme.borderColor,
    padding: { top: 0, right: 1, bottom: 0, left: 1 },
  });
};

const renderFallbackBanner = (theme: BannerTheme): void => {
  const content = [
    theme.accent('AGENTIC WALLET CLI'),
    theme.muted('Autonomous wallet operations for agent systems'),
    theme.muted('Use `aw interactive` for full guided mode.'),
  ].join('\n');

  console.log(
    boxen(content, {
      borderStyle: theme.bannerBorderStyle,
      borderColor: theme.borderColor,
      padding: { top: 0, right: 1, bottom: 0, left: 1 },
    }),
  );
};

const renderStaticBanner = (theme: BannerTheme): void => {
  try {
    const sequence = resolveSequence();
    const frame = sequence.frames[sequence.frames.length - 1] ?? sequence.frames[0];
    if (frame === undefined) {
      renderFallbackBanner(theme);
      return;
    }
    console.log(frameToBanner(frame, theme));
  } catch {
    renderFallbackBanner(theme);
  }
};

const renderAnimatedBanner = async (theme: BannerTheme): Promise<void> => {
  const sequence = resolveSequence();
  let elapsed = 0;
  const clipped: LoadedFrame[] = [];

  for (const frame of sequence.frames) {
    const duration = frame.duration > 0 ? frame.duration : FRAME_MS;
    if (elapsed + duration > MAX_BANNER_MS) break;
    clipped.push(frame);
    elapsed += duration;
  }

  if (clipped.length === 0) {
    const first = sequence.frames[0];
    if (first !== undefined) {
      console.log(frameToBanner(first, theme));
      return;
    }
    renderFallbackBanner(theme);
    return;
  }

  let previous: string[] = [];
  process.stdout.write('\x1B[?25l');
  try {
    for (const frame of clipped) {
      const lines = frameToBanner(frame, theme).split('\n');

      if (previous.length === 0) {
        cursorTo(process.stdout, 0, 0);
        clearScreenDown(process.stdout);
        process.stdout.write(`${lines.join('\n')}\n`);
      } else {
        const maxLines = Math.max(previous.length, lines.length);
        for (let row = 0; row < maxLines; row += 1) {
          const next = lines[row] ?? '';
          const prev = previous[row] ?? '';
          if (next === prev) continue;
          cursorTo(process.stdout, 0, row);
          clearLine(process.stdout, 0);
          process.stdout.write(next);
        }
      }

      previous = lines;
      await sleep(frame.duration > 0 ? frame.duration : FRAME_MS);
    }

    cursorTo(process.stdout, 0, previous.length);
    process.stdout.write('\n');
  } finally {
    process.stdout.write('\x1B[?25h');
  }
};

export const renderStartupBanner = async (options: StartupBannerOptions): Promise<void> => {
  if (!options.enabled) return;

  if (options.animated && supportsAnimation()) {
    try {
      await renderAnimatedBanner(options.theme);
      return;
    } catch {
      renderStaticBanner(options.theme);
      return;
    }
  }

  renderStaticBanner(options.theme);
};
