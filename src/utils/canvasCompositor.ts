import { LayoutMode, StudioBranding, VideoFilterSettings } from '../types/studio';

export function getCssFilterString(filters: VideoFilterSettings): string {
  const parts: string[] = [];

  if (filters.backgroundBlur) {
    parts.push('blur(10px)');
  }

  if (filters.brightness !== 100) {
    parts.push(`brightness(${filters.brightness}%)`);
  } else if (
    !filters.backgroundBlur &&
    !filters.grayscale &&
    filters.warmth === 0 &&
    filters.contrast === 100 &&
    filters.saturation === 100
  ) {
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
    const sepiaVal = Math.min(60, filters.warmth * 0.5);
    parts.push(`sepia(${sepiaVal}%)`);
  }

  return parts.length > 0 ? parts.join(' ') : 'none';
}

export interface DrawFrameOptions {
  canvas: HTMLCanvasElement;
  hostVideo: HTMLVideoElement | null;
  mediaVideo?: HTMLVideoElement | null;
  mediaTitle?: string;
  layout: LayoutMode;
  hostFilters: VideoFilterSettings;
  hostName: string;
  branding: StudioBranding;
  isRecording: boolean;
  recordingTimeSeconds: number;
  hostActiveLevel: number;
  fadeBlackAlpha?: number;
}

