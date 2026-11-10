import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Download,
  Sparkles,
  CheckCircle2,
  ShieldCheck,
  FileVideo,
  X,
  HardDrive,
  Lock,
  Scissors,
  Wand2,
  Captions,
  Clapperboard,
  Loader2,
  AlertTriangle,
  Play,
  Trash2,
  Plus,
  RotateCcw,
} from 'lucide-react';
import type { ChapterMarker, ShowNotesData } from '../types/studio';
import type { TranscriptEntry } from '../hooks/useSpeechRecognition';
import {
  formatTime,
  detectSilences,
  shrinkSilences,
  computeKeepSegments,
  editedDuration,
  mapSourceToEdited,
  buildCaptionCues,
  remapCaptions,
  type SilenceRange,
  type KeepSegment,
  type CaptionCue,
} from '../lib/editing';
import { exportEditedVideo } from '../lib/videoExport';
import { transcodeWebmToMp4 } from '../lib/ffmpegExport';
import { YouTubePublish } from './YouTubePublish';

interface RecordingReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  videoUrl: string | null;
  videoBlob: Blob | null;
  durationSeconds: number;
  filename: string;
  onGenerateShowNotes: () => void;
  transcriptEntries: TranscriptEntry[];
  chapterMarkers: ChapterMarker[];
  /** AI show notes for this recording, when generated — pre-fills the
   *  YouTube title (episodeTitle) and description (summary). */
  showNotes?: ShowNotesData | null;
}

/** Silence detection decodes the whole file into memory; guard long recordings. */
const SILENCE_MAX_SECONDS = 15 * 60;
const SILENCE_EDGE_PAD_SEC = 0.15;

