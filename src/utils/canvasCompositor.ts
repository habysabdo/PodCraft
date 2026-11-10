import { LayoutMode, StudioBranding, VideoFilterSettings } from '../types/studio';

export function getCssFilterString(filters: VideoFilterSettings): string {
  const parts: string[] = [];

  if (filters.backgroundBlur) {
    parts.push('blur(10px)');
  }

  if (filters.brightness !== 100) {
    parts.push(`brightness(${filters.brightness}%)`);
  } else if (!filters.backgroundBlur && !filters.grayscale && filters.warmth === 0 && filters.contrast === 100 && filters.saturation === 100) {
    parts.push('brightness(100%)');
  }

  if (filters.contrast !== 100) {
    parts.push(`contrast(${filters.contrast}%)`);
  }

  if (filters.saturation !== 100) {
    parts.push(`saturate(${filters.saturation}%)`);
  }

  if (filters.grayscale) {
    parts.push('grayscale(100%)');
  }

  if (filters.warmth > 0) {
    // Warmth is simulated via slight sepia + hue-rotate warmth
    const sepiaVal = Math.min(60, filters.warmth * 0.5);
    parts.push(`sepia(${sepiaVal}%)`);
  }

  return parts.length > 0 ? parts.join(' ') : 'none';
}

export interface DrawFrameOptions {
  canvas: HTMLCanvasElement;
  hostVideo: HTMLVideoElement | null;
  guestVideo: HTMLVideoElement | null;
  mediaVideo?: HTMLVideoElement | null;
  mediaTitle?: string;
  layout: LayoutMode;
  hostFilters: VideoFilterSettings;
  guestFilters: VideoFilterSettings;
  hostName: string;
  guestName: string;
  branding: StudioBranding;
  isRecording: boolean;
  recordingTimeSeconds: number;
  hostActiveLevel: number;
  guestActiveLevel: number;
}

