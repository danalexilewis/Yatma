/**
 * Cloud Whisper fallback for Android and older iOS.
 * Sends recorded audio to the Worker `transcribe` RPC (base64 stub path OK).
 */
export async function transcribeWithWhisperRpc(args: {
  readonly audioBase64: string;
  readonly mimeType: string;
  readonly callRpc: (method: string, payload: unknown) => Promise<unknown>;
}): Promise<string> {
  // Empty base64 is allowed as a wiring stub until the mic pipeline records audio.
  const result = await args.callRpc("transcribe", {
    audioBase64: args.audioBase64 || "",
    mimeType: args.mimeType || "audio/m4a",
  });
  if (typeof result !== "object" || result === null) {
    throw new Error("invalid transcribe response");
  }
  const text = (result as { text?: unknown }).text;
  if (typeof text !== "string") {
    throw new Error("transcribe response missing text");
  }
  return text;
}
