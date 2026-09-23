import type { CaptionStyle } from './clip-input.js';

/**
 * Builds an ASS (Advanced SubStation Alpha) subtitle document for burned-in
 * "viral" captions. Pure string builder — no I/O — so it is fully unit-testable.
 *
 * ASS is chosen over SRT because it supports the styling that makes short-form
 * captions pop: bold centered text, heavy outline, and per-word karaoke timing.
 */

export interface CaptionCue {
  /** seconds */
  start: number;
  /** seconds */
  end: number;
  text: string;
  /** optional per-word timings (seconds) enabling karaoke highlight */
  words?: Array<{ start: number; end: number; text: string }>;
}

/** ASS timestamp: H:MM:SS.cc (centiseconds). */
export function assTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const cs = Math.round((s - Math.floor(s)) * 100);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${h}:${pad(m)}:${pad(sec)}.${pad(Math.min(cs, 99))}`;
}

function escapeAss(text: string): string {
  // ASS uses \N for newline; strip control chars; braces are override blocks so neutralize.
  return text.replace(/\r?\n/g, '\\N').replace(/[{}]/g, '').trim();
}

interface StyleSpec {
  font: string;
  size: number;
  primary: string; // &HAABBGGRR
  outline: string;
  outlineWidth: number;
  bold: boolean;
  alignment: number; // 2 = bottom-center, 5 = middle-center
  marginV: number;
}

const STYLES: Record<CaptionStyle, StyleSpec> = {
  karaoke: { font: 'Montserrat ExtraBold', size: 16, primary: '&H00FFFFFF', outline: '&H00000000', outlineWidth: 3, bold: true, alignment: 5, marginV: 120 },
  bold: { font: 'Impact', size: 18, primary: '&H0000FFFF', outline: '&H00000000', outlineWidth: 3, bold: true, alignment: 2, marginV: 90 },
  minimal: { font: 'Arial', size: 14, primary: '&H00FFFFFF', outline: '&H00000000', outlineWidth: 2, bold: false, alignment: 2, marginV: 60 },
};

/** Build karaoke override tags from per-word timings ({\kf} centisecond fills). */
function karaokeLine(cue: CaptionCue): string {
  if (!cue.words || cue.words.length === 0) return escapeAss(cue.text);
  return cue.words
    .map((w) => {
      const cs = Math.max(1, Math.round((w.end - w.start) * 100));
      return `{\\kf${cs}}${escapeAss(w.text)}`;
    })
    .join(' ');
}

export function buildAss(
  cues: CaptionCue[],
  opts: {
    style?: CaptionStyle;
    playResX?: number;
    playResY?: number;
    /** Optional scroll-stopper hook line rendered top-center with a fade (premium). */
    hookText?: string;
    hookDurationSeconds?: number;
  } = {},
): string {
  const styleName = opts.style ?? 'karaoke';
  const spec = STYLES[styleName];
  const playResX = opts.playResX ?? 1080;
  const playResY = opts.playResY ?? 1920;
  const scaledSize = Math.round((spec.size / 100) * playResY * 0.5);
  const isPortrait = playResY > playResX;

  // Safe-zone floor: never let captions burn under the Shorts/TikTok chrome
  // (ViralMint raises margins to a minimum, never lowers them).
  const marginV = Math.max(spec.marginV, isPortrait ? Math.round(playResY * 0.09) : 40);
  const outlineW = Math.max(3, spec.outlineWidth);

  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${playResX}`,
    `PlayResY: ${playResY}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: TV.709',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,${spec.font},${scaledSize},${spec.primary},&H0000FFFF,${spec.outline},&H80000000,${spec.bold ? -1 : 0},0,0,0,100,100,0,0,1,${outlineW},2,${spec.alignment},80,80,${marginV},1`,
  ];

  // Premium hook overlay: top-center (Alignment=8), ~2.2x caption size, thick
  // black outline, short fade — the scroll-stopper.
  const hook = opts.hookText ? escapeAss(opts.hookText) : '';
  if (hook) {
    const hookSize = Math.round(scaledSize * 2.2);
    const hookMargin = isPortrait ? Math.round(playResY * 0.1) : 80;
    header.push(`Style: Hook,${spec.font},${hookSize},&H00FFFFFF,&H0000FFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,6,2,8,40,40,${hookMargin},1`);
  }
  header.push('', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text');

  const events = cues
    .filter((c) => c.text && c.text.trim().length > 0 && c.end > c.start)
    .map((c) => {
      const text = styleName === 'karaoke' ? karaokeLine(c) : escapeAss(c.text);
      return `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Default,,0,0,0,,${text}`;
    });

  if (hook) {
    const dur = Math.max(1, opts.hookDurationSeconds ?? 4);
    const fad = `{${String.fromCharCode(92)}fad(300,500)}`;
    events.unshift(`Dialogue: 1,${assTime(0)},${assTime(dur)},Hook,,0,0,0,,${fad}${hook}`);
  }

  return `${header.join('\n')}\n${events.join('\n')}\n`;
}
