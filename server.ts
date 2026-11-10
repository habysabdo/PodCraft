import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import { WebSocketServer, WebSocket } from 'ws';
import type { Server as HttpServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---- Remote guest signaling (Piece 1) ----
// In-memory invite rooms. A room is created by the host via POST /api/rooms
// and lives until both peers disconnect. The signaling server only relays
// WebRTC offer/answer/ICE messages between the two peers — media flows
// peer-to-peer and never touches this server. No auth in v1.

type SignalingRole = 'host' | 'guest';

interface Room {
  code: string;
  host: WebSocket | null;
  guest: WebSocket | null;
  hostName?: string;
  guestName?: string;
  createdAt: number;
}

const rooms = new Map<string, Room>();
const peerMeta = new Map<WebSocket, { roomCode: string; role: SignalingRole }>();

// No lookalike characters (0/O, 1/I) so a code read over the phone is safe.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateRoomCode(length = 6): string {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

function signalingSend(ws: WebSocket, payload: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function signalingSendError(ws: WebSocket, message: string): void {
  signalingSend(ws, { type: 'error', message });
}

function detachPeer(
  ws: WebSocket,
  meta: { roomCode: string; role: SignalingRole },
  room: Room
): void {
  if (meta.role === 'host') {
    if (room.host === ws) room.host = null;
  } else if (room.guest === ws) {
    room.guest = null;
  }
  peerMeta.delete(ws);
  const other = meta.role === 'host' ? room.guest : room.host;
  if (other) {
    signalingSend(other, { type: 'peer-left', role: meta.role });
  }
  if (!room.host && !room.guest) {
    rooms.delete(room.code);
  }
}

function attachSignaling(httpServer: HttpServer): void {
  // path '/ws' so Vite's dev HMR websocket is untouched.
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  // Heartbeat: drop dead sockets so a closed tab does not linger in a room.
  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      const socket = ws as WebSocket & { isAlive?: boolean };
      if (socket.isAlive === false) {
        ws.terminate();
        return;
      }
      socket.isAlive = false;
      ws.ping();
    });
  }, 30000);
  wss.on('close', () => clearInterval(heartbeat));

  wss.on('connection', (ws: WebSocket) => {
    const socket = ws as WebSocket & { isAlive?: boolean };
    socket.isAlive = true;
    ws.on('pong', () => {
      socket.isAlive = true;
    });

    ws.on('message', (raw) => {
      let msg: any;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        signalingSendError(ws, 'Invalid message format.');
        return;
      }
      if (!msg || typeof msg.type !== 'string') {
        signalingSendError(ws, 'Invalid message format.');
        return;
      }

      if (msg.type === 'join') {
        const room = rooms.get(msg.room);
        if (!room) {
          signalingSendError(
            ws,
            'Room not found. The invite link may be expired — ask the host for a new one.'
          );
          return;
        }
        if (msg.role !== 'host' && msg.role !== 'guest') {
          signalingSendError(ws, 'Invalid role.');
          return;
        }
        const existing = msg.role === 'host' ? room.host : room.guest;
        if (existing && existing.readyState === WebSocket.OPEN) {
          signalingSendError(
            ws,
            msg.role === 'host'
              ? 'This room already has a host.'
              : 'A guest is already connected to this room.'
          );
          return;
        }
        if (msg.role === 'host') {
          room.host = ws;
          room.hostName = typeof msg.name === 'string' ? msg.name : undefined;
        } else {
          room.guest = ws;
          room.guestName = typeof msg.name === 'string' ? msg.name : undefined;
        }
        peerMeta.set(ws, { roomCode: room.code, role: msg.role });
        signalingSend(ws, { type: 'joined', room: room.code, role: msg.role });
        const other = msg.role === 'host' ? room.guest : room.host;
        if (other) {
          signalingSend(other, { type: 'peer-joined', role: msg.role, name: msg.name });
        }
        return;
      }

      const meta = peerMeta.get(ws);
      if (!meta) {
        signalingSendError(ws, 'Join a room first.');
        return;
      }
      const room = rooms.get(meta.roomCode);
      if (!room) {
        signalingSendError(ws, 'Room no longer exists.');
        return;
      }

      if (msg.type === 'leave') {
        detachPeer(ws, meta, room);
        return;
      }

      if (msg.type === 'offer' || msg.type === 'answer' || msg.type === 'ice-candidate') {
        const other = meta.role === 'host' ? room.guest : room.host;
        if (!other || other.readyState !== WebSocket.OPEN) {
          signalingSendError(ws, 'The other side has not joined yet.');
          return;
        }
        signalingSend(other, { ...msg, from: meta.role });
        return;
      }

      signalingSendError(ws, `Unknown message type: ${msg.type}`);
    });

    ws.on('close', () => {
      const meta = peerMeta.get(ws);
      if (!meta) return;
      const room = rooms.get(meta.roomCode);
      if (room) {
        detachPeer(ws, meta, room);
      }
    });
  });
}

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  app.use(express.json({ limit: '20mb' }));

  // Initialize Gemini API client with server-side API key and required user-agent
  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY || '',
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  // Health check endpoint
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      hasApiKey: Boolean(process.env.GEMINI_API_KEY),
      timestamp: new Date().toISOString(),
    });
  });

  // Create a remote-guest invite room (Piece 1). The host calls this when
  // they tap "Invite Remote Guest"; the returned code goes in the guest link.
  app.post('/api/rooms', (_req: Request, res: Response) => {
    let code = generateRoomCode();
    while (rooms.has(code)) {
      code = generateRoomCode();
    }
    rooms.set(code, { code, host: null, guest: null, createdAt: Date.now() });
    res.json({ code });
  });

  // ---- YouTube publish (Piece 3) ----
  // Google OAuth client credentials come from env vars ONLY — never hardcoded
  // and never logged. The redirect URI is the app's origin + /youtube-callback,
  // supplied by the client so the same code works locally
  // (http://localhost:3000/youtube-callback) and hosted (the Render URL +
  // /youtube-callback). BOTH URIs must be registered on the OAuth client in
  // Google Cloud Console, or Google refuses the sign-in.
  // The video file itself never touches this server: the browser uploads
  // straight to YouTube with the stored access token.
  const YOUTUBE_SCOPES = 'https://www.googleapis.com/auth/youtube.upload';
  const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

  function youtubeEnvError(res: Response): boolean {
    const missing: string[] = [];
    if (!process.env.GOOGLE_CLIENT_ID) missing.push('GOOGLE_CLIENT_ID');
    if (!process.env.GOOGLE_CLIENT_SECRET) missing.push('GOOGLE_CLIENT_SECRET');
    if (missing.length > 0) {
      res.status(500).json({
        error: `YouTube is not set up yet — the server is missing ${missing.join(' and ')}. Add the Google OAuth client credentials to the server environment (Render dashboard → Environment) and restart the service.`,
      });
      return true;
    }
    return false;
  }

  function isValidRedirectUri(uri: unknown): uri is string {
    if (typeof uri !== 'string') return false;
    try {
      const u = new URL(uri);
      return (
        (u.protocol === 'https:' || u.protocol === 'http:') &&
        u.pathname === '/youtube-callback'
      );
    } catch {
      return false;
    }
  }

  // Build the Google sign-in link for this browser's origin.
  app.get('/api/youtube/auth-url', (req: Request, res: Response) => {
    if (youtubeEnvError(res)) return;
    const redirectUri = req.query.redirect_uri;
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    if (!isValidRedirectUri(redirectUri)) {
      return res.status(400).json({
        error: 'Invalid redirect_uri — it must be the app origin + /youtube-callback.',
      });
    }
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID as string,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: YOUTUBE_SCOPES,
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
    });
    if (state) params.set('state', state);
    res.json({
      authUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    });
  });

  // Exchange the ?code= Google returned for tokens. Tokens go back to the
  // browser only — they are never logged or stored on the server.
  app.post('/api/youtube/exchange', async (req: Request, res: Response) => {
    if (youtubeEnvError(res)) return;
    const { code, redirect_uri } = req.body ?? {};
    if (typeof code !== 'string' || !code || !isValidRedirectUri(redirect_uri)) {
      return res.status(400).json({
        error: 'Missing or invalid authorization code / redirect_uri.',
      });
    }
    try {
      const body = new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID as string,
        client_secret: process.env.GOOGLE_CLIENT_SECRET as string,
        redirect_uri,
        grant_type: 'authorization_code',
      });
      const r = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(20000),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        return res.status(502).json({
          error: `Google refused the code exchange: ${data?.error_description || data?.error || 'unknown error'}. Try connecting again.`,
        });
      }
      return res.json({
        access_token: data.access_token,
        refresh_token: data.refresh_token ?? null,
        expires_in: data.expires_in ?? 3600,
        scope: data.scope ?? YOUTUBE_SCOPES,
        token_type: data.token_type ?? 'Bearer',
      });
    } catch {
      return res.status(502).json({
        error: 'Could not reach Google to exchange the code — check the connection and try again.',
      });
    }
  });

  // Trade a refresh token for a fresh access token (called by the browser
  // when its access token is expired, including mid-upload).
  app.post('/api/youtube/refresh', async (req: Request, res: Response) => {
    if (youtubeEnvError(res)) return;
    const { refresh_token } = req.body ?? {};
    if (typeof refresh_token !== 'string' || !refresh_token) {
      return res.status(400).json({
        error: 'Missing refresh token — reconnect YouTube.',
      });
    }
    try {
      const body = new URLSearchParams({
        refresh_token,
        client_id: process.env.GOOGLE_CLIENT_ID as string,
        client_secret: process.env.GOOGLE_CLIENT_SECRET as string,
        grant_type: 'refresh_token',
      });
      const r = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(20000),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        return res.status(502).json({
          error: `Google refused the token refresh: ${data?.error_description || data?.error || 'unknown error'}. Reconnect YouTube.`,
        });
      }
      return res.json({
        access_token: data.access_token,
        expires_in: data.expires_in ?? 3600,
        scope: data.scope ?? YOUTUBE_SCOPES,
        token_type: data.token_type ?? 'Bearer',
      });
    } catch {
      return res.status(502).json({
        error: 'Could not reach Google to refresh the token — check the connection and try again.',
      });
    }
  });

  // Post-recording Gemini AI Show Notes generation endpoint
  app.post('/api/generate-show-notes', async (req: Request, res: Response) => {
    try {
      const {
        podcastName = 'Studio Podcast',
        topic = 'General Discussion',
        duration = 0,
        transcript = '',
        markers = [],
        hostName = 'Host',
        guestName = 'Guest',
      } = req.body;

      if (!process.env.GEMINI_API_KEY) {
        return res.status(500).json({
          error: 'GEMINI_API_KEY is not configured on the server. Please check the Secrets panel.',
        });
      }

      // Format duration into mm:ss
      const mins = Math.floor(duration / 60);
      const secs = Math.floor(duration % 60);
      const formattedDuration = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

      // Build context prompt
      const prompt = `You are an elite podcast producer and editorial show-notes writer for top-charting podcasts.
Analyze the following recorded podcast episode details and transcript/discussion notes:

Podcast Name: "${podcastName}"
Host: "${hostName}"
Guest: "${guestName}"
Episode Topic/Theme: "${topic}"
Recorded Duration: ${formattedDuration}
Recorded Chapter Markers: ${JSON.stringify(markers)}

Transcript / Live Discussion Notes:
${transcript && transcript.trim().length > 0 ? transcript : `The host (${hostName}) and guest (${guestName}) conducted an engaging, deep-dive discussion focusing on "${topic}". They shared personal anecdotes, technical insights, actionable frameworks, and projected upcoming industry trends while answering listener challenges.`}

Generate a comprehensive, high-engagement set of show notes in structured JSON according to the schema provided:
1. episodeTitle: A compelling, clickable, high-retention title for this episode.
2. alternativeTitles: Exactly 3 distinct title variations (Curiosity-driven, Masterclass/Actionable, and Punchy).
3. summary: Exactly 3 polished, cohesive sentences summarizing the core discussion, the stakes, and the primary conclusion.
4. keyTakeaways: An array of 4 to 6 concise, bulleted key discussion points and insights.
5. timestamps: An array of chapters with timestamp (format "MM:SS"), catchy chapter title, and 1-sentence description. Spread realistic timestamps across the ${formattedDuration} duration.
6. memorableQuotes: An array of 2 to 3 standout quotes attributed to either ${hostName} or ${guestName}.
7. socialPromo: A ready-to-share announcement post for Twitter/X and LinkedIn with hashtags.`;

      const callGemini = async (modelName: string) => {
        return await ai.models.generateContent({
          model: modelName,
          contents: prompt,
          config: {
            systemInstruction:
              'You are a professional audio engineer and podcast production director. Always return valid, clean JSON with compelling, publication-ready copy.',
            responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              episodeTitle: {
                type: Type.STRING,
                description: 'The primary headline title for the episode.',
              },
              alternativeTitles: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: 'Three alternative titles with different tonal hooks.',
              },
              summary: {
                type: Type.STRING,
                description: 'Exactly 3 cohesive sentences summarizing the episode.',
              },
              keyTakeaways: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: '4-6 bulleted key discussion points and actionable takeaways.',
              },
              timestamps: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    time: { type: Type.STRING, description: 'Timestamp like 00:00 or 04:15' },
                    title: { type: Type.STRING, description: 'Chapter name' },
                    description: { type: Type.STRING, description: 'Brief synopsis of chapter' },
                  },
                  required: ['time', 'title', 'description'],
                },
                description: 'Timestamped chapter breakdown throughout the recording.',
              },
              memorableQuotes: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    speaker: { type: Type.STRING },
                    quote: { type: Type.STRING },
                  },
                  required: ['speaker', 'quote'],
                },
                description: 'Notable quotes from the dialogue.',
              },
              socialPromo: {
                type: Type.OBJECT,
                properties: {
                  twitterPost: { type: Type.STRING },
                  linkedinPost: { type: Type.STRING },
                },
                required: ['twitterPost', 'linkedinPost'],
              },
            },
            required: [
              'episodeTitle',
              'alternativeTitles',
              'summary',
              'keyTakeaways',
              'timestamps',
              'memorableQuotes',
              'socialPromo',
            ],
          },
        },
      });
    };

    let response;
    try {
      response = await callGemini('gemini-3.8-flash');
    } catch (err: any) {
      if (err?.message?.includes('503') || err?.message?.includes('high demand') || err?.status === 503) {
        console.warn('gemini-3.8-flash 503 high demand spike, retrying with real gemini-3.1-flash-lite...');
        response = await callGemini('gemini-3.1-flash-lite');
      } else {
        throw err;
      }
    }

    const responseText = response.text || '{}';
    const parsedData = JSON.parse(responseText);

    return res.json({
      success: true,
        data: parsedData,
      });
    } catch (error: any) {
      console.error('Error in show notes endpoint:', error);
      return res.status(500).json({
        success: false,
        error: error?.message || 'Failed to process show notes request',
      });
    }
  });

  // Serve client in development (via Vite middleware) or production
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const httpServer = app.listen(PORT, '0.0.0.0', () => {
    console.log(`PodCraft Studio server listening on http://0.0.0.0:${PORT}`);
  });

  // WebSocket signaling for remote guests (path /ws).
  attachSignaling(httpServer);
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
