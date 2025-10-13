import { useEffect, useRef, useState } from 'react';

import {
  formatDurationTime,
  formatRecordedAudioTime,
  formatRecordingTime,
  getFileExtensionFromMimeType,
} from '../helpers';
import { Controls, useVoiceVisualizerParams } from '../types/types.ts';

function useVoiceVisualizer({
  onStartRecording,
  onStopRecording,
  onPausedRecording,
  onResumedRecording,
  onClearCanvas,
  onEndAudioPlayback,
  onStartAudioPlayback,
  onPausedAudioPlayback,
  onResumedAudioPlayback,
  onErrorPlayingAudio,
  shouldHandleBeforeUnload = true,
  audioSource = 'user',
}: useVoiceVisualizerParams = {}): Controls {
  const [isRecordingInProgress, setIsRecordingInProgress] = useState(false);
  const [isPausedRecording, setIsPausedRecording] = useState(false);
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const [audioData, setAudioData] = useState<Uint8Array>(new Uint8Array(0));
  const [isProcessingAudioOnComplete, _setIsProcessingAudioOnComplete] =
    useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [bufferFromRecordedBlob, setBufferFromRecordedBlob] =
    useState<AudioBuffer | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const [prevTime, setPrevTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [audioSrc, setAudioSrc] = useState('');
  const [isPausedRecordedAudio, setIsPausedRecordedAudio] = useState(true);
  const [currentAudioTime, setCurrentAudioTime] = useState(0);
  const [isCleared, setIsCleared] = useState(true);
  const [isProcessingOnResize, _setIsProcessingOnResize] = useState(false);
  const [isPreloadedBlob, setIsPreloadedBlob] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [isProcessingStartRecording, setIsProcessingStartRecording] =
    useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const rafRecordingRef = useRef<number | null>(null);
  const rafCurrentTimeUpdateRef = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const originalStreamsRef = useRef<MediaStream[]>([]);

  const isAvailableRecordedAudio = Boolean(
    bufferFromRecordedBlob && !isProcessingAudioOnComplete
  );
  const formattedDuration = formatDurationTime(duration);
  const formattedRecordingTime = formatRecordingTime(recordingTime);
  const formattedRecordedAudioCurrentTime =
    formatRecordedAudioTime(currentAudioTime);
  const isProcessingRecordedAudio =
    isProcessingOnResize || isProcessingAudioOnComplete;

  useEffect(() => {
    if (!isRecordingInProgress || isPausedRecording) return;

    const updateTimer = () => {
      const timeNow = performance.now();
      setRecordingTime((prev) => prev + (timeNow - prevTime));
      setPrevTime(timeNow);
    };

    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [prevTime, isPausedRecording, isRecordingInProgress]);

  useEffect(() => {
    if (error) {
      clearCanvas();
      return;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);

  useEffect(() => {
    return () => {
      clearCanvas();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isCleared && shouldHandleBeforeUnload) {
      window.addEventListener('beforeunload', handleBeforeUnload);
    }

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [isCleared, shouldHandleBeforeUnload]);

  const handleBeforeUnload = (e: BeforeUnloadEvent) => {
    e.preventDefault();
  };

  const processBlob = async (blob: Blob) => {
    if (!blob) return;

    try {
      if (blob.size === 0) {
        throw new Error('Error: The audio blob is empty');
      }
      const audioSrcFromBlob = URL.createObjectURL(blob);
      setAudioSrc(audioSrcFromBlob);

      const audioBuffer = await blob.arrayBuffer();
      const audioContext = new AudioContext();
      const buffer = await audioContext.decodeAudioData(audioBuffer);
      setBufferFromRecordedBlob(buffer);
      setDuration(buffer.duration - 0.06);

      setError(null);
    } catch (error) {
      console.error('Error processing the audio blob:', error);
      setError(
        error instanceof Error
          ? error
          : new Error('Error processing the audio blob')
      );
    }
  };

  const setPreloadedAudioBlob = (blob: Blob) => {
    if (blob instanceof Blob) {
      clearCanvas();
      setIsPreloadedBlob(true);
      setIsCleared(false);
      _setIsProcessingAudioOnComplete(true);
      setIsRecordingInProgress(false);
      setRecordingTime(0);
      setIsPausedRecording(false);
      audioRef.current = new Audio();
      setRecordedBlob(blob);
      void processBlob(blob);
    }
  };

  const mergeAudioStreams = (streams: MediaStream[]): MediaStream => {
    const audioContext = new AudioContext();
    const destination = audioContext.createMediaStreamDestination();

    streams.forEach((stream) => {
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(destination);
    });

    return destination.stream;
  };

  const getUserMedia = async () => {
    setIsProcessingStartRecording(true);

    try {
      const streams: MediaStream[] = [];
      let combinedStream: MediaStream;

      if (audioSource === 'user' || audioSource === 'both') {
        const userStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        streams.push(userStream);
      }

      if (audioSource === 'display' || audioSource === 'both') {
        const displayStream = await navigator.mediaDevices.getDisplayMedia({
          audio: true,
          video: {
            displaySurface: 'browser', // Restrict to browser tabs only
          },
          // @ts-ignore
          preferCurrentTab: false,
          // @ts-ignore
          surfaceSwitching: 'exclude', // Prevent switching to other surface types
          // @ts-ignore
          selfBrowserSurface: 'exclude', // Exclude the current tab
        });

        // Extract only audio tracks from display stream
        const audioTracks = displayStream.getAudioTracks();
        if (audioTracks.length === 0) {
          // Stop video tracks if no audio
          displayStream.getVideoTracks().forEach((track) => track.stop());
          throw new Error('No audio track found in display media');
        }

        // Create a new stream with only audio tracks
        const audioOnlyStream = new MediaStream(audioTracks);
        streams.push(audioOnlyStream);

        // Stop video tracks as we don't need them
        displayStream.getVideoTracks().forEach((track) => track.stop());
      }

      // Store original streams for cleanup
      originalStreamsRef.current = streams;

      // Merge streams if we have multiple, otherwise use the single stream
      if (streams.length > 1) {
        combinedStream = mergeAudioStreams(streams);
      } else {
        combinedStream = streams[0];
      }

      setIsCleared(false);
      setIsProcessingStartRecording(false);
      setIsRecordingInProgress(true);
      setPrevTime(performance.now());
      setAudioStream(combinedStream);
      audioContextRef.current = new window.AudioContext();
      analyserRef.current = audioContextRef.current.createAnalyser();
      const bufferLength = analyserRef.current.frequencyBinCount;
      dataArrayRef.current = new Uint8Array(new ArrayBuffer(bufferLength));
      sourceRef.current =
        audioContextRef.current.createMediaStreamSource(combinedStream);
      sourceRef.current.connect(analyserRef.current);
      mediaRecorderRef.current = new MediaRecorder(combinedStream);
      mediaRecorderRef.current.addEventListener(
        'dataavailable',
        handleDataAvailable
      );
      mediaRecorderRef.current.start();
      if (onStartRecording) onStartRecording();

      recordingFrame();
    } catch (error) {
      setIsProcessingStartRecording(false);
      setError(
        error instanceof Error
          ? error
          : new Error('Error starting audio recording')
      );
    }
  };

  const recordingFrame = () => {
    analyserRef.current!.getByteTimeDomainData(dataArrayRef.current!);
    const currentData = dataArrayRef.current!;
    setAudioData(Uint8Array.from(currentData));
    rafRecordingRef.current = requestAnimationFrame(recordingFrame);
  };

  const handleDataAvailable = (event: BlobEvent) => {
    if (!mediaRecorderRef.current) return;

    mediaRecorderRef.current = null;
    audioRef.current = new Audio();
    setRecordedBlob(event.data);
    void processBlob(event.data);
  };

  const handleTimeUpdate = () => {
    if (!audioRef.current) return;

    setCurrentAudioTime(audioRef.current.currentTime);

    rafCurrentTimeUpdateRef.current = requestAnimationFrame(handleTimeUpdate);
  };

  const startRecording = () => {
    if (isRecordingInProgress || isProcessingStartRecording) return;

    if (!isCleared) clearCanvas();
    void getUserMedia();
  };

  const stopRecording = () => {
    if (!isRecordingInProgress) return;

    setIsRecordingInProgress(false);
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.removeEventListener(
        'dataavailable',
        handleDataAvailable
      );
    }

    // Stop all tracks from the combined stream
    audioStream?.getTracks().forEach((track) => track.stop());

    // Stop all tracks from original streams (important for screen sharing indicator)
    originalStreamsRef.current.forEach((stream) => {
      stream.getTracks().forEach((track) => track.stop());
    });
    originalStreamsRef.current = [];

    if (rafRecordingRef.current) cancelAnimationFrame(rafRecordingRef.current);
    if (sourceRef.current) sourceRef.current.disconnect();
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      void audioContextRef.current.close();
    }
    _setIsProcessingAudioOnComplete(true);
    setRecordingTime(0);
    setIsPausedRecording(false);
    if (onStopRecording) onStopRecording();
  };

  const clearCanvas = () => {
    if (rafRecordingRef.current) {
      cancelAnimationFrame(rafRecordingRef.current);
      rafRecordingRef.current = null;
    }
    if (rafCurrentTimeUpdateRef.current) {
      cancelAnimationFrame(rafCurrentTimeUpdateRef.current);
      rafCurrentTimeUpdateRef.current = null;
    }
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.removeEventListener(
        'dataavailable',
        handleDataAvailable
      );
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }

    // Stop all tracks from the combined stream
    audioStream?.getTracks().forEach((track) => track.stop());

    // Stop all tracks from original streams (important for screen sharing indicator)
    originalStreamsRef.current.forEach((stream) => {
      stream.getTracks().forEach((track) => track.stop());
    });
    originalStreamsRef.current = [];

    if (audioRef?.current) {
      audioRef.current.removeEventListener('ended', onEndedRecordedAudio);
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current = null;
    }
    audioContextRef.current = null;
    analyserRef.current = null;
    dataArrayRef.current = null;
    sourceRef.current = null;

    setAudioStream(null);
    setIsProcessingStartRecording(false);
    setIsRecordingInProgress(false);
    setIsPreloadedBlob(false);
    _setIsProcessingAudioOnComplete(false);
    setRecordedBlob(null);
    setBufferFromRecordedBlob(null);
    setRecordingTime(0);
    setPrevTime(0);
    setDuration(0);
    setAudioSrc('');
    setCurrentAudioTime(0);
    setIsPausedRecordedAudio(true);
    setIsPausedRecording(false);
    _setIsProcessingOnResize(false);
    setAudioData(new Uint8Array(0));
    setError(null);
    setIsCleared(true);
    if (onClearCanvas) onClearCanvas();
  };

  const startPlayingAudio = () => {
    if (audioRef.current && audioRef.current.paused) {
      const audioPromise = audioRef.current.play();
      if (audioPromise !== undefined) {
        audioPromise.catch((error) => {
          console.error(error);
          if (onErrorPlayingAudio) {
            onErrorPlayingAudio(
              error instanceof Error ? error : new Error('Error playing audio')
            );
          }
        });
      }
    }
  };

  const startAudioPlayback = () => {
    if (!audioRef.current || isRecordingInProgress) return;

    requestAnimationFrame(handleTimeUpdate);
    startPlayingAudio();
    audioRef.current.addEventListener('ended', onEndedRecordedAudio);
    setIsPausedRecordedAudio(false);
    if (onStartAudioPlayback && currentAudioTime === 0) {
      onStartAudioPlayback();
    }
    if (onResumedAudioPlayback && currentAudioTime !== 0) {
      onResumedAudioPlayback();
    }
  };

  const stopAudioPlayback = () => {
    if (!audioRef.current || isRecordingInProgress) return;

    if (rafCurrentTimeUpdateRef.current) {
      cancelAnimationFrame(rafCurrentTimeUpdateRef.current);
    }
    audioRef.current.removeEventListener('ended', onEndedRecordedAudio);
    audioRef.current.pause();
    setIsPausedRecordedAudio(true);
    const newCurrentTime = audioRef.current.currentTime;
    setCurrentAudioTime(newCurrentTime);
    audioRef.current.currentTime = newCurrentTime;
    if (onPausedAudioPlayback) onPausedAudioPlayback();
  };

  const togglePauseResume = () => {
    if (isRecordingInProgress) {
      setIsPausedRecording((prevPaused) => !prevPaused);
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current?.pause();
        setRecordingTime((prev) => prev + (performance.now() - prevTime));
        if (rafRecordingRef.current) {
          cancelAnimationFrame(rafRecordingRef.current);
        }
        if (onPausedRecording) onPausedRecording();
      } else {
        rafRecordingRef.current = requestAnimationFrame(recordingFrame);
        mediaRecorderRef.current?.resume();
        setPrevTime(performance.now());
        if (onResumedRecording) onResumedRecording();
      }
      return;
    }

    if (audioRef.current && isAvailableRecordedAudio) {
      audioRef.current.paused ? startAudioPlayback() : stopAudioPlayback();
    }
  };

  const onEndedRecordedAudio = () => {
    if (rafCurrentTimeUpdateRef.current) {
      cancelAnimationFrame(rafCurrentTimeUpdateRef.current);
    }
    setIsPausedRecordedAudio(true);
    if (!audioRef?.current) return;
    audioRef.current.currentTime = 0;
    setCurrentAudioTime(0);
    if (onEndAudioPlayback) onEndAudioPlayback();
  };

  const saveAudioFile = () => {
    if (!audioSrc) return;

    const downloadAnchor = document.createElement('a');
    downloadAnchor.href = audioSrc;
    downloadAnchor.download = `recorded_audio${getFileExtensionFromMimeType(
      mediaRecorderRef.current?.mimeType
    )}`;
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    document.body.removeChild(downloadAnchor);
    URL.revokeObjectURL(audioSrc);
  };

  return {
    audioRef,
    isRecordingInProgress,
    isPausedRecording,
    audioData,
    recordingTime,
    isProcessingRecordedAudio,
    recordedBlob,
    mediaRecorder: mediaRecorderRef.current,
    duration,
    currentAudioTime,
    audioSrc,
    isPausedRecordedAudio,
    bufferFromRecordedBlob,
    isCleared,
    isAvailableRecordedAudio,
    formattedDuration,
    formattedRecordingTime,
    formattedRecordedAudioCurrentTime,
    startRecording,
    togglePauseResume,
    startAudioPlayback,
    stopAudioPlayback,
    stopRecording,
    saveAudioFile,
    clearCanvas,
    setCurrentAudioTime,
    error,
    isProcessingOnResize,
    isProcessingStartRecording,
    isPreloadedBlob,
    setPreloadedAudioBlob,
    _setIsProcessingAudioOnComplete,
    _setIsProcessingOnResize,
  };
}

export default useVoiceVisualizer;
