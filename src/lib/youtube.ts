/**
 * YouTube publish helpers (Piece 3) — one-tap publish to the user's OWN
 * YouTube channel, YouTube first (TikTok / Facebook / Instagram are later).
 *
 * How it works:
 * - OAuth 2.0 per user (scope youtube.upload). The server (server.ts) holds
 *   the Google client ID + secret in env vars and only builds the auth URL
 *   and exchanges/refreshes tokens — it never sees the video file.
 * - Tokens live in the browser (localStorage) for v1. This is a personal,
 *   local-first studio with no user accounts, so there is nowhere else to
 *   keep them. Disconnect wipes them.
 * - The video itself uploads straight from the browser to YouTube with the
 *   resumable upload protocol (videos.insert), in 4 MB chunks, with progress
 *   and resume-after-308. The local file is never sent to our server.
 *
 * Pure functions (buildVideoMetadata, parseOAuthCallback, chunkRanges) have
 * no browser dependencies so the Node logic test can import them directly.
 */

export type YouTubePrivacy = 'unlisted' | 'private' | 'public';

export interface YouTubeTokens {
  access_token: string;
  refresh_token: string | null;
  /** Epoch ms when the access token expires. */
  expires_at: number;
  scope: string;
  token_type: string;
}

export const YOUTUBE_UPLOAD_SCOPE = 'https://www.googleapis.com/auth/youtube.upload';

/** 4 MB chunks — a multiple of 256 KB, as the resumable protocol requires. */
export const YOUTUBE_CHUNK_SIZE = 4 * 1024 * 1024;

const YOUTUBE_UPLOAD_URL =
  'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';

const TOKEN_KEY = 'podcraft_youtube_tokens_v1';
const STATE_KEY = 'podcraft_youtube_oauth_state';

/** The OAuth return route. Registered in Google Cloud Console as
 *  <app origin>/youtube-callback (both localhost and the hosted URL). */
export function buildRedirectUri(): string {
  return `${window.location.origin}/youtube-callback`;
}

// ---------------------------------------------------------------------------
// Pure helpers (no browser APIs — safe to import in Node for the logic test)
// ---------------------------------------------------------------------------

/** Parse a Google OAuth redirect URL. Returns the code + state, a human
 *  error when Google refused, or null when this URL is not an OAuth return. */
export function parseOAuthCallback(
  url: string
): { code: string; state: string } | { error: string } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const err = u.searchParams.get('error');
  if (err) {
    return {
      error:
        u.searchParams.get('error_description') ||
        `Google sign-in failed (${err}). Try connecting again.`,
    };
  }
  const code = u.searchParams.get('code');
  if (!code) return null;
  return { code, state: u.searchParams.get('state') ?? '' };
}

/** Build the videos.insert request body. YouTube caps titles at 100 chars
 *  and descriptions at 5000 chars — slice, never reject, so a long AI title
 *  still publishes. Category 22 (People & Blogs) is the closest fit for a
 *  talk podcast. selfDeclaredMadeForKids:false — a podcast is not kids'
 *  content; YouTube requires the field on upload. */
export function buildVideoMetadata(
  title: string,
  description: string,
  privacy: YouTubePrivacy
) {
  return {
    snippet: {
      title: title.trim().slice(0, 100),
      description: description.trim().slice(0, 5000),
      categoryId: '22',
    },
    status: {
      privacyStatus: privacy,
      selfDeclaredMadeForKids: false,
    },
  };
}

/** Byte ranges for a resumable upload: [start, end] inclusive, contiguous,
 *  covering the whole file. Empty file → no ranges. */
export function chunkRanges(
  fileSize: number,
  chunkSize: number = YOUTUBE_CHUNK_SIZE
): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  for (let start = 0; start < fileSize; start += chunkSize) {
    ranges.push({ start, end: Math.min(start + chunkSize, fileSize) - 1 });
  }
  return ranges;
}

// ---------------------------------------------------------------------------
// Token storage (localStorage, v1 — see the header note)
// ---------------------------------------------------------------------------

export function loadTokens(): YouTubeTokens | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const t = JSON.parse(raw) as Partial<YouTubeTokens>;
    if (typeof t.access_token !== 'string') return null;
    return {
      access_token: t.access_token,
      refresh_token: typeof t.refresh_token === 'string' ? t.refresh_token : null,
      expires_at: typeof t.expires_at === 'number' ? t.expires_at : 0,
      scope: typeof t.scope === 'string' ? t.scope : YOUTUBE_UPLOAD_SCOPE,
      token_type: typeof t.token_type === 'string' ? t.token_type : 'Bearer',
    };
  } catch {
    return null;
  }
}

export function saveTokens(tokens: YouTubeTokens): void {
  try {
    localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
  } catch {
    // Private mode / full storage — the upload will fail on the next load
    // with "Connect YouTube first", which is the honest signal.
  }
}

export function clearTokens(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
}

/** Expired, or expiring within 60s (clock skew + a slow upload start). */
export function isTokenExpired(tokens: YouTubeTokens): boolean {
  return Date.now() >= tokens.expires_at - 60_000;
}

