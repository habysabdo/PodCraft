import React from 'react';

interface VUMeterProps {
  label: string;
  level: number; // 0.0 to 1.0 (normalized log level)
  db: number;    // -60 to 0 dB
  peak: number;  // 0.0 to 1.0 peak
  isClipping: boolean;
  muted?: boolean;
}

export const VUMeter: React.FC<VUMeterProps> = ({
  label,
  level,
  db,
  peak,
  isClipping,
  muted = false,
}) => {
  const totalSegments = 24;
  // Calculate how many segments are active
  const activeCount = muted ? 0 : Math.round(level * totalSegments);
  const peakSegmentIndex = muted ? -1 : Math.min(totalSegments - 1, Math.round(peak * totalSegments));

  return (
    <div className="flex flex-col gap-1 w-full bg-slate-900/80 p-2.5 rounded-lg border border-slate-800">
      {/* Header with channel label, numerical dB, and clip badge */}
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-slate-300 tracking-wide uppercase text-[11px] flex items-center gap-1.5">
          <span
            className={`w-2 h-2 rounded-full ${
              muted
                ? 'bg-slate-600'
                : level > 0.05
                ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]'
                : 'bg-slate-600'
            }`}
          />
          {label}
        </span>
        <div className="flex items-center gap-2 font-mono">
          <span
            className={`text-[11px] font-bold ${
              muted
                ? 'text-slate-500'
                : db > -3
                ? 'text-red-400 font-extrabold'
                : db > -12
                ? 'text-amber-300'
                : 'text-slate-400'
            }`}
          >
            {muted ? 'MUTED' : `${db.toFixed(1)} dB`}
          </span>

          {/* CLIP indicator LED */}
          <div
            className={`px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider transition-colors ${
              isClipping
                ? 'bg-red-600 text-white shadow-[0_0_10px_rgba(239,68,68,0.9)] animate-pulse'
                : 'bg-slate-800 text-slate-600'
            }`}
          >
            CLIP
          </div>
        </div>
      </div>

      {/* 24-Segment LED Bar */}
      <div className="flex items-center gap-[2px] h-3.5 bg-slate-950 p-[2px] rounded border border-slate-800/80 overflow-hidden">
        {Array.from({ length: totalSegments }).map((_, idx) => {
          const isActive = idx < activeCount;
          const isPeakHold = idx === peakSegmentIndex;

          // Color classification:
          // 0 to 15 (0-66%): Green (-60 to -18 dB)
          // 16 to 20 (67-85%): Amber/Yellow (-18 to -3 dB)
          // 21 to 23 (86-100%): Red (-3 to 0 dB)
          let activeColor = 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.7)]';
          let inactiveColor = 'bg-emerald-950/40';

          if (idx >= 21) {
            activeColor = 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.8)]';
            inactiveColor = 'bg-red-950/40';
          } else if (idx >= 16) {
            activeColor = 'bg-amber-400 shadow-[0_0_6px_rgba(245,158,11,0.7)]';
            inactiveColor = 'bg-amber-950/40';
          }

          return (
            <div
              key={idx}
              className={`flex-1 h-full rounded-[1px] transition-all duration-75 relative ${
                isActive ? activeColor : inactiveColor
              }`}
            >
              {isPeakHold && !isActive && (
                <div
                  className={`absolute inset-0 rounded-[1px] ${
                    idx >= 21 ? 'bg-red-400' : idx >= 16 ? 'bg-amber-300' : 'bg-emerald-300'
                  } opacity-90`}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Scale tick labels */}
      <div className="flex justify-between text-[9px] text-slate-500 font-mono px-0.5 select-none">
        <span>-60</span>
        <span>-36</span>
        <span>-24</span>
        <span className="text-amber-500/80">-12</span>
        <span className="text-amber-400">-6</span>
        <span className="text-red-400">-3</span>
        <span className="text-red-500 font-bold">0</span>
      </div>
    </div>
  );
};
