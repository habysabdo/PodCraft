import React, { useState } from 'react';
import { Check, Copy, Link2, UserPlus, X } from 'lucide-react';
import { buildGuestLink } from '../lib/signaling';
import type { RemoteGuestStatus } from '../hooks/useRemoteGuest';

interface RemoteGuestInviteProps {
  status: RemoteGuestStatus;
  roomCode: string | null;
  guestName: string;
  error: string | null;
  onCreateInvite: () => void;
  onEndInvite: () => void;
}

/**
 * Host-side "Invite Remote Guest" panel, shown in the studio above the
 * channel controls. The host creates an invite, copies the link, and sends
 * it to the guest — the guest opens it in their browser and joins the show.
 * No install, no account.
 */
export const RemoteGuestInvite: React.FC<RemoteGuestInviteProps> = ({
  status,
  roomCode,
  guestName,
  error,
  onCreateInvite,
  onEndInvite,
}) => {
  const [copied, setCopied] = useState(false);
  const link = roomCode ? buildGuestLink(roomCode) : '';

  const copyLink = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard unavailable (e.g. non-secure context) — the link field
      // below is selectable so the host can copy it by hand.
    }
  };

  const statusPill = (() => {
    switch (status) {
      case 'waiting':
        return (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full bg-amber-950 text-amber-300 border border-amber-800">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            Waiting for guest…
          </span>
        );
      case 'connecting':
        return (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full bg-blue-950 text-blue-300 border border-blue-800">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            Guest joining…
          </span>
        );
      case 'connected':
        return (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-800">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            Live with {guestName || 'guest'}
          </span>
        );
      case 'left':
        return (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
            Guest left
          </span>
        );
      case 'error':
        return (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full bg-red-950 text-red-300 border border-red-800">
            Connection error
          </span>
        );
      default:
        return null;
    }
  })();

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-xl space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <UserPlus className="w-4 h-4 text-blue-400" />
          <h3 className="font-bold text-white text-sm">Remote Guest</h3>
        </div>
        {statusPill}
      </div>

      {!roomCode ? (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <p className="flex-1 text-xs text-slate-400 leading-relaxed">
            Your guest joins from anywhere with a link — no install, no account. Their
            camera and mic flow into the Guest channel, so the recording works exactly
            the same as a guest sitting next to you.
          </p>
          <button
            onClick={onCreateInvite}
            className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-md shadow-blue-600/30 transition-all cursor-pointer shrink-0"
          >
            <Link2 className="w-4 h-4" />
            Invite Remote Guest
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={link}
              onFocus={(e) => e.target.select()}
              className="flex-1 min-w-0 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-xs text-slate-200 font-mono outline-none focus:border-blue-500"
            />
            <button
              onClick={copyLink}
              className="px-3.5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer shrink-0"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied ? 'Copied!' : 'Copy link'}
            </button>
          </div>

          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-xs text-slate-400">
              Invite code:{' '}
              <span className="font-mono font-bold text-white tracking-widest">{roomCode}</span>
              {status === 'connected' && guestName && (
                <span className="text-slate-500">
                  {' '}
                  • {guestName} is in the Guest channel
                </span>
              )}
              {status === 'left' && (
                <span className="text-slate-500">
                  {' '}
                  • the guest left — your local guest camera is back in the channel
                </span>
              )}
            </p>
            <button
              onClick={onEndInvite}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
              End invite
            </button>
          </div>

          {status === 'error' && error && (
            <p className="text-xs text-red-200 bg-red-950/50 border border-red-800/80 rounded-xl px-3 py-2.5">
              {error}
            </p>
          )}

          <p className="text-[11px] text-slate-500 leading-relaxed">
            Keep this studio page open while the guest is connected. If the guest&apos;s
            network blocks direct calls, a TURN server is needed — that is not included
            in this version.
          </p>
        </div>
      )}
    </div>
  );
};
