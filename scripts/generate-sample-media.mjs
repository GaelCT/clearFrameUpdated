#!/usr/bin/env node
// Generates the synthetic sample footage bundled with ClearFrame and the media
// fixtures used by the browser tests. Requires ffmpeg on PATH.
//
// The clips are procedurally drawn scenes with deliberate, known flaws so the
// sample project's illustrative findings line up with what is on screen.
// Nothing here is AI-generated and nothing is analysed: the flaws are placed
// by the filter graph below.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sampleDir = join(root, 'public', 'sample');
const fixtureDir = join(root, 'tests', 'fixtures');
mkdirSync(sampleDir, { recursive: true });
mkdirSync(fixtureDir, { recursive: true });

const FONT_CANDIDATES = [
  'C:/Windows/Fonts/arial.ttf',
  '/System/Library/Fonts/Supplemental/Arial.ttf',
  '/Library/Fonts/Arial.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/TTF/DejaVuSans.ttf',
];
const font = FONT_CANDIDATES.find((f) => existsSync(f));

function escapeFontPath(path) {
  // Filtergraph option values need ':' escaped.
  return path.replace(/\\/g, '/').replace(/:/g, '\\:');
}

function labelFilters(label) {
  if (!font) return '';
  const fontfile = escapeFontPath(font);
  return (
    `,drawtext=fontfile='${fontfile}':text='${label}':x=10:y=10:fontsize=14:fontcolor=white@0.9:box=1:boxcolor=black@0.45:boxborderw=5` +
    `,drawtext=fontfile='${fontfile}':text='%{pts\\:hms}':x=w-tw-10:y=10:fontsize=14:fontcolor=white@0.9:box=1:boxcolor=black@0.45:boxborderw=5`
  );
}

function run(args) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`ffmpeg exited with ${result.status}`);
}

const H264 = ['-c:v', 'libx264', '-profile:v', 'main', '-pix_fmt', 'yuv420p', '-crf', '27', '-preset', 'medium', '-movflags', '+faststart'];
const AAC = ['-c:a', 'aac', '-b:a', '64k'];

/**
 * Highway scene. `shift` delays the scene content (a reference clip with a lead-in).
 * Flaw switches control which deliberate defects appear.
 */
function highway({ out, duration, shift = 0, label, flaws }) {
  const T = `(t-${shift})`;
  const off = (expr) => `not(${expr})`;
  const laneFlaw = flaws.lane ? `between(${T},3,4.6)` : '0';
  const signFlaw = flaws.sign ? `between(${T},1.5,2.6)` : '0';
  const carFlaw = flaws.car ? `between(${T},5.2,6)` : '0';
  const flicker = flaws.flicker ? `if(between(${T},6.4,7.1),0.2*sin(2*PI*${T}*7.5),0)` : '0';
  const dash = (k) => `mod(140*${T}+${k * 65}+1950,195)-34`;
  const car = (dx) => `mod(90*${T}+760,760)-${dx}`;

  const graph = [
    `color=c=0x87a9cc:s=640x360:r=30:d=${duration}[sky]`,
    `color=c=0x3b3d40:s=640x196:r=30:d=${duration}[road0]`,
    `color=c=white:s=10x34:r=30:d=${duration},split=3[d0][d1][d2]`,
    `color=c=0x2f7d4a:s=44x28:r=30:d=${duration},drawbox=x=3:y=3:w=38:h=22:color=white:t=2[sign]`,
    `color=c=0xc8372d:s=72x26:r=30:d=${duration},drawbox=x=14:y=4:w=26:h=9:color=0x9fc3e0:t=fill[car]`,
    `color=c=0xc8372d:s=108x15:r=30:d=${duration},drawbox=x=60:y=2:w=34:h=6:color=0x9fc3e0:t=fill[carD]`,
    `[road0]drawbox=x=36:y=0:w=8:h=196:color=white:t=fill,drawbox=x=596:y=0:w=8:h=196:color=white:t=fill[r0]`,
    `[r0][d0]overlay=x=315:y='${dash(0)}':eval=frame:enable='${off(laneFlaw)}'[r1]`,
    `[r1][d1]overlay=x=315:y='${dash(1)}':eval=frame:enable='${off(laneFlaw)}'[r2]`,
    `[r2][d2]overlay=x=315:y='${dash(2)}':eval=frame:enable='${off(laneFlaw)}'[r3]`,
    `[r3]drawbox=x=311:y=0:w=6:h=196:color=0xe8c33a:t=fill:enable='${laneFlaw}',drawbox=x=323:y=0:w=6:h=196:color=0xe8c33a:t=fill:enable='${laneFlaw}'[road]`,
    `[sky]drawbox=x=0:y=150:w=640:h=14:color=0x4f7a3a:t=fill[sky1]`,
    `[sky1][road]overlay=x=0:y=164[b0]`,
    `[b0]drawbox=x=549:y=112:w=6:h=52:color=0x9a9a9a:t=fill:enable='${off(signFlaw)}'[b1]`,
    `[b1][sign]overlay=x=530:y=86:enable='${off(signFlaw)}'[b2]`,
    `[b2][car]overlay=x='${car(80)}':y=262:eval=frame:enable='${off(carFlaw)}'[b3]`,
    `[b3][carD]overlay=x='${car(96)}':y=272:eval=frame:enable='${carFlaw}'[b4]`,
    `[b4]eq=brightness='${flicker}':eval=frame${labelFilters(label)},format=yuv420p[v]`,
    `anoisesrc=color=brown:amplitude=0.04:sample_rate=48000:d=${duration}[a]`,
  ].join(';');

  run(['-filter_complex', graph, '-map', '[v]', '-map', '[a]', '-t', String(duration), ...H264, ...AAC, out]);
}

