import { AudioFilterSettings } from '../types/studio';

export interface ChannelAudioNodes {
  sourceNode: MediaStreamAudioSourceNode | null;
  highPassNode: BiquadFilterNode;
  compressorNode: DynamicsCompressorNode;
  gateGainNode: GainNode;
  faderGainNode: GainNode;
  analyserNode: AnalyserNode;
  stream: MediaStream | null;
  lastLevel: number;
  peakHoldLevel: number;
  peakHoldTime: number;
}

export class AudioStudioEngine {
  private audioCtx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private masterAnalyser: AnalyserNode | null = null;
  private destinationNode: MediaStreamAudioDestinationNode | null = null;
  private monitorGain: GainNode | null = null;
  private isMonitoring = false;

  // Media & Screen audio routing
  private mediaGainNode: GainNode | null = null;
  private mediaSourceNode: AudioNode | null = null;
  private mediaElementMap = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();

  private channels: {
    host: ChannelAudioNodes | null;
    guest: ChannelAudioNodes | null;
  } = { host: null, guest: null };

  private gateIntervalId: number | null = null;

  constructor() {
    // AudioContext will be initialized on user gesture
  }

  public init() {
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }
      return;
    }

    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    this.audioCtx = new AudioContextClass({ latencyHint: 'interactive' });

    // Master bus
    this.masterGain = this.audioCtx.createGain();
    this.masterGain.gain.setValueAtTime(1.0, this.audioCtx.currentTime);

    this.masterAnalyser = this.audioCtx.createAnalyser();
    this.masterAnalyser.fftSize = 256;
    this.masterAnalyser.smoothingTimeConstant = 0.8;

    this.destinationNode = this.audioCtx.createMediaStreamDestination();

    // Media & Screen share audio bus
    this.mediaGainNode = this.audioCtx.createGain();
    this.mediaGainNode.gain.setValueAtTime(0.85, this.audioCtx.currentTime);

    // Route media audio to master bus (which goes into the recording destination)
    this.mediaGainNode.connect(this.masterGain);
    // Also route media audio to real audio destination so host hears the video/screen live!
    this.mediaGainNode.connect(this.audioCtx.destination);

    // Monitor bus (headphones monitor) - default muted to avoid feedback
    this.monitorGain = this.audioCtx.createGain();
    this.monitorGain.gain.setValueAtTime(0.0, this.audioCtx.currentTime);
    this.monitorGain.connect(this.audioCtx.destination);

    // Connect master bus to output destination and monitor
    this.masterGain.connect(this.masterAnalyser);
    this.masterGain.connect(this.destinationNode);
    this.masterGain.connect(this.monitorGain);

    // Start background noise gate evaluation loop
    this.startNoiseGateLoop();
  }

  public async ensureContextRunning(): Promise<void> {
    this.init();
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }
  }

  public attachChannelStream(
    channelId: 'host' | 'guest',
    stream: MediaStream | null,
    settings: AudioFilterSettings
  ) {
    this.init();
    if (!this.audioCtx || !this.masterGain) return;

    // Disconnect previous channel nodes if any
    const existing = this.channels[channelId];
    if (existing?.sourceNode) {
      try {
        existing.sourceNode.disconnect();
      } catch (e) {
        // ignore
      }
    }

    if (!stream || stream.getAudioTracks().length === 0) {
      this.channels[channelId] = null;
      return;
    }

    const ctx = this.audioCtx;

    // 1. High-Pass Filter (cuts low rumble < 80Hz)
    const highPass = ctx.createBiquadFilter();
    highPass.type = 'highpass';
    highPass.frequency.setValueAtTime(
      settings.highPassEnabled ? settings.highPassFrequency : 10,
      ctx.currentTime
    );
    highPass.Q.setValueAtTime(0.707, ctx.currentTime);

    // 2. Dynamics Compressor (normalizes loud peaks, pulls up subtle speech)
    const compressor = ctx.createDynamicsCompressor();
    if (settings.compressorEnabled) {
      compressor.threshold.setValueAtTime(settings.compressorThreshold, ctx.currentTime);
      compressor.knee.setValueAtTime(12, ctx.currentTime);
      compressor.ratio.setValueAtTime(4.0, ctx.currentTime);
      compressor.attack.setValueAtTime(0.003, ctx.currentTime);
      compressor.release.setValueAtTime(0.25, ctx.currentTime);
    } else {
      compressor.threshold.setValueAtTime(0, ctx.currentTime);
      compressor.ratio.setValueAtTime(1.0, ctx.currentTime);
    }

    // 3. Noise Gate Gain
    const gateGain = ctx.createGain();
    gateGain.gain.setValueAtTime(1.0, ctx.currentTime);

    // 4. Channel Fader Gain
    const faderGain = ctx.createGain();
    const effectiveVolume = settings.muted ? 0.0 : settings.volume;
    faderGain.gain.setValueAtTime(effectiveVolume, ctx.currentTime);

    // 5. Channel Analyser (for VU metering)
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.75;

    // Connect pipeline: Source -> HighPass -> Compressor -> GateGain -> FaderGain -> Analyser & Master
    const source = ctx.createMediaStreamSource(stream);
    source.connect(highPass);
    highPass.connect(compressor);
    compressor.connect(gateGain);
    gateGain.connect(faderGain);
    faderGain.connect(analyser);
    faderGain.connect(this.masterGain);

    this.channels[channelId] = {
      sourceNode: source,
      highPassNode: highPass,
      compressorNode: compressor,
      gateGainNode: gateGain,
      faderGainNode: faderGain,
      analyserNode: analyser,
      stream,
      lastLevel: 0,
      peakHoldLevel: 0,
      peakHoldTime: 0,
    };
  }

  public updateChannelSettings(channelId: 'host' | 'guest', settings: AudioFilterSettings) {
    const channel = this.channels[channelId];
    if (!channel || !this.audioCtx) return;

    const ctx = this.audioCtx;

    // Highpass update
    if (settings.highPassEnabled) {
      channel.highPassNode.frequency.setTargetAtTime(settings.highPassFrequency, ctx.currentTime, 0.05);
    } else {
      channel.highPassNode.frequency.setTargetAtTime(10, ctx.currentTime, 0.05);
    }

    // Compressor update
    if (settings.compressorEnabled) {
      channel.compressorNode.threshold.setTargetAtTime(settings.compressorThreshold, ctx.currentTime, 0.05);
      channel.compressorNode.ratio.setTargetAtTime(4.0, ctx.currentTime, 0.05);
      channel.compressorNode.knee.setTargetAtTime(12, ctx.currentTime, 0.05);
    } else {
      channel.compressorNode.threshold.setTargetAtTime(0, ctx.currentTime, 0.05);
      channel.compressorNode.ratio.setTargetAtTime(1.0, ctx.currentTime, 0.05);
    }

    // Fader & Mute update
    const targetVolume = settings.muted ? 0.0 : settings.volume;
    channel.faderGainNode.gain.setTargetAtTime(targetVolume, ctx.currentTime, 0.03);
  }

  public setMonitoring(enabled: boolean) {
    this.isMonitoring = enabled;
    if (this.monitorGain && this.audioCtx) {
      this.monitorGain.gain.setTargetAtTime(enabled ? 1.0 : 0.0, this.audioCtx.currentTime, 0.05);
    }
  }

  public getMonitoring(): boolean {
    return this.isMonitoring;
  }

  public getMixedStream(): MediaStream | null {
    return this.destinationNode ? this.destinationNode.stream : null;
  }

  // Connect screen share audio stream to media bus
  public attachMediaStream(stream: MediaStream | null) {
    this.init();
    if (this.mediaSourceNode) {
      try {
        this.mediaSourceNode.disconnect();
      } catch (e) {
        // ignore
      }
      this.mediaSourceNode = null;
    }

    if (!stream || stream.getAudioTracks().length === 0 || !this.audioCtx || !this.mediaGainNode) {
      return;
    }

    try {
      const source = this.audioCtx.createMediaStreamSource(stream);
      source.connect(this.mediaGainNode);
      this.mediaSourceNode = source;
    } catch (e) {
      console.warn('Failed to attach screen share audio to Web Audio:', e);
    }
  }

  // Connect HTML5 video element audio to media bus
  public attachMediaElement(videoElement: HTMLVideoElement | null) {
    this.init();
    if (this.mediaSourceNode) {
      try {
        this.mediaSourceNode.disconnect();
      } catch (e) {
        // ignore
      }
      this.mediaSourceNode = null;
    }

    if (!videoElement || !this.audioCtx || !this.mediaGainNode) {
      return;
    }

    try {
      let source = this.mediaElementMap.get(videoElement);
      if (!source) {
        source = this.audioCtx.createMediaElementSource(videoElement);
        this.mediaElementMap.set(videoElement, source);
      }
      source.connect(this.mediaGainNode);
      this.mediaSourceNode = source;
    } catch (e) {
      console.warn('Failed to attach video element audio to Web Audio:', e);
    }
  }

  // Set media / screen share playback and broadcast volume
  public setMediaVolume(volume: number, muted = false) {
    if (this.mediaGainNode && this.audioCtx) {
      const target = muted ? 0.0 : volume;
      this.mediaGainNode.gain.setTargetAtTime(target, this.audioCtx.currentTime, 0.03);
    }
  }

  // Real-time level calculation in dB (-60 dB to 0 dB, and 0..1 normalized)
  public getChannelLevel(
    target: 'host' | 'guest' | 'master',
    noiseGateEnabled = false,
    noiseGateThreshold = -45
  ): { rms: number; peak: number; db: number; isClipping: boolean } {
    let analyser: AnalyserNode | null = null;
    let channelRef: ChannelAudioNodes | null = null;

    if (target === 'master') {
      analyser = this.masterAnalyser;
    } else {
      channelRef = this.channels[target];
      analyser = channelRef?.analyserNode || null;
    }

    if (!analyser) {
      return { rms: 0, peak: 0, db: -60, isClipping: false };
    }

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteTimeDomainData(dataArray);

    let sumSquares = 0;
    let peakSample = 0;

    for (let i = 0; i < dataArray.length; i++) {
      const normalized = (dataArray[i] - 128) / 128; // -1.0 to 1.0
      sumSquares += normalized * normalized;
      const absVal = Math.abs(normalized);
      if (absVal > peakSample) {
        peakSample = absVal;
      }
    }

    const rms = Math.sqrt(sumSquares / dataArray.length);
    // Convert to decibels (0dB = 1.0 amplitude, -60dB = silence threshold)
    const db = rms > 0.0001 ? 20 * Math.log10(rms) : -60;
    const clampedDb = Math.max(-60, Math.min(0, db));

    // Normalized value 0.0 to 1.0 on a logarithmic scale (-60dB to 0dB)
    const normalizedLevel = Math.max(0, (clampedDb + 60) / 60);

    const isClipping = peakSample >= 0.98;

    // Peak hold tracking
    if (channelRef) {
      const now = performance.now();
      if (normalizedLevel > channelRef.peakHoldLevel || now - channelRef.peakHoldTime > 1200) {
        channelRef.peakHoldLevel = normalizedLevel;
        channelRef.peakHoldTime = now;
      }
    }

    return {
      rms: normalizedLevel,
      peak: peakSample,
      db: Math.round(clampedDb * 10) / 10,
      isClipping,
    };
  }

  // Active noise gate logic smoothly attenuates silence
  private startNoiseGateLoop() {
    const loop = () => {
      if (this.audioCtx && this.audioCtx.state === 'running') {
        const time = this.audioCtx.currentTime;
        (['host', 'guest'] as const).forEach((channelId) => {
          const ch = this.channels[channelId];
          if (!ch || !ch.analyserNode) return;

          // Check level
          const data = new Uint8Array(ch.analyserNode.frequencyBinCount);
          ch.analyserNode.getByteTimeDomainData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) {
            const v = (data[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / data.length);
          const db = rms > 0.0001 ? 20 * Math.log10(rms) : -60;

          // If signal is very low (< -46dB), attenuate smoothly by 18dB
          const threshold = -46;
          if (db < threshold) {
            ch.gateGainNode.gain.setTargetAtTime(0.08, time, 0.08); // attenuated
          } else {
            ch.gateGainNode.gain.setTargetAtTime(1.0, time, 0.01); // fast open
          }
        });
      }
      this.gateIntervalId = requestAnimationFrame(loop);
    };

    this.gateIntervalId = requestAnimationFrame(loop);
  }

  public destroy() {
    if (this.gateIntervalId) {
      cancelAnimationFrame(this.gateIntervalId);
    }
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      this.audioCtx.close();
    }
  }
}

export const audioStudio = new AudioStudioEngine();
