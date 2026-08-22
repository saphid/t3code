/**
 * Microphone capture for voice dictation.
 *
 * Captures mono PCM through Web Audio (not MediaRecorder: the server-side
 * transcriber wants an uncompressed WAV it can feed straight to the native
 * speech stack), encodes it as 16-bit WAV on stop, and hands the base64 to a
 * caller-supplied transcriber.
 *
 * Lifecycle rules this hook guarantees:
 * - double `start` calls are ignored while a start is in flight or recording,
 * - `stop`/`cancel`/unmount during `getUserMedia` aborts cleanly and stops
 *   the tracks the browser eventually hands back,
 * - tracks are stopped and the AudioContext closed on every exit path,
 * - recording auto-stops after five minutes, or sooner when the capture rate
 *   would blow the server's byte cap first,
 * - a transcript is dropped when the insert target changed while it was in
 *   flight, so text never lands in a different thread's draft.
 *
 * @module hooks/useVoiceDictation
 */
import { VOICE_AUDIO_MAX_BYTES } from "@t3tools/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import { encodeBytesToBase64, encodeWavPcm16, resamplePcmMono } from "../lib/voiceAudio";

export const VOICE_DICTATION_MIME_TYPE = "audio/wav";
const MAX_RECORDING_MS = 5 * 60 * 1_000;
const TARGET_SAMPLE_RATE = 16_000;
const PROCESSOR_BUFFER_SIZE = 4_096;
const PCM16_BYTES_PER_SAMPLE = 2;

export type VoiceDictationPhase = "idle" | "recording" | "transcribing";

export interface VoiceDictationAudio {
  readonly audioBase64: string;
  readonly mimeType: string;
  readonly durationMs: number;
}

export interface UseVoiceDictationOptions {
  /** Sends the recording for transcription; resolves to the recognized text. */
  readonly transcribe: (audio: VoiceDictationAudio) => Promise<string>;
  /** Receives the final text; only called with non-empty transcriptions. */
  readonly onText: (text: string) => void;
  /**
   * Identity of the draft the transcript will be inserted into (the
   * composer's thread target key). Captured when recording starts; when the
   * transcript arrives and the current value no longer matches, the result
   * is dropped instead of landing in another thread's draft.
   */
  readonly getInsertTarget?: () => string | null;
}

export function isVoiceCaptureSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
    typeof AudioContext !== "undefined"
  );
}

