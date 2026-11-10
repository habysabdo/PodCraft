import React, { useState } from 'react';
import {
  Circle,
  Square,
  Pause,
  Play,
  BookmarkPlus,
  Headphones,
  SlidersHorizontal,
  Volume2,
  Sparkles,
  FileText,
  Download,
} from 'lucide-react';
import { ChapterMarker } from '../types/studio';
import { VUMeter } from './VUMeter';

interface RecordingBarProps {
  isRecording: boolean;
  isPaused: boolean;
  recordingSeconds: number;
  onStartRecording: () => void;
  onPauseRecording: () => void;
  onResumeRecording: () => void;
  onStopRecording: () => void;
  onAddMarker: (label?: string) => void;
  chapterMarkers: ChapterMarker[];
  masterVuLevel: { rms: number; peak: number; db: number; isClipping: boolean };
  isMonitoring: boolean;
  onToggleMonitoring: () => void;
  onOpenShowNotesPrompt: () => void;
  onOpenReviewModal?: () => void;
  hasRecordedSession: boolean;
  transcriptCount: number;
}

export const RecordingBar: React.FC<RecordingBarProps> = ({
  isRecording,
  isPaused,
  recordingSeconds,
  onStartRecording,
  onPauseRecording,
  onResumeRecording,
  onStopRecording,
  onAddMarker,
  chapterMarkers,
  masterVuLevel,
  isMonitoring,
  onToggleMonitoring,
  onOpenShowNotesPrompt,
  onOpenReviewModal,
  hasRecordedSession,
  transcriptCount,
}) => {
  const [markerLabel, setMarkerLabel] = useState('');
  const [showMarkerInput, setShowMarkerInput] = useState(false);

  const formatTime = (totalSeconds: number) => {
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = Math.floor(totalSeconds % 60);
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const handleAddMarker = () => {
    onAddMarker(markerLabel.trim() || undefined);
    setMarkerLabel('');
    setShowMarkerInput(false);
  };

  return (
    <div className="bg-slate-900/95 border border-slate-800 rounded-2xl p-4 shadow-2xl backdrop-blur flex flex-col md:flex-row items-center justify-between gap-4">
      {/* Left: Recording Status & Big Timer */}
      <div className="flex items-center gap-4 w-full md:w-auto">
        <div className="flex items-center gap-3">
          <div
            className={`w-4 h-4 rounded-full transition-all ${
              isRecording && !isPaused
                ? 'bg-red-500 shadow-[0_0_14px_rgba(239,68,68,1)] animate-ping'
                : isPaused
                ? 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.8)]'
                : 'bg-slate-600'
            }`}
          />
          <div>
            <div className="flex items-center gap-2">
              <span
                className={`text-xs font-mono font-bold tracking-wider uppercase px-2 py-0.5 rounded ${
                  isRecording && !isPaused
                    ? 'bg-red-950/80 text-red-400 border border-red-800/80'
                    : isPaused
                    ? 'bg-amber-950/80 text-amber-300 border border-amber-800/80'
                    : 'bg-slate-800 text-slate-400'
                }`}
              >
                {isRecording && !isPaused ? '● ON AIR (REC)' : isPaused ? '⏸ PAUSED' : 'STANDBY'}
              </span>

              {chapterMarkers.length > 0 && (
                <span className="text-[11px] font-mono text-slate-400 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                  {chapterMarkers.length} {chapterMarkers.length === 1 ? 'Chapter' : 'Chapters'}
                </span>
              )}
            </div>

            <div className="text-3xl font-mono font-extrabold text-white tracking-wider mt-0.5 select-none">
              {formatTime(recordingSeconds)}
            </div>
          </div>
        </div>
      </div>

      {/* Center: Primary Broadcast Controls */}
      <div className="flex flex-wrap items-center justify-center gap-2.5 w-full md:w-auto">
        {!isRecording ? (
          <button
            onClick={onStartRecording}
            className="px-6 py-3 rounded-xl bg-red-600 hover:bg-red-500 active:scale-95 text-white font-bold text-sm flex items-center gap-2.5 shadow-[0_0_20px_rgba(239,68,68,0.4)] transition-all cursor-pointer"
          >
            <Circle className="w-5 h-5 fill-current" />
            Start Recording
          </button>
        ) : (
          <div className="flex items-center gap-2">
            {/* Pause / Resume */}
            {isPaused ? (
              <button
                onClick={onResumeRecording}
                className="px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs flex items-center gap-2 transition-all cursor-pointer"
              >
                <Play className="w-4 h-4 fill-current" />
                Resume
              </button>
            ) : (
              <button
                onClick={onPauseRecording}
                className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold text-xs flex items-center gap-2 transition-all cursor-pointer"
              >
                <Pause className="w-4 h-4 fill-current" />
                Pause
              </button>
            )}

            {/* Add Chapter Marker */}
            {showMarkerInput ? (
              <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-700 rounded-xl px-2 py-1">
                <input
                  type="text"
                  placeholder="Chapter title..."
                  value={markerLabel}
                  onChange={(e) => setMarkerLabel(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddMarker()}
                  autoFocus
                  className="bg-transparent text-xs text-white outline-none w-32"
                />
                <button
                  onClick={handleAddMarker}
                  className="px-2 py-1 bg-blue-600 text-white rounded text-[11px] font-bold"
                >
                  Save
                </button>
                <button
                  onClick={() => setShowMarkerInput(false)}
                  className="px-1 text-slate-400 hover:text-white text-xs"
                >
                  ✕
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowMarkerInput(true)}
                className="px-3 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-blue-400 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
                title="Stamp a timestamped chapter marker"
              >
                <BookmarkPlus className="w-4 h-4" />
                Mark Chapter
              </button>
            )}

            {/* Stop Recording */}
            <button
              onClick={onStopRecording}
              className="px-5 py-2.5 rounded-xl bg-red-950 hover:bg-red-900 text-red-200 border border-red-800 font-bold text-xs flex items-center gap-2 transition-all cursor-pointer shadow-lg"
            >
              <Square className="w-4 h-4 fill-current" />
              Stop & Export
            </button>
          </div>
        )}

        {/* Post-Recording Action Buttons: Save to Device & Gemini AI Show Notes */}
        {hasRecordedSession && (
          <div className="flex items-center gap-2">
            {onOpenReviewModal && (
              <button
                onClick={onOpenReviewModal}
                className="px-3.5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-2 shadow-[0_0_12px_rgba(16,185,129,0.4)] transition-all cursor-pointer"
                title="Review local recording and save to device"
              >
                <Download className="w-4 h-4" />
                Save to Device
              </button>
            )}

            <button
              onClick={onOpenShowNotesPrompt}
              className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 hover:brightness-110 text-white font-bold text-xs flex items-center gap-2 shadow-[0_0_15px_rgba(147,51,234,0.4)] transition-all cursor-pointer animate-pulse"
            >
              <Sparkles className="w-4 h-4" />
              AI Show Notes
            </button>
          </div>
        )}
      </div>

      {/* Right: Master Audio Meter & Headphones Monitor */}
      <div className="flex items-center gap-4 w-full md:w-80">
        <div className="flex-1">
          <VUMeter
            label="Master Mix"
            level={masterVuLevel.rms}
            db={masterVuLevel.db}
            peak={masterVuLevel.peak}
            isClipping={masterVuLevel.isClipping}
          />
        </div>

        {/* Headphones Monitor Button */}
        <button
          onClick={onToggleMonitoring}
          className={`p-3 rounded-xl border flex flex-col items-center justify-center gap-1 transition-all ${
            isMonitoring
              ? 'bg-blue-600 text-white border-blue-400 shadow-[0_0_12px_rgba(59,130,246,0.6)]'
              : 'bg-slate-950 text-slate-400 border-slate-800 hover:bg-slate-800 hover:text-slate-200'
          }`}
          title={
            isMonitoring
              ? 'Mute headphones monitor'
              : 'Listen to master studio mix through headphones (Caution: Use headphones to avoid feedback loop)'
          }
        >
          <Headphones className="w-4 h-4" />
          <span className="text-[9px] font-mono font-bold uppercase tracking-wider">
            {isMonitoring ? 'MON ON' : 'MONITOR'}
          </span>
        </button>
      </div>
    </div>
  );
};
