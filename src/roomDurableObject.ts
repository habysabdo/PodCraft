/**
 * Room — Durable Object holding one remote-guest room's signaling state.
 *
 * One instance per invite code (the Worker routes /ws?room=CODE to it via
 * env.ROOM.idFromName(code)). The object only relays WebRTC signaling
 * between the host and the guest — media flows peer-to-peer and never
 * touches this server. Same message protocol as the Node signaling server
 * in server.ts: join / offer / answer / ice-candidate / leave / peer-left /
 * peer-joined / joined / error.
 *
 * State is hibernation-safe: no peer state lives in instance fields.
 * Which socket is host/guest (and each name) is stored as the socket's
 * attachment, and the live sockets come from ctx.getWebSockets(). If the
 * object is evicted and woken, the attachments come back with the sockets.
 *
 * Two differences from the Node server, both forced by the Workers model:
 *  - No heartbeat ping: the runtime delivers webSocketClose when a socket
 *    dies, so a closed tab cannot linger in a room.
 *  - Room existence is a stored flag, not server memory: POST /api/rooms
 *    marks the room created in this object's storage, and a guest joining
 *    a code that was never created gets "Room not found" (same as the
 *    Node server). A host joining an unmarked code auto-creates it, so a
 *    failed create-time mark never blocks the host.
 */

import { DurableObject } from 'cloudflare:workers';
import type { DurableObjectState } from 'cloudflare:workers';

type SignalingRole = 'host' | 'guest';

/** Per-socket metadata, stored via serializeAttachment. */
interface SocketMeta {
  role: SignalingRole | null;
  name?: string;
}

export class Room extends DurableObject {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
  }

  /**
   * WebSocket upgrade: accept the socket, attach empty metadata, return
   * the 101 response. The client sends its join message right after.
   *
   * Also answers the internal create marker: POST /api/rooms calls the
   * stub with a POST to __init__ right after minting a code. Checked
   * BEFORE the upgrade check — the marker request has no Upgrade header.
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/__init__' && request.method === 'POST') {
      await this.ctx.storage.put('created', true);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response(
        JSON.stringify({ error: 'Expected a WebSocket upgrade request.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ role: null } satisfies SocketMeta);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer
  ): Promise<void> {
    let msg: any;
    try {
      const text =
        typeof message === 'string'
          ? message
          : new TextDecoder().decode(message);
      msg = JSON.parse(text);
    } catch {
      this.send(ws, { type: 'error', message: 'Invalid message format.' });
      return;
    }
    if (!msg || typeof msg.type !== 'string') {
      this.send(ws, { type: 'error', message: 'Invalid message format.' });
      return;
    }

    if (msg.type === 'join') {
      if (msg.role !== 'host' && msg.role !== 'guest') {
        this.send(ws, { type: 'error', message: 'Invalid role.' });
        return;
      }
      // Room-exists check (same as the Node server): the room is marked
      // created by POST /api/rooms. A guest to an unknown code errors and
      // the socket closes; a host to an unmarked code auto-creates it, so
      // a failed create-time mark never blocks the host.
      const created = (await this.ctx.storage.get('created')) === true;
      if (!created) {
        if (msg.role === 'guest') {
          this.send(ws, { type: 'error', message: 'Room not found' });
          try {
            ws.close();
          } catch {
            // ignore — already closing
          }
          return;
        }
        await this.ctx.storage.put('created', true);
      }
      const existing = this.socketForRole(msg.role);
      if (existing) {
        this.send(ws, {
          type: 'error',
          message:
            msg.role === 'host'
              ? 'This room already has a host.'
              : 'A guest is already connected to this room.',
        });
        return;
      }
      const name = typeof msg.name === 'string' ? msg.name : undefined;
      ws.serializeAttachment({ role: msg.role, name } satisfies SocketMeta);
      const room = typeof msg.room === 'string' ? msg.room : '';
      this.send(ws, { type: 'joined', room, role: msg.role });
      const other = this.socketForRole(
        msg.role === 'host' ? 'guest' : 'host'
      );
      if (other) {
        this.send(other, {
          type: 'peer-joined',
          role: msg.role,
          name: msg.name,
        });
      }
      return;
    }

    const meta = this.meta(ws);
    if (!meta || !meta.role) {
      this.send(ws, { type: 'error', message: 'Join a room first.' });
      return;
    }

    if (msg.type === 'leave') {
      const role = meta.role;
      ws.serializeAttachment({ role: null } satisfies SocketMeta);
      const other = this.socketForRole(
        role === 'host' ? 'guest' : 'host'
      );
      if (other) {
        this.send(other, { type: 'peer-left', role });
      }
      return;
    }

    if (
      msg.type === 'offer' ||
      msg.type === 'answer' ||
      msg.type === 'ice-candidate'
    ) {
      const other = this.socketForRole(
        meta.role === 'host' ? 'guest' : 'host'
      );
      if (!other) {
        this.send(ws, {
          type: 'error',
          message: 'The other side has not joined yet.',
        });
        return;
      }
      this.send(other, { ...msg, from: meta.role });
      return;
    }

    this.send(ws, {
      type: 'error',
      message: `Unknown message type: ${msg.type}`,
    });
  }

  webSocketClose(
    ws: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean
  ): void {
    this.notifyPeerLeft(ws);
  }

  webSocketError(ws: WebSocket, _error: unknown): void {
    // The socket will also close; notifying here too is safe — a duplicate
    // peer-left is harmless (the clients treat it idempotently).
    this.notifyPeerLeft(ws);
  }

  // ---- helpers -----------------------------------------------------------

  private meta(ws: WebSocket): SocketMeta | null {
    try {
      const raw = ws.deserializeAttachment();
      if (raw && typeof raw === 'object' && 'role' in raw) {
        return raw as SocketMeta;
      }
    } catch {
      // No attachment yet.
    }
    return null;
  }

  private socketForRole(role: SignalingRole): WebSocket | null {
    for (const socket of this.ctx.getWebSockets()) {
      const m = this.meta(socket);
      if (m && m.role === role) return socket;
    }
    return null;
  }

  private send(ws: WebSocket, payload: unknown): void {
    try {
      ws.send(JSON.stringify(payload));
    } catch {
      // Socket is closing — nothing to do.
    }
  }

  /** Tell the other peer this socket went away (close or error). */
  private notifyPeerLeft(ws: WebSocket): void {
    const meta = this.meta(ws);
    if (!meta || !meta.role) return;
    const other = this.socketForRole(
      meta.role === 'host' ? 'guest' : 'host'
    );
    if (other) {
      this.send(other, { type: 'peer-left', role: meta.role });
    }
  }
}
