/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Radio,
  Sparkles,
  AlertCircle,
  FileText,
  CheckCircle,
  ScrollText,
  ExternalLink,
} from 'lucide-react';
import {
  ChannelConfig,
  LayoutMode,
  StudioBranding,
  ChapterMarker,
  VideoFilterSettings,
  AudioFilterSettings,
  ReactionMediaState,
} from './types/studio';
import { useDevices } from './hooks/useDevices';
import { useSpeechRecognition } from './hooks/useSpeechRecognition';
import { audioStudio } from './utils/audioProcessor';
import { BroadcastCanvasView } from './components/BroadcastCanvasView';
import { ChannelControls } from './components/ChannelControls';
import { RecordingBar } from './components/RecordingBar';
import { RecordingReviewModal } from './components/RecordingReviewModal';
import { ShowNotesModal } from './components/ShowNotesModal';
import { ReactionMediaControls } from './components/ReactionMediaControls';
import { TeleprompterOverlay, TeleprompterFontSize } from './components/TeleprompterOverlay';
import { detectAndParseMediaUrl } from './utils/urlDetector';

const DEFAULT_FILTERS: VideoFilterSettings = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
  warmth: 0,
  grayscale: false,
  mirror: false, // Un-mirrored by default for natural left/right orientation
  backgroundBlur: false,
};

const DEFAULT_AUDIO_SETTINGS: AudioFilterSettings = {
  highPassEnabled: true,
  highPassFrequency: 80,
  compressorEnabled: true,
  compressorThreshold: -24,
  noiseGateEnabled: true,
  noiseGateThreshold: -46,
  volume: 1.0,
  muted: false,
};

