import React, { useState } from 'react';
import {
  Camera,
  Mic,
  Sliders,
  Sparkles,
  Volume2,
  VolumeX,
  ShieldCheck,
  RotateCcw,
  Monitor,
  Video,
  Wand2,
  FlipHorizontal,
} from 'lucide-react';
import { ChannelConfig, VideoFilterSettings, AudioFilterSettings } from '../types/studio';
import { DeviceItem } from '../hooks/useDevices';
import { VUMeter } from './VUMeter';

interface ChannelControlsProps {
  channel: ChannelConfig;
  videoDevices: DeviceItem[];
  audioDevices: DeviceItem[];
  vuLevel: { rms: number; peak: number; db: number; isClipping: boolean };
  onUpdateChannel: (updated: Partial<ChannelConfig>) => void;
  onUpdateFilters: (filters: Partial<VideoFilterSettings>) => void;
  onUpdateAudio: (audio: Partial<AudioFilterSettings>) => void;
}

const FILTER_PRESETS: Array<{ name: string; filters: VideoFilterSettings }> = [
  {
    name: 'Natural',
    filters: { brightness: 100, contrast: 100, saturation: 100, warmth: 0, grayscale: false, backgroundBlur: false },
  },
  {
    name: 'Warm Studio',
    filters: { brightness: 105, contrast: 108, saturation: 110, warmth: 35, grayscale: false, backgroundBlur: false },
  },
  {
    name: 'Punchy',
    filters: { brightness: 102, contrast: 118, saturation: 125, warmth: 5, grayscale: false, backgroundBlur: false },
  },
  {
    name: 'Cinematic',
    filters: { brightness: 96, contrast: 125, saturation: 85, warmth: 15, grayscale: false, backgroundBlur: false },
  },
  {
    name: 'Classic B&W',
    filters: { brightness: 105, contrast: 130, saturation: 0, warmth: 0, grayscale: true, backgroundBlur: false },
  },
  {
    name: 'Soft Blur',
    filters: { brightness: 104, contrast: 106, saturation: 105, warmth: 10, grayscale: false, backgroundBlur: true },
  },
];

