import { useState, useEffect, useRef, useCallback } from 'react';

export interface TranscriptEntry {
  id: string;
  speaker: string;
  timestamp: string;
  seconds: number;
  text: string;
}

export function useSpeechRecognition(isRecording: boolean, currentSeconds: number, currentSpeaker = 'Host') {
  const [transcript, setTranscript] = useState<string>('');
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [isListening, setIsListening] = useState<boolean>(false);
  const [supported, setSupported] = useState<boolean>(false);

  const recognitionRef = useRef<any>(null);
  const currentSpeakerRef = useRef(currentSpeaker);
  const currentSecondsRef = useRef(currentSeconds);

  useEffect(() => {
    currentSpeakerRef.current = currentSpeaker;
    currentSecondsRef.current = currentSeconds;
  }, [currentSpeaker, currentSeconds]);

  // Format seconds to mm:ss
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  useEffect(() => {
    const SpeechRecognitionClass =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (SpeechRecognitionClass) {
      setSupported(true);
      const recognition = new SpeechRecognitionClass();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onresult = (event: any) => {
        let interimText = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const item = event.results[i];
          if (item.isFinal) {
            const finalChunk = item[0].transcript.trim();
            if (finalChunk.length > 0) {
              const timeStr = formatTime(currentSecondsRef.current);
              const speaker = currentSpeakerRef.current;
              const newEntry: TranscriptEntry = {
                id: Math.random().toString(36).substring(2, 9),
                speaker,
                timestamp: timeStr,
                seconds: currentSecondsRef.current,
                text: finalChunk,
              };

              setEntries((prev) => [...prev, newEntry]);
              setTranscript((prev) =>
                prev ? `${prev}\n[${timeStr}] ${speaker}: ${finalChunk}` : `[${timeStr}] ${speaker}: ${finalChunk}`
              );
            }
          } else {
            interimText += item[0].transcript;
          }
        }
      };

      recognition.onerror = (e: any) => {
        if (e.error !== 'no-speech') {
          console.warn('Speech recognition status:', e.error);
        }
      };

      recognition.onend = () => {
        // Automatically restart if recording is still active
        if (recognitionRef.current && isRecording) {
          try {
            recognition.start();
          } catch (e) {
            // ignore
          }
        } else {
          setIsListening(false);
        }
      };

      recognitionRef.current = recognition;
    } else {
      setSupported(false);
    }

    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (e) {
          // ignore
        }
      }
    };
  }, []);

  // Control listening based on recording status
  useEffect(() => {
    if (!recognitionRef.current) return;

    if (isRecording) {
      try {
        recognitionRef.current.start();
        setIsListening(true);
      } catch (e) {
        // already started
      }
    } else {
      try {
        recognitionRef.current.stop();
        setIsListening(false);
      } catch (e) {
        // ignore
      }
    }
  }, [isRecording]);

  const addManualNote = useCallback(
    (text: string, speaker = 'Host') => {
      if (!text.trim()) return;
      const timeStr = formatTime(currentSecondsRef.current);
      const newEntry: TranscriptEntry = {
        id: Math.random().toString(36).substring(2, 9),
        speaker,
        timestamp: timeStr,
        seconds: currentSecondsRef.current,
        text: text.trim(),
      };
      setEntries((prev) => [...prev, newEntry]);
      setTranscript((prev) =>
        prev ? `${prev}\n[${timeStr}] ${speaker}: ${text.trim()}` : `[${timeStr}] ${speaker}: ${text.trim()}`
      );
    },
    []
  );

  const clearTranscript = useCallback(() => {
    setTranscript('');
    setEntries([]);
  }, []);

  return {
    transcript,
    setTranscript,
    entries,
    isListening,
    supported,
    addManualNote,
    clearTranscript,
  };
}
