/**
 * Pure editing logic for PodCraft Piece 2.
 *
 * Everything in this file is framework-free so it can be unit-tested in
 * Node (see editing-test.mts). It knows nothing about the DOM, the video
 * element, or ffmpeg — those live in videoExport.ts / ffmpegExport.ts.
 */

export interface SilenceRange {
  start: number; // seconds
  end: number; // seconds
}

export interface KeepSegment {
  start: number; // source time, seconds
  end: number; // source time, seconds
}

export interface CaptionCue {
  id: string;
  /** Source time in the original recording. */
  start: number; // seconds
  /** Source time in the original recording. */
  end: number; // seconds
  text: string;
  speaker: string;
}

export interface TranscriptEntryLike {
  seconds: number;
  text: string;
  speaker: string;
}

export function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function isArabic(text: string): boolean {
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(text);
}

/**
 * Detect silence ranges in PCM samples (mono, -1..1).
 *
 * RMS is computed per window; a window is silent when its level is below
 * `thresholdDb`. Consecutive silent windows merge into one range; ranges
 * shorter than `minSilenceSec` are dropped (a short breath is not a cut).
 */
export function detectSilences(
  samples: Float32Array,
  sampleRate: number,
  opts: {
    windowMs?: number;
    thresholdDb?: number;
    minSilenceSec?: number;
  } = {}
): SilenceRange[] {
  const windowMs = opts.windowMs ?? 100;
  const thresholdDb = opts.thresholdDb ?? -42;
  const minSilenceSec = opts.minSilenceSec ?? 0.6;

  if (samples.length === 0 || sampleRate <= 0) return [];

  const windowSamples = Math.max(1, Math.floor((sampleRate * windowMs) / 1000));
  const threshold = Math.pow(10, thresholdDb / 20); // dBFS -> linear RMS
  const ranges: SilenceRange[] = [];
  let silenceStart: number | null = null;

  const totalWindows = Math.ceil(samples.length / windowSamples);
  for (let w = 0; w < totalWindows; w++) {
    const start = w * windowSamples;
    const end = Math.min(samples.length, start + windowSamples);
    let sumSq = 0;
    for (let i = start; i < end; i++) {
      const v = samples[i];
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / Math.max(1, end - start));
    const silent = rms < threshold;

    if (silent && silenceStart === null) {
      silenceStart = start / sampleRate;
    } else if (!silent && silenceStart !== null) {
      const silenceEnd = start / sampleRate;
      if (silenceEnd - silenceStart >= minSilenceSec) {
        ranges.push({ start: silenceStart, end: silenceEnd });
      }
      silenceStart = null;
    }
  }
  if (silenceStart !== null) {
    const silenceEnd = samples.length / sampleRate;
    if (silenceEnd - silenceStart >= minSilenceSec) {
      ranges.push({ start: silenceStart, end: silenceEnd });
    }
  }
  return ranges;
}

/**
 * Shrink each silence range by `padSec` on both sides so a cut never eats
 * the edge of a word. Ranges that collapse below 0.2s after shrinking are
 * dropped (nothing worth cutting there).
 */
export function shrinkSilences(silences: SilenceRange[], padSec: number): SilenceRange[] {
  const out: SilenceRange[] = [];
  for (const s of silences) {
    const start = s.start + padSec;
    const end = s.end - padSec;
    if (end - start >= 0.2) out.push({ start, end });
  }
  return out;
}

/**
 * Compute the kept segments after applying a trim window and (optionally)
 * removing silence ranges. The result is a sorted, non-overlapping list of
 * source-time ranges that the export engine walks in order.
 */
export function computeKeepSegments(
  duration: number,
  trimStart: number,
  trimEnd: number,
  silences: SilenceRange[],
  applyJumpCut: boolean
): KeepSegment[] {
  const start = Math.max(0, Math.min(trimStart, duration));
  const end = Math.max(start, Math.min(trimEnd, duration));
  if (end - start <= 0) return [];

  let segments: KeepSegment[] = [{ start, end }];
  if (!applyJumpCut) return segments;

  const cuts = silences
    .map((s) => ({ start: Math.max(start, s.start), end: Math.min(end, s.end) }))
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start);

  for (const cut of cuts) {
    const next: KeepSegment[] = [];
    for (const seg of segments) {
      if (cut.end <= seg.start || cut.start >= seg.end) {
        next.push(seg);
        continue;
      }
      if (cut.start > seg.start) next.push({ start: seg.start, end: cut.start });
      if (cut.end < seg.end) next.push({ start: cut.end, end: seg.end });
    }
    segments = next;
    if (segments.length === 0) break;
  }
  return segments.filter((s) => s.end - s.start > 0.01);
}

export function editedDuration(segments: KeepSegment[]): number {
  return segments.reduce((sum, s) => sum + (s.end - s.start), 0);
}

/**
 * Map a source time to its position on the edited timeline.
 * Returns null when the time falls inside a removed region.
 */
export function mapSourceToEdited(t: number, segments: KeepSegment[]): number | null {
  let offset = 0;
  for (const seg of segments) {
    if (t < seg.start) return null; // inside a removed gap before this segment
    if (t <= seg.end) return offset + (t - seg.start);
    offset += seg.end - seg.start;
  }
  return null;
}

/**
 * Build caption cues from live-transcript entries. A cue starts at its
 * entry's timestamp and runs until the next entry starts; the last cue gets
 * an estimate from its word count (about 0.4s per word, at least 2s),
 * capped at the recording duration.
 */
export function buildCaptionCues(
  entries: TranscriptEntryLike[],
  duration: number
): CaptionCue[] {
  const sorted = [...entries].sort((a, b) => a.seconds - b.seconds);
  return sorted.map((entry, i) => {
    const start = Math.max(0, entry.seconds);
    const nextStart = i + 1 < sorted.length ? sorted[i + 1].seconds : null;
    const words = entry.text.trim().split(/\s+/).filter(Boolean).length;
    const estimated = Math.max(2, words * 0.4);
    const end =
      nextStart !== null
        ? Math.min(nextStart, duration)
        : Math.min(start + estimated, duration);
    return {
      id: `cue-${i}-${Math.round(start * 100)}`,
      start,
      end: Math.max(start + 0.5, end),
      text: entry.text,
      speaker: entry.speaker,
    };
  });
}

/**
 * Remap cues onto the edited timeline: clip each cue to the kept segments
 * and shift it by the removed time before it. Cues that fall entirely in
 * removed regions are dropped. A cue spanning a cut is split at the cut so
 * no caption shows text from the removed part.
 */
export function remapCaptions(cues: CaptionCue[], segments: KeepSegment[]): CaptionCue[] {
  const out: CaptionCue[] = [];
  for (const cue of cues) {
    for (const seg of segments) {
      const start = Math.max(cue.start, seg.start);
      const end = Math.min(cue.end, seg.end);
      if (end - start < 0.2) continue;
      const editedStart = mapSourceToEdited(start, segments);
      const editedEnd = mapSourceToEdited(end, segments);
      if (editedStart === null || editedEnd === null) continue;
      out.push({
        id: `${cue.id}@${Math.round(editedStart * 100)}`,
        start: editedStart,
        end: editedEnd,
        text: cue.text,
        speaker: cue.speaker,
      });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}
