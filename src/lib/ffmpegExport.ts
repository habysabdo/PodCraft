/**
 * Lazy MP4 export for PodCraft Piece 2.
 *
 * ffmpeg.wasm is loaded ON DEMAND only — the first time the user picks
 * "Export as MP4". Nothing ffmpeg-related is in the studio's first-load
 * bundle: the @ffmpeg packages are imported dynamically (Vite code-splits
 * them into a separate chunk) and the core (ffmpeg-core.js/.wasm) is fetched
 * from the unpkg CDN at first use and cached as blob URLs.
 *
 * Package / core choice (documented):
 *  - npm: @ffmpeg/ffmpeg ^0.12.0, @ffmpeg/util ^0.12.0 (0.12 line)
 *  - core: @ffmpeg/core@0.12.10, SINGLE-THREADED ESM build
 *    (https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.js)
 *    The single-threaded core does NOT need SharedArrayBuffer, so no
 *    COOP/COEP headers are required on the host. The multi-threaded
 *    core-mt build is deliberately NOT used.
 *  - transcode: libx264 (veryfast, CRF 23) + AAC 128k, yuv420p (plays
 *    everywhere), +faststart (streams while downloading).
 *
 * If the load fails (offline, CDN blocked), the caller gets a clear error
 * and should offer the WebM export instead — MP4 never blocks editing.
 */

import type { FFmpeg } from '@ffmpeg/ffmpeg';

const CORE_VERSION = '0.12.10';
const CORE_BASE = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/esm`;

let ffmpegPromise: Promise<FFmpeg> | null = null;
let ffmpegLoaded = false;

export function isFfmpegLoaded(): boolean {
  return ffmpegLoaded;
}

/**
 * Load ffmpeg on first use. Returns a shared instance. Throws a
 * human-readable error when the CDN cannot be reached.
 */
export async function loadFfmpeg(): Promise<FFmpeg> {
  if (ffmpegPromise) return ffmpegPromise;

  ffmpegPromise = (async () => {
    let FFmpegClass: typeof FFmpeg;
    let fetchFile: (data: string | File | Blob) => Promise<Uint8Array>;
    let toBlobURL: (url: string, mimeType: string) => Promise<string>;
    try {
      const ffmpegMod = await import('@ffmpeg/ffmpeg');
      const utilMod = await import('@ffmpeg/util');
      FFmpegClass = ffmpegMod.FFmpeg;
      fetchFile = utilMod.fetchFile;
      toBlobURL = utilMod.toBlobURL;
    } catch {
      throw new Error(
        'Could not load the MP4 converter code. Check your connection and try again, or export WebM instead.'
      );
    }

    const ffmpeg = new FFmpegClass();
    try {
      const [coreURL, wasmURL] = await Promise.all([
        toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
        toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
      ]);
      await ffmpeg.load({ coreURL, wasmURL });
    } catch {
      throw new Error(
        'Could not download the MP4 converter (ffmpeg core). Check your connection and try again, or export WebM instead.'
      );
    }
    ffmpegLoaded = true;
    return ffmpeg;
  })();

  // Allow a retry after a failed load instead of caching the rejection.
  ffmpegPromise.catch(() => {
    ffmpegPromise = null;
  });
  return ffmpegPromise;
}

export interface Mp4Result {
  blob: Blob;
  filename: string;
}

/**
 * Transcode an edited WebM blob to MP4 (H.264 + AAC).
 * `onProgress` receives 0..1 of the transcode only (not the edit render).
 */
export async function transcodeWebmToMp4(
  webm: Blob,
  baseFilename: string,
  onProgress?: (fraction: number) => void
): Promise<Mp4Result> {
  const ffmpeg = await loadFfmpeg();
  const { fetchFile } = await import('@ffmpeg/util');

  const inName = 'podcraft-input.webm';
  const outName = 'podcraft-output.mp4';
  try {
    await ffmpeg.writeFile(inName, await fetchFile(webm));
  } catch {
    throw new Error('Could not read the edited video for MP4 conversion.');
  }

  const onFfmpegProgress = ({ progress }: { progress: number }) => {
    onProgress?.(Math.max(0, Math.min(1, progress)));
  };
  ffmpeg.on('progress', onFfmpegProgress);
  try {
    await ffmpeg.exec([
      '-i',
      inName,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '23',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-movflags',
      '+faststart',
      outName,
    ]);
  } catch {
    throw new Error('MP4 conversion failed. Your edited WebM is still fine — export WebM instead.');
  } finally {
    ffmpeg.off('progress', onFfmpegProgress);
  }

  let data: Uint8Array | string;
  try {
    data = await ffmpeg.readFile(outName);
  } catch {
    throw new Error('MP4 conversion finished but the file could not be read. Export WebM instead.');
  } finally {
    await ffmpeg.deleteFile(inName).catch(() => {});
    await ffmpeg.deleteFile(outName).catch(() => {});
  }

  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  // Copy into a fresh Uint8Array so the buffer type satisfies BlobPart
  // under TS 7's generic typed arrays.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const filename = baseFilename.replace(/\.webm$/i, '').replace(/\.[a-z0-9]+$/i, '') + '.mp4';
  return { blob: new Blob([copy], { type: 'video/mp4' }), filename };
}