// ---------------------------------------------------------------------------
// Server calls (the server holds the Google client ID + secret in env)
// ---------------------------------------------------------------------------

async function postJson(path: string, body: unknown): Promise<any> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      typeof data?.error === 'string' ? data.error : `Server error (${res.status}).`
    );
  }
  return data;
}

/** Ask the server for the Google sign-in link, then go there. On success
 *  this navigates away to Google; on failure it throws a human message
 *  (e.g. the server is missing GOOGLE_CLIENT_ID). */
export async function connectYouTube(): Promise<void> {
  const redirectUri = buildRedirectUri();
  const state =
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `state-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    sessionStorage.setItem(STATE_KEY, state);
  } catch {
    // ignore — the state check will fail on return and say so clearly.
  }
  const res = await fetch(
    `/api/youtube/auth-url?redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      typeof data?.error === 'string'
        ? data.error
        : 'Could not get the Google sign-in link.'
    );
  }
  if (typeof data?.authUrl !== 'string') {
    throw new Error('The server did not return a Google sign-in link.');
  }
  window.location.href = data.authUrl;
}

/** Exchange the ?code= from the Google redirect for tokens. */
export async function exchangeCode(code: string): Promise<YouTubeTokens> {
  const data = await postJson('/api/youtube/exchange', {
    code,
    redirect_uri: buildRedirectUri(),
  });
  if (typeof data?.access_token !== 'string') {
    throw new Error('Google did not return an access token.');
  }
  const tokens: YouTubeTokens = {
    access_token: data.access_token,
    refresh_token: typeof data.refresh_token === 'string' ? data.refresh_token : null,
    expires_at:
      Date.now() + (typeof data.expires_in === 'number' ? data.expires_in : 3600) * 1000,
    scope: typeof data.scope === 'string' ? data.scope : YOUTUBE_UPLOAD_SCOPE,
    token_type: typeof data.token_type === 'string' ? data.token_type : 'Bearer',
  };
  saveTokens(tokens);
  return tokens;
}

/** Trade the stored refresh token for a fresh access token. */
export async function refreshAccessToken(): Promise<YouTubeTokens> {
  const current = loadTokens();
  if (!current?.refresh_token) {
    throw new Error('Your YouTube connection expired — reconnect YouTube.');
  }
  const data = await postJson('/api/youtube/refresh', {
    refresh_token: current.refresh_token,
  });
  if (typeof data?.access_token !== 'string') {
    throw new Error('Google did not return a fresh access token.');
  }
  const tokens: YouTubeTokens = {
    ...current,
    access_token: data.access_token,
    expires_at:
      Date.now() + (typeof data.expires_in === 'number' ? data.expires_in : 3600) * 1000,
  };
  saveTokens(tokens);
  return tokens;
}

/** A usable access token, refreshing first when it is expired. */
export async function getValidAccessToken(): Promise<string> {
  const tokens = loadTokens();
  if (!tokens) throw new Error('Connect YouTube first.');
  if (isTokenExpired(tokens)) {
    const fresh = await refreshAccessToken();
    return fresh.access_token;
  }
  return tokens.access_token;
}

// ---------------------------------------------------------------------------
// OAuth return (called by the /youtube-callback screen in App.tsx)
// ---------------------------------------------------------------------------

export interface CallbackResult {
  ok: boolean;
  message: string;
}

export async function handleYouTubeCallback(): Promise<CallbackResult> {
  const parsed = parseOAuthCallback(window.location.href);
  if (!parsed) {
    return {
      ok: false,
      message: 'No sign-in code found in the link — try connecting again.',
    };
  }
  if ('error' in parsed) {
    return { ok: false, message: parsed.error };
  }
  let savedState: string | null = null;
  try {
    savedState = sessionStorage.getItem(STATE_KEY);
    sessionStorage.removeItem(STATE_KEY);
  } catch {
    // ignore
  }
  if (!savedState || savedState !== parsed.state) {
    return {
      ok: false,
      message:
        'The sign-in did not match this browser tab — try connecting again.',
    };
  }
  try {
    await exchangeCode(parsed.code);
    return {
      ok: true,
      message: 'YouTube connected — back to the studio to publish.',
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : 'Could not finish connecting YouTube.',
    };
  }
}

// ---------------------------------------------------------------------------
// Resumable upload (videos.insert, straight from the browser to YouTube)
// ---------------------------------------------------------------------------

export interface UploadProgress {
  sent: number;
  total: number;
}

async function googleErrorMessage(res: Response): Promise<string> {
  try {
    const data = await res.json();
    const msg = data?.error?.message;
    if (typeof msg === 'string' && msg) return `YouTube said: ${msg}`;
  } catch {
    // not JSON — fall through
  }
  return `YouTube upload failed (HTTP ${res.status}).`;
}

const MAX_CHUNK_ATTEMPTS = 3;

/** Upload a file to the user's own channel. Returns the YouTube video id.
 *  Throws on cancel (AbortError), on auth failure, or on a stalled upload.
 *  The local file is never sent anywhere except YouTube. */
