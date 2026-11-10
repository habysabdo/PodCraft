import React, { useRef, useEffect } from 'react';
import {
  Columns2,
  Tv,
  User,
  Users,
  Settings2,
  FlipHorizontal,
  Play,
  Pause,
  Volume2,
  VolumeX,
  X,
  Radio,
  ExternalLink,
} from 'lucide-react';
import { LayoutMode, StudioBranding, VideoFilterSettings, ReactionMediaState } from '../types/studio';
import { drawStudioFrame, getCssFilterString } from '../utils/canvasCompositor';

interface BroadcastCanvasViewProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  hostVideoRef: React.RefObject<HTMLVideoElement | null>;
  guestVideoRef: React.RefObject<HTMLVideoElement | null>;
  mediaVideoRef?: React.RefObject<HTMLVideoElement | null>;
  mediaTitle?: string;
  mediaState?: ReactionMediaState;
  isMediaActive?: boolean;
  layout: LayoutMode;
  setLayout: (layout: LayoutMode) => void;
  hostFilters: VideoFilterSettings;
  guestFilters: VideoFilterSettings;
  hostName: string;
  guestName: string;
  branding: StudioBranding;
  setBranding: React.Dispatch<React.SetStateAction<StudioBranding>>;
  isRecording: boolean;
  recordingTimeSeconds: number;
  hostVuLevel: number;
  guestVuLevel: number;
  onToggleHostMirror?: () => void;
  onToggleGuestMirror?: () => void;
  onTogglePlayPause?: () => void;
  onVolumeChange?: (vol: number) => void;
  onToggleMute?: () => void;
  onEjectMedia?: () => void;
  hostStream?: MediaStream | null;
}