export default function App() {
  const {
    videoDevices,
    audioDevices,
    permissionGranted,
    error: deviceError,
    markPermissionGranted,
    setPermissionError,
    clearError,
    refreshDevices,
    acquireAudioStream,
  } = useDevices();

  // Studio Branding & Lower Thirds
  const [branding, setBranding] = useState<StudioBranding>({
    podcastName: 'PodCraft Studio',
    episodeTitle: 'Live Commentary & Reaction Broadcast',
    showLowerThird: true,
    themeColor: '#6366f1',
  });

  // Active Broadcast Layout (Defaults to Single-Host Webcam)
  const [layout, setLayout] = useState<LayoutMode>('solo-host');

  // Single-Host Channel Config
  const [hostConfig, setHostConfig] = useState<ChannelConfig>({
    id: 'host',
    label: 'Host Channel',
    name: 'Host',
    roleTitle: 'Host',
    videoDeviceId: '',
    audioDeviceId: '',
    filters: { ...DEFAULT_FILTERS },
    audioSettings: { ...DEFAULT_AUDIO_SETTINGS },
  });

  // Invisible Teleprompter Script Overlay State (purely HTML/CSS, never drawn to canvas)
  const [showTeleprompter, setShowTeleprompter] = useState(false);
  const [teleprompterScript, setTeleprompterScript] = useState('');
  const [teleprompterFontSize, setTeleprompterFontSize] = useState<TeleprompterFontSize>('medium');
  const [teleprompterSpeed, setTeleprompterSpeed] = useState(36);
  const [teleprompterPlaying, setTeleprompterPlaying] = useState(false);

  // Video & Canvas references
  const hostVideoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Active Host streams & camera request guard
  const [hostStream, setHostStream] = useState<MediaStream | null>(null);
  const hostStreamRef = useRef<MediaStream | null>(null);
  const hostAudioStreamRef = useRef<MediaStream | null>(null);
  const cameraRequestIdRef = useRef(0);
  const hostVideoDeviceIdRef = useRef<string>('');
  const hostAudioSettingsRef = useRef<AudioFilterSettings>(hostConfig.audioSettings);

  // Reaction Media & Screen Share
  const mediaVideoRef = useRef<HTMLVideoElement | null>(null);
  const screenVideoRef = useRef<HTMLVideoElement | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const [mediaState, setMediaState] = useState<ReactionMediaState>({
    type: 'none',
    title: 'No Media Loaded',
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    volume: 0.85,
    muted: false,
  });
  const [mediaError, setMediaError] = useState<string | null>(null);

  // Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [chapterMarkers, setChapterMarkers] = useState<ChapterMarker[]>([]);
  const recordingTimerRef = useRef<number | null>(null);
  const iframeCaptureStreamRef = useRef<MediaStream | null>(null);

  // MediaRecorder & Export
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const [recordedVideoUrl, setRecordedVideoUrl] = useState<string | null>(null);
  const [recordedVideoBlob, setRecordedVideoBlob] = useState<Blob | null>(null);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [showNotesModal, setShowNotesModal] = useState(false);
  const [hasRecordedSession, setHasRecordedSession] = useState(false);
  const [currentRecordingFilename, setCurrentRecordingFilename] = useState('Podcast_Recording.webm');
  const previousRecordedUrlRef = useRef<string | null>(null);
  const lastRecordingDurationRef = useRef(0);

  // Clean up object URLs on unmount to free client device memory
  useEffect(() => {
    return () => {
      if (previousRecordedUrlRef.current) {
        window.URL.revokeObjectURL(previousRecordedUrlRef.current);
        previousRecordedUrlRef.current = null;
      }
    };
  }, []);

  // Live VU meter states
  const [hostVu, setHostVu] = useState({ rms: 0, peak: 0, db: -60, isClipping: false });
  const [masterVu, setMasterVu] = useState({ rms: 0, peak: 0, db: -60, isClipping: false });
  const [isMonitoring, setIsMonitoring] = useState(false);

  // Live Speech Recognition for Transcript
  const {
    transcript,
    entries: transcriptEntries,
    isListening: isTranscriptListening,
    supported: isSpeechSupported,
    addManualNote,
  } = useSpeechRecognition(isRecording && !isPaused, recordingSeconds, hostConfig.name);

  const [showTranscriptDrawer, setShowTranscriptDrawer] = useState(false);
  const [manualNoteText, setManualNoteText] = useState('');

  useEffect(() => {
    hostVideoDeviceIdRef.current = hostConfig.videoDeviceId;
  }, [hostConfig.videoDeviceId]);

  useEffect(() => {
    hostAudioSettingsRef.current = hostConfig.audioSettings;
  }, [hostConfig.audioSettings]);

  useEffect(() => {
    if (audioDevices.length > 0 && !hostConfig.audioDeviceId) {
      setHostConfig((prev) => ({ ...prev, audioDeviceId: audioDevices[0].deviceId }));
    }
  }, [audioDevices, hostConfig.audioDeviceId]);

  // Cleanly stop all active camera tracks and release hardware
  const stopCamera = useCallback(() => {
    cameraRequestIdRef.current += 1;

    const activeStream = hostStreamRef.current;
    if (activeStream) {
      activeStream.getTracks().forEach((track) => track.stop());
      hostStreamRef.current = null;
    }

    if (hostVideoRef.current) {
      hostVideoRef.current.pause();
      hostVideoRef.current.srcObject = null;
    }

    setHostStream(null);
  }, []);

  // Single unified async startCamera() used by Unlock Camera & Mic, Grant Access, Camera Toggle, and auto-start
  const startCamera = useCallback(
    async (overrideDeviceId?: string) => {
      const requestId = ++cameraRequestIdRef.current;

      // 1. Stop any leftover tracks first
      const leftoverStream = hostStreamRef.current;
      if (leftoverStream) {
        leftoverStream.getTracks().forEach((track) => track.stop());
        hostStreamRef.current = null;
      }
      if (hostVideoRef.current) {
        hostVideoRef.current.pause();
        hostVideoRef.current.srcObject = null;
      }
      setHostStream(null);

      const candidateId =
        overrideDeviceId !== undefined ? overrideDeviceId : hostVideoDeviceIdRef.current;
      const selectedCameraId =
        candidateId && candidateId !== 'none' && candidateId !== 'screen-share'
          ? candidateId
          : '';

      try {
        let stream: MediaStream;

        if (candidateId === 'screen-share') {
          stream = await navigator.mediaDevices.getDisplayMedia({
            video: {
              width: { ideal: 1920 },
              height: { ideal: 1080 },
              frameRate: { ideal: 30 },
            },
            audio: false,
          });
        } else {
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              video: selectedCameraId ? { deviceId: { exact: selectedCameraId } } : true,
              audio: true,
            });
          } catch (constraintErr: any) {
            if (
              selectedCameraId &&
              (constraintErr?.name === 'OverconstrainedError' ||
                constraintErr?.name === 'NotFoundError')
            ) {
              stream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true,
              });
            } else {
              throw constraintErr;
            }
          }
        }

        // Abort cleanly if user stopped/toggled camera while waiting for permissions
        if (requestId !== cameraRequestIdRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        // Clear any permission warning banner immediately once stream resolves
        clearError();
        markPermissionGranted();

        // Attach new stream to <video> ref, wait for onloadedmetadata, and call play()
        const video = hostVideoRef.current;
        if (video) {
          video.srcObject = stream;
          await new Promise<void>((resolve) => {
            if (video.readyState >= 1) {
              resolve();
              return;
            }
            const onLoaded = () => {
              video.onloadedmetadata = null;
              resolve();
            };
            video.onloadedmetadata = onLoaded;
          });

          if (requestId !== cameraRequestIdRef.current) {
            stream.getTracks().forEach((track) => track.stop());
            video.srcObject = null;
            return;
          }

          await video.play();
        }

        if (requestId !== cameraRequestIdRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          if (video) {
            video.srcObject = null;
          }
          return;
        }

        hostStreamRef.current = stream;
        setHostStream(stream);

        // If no dedicated audio stream is attached yet, feed audio immediately until refreshDevices selects mic
        if (!hostAudioStreamRef.current && stream.getAudioTracks().length > 0) {
          audioStudio.attachChannelStream('host', stream, hostAudioSettingsRef.current);
        }

        const activeVideoTrack = stream.getVideoTracks()[0];
        if (activeVideoTrack) {
          const settings = activeVideoTrack.getSettings?.();
          if (settings?.deviceId && candidateId !== 'screen-share') {
            hostVideoDeviceIdRef.current = settings.deviceId;
            setHostConfig((prev) =>
              prev.videoDeviceId === settings.deviceId
                ? prev
                : { ...prev, videoDeviceId: settings.deviceId! }
            );
          }

          activeVideoTrack.onended = () => {
            if (hostStreamRef.current === stream) {
              stopCamera();
            }
          };
        }

        await refreshDevices();
      } catch (err: any) {
        if (requestId !== cameraRequestIdRef.current) return;
        console.error('Failed to start camera:', err);
        setPermissionError(
          err?.name === 'NotAllowedError'
            ? 'Camera and microphone permission is required to access hardware devices.'
            : err?.message || 'Unable to open camera. Please check permissions and hardware.'
        );
        await refreshDevices();
      }
    },
    [
      clearError,
      markPermissionGranted,
      setPermissionError,
      refreshDevices,
      stopCamera,
    ]
  );

  const handleToggleCamera = useCallback(() => {
    if (hostStreamRef.current) {
      stopCamera();
    } else {
      startCamera();
    }
  }, [stopCamera, startCamera]);

  const handleSelectVideoDevice = useCallback(
    (deviceId: string) => {
      hostVideoDeviceIdRef.current = deviceId;
      setHostConfig((prev) => ({ ...prev, videoDeviceId: deviceId }));
      if (!deviceId || deviceId === 'none') {
        stopCamera();
      } else {
        startCamera(deviceId);
      }
    },
    [stopCamera, startCamera]
  );

  // Auto-start the camera on initial page load if browser permissions were already granted
  useEffect(() => {
    let cancelled = false;

    async function autoStartIfPermitted() {
      try {
        if (navigator.permissions && navigator.permissions.query) {
          const status = await navigator.permissions.query({
            name: 'camera' as PermissionName,
          });
          if (!cancelled && status.state === 'granted') {
            await startCamera();
            return;
          }
        }
      } catch {
        // Fallback for browsers without permissions.query('camera') support
        try {
          const devices = await navigator.mediaDevices?.enumerateDevices?.();
          const hasLabeledCamera = devices?.some(
            (d) => d.kind === 'videoinput' && Boolean(d.label)
          );
          if (!cancelled && hasLabeledCamera) {
            await startCamera();
          }
        } catch {
          // Ignore enumeration error
        }
      }
    }

    autoStartIfPermitted();
    return () => {
      cancelled = true;
    };
  }, [startCamera]);

  // Release any active camera/mic/screen tracks when component unmounts
  useEffect(() => {
    return () => {
      if (hostStreamRef.current) {
        hostStreamRef.current.getTracks().forEach((track) => track.stop());
        hostStreamRef.current = null;
      }
      if (hostAudioStreamRef.current) {
        hostAudioStreamRef.current.getTracks().forEach((track) => track.stop());
        hostAudioStreamRef.current = null;
      }
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((track) => track.stop());
        screenStreamRef.current = null;
      }
    };
  }, []);

  // Sync Host Audio Feed
  useEffect(() => {
    let isCancelled = false;

    async function setupHostAudio() {
      if (hostAudioStreamRef.current) {
        hostAudioStreamRef.current.getTracks().forEach((t) => t.stop());
        hostAudioStreamRef.current = null;
      }

      if (!hostConfig.audioDeviceId || hostConfig.audioDeviceId === 'none') {
        audioStudio.attachChannelStream('host', null, hostConfig.audioSettings);
        return;
      }

      try {
        const stream = await acquireAudioStream(hostConfig.audioDeviceId);
        if (isCancelled) return;

        hostAudioStreamRef.current = stream;
        audioStudio.attachChannelStream('host', stream, hostConfig.audioSettings);
      } catch (err) {
        console.warn('Host audio initialization error:', err);
      }
    }

    setupHostAudio();
    return () => {
      isCancelled = true;
    };
  }, [hostConfig.audioDeviceId, acquireAudioStream]);

  // Update DSP settings on Host channel
  useEffect(() => {
    audioStudio.updateChannelSettings('host', hostConfig.audioSettings);
  }, [hostConfig.audioSettings]);

  // VU Meter Polling Loop (60fps level checking)
  useEffect(() => {
    let animId: number;

    const pollMeters = () => {
      const hLevel = audioStudio.getChannelLevel('host');
      const mLevel = audioStudio.getChannelLevel('master');

      setHostVu(hLevel);
      setMasterVu(mLevel);

      animId = requestAnimationFrame(pollMeters);
    };

    animId = requestAnimationFrame(pollMeters);
    return () => {
      cancelAnimationFrame(animId);
    };
  }, []);

  // Recording Timer
  useEffect(() => {
    if (isRecording && !isPaused) {
      recordingTimerRef.current = window.setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
    }

    return () => {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
    };
  }, [isRecording, isPaused]);

  // Start Recording
  const startRecording = async () => {
    await audioStudio.ensureContextRunning();

    const isIframeActive =
      Boolean(mediaState.embedUrl) &&
      (mediaState.type === 'youtube' ||
        mediaState.type === 'facebook' ||
        mediaState.type === 'web-embed');

    let recordingVideoStream: MediaStream | null = null;

    if (isIframeActive) {
      try {
        const tabStream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 30 },
          },
          audio: true,
        });

        iframeCaptureStreamRef.current = tabStream;
        recordingVideoStream = tabStream;

        if (tabStream.getAudioTracks().length > 0) {
          audioStudio.attachMediaStream(tabStream);
        }

        const vTrack = tabStream.getVideoTracks()[0];
        if (vTrack) {
          vTrack.onended = () => {
            stopRecording();
          };
        }
      } catch (err: any) {
        const namePrefix = err?.name ? `${err.name}: ` : '';
        const message =
          err?.message ||
          'Tab capture was cancelled or disallowed by browser permissions policy.';
        console.warn('Tab capture was cancelled or rejected by user:', err);
        setMediaError(`${namePrefix}${message}`);
        return;
      }
    } else {
      if (!canvasRef.current) {
        console.error('Canvas ref is missing');
        return;
      }
      // Capture 30FPS video stream from the composited HTML5 Canvas (excludes Teleprompter overlay)
      recordingVideoStream = canvasRef.current.captureStream(30);
    }

    // Capture mixed Web Audio stream (combines Host microphone + added video/screen audio)
    const audioStream = audioStudio.getMixedStream();

    // Combine tracks into a broadcast MediaStream
    const combinedStream = new MediaStream();
    recordingVideoStream.getVideoTracks().forEach((track) => combinedStream.addTrack(track));
    if (audioStream) {
      audioStream.getAudioTracks().forEach((track) => combinedStream.addTrack(track));
    }

    let options: MediaRecorderOptions = { mimeType: 'video/webm;codecs=vp9,opus' };
    if (!MediaRecorder.isTypeSupported(options.mimeType!)) {
      options = { mimeType: 'video/webm' };
      if (!MediaRecorder.isTypeSupported(options.mimeType!)) {
        options = { mimeType: 'video/mp4' };
      }
    }

    try {
      const recorder = new MediaRecorder(combinedStream, options);
      recordedChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        if (iframeCaptureStreamRef.current) {
          iframeCaptureStreamRef.current.getTracks().forEach((t) => t.stop());
          iframeCaptureStreamRef.current = null;
        }

        let mimeType = 'video/webm;codecs=vp9,opus';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = recorder.mimeType || 'video/webm';
        }
        const blob = new Blob(recordedChunksRef.current, { type: mimeType });
        const url = window.URL.createObjectURL(blob);

        if (previousRecordedUrlRef.current) {
          window.URL.revokeObjectURL(previousRecordedUrlRef.current);
        }
        previousRecordedUrlRef.current = url;

        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
        const filename = `Podcast_Recording_${timestamp}.webm`;

        setRecordedVideoBlob(blob);
        setRecordedVideoUrl(url);
        setCurrentRecordingFilename(filename);
        setShowReviewModal(true);
        setHasRecordedSession(true);
        lastRecordingDurationRef.current = recordingSeconds;

        // Instant local browser download directly to user's device storage
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      };

      recorder.start(1000);
      mediaRecorderRef.current = recorder;

      setRecordingSeconds(0);
      setChapterMarkers([
        {
          id: 'intro',
          timestampSeconds: 0,
          formattedTime: '00:00',
          label: 'Show Intro & Opening',
        },
      ]);
      setIsRecording(true);
      setIsPaused(false);
    } catch (err) {
      console.error('Failed to start MediaRecorder:', err);
    }
  };

  // Pause Recording
  const pauseRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.pause();
      setIsPaused(true);
    }
  };

  // Resume Recording
  const resumeRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'paused') {
      mediaRecorderRef.current.resume();
      setIsPaused(false);
    }
  };

  // Stop Recording
  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setIsPaused(false);
    }
    if (iframeCaptureStreamRef.current) {
      iframeCaptureStreamRef.current.getTracks().forEach((t) => t.stop());
      iframeCaptureStreamRef.current = null;
    }
  };

  // Add Chapter Marker
  const addChapterMarker = (customLabel?: string) => {
    const mins = Math.floor(recordingSeconds / 60);
    const secs = Math.floor(recordingSeconds % 60);
    const timeFormatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    const newMarker: ChapterMarker = {
      id: Math.random().toString(36).substring(2, 9),
      timestampSeconds: recordingSeconds,
      formattedTime: timeFormatted,
      label: customLabel || `Chapter ${chapterMarkers.length + 1} (${timeFormatted})`,
    };

    setChapterMarkers((prev) => [...prev, newMarker]);
    addManualNote(`[Chapter Marked: ${newMarker.label}]`, hostConfig.name);
  };

  // Cleanly stop active screen share tracks and reset UI state
  const stopScreenShare = useCallback(() => {
    const activeScreen = screenStreamRef.current;
    if (activeScreen) {
      activeScreen.getTracks().forEach((track) => track.stop());
      screenStreamRef.current = null;
    }

    if (screenVideoRef.current) {
      screenVideoRef.current.pause();
      screenVideoRef.current.srcObject = null;
    }

    setScreenStream(null);
    audioStudio.attachMediaStream(null);

    setMediaState({
      type: 'none',
      title: 'No Media Loaded',
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      volume: 0.85,
      muted: false,
    });
    setLayout('solo-host');
  }, []);

  // Direct user-gesture handler for Share Screen / Tab (getDisplayMedia must run synchronously on click)
  const startScreenShare = useCallback(async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        throw new Error(
          'Screen sharing (getDisplayMedia) is not supported or is blocked in this browser environment.'
        );
      }

      // Invoke getDisplayMedia directly inside the click handler before any async/state delays
      const nextScreenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });

      setMediaError(null);

      // Stop any prior screen/media tracks after the new stream resolves
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;
      }
      if (mediaVideoRef.current) {
        mediaVideoRef.current.pause();
        mediaVideoRef.current.srcObject = null;
        mediaVideoRef.current.removeAttribute('src');
        mediaVideoRef.current.load();
      }
      audioStudio.attachMediaElement(null);

      screenStreamRef.current = nextScreenStream;
      setScreenStream(nextScreenStream);

      if (screenVideoRef.current) {
        screenVideoRef.current.muted = true;
        screenVideoRef.current.srcObject = nextScreenStream;
        await new Promise<void>((resolve) => {
          const v = screenVideoRef.current;
          if (!v || v.readyState >= 1) {
            resolve();
            return;
          }
          const onMeta = () => {
            v.onloadedmetadata = null;
            resolve();
          };
          v.onloadedmetadata = onMeta;
        });
        await screenVideoRef.current.play();
      }

      // Route shared tab/screen audio into Master AudioContext for live playback & recording
      await audioStudio.ensureContextRunning();
      if (nextScreenStream.getAudioTracks().length > 0) {
        audioStudio.attachMediaStream(nextScreenStream);
        audioStudio.setMediaVolume(0.85, false);
      } else {
        audioStudio.attachMediaStream(null);
      }

      const videoTrack = nextScreenStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          stopScreenShare();
        };
      }

      setMediaState({
        type: 'screen',
        title: videoTrack?.label || 'Live Screen / Browser Tab',
        isPlaying: true,
        currentTime: 0,
        duration: 0,
        volume: 0.85,
        muted: false,
      });

      // Automatically switch into Audience Dual-View (Reaction Split 70/30)
      setLayout('reaction-split');
    } catch (err: any) {
      const namePrefix = err?.name ? `${err.name}: ` : '';
      const message =
        err?.message ||
        'Screen sharing was cancelled, denied, or blocked by iframe permissions policy.';
      console.error('startScreenShare failed:', err);
      setMediaError(`${namePrefix}${message}`);
    }
  }, [stopScreenShare]);

  const handleLoadLocalFile = async (file: File) => {
    setMediaError(null);
    await audioStudio.ensureContextRunning();

    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
      setScreenStream(null);
    }
    if (screenVideoRef.current) {
      screenVideoRef.current.pause();
      screenVideoRef.current.srcObject = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }

    const objectUrl = URL.createObjectURL(file);
    if (mediaVideoRef.current) {
      // Unmute element so createMediaElementSource captures its audio into Master AudioContext
      mediaVideoRef.current.muted = false;
      mediaVideoRef.current.volume = 0.85;
      mediaVideoRef.current.srcObject = null;
      mediaVideoRef.current.src = objectUrl;
      mediaVideoRef.current.play().catch(() => {});
      audioStudio.attachMediaElement(mediaVideoRef.current);
      audioStudio.setMediaVolume(0.85, false);
    }

    setMediaState({
      type: 'video-file',
      title: file.name,
      isPlaying: true,
      currentTime: 0,
      duration: 0,
      volume: 0.85,
      muted: false,
    });

    // Automatically switch to Audience Dual-View (Reaction Split 70/30)
    setLayout('reaction-split');
  };

  const handleEmbedAndReact = (url: string) => {
    setMediaError(null);
    const detected = detectAndParseMediaUrl(url);

    if (detected.type === 'direct-video') {
      handleLoadUrl(detected.embedUrl);
      return;
    }

    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
      setScreenStream(null);
    }
    if (screenVideoRef.current) {
      screenVideoRef.current.pause();
      screenVideoRef.current.srcObject = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    if (mediaVideoRef.current) {
      mediaVideoRef.current.pause();
      mediaVideoRef.current.srcObject = null;
      mediaVideoRef.current.removeAttribute('src');
      mediaVideoRef.current.load();
    }
    audioStudio.attachMediaElement(null);

    setMediaState({
      type: detected.type,
      title: detected.title,
      isPlaying: true,
      currentTime: 0,
      duration: 0,
      volume: 0.85,
      muted: false,
      embedUrl: detected.embedUrl,
      videoId: detected.videoId,
      rawUrl: detected.rawUrl,
    });

    setLayout('reaction-pip');
  };

  const handleLoadUrl = async (url: string) => {
    setMediaError(null);
    await audioStudio.ensureContextRunning();

    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
      setScreenStream(null);
    }
    if (screenVideoRef.current) {
      screenVideoRef.current.pause();
      screenVideoRef.current.srcObject = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }

    if (mediaVideoRef.current) {
      const video = mediaVideoRef.current;
      video.muted = false;
      video.volume = 0.85;
      video.srcObject = null;
      video.crossOrigin = 'anonymous';
      video.src = url;
      video.load();
      video.play().catch((err) => {
        console.warn('Video play triggered, waiting for user gesture or buffer:', err);
      });
      audioStudio.attachMediaElement(video);
      audioStudio.setMediaVolume(0.85, false);
    }

    const parsedTitle = url.split('/').pop()?.split('?')[0] || 'Remote Video Stream';
    setMediaState({
      type: 'video-url',
      title: parsedTitle,
      isPlaying: true,
      currentTime: 0,
      duration: 0,
      volume: 0.85,
      muted: false,
    });

    setLayout('reaction-split');
  };

  const handleTogglePlayPause = () => {
    if (
      mediaState.type === 'youtube' ||
      mediaState.type === 'facebook' ||
      mediaState.type === 'web-embed'
    ) {
      setMediaState((prev) => ({ ...prev, isPlaying: !prev.isPlaying }));
      return;
    }

    if (mediaVideoRef.current) {
      if (mediaVideoRef.current.paused) {
        mediaVideoRef.current
          .play()
          .then(() => {
            setMediaState((prev) => ({ ...prev, isPlaying: true }));
          })
          .catch(() => {});
      } else {
        mediaVideoRef.current.pause();
        setMediaState((prev) => ({ ...prev, isPlaying: false }));
      }
    }
  };

  const handleSeek = (seconds: number) => {
    if (mediaVideoRef.current) {
      mediaVideoRef.current.currentTime = seconds;
      setMediaState((prev) => ({ ...prev, currentTime: seconds }));
    }
  };

  const handleMediaVolume = (vol: number) => {
    audioStudio.setMediaVolume(vol, mediaState.muted);
    if (mediaVideoRef.current && mediaState.type !== 'screen') {
      mediaVideoRef.current.volume = vol;
    }
    setMediaState((prev) => ({ ...prev, volume: vol }));
  };

  const handleToggleMediaMute = () => {
    const nextMuted = !mediaState.muted;
    audioStudio.setMediaVolume(mediaState.volume, nextMuted);
    if (mediaVideoRef.current && mediaState.type !== 'screen') {
      mediaVideoRef.current.muted = nextMuted;
    }
    setMediaState((prev) => ({ ...prev, muted: nextMuted }));
  };

  const handleEjectMedia = () => {
    setMediaError(null);
    if (iframeCaptureStreamRef.current) {
      iframeCaptureStreamRef.current.getTracks().forEach((t) => t.stop());
      iframeCaptureStreamRef.current = null;
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
      setScreenStream(null);
    }
    if (screenVideoRef.current) {
      screenVideoRef.current.pause();
      screenVideoRef.current.srcObject = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    if (mediaVideoRef.current) {
      mediaVideoRef.current.pause();
      mediaVideoRef.current.srcObject = null;
      mediaVideoRef.current.removeAttribute('src');
      mediaVideoRef.current.load();
    }
    audioStudio.attachMediaStream(null);
    audioStudio.attachMediaElement(null);
    setMediaState({
      type: 'none',
      title: 'No Media Loaded',
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      volume: 0.85,
      muted: false,
    });
    // Return to Single-Host webcam mode
    setLayout('solo-host');
  };

  // Toggle Headphones Monitoring
  const toggleMonitoring = () => {
    const next = !isMonitoring;
    setIsMonitoring(next);
    audioStudio.setMonitoring(next);
  };

  return (
    <div className="min-h-screen bg-[#07090e] text-slate-100 flex flex-col font-sans selection:bg-blue-600 selection:text-white">
      {/* Real hardware Host video element feeding live decoded frames to canvas compositor */}
      <video
        ref={hostVideoRef}
        autoPlay
        playsInline
        muted
        style={{
          position: 'fixed',
          top: -9999,
          left: -9999,
          width: 1280,
          height: 720,
          opacity: 0,
          pointerEvents: 'none',
          transform: hostConfig.filters.mirror ? 'scaleX(-1)' : 'scaleX(1)',
        }}
      />

      {/* Dedicated offscreen screen-share video element (muted so tab audio mixes via Web Audio API) */}
      <video
        ref={screenVideoRef}
        autoPlay
        playsInline
        muted
        style={{
          position: 'fixed',
          top: -9999,
          left: -9999,
          width: 1280,
          height: 720,
          opacity: 0,
          pointerEvents: 'none',
        }}
      />

      {/* Offscreen media file / direct URL video element */}
      <video
        ref={mediaVideoRef}
        playsInline
        crossOrigin="anonymous"
        onCanPlay={() => {
          setMediaError(null);
        }}
        onError={() => {
          const video = mediaVideoRef.current;
          if (!video || !video.getAttribute('src')) return;
          const code = video?.error?.code;
          let msg = 'Failed to load video stream. The link may be invalid, unavailable, or blocked by CORS.';
          if (code === 1) msg = 'Video loading was aborted.';
          else if (code === 2) msg = 'Network error while downloading the video stream.';
          else if (code === 3) msg = 'Video decoding failed or format is unsupported (must be MP4 or WebM).';
          else if (code === 4) msg = 'Video could not be loaded: source not found (404) or blocked by CORS policy.';
          setMediaError(msg);
        }}
        onPlay={() => {
          setMediaState((prev) => ({ ...prev, isPlaying: true }));
        }}
        onPause={() => {
          setMediaState((prev) => ({ ...prev, isPlaying: false }));
        }}
        onTimeUpdate={() => {
          if (mediaVideoRef.current) {
            setMediaState((prev) => ({
              ...prev,
              currentTime: mediaVideoRef.current?.currentTime || 0,
              duration: mediaVideoRef.current?.duration || prev.duration,
            }));
          }
        }}
        onLoadedMetadata={() => {
          if (mediaVideoRef.current) {
            setMediaState((prev) => ({
              ...prev,
              duration: mediaVideoRef.current?.duration || 0,
            }));
          }
        }}
        onEnded={() => setMediaState((prev) => ({ ...prev, isPlaying: false }))}
        style={{ position: 'fixed', top: -9999, left: -9999, width: 1280, height: 720, opacity: 0, pointerEvents: 'none' }}
      />

      {/* Invisible Teleprompter Script Overlay (HTML/CSS UI only — never drawn onto <canvas>) */}
      <TeleprompterOverlay
        isOpen={showTeleprompter}
        onClose={() => {
          setTeleprompterPlaying(false);
          setShowTeleprompter(false);
        }}
        script={teleprompterScript}
        onChangeScript={setTeleprompterScript}
        fontSize={teleprompterFontSize}
        onChangeFontSize={setTeleprompterFontSize}
        scrollSpeed={teleprompterSpeed}
        onChangeScrollSpeed={setTeleprompterSpeed}
        isPlaying={teleprompterPlaying}
        onTogglePlay={() => setTeleprompterPlaying((prev) => !prev)}
      />

      {/* Broadcast Studio Top Navbar */}
      <header className="border-b border-slate-800/80 bg-slate-950/90 backdrop-blur sticky top-0 z-40 px-4 lg:px-6 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-purple-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Radio className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-extrabold text-base tracking-tight text-white whitespace-nowrap">
              PodCraft Studio
            </h1>
            <p className="text-[11px] text-slate-400 whitespace-nowrap">
              Single-Host Reaction & Teleprompter Broadcast Studio
            </p>
          </div>
        </div>

        {/* Top Toolbar Controls */}
        <div className="flex flex-wrap items-center gap-2.5">
          {!permissionGranted && (
            <button
              onClick={() => startCamera()}
              className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs flex items-center gap-1.5 shadow-md shadow-emerald-600/30 transition-all cursor-pointer whitespace-nowrap shrink-0"
            >
              <CheckCircle className="w-3.5 h-3.5" />
              Unlock Camera & Mic
            </button>
          )}

          {/* Teleprompter Script Toggle Button */}
          <button
            type="button"
            onClick={() => setShowTeleprompter((prev) => !prev)}
            className={`px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap shrink-0 ${
              showTeleprompter
                ? 'bg-sky-600 text-white border-sky-400 shadow-md shadow-sky-600/30'
                : 'bg-slate-900 text-slate-200 border-slate-800 hover:bg-slate-800'
            }`}
            title="Toggle floating Teleprompter Script overlay (visible only to you, not recorded)"
          >
            <ScrollText className={`w-3.5 h-3.5 ${showTeleprompter ? 'text-white' : 'text-sky-400'}`} />
            Teleprompter Script
          </button>

          {/* Transcript Drawer Toggle */}
          <button
            type="button"
            onClick={() => setShowTranscriptDrawer(!showTranscriptDrawer)}
            className={`px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap shrink-0 ${
              showTranscriptDrawer
                ? 'bg-slate-800 text-white border-blue-500/50'
                : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800'
            }`}
          >
            <FileText className="w-3.5 h-3.5 text-blue-400" />
            Live Transcript
            {transcriptEntries.length > 0 && (
              <span className="bg-blue-600 text-white text-[10px] px-1.5 py-0.2 rounded-full font-mono tabular-nums">
                {transcriptEntries.length}
              </span>
            )}
          </button>

          {/* Gemini AI Show Notes Trigger */}
          <button
            type="button"
            onClick={() => setShowNotesModal(true)}
            className="px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 hover:brightness-110 text-white font-semibold text-xs flex items-center gap-1.5 shadow-md shadow-purple-600/30 transition-all cursor-pointer whitespace-nowrap shrink-0"
          >
            <Sparkles className="w-3.5 h-3.5 text-purple-200" />
            AI Show Notes
          </button>
        </div>
      </header>

      {/* Main Studio Work Area */}
      <main className="flex-1 max-w-[1720px] w-full mx-auto p-4 lg:p-6 space-y-6">
        {/* Device Permission Banner if not yet requested */}
        {deviceError && (
          <div className="p-3 bg-amber-950/40 border border-amber-800/80 rounded-xl text-xs text-amber-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>{deviceError}</span>
            </div>
            <button
              onClick={() => startCamera()}
              className="px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded text-xs font-bold cursor-pointer"
            >
              Grant Access
            </button>
          </div>
        )}

        {/* Visible Screen Share / Media Alert Banner */}
        {mediaError && (
          <div
            role="alert"
            className="p-3 bg-red-950/60 border border-red-700/80 rounded-xl text-xs text-red-200 flex flex-wrap items-center justify-between gap-3"
          >
            <div className="flex items-center gap-2 min-w-0">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <div className="space-y-0.5">
                <div>
                  <strong className="text-red-300">Screen Share / Media Error:</strong> {mediaError}
                </div>
                {(mediaError.includes('display-capture') || mediaError.includes('permissions policy')) && (
                  <div className="text-[11px] text-red-200/80">
                    The surrounding preview iframe blocked <code className="font-mono text-red-200">display-capture</code>. Reload the preview or open the studio directly in a new browser tab to share any screen or tab.
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {(mediaError.includes('display-capture') || mediaError.includes('permissions policy')) && (
                <a
                  href={typeof window !== 'undefined' ? window.location.href : '/'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2.5 py-1 bg-purple-600 hover:bg-purple-500 text-white rounded text-xs font-bold flex items-center gap-1 cursor-pointer"
                >
                  <ExternalLink className="w-3 h-3" />
                  Open in New Tab
                </a>
              )}
              <button
                type="button"
                onClick={() => setMediaError(null)}
                className="px-2.5 py-1 bg-red-800/80 hover:bg-red-700 text-white rounded text-xs font-bold cursor-pointer shrink-0"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* 1. Main Broadcast Canvas Viewport */}
        <section>
          <BroadcastCanvasView
            canvasRef={canvasRef}
            hostVideoRef={hostVideoRef}
            mediaVideoRef={mediaVideoRef}
            screenVideoRef={screenVideoRef}
            screenStream={screenStream}
            mediaTitle={mediaState.title}
            mediaState={mediaState}
            isMediaActive={mediaState.type !== 'none'}
            layout={layout}
            setLayout={setLayout}
            hostFilters={hostConfig.filters}
            hostName={hostConfig.name}
            branding={branding}
            setBranding={setBranding}
            isRecording={isRecording}
            recordingTimeSeconds={recordingSeconds}
            hostVuLevel={hostVu.rms}
            hostStream={hostStream}
            isCameraOn={Boolean(hostStream)}
            onToggleCamera={handleToggleCamera}
            onTogglePlayPause={handleTogglePlayPause}
            onVolumeChange={handleMediaVolume}
            onToggleMute={handleToggleMediaMute}
            onEjectMedia={handleEjectMedia}
            onToggleHostMirror={() =>
              setHostConfig((prev) => ({
                ...prev,
                filters: { ...prev.filters, mirror: !prev.filters.mirror },
              }))
            }
          />
        </section>

        {/* 2. Reaction Media & Screen Share Commentary Controller */}
        <section>
          <ReactionMediaControls
            mediaState={mediaState}
            mediaError={mediaError}
            onClearError={() => setMediaError(null)}
            onStartScreenShare={startScreenShare}
            onLoadLocalFile={handleLoadLocalFile}
            onLoadUrl={handleLoadUrl}
            onEmbedAndReact={handleEmbedAndReact}
            onTogglePlayPause={handleTogglePlayPause}
            onSeek={handleSeek}
            onVolumeChange={handleMediaVolume}
            onToggleMute={handleToggleMediaMute}
            onEjectMedia={handleEjectMedia}
            activeLayout={layout}
            onSelectLayout={setLayout}
          />
        </section>

        {/* 3. Recording Status Toolbar & Master Audio */}
        <section>
          <RecordingBar
            isRecording={isRecording}
            isPaused={isPaused}
            recordingSeconds={recordingSeconds}
            onStartRecording={startRecording}
            onPauseRecording={pauseRecording}
            onResumeRecording={resumeRecording}
            onStopRecording={stopRecording}
            onAddMarker={addChapterMarker}
            chapterMarkers={chapterMarkers}
            masterVuLevel={masterVu}
            isMonitoring={isMonitoring}
            onToggleMonitoring={toggleMonitoring}
            onOpenShowNotesPrompt={() => setShowNotesModal(true)}
            onOpenReviewModal={() => setShowReviewModal(true)}
            hasRecordedSession={hasRecordedSession}
            transcriptCount={transcriptEntries.length}
          />
        </section>

        {/* 4. Single-Host Camera, Audio & Filter Controls */}
        <section>
          <ChannelControls
            channel={hostConfig}
            videoDevices={videoDevices}
            audioDevices={audioDevices}
            vuLevel={hostVu}
            isCameraOn={Boolean(hostStream)}
            onToggleCamera={handleToggleCamera}
            onSelectVideoDevice={handleSelectVideoDevice}
            onUpdateChannel={(updated) => setHostConfig((prev) => ({ ...prev, ...updated }))}
            onUpdateFilters={(filters) =>
              setHostConfig((prev) => ({
                ...prev,
                filters: { ...prev.filters, ...filters },
              }))
            }
            onUpdateAudio={(audio) =>
              setHostConfig((prev) => ({
                ...prev,
                audioSettings: { ...prev.audioSettings, ...audio },
              }))
            }
          />
        </section>

        {/* 5. Live Speech Recognition & Transcript Drawer */}
        {showTranscriptDrawer && (
          <section className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-xl space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-blue-400" />
                <h3 className="font-bold text-white text-sm">
                  Synchronized Live Speech Transcript
                </h3>
                <span
                  className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${
                    isTranscriptListening
                      ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {isTranscriptListening ? 'LISTENING (MIC ACTIVE)' : 'IDLE'}
                </span>
              </div>
              <button
                onClick={() => setShowTranscriptDrawer(false)}
                className="text-xs text-slate-400 hover:text-white cursor-pointer"
              >
                Close Drawer
              </button>
            </div>

            <div className="max-h-56 overflow-y-auto space-y-2 font-mono text-xs p-3 bg-slate-950/80 rounded-xl border border-slate-800">
              {transcriptEntries.length === 0 ? (
                <p className="text-slate-500 italic">
                  {isSpeechSupported
                    ? 'Start recording to automatically transcribe dialogue with timestamps. Or enter talking points below.'
                    : 'Web Speech API is not supported in this browser. You can type manual discussion cues below.'}
                </p>
              ) : (
                transcriptEntries.map((entry) => (
                  <div key={entry.id} className="flex items-start gap-2 text-slate-300">
                    <span className="text-blue-400 font-bold shrink-0">[{entry.timestamp}]</span>
                    <span className="text-purple-300 font-bold shrink-0">{entry.speaker}:</span>
                    <span className="leading-relaxed">{entry.text}</span>
                  </div>
                ))
              )}
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Add quick talking point or note to transcript context..."
                value={manualNoteText}
                onChange={(e) => setManualNoteText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && manualNoteText.trim()) {
                    addManualNote(manualNoteText, hostConfig.name);
                    setManualNoteText('');
                  }
                }}
                className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-blue-500"
              />
              <button
                onClick={() => {
                  if (manualNoteText.trim()) {
                    addManualNote(manualNoteText, hostConfig.name);
                    setManualNoteText('');
                  }
                }}
                className="px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer"
              >
                Add Note
              </button>
            </div>
          </section>
        )}
      </main>

      {/* Recording Complete & Download Video Modal */}
      <RecordingReviewModal
        isOpen={showReviewModal}
        onClose={() => setShowReviewModal(false)}
        videoUrl={recordedVideoUrl}
        videoBlob={recordedVideoBlob}
        durationSeconds={lastRecordingDurationRef.current || recordingSeconds}
        filename={currentRecordingFilename}
        onGenerateShowNotes={() => setShowNotesModal(true)}
      />

      {/* Gemini AI Show Notes Modal */}
      <ShowNotesModal
        isOpen={showNotesModal}
        onClose={() => setShowNotesModal(false)}
        podcastName={branding.podcastName}
        hostName={hostConfig.name}
        guestName=""
        durationSeconds={recordingSeconds || lastRecordingDurationRef.current || 180}
        chapterMarkers={chapterMarkers}
        transcript={transcript}
      />
    </div>
  );
}
