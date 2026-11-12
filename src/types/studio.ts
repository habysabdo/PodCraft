export type LayoutMode =
  | 'solo-host'
  | 'reaction-split'
  | 'reaction-pip';

export type MediaSourceType =
  | 'none'
  | 'screen'
  | 'video-file'
  | 'video-url'
  | 'youtube'
  | 'facebook'
  | 'web-embed';

export interface ReactionMediaState {
  type: MediaSourceType;
  title: string;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  embedUrl?: string;
  videoId?: string;
  rawUrl?: string;
}

export interface VideoFilterSettings {
  brightness: number; // 50 - 150 (100 is normal)
  contrast: number;   // 50 - 150 (100 is normal)
  saturation: number; // 0 - 200 (100 is normal)
  warmth: number;     // 0 - 100 (warm tint overlay / sepia balance)
  grayscale: boolean; // true = black & white
  mirror?: boolean;   // true = horizontally flipped / mirror preview (default false = natural)
  backgroundBlur?: boolean; // true = CanvasRenderingContext2D blur(10px) filter
}

export interface AudioFilterSettings {
  highPassEnabled: boolean;
  highPassFrequency: number; // Hz, default 80
  compressorEnabled: boolean;
  compressorThreshold: number; // dB, default -24
  noiseGateEnabled: boolean;
  noiseGateThreshold: number; // dB, default -45
  volume: number; // 0.0 - 1.5 (1.0 default)
  muted: boolean;
}

export interface ChannelConfig {
  id: 'host';
  label: string;
  name: string;
  roleTitle: string;
  videoDeviceId: string;
  audioDeviceId: string;
  filters: VideoFilterSettings;
  audioSettings: AudioFilterSettings;
}

export interface ChapterMarker {
  id: string;
  timestampSeconds: number;
  formattedTime: string;
  label: string;
}

export interface ShowNotesData {
  episodeTitle: string;
  alternativeTitles: string[];
  summary: string;
  keyTakeaways: string[];
  timestamps: Array<{
    time: string;
    title: string;
    description: string;
  }>;
  memorableQuotes: Array<{
    speaker: string;
    quote: string;
  }>;
  socialPromo: {
    twitterPost: string;
    linkedinPost: string;
  };
}

export interface StudioBranding {
  podcastName: string;
  episodeTitle: string;
  showLowerThird: boolean;
  themeColor: string; // hex
}
