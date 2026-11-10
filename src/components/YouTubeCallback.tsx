import React, { useEffect, useState } from 'react';
import { Loader2, CheckCircle2, AlertTriangle, Youtube } from 'lucide-react';
import { handleYouTubeCallback } from '../lib/youtube';

/** The OAuth return screen. Google redirects here with ?code=… after the
 *  user signs in; this page exchanges the code for tokens, then sends the
 *  user back to the studio. Rendered by App.tsx when the path is
 *  /youtube-callback (the SPA fallback serves index.html for that path). */
export const YouTubeCallback: React.FC = () => {
  const [status, setStatus] = useState<'working' | 'done' | 'error'>('working');
  const [message, setMessage] = useState('Finishing the YouTube connection…');

  useEffect(() => {
    let cancelled = false;
    handleYouTubeCallback().then((result) => {
      if (cancelled) return;
      setStatus(result.ok ? 'done' : 'error');
      setMessage(result.message);
      if (result.ok) {
        // A beat to read the confirmation, then back to the studio.
        window.setTimeout(() => {
          window.location.replace('/');
        }, 1800);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-[#07090e] text-slate-100 flex items-center justify-center p-4 font-sans">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 text-center space-y-4 shadow-2xl">
        <div className="w-12 h-12 mx-auto rounded-2xl bg-red-950 border border-red-800/80 flex items-center justify-center text-red-500">
          <Youtube className="w-6 h-6" />
        </div>
        <h1 className="font-bold text-white text-lg">Connecting YouTube</h1>
        {status === 'working' && (
          <p className="text-sm text-slate-400 flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> {message}
          </p>
        )}
        {status === 'done' && (
          <p className="text-sm text-emerald-300 flex items-center justify-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" /> {message}
          </p>
        )}
        {status === 'error' && (
          <>
            <p className="text-sm text-red-300 flex items-start justify-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {message}
            </p>
            <button
              onClick={() => window.location.replace('/')}
              className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-sm cursor-pointer"
            >
              Back to the studio
            </button>
          </>
        )}
      </div>
    </div>
  );
};