/** Crosswalk scene with a walking figure. */
function crosswalk({ out, duration, label, flaws }) {
  const extraArm = flaws.anatomy ? 'between(t,2,3.1)' : '0';
  const jump = flaws.motion ? 'if(between(t,4,4.4),70,0)' : '0';
  const x = `40+70*t+${jump}`;
  const graph = [
    `color=c=0x5d6066:s=640x360:r=30:d=${duration}[bg]`,
    `[bg]drawbox=x=0:y=60:w=640:h=8:color=0xd8d8d8:t=fill,drawbox=x=0:y=292:w=640:h=8:color=0xd8d8d8:t=fill` +
      [0, 1, 2, 3, 4, 5, 6, 7].map((i) => `,drawbox=x=${40 + i * 72}:y=150:w=40:h=110:color=0xeeeeee:t=fill`).join('') +
      `[street]`,
    `color=c=0x1f3b73:s=18x40:r=30:d=${duration}[torso]`,
    `color=c=0xe0b48a:s=16x16:r=30:d=${duration}[head]`,
    `color=c=0x1f3b73:s=6x30:r=30:d=${duration},split=3[armL][armR][armX]`,
    `color=c=0x2b2b2b:s=7x34:r=30:d=${duration},split=2[legL][legR]`,
    `[street][legL]overlay=x='${x}+2':y=208:eval=frame[s1]`,
    `[s1][legR]overlay=x='${x}+9':y=208:eval=frame[s2]`,
    `[s2][torso]overlay=x='${x}':y=170:eval=frame[s3]`,
    `[s3][armL]overlay=x='${x}-6':y=172:eval=frame[s4]`,
    `[s4][armR]overlay=x='${x}+18':y=172:eval=frame[s5]`,
    `[s5][armX]overlay=x='${x}+20':y=186:eval=frame:enable='${extraArm}'[s6]`,
    `[s6][head]overlay=x='${x}+1':y=152:eval=frame${labelFilters(label)},format=yuv420p[v]`,
    `anoisesrc=color=pink:amplitude=0.02:sample_rate=48000:d=${duration}[a]`,
  ].join(';');
  run(['-filter_complex', graph, '-map', '[v]', '-map', '[a]', '-t', String(duration), ...H264, ...AAC, out]);
}

console.log('Generating sample footage in public/sample ...');
highway({
  out: join(sampleDir, 'highway-take1.mp4'),
  duration: 8,
  label: 'ClearFrame sample - synthetic - shot 1 take 1',
  flaws: { lane: true, sign: true, car: true, flicker: true },
});
highway({
  out: join(sampleDir, 'highway-reference.mp4'),
  duration: 8.5,
  shift: 0.5,
  label: 'ClearFrame sample - synthetic - reference',
  flaws: {},
});
highway({
  out: join(sampleDir, 'highway-take2-retake.mp4'),
  duration: 8,
  label: 'ClearFrame sample - synthetic - shot 1 take 2',
  flaws: { sign: true },
});
crosswalk({
  out: join(sampleDir, 'crosswalk-take1.mp4'),
  duration: 6,
  label: 'ClearFrame sample - synthetic - shot 2 take 1',
  flaws: { anatomy: true, motion: true },
});

console.log('Generating test fixtures in tests/fixtures ...');
run([
  '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=25:d=3',
  '-c:v', 'libvpx-vp9', '-b:v', '200k', '-pix_fmt', 'yuv420p',
  join(fixtureDir, 'testsrc-3s.webm'),
]);
run([
  '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=25:d=1',
  '-c:v', 'ffv1',
  join(fixtureDir, 'unsupported-ffv1.mkv'),
]);
writeFileSync(join(fixtureDir, 'not-a-video.mp4'), 'This is a text file with a video extension.\n');
writeFileSync(
  join(fixtureDir, 'brief.md'),
  '# Test brief\n\nA single static shot of a test pattern. Colours must stay stable.\n',
);
console.log('Done.');