export function drawStudioFrame(options: DrawFrameOptions): void {
  const {
    canvas,
    hostVideo,
    guestVideo,
    mediaVideo,
    mediaTitle = 'REACTION MEDIA',
    layout,
    hostFilters,
    guestFilters,
    hostName,
    guestName,
    branding,
    isRecording,
    recordingTimeSeconds,
    hostActiveLevel,
    guestActiveLevel,
  } = options;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const width = canvas.width;
  const height = canvas.height;

  // Clear & background
  ctx.save();
  ctx.filter = 'none';

  // Studio background: Deep noir gradient with subtle studio lighting
  const bgGrad = ctx.createRadialGradient(
    width / 2,
    height / 2,
    100,
    width / 2,
    height / 2,
    width * 0.8
  );
  bgGrad.addColorStop(0, '#131623');
  bgGrad.addColorStop(0.5, '#0c0e17');
  bgGrad.addColorStop(1, '#05060a');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  // Subtle studio grid line overlay
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.025)';
  ctx.lineWidth = 1;
  const step = 80;
  for (let x = 0; x < width; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y < height; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  // Draw layouts
  if (layout === 'side-by-side') {
    // Two 16:9 slots side by side with modern framing
    const margin = 48;
    const gap = 36;
    const availableW = width - margin * 2 - gap;
    const slotW = availableW / 2;
    const slotH = (slotW * 9) / 16;
    const slotY = (height - slotH) / 2 - 20;

    // Host Box (Left)
    drawVideoSlot(
      ctx,
      hostVideo,
      margin,
      slotY,
      slotW,
      slotH,
      hostFilters,
      hostName,
      'HOST',
      hostActiveLevel > 0.15
    );

    // Guest Box (Right)
    drawVideoSlot(
      ctx,
      guestVideo,
      margin + slotW + gap,
      slotY,
      slotW,
      slotH,
      guestFilters,
      guestName,
      'GUEST',
      guestActiveLevel > 0.15
    );
  } else if (layout === 'pip') {
    // Main video (Host) full screen
    drawFullBleedVideo(ctx, hostVideo, width, height, hostFilters);

    // Picture-in-picture Inset (Guest) in bottom-right
    const pipW = 480;
    const pipH = (pipW * 9) / 16;
    const pipX = width - pipW - 48;
    const pipY = height - pipH - 64;

    // PiP drop shadow
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.7)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 8;
    drawVideoSlot(
      ctx,
      guestVideo,
      pipX,
      pipY,
      pipW,
      pipH,
      guestFilters,
      guestName,
      'GUEST',
      guestActiveLevel > 0.15
    );
    ctx.restore();
  } else if (layout === 'reaction-split') {
    // Media (70%) on left, Host (30%) on right
    const margin = 48;
    const gap = 32;
    const availableW = width - margin * 2 - gap;
    const mediaW = Math.round(availableW * 0.70);
    const hostW = availableW - mediaW;
    const mediaH = (mediaW * 9) / 16;
    const slotY = (height - mediaH) / 2 - 15;

    // Media Video slot (Left)
    drawVideoSlot(
      ctx,
      mediaVideo || null,
      margin,
      slotY,
      mediaW,
      mediaH,
      { brightness: 100, contrast: 100, saturation: 100, warmth: 0, grayscale: false },
      mediaTitle,
      'MEDIA',
      false
    );

    // Host Webcam slot (Right) - tall portrait reaction box
    drawVideoSlot(
      ctx,
      hostVideo,
      margin + mediaW + gap,
      slotY,
      hostW,
      mediaH,
      hostFilters,
      hostName,
      'HOST',
      hostActiveLevel > 0.15
    );
  } else if (layout === 'reaction-pip') {
    // Media Video fills background full screen
    const defaultMediaFilters = { brightness: 100, contrast: 100, saturation: 100, warmth: 0, grayscale: false };
    drawFullBleedVideo(ctx, mediaVideo || null, width, height, defaultMediaFilters);

    // Host Webcam pinned in bottom-right corner
    const pipW = 460;
    const pipH = (pipW * 9) / 16;
    const pipX = width - pipW - 48;
    const pipY = height - pipH - 64;

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 28;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 10;
    drawVideoSlot(
      ctx,
      hostVideo,
      pipX,
      pipY,
      pipW,
      pipH,
      hostFilters,
      hostName,
      'HOST',
      hostActiveLevel > 0.15
    );
    ctx.restore();
  } else if (layout === 'solo-host') {
    drawFullBleedVideo(ctx, hostVideo, width, height, hostFilters);
    // Draw subtle host lower badge
    drawSoloNameplate(ctx, hostName, 'HOST', 48, height - 120, hostActiveLevel > 0.15);
  } else if (layout === 'solo-guest') {
    drawFullBleedVideo(ctx, guestVideo, width, height, guestFilters);
    // Draw subtle guest lower badge
    drawSoloNameplate(ctx, guestName, 'GUEST', 48, height - 120, guestActiveLevel > 0.15);
  }

  // Draw Lower Third overlay if enabled
  if (branding.showLowerThird) {
    drawLowerThirdBanner(ctx, width, height, branding);
  }

  // Draw Recording Indicator & Timecode (top right)
  drawRecordingIndicator(ctx, width, isRecording, recordingTimeSeconds);

  // Draw Top Studio Header watermark (top left)
  drawStudioHeader(ctx, branding.podcastName);

  ctx.restore();
}

