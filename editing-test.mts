/**
 * Node logic test for src/lib/editing.ts (Piece 2 pure logic).
 * Run: npx tsx editing-test.mts
 * No DOM, no browser — synthetic audio + transcript entries only.
 */
import {
  detectSilences,
  shrinkSilences,
  computeKeepSegments,
  editedDuration,
  mapSourceToEdited,
  buildCaptionCues,
  remapCaptions,
  formatTime,
} from './src/lib/editing';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    passed++;
    console.log(`PASS  ${name}`);
  } else {
    failed++;
    console.log(`FAIL  ${name} ${detail}`);
  }
}
function approx(a: number, b: number, tol = 0.15) {
  return Math.abs(a - b) <= tol;
}

// ---------- 1. Silence detection on synthetic audio ----------
// 8s @ 8000 Hz: 0-1s loud, 1-2s quiet, 2-3s loud, 3-5s quiet, 5-8s loud.
const sr = 8000;
const samples = new Float32Array(sr * 8);
for (let i = 0; i < samples.length; i++) {
  const t = i / sr;
  const loud = (t >= 0 && t < 1) || (t >= 2 && t < 3) || (t >= 5 && t < 8);
  samples[i] = loud ? 0.5 * Math.sin(2 * Math.PI * 440 * t) : 0.001;
}
const sil = detectSilences(samples, sr, { windowMs: 100, thresholdDb: -42, minSilenceSec: 0.6 });
check('silence: finds 2 ranges', sil.length === 2, JSON.stringify(sil));
check('silence: first range ~[1,2]', sil[0] && approx(sil[0].start, 1) && approx(sil[0].end, 2), JSON.stringify(sil[0]));
check('silence: second range ~[3,5]', sil[1] && approx(sil[1].start, 3) && approx(sil[1].end, 5), JSON.stringify(sil[1]));

// Short blips below minSilenceSec are ignored.
const short = new Float32Array(sr * 2).fill(0.5);
for (let i = sr; i < sr + Math.floor(sr * 0.3); i++) short[i] = 0.001; // 0.3s quiet
check('silence: 0.3s blip ignored', detectSilences(short, sr, { minSilenceSec: 0.6 }).length === 0);

// All-quiet buffer -> one range covering (almost) everything.
const quiet = new Float32Array(sr * 2).fill(0.001);
const q = detectSilences(quiet, sr, { minSilenceSec: 0.6 });
check('silence: all-quiet is one range', q.length === 1 && approx(q[0].start, 0) && approx(q[0].end, 2), JSON.stringify(q));

// Empty input.
check('silence: empty input -> []', detectSilences(new Float32Array(0), sr).length === 0);

// shrinkSilences pads edges and drops collapsed ranges.
const shrunk = shrinkSilences([{ start: 1, end: 2 }, { start: 3, end: 3.25 }], 0.15);
check('shrink: pads 0.15s each side', shrunk.length === 1 && approx(shrunk[0].start, 1.15) && approx(shrunk[0].end, 1.85), JSON.stringify(shrunk));

// ---------- 2. Keep segments: trim + jump-cut ----------
const segs = computeKeepSegments(20, 2, 18, [{ start: 5, end: 7 }, { start: 12, end: 13 }], true);
check(
  'segments: trim [2,18] minus [5,7],[12,13]',
  segs.length === 3 &&
    approx(segs[0].start, 2) && approx(segs[0].end, 5) &&
    approx(segs[1].start, 7) && approx(segs[1].end, 12) &&
    approx(segs[2].start, 13) && approx(segs[2].end, 18),
  JSON.stringify(segs)
);
check('segments: edited duration 13s', approx(editedDuration(segs), 13), String(editedDuration(segs)));
check('segments: jump-cut off keeps whole trim', computeKeepSegments(20, 2, 18, [{ start: 5, end: 7 }], false).length === 1);
check('segments: full trim out -> []', computeKeepSegments(20, 5, 5, [], false).length === 0);
check('segments: cut covering everything -> []', computeKeepSegments(10, 0, 10, [{ start: 0, end: 10 }], true).length === 0);

// ---------- 3. Source -> edited time mapping ----------
check('map: t=3 -> edited 1', mapSourceToEdited(3, segs) === 1, String(mapSourceToEdited(3, segs)));
check('map: t=8 -> edited 4', mapSourceToEdited(8, segs) === 4, String(mapSourceToEdited(8, segs)));
check('map: t=6 (removed) -> null', mapSourceToEdited(6, segs) === null, String(mapSourceToEdited(6, segs)));
check('map: t=1 (before trim) -> null', mapSourceToEdited(1, segs) === null, String(mapSourceToEdited(1, segs)));
check('map: t=15 -> edited 10', mapSourceToEdited(15, segs) === 10, String(mapSourceToEdited(15, segs)));

// ---------- 4. Caption cues from transcript entries ----------
const cues = buildCaptionCues(
  [
    { seconds: 0, text: 'Hello everyone', speaker: 'Host' },
    { seconds: 5, text: 'Welcome to the show', speaker: 'Guest' },
    { seconds: 10, text: 'Today we talk', speaker: 'Host' },
  ],
  20
);
check('cues: 3 cues built', cues.length === 3, String(cues.length));
check('cues: first ends at next start', cues[0].end === 5, JSON.stringify(cues[0]));
check('cues: last end estimated/capped', cues[2].end > 10 && cues[2].end <= 20, JSON.stringify(cues[2]));

// Remap cues through the edit: trim [2,18] + cuts [5,7],[12,13].
const remapped = remapCaptions(cues, segs);
const hello = remapped.find((c) => c.text === 'Hello everyone');
check(
  'remap: 0s cue clipped to kept part (edited 0-3)',
  hello !== undefined && approx(hello.start, 0) && approx(hello.end, 3),
  JSON.stringify(hello)
);
const dropped = remapCaptions(
  [{ id: 'y', start: 0, end: 1.5, text: 'before trim', speaker: 'Host' }],
  segs
);
check('remap: cue entirely before trim is dropped', dropped.length === 0, JSON.stringify(dropped));
const welcome = remapped.find((c) => c.text === 'Welcome to the show');
check('remap: 5s cue shifts to edited 3s', welcome !== undefined && approx(welcome.start, 3), JSON.stringify(welcome));
const today = remapped.find((c) => c.text === 'Today we talk');
check('remap: 10s cue shifts to edited 6s', today !== undefined && approx(today.start, 6), JSON.stringify(today));

// A cue spanning a cut is split, never shows removed text.
const spanning = remapCaptions(
  [{ id: 'x', start: 4, end: 8, text: 'spanning the cut', speaker: 'Host' }],
  segs
);
check(
  'remap: spanning cue splits into 2 pieces',
  spanning.length === 2 &&
    approx(spanning[0].start, 2) && approx(spanning[0].end, 3) &&
    approx(spanning[1].start, 3) && approx(spanning[1].end, 4),
  JSON.stringify(spanning)
);

// ---------- 5. formatTime ----------
check('formatTime 0 -> 00:00', formatTime(0) === '00:00');
check('formatTime 125 -> 02:05', formatTime(125) === '02:05');
check('formatTime 3661 -> 61:01', formatTime(3661) === '61:01');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
