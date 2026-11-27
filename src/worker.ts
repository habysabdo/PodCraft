/**
 * PodCraft — Cloudflare Worker (production deploy).
 *
 * This is the production path: one Worker serves the Vite frontend
 * (Static Assets, ./dist) AND the API the app already calls. It mirrors
 * server.ts route-for-route so the client does not change:
 *   GET  /api/health
 *   POST /api/rooms                 (remote-guest invite code)
 *   POST /api/generate-show-notes  (Gemini, REST — no Node SDK on Workers)
 *   GET  /api/youtube/auth-url
 *   POST /api/youtube/exchange
 *   POST /api/youtube/refresh
 *   POST /api/episodes              (save a published episode to D1)
 *   /ws?room=CODE                  (WebSocket upgrade → Room Durable Object)
 *   everything else                (static assets, SPA fallback)
 *
 * server.ts stays the local-dev server (npm start). Only this file deploys.
 *
 * Secrets come from env bindings set in the Cloudflare dashboard
 * (Workers & Pages → podcraft → Settings → Variables) and are never
 * logged: GEMINI_API_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET.
 * The video file itself never touches this Worker: the browser uploads
 * straight to YouTube with its stored access token.
 */

import { Room } from './roomDurableObject';
import type { D1Database, DurableObjectNamespace } from 'cloudflare:workers';

export { Room };

interface Env {
  ASSETS: {
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  };
  ROOM: DurableObjectNamespace;
  /** D1 database for episode records. Optional in local dev (wrangler dev
   *  without a D1 binding) — /api/episodes answers 500 without it. */
  DB?: D1Database;
  GEMINI_API_KEY?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---- App icons (PWA install needs 192px + 512px PNGs) --------------------
// The GitHub push path is text-only, so PNG files cannot be committed — the
// Worker serves the icons from these embedded base64 strings instead.
const ICON_192_B64 = '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';
const ICON_512_B64 = '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';
const ICON_512_MASKABLE_B64 = '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';

function pngResponse(b64: string): Response {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Response(bytes, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}

// No lookalike characters (0/O, 1/I) so a code read over the phone is safe.
// Same alphabet as server.ts.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateRoomCode(length = 6): string {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

// ---- YouTube publish (Piece 3) ------------------------------------------
// Same behavior as server.ts: credentials from env only, never logged,
// 20s timeouts on the Google calls, same messages and status codes.
// (One wording fix: the missing-env message points at the Cloudflare
// dashboard now, not Render.)

const YOUTUBE_SCOPES = 'https://www.googleapis.com/auth/youtube.upload';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

function youtubeEnvError(env: Env): string | null {
  const missing: string[] = [];
  if (!env.GOOGLE_CLIENT_ID) missing.push('GOOGLE_CLIENT_ID');
  if (!env.GOOGLE_CLIENT_SECRET) missing.push('GOOGLE_CLIENT_SECRET');
  if (missing.length === 0) return null;
  return (
    `YouTube is not set up yet — the server is missing ${missing.join(' and ')}. ` +
    'Add the Google OAuth client credentials to the server environment ' +
    '(Cloudflare dashboard → podcraft → Settings → Variables) and restart the service.'
  );
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

async function handleYouTubeAuthUrl(
  request: Request,
  env: Env
): Promise<Response> {
  const missing = youtubeEnvError(env);
  if (missing) return json({ error: missing }, 500);
  const url = new URL(request.url);
  const redirectUri = url.searchParams.get('redirect_uri');
  const state = url.searchParams.get('state') ?? '';
  if (!isValidRedirectUri(redirectUri)) {
    return json(
      {
        error:
          'Invalid redirect_uri — it must be the app origin + /youtube-callback.',
      },
      400
    );
  }
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID as string,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: YOUTUBE_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
  });
  if (state) params.set('state', state);
  return json({
    authUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
  });
}

async function handleYouTubeExchange(
  request: Request,
  env: Env
): Promise<Response> {
  const missing = youtubeEnvError(env);
  if (missing) return json({ error: missing }, 500);
  const body: any = await request.json().catch(() => ({}));
  const { code, redirect_uri } = body ?? {};
  if (typeof code !== 'string' || !code || !isValidRedirectUri(redirect_uri)) {
    return json(
      { error: 'Missing or invalid authorization code / redirect_uri.' },
      400
    );
  }
  try {
    const form = new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID as string,
      client_secret: env.GOOGLE_CLIENT_SECRET as string,
      redirect_uri,
      grant_type: 'authorization_code',
    });
    const r = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
      signal: AbortSignal.timeout(20000),
    });
    const data: any = await r.json().catch(() => ({}));
    if (!r.ok) {
      return json(
        {
          error: `Google refused the code exchange: ${data?.error_description || data?.error || 'unknown error'}. Try connecting again.`,
        },
        502
      );
    }
    return json({
      access_token: data.access_token,
      refresh_token: data.refresh_token ?? null,
      expires_in: data.expires_in ?? 3600,
      scope: data.scope ?? YOUTUBE_SCOPES,
      token_type: data.token_type ?? 'Bearer',
    });
  } catch {
    return json(
      {
        error:
          'Could not reach Google to exchange the code — check the connection and try again.',
      },
      502
    );
  }
}