export function drawStudioFrame(options: DrawFrameOptions): void {
  const {
    canvas,
    hostVideo,
    mediaVideo,
    mediaTitle = 'REACTION MEDIA',
    layout,
    hostFilters,
    hostName,
    branding,
    isRecording,
    recordingTimeSeconds,
    hostActiveLevel,
    fadeBlackAlpha = 0,
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

  // Draw Single-Host or Audience Dual-View Layouts
  if (layout === 'reaction-split') {
    // Added video on the left (70% width), Host webcam on the right (30% width)
    const margin = 48;
    const gap = 32;
    const availableW = width - margin * 2 - gap;
    const mediaW = Math.round(availableW * 0.70);
    const hostW = availableW - mediaW;
    const mediaH = (mediaW * 9) / 16;
    const slotY = (height - mediaH) / 2 - 15;

    // Added Media Slot (Left 70%)
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
      false,
      'contain'
    );

    // Host Webcam Slot (Right 30%)
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
      hostActiveLevel > 0.15,
      'cover'
    );
  } else if (layout === 'reaction-pip') {
    // Added video fills the background (100%), Host webcam framed in bottom-right corner
    const defaultMediaFilters: VideoFilterSettings = {
      brightness: 100,
      contrast: 100,
      saturation: 100,
      warmth: 0,
      grayscale: false,
    };
    drawFullBleedVideo(ctx, mediaVideo || null, width, height, defaultMediaFilters, 'contain');

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
      hostActiveLevel > 0.15,
      'cover'
    );
    ctx.restore();
  } else {
    // Default: solo-host (single active webcam feed, natural orientation)
    drawFullBleedVideo(ctx, hostVideo, width, height, hostFilters, 'cover');
    drawSoloNameplate(ctx, hostName, 'HOST', 48, height - 120, hostActiveLevel > 0.15);
  }

  // Draw Lower Third overlay if enabled
  if (branding.showLowerThird) {
    drawLowerThirdBanner(ctx, width, height, branding);
  }

  // Draw Recording Indicator & Timecode (top right)
  drawRecordingIndicator(ctx, width, isRecording, recordingTimeSeconds);

  // Draw Top Studio Header watermark (top left)
  drawStudioHeader(ctx, branding.podcastName);

  // Subtle fade-through-black broadcast transition overlay
  if (fadeBlackAlpha > 0) {
    ctx.save();
    ctx.fillStyle = `rgba(0, 0, 0, ${Math.min(1, Math.max(0, fadeBlackAlpha))})`;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

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
  isSpeaking: boolean,
  fitMode: 'cover' | 'contain' = 'cover'
): void {
  const radius = 16;

  // Clip to rounded rectangle
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  ctx.clip();

  // Background for slot
  ctx.fillStyle = '#090b12';
  ctx.fillRect(x, y, w, h);

  const hasActiveSource = Boolean(
    video && (video.srcObject !== null || Boolean(video.currentSrc || video.src))
  );
  if (video && hasActiveSource && video.videoWidth > 0 && video.readyState >= 2) {
    if (
      filters.backgroundBlur &&
      !filters.grayscale &&
      filters.warmth === 0 &&
      filters.brightness === 100 &&
      filters.contrast === 100 &&
      filters.saturation === 100
    ) {
      ctx.filter = 'blur(10px)';
    } else {
      ctx.filter = getCssFilterString(filters);
    }

    const vw = video.videoWidth || 1280;
    const vh = video.videoHeight || 720;
    const slotAspect = w / h;
    const videoAspect = vw / vh;

    if (fitMode === 'contain') {
      let dw = w;
      let dh = h;
      let dx = x;
      let dy = y;
      if (videoAspect > slotAspect) {
        dh = w / videoAspect;
        dy = y + (h - dh) / 2;
      } else {
        dw = h * videoAspect;
        dx = x + (w - dw) / 2;
      }
      if (filters.mirror) {
        ctx.save();
        ctx.translate(dx + dw, dy);
        ctx.scale(-1, 1);
        ctx.drawImage(video, 0, 0, vw, vh, 0, 0, dw, dh);
        ctx.restore();
      } else {
        ctx.drawImage(video, 0, 0, vw, vh, dx, dy, dw, dh);
      }
    } else {
      // Cover fit (center-crop)
      let sx = 0;
      let sy = 0;
      let sWidth = vw;
      let sHeight = vh;
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
    }
    ctx.filter = 'none';
  } else {
    // Empty feed notice
    ctx.filter = 'none';
    ctx.fillStyle = '#141724';
    ctx.fillRect(x, y, w, h);

    ctx.fillStyle = '#64748b';
    ctx.font = '600 22px "Plus Jakarta Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(name, x + w / 2, y + h / 2 - 12);
    ctx.font = '400 15px "JetBrains Mono", monospace';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(
      role === 'MEDIA' ? 'SHARE SCREEN OR LOAD VIDEO' : 'CAMERA OFF',
      x + w / 2,
      y + h / 2 + 20
    );
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
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
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
  const nameWidth = Math.min(260, ctx.measureText(name).width);
  ctx.font = '600 11px "JetBrains Mono", monospace';
  const roleWidth = ctx.measureText(role).width;
  const badgeW = nameWidth + roleWidth + 36;

  ctx.fillStyle = 'rgba(12, 14, 22, 0.85)';
  ctx.beginPath();
  ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 6);
  ctx.fill();

  ctx.strokeStyle = isSpeaking ? '#3b82f6' : 'rgba(255, 255, 255, 0.15)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = isSpeaking ? '#22c55e' : '#6b7280';
  ctx.beginPath();
  ctx.arc(badgeX + 12, badgeY + badgeH / 2, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.font = '700 13px "Plus Jakarta Sans", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(name, badgeX + 22, badgeY + 18, 255);

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
  filters: VideoFilterSettings,
  fitMode: 'cover' | 'contain' = 'cover'
): void {
  const hasActiveSource = Boolean(
    video && (video.srcObject !== null || Boolean(video.currentSrc || video.src))
  );
  if (video && hasActiveSource && video.videoWidth > 0 && video.readyState >= 2) {
    ctx.save();
    if (
      filters.backgroundBlur &&
      !filters.grayscale &&
      filters.warmth === 0 &&
      filters.brightness === 100 &&
      filters.contrast === 100 &&
      filters.saturation === 100
    ) {
      ctx.filter = 'blur(10px)';
    } else {
      ctx.filter = getCssFilterString(filters);
    }

    const vw = video.videoWidth || 1280;
    const vh = video.videoHeight || 720;
    const slotAspect = width / height;
    const videoAspect = vw / vh;

    if (fitMode === 'contain') {
      ctx.fillStyle = '#05060a';
      ctx.fillRect(0, 0, width, height);

      let dw = width;
      let dh = height;
      let dx = 0;
      let dy = 0;
      if (videoAspect > slotAspect) {
        dh = width / videoAspect;
        dy = (height - dh) / 2;
      } else {
        dw = height * videoAspect;
        dx = (width - dw) / 2;
      }

      if (filters.mirror) {
        ctx.save();
        ctx.translate(dx + dw, dy);
        ctx.scale(-1, 1);
        ctx.drawImage(video, 0, 0, vw, vh, 0, 0, dw, dh);
        ctx.restore();
      } else {
        ctx.drawImage(video, 0, 0, vw, vh, dx, dy, dw, dh);
      }
    } else {
      let sx = 0;
      let sy = 0;
      let sWidth = vw;
      let sHeight = vh;
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
    }
    ctx.restore();
  } else {
    ctx.fillStyle = '#0f121d';
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = '#64748b';
    ctx.font = '600 28px "Plus Jakarta Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('CAMERA OFF', width / 2, height / 2 - 10);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '500 15px "JetBrains Mono", monospace';
    ctx.fillText('Click Camera On or Unlock Camera & Mic to resume feed', width / 2, height / 2 + 26);
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
  const grad = ctx.createLinearGradient(x, y, x + bannerW, y);
  grad.addColorStop(0, 'rgba(10, 12, 18, 0.95)');
  grad.addColorStop(0.8, 'rgba(15, 20, 32, 0.9)');
  grad.addColorStop(1, 'rgba(15, 20, 32, 0.1)');

  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.roundRect(x, y, bannerW, bannerH, 8);
  ctx.fill();

  ctx.fillStyle = branding.themeColor || '#6366f1';
  ctx.fillRect(x, y, 5, bannerH);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '700 11px "JetBrains Mono", monospace';
  ctx.textAlign = 'left';
  ctx.fillText(branding.podcastName.toUpperCase(), x + 20, y + 20);

  ctx.fillStyle = '#ffffff';
  ctx.font = '700 18px "Plus Jakarta Sans", sans-serif';
  ctx.fillText(branding.episodeTitle, x + 20, y + 44);

  ctx.restore();
}

function drawStudioHeader(ctx: CanvasRenderingContext2D, podcastName: string): void {
  ctx.save();
  const x = 48;
  const y = 48;

  ctx.fillStyle = 'rgba(15, 17, 26, 0.75)';
  ctx.beginPath();
  ctx.roundRect(x, y, 220, 34, 6);
  ctx.fill();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.lineWidth = 1;
  ctx.stroke();

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
