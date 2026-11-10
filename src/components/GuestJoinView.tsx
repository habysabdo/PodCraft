import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  Loader2,
  Mic,
  PhoneOff,
  Radio,
  User,
  Video,
} from 'lucide-react';
import { useDevices } from '../hooks/useDevices';
import {
  ICE_SERVERS,
  getSignalingUrl,
  type ClientMessage,
  type ServerMessage,
} from '../lib/signaling';

type GuestStatus = 'idle' | 'connecting' | 'connected' | 'left' | 'error';

interface GuestJoinViewProps {
  /** Invite room code from the ?guest=<code> URL param. */
  code: string;
}

/**
 * Guest join screen — rendered instead of the studio when the app is opened
 * with ?guest=<code>.
 *
 * The guest picks a name, camera and mic, then joins. Their camera+mic are
 * sent peer-to-peer to the host's studio over WebRTC; nothing is recorded
 * on this page.
 */
export const GuestJoinView: React.FC<GuestJoinViewProps> = ({ code }) => {
  const {
    videoDevices,
    audioDevices,
    permissionGranted,
    error: deviceError,
    acquireVideoStream,
    acquireAudioStream,
  } = useDevices();

  const [name, setName] = useState('');
  const [videoDeviceId, setVideoDeviceId] = useState('');
  const [audioDeviceId, setAudioDeviceId] = useState('');
  const [status, setStatus] = useState<GuestStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [hasPreview, setHasPreview] = useState(false);

  const previewRef = useRef<HTMLVideoElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);

  // Auto-select the first camera / mic once the lists appear.
  useEffect(() => {
    if (videoDevices.length > 0 && !videoDeviceId) {
      setVideoDeviceId(videoDevices[0].deviceId);
    }
  }, [videoDevices, videoDeviceId]);

  useEffect(() => {
    if (audioDevices.length > 0 && !audioDeviceId) {
      setAudioDeviceId(audioDevices[0].deviceId);
    }
  }, [audioDevices, audioDeviceId]);

  // Stop all local tracks and sockets if this screen unmounts.
  useEffect(() => {
    return () => {
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      try {
        pcRef.current?.close();
      } catch {
        // ignore
      }
      try {
        wsRef.current?.close();
      } catch {
        // ignore
      }
    };
  }, []);

  const stopLocalTracks = () => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    setHasPreview(false);
    if (previewRef.current) {
      previewRef.current.srcObject = null;
    }
  };

  const leave = () => {
    try {
      wsRef.current?.send(JSON.stringify({ type: 'leave' } satisfies ClientMessage));
    } catch {
      // ignore
    }
    try {
      pcRef.current?.close();
    } catch {
      // ignore
    }
    pcRef.current = null;
    try {
      wsRef.current?.close();
    } catch {
      // ignore
    }
    wsRef.current = null;
    stopLocalTracks();
    setStatus('left');
  };

  const join = async () => {
    setError(null);
    setStatus('connecting');

    try {
      const videoStream = await acquireVideoStream(videoDeviceId);
      const audioStream = await acquireAudioStream(audioDeviceId);
      const tracks = [...(videoStream?.getTracks() ?? []), ...(audioStream?.getTracks() ?? [])];
      if (tracks.length === 0) {
        throw new Error('No camera or microphone stream available.');
      }
      const localStream = new MediaStream(tracks);
      localStreamRef.current = localStream;
      if (previewRef.current) {
        previewRef.current.srcObject = localStream;
        previewRef.current.play().catch(() => {});
      }
      setHasPreview(true);

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      pcRef.current = pc;
      tracks.forEach((t) => pc.addTrack(t, localStream));

      pc.onicecandidate = (e) => {
        if (e.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(
            JSON.stringify({
              type: 'ice-candidate',
              candidate: e.candidate.toJSON(),
            } satisfies ClientMessage)
          );
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') {
          setStatus('connected');
        } else if (pc.connectionState === 'failed') {
          setError(
            'Connection failed — your network may block direct calls. Try a different network or ask the host to send a fresh invite.'
          );
          setStatus('error');
        }
      };

      const ws = new WebSocket(getSignalingUrl(code));
      wsRef.current = ws;

      ws.onopen = async () => {
        ws.send(
          JSON.stringify({
            type: 'join',
            room: code,
            role: 'guest',
            name: name.trim() || 'Guest',
          } satisfies ClientMessage)
        );
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        ws.send(JSON.stringify({ type: 'offer', sdp: offer } satisfies ClientMessage));
      };

      ws.onmessage = async (event) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }

        if (msg.type === 'answer') {
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
          } catch {
            // ignore
          }
          // Flush ICE candidates that arrived before the remote description.
          for (const c of pendingCandidatesRef.current) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(c));
            } catch {
              // ignore stale candidates
            }
          }
          pendingCandidatesRef.current = [];
        } else if (msg.type === 'ice-candidate') {
          if (msg.candidate) {
            if (pc.remoteDescription) {
              try {
                await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
              } catch {
                // ignore stale candidates
              }
            } else {
              pendingCandidatesRef.current.push(msg.candidate);
            }
          }
        } else if (msg.type === 'peer-left') {
          setError('The host left the studio.');
          setStatus('left');
        } else if (msg.type === 'error') {
          setError(msg.message);
          setStatus('error');
          stopLocalTracks();
          try {
            pc.close();
          } catch {
            // ignore
          }
        }
      };

      ws.onerror = () => {
        setError('Could not reach the studio server. Check your connection and try again.');
        setStatus('error');
        stopLocalTracks();
      };

      ws.onclose = () => {
        setStatus((prev) => (prev === 'connecting' || prev === 'connected' ? 'left' : prev));
      };
    } catch (err: unknown) {
      console.warn('Guest join failed:', err);
      setError(
        err instanceof Error ? err.message : 'Could not access your camera or microphone.'
      );
      setStatus('error');
      stopLocalTracks();
    }
  };

  const statusPill = (() => {
    switch (status) {
      case 'connecting':
        return (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full bg-blue-950 text-blue-300 border border-blue-800">
            <Loader2 className="w-3 h-3 animate-spin" />
            Connecting…
          </span>
        );
      case 'connected':
        return (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-800">
            <CheckCircle2 className="w-3 h-3" />
            Live in the studio
          </span>
        );
      case 'left':
        return (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
            You left the studio
          </span>
        );
      case 'error':
        return (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full bg-red-950 text-red-300 border border-red-800">
            <AlertCircle className="w-3 h-3" />
            Something went wrong
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
            Not joined yet
          </span>
        );
    }
  })();

  const joined = status === 'connected' || status === 'connecting';

  return (
    <div className="min-h-screen bg-[#07090e] text-slate-100 flex flex-col items-center justify-center font-sans p-4">
      <div className="w-full max-w-xl space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-purple-600 flex items-center justify-center shadow-lg shadow-blue-500/20 shrink-0">
            <Radio className="w-5 h-5 text-white animate-pulse" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="font-extrabold text-lg tracking-tight text-white leading-tight">
              PodCraft Studio
            </h1>
            <p className="text-xs text-slate-400">You were invited as a guest</p>
          </div>
          {statusPill}
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
          {/* Invite code */}
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-slate-400">Invite code</span>
            <span className="font-mono font-bold text-white bg-slate-950 border border-slate-800 px-2.5 py-1 rounded-lg tracking-widest">
              {code}
            </span>
          </div>

          {/* Local preview */}
          <div className="relative rounded-xl overflow-hidden border border-slate-800 bg-black aspect-video flex items-center justify-center">
            <video
              ref={previewRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
            {!hasPreview && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-slate-500">
                <Video className="w-8 h-8" />
                <p className="text-xs">Your camera preview will appear here</p>
              </div>
            )}
            {status === 'connected' && (
              <span className="absolute top-3 left-3 inline-flex items-center gap-1.5 bg-red-600 text-white text-[10px] font-bold px-2 py-1 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                LIVE TO HOST
              </span>
            )}
          </div>

          {!permissionGranted && (
            <p className="text-xs text-amber-200 bg-amber-950/40 border border-amber-800/80 rounded-xl px-3 py-2">
              Allow camera &amp; microphone when your browser asks, so your devices show up below.
            </p>
          )}
          {deviceError && (
            <p className="text-xs text-amber-200 bg-amber-950/40 border border-amber-800/80 rounded-xl px-3 py-2">
              {deviceError}
            </p>
          )}

          {/* Name */}
          <label className="block space-y-1.5">
            <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-blue-400" />
              Your name
            </span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Guest"
              disabled={joined}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-blue-500 disabled:opacity-60"
            />
          </label>

          {/* Devices */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block space-y-1.5">
              <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                <Camera className="w-3.5 h-3.5 text-blue-400" />
                Camera
              </span>
              <select
                value={videoDeviceId}
                onChange={(e) => setVideoDeviceId(e.target.value)}
                disabled={joined}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-blue-500 disabled:opacity-60"
              >
                {videoDevices.length === 0 && <option value="">No camera found</option>}
                {videoDevices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                <Mic className="w-3.5 h-3.5 text-blue-400" />
                Microphone
              </span>
              <select
                value={audioDeviceId}
                onChange={(e) => setAudioDeviceId(e.target.value)}
                disabled={joined}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-blue-500 disabled:opacity-60"
              >
                {audioDevices.length === 0 && <option value="">No microphone found</option>}
                {audioDevices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {error && (
            <p className="text-xs text-red-200 bg-red-950/50 border border-red-800/80 rounded-xl px-3 py-2.5">
              {error}
            </p>
          )}

          {/* Actions */}
          {status === 'left' || status === 'error' ? (
            <div className="flex gap-3">
              <button
                onClick={join}
                className="flex-1 py-3 px-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold text-sm transition-all cursor-pointer"
              >
                Join again
              </button>
              <a
                href="/"
                className="py-3 px-4 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl font-bold text-sm transition-all text-center"
              >
                Back to studio
              </a>
            </div>
          ) : status === 'connected' ? (
            <button
              onClick={leave}
              className="w-full py-3 px-4 bg-red-600 hover:bg-red-500 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <PhoneOff className="w-4 h-4" />
              Leave studio
            </button>
          ) : status === 'connecting' ? (
            <button
              disabled
              className="w-full py-3 px-4 bg-emerald-600 disabled:opacity-60 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <Loader2 className="w-4 h-4 animate-spin" />
              Joining…
            </button>
          ) : (
            <button
              onClick={join}
              className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <Video className="w-4 h-4" />
              Join studio
            </button>
          )}

          <p className="text-[11px] text-slate-500 text-center leading-relaxed">
            Your camera and microphone stream live to the host&apos;s studio. Nothing is
            recorded on this page — the host records the show.
          </p>
        </div>
      </div>
    </div>
  );
};
