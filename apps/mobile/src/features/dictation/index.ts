import { Platform } from "react-native";

import { transcribeWithWhisperRpc } from "./whisper";

export type DictationResult = {
  readonly text: string;
  readonly source: "on_device" | "whisper_rpc" | "stub";
};

/**
 * Dictation entrypoint.
 * iOS 26+ will use on-device transcription; everyone else uses Whisper RPC.
 * Without RPC, returns an empty stub so the mic UX still works offline.
 */
export async function dictateFromMic(args?: {
  readonly callRpc?: (method: string, payload: unknown) => Promise<unknown>;
  /** Optional pre-recorded base64 audio; empty string exercises the RPC stub path. */
  readonly audioBase64?: string;
  readonly mimeType?: string;
}): Promise<DictationResult> {
  const supportsOnDevice =
    Platform.OS === "ios" && Number.parseFloat(String(Platform.Version)) >= 26;

  if (supportsOnDevice) {
    // Stub: lift T3 on-device transcription in a later milestone.
    return {
      text: "",
      source: "on_device",
    };
  }

  if (!args?.callRpc) {
    return { text: "", source: "stub" };
  }

  try {
    const text = await transcribeWithWhisperRpc({
      audioBase64: args.audioBase64 ?? "",
      mimeType: args.mimeType ?? "audio/m4a",
      callRpc: args.callRpc,
    });
    return { text, source: "whisper_rpc" };
  } catch {
    return { text: "", source: "stub" };
  }
}

export { transcribeWithWhisperRpc };
