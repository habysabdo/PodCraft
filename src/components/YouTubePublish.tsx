import React, { useState, useRef } from 'react';
import {
  Youtube,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Link2,
  Copy,
  Check,
  ExternalLink,
  LogOut,
} from 'lucide-react';
import {
  buildVideoMetadata,
  clearTokens,
  connectYouTube,
  loadTokens,
  uploadToYouTube,
  type YouTubePrivacy,
} from '../lib/youtube';
import type { ShowNotesData } from '../types/studio';

interface YouTubePublishProps {
  /** The finished file to publish (edited export when present, else the original). */
  file: Blob | null;
  filename: string;
  /** Prefilled from the AI show-notes episode title when available, else the filename. */
  defaultTitle: string;
  /** Prefilled from the AI show-notes summary when available, else empty. */
  defaultDescription: string;
  /** Full AI show notes for the episode — saved with the publish record. */
  showNotes?: ShowNotesData | null;
}

const PRIVACY_OPTIONS: Array<{ value: YouTubePrivacy; label: string }> = [
  { value: 'unlisted', label: 'Unlisted — anyone with the link can watch' },
  { value: 'private', label: 'Private — only you can watch' },
  { value: 'public', label: 'Public — everyone can watch' },
];

const formatMb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(2);

/**
 * Save the published episode to D1 (POST /api/episodes) — fire-and-forget.
 * The video is already live on YouTube when this runs, so a failure here
 * (no D1 binding yet, offline) must never block or hide the success UI:
 * it only logs a warning.
 */
function saveEpisodeRecord(
  videoId: string,
  title: string,
  privacy: YouTubePrivacy,
  showNotes: ShowNotesData | null | undefined
): void {
  try {
    void fetch('/api/episodes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        videoId,
        privacy,
        showNotes: showNotes ? JSON.stringify(showNotes) : undefined,
      }),
    }).catch(() => {
      console.warn(
        '[podcraft] Could not save the episode record (episodes database unavailable). The video is still live on YouTube.'
      );
    });
  } catch {
    // Never let the record-keeping break the success UI.
  }
}

