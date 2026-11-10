/**
 * Canvas re-record export engine for PodCraft Piece 2.
 *
 * One pipeline for trim, jump-cut, clips and captions:
 *  - the source WebM plays in an offscreen <video>
 *  - each frame is drawn to a canvas, captions are drawn on top (the
 *    browser's text engine shapes Arabic correctly, unlike ffmpeg drawtext)
 *  - canvas video + the video element's audio (via Web Audio) are recorded
 *    with MediaRecorder into a new WebM (VP9/Opus, same as the recorder)
 *
 * This is the same technique the studio itself uses to record
 * (canvas.captureStream + mixed Web Audio), so A/V sync behaves the same.
 * Export runs in real time: a 3-minute edit takes ~3 minutes to render.
 */

import { isArabic } from './editing';

export interface ExportSegment {
  start: number; // source seconds
  end: number; // source seconds
}

export interface ExportCaption {
  start: number; // edited-timeline seconds
  end: number; // edited-timeline seconds
  text: string;
  speaker?: string;
}

export interface ExportOptions {
  blob: Blob;
  segments: ExportSegment[];
  captions: ExportCaption[];
  onProgress?: (fraction: number, label: string) => void;
  signal?: AbortSignal;
}

function pickMimeType(): string {
  const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  for (const m of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

export async function exportEditedVideo(opts: ExportOptions): Promise<Blob> {
  const { blob, segments, captions, onProgress, signal } = opts;
  if (segments.length === 0) throw new Error('Nothing to export — the edit removes the whole recording.');
  const total = segments.reduce((sum, s) => sum + (s.end - s.start), 0);
  if (total <= 0) throw new Error('Nothing to export — the edit removes the whole recording.');

  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.src = url;
  video.preload = 'auto';
  video.playsInline = true;
  // Do NOT mute: the audio must flow into the MediaElementSource below.
  // It never reaches the speakers because the destination is not connected
  // to the AudioContext output.

  const audioCtx = new AudioContext();
  await audioCtx.resume().catch(() => {});

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('Could not read the recorded video file.'));
      // If metadata never arrives, fail loudly instead of hanging.
      window.setTimeout(() => reject(new Error('Timed out reading the recorded video file.')), 15000);
    });

    const srcW = video.videoWidth || 1280;
    const srcH = video.videoHeight || 720;
    const scale = Math.min(1, 1920 / srcW);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(srcW * scale);
    canvas.height = Math.round(srcH * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is not available in this browser.');

    const mediaSource = audioCtx.createMediaElementSource(video);
    const dest = audioCtx.createMediaStreamDestination();
    mediaSource.connect(dest);

    const tracks: MediaStreamTrack[] = [];
    const canvasStream = canvas.captureStream(30);
    const videoTrack = canvasStream.getVideoTracks()[0];
    if (videoTrack) tracks.push(videoTrack);
    const audioTrack = dest.stream.getAudioTracks()[0];
    if (audioTrack) tracks.push(audioTrack);
    if (tracks.length === 0) throw new Error('Could not capture any media stream for export.');

    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(new MediaStream(tracks), mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });

    let segIndex = 0;
    let editedElapsed = 0;
    let finished = false;
    let rafId = 0;
    let lastDrawnTime = -1;

    const activeCaption = (editedTime: number): ExportCaption | null => {
      for (const c of captions) {
        if (editedTime >= c.start && editedTime < c.end) return c;
      }
      return null;
    };

    const drawFrame = () => {
      if (video.readyState >= 2 && video.currentTime !== lastDrawnTime) {
        lastDrawnTime = video.currentTime;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const seg = segments[segIndex];
        const editedTime = editedElapsed + (seg ? video.currentTime - seg.start : 0);
        const cue = activeCaption(editedTime);
        if (cue) {
          const fontSize = Math.max(24, Math.round(canvas.width * 0.035));
          ctx.font = `bold ${fontSize}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.direction = isArabic(cue.text) ? 'rtl' : 'ltr';
          const lines = wrapText(ctx, cue.text, canvas.width * 0.84);
          const lineHeight = fontSize * 1.25;
          const boxH = lines.length * lineHeight + fontSize * 0.7;
          const boxW = Math.min(
            canvas.width * 0.9,
            Math.max(...lines.map((l) => ctx.measureText(l).width)) + fontSize * 1.2
          );
          const boxX = (canvas.width - boxW) / 2;
          const boxY = canvas.height - boxH - canvas.height * 0.05;
          ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
          if (typeof ctx.roundRect === 'function') {
            ctx.beginPath();
            ctx.roundRect(boxX, boxY, boxW, boxH, fontSize * 0.35);
            ctx.fill();
          } else {
            ctx.fillRect(boxX, boxY, boxW, boxH);
          }
          ctx.fillStyle = '#ffffff';
          lines.forEach((line, i) => {
            ctx.fillText(line, canvas.width / 2, boxY + fontSize * 0.35 + lineHeight * (i + 0.5));
          });
        }
      }
    };

    const abort = () => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(rafId);
      try {
        video.pause();
      } catch {
        // ignore
      }
      if (recorder.state !== 'inactive') recorder.stop();
    };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) throw new Error('Export cancelled.');

    const tick = () => {
      if (finished) return;
      const seg = segments[segIndex];
      if (!seg) {
        finish();
        return;
      }
      // Advance to the next segment when the playhead passes this one.
      if (video.currentTime >= seg.end - 0.03) {
        editedElapsed += seg.end - seg.start;
        segIndex += 1;
        const next = segments[segIndex];
        if (!next) {
          finish();
          return;
        }
        video.currentTime = next.start;
        onProgress?.(Math.min(1, editedElapsed / total), 'Rendering…');
        rafId = requestAnimationFrame(tick);
        return;
      }
      drawFrame();
      const editedTime = editedElapsed + Math.max(0, video.currentTime - seg.start);
      onProgress?.(Math.min(1, editedTime / total), 'Rendering…');
      rafId = requestAnimationFrame(tick);
    };

    const finish = () => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(rafId);
      onProgress?.(1, 'Finishing…');
      try {
        video.pause();
      } catch {
        // ignore
      }
      if (recorder.state !== 'inactive') recorder.stop();
    };

    // Start at the first segment and record.
    video.currentTime = segments[0].start;
    await new Promise<void>((resolve) => {
      const onSeeked = () => {
        video.removeEventListener('seeked', onSeeked);
        resolve();
      };
      video.addEventListener('seeked', onSeeked);
      window.setTimeout(resolve, 2000); // never hang on seek
    });
    recorder.start(1000);
    try {
      await video.play();
    } catch (err) {
      abort();
      throw new Error('Could not play the recording for export. Tap Export again.');
    }
    rafId = requestAnimationFrame(tick);

    await stopped;
    const outType = recorder.mimeType || 'video/webm';
    return new Blob(chunks, { type: outType });
  } finally {
    try {
      video.pause();
    } catch {
      // ignore
    }
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
    await audioCtx.close().catch(() => {});
  }
}
