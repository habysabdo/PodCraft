import React, { useRef, useEffect } from 'react';
import {
  Columns2,
  Tv,
  User,
  Settings2,
  FlipHorizontal,
  Play,
  Pause,
  Volume2,
  VolumeX,
  X,
  Radio,
  ExternalLink,
  Video,
  VideoOff,
} from 'lucide-react';
import { LayoutMode, StudioBranding, VideoFilterSettings, ReactionMediaState } from '../types/studio';
import { drawStudioFrame, getCssFilterString } from '../utils/canvasCompositor';

interface BroadcastCanvasViewProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  hostVideoRef: React.RefObject<HTMLVideoElement | null>;
  mediaVideoRef?: React.RefObject<HTMLVideoElement | null>;
  screenVideoRef?: React.RefObject<HTMLVideoElement | null>;
  screenStream?: MediaStream | null;
  mediaTitle?: string;
  mediaState?: ReactionMediaState;
  isMediaActive?: boolean;
  layout: LayoutMode;
  setLayout: (layout: LayoutMode) => void;
  hostFilters: VideoFilterSettings;
  hostName: string;
  branding: StudioBranding;
  setBranding: React.Dispatch<React.SetStateAction<StudioBranding>>;
  isRecording: boolean;
  recordingTimeSeconds: number;
  hostVuLevel: number;
  onToggleHostMirror?: () => void;
  onTogglePlayPause?: () => void;
  onVolumeChange?: (vol: number) => void;
  onToggleMute?: () => void;
  onEjectMedia?: () => void;
  hostStream?: MediaStream | null;
  isCameraOn?: boolean;
  onToggleCamera?: () => void;
}

