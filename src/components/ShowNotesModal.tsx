import React, { useState } from 'react';
import {
  Sparkles,
  Copy,
  Check,
  Download,
  Clock,
  BookOpen,
  Quote,
  Share2,
  X,
  RefreshCw,
  FileText,
  AlertCircle,
  Lightbulb,
} from 'lucide-react';
import { ChapterMarker, ShowNotesData } from '../types/studio';

interface ShowNotesModalProps {
  isOpen: boolean;
  onClose: () => void;
  podcastName: string;
  hostName: string;
  guestName?: string;
  durationSeconds: number;
  chapterMarkers: ChapterMarker[];
  transcript: string;
  /** Called with the generated notes so the studio can reuse the title +
   *  summary elsewhere (e.g. pre-fill the YouTube publish form). */
  onShowNotesGenerated?: (notes: ShowNotesData | null) => void;
}

export const ShowNotesModal: React.FC<ShowNotesModalProps> = ({
  isOpen,
  onClose,
  podcastName,
  hostName,
  guestName = '',
  durationSeconds,
  chapterMarkers,
  transcript,
  onShowNotesGenerated,
}) => {
  const [topic, setTopic] = useState('');
  const [editableTranscript, setEditableTranscript] = useState(transcript);
  const [isLoading, setIsLoading] = useState(false);
  const [notesData, setNotesData] = useState<ShowNotesData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  React.useEffect(() => {
    if (transcript && !editableTranscript) {
      setEditableTranscript(transcript);
    }
  }, [transcript]);

  if (!isOpen) return null;

  const handleGenerate = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/generate-show-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          podcastName,
          hostName,
          guestName,
          topic: topic.trim() || 'Modern Technology, Creative Workflows, and Industry Insights',
          duration: durationSeconds,
          transcript: editableTranscript,
          markers: chapterMarkers,
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Server error generating show notes');
      }

      setNotesData(result.data);
      onShowNotesGenerated?.(result.data);
    } catch (err: any) {
      console.error('Show notes generation failed:', err);
      setError(err?.message || 'Failed to generate show notes with Gemini');
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const getFullMarkdown = (): string => {
    if (!notesData) return '';

    const byline = guestName
      ? `*Show: ${podcastName} | Host: ${hostName} | Guest: ${guestName}*`
      : `*Show: ${podcastName} | Host: ${hostName}*`;

    return `# ${notesData.episodeTitle}
${byline}

## Summary
${notesData.summary}

## Key Discussion Points & Takeaways
${notesData.keyTakeaways.map((item) => `- ${item}`).join('\n')}

## Timestamps & Chapters
${notesData.timestamps.map((t) => `- **${t.time}** - ${t.title}: ${t.description}`).join('\n')}

## Memorable Quotes
${notesData.memorableQuotes.map((q) => `> "${q.quote}" — *${q.speaker}*`).join('\n\n')}

## Social Media Promo
### Twitter / X:
${notesData.socialPromo.twitterPost}

### LinkedIn:
${notesData.socialPromo.linkedinPost}
`;
  };

  const downloadMarkdownFile = () => {
    const md = getFullMarkdown();
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${notesData?.episodeTitle.replace(/[^a-zA-Z0-9_-]/g, '_') || 'show_notes'}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-4xl w-full max-h-[90vh] shadow-2xl overflow-hidden flex flex-col">
        {/* Modal Header */}
        <div className="flex items-center justify-between p-4 bg-slate-950 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-purple-600 to-indigo-600 flex items-center justify-center text-white shadow-md">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-white text-base flex items-center gap-2">
                Gemini AI Show Notes Generator
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-800">
                  gemini-3.8-flash
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                Transform broadcast recording and transcript into publication-ready show notes
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-5 overflow-y-auto space-y-6 flex-1">
          {error && (
            <div className="p-3.5 bg-red-950/60 border border-red-800 rounded-xl text-xs text-red-200 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-red-300">Generation Error</p>
                <p>{error}</p>
              </div>
            </div>
          )}

          {/* Configuration & Trigger Panel */}
          {!notesData && !isLoading && (
            <div className="space-y-4">
              <div className="p-4 bg-slate-950/80 rounded-xl border border-slate-800 space-y-3">
                <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <FileText className="w-4 h-4 text-blue-400" />
                  Episode Context & Inputs
                </h4>

                <div>
                  <label className="text-xs font-semibold text-slate-400 block mb-1">
                    Primary Topic or Reaction Focus (Optional custom cue)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Scaling Audio Studios, AI Production, Creator Economy..."
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-purple-500 outline-none"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold text-slate-400">
                      Live Transcript & Discussion Notes
                    </label>
                    <span className="text-[11px] text-slate-500 font-mono">
                      {editableTranscript ? `${editableTranscript.split('\n').length} entries` : 'No transcript recorded'}
                    </span>
                  </div>
                  <textarea
                    rows={6}
                    placeholder="Live speech transcript is automatically captured here during recording, or paste your talking points..."
                    value={editableTranscript}
                    onChange={(e) => setEditableTranscript(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-xs text-slate-200 font-mono focus:border-purple-500 outline-none resize-none leading-relaxed"
                  />
                </div>
              </div>

              <button
                onClick={handleGenerate}
                className="w-full py-3.5 px-6 rounded-xl bg-gradient-to-r from-purple-600 via-indigo-600 to-blue-600 hover:brightness-110 active:scale-[0.99] text-white font-bold text-sm flex items-center justify-center gap-2.5 shadow-xl shadow-purple-600/30 transition-all cursor-pointer"
              >
                <Sparkles className="w-5 h-5 text-purple-200" />
                Generate AI Show Notes with Gemini
              </button>
            </div>
          )}

          {/* Loading state */}
          {isLoading && (
            <div className="py-16 flex flex-col items-center justify-center gap-4 text-center">
              <div className="relative">
                <div className="w-16 h-16 rounded-full border-4 border-purple-500/20 border-t-purple-500 animate-spin" />
                <Sparkles className="w-6 h-6 text-purple-400 absolute inset-0 m-auto animate-pulse" />
              </div>
              <div className="space-y-1">
                <h4 className="text-base font-bold text-white">Gemini is listening & synthesizing...</h4>
                <p className="text-xs text-slate-400 max-w-sm">
                  Crafting high-retention episode titles, 3-sentence summary, key takeaways, and timestamped chapters.
                </p>
              </div>
            </div>
          )}

          {/* Generated Show Notes Display */}
          {notesData && (
            <div className="space-y-6 animate-in fade-in">
              {/* Action Toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-slate-950/90 rounded-xl border border-slate-800">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-xs font-bold text-slate-300">Generated with Gemini 3.8 Flash</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => copyToClipboard(getFullMarkdown(), 'full')}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    {copiedKey === 'full' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5 text-blue-400" />
                    )}
                    {copiedKey === 'full' ? 'Copied Full Markdown' : 'Copy All (MD)'}
                  </button>

                  <button
                    onClick={downloadMarkdownFile}
                    className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow-md"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download .md
                  </button>

                  <button
                    onClick={handleGenerate}
                    className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors cursor-pointer"
                    title="Regenerate"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* 1. Episode Titles */}
              <div className="p-4 bg-slate-950/70 rounded-xl border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-purple-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Lightbulb className="w-4 h-4" />
                    Episode Headline Title
                  </span>
                  <button
                    onClick={() => copyToClipboard(notesData.episodeTitle, 'title')}
                    className="text-xs text-slate-400 hover:text-white flex items-center gap-1"
                  >
                    {copiedKey === 'title' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    Copy
                  </button>
                </div>

                <h2 className="text-xl font-extrabold text-white leading-tight">
                  {notesData.episodeTitle}
                </h2>

                {notesData.alternativeTitles?.length > 0 && (
                  <div className="pt-2 border-t border-slate-800/80 space-y-1.5">
                    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                      Alternative Hook Variations:
                    </span>
                    <ul className="space-y-1 text-xs text-slate-300">
                      {notesData.alternativeTitles.map((alt, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="text-purple-400 font-mono font-bold">#{i + 1}</span>
                          <span>{alt}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* 2. 3-Sentence Summary */}
              <div className="p-4 bg-slate-950/70 rounded-xl border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-blue-400 uppercase tracking-wider flex items-center gap-1.5">
                    <BookOpen className="w-4 h-4" />
                    3-Sentence Summary
                  </span>
                  <button
                    onClick={() => copyToClipboard(notesData.summary, 'summary')}
                    className="text-xs text-slate-400 hover:text-white flex items-center gap-1"
                  >
                    {copiedKey === 'summary' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    Copy
                  </button>
                </div>
                <p className="text-sm text-slate-200 leading-relaxed font-normal">
                  {notesData.summary}
                </p>
              </div>

              {/* 3. Bulleted Key Discussion Points */}
              <div className="p-4 bg-slate-950/70 rounded-xl border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Check className="w-4 h-4" />
                    Key Discussion Points & Insights
                  </span>
                  <button
                    onClick={() =>
                      copyToClipboard(notesData.keyTakeaways.map((t) => `• ${t}`).join('\n'), 'takeaways')
                    }
                    className="text-xs text-slate-400 hover:text-white flex items-center gap-1"
                  >
                    {copiedKey === 'takeaways' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    Copy
                  </button>
                </div>
                <ul className="space-y-2 text-xs text-slate-300">
                  {notesData.keyTakeaways.map((takeaway, idx) => (
                    <li key={idx} className="flex items-start gap-2.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1.5 shrink-0" />
                      <span className="leading-relaxed">{takeaway}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* 4. Timestamps & Chapters */}
              <div className="p-4 bg-slate-950/70 rounded-xl border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Clock className="w-4 h-4" />
                    Timestamps & Chapters
                  </span>
                  <button
                    onClick={() =>
                      copyToClipboard(
                        notesData.timestamps.map((t) => `${t.time} - ${t.title}`).join('\n'),
                        'timestamps'
                      )
                    }
                    className="text-xs text-slate-400 hover:text-white flex items-center gap-1"
                  >
                    {copiedKey === 'timestamps' ? (
                      <Check className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                    Copy
                  </button>
                </div>

                <div className="divide-y divide-slate-800/80">
                  {notesData.timestamps.map((ts, idx) => (
                    <div key={idx} className="py-2.5 flex items-start gap-3 text-xs">
                      <span className="font-mono font-bold text-amber-400 bg-amber-950/50 px-2 py-0.5 rounded border border-amber-900/60 shrink-0">
                        {ts.time}
                      </span>
                      <div>
                        <h5 className="font-bold text-white text-xs">{ts.title}</h5>
                        <p className="text-[11px] text-slate-400 mt-0.5">{ts.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 5. Memorable Quotes */}
              {notesData.memorableQuotes?.length > 0 && (
                <div className="p-4 bg-slate-950/70 rounded-xl border border-slate-800 space-y-3">
                  <span className="text-xs font-bold text-pink-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Quote className="w-4 h-4" />
                    Standout Quotes
                  </span>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {notesData.memorableQuotes.map((q, idx) => (
                      <div
                        key={idx}
                        className="p-3 rounded-lg bg-slate-900 border border-slate-800 text-xs space-y-1.5"
                      >
                        <p className="italic text-slate-200 leading-relaxed">"{q.quote}"</p>
                        <p className="text-[11px] font-bold text-pink-400 font-mono">— {q.speaker}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 6. Social Media Launch Posts */}
              {notesData.socialPromo && (
                <div className="p-4 bg-slate-950/70 rounded-xl border border-slate-800 space-y-3">
                  <span className="text-xs font-bold text-indigo-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Share2 className="w-4 h-4" />
                    Ready-to-Post Social Media Content
                  </span>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {/* Twitter / X */}
                    <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 text-xs space-y-2">
                      <div className="flex items-center justify-between text-[11px] font-bold text-slate-300">
                        <span>Twitter / X Thread</span>
                        <button
                          onClick={() => copyToClipboard(notesData.socialPromo.twitterPost, 'xpost')}
                          className="text-slate-400 hover:text-white flex items-center gap-1"
                        >
                          {copiedKey === 'xpost' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                          Copy
                        </button>
                      </div>
                      <p className="text-slate-300 whitespace-pre-wrap leading-relaxed text-[11px]">
                        {notesData.socialPromo.twitterPost}
                      </p>
                    </div>

                    {/* LinkedIn */}
                    <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 text-xs space-y-2">
                      <div className="flex items-center justify-between text-[11px] font-bold text-slate-300">
                        <span>LinkedIn Article</span>
                        <button
                          onClick={() => copyToClipboard(notesData.socialPromo.linkedinPost, 'lipost')}
                          className="text-slate-400 hover:text-white flex items-center gap-1"
                        >
                          {copiedKey === 'lipost' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                          Copy
                        </button>
                      </div>
                      <p className="text-slate-300 whitespace-pre-wrap leading-relaxed text-[11px]">
                        {notesData.socialPromo.linkedinPost}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