export const RecordingReviewModal: React.FC<RecordingReviewModalProps> = ({
  isOpen,
  onClose,
  videoUrl,
  videoBlob,
  durationSeconds,
  filename,
  onGenerateShowNotes,
  transcriptEntries,
  chapterMarkers,
  showNotes,
}) => {
  const [downloadSuccess, setDownloadSuccess] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ---- Editing state (resets for every new recording) ----
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [silences, setSilences] = useState<SilenceRange[] | null>(null);
  const [analyzingSilence, setAnalyzingSilence] = useState(false);
  const [silenceError, setSilenceError] = useState<string | null>(null);
  const [jumpCutEnabled, setJumpCutEnabled] = useState(false);
  const [captionsEnabled, setCaptionsEnabled] = useState(false);
  const [cues, setCues] = useState<CaptionCue[]>([]);
  const [previewEdit, setPreviewEdit] = useState(true);
  const [previewTime, setPreviewTime] = useState(0);
  const [exportStatus, setExportStatus] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [exportProgress, setExportProgress] = useState(0);
  const [exportLabel, setExportLabel] = useState('');
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const [exportFilename, setExportFilename] = useState('');
  const [exportSizeMb, setExportSizeMb] = useState('');
  /** The exported file itself (edited WebM or MP4) — the YouTube publish
   *  section uploads this blob. Null until an export finishes. */
  const [exportBlob, setExportBlob] = useState<Blob | null>(null);

  const duration = Math.max(0, durationSeconds);

  // Reset the editor whenever a new recording is opened.
  useEffect(() => {
    if (!isOpen || !videoUrl) return;
    setTrimStart(0);
    setTrimEnd(duration);
    setSilences(null);
    setSilenceError(null);
    setJumpCutEnabled(false);
    setCaptionsEnabled(false);
    setCues(buildCaptionCues(transcriptEntries, duration));
    setPreviewEdit(true);
    setPreviewTime(0);
    setExportStatus('idle');
    setExportProgress(0);
    setExportLabel('');
    setExportError(null);
    setExportUrl(null);
    setExportBlob(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, videoUrl]);

  // Revoke exported object URLs on unmount / new recording.
  useEffect(() => {
    return () => {
      if (exportUrl) URL.revokeObjectURL(exportUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shrunkSilences = useMemo(
    () => (silences ? shrinkSilences(silences, SILENCE_EDGE_PAD_SEC) : []),
    [silences]
  );

  const segments: KeepSegment[] = useMemo(
    () => computeKeepSegments(duration, trimStart, trimEnd, shrunkSilences, jumpCutEnabled),
    [duration, trimStart, trimEnd, shrunkSilences, jumpCutEnabled]
  );

  const editedCues = useMemo(
    () => (captionsEnabled ? remapCaptions(cues, segments) : []),
    [captionsEnabled, cues, segments]
  );

  const keptSeconds = editedDuration(segments);
  const removedSeconds = Math.max(0, duration - keptSeconds);
  const silenceSeconds = useMemo(
    () => shrunkSilences.reduce((s, r) => s + (r.end - r.start), 0),
    [shrunkSilences]
  );

  // ---- Live edit preview: skip removed regions while playing ----
  useEffect(() => {
    if (!isOpen || !previewEdit) return;
    let raf = 0;
    const loop = () => {
      const v = videoRef.current;
      if (v && !v.paused && !v.seeking) {
        const inside = segments.some((s) => v.currentTime >= s.start && v.currentTime < s.end);
        if (!inside) {
          const next = segments.find((s) => s.start > v.currentTime);
          if (next) {
            v.currentTime = next.start;
          } else {
            v.pause();
          }
        }
        setPreviewTime((prev) =>
          Math.abs(prev - v.currentTime) > 0.1 ? v.currentTime : prev
        );
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [isOpen, previewEdit, segments]);

  const previewCue = useMemo(() => {
    if (!captionsEnabled) return null;
    if (previewEdit) {
      const editedTime = mapSourceToEdited(previewTime, segments);
      if (editedTime === null) return null;
      return editedCues.find((c) => editedTime >= c.start && editedTime < c.end) ?? null;
    }
    return cues.find((c) => previewTime >= c.start && previewTime < c.end) ?? null;
  }, [captionsEnabled, previewEdit, previewTime, segments, editedCues, cues]);

  // ---- Silence detection ----
  const detectPauses = useCallback(async () => {
    if (!videoBlob) return;
    if (duration > SILENCE_MAX_SECONDS) {
      setSilenceError(
        `This recording is over ${SILENCE_MAX_SECONDS / 60} minutes — pause detection needs the audio in memory. Trim it first, or use the trim and clip tools instead.`
      );
      return;
    }
    setAnalyzingSilence(true);
    setSilenceError(null);
    try {
      const ctx = new AudioContext();
      try {
        const buf = await videoBlob.arrayBuffer();
        const audio = await ctx.decodeAudioData(buf);
        const ch0 = audio.getChannelData(0);
        const ch1 = audio.numberOfChannels > 1 ? audio.getChannelData(1) : null;
        const targetRate = 8000;
        const step = Math.max(1, Math.floor(audio.sampleRate / targetRate));
        const len = Math.floor(ch0.length / step);
        const mono = new Float32Array(len);
        for (let i = 0; i < len; i++) {
          const v0 = ch0[i * step];
          mono[i] = ch1 ? (v0 + ch1[i * step]) / 2 : v0;
        }
        const found = detectSilences(mono, targetRate, {
          windowMs: 100,
          thresholdDb: -42,
          minSilenceSec: 0.6,
        });
        setSilences(found);
        if (found.length > 0) setJumpCutEnabled(true);
      } finally {
        await ctx.close().catch(() => {});
      }
    } catch {
      setSilenceError(
        'Could not read the audio track for pause detection. Trim and clips still work.'
      );
    } finally {
      setAnalyzingSilence(false);
    }
  }, [videoBlob, duration]);

  // ---- Export ----
  const runExport = useCallback(
    async (format: 'webm' | 'mp4', rangeOverride?: { start: number; end: number; name: string }) => {
      if (!videoBlob) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const exportSegments = rangeOverride
        ? computeKeepSegments(
            duration,
            rangeOverride.start,
            rangeOverride.end,
            shrunkSilences,
            jumpCutEnabled
          )
        : segments;
      const exportCaptions = captionsEnabled ? remapCaptions(cues, exportSegments) : [];

      setExportStatus('working');
      setExportProgress(0);
      setExportError(null);
      setExportUrl(null);
      setExportLabel('Rendering your edit…');
      try {
        const webm = await exportEditedVideo({
          blob: videoBlob,
          segments: exportSegments,
          captions: exportCaptions,
          signal: controller.signal,
          onProgress: (p, label) => {
            setExportProgress(format === 'mp4' ? p * 0.7 : p);
            setExportLabel(label);
          },
        });

        const base = rangeOverride
          ? filename.replace(/\.webm$/i, '').replace(/Recording/i, 'Clip') +
            `_${formatTime(rangeOverride.start).replace(':', '')}`
          : filename.replace(/Recording/i, 'Edited');
        const outName = base.replace(/\.webm$/i, '');

        if (format === 'webm') {
          const url = URL.createObjectURL(webm);
          setExportUrl(url);
          setExportBlob(webm);
          setExportFilename(`${outName}.webm`);
          setExportSizeMb((webm.size / (1024 * 1024)).toFixed(2));
          setExportStatus('done');
        } else {
          setExportLabel('Converting to MP4… (this takes a while)');
          const mp4 = await transcodeWebmToMp4(webm, `${outName}.webm`, (p) => {
            setExportProgress(0.7 + p * 0.3);
          });
          const url = URL.createObjectURL(mp4.blob);
          setExportUrl(url);
          setExportBlob(mp4.blob);
          setExportFilename(mp4.filename);
          setExportSizeMb((mp4.blob.size / (1024 * 1024)).toFixed(2));
          setExportStatus('done');
        }
      } catch (err) {
        if (controller.signal.aborted) {
          setExportStatus('idle');
          setExportLabel('');
          return;
        }
        setExportError(err instanceof Error ? err.message : 'Export failed.');
        setExportStatus('error');
      }
    },
    [videoBlob, duration, segments, shrunkSilences, jumpCutEnabled, captionsEnabled, cues, filename]
  );

  const cancelExport = () => {
    abortRef.current?.abort();
  };

  if (!isOpen || !videoUrl) return null;

  const fileSizeMb = videoBlob ? (videoBlob.size / (1024 * 1024)).toFixed(2) : '0';
  const mins = Math.floor(duration / 60);
  const secs = Math.floor(duration % 60);
  const durationStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  const mimeType = videoBlob?.type || 'video/webm;codecs=vp9,opus';

  const triggerLocalDownload = () => {
    if (!videoUrl) return;
    const a = document.createElement('a');
    a.href = videoUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setDownloadSuccess(true);
    setTimeout(() => setDownloadSuccess(false), 3500);
  };

  const seekFromTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = timelineRef.current;
    const v = videoRef.current;
    if (!el || !v || duration <= 0) return;
    const rect = el.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const t = frac * duration;
    v.currentTime = t;
    setPreviewTime(t);
  };

  const startHandleDrag = (which: 'start' | 'end') => (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const el = timelineRef.current;
    if (!el || duration <= 0) return;
    const rect = el.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      const frac = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      const t = frac * duration;
      if (which === 'start') setTrimStart(Math.min(t, trimEnd - 1));
      else setTrimEnd(Math.max(t, trimStart + 1));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const updateCueText = (id: string, text: string) => {
    setCues((prev) => prev.map((c) => (c.id === id ? { ...c, text } : c)));
  };

  const deleteCue = (id: string) => {
    setCues((prev) => prev.filter((c) => c.id !== id));
  };

  const addCue = () => {
    const start = Math.min(Math.max(0, previewTime), Math.max(0, duration - 1));
    setCues((prev) => [
      ...prev,
      {
        id: `manual-${Date.now()}`,
        start,
        end: Math.min(duration, start + 3),
        text: '',
        speaker: 'Host',
      },
    ]);
    setCaptionsEnabled(true);
  };

  const pct = (t: number) => `${(Math.max(0, Math.min(1, t / Math.max(1, duration))) * 100).toFixed(2)}%`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 bg-slate-950 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-950 border border-emerald-800/80 flex items-center justify-center text-emerald-400 shadow-md">
              <HardDrive className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-white text-base">Local Recording Ready</h3>
                <span className="text-[10px] font-mono font-bold bg-emerald-950 text-emerald-300 border border-emerald-800/80 px-2 py-0.5 rounded-full uppercase flex items-center gap-1">
                  <Lock className="w-2.5 h-2.5" />
                  100% Client-Side
                </span>
              </div>
              <p className="text-xs text-slate-400">Zero cloud uploads • In-memory composite broadcast saved</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            title="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Video Player Preview + caption overlay */}
          <div className="relative rounded-xl overflow-hidden border border-slate-800 bg-black aspect-video flex items-center justify-center shadow-inner">
            <video
              ref={videoRef}
              src={videoUrl}
              controls
              playsInline
              className="w-full h-full object-contain"
              onTimeUpdate={(e) => {
                const t = e.currentTarget.currentTime;
                setPreviewTime((prev) => (Math.abs(prev - t) > 0.1 ? t : prev));
              }}
              onSeeked={(e) => setPreviewTime(e.currentTarget.currentTime)}
            />
            {previewCue && (
              <div className="absolute bottom-12 left-1/2 -translate-x-1/2 max-w-[90%] pointer-events-none">
                <div
                  className="bg-black/75 text-white font-bold text-center px-4 py-1.5 rounded-lg text-sm sm:text-base leading-snug"
                  dir={/[\u0600-\u06FF]/.test(previewCue.text) ? 'rtl' : 'ltr'}
                >
                  {previewCue.text}
                </div>
              </div>
            )}
          </div>

          {/* Privacy Guarantee Note */}
          <div className="flex items-start gap-3 p-3 rounded-xl bg-emerald-950/40 border border-emerald-800/80 text-emerald-200 text-xs">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <p className="font-bold text-emerald-300">
                All recordings are processed and saved locally on your device for privacy.
              </p>
              <p className="text-[11px] text-emerald-400/80">
                No video data, audio tracks, or raw media streams are ever uploaded or transmitted to any remote server or cloud database.
              </p>
            </div>
          </div>

          {/* Stats Badges */}
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
              <span className="text-slate-400 block text-[11px] mb-0.5 font-medium">Duration</span>
              <span className="font-mono font-bold text-white text-sm">{durationStr}</span>
            </div>
            <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
              <span className="text-slate-400 block text-[11px] mb-0.5 font-medium">Local Size</span>
              <span className="font-mono font-bold text-white text-sm">{fileSizeMb} MB</span>
            </div>
            <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
              <span className="text-slate-400 block text-[11px] mb-0.5 font-medium">Format</span>
              <span className="font-mono font-bold text-white text-xs truncate" title={mimeType}>
                WebM (VP9/Opus)
              </span>
            </div>
          </div>

          {/* ============ EDIT SECTION ============ */}
          <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 space-y-5">
            <div className="flex items-center gap-2">
              <Scissors className="w-4 h-4 text-emerald-400" />
              <h4 className="font-bold text-white text-sm">Edit your recording</h4>
              <span className="text-[11px] text-slate-400">— everything stays on your device</span>
            </div>

            {/* --- Trim --- */}
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-200">1. Trim</span>
                <span className="text-[11px] font-mono text-slate-400">
                  Keep {formatTime(trimStart)} – {formatTime(trimEnd)} • {formatTime(keptSeconds)} kept
                  {removedSeconds > 0.5 ? ` • ${formatTime(removedSeconds)} removed` : ''}
                </span>
              </div>
              {/* Timeline */}
              <div
                ref={timelineRef}
                className="relative h-10 rounded-lg bg-slate-800 border border-slate-700 cursor-pointer select-none touch-none"
                onClick={seekFromTimelineClick}
                title="Click to seek • Drag the handles to trim"
              >
                {segments.map((s, i) => (
                  <div
                    key={i}
                    className="absolute top-0 bottom-0 bg-emerald-600/70"
                    style={{ left: pct(s.start), width: `calc(${pct(s.end)} - ${pct(s.start)})` }}
                  />
                ))}
                {/* Playhead */}
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-white pointer-events-none"
                  style={{ left: pct(previewTime) }}
                />
                {/* Trim handles */}
                <div
                  className="absolute top-0 bottom-0 w-4 -ml-2 rounded-md bg-emerald-400 border-2 border-emerald-200 cursor-ew-resize z-10"
                  style={{ left: pct(trimStart) }}
                  onPointerDown={startHandleDrag('start')}
                  title="Drag to set start"
                />
                <div
                  className="absolute top-0 bottom-0 w-4 -ml-2 rounded-md bg-emerald-400 border-2 border-emerald-200 cursor-ew-resize z-10"
                  style={{ left: pct(trimEnd) }}
                  onPointerDown={startHandleDrag('end')}
                  title="Drag to set end"
                />
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setTrimStart(0);
                    setTrimEnd(duration);
                  }}
                  className="text-[11px] font-bold text-slate-300 hover:text-white px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 flex items-center gap-1 cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" /> Reset trim
                </button>
                <label className="ml-auto flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={previewEdit}
                    onChange={(e) => setPreviewEdit(e.target.checked)}
                    className="accent-emerald-500"
                  />
                  Preview the edit while playing
                </label>
              </div>
            </section>

            {/* --- Jump-cut --- */}
            <section className="space-y-2 border-t border-slate-800 pt-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <Wand2 className="w-3.5 h-3.5 text-emerald-400" /> 2. Jump-cut — remove the pauses
                </span>
                <button
                  onClick={detectPauses}
                  disabled={analyzingSilence || !videoBlob}
                  className="text-[11px] font-bold px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white flex items-center gap-1.5 cursor-pointer"
                >
                  {analyzingSilence ? (
                    <>
                      <Loader2 className="w-3 h-3 animate-spin" /> Listening…
                    </>
                  ) : (
                    'Detect pauses'
                  )}
                </button>
              </div>
              {silenceError && (
                <p className="text-[11px] text-amber-300 flex items-start gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" /> {silenceError}
                </p>
              )}
              {silences !== null && !silenceError && (
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] text-slate-300">
                    {silences.length === 0
                      ? 'No long pauses found — nothing to cut.'
                      : `Found ${silences.length} pause${silences.length > 1 ? 's' : ''} (${formatTime(silenceSeconds)} total).`}
                  </p>
                  {silences.length > 0 && (
                    <label className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-300 cursor-pointer shrink-0">
                      <input
                        type="checkbox"
                        checked={jumpCutEnabled}
                        onChange={(e) => setJumpCutEnabled(e.target.checked)}
                        className="accent-emerald-500"
                      />
                      Cut them out
                    </label>
                  )}
                </div>
              )}
              <p className="text-[11px] text-slate-500">
                The same trick as CapCut jump cuts — one tap removes the “umms” and dead air.
              </p>
            </section>

            {/* --- Captions --- */}
            <section className="space-y-2 border-t border-slate-800 pt-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <Captions className="w-3.5 h-3.5 text-emerald-400" /> 3. Captions
                </span>
                <label className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={captionsEnabled}
                    onChange={(e) => setCaptionsEnabled(e.target.checked)}
                    className="accent-emerald-500"
                  />
                  Show captions
                </label>
              </div>
              {captionsEnabled && (
                <>
                  <p className="text-[11px] text-slate-500">
                    From the live transcript — it makes mistakes, so tap any line to fix it.
                    Captions are burned into the exported video, so they show on YouTube, TikTok
                    and Instagram. Arabic and English both work.
                  </p>
                  {cues.length === 0 ? (
                    <p className="text-[11px] text-slate-400">
                      No transcript was captured for this recording. Add captions by hand below.
                    </p>
                  ) : (
                    <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                      {cues.map((cue) => (
                        <div key={cue.id} className="flex items-center gap-2">
                          <span className="text-[10px] font-mono text-slate-400 shrink-0 w-24">
                            {formatTime(cue.start)} – {formatTime(cue.end)}
                          </span>
                          <input
                            value={cue.text}
                            onChange={(e) => updateCueText(cue.id, e.target.value)}
                            dir={/[\u0600-\u06FF]/.test(cue.text) ? 'rtl' : 'ltr'}
                            placeholder="Caption text…"
                            className="flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white placeholder:text-slate-500 outline-none focus:border-emerald-500"
                          />
                          <button
                            onClick={() => deleteCue(cue.id)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-red-300 hover:bg-slate-800 cursor-pointer"
                            title="Delete caption"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <button
                    onClick={addCue}
                    className="text-[11px] font-bold text-slate-200 hover:text-white px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3 h-3" /> Add a caption at the playhead
                  </button>
                </>
              )}
            </section>

            {/* --- Clips --- */}
            {chapterMarkers.length > 1 && (
              <section className="space-y-2 border-t border-slate-800 pt-4">
                <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <Clapperboard className="w-3.5 h-3.5 text-emerald-400" /> 4. Clips — export one chapter
                </span>
                <div className="space-y-1.5">
                  {chapterMarkers.map((marker, i) => {
                    const next = chapterMarkers[i + 1];
                    const clipEnd = next ? next.timestampSeconds : duration;
                    const clipLen = Math.max(0, clipEnd - marker.timestampSeconds);
                    if (clipLen < 1) return null;
                    return (
                      <div
                        key={marker.id}
                        className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2"
                      >
                        <span className="text-xs text-white font-medium flex-1 min-w-0 truncate">
                          {marker.label}
                        </span>
                        <span className="text-[11px] font-mono text-slate-400 shrink-0">
                          {formatTime(marker.timestampSeconds)} – {formatTime(clipEnd)} (
                          {formatTime(clipLen)})
                        </span>
                        <button
                          onClick={() =>
                            runExport('webm', {
                              start: marker.timestampSeconds,
                              end: clipEnd,
                              name: marker.label,
                            })
                          }
                          disabled={exportStatus === 'working'}
                          className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white flex items-center gap-1 cursor-pointer shrink-0"
                        >
                          <Play className="w-3 h-3" /> Export clip
                        </button>
                      </div>
                    );
                  })}
                </div>
                <p className="text-[11px] text-slate-500">
                  Clips use your trim, jump-cut and caption settings inside that chapter.
                </p>
              </section>
            )}

            {/* --- Export --- */}
            <section className="space-y-2 border-t border-slate-800 pt-4">
              <span className="text-xs font-bold text-slate-200">5. Export your edit</span>
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  onClick={() => runExport('webm')}
                  disabled={exportStatus === 'working' || segments.length === 0}
                  className="flex-1 py-3 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 active:scale-[0.98] text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/30 transition-all cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  Export edited WebM
                </button>
                <button
                  onClick={() => runExport('mp4')}
                  disabled={exportStatus === 'working' || segments.length === 0}
                  className="flex-1 py-3 px-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 active:scale-[0.98] text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-blue-600/30 transition-all cursor-pointer"
                  title="MP4 downloads a converter the first time you use it"
                >
                  <FileVideo className="w-4 h-4" />
                  Export as MP4
                </button>
              </div>
              <p className="text-[11px] text-slate-500">
                WebM is instant and plays on YouTube. MP4 works everywhere — it downloads the
                converter once (about 30 MB) the first time, then converts on your device.
                Exporting runs in real time, like playing the video once.
              </p>

              {exportStatus === 'working' && (
                <div className="space-y-2">
                  <div className="h-2.5 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 transition-all"
                      style={{ width: `${Math.round(exportProgress * 100)}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-slate-300 flex items-center gap-1.5">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> {exportLabel}{' '}
                      {Math.round(exportProgress * 100)}%
                    </span>
                    <button
                      onClick={cancelExport}
                      className="text-[11px] font-bold text-slate-300 hover:text-white px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {exportStatus === 'error' && exportError && (
                <div className="p-3 rounded-xl bg-red-950/60 border border-red-800 text-red-200 text-xs flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold">Export didn’t finish</p>
                    <p className="text-red-300/90">{exportError}</p>
                    <button
                      onClick={() => runExport('webm')}
                      className="mt-2 text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-red-800 hover:bg-red-700 text-white cursor-pointer"
                    >
                      Try WebM export instead
                    </button>
                  </div>
                </div>
              )}

              {exportStatus === 'done' && exportUrl && (
                <div className="p-3 rounded-xl bg-emerald-950/60 border border-emerald-800 text-emerald-200 text-xs flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-bold">Your edited video is ready</p>
                    <p className="text-emerald-300/80 font-mono text-[11px] truncate">
                      {exportFilename} • {exportSizeMb} MB
                    </p>
                  </div>
                  <a
                    href={exportUrl}
                    download={exportFilename}
                    className="shrink-0 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" /> Download
                  </a>
                </div>
              )}
            </section>

            {/* --- Publish to YouTube (Piece 3) --- */}
            <section className="space-y-2 border-t border-slate-800 pt-4">
              <YouTubePublish
                file={exportBlob ?? videoBlob}
                filename={exportFilename || filename}
                defaultTitle={
                  showNotes?.episodeTitle ||
                  filename.replace(/\.webm$/i, '').replace(/_/g, ' ')
                }
                defaultDescription={showNotes?.summary || ''}
                showNotes={showNotes}
              />
              {exportStatus !== 'done' && (
                <p className="text-[11px] text-slate-500">
                  Tip: this publishes the original recording. Export your edit in step 5
                  first if you want the trimmed, jump-cut version with captions.
                </p>
              )}
            </section>
          </div>

          {/* Re-download confirmation toast */}
          {downloadSuccess && (
            <div className="flex items-center gap-2 p-2.5 bg-blue-950/80 border border-blue-800 rounded-xl text-xs text-blue-200 animate-in fade-in">
              <CheckCircle2 className="w-4 h-4 text-blue-400 shrink-0" />
              <span>
                Direct local download triggered: <strong>{filename}</strong>
              </span>
            </div>
          )}

          {/* Action Buttons: Save to Device & Generate AI Show Notes */}
          <div className="flex flex-col sm:flex-row items-center gap-3 pt-1">
            <button
              onClick={triggerLocalDownload}
              className="w-full sm:flex-1 py-3 px-4 bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/30 transition-all cursor-pointer"
              title="Save recording directly to your device storage"
            >
              <Download className="w-4 h-4" />
              Save to Device
            </button>

            <button
              onClick={() => {
                onClose();
                onGenerateShowNotes();
              }}
              className="w-full sm:flex-1 py-3 px-4 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 active:scale-[0.98] text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-purple-600/30 transition-all cursor-pointer"
            >
              <Sparkles className="w-4 h-4 text-purple-200" />
              Generate AI Show Notes
            </button>
          </div>

          <div className="text-center">
            <span className="text-[11px] font-mono text-slate-500">Filename: {filename}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