async function handleYouTubeRefresh(
  request: Request,
  env: Env
): Promise<Response> {
  const missing = youtubeEnvError(env);
  if (missing) return json({ error: missing }, 500);
  const body: any = await request.json().catch(() => ({}));
  const { refresh_token } = body ?? {};
  if (typeof refresh_token !== 'string' || !refresh_token) {
    return json(
      { error: 'Missing refresh token — reconnect YouTube.' },
      400
    );
  }
  try {
    const form = new URLSearchParams({
      refresh_token,
      client_id: env.GOOGLE_CLIENT_ID as string,
      client_secret: env.GOOGLE_CLIENT_SECRET as string,
      grant_type: 'refresh_token',
    });
    const r = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
      signal: AbortSignal.timeout(20000),
    });
    const data: any = await r.json().catch(() => ({}));
    if (!r.ok) {
      return json(
        {
          error: `Google refused the token refresh: ${data?.error_description || data?.error || 'unknown error'}. Reconnect YouTube.`,
        },
        502
      );
    }
    return json({
      access_token: data.access_token,
      expires_in: data.expires_in ?? 3600,
      scope: data.scope ?? YOUTUBE_SCOPES,
      token_type: data.token_type ?? 'Bearer',
    });
  } catch {
    return json(
      {
        error:
          'Could not reach Google to refresh the token — check the connection and try again.',
      },
      502
    );
  }
}

// ---- Gemini AI show notes -------------------------------------------------
// Same prompt, schema, models and fallback as server.ts — but over the plain
// Gemini REST API, because the @google/genai Node SDK is not a Workers fit.
// Models: gemini-3.8-flash, falling back to gemini-3.1-flash-lite on a 503 /
// high-demand error, exactly like server.ts.

const SHOW_NOTES_SYSTEM =
  'You are a professional audio engineer and podcast production director. Always return valid, clean JSON with compelling, publication-ready copy.';

