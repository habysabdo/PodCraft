import { useState, useEffect, useCallback } from 'react';

export interface DeviceItem {
  deviceId: string;
  label: string;
  kind: 'videoinput' | 'audioinput';
}

export function useDevices() {
  const [videoDevices, setVideoDevices] = useState<DeviceItem[]>([]);
  const [audioDevices, setAudioDevices] = useState<DeviceItem[]>([]);
  const [permissionGranted, setPermissionGranted] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Enumerate real hardware devices from navigator.mediaDevices
  const refreshDevices = useCallback(async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        setError('Media devices API is not supported in this browser.');
        return;
      }

      const devices = await navigator.mediaDevices.enumerateDevices();
      const vDevs: DeviceItem[] = [];
      const aDevs: DeviceItem[] = [];

      devices.forEach((device, index) => {
        if (device.kind === 'videoinput') {
          vDevs.push({
            deviceId: device.deviceId,
            label: device.label || `Camera ${vDevs.length + 1}`,
            kind: 'videoinput',
          });
        } else if (device.kind === 'audioinput') {
          aDevs.push({
            deviceId: device.deviceId,
            label: device.label || `Microphone ${aDevs.length + 1}`,
            kind: 'audioinput',
          });
        }
      });

      setVideoDevices(vDevs);
      setAudioDevices(aDevs);

      // Check if real labels are available (signaling permission granted)
      const hasLabels = devices.some((d) => d.label && d.label.length > 0);
      if (hasLabels) {
        setPermissionGranted(true);
      }
    } catch (err: any) {
      console.error('Failed to enumerate media devices:', err);
      setError(err?.message || 'Error detecting media devices');
    }
  }, []);

  // Request real camera and microphone permissions via getUserMedia
  const requestPermissions = useCallback(async () => {
    try {
      setError(null);
      const initialStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });

      // Stop initial prompt tracks immediately after permission is granted
      initialStream.getTracks().forEach((track) => track.stop());
      setPermissionGranted(true);
      await refreshDevices();
    } catch (err: any) {
      console.warn('getUserMedia permission rejected:', err);
      setError('Camera and microphone permission is required to access hardware devices.');
      await refreshDevices();
    }
  }, [refreshDevices]);

  // Request permissions automatically on initial mount and listen for hardware changes
  useEffect(() => {
    requestPermissions();

    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', refreshDevices);
      return () => {
        navigator.mediaDevices.removeEventListener('devicechange', refreshDevices);
      };
    }
  }, [requestPermissions, refreshDevices]);

  // Acquire real video stream from physical hardware device or screen share
  const acquireVideoStream = useCallback(
    async (deviceId: string): Promise<MediaStream | null> => {
      if (!deviceId || deviceId === 'none') {
        return null;
      }

      if (deviceId === 'screen-share') {
        return await navigator.mediaDevices.getDisplayMedia({
          video: {
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 30 },
          },
          audio: false,
        });
      }

      const constraints: MediaStreamConstraints = {
        video: {
          deviceId: { exact: deviceId },
          width: { ideal: 1280, max: 1920 },
          height: { ideal: 720, max: 1080 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      };

      return await navigator.mediaDevices.getUserMedia(constraints);
    },
    []
  );

  // Acquire real audio stream from physical hardware microphone
  const acquireAudioStream = useCallback(async (deviceId: string): Promise<MediaStream | null> => {
    if (!deviceId || deviceId === 'none') {
      return null;
    }

    const constraints: MediaStreamConstraints = {
      video: false,
      audio: {
        deviceId: { exact: deviceId },
        echoCancellation: false, // Pure mic input for high fidelity DSP
        noiseSuppression: false, // Handled by Web Audio graph
        autoGainControl: false,  // Handled by Web Audio compressor
      },
    };

    return await navigator.mediaDevices.getUserMedia(constraints);
  }, []);

  return {
    videoDevices,
    audioDevices,
    permissionGranted,
    error,
    requestPermissions,
    refreshDevices,
    acquireVideoStream,
    acquireAudioStream,
  };
}
