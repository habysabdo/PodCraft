/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Radio,
  Sparkles,
  Layers,
  Settings,
  HelpCircle,
  AlertCircle,
  FileText,
  Volume2,
  CheckCircle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import {
  ChannelConfig,
  LayoutMode,
  StudioBranding,
  ChapterMarker,
  VideoFilterSettings,
  AudioFilterSettings,
  ReactionMediaState,
  ShowNotesData,
} from './types/studio';
import { useDevices } from './hooks/useDevices';
import { useRemoteGuest } from './hooks/useRemoteGuest';
import { useSpeechRecognition } from './hooks/useSpeechRecognition';
import { audioStudio } from './utils/audioProcessor';
import { BroadcastCanvasView } from './components/BroadcastCanvasView';
import { ChannelControls } from './components/ChannelControls';
import { RecordingBar } from './components/RecordingBar';
import { RecordingReviewModal } from './components/RecordingReviewModal';
import { ShowNotesModal } from './components/ShowNotesModal';
import { YouTubeCallback } from './components/YouTubeCallback';
import { ReactionMediaControls } from './components/ReactionMediaControls';
import { GuestJoinView } from './components/GuestJoinView';
import { RemoteGuestInvite } from './components/RemoteGuestInvite';
import { detectAndParseMediaUrl } from './utils/urlDetector';