const SHOW_NOTES_SCHEMA = {
  type: 'OBJECT',
  properties: {
    episodeTitle: {
      type: 'STRING',
      description: 'The primary headline title for the episode.',
    },
    alternativeTitles: {
      type: 'ARRAY',
      items: { type: 'STRING' },
      description: 'Three alternative titles with different tonal hooks.',
    },
    summary: {
      type: 'STRING',
      description: 'Exactly 3 cohesive sentences summarizing the episode.',
    },
    keyTakeaways: {
      type: 'ARRAY',
      items: { type: 'STRING' },
      description: '4-6 bulleted key discussion points and actionable takeaways.',
    },
    timestamps: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          time: { type: 'STRING', description: 'Timestamp like 00:00 or 04:15' },
          title: { type: 'STRING', description: 'Chapter name' },
          description: { type: 'STRING', description: 'Brief synopsis of chapter' },
        },
        required: ['time', 'title', 'description'],
      },
      description: 'Timestamped chapter breakdown throughout the recording.',
    },
    memorableQuotes: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          speaker: { type: 'STRING' },
          quote: { type: 'STRING' },
        },
        required: ['speaker', 'quote'],
      },
      description: 'Notable quotes from the dialogue.',
    },
    socialPromo: {
      type: 'OBJECT',
      properties: {
        twitterPost: { type: 'STRING' },
        linkedinPost: { type: 'STRING' },
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
};

async function callGeminiRest(
  apiKey: string,
  model: string,
  prompt: string
): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        systemInstruction: { parts: [{ text: SHOW_NOTES_SYSTEM }] },
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: SHOW_NOTES_SCHEMA,
        },
      }),
      // The app waits up to 90s for show notes; cap the upstream call at 60s.
      signal: AbortSignal.timeout(60000),
    }
  );
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail =
      data?.error?.message || data?.error?.status || `HTTP ${res.status}`;
    throw new Error(`Gemini ${res.status}: ${detail}`);
  }
  const text =
    data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  if (!text) throw new Error('Gemini returned no text.');
  return text;
}

async function handleGenerateShowNotes(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const body: any = await request.json().catch(() => ({}));
    const {
      podcastName = 'Studio Podcast',
      topic = 'General Discussion',
      duration = 0,
      transcript = '',
      markers = [],
      hostName = 'Host',
      guestName = 'Guest',
    } = body ?? {};

    if (!env.GEMINI_API_KEY) {
      return json(
        {
          error:
            'GEMINI_API_KEY is not configured on the server. Please check the Secrets panel.',
        },
        500
      );
    }

    const mins = Math.floor(duration / 60);
    const secs = Math.floor(duration % 60);
    const formattedDuration = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

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

    let responseText: string;
    try {
      responseText = await callGeminiRest(
        env.GEMINI_API_KEY,
        'gemini-3.8-flash',
        prompt
      );
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('503') || msg.includes('high demand')) {
        responseText = await callGeminiRest(
          env.GEMINI_API_KEY,
          'gemini-3.1-flash-lite',
          prompt
        );
      } else {
        throw err;
      }
    }

    const parsedData = JSON.parse(responseText || '{}');
    return json({ success: true, data: parsedData });
  } catch (error: any) {
    console.error('Error in show notes endpoint:', error);
    return json(
      {
        success: false,
        error: error?.message || 'Failed to process show notes request',
      },
      500
    );
  }
}

// ---- Episode records (D1) -------------------------------------------------
// One row per published episode: title, YouTube video id, privacy, show
// notes. The table self-heals (CREATE TABLE IF NOT EXISTS on every call),
// the same pattern the OrthodoxConnect worker uses for fcm_tokens — no
// separate migration step is needed. The client calls this fire-and-forget
// after a successful YouTube upload; a failure here never affects the video,
// which is already live on YouTube.

const EPISODES_CREATE_SQL = `CREATE TABLE IF NOT EXISTS episodes (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, video_id TEXT NOT NULL, privacy TEXT NOT NULL DEFAULT 'unlisted', show_notes TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`;