export const BroadcastCanvasView: React.FC<BroadcastCanvasViewProps> = ({
  canvasRef,
  hostVideoRef,
  mediaVideoRef,
  screenVideoRef,
  screenStream,
  mediaTitle,
  mediaState,
  isMediaActive = false,
  layout,
  setLayout,
  hostFilters,
  hostName,
  branding,
  setBranding,
  isRecording,
  recordingTimeSeconds,
  hostVuLevel,
  onToggleHostMirror,
  onTogglePlayPause,
  onVolumeChange,
  onToggleMute,
  onEjectMedia,
  hostStream,
  isCameraOn = false,
  onToggleCamera,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [showBrandingEditor, setShowBrandingEditor] = React.useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const pipVideoRef = useRef<HTMLVideoElement | null>(null);

  // Fade-through-black transition state when switching broadcast layouts
  const [displayedLayout, setDisplayedLayout] = React.useState<LayoutMode>(layout);
  const displayedLayoutRef = useRef<LayoutMode>(layout);
  const [isFadingToBlack, setIsFadingToBlack] = React.useState(false);
  const transitionRef = useRef({
    active: false,
    startTime: 0,
    durationOut: 140,
    durationHold: 30,
    durationIn: 160,
  });

  useEffect(() => {
    if (layout === displayedLayoutRef.current) return;

    transitionRef.current = {
      active: true,
      startTime: performance.now(),
      durationOut: 140,
      durationHold: 30,
      durationIn: 160,
    };
    setIsFadingToBlack(true);

    const swapTimer = window.setTimeout(() => {
      displayedLayoutRef.current = layout;
      setDisplayedLayout(layout);
      setIsFadingToBlack(false);
    }, 155);

    return () => {
      window.clearTimeout(swapTimer);
    };
  }, [layout]);

  const isIframeEmbedded =
    Boolean(mediaState?.embedUrl) &&
    (mediaState?.type === 'youtube' ||
      mediaState?.type === 'facebook' ||
      mediaState?.type === 'web-embed');

  const showIframeStage = isIframeEmbedded && displayedLayout !== 'solo-host';

  // Sync Host video stream into PiP overlay video element when iframe stage is visible
  useEffect(() => {
    if (!showIframeStage || !pipVideoRef.current) return;

    if (hostStream) {
      pipVideoRef.current.srcObject = hostStream;
      pipVideoRef.current.play().catch(() => {});
    } else {
      pipVideoRef.current.pause();
      pipVideoRef.current.srcObject = null;
    }
  }, [showIframeStage, hostStream, displayedLayout]);

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
        let fadeBlackAlpha = 0;
        const tr = transitionRef.current;
        if (tr.active) {
          const elapsed = performance.now() - tr.startTime;
          const total = tr.durationOut + tr.durationHold + tr.durationIn;
          if (elapsed < tr.durationOut) {
            fadeBlackAlpha = Math.min(1, elapsed / tr.durationOut);
          } else if (elapsed < tr.durationOut + tr.durationHold) {
            fadeBlackAlpha = 1;
          } else if (elapsed < total) {
            fadeBlackAlpha = Math.max(
              0,
              1 - (elapsed - tr.durationOut - tr.durationHold) / tr.durationIn
            );
          } else {
            tr.active = false;
            fadeBlackAlpha = 0;
          }
        }

        const screenVideo = screenVideoRef?.current || null;
        const activeMediaVideo =
          screenStream && screenVideo && screenVideo.readyState >= 2
            ? screenVideo
            : screenStream
            ? null
            : mediaVideoRef?.current || null;

        drawStudioFrame({
          canvas: canvasRef.current,
          hostVideo: hostVideoRef.current,
          mediaVideo: activeMediaVideo,
          mediaTitle: mediaTitle || 'REACTION MEDIA',
          layout: displayedLayoutRef.current,
          hostFilters,
          hostName,
          branding,
          isRecording,
          recordingTimeSeconds,
          hostActiveLevel: hostVuLevel,
          fadeBlackAlpha: isIframeEmbedded ? 0 : fadeBlackAlpha,
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
    mediaVideoRef,
    screenVideoRef,
    screenStream,
    mediaTitle,
    hostFilters,
    hostName,
    branding,
    isRecording,
    recordingTimeSeconds,
    hostVuLevel,
    isIframeEmbedded,
  ]);

  return (
    <div
      ref={containerRef}
      className="flex flex-col bg-slate-900/90 rounded-2xl border border-slate-800 shadow-2xl overflow-hidden relative"
    >
      {/* Top Monitor Bar with Layout Switchers */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-slate-950 border-b border-slate-800/80">
        <div className="flex items-center gap-3 text-xs text-slate-300">
          <span className="font-bold tracking-wider text-slate-100 uppercase font-mono">
            Program Out
          </span>
          <span className="text-slate-600">·</span>
          <span className="font-mono text-slate-400 tabular-nums">
            1080p FHD · 30 FPS
          </span>
          {isMediaActive && (
            <>
              <span className="text-slate-600">·</span>
              <span className="font-mono font-semibold text-purple-300">
                {isIframeEmbedded
                  ? mediaState?.type === 'youtube'
                    ? 'YouTube Reaction'
                    : mediaState?.type === 'facebook'
                    ? 'Facebook Reaction'
                    : 'Web Embed Reaction'
                  : 'Dual-View Reaction Ready'}
              </span>
            </>
          )}
        </div>

        {/* Single-Host & Audience Dual-View Layout Switchers */}
        <div className="flex flex-wrap items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800">
          <button
            type="button"
            onClick={() => setLayout('solo-host')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
              layout === 'solo-host'
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
            title="Single-Host Camera (Full Screen)"
          >
            <User className="w-3.5 h-3.5" />
            Host Solo
          </button>

          <button
            type="button"
            onClick={() => setLayout('reaction-split')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
              layout === 'reaction-split'
                ? 'bg-purple-600 text-white shadow-md'
                : 'text-purple-300 hover:text-white hover:bg-purple-950/60'
            }`}
            title="Reaction Split: Added video (70%) on left, your webcam (30%) on right"
          >
            <Columns2 className="w-3.5 h-3.5 text-purple-300" />
            Reaction Split (70/30)
          </button>

          <button
            type="button"
            onClick={() => setLayout('reaction-pip')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
              layout === 'reaction-pip'
                ? 'bg-purple-600 text-white shadow-md'
                : 'text-purple-300 hover:text-white hover:bg-purple-950/60'
            }`}
            title="Reaction PiP: Added video full screen with your webcam framed in bottom-right corner"
          >
            <Tv className="w-3.5 h-3.5 text-purple-300" />
            Reaction PiP
          </button>
        </div>

        {/* Camera Toggle, Lower Thirds & Orientation */}
        <div className="flex flex-wrap items-center gap-2">
          {onToggleCamera && (
            <button
              type="button"
              onClick={onToggleCamera}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
                isCameraOn
                  ? 'bg-emerald-600/20 text-emerald-300 border-emerald-500/50 hover:bg-emerald-600/30'
                  : 'bg-red-950/60 text-red-300 border-red-700/60 hover:bg-red-900/60'
              }`}
              title={isCameraOn ? 'Turn Camera Off & Release Hardware' : 'Turn Camera On'}
            >
              {isCameraOn ? (
                <>
                  <Video className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Camera On</span>
                </>
              ) : (
                <>
                  <VideoOff className="w-3.5 h-3.5 text-red-400" />
                  <span>Camera Off</span>
                </>
              )}
            </button>
          )}

          {onToggleHostMirror && (
            <button
              type="button"
              onClick={onToggleHostMirror}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
                hostFilters.mirror
                  ? 'bg-blue-600 text-white border-blue-400 shadow-md shadow-blue-600/30'
                  : 'bg-slate-900 text-slate-300 border-slate-800 hover:text-white hover:bg-slate-800'
              }`}
              title="Toggle horizontal camera flip (Default is natural un-mirrored orientation)"
            >
              <FlipHorizontal className="w-3.5 h-3.5" />
              <span>{hostFilters.mirror ? 'Mirrored' : 'Natural Cam'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowBrandingEditor(!showBrandingEditor)}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
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
              Show Name
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
            showIframeStage ? 'opacity-0 pointer-events-none absolute inset-0' : 'block shadow-inner cursor-default'
          }`}
        />

        {/* Embedded URL Mode: Responsive Iframe with Picture-in-Picture Host Webcam & Floating Controls */}
        {showIframeStage && (
          <div className="absolute inset-0 w-full h-full bg-[#080a10] flex flex-col z-10 select-none">
            {/* Top Bar on Viewport */}
            <div className="absolute top-3 left-4 right-4 z-30 flex items-center justify-between pointer-events-none">
              <div className="flex items-center gap-2 bg-slate-950/85 backdrop-blur-md px-3.5 py-1.5 rounded-full border border-slate-800/80 shadow-lg pointer-events-auto">
                <span className="text-xs font-bold text-white tracking-wide truncate max-w-xs md:max-w-md">
                  {mediaState?.title || 'External Video Stream'}
                </span>
                <span className="text-[10px] font-mono text-purple-300">
                  {mediaState?.type === 'youtube'
                    ? 'YouTube'
                    : mediaState?.type === 'facebook'
                    ? 'Facebook'
                    : 'Web Embed'}
                </span>
              </div>

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
            {displayedLayout === 'reaction-split' ? (
              <div className="w-full h-full flex p-3 pt-14 gap-3 bg-gradient-to-b from-slate-950/40 to-slate-950/90">
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
                    className={`w-full h-full object-cover ${isCameraOn ? 'opacity-100' : 'opacity-0'}`}
                  />
                  {!isCameraOn && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950 text-slate-400 gap-2">
                      <VideoOff className="w-8 h-8 text-slate-600" />
                      <span className="text-xs font-mono font-semibold uppercase tracking-wider">
                        Camera Off
                      </span>
                    </div>
                  )}

                  <div className="absolute bottom-3 left-3 right-3 bg-slate-950/90 backdrop-blur border border-slate-800 px-3 py-2 rounded-lg flex items-center justify-between shadow-xl">
                    <div className="flex items-center gap-2 truncate">
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          hostVuLevel > 0.08 ? 'bg-emerald-400' : 'bg-slate-600'
                        }`}
                      />
                      <span className="text-white text-xs font-bold truncate">{hostName}</span>
                    </div>
                    <span className="text-[10px] font-mono font-bold text-purple-400 uppercase">
                      HOST
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="w-full h-full relative">
                <iframe
                  ref={iframeRef}
                  src={mediaState?.embedUrl}
                  title={mediaState?.title || 'Embedded Media'}
                  className="w-full h-full border-none"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                />

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
                    className={`w-full h-full object-cover ${isCameraOn ? 'opacity-100' : 'opacity-0'}`}
                  />
                  {!isCameraOn && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950 text-slate-400 gap-1.5">
                      <VideoOff className="w-6 h-6 text-slate-600" />
                      <span className="text-[11px] font-mono font-semibold uppercase tracking-wider">
                        Camera Off
                      </span>
                    </div>
                  )}

                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent pointer-events-none" />

                  <div className="absolute bottom-2.5 left-2.5 right-2.5 flex items-center justify-between bg-slate-950/85 backdrop-blur-md px-2.5 py-1.5 rounded-lg border border-slate-800/80">
                    <div className="flex items-center gap-1.5 truncate">
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          hostVuLevel > 0.08 ? 'bg-emerald-400' : 'bg-slate-500'
                        }`}
                      />
                      <span className="text-white text-xs font-bold truncate">{hostName}</span>
                    </div>
                    <span className="text-[9px] font-mono font-bold text-purple-300 uppercase">
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
              <button
                type="button"
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

              <div className="flex items-center gap-2 pl-2 border-l border-slate-800">
                <button
                  type="button"
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

              <div className="flex items-center gap-1 pl-2 border-l border-slate-800">
                <button
                  type="button"
                  onClick={() => setLayout(layout === 'reaction-pip' ? 'reaction-split' : 'reaction-pip')}
                  className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap"
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

              {onEjectMedia && (
                <button
                  type="button"
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

        {/* Subtle fade-through-black scrim for iframe stage transitions */}
        {isIframeEmbedded && (
          <div
            aria-hidden="true"
            className={`absolute inset-0 bg-black pointer-events-none z-40 transition-opacity duration-150 ease-in-out ${
              isFadingToBlack ? 'opacity-100' : 'opacity-0'
            }`}
          />
        )}
      </div>
    </div>
  );
};