export function useVoiceDictation({
  transcribe,
  onText,
  getInsertTarget,
}: UseVoiceDictationOptions) {
  const [status, setStatus] = useState<VoiceDictationPhase>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const startingRef = useRef(false);
  const cancelStartingRef = useRef(false);
  const recordingRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const sampleRateRef = useRef(TARGET_SAMPLE_RATE);
  const startedAtRef = useRef(0);
  const intervalRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);
  /** Invalidates in-flight transcriptions when a newer session starts. */
  const sessionRef = useRef(0);
  /** Insert target captured when the current recording started. */
  const insertTargetRef = useRef<string | null>(null);
  const transcribeRef = useRef(transcribe);
  const onTextRef = useRef(onText);
  const getInsertTargetRef = useRef(getInsertTarget);
  transcribeRef.current = transcribe;
  onTextRef.current = onText;
  getInsertTargetRef.current = getInsertTarget;

  const cleanupCapture = useCallback(() => {
    if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
    intervalRef.current = null;
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    processorRef.current?.disconnect();
    if (processorRef.current) processorRef.current.onaudioprocess = null;
    processorRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
    recordingRef.current = false;
  }, []);

  const discard = useCallback(() => {
    sessionRef.current += 1;
    cancelStartingRef.current = true;
    cleanupCapture();
    chunksRef.current = [];
    if (mountedRef.current) {
      setStatus("idle");
      setElapsedMs(0);
    }
  }, [cleanupCapture]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      sessionRef.current += 1;
      cancelStartingRef.current = true;
      cleanupCapture();
      chunksRef.current = [];
    };
  }, [cleanupCapture]);

  const finishRecording = useCallback(() => {
    if (!recordingRef.current) return;
    const chunks = chunksRef.current;
    const sampleRate = sampleRateRef.current;
    const durationMs = Date.now() - startedAtRef.current;
    const session = sessionRef.current;
    const capturedTarget = insertTargetRef.current;
    chunksRef.current = [];
    cleanupCapture();

    if (!mountedRef.current) return;
    if (chunks.length === 0) {
      setStatus("idle");
      setElapsedMs(0);
      return;
    }

    setStatus("transcribing");
    // The browser may have ignored the requested 16 kHz and captured at its
    // native rate; bring the samples down to the transcriber's rate so the
    // payload stays inside the server's byte cap.
    let sampleCount = 0;
    for (const chunk of chunks) sampleCount += chunk.length;
    const samples = new Float32Array(sampleCount);
    let writeOffset = 0;
    for (const chunk of chunks) {
      samples.set(chunk, writeOffset);
      writeOffset += chunk.length;
    }
    const resampled = resamplePcmMono(samples, sampleRate, TARGET_SAMPLE_RATE);
    const audioBase64 = encodeBytesToBase64(encodeWavPcm16([resampled], TARGET_SAMPLE_RATE));
    void transcribeRef
      .current({ audioBase64, mimeType: VOICE_DICTATION_MIME_TYPE, durationMs })
      .then((text) => {
        if (!mountedRef.current || sessionRef.current !== session) return;
        const currentTarget = getInsertTargetRef.current?.() ?? null;
        if (currentTarget !== capturedTarget) {
          // The composer moved to another thread while the transcript was in
          // flight; inserting now would edit the wrong draft.
          console.debug("voice dictation: dropped transcript for a stale insert target");
          setStatus("idle");
          setElapsedMs(0);
          return;
        }
        const trimmed = text.trim();
        if (trimmed.length > 0) onTextRef.current(trimmed);
        setStatus("idle");
        setElapsedMs(0);
      })
      .catch((cause: unknown) => {
        if (!mountedRef.current || sessionRef.current !== session) return;
        setError(cause instanceof Error ? cause.message : "Voice transcription failed.");
        setStatus("idle");
        setElapsedMs(0);
      });
  }, [cleanupCapture]);

  const stop = useCallback(() => {
    if (startingRef.current) {
      // The mic permission prompt is still open; treat stop as cancel.
      discard();
      return;
    }
    finishRecording();
  }, [discard, finishRecording]);

  const cancel = useCallback(() => {
    discard();
  }, [discard]);

  const start = useCallback(async () => {
    if (startingRef.current || recordingRef.current || status !== "idle") return;
    setError(null);
    if (!isVoiceCaptureSupported()) {
      setError("Microphone recording is not supported on this device.");
      return;
    }

    startingRef.current = true;
    cancelStartingRef.current = false;
    const session = (sessionRef.current += 1);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (!mountedRef.current || cancelStartingRef.current || sessionRef.current !== session) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;

      // Ask for 16 kHz directly; a browser that refuses records at its native
      // rate and the WAV header carries whatever rate we actually got.
      let audioContext: AudioContext;
      try {
        audioContext = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
      } catch {
        audioContext = new AudioContext();
      }
      audioContextRef.current = audioContext;
      if (audioContext.state === "suspended") {
        void audioContext.resume().catch(() => undefined);
      }
      sampleRateRef.current = audioContext.sampleRate;

      // Second guard behind the resampler: even at the browser's native rate
      // (often 48 kHz despite the 16 kHz request) the raw capture must never
      // outgrow the server's decoded byte cap.
      const captureBytesPerSecond = audioContext.sampleRate * PCM16_BYTES_PER_SAMPLE;
      const byteCapMs = Math.floor((VOICE_AUDIO_MAX_BYTES / captureBytesPerSecond) * 1_000);
      const maxRecordingMs = Math.min(MAX_RECORDING_MS, byteCapMs);
      const maxSamples = Math.ceil((maxRecordingMs / 1_000) * audioContext.sampleRate);
      let collectedSamples = 0;
      chunksRef.current = [];

      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(PROCESSOR_BUFFER_SIZE, 1, 1);
      processorRef.current = processor;
      processor.onaudioprocess = (event) => {
        if (!recordingRef.current) return;
        // The capture budget is enforced sample by sample, not only by the
        // auto-stop timer, so a stalled timer cannot buffer unbounded audio.
        if (collectedSamples >= maxSamples) return;
        const input = event.inputBuffer.getChannelData(0);
        const remaining = maxSamples - collectedSamples;
        const chunk = input.length > remaining ? input.subarray(0, remaining) : input;
        chunksRef.current.push(new Float32Array(chunk));
        collectedSamples += chunk.length;
      };
      // ScriptProcessorNode only fires while wired to the destination; the
      // zero-gain stage keeps the mic from being audible locally.
      const silentOutput = audioContext.createGain();
      silentOutput.gain.value = 0;
      source.connect(processor);
      processor.connect(silentOutput);
      silentOutput.connect(audioContext.destination);

      recordingRef.current = true;
      insertTargetRef.current = getInsertTargetRef.current?.() ?? null;
      startedAtRef.current = Date.now();
      setElapsedMs(0);
      setStatus("recording");
      intervalRef.current = window.setInterval(() => {
        setElapsedMs(Date.now() - startedAtRef.current);
      }, 250);
      timeoutRef.current = window.setTimeout(() => {
        finishRecording();
      }, maxRecordingMs);
    } catch (cause) {
      cleanupCapture();
      chunksRef.current = [];
      if (!mountedRef.current || cancelStartingRef.current) return;
      setStatus("idle");
      setError(
        cause instanceof DOMException && cause.name === "NotAllowedError"
          ? "Microphone permission was denied. Allow access and try again."
          : "Could not start the microphone.",
      );
    } finally {
      startingRef.current = false;
    }
  }, [cleanupCapture, finishRecording, status]);

  return { status, elapsedMs, error, start, stop, cancel } as const;
}
