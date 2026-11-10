export type EmbedMediaType = 'youtube' | 'direct-video' | 'facebook' | 'web-embed';

export interface DetectedMedia {
  type: EmbedMediaType;
  rawUrl: string;
  embedUrl: string;
  videoId?: string;
  title: string;
}

/**
 * Detects whether a URL is a YouTube link, Facebook video, direct MP4/WebM file, or generic web video.
 * Formats responsive embed URLs with autoplay and JS API enabled.
 */
export function detectAndParseMediaUrl(inputUrl: string): DetectedMedia {
  const url = inputUrl.trim();

  // 1. YouTube Detection
  // Matches youtu.be/<id>, youtube.com/watch?v=<id>, youtube.com/embed/<id>, youtube.com/shorts/<id>, youtube.com/live/<id>
  const ytRegex = /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/|live\/))([a-zA-Z0-9_-]{11})/;
  const ytMatch = url.match(ytRegex);
  if (ytMatch && ytMatch[1]) {
    const videoId = ytMatch[1];
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const embedUrl = `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&enablejsapi=1&rel=0&modestbranding=1&origin=${encodeURIComponent(origin)}`;
    return {
      type: 'youtube',
      rawUrl: url,
      embedUrl,
      videoId,
      title: `YouTube (${videoId})`,
    };
  }

  // 2. Direct Video File (.mp4, .webm, .ogg, .mov, .m4v)
  const cleanPath = url.split('?')[0].toLowerCase();
  const isDirectFile =
    cleanPath.endsWith('.mp4') ||
    cleanPath.endsWith('.webm') ||
    cleanPath.endsWith('.ogg') ||
    cleanPath.endsWith('.mov') ||
    cleanPath.endsWith('.m4v');

  if (isDirectFile) {
    const filename = url.split('/').pop()?.split('?')[0] || 'Direct Video File';
    return {
      type: 'direct-video',
      rawUrl: url,
      embedUrl: url,
      title: filename,
    };
  }

  // 3. Facebook Video Detection
  if (url.includes('facebook.com') || url.includes('fb.watch')) {
    const fbEmbedUrl = `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url)}&show_text=false&autoplay=true&t=0`;
    return {
      type: 'facebook',
      rawUrl: url,
      embedUrl: fbEmbedUrl,
      title: 'Facebook Video Stream',
    };
  }

  // 4. Vimeo Detection (Bonus enhancement)
  const vimeoMatch = url.match(/vimeo\.com\/(?:channels\/(?:\w+\/)?|groups\/([^\/]*)\/videos\/|album\/(\d+)\/video\/|)(\d+)/);
  if (vimeoMatch && vimeoMatch[3]) {
    const vimeoId = vimeoMatch[3];
    return {
      type: 'web-embed',
      rawUrl: url,
      embedUrl: `https://player.vimeo.com/video/${vimeoId}?autoplay=1`,
      title: `Vimeo (${vimeoId})`,
    };
  }

  // 5. Generic Web Embed / Video Player URL
  return {
    type: 'web-embed',
    rawUrl: url,
    embedUrl: url,
    title: url.replace(/^https?:\/\//, '').split('/')[0] || 'Web Video',
  };
}