export const BroadcastCanvasView: React.FC<BroadcastCanvasViewProps> = ({
  canvasRef,
  hostVideoRef,
  guestVideoRef,
  mediaVideoRef,
  mediaTitle,
  mediaState,
  isMediaActive = false,
  layout,
  setLayout,
  hostFilters,
  guestFilters,
  hostName,
  guestName,
  branding,
  setBranding,
  isRecording,
  recordingTimeSeconds,
  hostVuLevel,
  guestVuLevel,
  onToggleHostMirror,
  onToggleGuestMirror,
  onTogglePlayPause,
  onVolumeChange,
  onToggleMute,
  onEjectMedia,
  hostStream,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [showBrandingEditor, setShowBrandingEditor] = React.useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const pipVideoRef = useRef<HTMLVideoElement | null>(null);

  const isIframeEmbedded =
    Boolean(mediaState?.embedUrl) &&
    (mediaState?.type === 'youtube' ||
      mediaState?.type === 'facebook' ||
      mediaState?.type === 'web-embed');

  // Sync Host video stream into PiP overlay video element
  useEffect(() => {
    if (isIframeEmbedded && pipVideoRef.current) {
      const stream = hostStream || (hostVideoRef.current?.srcObject as MediaStream | null);
      if (stream) {
        pipVideoRef.current.srcObject = stream;
        pipVideoRef.current.play().catch(() => {});
      }
    }
  }, [isIframeEmbedded, hostStream, hostVideoRef.current?.srcObject]);

  // YouTube postMessage controller
  const sendYouTubeCommand = (func: string, args: unknown[] = []) => {
    if (iframeRef.current && iframeRef.current.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        JSON.stringify({
          event: 'command',
          func,
          args,
        }),
        '*'
      );
    }
  };

  const handlePlayPauseClick = () => {
    if (mediaState?.type === 'youtube') {
      sendYouTubeCommand(mediaState.isPlaying ? 'pauseVideo' : 'playVideo');
    }
    if (onTogglePlayPause) {
      onTogglePlayPause();
    }
  };

  const handleVolumeSlider = (newVol: number) => {
    if (mediaState?.type === 'youtube') {
      sendYouTubeCommand('setVolume', [Math.round(newVol * 100)]);
    }
    if (onVolumeChange) {
      onVolumeChange(newVol);
    }
  };

  const handleMuteToggleClick = () => {
    if (mediaState?.type === 'youtube') {
      sendYouTubeCommand(mediaState.muted ? 'unMute' : 'mute');
    }
    if (onToggleMute) {
      onToggleMute();
    }
  };

  // Format timecode MM:SS
  const mins = Math.floor(recordingTimeSeconds / 60);
  const secs = Math.floor(recordingTimeSeconds % 60);
  const timecode = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  // Animation render loop for HTML5 Canvas
  useEffect(() => {
    let animId: number;

    const renderLoop = () => {
      if (canvasRef.current) {
        drawStudioFrame({
          canvas: canvasRef.current,
          hostVideo: hostVideoRef.current,
          guestVideo: guestVideoRef.current,
          mediaVideo: mediaVideoRef?.current || null,
          mediaTitle: mediaTitle || 'REACTION MEDIA',
          layout,
          hostFilters,
          guestFilters,
          hostName,
          guestName,
          branding,
          isRecording,
          recordingTimeSeconds,
          hostActiveLevel: hostVuLevel,
          guestActiveLevel: guestVuLevel,
        });
      }
      animId = requestAnimationFrame(renderLoop);
    };

    animId = requestAnimationFrame(renderLoop);
    return () => {
      cancelAnimationFrame(animId);
    };
  }, [
    canvasRef,
    hostVideoRef,
    guestVideoRef,
    mediaVideoRef,
    mediaTitle,
    layout,
    hostFilters,
    guestFilters,
    hostName,
    guestName,
    branding,
    isRecording,
    recordingTimeSeconds,
    hostVuLevel,
    guestVuLevel,
  ]);

  return (
    <div
      ref={containerRef}
      className="flex flex-col bg-slate-900/90 rounded-2xl border border-slate-800 shadow-2xl overflow-hidden relative"
    >
      {/* Top Monitor Bar with Layout Switchers and Badges */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-950 border-b border-slate-800/80">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)] animate-pulse" />
            <span className="text-xs font-bold tracking-wider text-slate-200 uppercase font-mono">
              PROGRAM OUT
            </span>
          </div>
          <span className="text-[11px] font-mono text-slate-400 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
            1080p FHD • 30 FPS
          </span>
          {isIframeEmbedded ? (
            <span className="text-[10px] font-mono font-bold bg-purple-950 text-purple-300 border border-purple-700/80 px-2.5 py-0.5 rounded-full uppercase flex items-center gap-1.5 animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
              {mediaState?.type === 'youtube'
                ? 'YouTube Live Reaction'
                : mediaState?.type === 'facebook'
                ? 'Facebook Live Stream'
                : 'Web Embed Commentary'}
            </span>
          ) : isMediaActive ? (
            <span className="text-[10px] font-mono font-bold bg-purple-950 text-purple-300 border border-purple-800/70 px-2 py-0.5 rounded-full uppercase">
              Reaction Mode Ready
            </span>
          ) : null}
        </div>

        {/* Layout Mode Switchers */}
        <div className="flex flex-wrap items-center gap-1.5 bg-slate-900 p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => setLayout('side-by-side')}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
              layout === 'side-by-side'
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
            title="Side-by-Side (50/50 split screen)"
          >
            <Columns2 className="w-3.5 h-3.5" />
            Split
          </button>

          <button
            onClick={() => setLayout('pip')}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
              layout === 'pip'
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
            title="Picture-in-Picture (PiP)"
          >
            <Tv className="w-3.5 h-3.5" />
            PiP
          </button>

          <button
            onClick={() => setLayout('solo-host')}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
              layout === 'solo-host'
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
            title="Solo Host focus"
          >
            <User className="w-3.5 h-3.5" />
            Host Solo
          </button>

          {/* Reaction Split & Reaction PiP layout buttons */}
          <button
            onClick={() => setLayout('reaction-split')}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
              layout === 'reaction-split'
                ? 'bg-purple-600 text-white shadow-md'
                : 'text-purple-300 hover:text-white hover:bg-purple-950/60'
            }`}
            title="Reaction Split: Media (70%) on left, Host webcam (30%) on right"
          >
            <Columns2 className="w-3.5 h-3.5 text-purple-400" />
            Reaction 70/30
          </button>

          <button
            onClick={() => setLayout('reaction-pip')}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
              layout === 'reaction-pip'
                ? 'bg-purple-600 text-white shadow-md'
                : 'text-purple-300 hover:text-white hover:bg-purple-950/60'
            }`}
            title="Reaction PiP: Media full screen with Host webcam pinned in corner"
          >
            <Tv className="w-3.5 h-3.5 text-purple-400" />
            Reaction PiP
          </button>

          <button
            onClick={() => setLayout('solo-guest')}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
              layout === 'solo-guest'
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
            title="Solo Guest focus"
          >
            <Users className="w-3.5 h-3.5" />
            Guest
          </button>
        </div>

        {/* Lower Thirds & Camera Orientation Toggles */}
        <div className="flex flex-wrap items-center gap-2">
          {onToggleHostMirror && (
            <button
              onClick={onToggleHostMirror}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border flex items-center gap-1.5 transition-all cursor-pointer ${
                hostFilters.mirror
                  ? 'bg-blue-600 text-white border-blue-400 shadow-md shadow-blue-600/30'
                  : 'bg-slate-900 text-slate-300 border-slate-800 hover:text-white hover:bg-slate-800'
              }`}
              title="Flip Host camera horizontally (matches real-life mirror orientation)"
            >
              <FlipHorizontal className="w-3.5 h-3.5" />
              <span>Flip Host</span>
              <span
                className={`text-[10px] font-mono px-1 py-0.2 rounded font-bold ${
                  hostFilters.mirror ? 'bg-blue-900/80 text-blue-200' : 'bg-slate-800 text-slate-400'
                }`}
              >
                {hostFilters.mirror ? 'ON' : 'OFF'}
              </span>
            </button>
          )}

          {onToggleGuestMirror && (
            <button
              onClick={onToggleGuestMirror}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border flex items-center gap-1.5 transition-all cursor-pointer ${
                guestFilters.mirror
                  ? 'bg-purple-600 text-white border-purple-400 shadow-md shadow-purple-600/30'
                  : 'bg-slate-900 text-slate-300 border-slate-800 hover:text-white hover:bg-slate-800'
              }`}
              title="Flip Guest camera horizontally (matches real-life mirror orientation)"
            >
              <FlipHorizontal className="w-3.5 h-3.5" />
              <span>Flip Guest</span>
              <span
                className={`text-[10px] font-mono px-1 py-0.2 rounded font-bold ${
                  guestFilters.mirror ? 'bg-purple-900/80 text-purple-200' : 'bg-slate-800 text-slate-400'
                }`}
              >
                {guestFilters.mirror ? 'ON' : 'OFF'}
              </span>
            </button>
          )}

          <button
            onClick={() => setShowBrandingEditor(!showBrandingEditor)}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border flex items-center gap-1.5 transition-colors cursor-pointer ${
              showBrandingEditor
                ? 'bg-slate-800 text-white border-blue-500/50'
                : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800'
            }`}
          >
            <Settings2 className="w-3.5 h-3.5 text-blue-400" />
            Lower Thirds
          </button>
        </div>
      </div>

      {/* Optional Lower Thirds Editor Dropdown */}
      {showBrandingEditor && (
        <div className="p-3 bg-slate-950/95 border-b border-slate-800 grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
          <div>
            <label className="text-[11px] font-semibold text-slate-400 block mb-1">
              Podcast Show Name
            </label>
            <input
              type="text"
              value={branding.podcastName}
              onChange={(e) => setBranding((prev) => ({ ...prev, podcastName: e.target.value }))}
              className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-white focus:border-blue-500 outline-none"
            />
          </div>

          <div className="md:col-span-2">
            <label className="text-[11px] font-semibold text-slate-400 block mb-1">
              Episode Title (Lower-Third Banner)
            </label>
            <input
              type="text"
              value={branding.episodeTitle}
              onChange={(e) => setBranding((prev) => ({ ...prev, episodeTitle: e.target.value }))}
              className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-white focus:border-blue-500 outline-none"
            />
          </div>

          <div className="flex items-end justify-between pb-1">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={branding.showLowerThird}
                onChange={(e) => setBranding((prev) => ({ ...prev, showLowerThird: e.target.checked }))}
                className="rounded bg-slate-900 border-slate-700 text-blue-600 focus:ring-0"
              />
              <span className="text-slate-300 font-medium">Show Banner on Stream</span>
            </label>
          </div>
        </div>
      )}

      {/* Main Broadcast Viewport (16:9) */}
      <div className="relative w-full aspect-video bg-black flex items-center justify-center overflow-hidden">
        {/* Background Canvas: Always kept mounted so canvasRef is always valid */}
        <canvas
          ref={canvasRef}
          width={1920}
          height={1080}
          className={`w-full h-full object-contain ${
            isIframeEmbedded ? 'opacity-0 pointer-events-none absolute inset-0' : 'block shadow-inner cursor-default'
          }`}
        />

        {/* Embedded URL Mode: Responsive Iframe with Picture-in-Picture Host Webcam & Floating Controls */}
        {isIframeEmbedded && (
          <div className="absolute inset-0 w-full h-full bg-[#080a10] flex flex-col z-10 select-none">
            {/* Top Bar on Viewport */}
            <div className="absolute top-3 left-4 right-4 z-30 flex items-center justify-between pointer-events-none">
              {/* Show Header & Media Title */}
              <div className="flex items-center gap-2 bg-slate-950/85 backdrop-blur-md px-3.5 py-1.5 rounded-full border border-slate-800/80 shadow-lg pointer-events-auto">
                <span className="w-2.5 h-2.5 rounded-full bg-purple-500 animate-pulse" />
                <span className="text-xs font-bold text-white tracking-wide truncate max-w-xs md:max-w-md">
                  {mediaState?.title || 'External Video Stream'}
                </span>
                <span className="text-[10px] font-mono text-purple-300 bg-purple-950/80 border border-purple-800/60 px-2 py-0.5 rounded-full">
                  {mediaState?.type === 'youtube'
                    ? 'YouTube'
                    : mediaState?.type === 'facebook'
                    ? 'Facebook'
                    : 'Web Embed'}
                </span>
              </div>

              {/* Recording indicator & Live Audio status */}
              <div className="flex items-center gap-2 pointer-events-auto">
                {isRecording ? (
                  <div className="flex items-center gap-2 bg-red-950/90 border border-red-700/80 text-red-200 px-3 py-1.5 rounded-full text-xs font-mono font-bold shadow-lg shadow-red-950/40">
                    <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
                    REC {timecode}
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 bg-slate-950/80 backdrop-blur-md border border-slate-800 text-slate-300 px-3 py-1.5 rounded-full text-xs font-mono">
                    <Radio className="w-3 h-3 text-purple-400" />
                    Ready to Record
                  </div>
                )}
              </div>
            </div>

            {/* Main Content Area: Split 70/30 or Fullscreen with Corner PiP */}
            {layout === 'reaction-split' ? (
              /* Reaction Split Mode (70% Media Video on Left, 30% Host Webcam on Right) */
              <div className="w-full h-full flex p-3 pt-14 gap-3 bg-gradient-to-b from-slate-950/40 to-slate-950/90">
                {/* 70% Left: Embedded Video Iframe */}
                <div className="w-[70%] h-full rounded-xl overflow-hidden border border-slate-800 bg-black relative shadow-2xl">
                  <iframe
                    ref={iframeRef}
                    src={mediaState?.embedUrl}
                    title={mediaState?.title || 'Embedded Media'}
                    className="w-full h-full border-none"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                  />
                </div>

                {/* 30% Right: Host Webcam Rack */}
                <div
                  className={`w-[30%] h-full rounded-xl overflow-hidden border-2 flex flex-col relative transition-all duration-300 ${
                    hostVuLevel > 0.08
                      ? 'border-purple-500 shadow-[0_0_25px_rgba(168,85,247,0.4)]'
                      : 'border-slate-800 bg-slate-950 shadow-xl'
                  }`}
                >
                  <video
                    ref={pipVideoRef}
                    autoPlay
                    playsInline
                    muted
                    style={{
                      filter: getCssFilterString(hostFilters),
                      transform: hostFilters.mirror ? 'scaleX(-1)' : 'scaleX(1)',
                    }}
                    className="w-full h-full object-cover"
                  />

                  {/* Host Nameplate */}
                  <div className="absolute bottom-3 left-3 right-3 bg-slate-950/90 backdrop-blur border border-slate-800 px-3 py-2 rounded-lg flex items-center justify-between shadow-xl">
                    <div className="flex items-center gap-2 truncate">
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          hostVuLevel > 0.08 ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'
                        }`}
                      />
                      <span className="text-white text-xs font-bold truncate">{hostName}</span>
                    </div>
                    <span className="text-[10px] font-mono font-bold text-purple-400 bg-purple-950/80 px-2 py-0.5 rounded border border-purple-800/60 uppercase">
                      HOST
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              /* Reaction PiP Mode (Full-Bleed Media with Host Webcam pinned in bottom-right corner) */
              <div className="w-full h-full relative">
                {/* Fullscreen Video Iframe */}
                <iframe
                  ref={iframeRef}
                  src={mediaState?.embedUrl}
                  title={mediaState?.title || 'Embedded Media'}
                  className="w-full h-full border-none"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                />

                {/* Floating Corner Picture-in-Picture Webcam */}
                <div
                  className={`absolute bottom-5 right-5 w-64 md:w-80 aspect-video rounded-2xl overflow-hidden border-2 shadow-2xl transition-all duration-300 z-20 group ${
                    hostVuLevel > 0.08
                      ? 'border-purple-400 shadow-[0_0_30px_rgba(168,85,247,0.6)]'
                      : 'border-purple-500/80 shadow-[0_12px_40px_rgba(0,0,0,0.85)]'
                  }`}
                >
                  <video
                    ref={pipVideoRef}
                    autoPlay
                    playsInline
                    muted
                    style={{
                      filter: getCssFilterString(hostFilters),
                      transform: hostFilters.mirror ? 'scaleX(-1)' : 'scaleX(1)',
                    }}
                    className="w-full h-full object-cover"
                  />

                  {/* Gradient vignette */}
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent pointer-events-none" />

                  {/* Name Badge */}
                  <div className="absolute bottom-2.5 left-2.5 right-2.5 flex items-center justify-between bg-slate-950/85 backdrop-blur-md px-2.5 py-1.5 rounded-lg border border-slate-800/80">
                    <div className="flex items-center gap-1.5 truncate">
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          hostVuLevel > 0.08 ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'
                        }`}
                      />
                      <span className="text-white text-xs font-bold truncate">{hostName}</span>
                    </div>
                    <span className="text-[9px] font-mono font-bold text-purple-300 bg-purple-950/90 px-1.5 py-0.5 rounded border border-purple-800/60 uppercase">
                      HOST
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Lower-Third Branding Banner when enabled */}
            {branding.showLowerThird && (
              <div className="absolute bottom-20 left-6 z-20 bg-slate-950/90 backdrop-blur-md border border-slate-800 rounded-xl px-4 py-2.5 shadow-2xl max-w-lg pointer-events-none">
                <div className="text-[10px] font-mono font-bold text-purple-400 uppercase tracking-widest mb-0.5">
                  {branding.podcastName}
                </div>
                <div className="text-white text-sm font-bold truncate">
                  {branding.episodeTitle}
                </div>
              </div>
            )}

            {/* Floating Glassmorphic Playback Controls Bar */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 bg-slate-950/90 backdrop-blur-md border border-slate-800 px-4 py-2 rounded-2xl shadow-2xl">
              {/* Play / Pause button */}
              <button
                onClick={handlePlayPauseClick}
                className="w-9 h-9 rounded-xl bg-purple-600 hover:bg-purple-500 text-white flex items-center justify-center transition-all cursor-pointer shadow-md shadow-purple-600/30"
                title={mediaState?.isPlaying ? 'Pause Embedded Video' : 'Play Embedded Video'}
              >
                {mediaState?.isPlaying ? (
                  <Pause className="w-4 h-4 fill-white" />
                ) : (
                  <Play className="w-4 h-4 fill-white ml-0.5" />
                )}
              </button>

              {/* Volume Slider & Mute Toggle */}
              <div className="flex items-center gap-2 pl-2 border-l border-slate-800">
                <button
                  onClick={handleMuteToggleClick}
                  className="text-slate-400 hover:text-white transition-colors cursor-pointer"
                  title={mediaState?.muted ? 'Unmute' : 'Mute'}
                >
                  {mediaState?.muted || (mediaState?.volume ?? 0.8) === 0 ? (
                    <VolumeX className="w-4 h-4 text-red-400" />
                  ) : (
                    <Volume2 className="w-4 h-4 text-slate-300" />
                  )}
                </button>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={mediaState?.muted ? 0 : (mediaState?.volume ?? 0.85)}
                  onChange={(e) => handleVolumeSlider(parseFloat(e.target.value))}
                  className="w-20 md:w-28 accent-purple-500 cursor-pointer"
                  title="Embedded Video Volume"
                />
              </div>

              {/* Layout Mode Toggle between PiP and 70/30 Split */}
              <div className="flex items-center gap-1 pl-2 border-l border-slate-800">
                <button
                  onClick={() => setLayout(layout === 'reaction-pip' ? 'reaction-split' : 'reaction-pip')}
                  className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
                  title="Toggle between Reaction PiP and 70/30 Split"
                >
                  {layout === 'reaction-pip' ? (
                    <>
                      <Columns2 className="w-3.5 h-3.5 text-purple-400" />
                      <span>70/30 Split</span>
                    </>
                  ) : (
                    <>
                      <Tv className="w-3.5 h-3.5 text-purple-400" />
                      <span>Corner PiP</span>
                    </>
                  )}
                </button>
              </div>

              {/* External Link */}
              {mediaState?.rawUrl && (
                <a
                  href={mediaState.rawUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="p-2 text-slate-400 hover:text-white transition-colors cursor-pointer"
                  title="Open source URL in new tab"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}

              {/* Close / Eject Video button */}
              {onEjectMedia && (
                <button
                  onClick={onEjectMedia}
                  className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-950/40 rounded-xl transition-all cursor-pointer ml-1"
                  title="Close and Eject External Video"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Floating Quick Action Overlays for normal layouts */}
        {!isIframeEmbedded && layout === 'side-by-side' && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 pointer-events-none">
            <span className="bg-slate-950/80 backdrop-blur border border-slate-800 text-slate-300 px-3 py-1 rounded-full text-[11px] font-mono tracking-wider flex items-center gap-1.5 shadow-lg">
              <Columns2 className="w-3 h-3 text-blue-400" />
              DUAL BROADCAST 50/50
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
