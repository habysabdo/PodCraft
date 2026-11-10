/**
 * Shared WebRTC signaling helpers for the PodCraft remote-guest feature.
 *
 * The signaling server (server.ts) only relays messages between the host and
 * the guest in the same room — it never sees or stores any media. Media flows
 * peer-to-peer over WebRTC once the offer/answer handshake completes.
 */

export type SignalingRole = 'host' | 'guest';

/** STUN only in v1 — no TURN server. See the README note in the summary:
 *  some strict corporate / symmetric-NAT networks may fail to connect. */
export const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
];

/** Messages a client sends to the signaling server. */
export type ClientMessage =
  | { type: 'join'; room: string; role: SignalingRole; name?: string }
  | { type: 'offer'; sdp: RTCSessionDescriptionInit }
  | { type: 'answer'; sdp: RTCSessionDescriptionInit }
  | { type: 'ice-candidate'; candidate: RTCIceCandidateInit | null }
  | { type: 'leave' };

/** Messages the signaling server sends to a client. */
export type ServerMessage =
  | { type: 'joined'; room: string; role: SignalingRole }
  | { type: 'peer-joined'; role: SignalingRole; name?: string }
  | { type: 'peer-left'; role: SignalingRole }
  | { type: 'offer'; sdp: RTCSessionDescriptionInit; from: SignalingRole }
  | { type: 'answer'; sdp: RTCSessionDescriptionInit; from: SignalingRole }
  | { type: 'ice-candidate'; candidate: RTCIceCandidateInit | null; from: SignalingRole }
  | { type: 'error'; message: string };

/** Same-origin WebSocket URL for signaling (works over http and https). */
export function getSignalingUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

/** Public link a host sends to a guest: opens the app in guest-join mode. */
export function buildGuestLink(code: string): string {
  return `${window.location.origin}/?guest=${code}`;
}