function drawVideoSlot(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement | null,
  x: number,
  y: number,
  w: number,
  h: number,
  filters: VideoFilterSettings,
  name: string,
  role: string,
  isSpeaking: boolean
): void {
  const radius = 16;

  // Clip to rounded rectangle
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  ctx.clip();

  // Background for slot
  ctx.fillStyle = '#111420';
  ctx.fillRect(x, y, w, h);

  if (video && video.videoWidth > 0 && video.readyState >= 1) {
    if (filters.backgroundBlur && !filters.grayscale && filters.warmth === 0 && filters.brightness === 100 && filters.contrast === 100 && filters.saturation === 100) {
      ctx.filter = 'blur(10px)';
    } else {
      ctx.filter = getCssFilterString(filters);
    }

    // Compute center-crop (cover fit)
    const vw = video.videoWidth || 1280;
    const vh = video.videoHeight || 720;
    const slotAspect = w / h;
    const videoAspect = vw / vh;

    let sx = 0,
      sy = 0,
      sWidth = vw,
      sHeight = vh;
    if (videoAspect > slotAspect) {
      sWidth = vh * slotAspect;
      sx = (vw - sWidth) / 2;
    } else {
      sHeight = vw / slotAspect;
      sy = (vh - sHeight) / 2;
    }

    if (filters.mirror) {
      ctx.save();
      ctx.translate(x + w, y);
      ctx.scale(-1, 1);
      ctx.drawImage(video, sx, sy, sWidth, sHeight, 0, 0, w, h);
      ctx.restore();
    } else {
      ctx.drawImage(video, sx, sy, sWidth, sHeight, x, y, w, h);
    }
    ctx.filter = 'none';
  } else {
    // Placeholder feed graphic
    ctx.filter = 'none';
    ctx.fillStyle = '#181b29';
    ctx.fillRect(x, y, w, h);

    ctx.fillStyle = '#4b5563';
    ctx.font = '600 24px "Plus Jakarta Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${name} (${role})`, x + w / 2, y + h / 2 - 12);
    ctx.font = '400 16px "JetBrains Mono", monospace';
    ctx.fillStyle = '#6b7280';
    ctx.fillText('NO VIDEO FEED CONNECTED', x + w / 2, y + h / 2 + 20);
  }

  // Subtle inner gradient vignette
  const vignette = ctx.createLinearGradient(x, y + h - 100, x, y + h);
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vignette.addColorStop(1, 'rgba(0, 0, 0, 0.7)');
  ctx.fillStyle = vignette;
  ctx.fillRect(x, y + h - 100, x + w, 100);

  ctx.restore();

  // Outer border with speech reactivity glow
  ctx.save();
  if (isSpeaking) {
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 4;
    ctx.shadowColor = 'rgba(59, 130, 246, 0.6)';
    ctx.shadowBlur = 18;
  } else {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 2;
  }
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  ctx.stroke();
  ctx.restore();

  // Name tag badge in bottom-left of slot
  ctx.save();
  const badgeX = x + 18;
  const badgeY = y + h - 44;
  const badgeH = 28;

  ctx.font = '700 14px "Plus Jakarta Sans", sans-serif';
  const nameWidth = ctx.measureText(name).width;
  ctx.font = '600 11px "JetBrains Mono", monospace';
  const roleWidth = ctx.measureText(role).width;
  const badgeW = nameWidth + roleWidth + 36;

  // Badge pill
  ctx.fillStyle = 'rgba(12, 14, 22, 0.85)';
  ctx.beginPath();
  ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 6);
  ctx.fill();

  ctx.strokeStyle = isSpeaking ? '#3b82f6' : 'rgba(255, 255, 255, 0.15)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Speaking indicator dot
  ctx.fillStyle = isSpeaking ? '#22c55e' : '#6b7280';
  ctx.beginPath();
  ctx.arc(badgeX + 12, badgeY + badgeH / 2, 4, 0, Math.PI * 2);
  ctx.fill();

  // Name
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 13px "Plus Jakarta Sans", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(name, badgeX + 22, badgeY + 18);

  // Role pill
  ctx.fillStyle = '#38bdf8';
  ctx.font = '700 10px "JetBrains Mono", monospace';
  ctx.fillText(role, badgeX + 22 + nameWidth + 8, badgeY + 18);

  ctx.restore();
}

function drawFullBleedVideo(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement | null,
  width: number,
  height: number,
  filters: VideoFilterSettings
): void {
  if (video && video.videoWidth > 0 && video.readyState >= 1) {
    ctx.save();
    if (filters.backgroundBlur && !filters.grayscale && filters.warmth === 0 && filters.brightness === 100 && filters.contrast === 100 && filters.saturation === 100) {
      ctx.filter = 'blur(10px)';
    } else {
      ctx.filter = getCssFilterString(filters);
    }

    const vw = video.videoWidth || 1280;
    const vh = video.videoHeight || 720;
    const slotAspect = width / height;
    const videoAspect = vw / vh;

    let sx = 0,
      sy = 0,
      sWidth = vw,
      sHeight = vh;
    if (videoAspect > slotAspect) {
      sWidth = vh * slotAspect;
      sx = (vw - sWidth) / 2;
    } else {
      sHeight = vw / slotAspect;
      sy = (vh - sHeight) / 2;
    }

    if (filters.mirror) {
      ctx.save();
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, sx, sy, sWidth, sHeight, 0, 0, width, height);
      ctx.restore();
    } else {
      ctx.drawImage(video, sx, sy, sWidth, sHeight, 0, 0, width, height);
    }
    ctx.restore();
  } else {
    ctx.fillStyle = '#0f121d';
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = '#6b7280';
    ctx.font = '600 28px "Plus Jakarta Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('NO LIVE FEED AVAILABLE', width / 2, height / 2);
  }
}

