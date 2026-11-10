import { describe, expect, it, vi } from "vite-plus/test";

import { transcribeWithWhisperRpc } from "./whisper";

describe("transcribeWithWhisperRpc", () => {
  it("sends the recorded base64 and MIME type and returns editable transcript text", async () => {
    const callRpc = vi.fn(async () => ({ text: "Call Mira tomorrow" }));
    const text = await transcribeWithWhisperRpc({
      audioBase64: "bWljcm9waG9uZQ==",
      mimeType: "audio/m4a",
      callRpc,
    });

    expect(text).toBe("Call Mira tomorrow");
    expect(callRpc).toHaveBeenCalledWith("transcribe", {
      audioBase64: "bWljcm9waG9uZQ==",
      mimeType: "audio/m4a",
    });
  });

  it("rejects malformed transcription responses", async () => {
    await expect(transcribeWithWhisperRpc({
      audioBase64: "audio",
      mimeType: "audio/m4a",
      callRpc: async () => ({ text: 4 }),
    })).rejects.toThrow("transcribe response missing text");
  });
});
