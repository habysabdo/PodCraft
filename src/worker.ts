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
