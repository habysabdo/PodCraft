import React, { useEffect, useRef } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  X,
  ScrollText,
  EyeOff,
  Gauge,
} from 'lucide-react';

export type TeleprompterFontSize = 'small' | 'medium' | 'large';

interface TeleprompterOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  script: string;
  onChangeScript: (next: string) => void;
  fontSize: TeleprompterFontSize;
  onChangeFontSize: (size: TeleprompterFontSize) => void;
  scrollSpeed: number;
  onChangeScrollSpeed: (speed: number) => void;
  isPlaying: boolean;
  onTogglePlay: () => void;
}

const FONT_SIZE_CLASSES: Record<TeleprompterFontSize, string> = {
  small: 'text-sm leading-relaxed',
  medium: 'text-lg leading-relaxed',
  large: 'text-2xl leading-snug',
};

export const TeleprompterOverlay: React.FC<TeleprompterOverlayProps> = ({
  isOpen,
  onClose,
  script,
  onChangeScript,
  fontSize,
  onChangeFontSize,
  scrollSpeed,
  onChangeScrollSpeed,
  isPlaying,
  onTogglePlay,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollFloatRef = useRef<number>(0);

  // Smooth requestAnimationFrame auto-scroll loop
  useEffect(() => {
    if (!isOpen || !isPlaying) return;

    let animId: number;
    let lastTime = performance.now();

    if (textareaRef.current) {
      scrollFloatRef.current = textareaRef.current.scrollTop;
    }

    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - lastTime) / 1000);
      lastTime = now;

      const el = textareaRef.current;
      if (el) {
        const maxScroll = el.scrollHeight - el.clientHeight;
        if (maxScroll > 0 && scrollFloatRef.current < maxScroll) {
          scrollFloatRef.current = Math.min(
            maxScroll,
            scrollFloatRef.current + scrollSpeed * dt
          );
          el.scrollTop = scrollFloatRef.current;
        } else if (maxScroll > 0 && scrollFloatRef.current >= maxScroll) {
          // Auto-pause when reaching the end of the script
          onTogglePlay();
          return;
        }
      }

      animId = requestAnimationFrame(tick);
    };

    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, [isOpen, isPlaying, scrollSpeed, onTogglePlay]);

  const handleManualScroll = () => {
    if (textareaRef.current) {
      scrollFloatRef.current = textareaRef.current.scrollTop;
    }
  };

  const handleResetScroll = () => {
    if (textareaRef.current) {
      textareaRef.current.scrollTop = 0;
      scrollFloatRef.current = 0;
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed top-[68px] left-1/2 -translate-x-1/2 z-50 w-[min(94vw,680px)] rounded-2xl bg-slate-950/75 backdrop-blur-md border border-slate-700/75 shadow-[0_20px_60px_rgba(0,0,0,0.75)] overflow-hidden select-none"
      role="region"
      aria-label="Teleprompter Script Overlay"
    >
      {/* Top Control Header positioned near webcam lens */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 bg-slate-900/80 border-b border-slate-800/80">
        <div className="flex items-center gap-2">
          <ScrollText className="w-4 h-4 text-sky-400 shrink-0" />
          <span className="text-xs font-bold text-white tracking-tight whitespace-nowrap">
            Teleprompter
          </span>
          <span className="text-[11px] text-emerald-300/90 flex items-center gap-1 whitespace-nowrap">
            <EyeOff className="w-3 h-3 text-emerald-400 shrink-0" />
            Hidden from Canvas Recording
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Font Size Segmented Control */}
          <div
            className="flex items-center bg-slate-950/90 p-0.5 rounded-lg border border-slate-800 text-[11px]"
            role="group"
            aria-label="Teleprompter font size"
          >
            {(['small', 'medium', 'large'] as TeleprompterFontSize[]).map((sz) => (
              <button
                key={sz}
                type="button"
                onClick={() => onChangeFontSize(sz)}
                className={`px-2 py-1 rounded-md font-semibold capitalize transition-colors cursor-pointer whitespace-nowrap ${
                  fontSize === sz
                    ? 'bg-sky-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {sz}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            title="Hide Teleprompter Overlay"
            aria-label="Close teleprompter"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Script Area with subtle eye-contact reading line */}
      <div className="relative">
        {/* Eye-contact focal guide band near top of script window */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-4 left-3 right-3 h-10 rounded-lg border border-sky-400/20 bg-sky-500/5"
        />

        <textarea
          ref={textareaRef}
          value={script}
          onChange={(e) => onChangeScript(e.target.value)}
          onScroll={handleManualScroll}
          placeholder="Paste or type your script here... Position this window near your webcam lens for natural eye contact. Only you can see this overlay — it is never drawn onto the recording canvas."
          className={`w-full h-44 md:h-48 px-5 py-4 bg-transparent text-white/95 placeholder-slate-400/70 outline-none resize-y font-sans ${FONT_SIZE_CLASSES[fontSize]} selection:bg-sky-500/40`}
          spellCheck={false}
        />
      </div>

      {/* Bottom Scroll Speed & Play/Pause Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2 bg-slate-900/80 border-t border-slate-800/80">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onTogglePlay}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
              isPlaying
                ? 'bg-amber-600 hover:bg-amber-500 text-white shadow-md shadow-amber-600/20'
                : 'bg-sky-600 hover:bg-sky-500 text-white shadow-md shadow-sky-600/20'
            }`}
          >
            {isPlaying ? (
              <>
                <Pause className="w-3.5 h-3.5 fill-current" />
                Pause Scroll
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" />
                Auto-Scroll
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleResetScroll}
            className="px-2.5 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap"
            title="Scroll back to top of script"
          >
            <RotateCcw className="w-3 h-3" />
            Top
          </button>
        </div>

        {/* Speed Slider */}
        <div className="flex items-center gap-2.5 flex-1 min-w-[180px] max-w-xs">
          <span className="text-[11px] font-medium text-slate-300 flex items-center gap-1 whitespace-nowrap">
            <Gauge className="w-3.5 h-3.5 text-sky-400" />
            Speed
          </span>
          <input
            type="range"
            min="8"
            max="120"
            step="2"
            value={scrollSpeed}
            onChange={(e) => onChangeScrollSpeed(parseInt(e.target.value, 10))}
            className="flex-1 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-sky-500"
            aria-label="Teleprompter auto-scroll speed"
          />
          <span className="text-[11px] font-mono tabular-nums text-slate-300 w-14 text-right">
            {scrollSpeed} px/s
          </span>
        </div>
      </div>
    </div>
  );
};
