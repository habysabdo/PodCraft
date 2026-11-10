import React, { useRef, useState } from 'react';
import {
  ScreenShare,
  Upload,
  Link,
  Play,
  Pause,
  Volume2,
  VolumeX,
  XCircle,
  Tv,
  Columns2,
  Radio,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { LayoutMode, ReactionMediaState } from '../types/studio';

interface ReactionMediaControlsProps {
  mediaState: ReactionMediaState;
  mediaError?: string | null;
  onClearError?: () => void;
  onStartScreenShare: () => void;
  onLoadLocalFile: (file: File) => void;
  onLoadUrl: (url: string) => void;
  onEmbedAndReact?: (url: string) => void;
  onTogglePlayPause: () => void;
  onSeek: (seconds: number) => void;
  onVolumeChange: (volume: number) => void;
  onToggleMute: () => void;
  onEjectMedia: () => void;
  activeLayout: LayoutMode;
  onSelectLayout: (layout: LayoutMode) => void;
}

export const ReactionMediaControls: React.FC<ReactionMediaControlsProps> = ({
  mediaState,
  mediaError,
  onClearError,
  onStartScreenShare,
  onLoadLocalFile,
  onLoadUrl,
  onEmbedAndReact,
  onTogglePlayPause,
  onSeek,
  onVolumeChange,
  onToggleMute,
  onEjectMedia,
  activeLayout,
  onSelectLayout,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [urlInput, setUrlInput] = useState('');

  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs < 0) return '00:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onLoadLocalFile(file);
    }
  };

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (urlInput.trim()) {
      if (onEmbedAndReact) {
        onEmbedAndReact(urlInput.trim());
      } else {
        onLoadUrl(urlInput.trim());
      }
    }
  };

  const loadSampleYouTube = () => {
    // NASA Artemis rocket launch official YouTube video
    const sampleYt = 'https://www.youtube.com/watch?v=21X5lGlDOfg';
    setUrlInput(sampleYt);
    if (onEmbedAndReact) {
      onEmbedAndReact(sampleYt);
    } else {
      onLoadUrl(sampleYt);
    }
  };

  const loadSampleVideo = () => {
    const sampleUrl = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';
    setUrlInput(sampleUrl);
    if (onEmbedAndReact) {
      onEmbedAndReact(sampleUrl);
    } else {
      onLoadUrl(sampleUrl);
    }
  };

  const isMediaActive = mediaState.type !== 'none';
  const isEmbedType =
    mediaState.type === 'youtube' ||
    mediaState.type === 'facebook' ||
    mediaState.type === 'web-embed';

  return (
    <div className="bg-slate-900/90 rounded-2xl border border-slate-800 p-4 shadow-xl space-y-3.5">
      {/* Header and Direct Toolbar Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-purple-600/20 border border-purple-500/40 flex items-center justify-center text-purple-400">
            <Tv className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-white text-sm">Media & Screen Commentary</h3>
              {isMediaActive && (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded font-bold uppercase bg-emerald-950 text-emerald-300 border border-emerald-800/80 flex items-center gap-1 animate-pulse">
                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                  {mediaState.type === 'screen'
                    ? 'LIVE SCREEN'
                    : mediaState.type === 'youtube'
                    ? 'YOUTUBE EMBED'
                    : mediaState.type === 'facebook'
                    ? 'FACEBOOK EMBED'
                    : 'MEDIA LOADED'}
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-400">
              {isMediaActive
                ? mediaState.title
                : 'Paste YouTube, Facebook, or web video links to react and commentate live with Picture-in-Picture.'}
            </p>
          </div>
        </div>

        {/* Action Toolbar: Share Screen, Embed & React Input Bar, Upload Video, Eject */}
        <div className="flex flex-wrap items-center gap-2 flex-1 justify-end">
          {/* Share Screen / Tab */}
          <button
            onClick={onStartScreenShare}
            className={`px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
              mediaState.type === 'screen'
                ? 'bg-purple-600 text-white border-purple-400 shadow-md shadow-purple-600/30'
                : 'bg-slate-950 text-slate-300 border-slate-800 hover:bg-slate-800 hover:text-white'
            }`}
            title="Share screen, browser tab, or app window with audio"
          >
            <ScreenShare className="w-3.5 h-3.5 text-purple-400" />
            Share Screen / Tab
          </button>

          {/* Link Input Bar: Embed & React */}
          <form onSubmit={handleUrlSubmit} className="flex items-center gap-1.5 flex-1 min-w-[280px] max-w-lg">
            <div className="relative flex-1">
              <Link className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                placeholder="Paste YouTube, Facebook, or video link..."
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-8 pr-2.5 py-1.5 text-xs text-white placeholder-slate-500 outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-all"
              />
            </div>
            <button
              type="submit"
              className="px-3.5 py-1.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:brightness-110 active:scale-95 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-purple-600/20 cursor-pointer shrink-0 flex items-center gap-1.5"
              title="Embed YouTube, Facebook, or video link for live reaction broadcast"
            >
              <Tv className="w-3.5 h-3.5 text-purple-200" />
              Embed & React
            </button>
          </form>

          {/* Upload Local File */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept="video/mp4,video/webm,video/quicktime,video/*"
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-3 py-1.5 rounded-xl bg-slate-950 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer shrink-0"
            title="Load local video file (MP4, WebM)"
          >
            <Upload className="w-3.5 h-3.5 text-blue-400" />
            Upload Video
          </button>

          {/* Quick Sample Buttons */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={loadSampleYouTube}
              className="px-2 py-1.5 bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-red-400 border border-slate-800 rounded-xl text-[11px] font-medium transition-all cursor-pointer flex items-center gap-1"
              title="Test with live YouTube embed"
            >
              <Play className="w-3 h-3 text-red-500 fill-current" />
              YouTube Sample
            </button>
            <button
              type="button"
              onClick={loadSampleVideo}
              className="px-2 py-1.5 bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-blue-400 border border-slate-800 rounded-xl text-[11px] font-medium transition-all cursor-pointer"
              title="Test with MP4 video file"
            >
              MP4 Sample
            </button>
          </div>

          {/* Eject Media Button */}
          {isMediaActive && (
            <button
              onClick={onEjectMedia}
              className="px-2.5 py-1.5 rounded-xl bg-red-950/80 hover:bg-red-900 text-red-300 border border-red-800/80 text-xs font-semibold flex items-center gap-1 transition-all cursor-pointer shrink-0"
              title="Close and eject active media"
            >
              <XCircle className="w-3.5 h-3.5 text-red-400" />
              Eject
            </button>
          )}
        </div>
      </div>

      {/* Error Badge for CORS / Video Network / Load Failures */}
      {mediaError && (
        <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 bg-red-950/70 border border-red-800/90 rounded-xl text-xs text-red-200">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
            <div>
              <span className="font-bold text-red-300">Video URL Error: </span>
              <span className="text-red-200/90">{mediaError}</span>
            </div>
          </div>
          {onClearError && (
            <button
              onClick={onClearError}
              className="text-xs text-red-400 hover:text-white px-2 py-0.5 rounded bg-red-900/50 hover:bg-red-800/80 transition-colors cursor-pointer shrink-0"
            >
              Dismiss
            </button>
          )}
        </div>
      )}

      {/* Media Active Controls: Playback Scrub, Volume, Reaction Layout Switchers */}
      {isMediaActive ? (
        <div className="space-y-3 bg-slate-950/70 p-3.5 rounded-xl border border-slate-800">
          {/* Top Row: Playback Controls & Volume */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            {/* Play/Pause & Scrubbing */}
            <div className="flex items-center gap-3 flex-1 min-w-[280px]">
              {mediaState.type !== 'screen' && (
                <button
                  onClick={onTogglePlayPause}
                  className="p-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-all cursor-pointer shadow-md"
                  title={mediaState.isPlaying ? 'Pause video' : 'Play video'}
                >
                  {mediaState.isPlaying ? (
                    <Pause className="w-4 h-4 fill-current" />
                  ) : (
                    <Play className="w-4 h-4 fill-current" />
                  )}
                </button>
              )}

              {/* Timecode and scrubber for video files/urls */}
              {mediaState.type !== 'screen' ? (
                <div className="flex items-center gap-2.5 flex-1">
                  <span className="text-xs font-mono font-bold text-slate-300 select-none">
                    {formatTime(mediaState.currentTime)}
                  </span>
                  <input
                    type="range"
                    min="0"
                    max={mediaState.duration || 100}
                    step="0.1"
                    value={mediaState.currentTime}
                    onChange={(e) => onSeek(parseFloat(e.target.value))}
                    className="flex-1 h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
                  />
                  <span className="text-xs font-mono text-slate-500 select-none">
                    {formatTime(mediaState.duration)}
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Radio className="w-4 h-4 text-emerald-400 animate-pulse" />
                  <span className="text-xs font-mono text-slate-300">
                    Live Screen / Browser Tab Streaming Active
                  </span>
                </div>
              )}
            </div>

            {/* Media Audio Volume Routing */}
            <div className="flex items-center gap-2.5 w-56">
              <button
                onClick={onToggleMute}
                className={`p-1.5 rounded-lg border text-xs transition-colors ${
                  mediaState.muted
                    ? 'bg-red-500/20 text-red-400 border-red-500/40'
                    : 'bg-slate-800 text-slate-300 border-slate-700 hover:text-white'
                }`}
                title={mediaState.muted ? 'Unmute media audio' : 'Mute media audio'}
              >
                {mediaState.muted ? (
                  <VolumeX className="w-4 h-4 text-red-400" />
                ) : (
                  <Volume2 className="w-4 h-4 text-emerald-400" />
                )}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={mediaState.muted ? 0 : mediaState.volume}
                onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
                className="flex-1 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
                title="Media volume sent to broadcast & monitor"
              />
              <span className="text-[11px] font-mono text-slate-400 w-9 text-right">
                {mediaState.muted ? 'MUTE' : `${Math.round(mediaState.volume * 100)}%`}
              </span>
            </div>
          </div>

          {/* Reaction Layout Mode Switcher Bar */}
          <div className="flex flex-wrap items-center justify-between pt-2 border-t border-slate-800/80 gap-2">
            <span className="text-xs font-bold text-purple-300 uppercase tracking-wider flex items-center gap-1.5">
              <Tv className="w-3.5 h-3.5" />
              Reaction Broadcast Layout:
            </span>

            <div className="flex items-center gap-2">
              <button
                onClick={() => onSelectLayout('reaction-split')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                  activeLayout === 'reaction-split'
                    ? 'bg-purple-600 text-white shadow-md'
                    : 'bg-slate-900 text-slate-400 hover:text-white hover:bg-slate-800 border border-slate-800'
                }`}
                title="Reaction Split: Media 70% on left, Host webcam on right"
              >
                <Columns2 className="w-3.5 h-3.5" />
                Reaction Split (70/30)
              </button>

              <button
                onClick={() => onSelectLayout('reaction-pip')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                  activeLayout === 'reaction-pip'
                    ? 'bg-purple-600 text-white shadow-md'
                    : 'bg-slate-900 text-slate-400 hover:text-white hover:bg-slate-800 border border-slate-800'
                }`}
                title="Reaction PiP: Media full screen with Host webcam pinned in bottom-right"
              >
                <Tv className="w-3.5 h-3.5" />
                Reaction PiP
              </button>

              <button
                onClick={() => onSelectLayout('side-by-side')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                  activeLayout === 'side-by-side'
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'bg-slate-900 text-slate-400 hover:text-white hover:bg-slate-800 border border-slate-800'
                }`}
                title="Reset to standard side-by-side split"
              >
                Standard Dual (50/50)
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between text-xs text-slate-400 p-2.5 bg-slate-950/40 rounded-xl border border-slate-800/60">
          <p className="flex items-center gap-1.5">
            <Tv className="w-3.5 h-3.5 text-purple-400" />
            Want to react to a YouTube video or slide deck? Click <strong className="text-purple-300">"Share Screen / Tab"</strong> or upload a video file above.
          </p>
          <span className="font-mono text-[11px] text-slate-500">STANDBY</span>
        </div>
      )}
    </div>
  );
};
