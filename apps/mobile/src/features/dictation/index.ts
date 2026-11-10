import { File } from "expo-file-system";
import { AppState } from "react-native";
import { useEffect, useRef, useState } from "react";
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  type RecordingStatus,
} from "expo-audio";

import { transcribeWithWhisperRpc } from "./whisper";

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
  const recordingRef = useRef(false);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY, (status: RecordingStatus) => {
    if (status.hasError) {
      recordingRef.current = false;
      setRecording(false);
      setError(status.error ?? "Microphone recording failed.");
    } else if (status.mediaServicesDidReset) {
      recordingRef.current = false;
      setRecording(false);
      setError("Audio was interrupted by the system. Please record again.");
    }
  });
  const recorderState = useAudioRecorderState(recorder);

  useEffect(() => {
    if (!recording) return;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active" && recordingRef.current) {
        recordingRef.current = false;
        setRecording(false);
        void recorder.stop().catch(() => {});
        void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
        setError("Recording stopped because the app was interrupted.");
      }
    });
    return () => subscription.remove();
  }, [recording, recorder]);

  useEffect(() => () => {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    void recorder.stop()
      .catch(() => {})
      .finally(() => setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {}));
  }, [recorder]);

  async function toggle(callRpc?: Rpc): Promise<DictationResult | null> {
    setError(null);
    if (!recordingRef.current) {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) {
        throw new Error("Microphone access was denied. Enable it in device settings to dictate.");
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      recordingRef.current = true;
      setRecording(true);
      return null;
    }

    recordingRef.current = false;
    setRecording(false);
    setTranscribing(true);
    try {
      await recorder.stop();
      if (!recorder.uri) throw new Error("No audio was saved. Please record again.");
      if (!callRpc) throw new Error("Connect to the transcription service before dictating.");
      const audioBase64 = await new File(recorder.uri).base64();
      if (!audioBase64) throw new Error("The recording was empty. Please try again.");
      const text = await transcribeWithWhisperRpc({ audioBase64, mimeType: "audio/m4a", callRpc });
      return { text, source: "whisper_rpc" };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Transcription failed. Please try again.";
      setError(message);
      throw new Error(message);
    } finally {
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
      setTranscribing(false);
    }
  }

  async function cancelRecording() {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    setRecording(false);
    try {
      await recorder.stop();
    } finally {
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    }
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
