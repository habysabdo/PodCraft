import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ICE_SERVERS,
  getSignalingUrl,
  type ClientMessage,
  type ServerMessage,
} from '../lib/signaling';

export type RemoteGuestStatus =
  | 'idle'
  | 'waiting'
  | 'connecting'
  | 'connected'
  | 'left'
  | 'error';

export interface UseRemoteGuestOptions {
  /** Room code created by the host via POST /api/rooms. Null = no invite. */
  roomCode: string | null;
  /** True while the host wants the invite to stay open. */
  enabled: boolean;
  /** Called with the guest's MediaStream when it arrives, and with null when
   *  the guest leaves (so the caller can fall back to the local device). */
  onRemoteStream: (stream: MediaStream | null, guestName?: string) => void;
}

/**
 * Host-side remote guest connection.
 *
 * Owns the signaling WebSocket (role 'host') and the RTCPeerConnection.
 * The guest sends the offer; this hook answers it and hands the remote
 * stream to the caller, which attaches it to the existing guest channel
 * (video element + audioStudio) so VU meter, filters, canvas composite
 * and recording all work exactly as they do for a local guest.
 */
export function useRemoteGuest({ roomCode, enabled, onRemoteStream }: UseRemoteGuestOptions) {
  const [status, setStatus] = useState<RemoteGuestStatus>('idle');
  const [guestName, setGuestName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const guestNameRef = useRef('');
  const streamActiveRef = useRef(false);
  const onRemoteStreamRef = useRef(onRemoteStream);

  // Always call the latest callback without re-running the effect.
  useEffect(() => {
    onRemoteStreamRef.current = onRemoteStream;
  });

  const closePeer = useCallback(() => {
    if (pcRef.current) {
      try {
        pcRef.current.close();
      } catch {
        // ignore
      }
      pcRef.current = null;
    }
    pendingCandidatesRef.current = [];
    if (streamActiveRef.current) {
      streamActiveRef.current = false;
      onRemoteStreamRef.current(null);
    }
  }, []);

  useEffect(() => {
    if (!enabled || !roomCode) {
      setStatus('idle');
      return;
    }

    setStatus('waiting');
    setError(null);
    setGuestName('');
    guestNameRef.current = '';

    const ws = new WebSocket(getSignalingUrl());
    wsRef.current = ws;

    const send = (msg: ClientMessage) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      }
    };

    const createPeerConnection = (): RTCPeerConnection => {
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          send({ type: 'ice-candidate', candidate: e.candidate.toJSON() });
        }
      };

      pc.ontrack = (e) => {
        const [stream] = e.streams;
        if (stream) {
          streamActiveRef.current = true;
          onRemoteStreamRef.current(stream, guestNameRef.current || undefined);
          setStatus('connected');
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') {
          setStatus('connected');
        } else if (pc.connectionState === 'failed') {
          setError(
            'Connection to the guest failed — the network blocked the direct call. A TURN server may be needed on strict networks.'
          );
          setStatus('error');
        } else if (pc.connectionState === 'closed') {
          closePeer();
          setStatus('left');
        }
        // 'disconnected' is transient (Wi-Fi blip) — wait for recovery.
      };

      return pc;
    };

    ws.onopen = () => {
      send({ type: 'join', room: roomCode, role: 'host' });
    };

    ws.onmessage = async (event) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      if (msg.type === 'peer-joined' && msg.role === 'guest') {
        if (msg.name) {
          guestNameRef.current = msg.name;
          setGuestName(msg.name);
        }
        setStatus('connecting');
      } else if (msg.type === 'offer') {
        try {
          // A rejoin sends a fresh offer — drop any previous connection first.
          if (pcRef.current) {
            try {
              pcRef.current.close();
            } catch {
              // ignore
            }
            pcRef.current = null;
          }
          const pc = createPeerConnection();
          pcRef.current = pc;
          await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
          // Flush ICE candidates that arrived before the remote description.
          for (const c of pendingCandidatesRef.current) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(c));
            } catch {
              // ignore stale candidates
            }
          }
          pendingCandidatesRef.current = [];
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          send({ type: 'answer', sdp: answer });
          setStatus('connecting');
        } catch (err) {
          console.warn('Failed to answer guest offer:', err);
          setError('Could not connect to the guest. Ask them to rejoin from the invite link.');
          setStatus('error');
        }
      } else if (msg.type === 'ice-candidate') {
        if (msg.candidate) {
          if (pcRef.current && pcRef.current.remoteDescription) {
            try {
              await pcRef.current.addIceCandidate(new RTCIceCandidate(msg.candidate));
            } catch {
              // ignore stale candidates
            }
          } else {
            pendingCandidatesRef.current.push(msg.candidate);
          }
        }
      } else if (msg.type === 'peer-left' && msg.role === 'guest') {
        closePeer();
        setStatus('left');
      } else if (msg.type === 'error') {
        setError(msg.message);
        setStatus('error');
      }
    };

    ws.onerror = () => {
      setError('Could not reach the signaling server. Check the connection and try again.');
      setStatus('error');
    };

    ws.onclose = () => {
      closePeer();
      setStatus((prev) =>
        prev === 'connected' || prev === 'waiting' || prev === 'connecting' ? 'left' : prev
      );
    };

    return () => {
      try {
        ws.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
      closePeer();
    };
  }, [enabled, roomCode, closePeer]);

  return { status, guestName, error };
}
