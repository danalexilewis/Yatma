import { File } from "expo-file-system";
import { AppState } from "react-native";
import { useEffect, useRef, useState } from "react";
import {
  AudioModule,
  RecordingPresets,
  useAudioRecorder,
  useAudioRecorderState,
  type RecordingStatus,
} from "expo-audio";

import { transcribeWithWhisperRpc } from "./whisper";
import { audioSession } from "../../application/audioSession";
import { configureAudioSession } from "../../application/audioMode";
import { createRecordingLifecycle } from "../../application/recordingLifecycle";

export type DictationResult = {
  readonly text: string;
  readonly source: "whisper_rpc";
};

type Rpc = (method: string, payload: unknown) => Promise<unknown>;

/** Records a local audio file, then sends it to the configured transcription RPC. */
export function useDictation() {
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const mounted = useRef(false);
  const generation = useRef(0);
  const preparing = useRef(false);
  const transcribingRef = useRef(false);
  const lifecycleRef = useRef<ReturnType<typeof createRecordingLifecycle> | null>(null);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY, (status: RecordingStatus) => {
    if (!mounted.current || (!status.hasError && !status.mediaServicesDidReset)) return;
    generation.current += 1;
    preparing.current = false;
    setRecording(false);
    setError(status.error ?? "Audio was interrupted by the system. Please record again.");
    void lifecycleRef.current?.stop().catch(() => {});
  });
  const recorderState = useAudioRecorderState(recorder);

  useEffect(() => {
    mounted.current = true;
    const lifecycle = createRecordingLifecycle({
      requestPermission: async () => (await AudioModule.requestRecordingPermissionsAsync()).granted,
      configure: configureAudioSession,
      prepare: () => recorder.prepareToRecordAsync(),
      record: () => recorder.record(),
      stop: () => recorder.stop(),
      acquireSession: audioSession.acquireRecording,
    });
    lifecycleRef.current = lifecycle;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" || (!lifecycle.isRecording() && !preparing.current)) return;
      generation.current += 1;
      preparing.current = false;
      setRecording(false);
      setError("Recording stopped because the app was interrupted.");
      void lifecycle.stop().catch(() => {});
    });
    return () => {
      mounted.current = false;
      generation.current += 1;
      subscription.remove();
      if (lifecycleRef.current === lifecycle) lifecycleRef.current = null;
      void lifecycle.dispose().catch(() => {});
    };
  }, [recorder]);

  async function toggle(callRpc?: Rpc): Promise<DictationResult | null> {
    const lifecycle = lifecycleRef.current;
    if (!lifecycle || transcribingRef.current) return null;
    setError(null);
    if (preparing.current) {
      await cancelRecording();
      return null;
    }
    const ownGeneration = generation.current;
    function current() {
      return mounted.current && ownGeneration === generation.current;
    }
    if (!lifecycle.isRecording()) {
      preparing.current = true;
      try {
        const started = await lifecycle.start();
        if (current() && started) setRecording(true);
      } finally {
        if (current()) preparing.current = false;
      }
      return null;
    }

    setRecording(false);
    transcribingRef.current = true;
    setTranscribing(true);
    try {
      await lifecycle.stop();
      if (!current()) return null;
      if (!recorder.uri) throw new Error("No audio was saved. Please record again.");
      if (!callRpc) throw new Error("Connect to the transcription service before dictating.");
      const audioBase64 = await new File(recorder.uri).base64();
      if (!current()) return null;
      if (!audioBase64) throw new Error("The recording was empty. Please try again.");
      const text = await transcribeWithWhisperRpc({ audioBase64, mimeType: "audio/m4a", callRpc });
      return current() ? { text, source: "whisper_rpc" } : null;
    } catch (cause) {
      if (!current()) return null;
      const message =
        cause instanceof Error ? cause.message : "Transcription failed. Please try again.";
      setError(message);
      throw new Error(message);
    } finally {
      transcribingRef.current = false;
      if (current()) setTranscribing(false);
    }
  }

  async function cancelRecording() {
    generation.current += 1;
    preparing.current = false;
    setRecording(false);
    await lifecycleRef.current?.stop();
  }

  function clearError() {
    setError(null);
  }

  return {
    error,
    recording: recording || recorderState.isRecording,
    durationMillis: recorderState.durationMillis,
    transcribing,
    toggle,
    cancelRecording,
    clearError,
  };
}

export { transcribeWithWhisperRpc };