export async function uploadToYouTube(
  file: Blob,
  meta: ReturnType<typeof buildVideoMetadata>,
  onProgress: (p: UploadProgress) => void,
  signal: AbortSignal
): Promise<string> {
  const total = file.size;
  if (total <= 0) {
    throw new Error('Nothing to upload — the file is empty.');
  }
  const mimeType = file.type || 'video/webm';
  let token = await getValidAccessToken();

  // 1. Start a resumable session — Google answers with the session URL.
  const initiate = async (accessToken: string): Promise<string> => {
    const res = await fetch(YOUTUBE_UPLOAD_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mimeType,
        'X-Upload-Content-Length': String(total),
      },
      body: JSON.stringify(meta),
      signal,
    });
    if (res.status === 401) {
      const err = new Error('unauthorized') as Error & { code?: number };
      err.code = 401;
      throw err;
    }
    if (!res.ok) throw new Error(await googleErrorMessage(res));
    const location = res.headers.get('Location');
    if (!location) {
      throw new Error('YouTube did not return an upload session — try again.');
    }
    return location;
  };

  let sessionUrl: string;
  try {
    sessionUrl = await initiate(token);
  } catch (err) {
    if ((err as { code?: number }).code === 401) {
      token = (await refreshAccessToken()).access_token;
      sessionUrl = await initiate(token);
    } else {
      throw err;
    }
  }

  // 2. Send the file chunk by chunk. A 308 means "got it so far" — read the
  // Range header and continue from there, so a network blip resumes instead
  // of restarting. A 401 mid-upload refreshes the token and retries the chunk.
  // A chunk that keeps failing (transient 5xx, network drop, or a 308 that
  // acks nothing) is retried a few times, then the upload stops with a clear
  // error — the local file is never touched.
  const putChunk = async (
    start: number,
    end: number,
    chunk: Blob
  ): Promise<Response> => {
    const headers = (): Record<string, string> => ({
      Authorization: `Bearer ${token}`,
      'Content-Type': mimeType,
      'Content-Range': `bytes ${start}-${end}/${total}`,
    });
    let res = await fetch(sessionUrl, {
      method: 'PUT',
      headers: headers(),
      body: chunk,
      signal,
    });
    if (res.status === 401) {
      token = (await refreshAccessToken()).access_token;
      res = await fetch(sessionUrl, {
        method: 'PUT',
        headers: headers(),
        body: chunk,
        signal,
      });
    }
    return res;
  };

  let nextByte = 0;
  let attemptsAtPosition = 0;
  while (nextByte < total) {
    if (signal.aborted) {
      throw new DOMException('Upload cancelled.', 'AbortError');
    }
    const end = Math.min(nextByte + YOUTUBE_CHUNK_SIZE, total) - 1;
    const chunk = file.slice(nextByte, end + 1);
    let res: Response;
    try {
      res = await putChunk(nextByte, end, chunk);
    } catch (err) {
      if (signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
        throw err;
      }
      attemptsAtPosition += 1;
      if (attemptsAtPosition >= MAX_CHUNK_ATTEMPTS) {
        throw new Error(
          'The connection to YouTube dropped — your local file is safe, try publishing again.'
        );
      }
      continue;
    }
    if (res.status === 200 || res.status === 201) {
      const data = await res.json().catch(() => ({}));
      if (typeof data?.id !== 'string') {
        throw new Error(
          'YouTube finished the upload but did not return a video id.'
        );
      }
      onProgress({ sent: total, total });
      return data.id;
    }
    if (res.status === 308) {
      const rangeHeader = res.headers.get('Range');
      const match = rangeHeader ? /bytes=0-(\d+)/.exec(rangeHeader) : null;
      const acked = match ? parseInt(match[1], 10) + 1 : end + 1;
      if (acked > nextByte) {
        nextByte = acked;
        attemptsAtPosition = 0;
      } else {
        attemptsAtPosition += 1;
        if (attemptsAtPosition >= MAX_CHUNK_ATTEMPTS) {
          throw new Error(
            'The upload stalled — YouTube stopped accepting data. Your local file is safe, try publishing again.'
          );
        }
      }
      onProgress({ sent: nextByte, total });
      continue;
    }
    // Any other status (e.g. transient 500/503) — retry the same chunk.
    attemptsAtPosition += 1;
    if (attemptsAtPosition >= MAX_CHUNK_ATTEMPTS) {
      throw new Error(await googleErrorMessage(res));
    }
  }

  // Reached only if every chunk 308'd without a final 200 — ask Google where
  // the upload stands with an empty resume probe.
  const probe = await fetch(sessionUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Length': '0',
      'Content-Range': `bytes */${total}`,
    },
    signal,
  });
  if (probe.status === 200 || probe.status === 201) {
    const data = await probe.json().catch(() => ({}));
    if (typeof data?.id === 'string') return data.id;
  }
  throw new Error(
    'The upload did not finish on YouTube — your local file is safe, try publishing again.'
  );
}