async function handleSaveEpisode(
  request: Request,
  env: Env
): Promise<Response> {
  if (!env.DB) {
    return json(
      {
        error:
          'Episodes database is not connected yet — add the D1 binding (DB / podcraft-db) to the Worker and redeploy.',
      },
      500
    );
  }
  const body: any = await request.json().catch(() => ({}));
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  const videoId =
    typeof body?.videoId === 'string' ? body.videoId.trim() : '';
  const privacy =
    body?.privacy === 'private' || body?.privacy === 'public'
      ? body.privacy
      : 'unlisted';
  const showNotes =
    typeof body?.showNotes === 'string' ? body.showNotes : null;
  if (!title || !videoId) {
    return json({ error: 'Missing title or videoId.' }, 400);
  }
  try {
    await env.DB.prepare(EPISODES_CREATE_SQL).run();
    const result = await env.DB.prepare(
      'INSERT INTO episodes (title, video_id, privacy, show_notes) VALUES (?, ?, ?, ?)'
    )
      .bind(title, videoId, privacy, showNotes)
      .run();
    return json({ ok: true, id: result.meta?.last_row_id ?? null });
  } catch (err) {
    console.error('[podcraft worker] save episode failed:', err);
    return json({ error: 'Could not save the episode record.' }, 500);
  }
}

// ---- entry point ----------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/health' && request.method === 'GET') {
        return json({
          status: 'ok',
          hasApiKey: Boolean(env.GEMINI_API_KEY),
          timestamp: new Date().toISOString(),
        });
      }

      // Create a remote-guest invite room (Piece 1). The host calls this
      // when they tap "Invite Remote Guest"; the returned code goes in the
      // guest link. Best-effort, mark the room created in its Durable
      // Object so a guest with a wrong code gets "Room not found" instead
      // of waiting in an empty room. If that call fails, the host's join
      // auto-creates the room instead — the request never fails for it.
      if (url.pathname === '/api/rooms' && request.method === 'POST') {
        const code = generateRoomCode();
        try {
          const stub = env.ROOM.get(env.ROOM.idFromName(code));
          await stub.fetch('https://room/__init__', { method: 'POST' });
        } catch {
          // ignore — host-join auto-create covers it
        }
        return json({ code });
      }

      if (url.pathname === '/api/youtube/auth-url') {
        return handleYouTubeAuthUrl(request, env);
      }
      if (
        url.pathname === '/api/youtube/exchange' &&
        request.method === 'POST'
      ) {
        return handleYouTubeExchange(request, env);
      }
      if (
        url.pathname === '/api/youtube/refresh' &&
        request.method === 'POST'
      ) {
        return handleYouTubeRefresh(request, env);
      }

      if (
        url.pathname === '/api/generate-show-notes' &&
        request.method === 'POST'
      ) {
        return handleGenerateShowNotes(request, env);
      }

      if (url.pathname === '/api/episodes' && request.method === 'POST') {
        return handleSaveEpisode(request, env);
      }

      // Remote-guest signaling: forward the upgrade to the Room Durable
      // Object for this code. The room code rides in ?room= so the Worker
      // can route before any message arrives.
      if (url.pathname === '/ws') {
        if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
          return json(
            { error: 'Expected a WebSocket upgrade request.' },
            400
          );
        }
        const room = url.searchParams.get('room');
        if (!room) {
          return json(
            { error: 'Missing room code. Connect with /ws?room=CODE.' },
            400
          );
        }
        const stub = env.ROOM.get(env.ROOM.idFromName(room));
        return stub.fetch(request);
      }

      // Unknown /api/* path: JSON 404, not the SPA shell.
      if (url.pathname.startsWith('/api/')) {
        return json({ error: 'Not found.' }, 404);
      }

      // PWA icons (embedded base64 — see above).
      if (url.pathname === '/icon-192.png') return pngResponse(ICON_192_B64);
      if (url.pathname === '/icon-512.png') return pngResponse(ICON_512_B64);
      if (url.pathname === '/icon-512-maskable.png')
        return pngResponse(ICON_512_MASKABLE_B64);

      // Everything else → static assets. not_found_handling =
      // "single-page-application" serves dist/index.html for unknown paths,
      // so /youtube-callback and /?guest=CODE both load the app.
      return env.ASSETS.fetch(request);
    } catch (err) {
      console.error('[podcraft worker] fetch failed:', err);
      return json({ error: 'Internal server error.' }, 500);
    }
  },
};