export const YouTubePublish: React.FC<YouTubePublishProps> = ({
  file,
  filename,
  defaultTitle,
  defaultDescription,
  showNotes,
}) => {
  const [connected, setConnected] = useState<boolean>(() => loadTokens() !== null);
  const [connecting, setConnecting] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);

  const [title, setTitle] = useState(defaultTitle);
  const [description, setDescription] = useState(defaultDescription);
  const [privacy, setPrivacy] = useState<YouTubePrivacy>('unlisted');

  const [uploadState, setUploadState] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle');
  const [sentBytes, setSentBytes] = useState(0);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const handleConnect = async () => {
    setConnecting(true);
    setSetupError(null);
    try {
      // On success this navigates away to Google; nothing after it runs.
      await connectYouTube();
    } catch (err) {
      setSetupError(
        err instanceof Error ? err.message : 'Could not start the Google sign-in.'
      );
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = () => {
    clearTokens();
    setConnected(false);
    setUploadState('idle');
    setVideoId(null);
    setUploadError(null);
  };

  const handleUpload = async () => {
    if (!file) {
      setUploadError('Nothing to publish yet — record or export a video first.');
      setUploadState('error');
      return;
    }
    if (!title.trim()) {
      setUploadError('Add a title before publishing.');
      setUploadState('error');
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setUploadState('uploading');
    setUploadError(null);
    setVideoId(null);
    setSentBytes(0);
    try {
      const meta = buildVideoMetadata(title, description, privacy);
      const id = await uploadToYouTube(
        file,
        meta,
        (p) => setSentBytes(p.sent),
        controller.signal
      );
      setVideoId(id);
      setUploadState('done');
      // Record the publish in D1 — fire-and-forget, never blocks the UI.
      saveEpisodeRecord(id, title, privacy, showNotes);
    } catch (err) {
      if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
        setUploadState('idle');
        setUploadError(null);
        return;
      }
      setUploadError(err instanceof Error ? err.message : 'Upload failed.');
      setUploadState('error');
    }
  };

  const handleCancel = () => {
    abortRef.current?.abort();
  };

  const copyWatchLink = async () => {
    if (!videoId) return;
    try {
      await navigator.clipboard.writeText(`https://www.youtube.com/watch?v=${videoId}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked — the link is visible and selectable below.
    }
  };

  const totalBytes = file?.size ?? 0;
  const progressPct =
    uploadState === 'uploading' && totalBytes > 0
      ? Math.round((sentBytes / totalBytes) * 100)
      : 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
          <Youtube className="w-4 h-4 text-red-500" /> 6. Publish to YouTube
        </span>
        {connected ? (
          <span className="text-[11px] font-bold px-2 py-1 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-800/80">
            Connected
          </span>
        ) : (
          <span className="text-[11px] font-bold px-2 py-1 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
            Not connected
          </span>
        )}
      </div>

      {!connected ? (
        <>
          <p className="text-[11px] text-slate-400">
            One tap publishes the finished video to <strong className="text-slate-200">your own
            YouTube channel</strong> — the file goes straight from your browser to YouTube,
            nowhere else.
          </p>
          <button
            onClick={handleConnect}
            disabled={connecting}
            className="w-full py-3 px-4 bg-red-600 hover:bg-red-500 disabled:opacity-50 active:scale-[0.98] text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-red-600/30 transition-all cursor-pointer"
          >
            {connecting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Opening Google sign-in…
              </>
            ) : (
              <>
                <Youtube className="w-4 h-4" /> Connect YouTube
              </>
            )}
          </button>
          {setupError && (
            <div className="p-3 rounded-xl bg-amber-950/60 border border-amber-800 text-amber-200 text-xs flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">YouTube isn’t set up on the server yet</p>
                <p className="text-amber-300/90">{setupError}</p>
              </div>
            </div>
          )}
          <p className="text-[11px] text-slate-500">
            First time only: Google asks you to sign in and approve the upload permission.
            You can disconnect anytime below — your videos stay on YouTube.
          </p>
        </>
      ) : (
        <>
          <p className="text-[11px] text-slate-400">
            File: <span className="font-mono text-slate-200">{filename}</span>
            {totalBytes > 0 && (
              <span className="text-slate-500"> • {formatMb(totalBytes)} MB</span>
            )}
          </p>

          <label className="block space-y-1">
            <span className="text-[11px] font-bold text-slate-300">Title</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={100}
              disabled={uploadState === 'uploading'}
              placeholder="Episode title…"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 outline-none focus:border-red-500 disabled:opacity-60"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-[11px] font-bold text-slate-300">Description</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={5000}
              rows={3}
              disabled={uploadState === 'uploading'}
              placeholder="What is this episode about? (optional)"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 outline-none focus:border-red-500 disabled:opacity-60 resize-y"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-[11px] font-bold text-slate-300">Who can watch it</span>
            <select
              value={privacy}
              onChange={(e) => setPrivacy(e.target.value as YouTubePrivacy)}
              disabled={uploadState === 'uploading'}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-red-500 disabled:opacity-60 cursor-pointer"
            >
              {PRIVACY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <span className="text-[11px] text-slate-500">
              Unlisted is safest for a first publish — it won’t show on your channel.
            </span>
          </label>

          {uploadState === 'uploading' ? (
            <div className="space-y-2">
              <div className="h-2.5 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-red-500 transition-all"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-slate-300 flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Uploading to YouTube…{' '}
                  {progressPct}% ({formatMb(sentBytes)} / {formatMb(totalBytes)} MB)
                </span>
                <button
                  onClick={handleCancel}
                  className="text-[11px] font-bold text-slate-300 hover:text-white px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={handleUpload}
              disabled={!file}
              className="w-full py-3 px-4 bg-red-600 hover:bg-red-500 disabled:opacity-50 active:scale-[0.98] text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-red-600/30 transition-all cursor-pointer"
            >
              <Youtube className="w-4 h-4" />
              Publish to YouTube
            </button>
          )}

          {uploadState === 'error' && uploadError && (
            <div className="p-3 rounded-xl bg-red-950/60 border border-red-800 text-red-200 text-xs flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Publish didn’t finish</p>
                <p className="text-red-300/90">{uploadError}</p>
                <p className="text-red-300/70 mt-1">
                  Your local file is safe — nothing was deleted.
                </p>
              </div>
            </div>
          )}

          {uploadState === 'done' && videoId && (
            <div className="p-3 rounded-xl bg-emerald-950/60 border border-emerald-800 text-emerald-200 text-xs space-y-2">
              <p className="font-bold flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" /> It’s live on YouTube
              </p>
              <p className="font-mono text-[11px] text-emerald-300/80 break-all flex items-center gap-1.5">
                <Link2 className="w-3.5 h-3.5 shrink-0" />
                https://www.youtube.com/watch?v={videoId}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={copyWatchLink}
                  className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer"
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'Copied!' : 'Copy link'}
                </button>
                <a
                  href={`https://www.youtube.com/watch?v=${videoId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> Watch it
                </a>
              </div>
              <p className="text-emerald-300/70">
                YouTube may take a minute to process the video. Publishing again creates a
                second copy — edit the one on YouTube instead if you only want a fix.
              </p>
            </div>
          )}

          <div className="flex items-center justify-between">
            <p className="text-[11px] text-slate-500">
              Publishes to your own channel, as {privacy}.
            </p>
            <button
              onClick={handleDisconnect}
              className="text-[11px] font-bold text-slate-400 hover:text-white px-2 py-1 rounded-lg hover:bg-slate-800 flex items-center gap-1 cursor-pointer"
              title="Remove the stored YouTube connection from this browser"
            >
              <LogOut className="w-3 h-3" /> Disconnect
            </button>
          </div>
        </>
      )}
    </div>
  );
};
