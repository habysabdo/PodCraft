import React, { useState } from 'react';
import {
  Download,
  Sparkles,
  CheckCircle2,
  ShieldCheck,
  FileVideo,
  X,
  HardDrive,
  Lock,
} from 'lucide-react';

interface RecordingReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  videoUrl: string | null;
  videoBlob: Blob | null;
  durationSeconds: number;
  filename: string;
  onGenerateShowNotes: () => void;
}

export const RecordingReviewModal: React.FC<RecordingReviewModalProps> = ({
  isOpen,
  onClose,
  videoUrl,
  videoBlob,
  durationSeconds,
  filename,
  onGenerateShowNotes,
}) => {
  const [downloadSuccess, setDownloadSuccess] = useState(false);

  if (!isOpen || !videoUrl) return null;

  const fileSizeMb = videoBlob ? (videoBlob.size / (1024 * 1024)).toFixed(2) : '0';
  const mins = Math.floor(durationSeconds / 60);
  const secs = Math.floor(durationSeconds % 60);
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full shadow-2xl overflow-hidden flex flex-col">
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

        {/* Video Player Preview */}
        <div className="p-5 space-y-4">
          <div className="relative rounded-xl overflow-hidden border border-slate-800 bg-black aspect-video flex items-center justify-center shadow-inner">
            <video
              src={videoUrl}
              controls
              playsInline
              className="w-full h-full object-contain"
            />
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

          {/* Re-download confirmation toast */}
          {downloadSuccess && (
            <div className="flex items-center gap-2 p-2.5 bg-blue-950/80 border border-blue-800 rounded-xl text-xs text-blue-200 animate-in fade-in">
              <CheckCircle2 className="w-4 h-4 text-blue-400 shrink-0" />
              <span>Direct local download triggered: <strong>{filename}</strong></span>
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
            <span className="text-[11px] font-mono text-slate-500">
              Filename: {filename}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