export const ChannelControls: React.FC<ChannelControlsProps> = ({
  channel,
  videoDevices,
  audioDevices,
  vuLevel,
  onUpdateChannel,
  onUpdateFilters,
  onUpdateAudio,
}) => {
  const [activeTab, setActiveTab] = useState<'audio' | 'video' | 'devices'>('audio');

  const applyPreset = (preset: (typeof FILTER_PRESETS)[0]) => {
    onUpdateFilters({
      ...preset.filters,
      mirror: channel.filters.mirror,
      backgroundBlur: preset.filters.backgroundBlur ?? channel.filters.backgroundBlur,
    });
  };

  const resetFilters = () => {
    onUpdateFilters({
      brightness: 100,
      contrast: 100,
      saturation: 100,
      warmth: 0,
      grayscale: false,
      mirror: channel.filters.mirror,
      backgroundBlur: false,
    });
  };

  return (
    <div className="flex flex-col bg-slate-900/90 rounded-xl border border-slate-800 shadow-xl overflow-hidden">
      {/* Channel Header */}
      <div className="flex items-center justify-between p-3.5 bg-slate-950/80 border-b border-slate-800/80">
        <div className="flex items-center gap-2.5">
          <div
            className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs ${
              channel.id === 'host'
                ? 'bg-blue-600/30 text-blue-400 border border-blue-500/40'
                : 'bg-purple-600/30 text-purple-400 border border-purple-500/40'
            }`}
          >
            {channel.id === 'host' ? 'CH1' : 'CH2'}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={channel.name}
                onChange={(e) => onUpdateChannel({ name: e.target.value })}
                className="bg-transparent font-bold text-sm text-white hover:bg-slate-800/50 focus:bg-slate-800 px-1.5 py-0.5 rounded outline-none border border-transparent focus:border-slate-600 transition-colors w-32"
                title="Click to rename speaker"
              />
              <span
                className={`text-[10px] font-mono px-1.5 py-0.5 rounded font-bold uppercase tracking-wider ${
                  channel.id === 'host'
                    ? 'bg-blue-950 text-blue-300 border border-blue-800/60'
                    : 'bg-purple-950 text-purple-300 border border-purple-800/60'
                }`}
              >
                {channel.roleTitle}
              </span>
              <button
                type="button"
                onClick={() => onUpdateFilters({ mirror: !channel.filters.mirror })}
                className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border flex items-center gap-1 transition-all cursor-pointer ${
                  channel.filters.mirror
                    ? 'bg-blue-600/30 text-blue-300 border-blue-500/60 shadow-sm'
                    : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white hover:bg-slate-800'
                }`}
                title={channel.filters.mirror ? 'Webcam is Mirrored (Click to unmirror)' : 'Webcam is Unmirrored (Click to mirror)'}
              >
                <FlipHorizontal className="w-3 h-3 text-blue-400" />
                <span>{channel.filters.mirror ? 'Mirrored' : 'Flip'}</span>
              </button>
            </div>
            <p className="text-[11px] text-slate-400 px-1.5">
              {channel.videoDeviceId === 'screen-share'
                ? 'Screen Capture Active'
                : channel.videoDeviceId
                ? 'Live Hardware Camera'
                : 'No Camera Selected'}
            </p>
          </div>
        </div>

        {/* Tab switchers */}
        <div className="flex bg-slate-900 p-0.5 rounded-lg border border-slate-800 text-xs">
          <button
            onClick={() => setActiveTab('audio')}
            className={`px-2.5 py-1 rounded-md font-medium transition-colors flex items-center gap-1 ${
              activeTab === 'audio' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Mic className="w-3.5 h-3.5" />
            Audio
          </button>
          <button
            onClick={() => setActiveTab('video')}
            className={`px-2.5 py-1 rounded-md font-medium transition-colors flex items-center gap-1 ${
              activeTab === 'video' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            Filters
          </button>
          <button
            onClick={() => setActiveTab('devices')}
            className={`px-2.5 py-1 rounded-md font-medium transition-colors flex items-center gap-1 ${
              activeTab === 'devices' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Camera className="w-3.5 h-3.5" />
            Inputs
          </button>
        </div>
      </div>

      <div className="p-3.5 space-y-4">
        {/* TAB 1: AUDIO MIXING & VOICE CLEANUP */}
        {activeTab === 'audio' && (
          <div className="space-y-3.5">
            {/* Real-time VU meter */}
            <VUMeter
              label={`${channel.name} Mic`}
              level={vuLevel.rms}
              db={vuLevel.db}
              peak={vuLevel.peak}
              isClipping={vuLevel.isClipping}
              muted={channel.audioSettings.muted}
            />

            {/* Fader & Mute */}
            <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800 space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-300 font-medium">
                <span className="flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-blue-400" />
                  Channel Fader
                </span>
                <span className="font-mono text-slate-400">
                  {Math.round(channel.audioSettings.volume * 100)}%
                </span>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => onUpdateAudio({ muted: !channel.audioSettings.muted })}
                  className={`p-2 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                    channel.audioSettings.muted
                      ? 'bg-red-500/20 text-red-400 border-red-500/50 shadow-[0_0_10px_rgba(239,68,68,0.3)]'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                  }`}
                  title={channel.audioSettings.muted ? 'Unmute microphone' : 'Mute microphone'}
                >
                  {channel.audioSettings.muted ? (
                    <VolumeX className="w-4 h-4 text-red-400" />
                  ) : (
                    <Volume2 className="w-4 h-4 text-emerald-400" />
                  )}
                  {channel.audioSettings.muted ? 'MUTED' : 'MUTE'}
                </button>

                <input
                  type="range"
                  min="0"
                  max="1.5"
                  step="0.05"
                  value={channel.audioSettings.volume}
                  disabled={channel.audioSettings.muted}
                  onChange={(e) => onUpdateAudio({ volume: parseFloat(e.target.value) })}
                  className="flex-1 h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500 disabled:opacity-40"
                />
              </div>
            </div>

            {/* Voice Cleanup Modules */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-bold text-slate-300 tracking-wide uppercase px-1">
                <span className="flex items-center gap-1 text-slate-300">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  Web Audio Voice Processing
                </span>
                <span className="text-[10px] text-emerald-400/90 font-mono">DSP ACTIVE</span>
              </div>

              {/* High-Pass Filter Toggle & Controls */}
              <div className="flex items-center justify-between p-2.5 bg-slate-950/60 rounded-lg border border-slate-800">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-slate-200">High-Pass Filter</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.2 bg-blue-950 text-blue-300 rounded border border-blue-800/60">
                      80 Hz
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-400">
                    Cuts low-end desk thuds, HVAC hum, and mechanical rumble
                  </p>
                </div>

                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={channel.audioSettings.highPassEnabled}
                    onChange={(e) => onUpdateAudio({ highPassEnabled: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>

              {/* Vocal Dynamics Compressor */}
              <div className="flex items-center justify-between p-2.5 bg-slate-950/60 rounded-lg border border-slate-800">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-slate-200">Vocal Compressor</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.2 bg-amber-950 text-amber-300 rounded border border-amber-800/60">
                      -24 dB
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-400">
                    Levels audio dynamics, smoothing loud shouts & lifting whispers
                  </p>
                </div>

                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={channel.audioSettings.compressorEnabled}
                    onChange={(e) => onUpdateAudio({ compressorEnabled: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-600"></div>
                </label>
              </div>

              {/* Noise Gate */}
              <div className="flex items-center justify-between p-2.5 bg-slate-950/60 rounded-lg border border-slate-800">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-slate-200">Room Noise Gate</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.2 bg-emerald-950 text-emerald-300 rounded border border-emerald-800/60">
                      -46 dB
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-400">
                    Silences room reflections & fan background hum when silent
                  </p>
                </div>

                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={channel.audioSettings.noiseGateEnabled}
                    onChange={(e) => onUpdateAudio({ noiseGateEnabled: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600"></div>
                </label>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: VIDEO FILTERS & STYLING */}
        {activeTab === 'video' && (
          <div className="space-y-3.5">
            {/* Quick Presets */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-slate-300 flex items-center gap-1">
                  <Wand2 className="w-3.5 h-3.5 text-purple-400" />
                  Studio Presets
                </span>
                <button
                  onClick={resetFilters}
                  className="text-[11px] text-slate-400 hover:text-slate-200 flex items-center gap-1 transition-colors"
                >
                  <RotateCcw className="w-3 h-3" />
                  Reset
                </button>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {FILTER_PRESETS.map((p) => (
                  <button
                    key={p.name}
                    onClick={() => applyPreset(p)}
                    className="px-2 py-1.5 bg-slate-950 hover:bg-slate-800 border border-slate-800 rounded text-[11px] font-medium text-slate-300 hover:text-white transition-all text-center"
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Slider Controls */}
            <div className="space-y-3 bg-slate-950/60 p-3 rounded-lg border border-slate-800">
              {/* Brightness */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-slate-300">
                  <span>Brightness</span>
                  <span className="font-mono text-slate-400">{channel.filters.brightness}%</span>
                </div>
                <input
                  type="range"
                  min="50"
                  max="150"
                  value={channel.filters.brightness}
                  onChange={(e) => onUpdateFilters({ brightness: parseInt(e.target.value) })}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                />
              </div>

              {/* Contrast */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-slate-300">
                  <span>Contrast</span>
                  <span className="font-mono text-slate-400">{channel.filters.contrast}%</span>
                </div>
                <input
                  type="range"
                  min="50"
                  max="150"
                  value={channel.filters.contrast}
                  onChange={(e) => onUpdateFilters({ contrast: parseInt(e.target.value) })}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                />
              </div>

              {/* Saturation */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-slate-300">
                  <span>Saturation</span>
                  <span className="font-mono text-slate-400">{channel.filters.saturation}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="200"
                  value={channel.filters.saturation}
                  onChange={(e) => onUpdateFilters({ saturation: parseInt(e.target.value) })}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                />
              </div>

              {/* Studio Warmth */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-slate-300">
                  <span>Studio Warmth</span>
                  <span className="font-mono text-slate-400">{channel.filters.warmth}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={channel.filters.warmth}
                  onChange={(e) => onUpdateFilters({ warmth: parseInt(e.target.value) })}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
                />
              </div>

              {/* Black & White Toggle */}
              <div className="flex items-center justify-between pt-1">
                <span className="text-xs text-slate-300 font-medium">Black & White (Monochrome)</span>
                <button
                  onClick={() => onUpdateFilters({ grayscale: !channel.filters.grayscale })}
                  className={`px-3 py-1 rounded text-xs font-semibold border transition-colors ${
                    channel.filters.grayscale
                      ? 'bg-slate-200 text-slate-900 border-white'
                      : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
                  }`}
                >
                  {channel.filters.grayscale ? 'B&W ACTIVE' : 'COLOR'}
                </button>
              </div>

              {/* Horizontal Flip / Mirror Camera Toggle */}
              <div className="flex items-center justify-between pt-2 border-t border-slate-800/80">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <FlipHorizontal className="w-3.5 h-3.5 text-blue-400" />
                    <span className="text-xs font-semibold text-slate-200">Flip / Mirror Camera</span>
                  </div>
                  <p className="text-[10px] text-slate-400">
                    Flips horizontally so your natural left and right match real life (or un-mirrors for readable text)
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onUpdateFilters({ mirror: !channel.filters.mirror })}
                  className={`px-3 py-1 rounded text-xs font-semibold border transition-all cursor-pointer ${
                    channel.filters.mirror
                      ? 'bg-blue-600 text-white border-blue-400 shadow-md shadow-blue-600/30'
                      : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
                  }`}
                  title="Toggle horizontal mirror"
                >
                  {channel.filters.mirror ? 'MIRRORED (FLIPPED)' : 'UNMIRRORED (NATURAL)'}
                </button>
              </div>

              {/* Background Blur Filter Toggle (CanvasRenderingContext2D filter blur(10px)) */}
              <div className="flex items-center justify-between pt-2 border-t border-slate-800/80">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                    <span className="text-xs font-semibold text-slate-200">Background Blur</span>
                    <span
                      className={`text-[10px] font-mono px-1.5 py-0.2 rounded border ${
                        channel.filters.backgroundBlur
                          ? 'bg-purple-950 text-purple-300 border-purple-800/80 font-bold'
                          : 'bg-slate-900 text-slate-400 border-slate-800'
                      }`}
                    >
                      {channel.filters.backgroundBlur ? 'BLUR (10px)' : 'OFF'}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-400">
                    Applies CanvasRenderingContext2D.filter = 'blur(10px)' during the frame drawing loop
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onUpdateFilters({ backgroundBlur: !channel.filters.backgroundBlur })}
                  className={`px-3 py-1 rounded text-xs font-semibold border transition-all cursor-pointer ${
                    channel.filters.backgroundBlur
                      ? 'bg-purple-600 text-white border-purple-400 shadow-md shadow-purple-600/30'
                      : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
                  }`}
                  title="Toggle 10px background blur filter"
                >
                  {channel.filters.backgroundBlur ? 'BLUR ACTIVE' : 'NO BLUR'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: DEVICE & INPUT MANAGEMENT */}
        {activeTab === 'devices' && (
          <div className="space-y-3">
            {/* Video Input Selector with Quick Flip Button */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <Video className="w-3.5 h-3.5 text-blue-400" />
                  Camera Device
                </label>
                <button
                  type="button"
                  onClick={() => onUpdateFilters({ mirror: !channel.filters.mirror })}
                  className={`px-2 py-0.5 rounded text-[11px] font-semibold border flex items-center gap-1.5 transition-all cursor-pointer ${
                    channel.filters.mirror
                      ? 'bg-blue-600/30 text-blue-300 border-blue-500/60 shadow-sm'
                      : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white hover:bg-slate-800'
                  }`}
                  title="Flip / Mirror Camera horizontally so movements match natural mirror orientation"
                >
                  <FlipHorizontal className="w-3 h-3 text-blue-400" />
                  Flip / Mirror: <span className="font-mono">{channel.filters.mirror ? 'ON' : 'OFF'}</span>
                </button>
              </div>
              <select
                value={channel.videoDeviceId}
                onChange={(e) => onUpdateChannel({ videoDeviceId: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-white focus:border-blue-500 outline-none"
              >
                <option value="none">No Camera (Disabled)</option>
                <optgroup label="Connected Physical Cameras">
                  {videoDevices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Camera ${d.deviceId.slice(0, 8)}`}
                    </option>
                  ))}
                  {videoDevices.length === 0 && (
                    <option value="" disabled>
                      No physical cameras detected
                    </option>
                  )}
                </optgroup>
                <optgroup label="Display Capture">
                  <option value="screen-share">🖥️ Screen / Window Share</option>
                </optgroup>
              </select>
            </div>

            {/* Audio Input Selector */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Mic className="w-3.5 h-3.5 text-emerald-400" />
                Microphone Input
              </label>
              <select
                value={channel.audioDeviceId}
                onChange={(e) => onUpdateChannel({ audioDeviceId: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-white focus:border-blue-500 outline-none"
              >
                <option value="none">No Microphone (Silent Channel)</option>
                <optgroup label="Available Physical Microphones">
                  {audioDevices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Microphone ${d.deviceId.slice(0, 8)}`}
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>

            <div className="p-2.5 bg-slate-950/40 rounded-lg border border-slate-800/80 text-[11px] text-slate-400 space-y-1">
              <p className="flex items-center gap-1 text-slate-300 font-medium">
                <Monitor className="w-3 h-3 text-blue-400" />
                Hardware Device Routing:
              </p>
              <p>
                Live hardware feeds are queried directly via <code className="text-blue-300 font-mono">navigator.mediaDevices.enumerateDevices()</code>.
                Connect USB webcams, capture cards, or XLR audio interfaces to assign independent audio/video channels.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