function drawSoloNameplate(
  ctx: CanvasRenderingContext2D,
  name: string,
  role: string,
  x: number,
  y: number,
  isSpeaking: boolean
): void {
  ctx.save();
  ctx.fillStyle = 'rgba(15, 18, 28, 0.88)';
  ctx.beginPath();
  ctx.roundRect(x, y, 260, 48, 8);
  ctx.fill();

  ctx.strokeStyle = isSpeaking ? '#3b82f6' : 'rgba(255, 255, 255, 0.2)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Speaker dot
  ctx.fillStyle = isSpeaking ? '#22c55e' : '#64748b';
  ctx.beginPath();
  ctx.arc(x + 20, y + 24, 5, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.font = '700 16px "Plus Jakarta Sans", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(name, x + 34, y + 24);

  ctx.fillStyle = '#38bdf8';
  ctx.font = '600 11px "JetBrains Mono", monospace';
  ctx.fillText(role, x + 34, y + 40);

  ctx.restore();
}

function drawLowerThirdBanner(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  branding: StudioBranding
): void {
  const x = 48;
  const y = height - 96;
  const bannerW = 680;
  const bannerH = 58;

  ctx.save();
  // Backdrop
  const grad = ctx.createLinearGradient(x, y, x + bannerW, y);
  grad.addColorStop(0, 'rgba(10, 12, 18, 0.95)');
  grad.addColorStop(0.8, 'rgba(15, 20, 32, 0.9)');
  grad.addColorStop(1, 'rgba(15, 20, 32, 0.1)');

  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.roundRect(x, y, bannerW, bannerH, 8);
  ctx.fill();

  // Left accent line
  ctx.fillStyle = branding.themeColor || '#6366f1';
  ctx.fillRect(x, y, 5, bannerH);

  // Podcast tag
  ctx.fillStyle = '#94a3b8';
  ctx.font = '700 11px "JetBrains Mono", monospace';
  ctx.textAlign = 'left';
  ctx.fillText(branding.podcastName.toUpperCase(), x + 20, y + 20);

  // Episode title
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 18px "Plus Jakarta Sans", sans-serif';
  ctx.fillText(branding.episodeTitle, x + 20, y + 44);

  ctx.restore();
}

function drawStudioHeader(ctx: CanvasRenderingContext2D, podcastName: string): void {
  ctx.save();
  const x = 48;
  const y = 48;

  // Top studio logo badge
  ctx.fillStyle = 'rgba(15, 17, 26, 0.75)';
  ctx.beginPath();
  ctx.roundRect(x, y, 220, 34, 6);
  ctx.fill();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Mic glyph / dot
  ctx.fillStyle = '#6366f1';
  ctx.beginPath();
  ctx.arc(x + 16, y + 17, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.font = '700 13px "Plus Jakarta Sans", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(podcastName, x + 28, y + 22);

  ctx.restore();
}

function drawRecordingIndicator(
  ctx: CanvasRenderingContext2D,
  width: number,
  isRecording: boolean,
  recordingTimeSeconds: number
): void {
  ctx.save();
  const boxW = 190;
  const boxH = 36;
  const x = width - boxW - 48;
  const y = 48;

  ctx.fillStyle = isRecording ? 'rgba(220, 38, 38, 0.2)' : 'rgba(30, 41, 59, 0.6)';
  ctx.beginPath();
  ctx.roundRect(x, y, boxW, boxH, 6);
  ctx.fill();

  ctx.strokeStyle = isRecording ? 'rgba(239, 68, 68, 0.6)' : 'rgba(255, 255, 255, 0.15)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Pulsing dot if recording
  if (isRecording) {
    const pulse = Math.abs(Math.sin(Date.now() / 300));
    ctx.fillStyle = `rgba(239, 68, 68, ${0.4 + pulse * 0.6})`;
    ctx.beginPath();
    ctx.arc(x + 18, y + 18, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ef4444';
    ctx.font = '800 12px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText('REC', x + 30, y + 22);
  } else {
    ctx.fillStyle = '#64748b';
    ctx.beginPath();
    ctx.arc(x + 18, y + 18, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#94a3b8';
    ctx.font = '700 11px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText('STANDBY', x + 28, y + 22);
  }

  // Timer format (HH:MM:SS)
  const hrs = Math.floor(recordingTimeSeconds / 3600);
  const mins = Math.floor((recordingTimeSeconds % 3600) / 60);
  const secs = Math.floor(recordingTimeSeconds % 60);
  const timeString = `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  ctx.fillStyle = '#ffffff';
  ctx.font = '700 13px "JetBrains Mono", monospace';
  ctx.textAlign = 'right';
  ctx.fillText(timeString, x + boxW - 14, y + 22);

  ctx.restore();
}