const DEFAULT_FILTERS: VideoFilterSettings = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
  warmth: 0,
  grayscale: false,
  mirror: false,
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
    requestPermissions,
    acquireVideoStream,
    acquireAudioStream,
  } = useDevices();

  // Guest mode: ?guest=<code> renders the guest join screen instead of the
  // studio (the early return sits just before the studio JSX below).
  const [guestCode] = useState<string | null>(() => {
    try {
      return new URLSearchParams(window.location.search).get('guest');
    } catch {
      return null;
    }
  });

  // YouTube OAuth return (Piece 3): Google redirects here with ?code=… after
  // sign-in. The early return below renders the callback screen instead of
  // the studio; it exchanges the code, then sends the user back.
  const [isYouTubeCallback] = useState<boolean>(() => {
    try {
      return window.location.pathname === '/youtube-callback';
    } catch {
      return false;
    }
  });

  // Studio Branding & Lower Thirds
  const [branding, setBranding] = useState<StudioBranding>({
    podcastName: 'The Founders & Creators Show',
    episodeTitle: 'Episode 42: The Architecture of Modern High-Impact Media',
    showLowerThird: true,
    themeColor: '#6366f1',
  });

  // Active Broadcast Layout
  const [layout, setLayout] = useState<LayoutMode>('side-by-side');

  // Channels state (Channel 1: Host, Channel 2: Guest)
  const [hostConfig, setHostConfig] = useState<ChannelConfig>({
    id: 'host',
    label: 'Channel 1 (Host)',
    name: 'Alex Rivera',
    roleTitle: 'Host',
    videoDeviceId: '',
    audioDeviceId: '',
    filters: { ...DEFAULT_FILTERS },
    audioSettings: { ...DEFAULT_AUDIO_SETTINGS },
  });

  const [guestConfig, setGuestConfig] = useState<ChannelConfig>({
    id: 'guest',
    label: 'Channel 2 (Guest)',
    name: 'Dr. Elena Vance',
    roleTitle: 'Guest',
    videoDeviceId: '',
    audioDeviceId: '',
    filters: { ...DEFAULT_FILTERS },
    audioSettings: { ...DEFAULT_AUDIO_SETTINGS },
  });

  // Video references (hidden elements feeding frames to canvas)
  const hostVideoRef = useRef<HTMLVideoElement | null>(null);
  const guestVideoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Active streams
  const hostVideoStreamRef = useRef<MediaStream | null>(null);
  const guestVideoStreamRef = useRef<MediaStream | null>(null);
  const hostAudioStreamRef = useRef<MediaStream | null>(null);
  const guestAudioStreamRef = useRef<MediaStream | null>(null);

  // ---- Remote guest (Piece 1) ----
  // When a remote guest is live, their stream owns the Guest channel and the
  // local guest hardware is stopped. When they leave, the local device
  // setup below re-runs (guestRestoreBump) so the solo studio is untouched.
  const [inviteRoomCode, setInviteRoomCode] = useState<string | null>(null);
  const [inviteActive, setInviteActive] = useState(false);
  const [remoteGuestStream, setRemoteGuestStream] = useState<MediaStream | null>(null);
  const [guestRestoreBump, setGuestRestoreBump] = useState(0);
  const remoteGuestStreamRef = useRef<MediaStream | null>(null);

  const remoteGuest = useRemoteGuest({
    roomCode: inviteRoomCode,
    enabled: inviteActive,
    onRemoteStream: (stream, name) => {
      if (stream) {
        remoteGuestStreamRef.current = stream;
        setRemoteGuestStream(stream);
        if (name) {
          setGuestConfig((prev) => ({ ...prev, name }));
        }
        // Free the local guest hardware while the remote feed owns the channel.
        if (guestVideoStreamRef.current) {
          guestVideoStreamRef.current.getTracks().forEach((t) => t.stop());
          guestVideoStreamRef.current = null;
        }
        if (guestAudioStreamRef.current) {
          guestAudioStreamRef.current.getTracks().forEach((t) => t.stop());
          guestAudioStreamRef.current = null;
        }
      } else {
        remoteGuestStreamRef.current = null;
        setRemoteGuestStream(null);
        setGuestRestoreBump((b) => b + 1);
      }
    },
  });

  // Attach a remote guest stream to the existing guest channel: the hidden
  // guest video element feeds the canvas, and the DSP audio graph gets the
  // remote audio — VU meter, filters, composite and recording just work.
  useEffect(() => {
    if (remoteGuestStream) {
      if (guestVideoRef.current) {
        guestVideoRef.current.srcObject = remoteGuestStream;
        guestVideoRef.current.play().catch(() => {});
      }
      audioStudio.attachChannelStream('guest', remoteGuestStream, guestConfig.audioSettings);
    }
  }, [remoteGuestStream]);

  const createInvite = async () => {
    try {
      const res = await fetch('/api/rooms', { method: 'POST' });
      const data = await res.json();
      if (!data?.code) throw new Error('No room code returned');
      setInviteRoomCode(data.code);
      setInviteActive(true);
    } catch (err) {
      console.warn('Failed to create invite room:', err);
    }
  };

  const endInvite = () => {
    setInviteActive(false);
    setInviteRoomCode(null);
  };

  // Reaction Media & Screen Share
  const mediaVideoRef = useRef<HTMLVideoElement | null>(null);
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
  /** Last generated AI show notes (Piece 3) — the Review modal pre-fills the
   *  YouTube title + description from these when they exist. */
  const [showNotes, setShowNotes] = useState<ShowNotesData | null>(null);
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
  const [guestVu, setGuestVu] = useState({ rms: 0, peak: 0, db: -60, isClipping: false });
  const [masterVu, setMasterVu] = useState({ rms: 0, peak: 0, db: -60, isClipping: false });
  const [isMonitoring, setIsMonitoring] = useState(false);

  // Live Speech Recognition for Transcript
  const {
    transcript,
    setTranscript,
    entries: transcriptEntries,
    isListening: isTranscriptListening,
    supported: isSpeechSupported,
    addManualNote,
    clearTranscript,
  } = useSpeechRecognition(isRecording && !isPaused, recordingSeconds, hostConfig.name);

  const [showTranscriptDrawer, setShowTranscriptDrawer] = useState(false);
  const [manualNoteText, setManualNoteText] = useState('');

  // Auto-select initial real hardware devices when detected
  useEffect(() => {
    if (videoDevices.length > 0) {
      if (!hostConfig.videoDeviceId) {
        setHostConfig((prev) => ({ ...prev, videoDeviceId: videoDevices[0].deviceId }));
      }
      if (!guestConfig.videoDeviceId) {
        const secondCam = videoDevices.length > 1 ? videoDevices[1].deviceId : videoDevices[0].deviceId;
        setGuestConfig((prev) => ({ ...prev, videoDeviceId: secondCam }));
      }
    }
  }, [videoDevices]);

  useEffect(() => {
    if (audioDevices.length > 0) {
      if (!hostConfig.audioDeviceId) {
        setHostConfig((prev) => ({ ...prev, audioDeviceId: audioDevices[0].deviceId }));
      }
      if (!guestConfig.audioDeviceId) {
        const secondMic = audioDevices.length > 1 ? audioDevices[1].deviceId : audioDevices[0].deviceId;
        setGuestConfig((prev) => ({ ...prev, audioDeviceId: secondMic }));
      }
    }
  }, [audioDevices]);

  // Sync Host Video Feed
  useEffect(() => {
    let isCancelled = false;

    async function setupHostVideo() {
      if (hostVideoStreamRef.current) {
        hostVideoStreamRef.current.getTracks().forEach((t) => t.stop());
        hostVideoStreamRef.current = null;
      }

      if (!hostConfig.videoDeviceId || hostConfig.videoDeviceId === 'none') {
        if (hostVideoRef.current) {
          hostVideoRef.current.srcObject = null;
        }
        return;
      }

      try {
        const stream = await acquireVideoStream(hostConfig.videoDeviceId);
        if (isCancelled) return;

        hostVideoStreamRef.current = stream;
        if (hostVideoRef.current && stream) {
          hostVideoRef.current.srcObject = stream;
          hostVideoRef.current.play().catch(() => {});
        }
      } catch (err) {
        console.warn('Host video initialization error:', err);
      }
    }

    setupHostVideo();
    return () => {
      isCancelled = true;
    };
  }, [hostConfig.videoDeviceId, acquireVideoStream]);

  // Sync Guest Video Feed
  useEffect(() => {
    let isCancelled = false;

    async function setupGuestVideo() {
      // A remote guest owns the guest channel — leave its stream alone.
      if (remoteGuestStreamRef.current) return;

      if (guestVideoStreamRef.current) {
        guestVideoStreamRef.current.getTracks().forEach((t) => t.stop());
        guestVideoStreamRef.current = null;
      }

      if (!guestConfig.videoDeviceId || guestConfig.videoDeviceId === 'none') {
        if (guestVideoRef.current) {
          guestVideoRef.current.srcObject = null;
        }
        return;
      }

      try {
        const stream = await acquireVideoStream(guestConfig.videoDeviceId);
        if (isCancelled) return;

        guestVideoStreamRef.current = stream;
        if (guestVideoRef.current && stream) {
          guestVideoRef.current.srcObject = stream;
          guestVideoRef.current.play().catch(() => {});
        }
      } catch (err) {
        console.warn('Guest video initialization error:', err);
      }
    }

    setupGuestVideo();
    return () => {
      isCancelled = true;
    };
  }, [guestConfig.videoDeviceId, acquireVideoStream, guestRestoreBump]);

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

  // Sync Guest Audio Feed
  useEffect(() => {
    let isCancelled = false;

    async function setupGuestAudio() {
      // A remote guest owns the guest channel — leave its stream alone.
      if (remoteGuestStreamRef.current) return;

      if (guestAudioStreamRef.current) {
        guestAudioStreamRef.current.getTracks().forEach((t) => t.stop());
        guestAudioStreamRef.current = null;
      }

      if (!guestConfig.audioDeviceId || guestConfig.audioDeviceId === 'none') {
        audioStudio.attachChannelStream('guest', null, guestConfig.audioSettings);
        return;
      }

      try {
        const stream = await acquireAudioStream(guestConfig.audioDeviceId);
        if (isCancelled) return;

        guestAudioStreamRef.current = stream;
        audioStudio.attachChannelStream('guest', stream, guestConfig.audioSettings);
      } catch (err) {
        console.warn('Guest audio initialization error:', err);
      }
    }

    setupGuestAudio();
    return () => {
      isCancelled = true;
    };
  }, [guestConfig.audioDeviceId, acquireAudioStream, guestRestoreBump]);

  // Update DSP settings on active channels
  useEffect(() => {
    audioStudio.updateChannelSettings('host', hostConfig.audioSettings);
  }, [hostConfig.audioSettings]);

  useEffect(() => {
    audioStudio.updateChannelSettings('guest', guestConfig.audioSettings);
  }, [guestConfig.audioSettings]);

  // VU Meter Polling Loop (60fps level checking)
  useEffect(() => {
    let animId: number;

    const pollMeters = () => {
      const hLevel = audioStudio.getChannelLevel('host');
      const gLevel = audioStudio.getChannelLevel('guest');
      const mLevel = audioStudio.getChannelLevel('master');

      setHostVu(hLevel);
      setGuestVu(gLevel);
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
        // As requested: When recording starts with an external embedded iframe active,
        // trigger getDisplayMedia({ video: true, audio: true }) automatically to capture
        // the entire composite studio viewport and system audio without CORS errors.
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

        // Mix tab audio into Web Audio processor
        if (tabStream.getAudioTracks().length > 0) {
          audioStudio.attachMediaStream(tabStream);
        }

        // Auto-stop recording if user stops tab capture from browser bar
        const vTrack = tabStream.getVideoTracks()[0];
        if (vTrack) {
          vTrack.onended = () => {
            stopRecording();
          };
        }
      } catch (err) {
        console.warn('Tab capture was cancelled or rejected by user:', err);
        return;
      }
    } else {
      if (!canvasRef.current) {
        console.error('Canvas ref is missing');
        return;
      }
      // Capture 30FPS video stream from the composited HTML5 Canvas
      recordingVideoStream = canvasRef.current.captureStream(30);
    }

    // Capture mixed Web Audio stream (contains Host, Guest, and Media/Tab audio)
    const audioStream = audioStudio.getMixedStream();

    // Combine tracks into a combined broadcast MediaStream
    const combinedStream = new MediaStream();
    recordingVideoStream.getVideoTracks().forEach((track) => combinedStream.addTrack(track));
    if (audioStream) {
      audioStream.getAudioTracks().forEach((track) => combinedStream.addTrack(track));
    }

    // Choose preferred mimeType supported by browser
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
        // Clean up any active displayMedia tracks from tab capture
        if (iframeCaptureStreamRef.current) {
          iframeCaptureStreamRef.current.getTracks().forEach((t) => t.stop());
          iframeCaptureStreamRef.current = null;
        }

        // 1. Local-Only Storage: Assemble chunks strictly in client browser memory (RAM)
        let mimeType = 'video/webm;codecs=vp9,opus';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = recorder.mimeType || 'video/webm';
        }
        const blob = new Blob(recordedChunksRef.current, { type: mimeType });

        // 2. Generate local blob URL
        const url = window.URL.createObjectURL(blob);

        // Revoke previous object URL if any to free client device memory
        if (previousRecordedUrlRef.current) {
          window.URL.revokeObjectURL(previousRecordedUrlRef.current);
        }
        previousRecordedUrlRef.current = url;

        // 3. Format filename: Podcast_Recording_[TIMESTAMP].webm
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

        // 4. Instant local browser download directly to user's PC or phone storage
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      };

      recorder.start(1000); // 1-second chunks
      mediaRecorderRef.current = recorder;

      setRecordingSeconds(0);
      setChapterMarkers([
        {
          id: 'intro',
          timestampSeconds: 0,
          formattedTime: '00:00',
          label: 'Show Intro & Welcoming Guest',
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

  // Media & Screen Share Actions
  const handleStartScreenShare = async () => {
    try {
      setMediaError(null);
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;
      }

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 },
        },
        audio: true,
      });

      mediaStreamRef.current = stream;

      if (mediaVideoRef.current) {
        mediaVideoRef.current.src = '';
        mediaVideoRef.current.srcObject = stream;
        mediaVideoRef.current.play().catch(() => {});
      }

      // Route screen audio through Web Audio
      audioStudio.attachMediaStream(stream);

      // Listen for when user clicks native "Stop Sharing" floating bar
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          handleEjectMedia();
        };
      }

      setMediaState({
        type: 'screen',
        title: 'Live Screen / Browser Tab',
        isPlaying: true,
        currentTime: 0,
        duration: 0,
        volume: 0.85,
        muted: false,
      });

      // Automatically switch layout to Reaction Split
      setLayout('reaction-split');
    } catch (err) {
      console.warn('Screen share cancelled or rejected:', err);
    }
  };

  const handleLoadLocalFile = (file: File) => {
    setMediaError(null);
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }

    const objectUrl = URL.createObjectURL(file);
    if (mediaVideoRef.current) {
      mediaVideoRef.current.srcObject = null;
      mediaVideoRef.current.src = objectUrl;
      mediaVideoRef.current.play().catch(() => {});
      audioStudio.attachMediaElement(mediaVideoRef.current);
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

    setLayout('reaction-split');
  };

  const handleEmbedAndReact = (url: string) => {
    setMediaError(null);
    const detected = detectAndParseMediaUrl(url);

    if (detected.type === 'direct-video') {
      handleLoadUrl(detected.embedUrl);
      return;
    }

    // Stop active screen share tracks
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    // Pause any native media video element
    if (mediaVideoRef.current) {
      mediaVideoRef.current.pause();
      mediaVideoRef.current.srcObject = null;
      mediaVideoRef.current.src = '';
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

    // Default to Reaction PiP mode for rich commentary
    setLayout('reaction-pip');
  };

  const handleLoadUrl = (url: string) => {
    setMediaError(null);
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }

    if (mediaVideoRef.current) {
      const video = mediaVideoRef.current;
      video.srcObject = null;
      video.crossOrigin = 'anonymous';
      video.src = url;
      video.load();
      video.play().catch((err) => {
        console.warn('Video play triggered, waiting for user gesture or buffer:', err);
      });
      audioStudio.attachMediaElement(video);
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
    if (mediaVideoRef.current) {
      mediaVideoRef.current.volume = vol;
    }
    setMediaState((prev) => ({ ...prev, volume: vol }));
  };

  const handleToggleMediaMute = () => {
    const nextMuted = !mediaState.muted;
    audioStudio.setMediaVolume(mediaState.volume, nextMuted);
    if (mediaVideoRef.current) {
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
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    if (mediaVideoRef.current) {
      mediaVideoRef.current.pause();
      mediaVideoRef.current.srcObject = null;
      mediaVideoRef.current.src = '';
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
    if (layout === 'reaction-split' || layout === 'reaction-pip') {
      setLayout('side-by-side');
    }
  };

  // Toggle Headphones Monitoring
  const toggleMonitoring = () => {
    const next = !isMonitoring;
    setIsMonitoring(next);
    audioStudio.setMonitoring(next);
  };

  // YouTube OAuth return: exchange the code, then back to the studio.
  if (isYouTubeCallback) {
    return <YouTubeCallback />;
  }

  // Guest mode: ?guest=<code> opens the join screen instead of the studio.
  if (guestCode) {
    return <GuestJoinView code={guestCode} />;
  }

  return (
    <div className="min-h-screen bg-[#07090e] text-slate-100 flex flex-col font-sans selection:bg-blue-600 selection:text-white">
      {/* Real hardware video elements feeding live decoded frames to canvas compositor */}
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
      <video
        ref={guestVideoRef}
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
          transform: guestConfig.filters.mirror ? 'scaleX(-1)' : 'scaleX(1)',
        }}
      />
      {/* Offscreen media / screen share video element */}
      <video
        ref={mediaVideoRef}
        playsInline
        crossOrigin="anonymous"
        onCanPlay={() => {
          setMediaError(null);
        }}
        onError={() => {
          const video = mediaVideoRef.current;
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

      {/* Broadcast Studio Top Navbar */}
      <header className="border-b border-slate-800/80 bg-slate-950/80 backdrop-blur sticky top-0 z-40 px-4 lg:px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-purple-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Radio className="w-5 h-5 text-white animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-extrabold text-base tracking-tight text-white">
                PodCraft Studio
              </h1>
              <span className="text-[10px] font-mono font-bold bg-blue-950 text-blue-400 border border-blue-800/60 px-2 py-0.5 rounded-full uppercase tracking-wider">
                Broadcast Pro
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Dual-Camera Studio • Web Audio DSP • Gemini AI Show Notes
            </p>
          </div>
        </div>

        {/* Global actions & Permission button */}
        <div className="flex items-center gap-3">
          {!permissionGranted && (
            <button
              onClick={requestPermissions}
              className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs flex items-center gap-1.5 shadow-md shadow-emerald-600/30 transition-all cursor-pointer"
            >
              <CheckCircle className="w-3.5 h-3.5" />
              Unlock Devices Access
            </button>
          )}

          {/* Transcript Drawer Toggle */}
          <button
            onClick={() => setShowTranscriptDrawer(!showTranscriptDrawer)}
            className={`px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
              showTranscriptDrawer
                ? 'bg-slate-800 text-white border-blue-500/50'
                : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800'
            }`}
          >
            <FileText className="w-3.5 h-3.5 text-blue-400" />
            Live Transcript
            {transcriptEntries.length > 0 && (
              <span className="bg-blue-600 text-white text-[10px] px-1.5 py-0.2 rounded-full font-mono">
                {transcriptEntries.length}
              </span>
            )}
          </button>

          {/* Gemini AI Show Notes Trigger */}
          <button
            onClick={() => setShowNotesModal(true)}
            className="px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 hover:brightness-110 text-white font-semibold text-xs flex items-center gap-1.5 shadow-md shadow-purple-600/30 transition-all cursor-pointer"
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
              onClick={requestPermissions}
              className="px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded text-xs font-bold"
            >
              Grant Access
            </button>
          </div>
        )}

        {/* 1. Main Broadcast Canvas Viewport */}
        <section>
          <BroadcastCanvasView
            canvasRef={canvasRef}
            hostVideoRef={hostVideoRef}
            guestVideoRef={guestVideoRef}
            mediaVideoRef={mediaVideoRef}
            mediaTitle={mediaState.title}
            mediaState={mediaState}
            isMediaActive={mediaState.type !== 'none'}
            layout={layout}
            setLayout={setLayout}
            hostFilters={hostConfig.filters}
            guestFilters={guestConfig.filters}
            hostName={hostConfig.name}
            guestName={guestConfig.name}
            branding={branding}
            setBranding={setBranding}
            isRecording={isRecording}
            recordingTimeSeconds={recordingSeconds}
            hostVuLevel={hostVu.rms}
            guestVuLevel={guestVu.rms}
            hostStream={hostVideoStreamRef.current}
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
            onToggleGuestMirror={() =>
              setGuestConfig((prev) => ({
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
            onStartScreenShare={handleStartScreenShare}
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

        {/* 2. Recording Status Toolbar & Master Audio */}
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

        {/* 2b. Remote Guest Invite */}
        <section>
          <RemoteGuestInvite
            status={remoteGuest.status}
            roomCode={inviteRoomCode}
            guestName={remoteGuest.guestName}
            error={remoteGuest.error}
            onCreateInvite={createInvite}
            onEndInvite={endInvite}
          />
        </section>

        {/* 3. Dual Channel Controls Racks (Host Channel & Guest Channel side-by-side) */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Channel 1: Host */}
          <ChannelControls
            channel={hostConfig}
            videoDevices={videoDevices}
            audioDevices={audioDevices}
            vuLevel={hostVu}
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

          {/* Channel 2: Guest */}
          <ChannelControls
            channel={guestConfig}
            videoDevices={videoDevices}
            audioDevices={audioDevices}
            vuLevel={guestVu}
            onUpdateChannel={(updated) => setGuestConfig((prev) => ({ ...prev, ...updated }))}
            onUpdateFilters={(filters) =>
              setGuestConfig((prev) => ({
                ...prev,
                filters: { ...prev.filters, ...filters },
              }))
            }
            onUpdateAudio={(audio) =>
              setGuestConfig((prev) => ({
                ...prev,
                audioSettings: { ...prev.audioSettings, ...audio },
              }))
            }
          />
        </section>

        {/* 4. Live Speech Recognition & Transcript Drawer */}
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
                      ? 'bg-emerald-950 text-emerald-300 border border-emerald-800 animate-pulse'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {isTranscriptListening ? '● LISTENING (MIC ACTIVE)' : 'IDLE'}
                </span>
              </div>
              <button
                onClick={() => setShowTranscriptDrawer(false)}
                className="text-xs text-slate-400 hover:text-white"
              >
                Close Drawer
              </button>
            </div>

            {/* Transcript stream */}
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

            {/* Manual note / talking point prompt */}
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
        transcriptEntries={transcriptEntries}
        chapterMarkers={chapterMarkers}
        showNotes={showNotes}
      />

      {/* Gemini AI Show Notes Modal */}
      <ShowNotesModal
        isOpen={showNotesModal}
        onClose={() => setShowNotesModal(false)}
        podcastName={branding.podcastName}
        hostName={hostConfig.name}
        guestName={guestConfig.name}
        durationSeconds={recordingSeconds || lastRecordingDurationRef.current || 180}
        chapterMarkers={chapterMarkers}
        transcript={transcript}
        onShowNotesGenerated={setShowNotes}
      />
    </div>
  );
}
