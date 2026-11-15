import { setAudioModeAsync } from "expo-audio";

import { audioSession } from "./audioSession";

let tail: Promise<void> = Promise.resolve();

/** Serialize global audio changes and read microphone ownership at execution time. */
export function configureAudioSession(): Promise<void> {
  const next = tail
    .catch(() => {})
    .then(() =>
      setAudioModeAsync({
        allowsRecording: audioSession.getSnapshot(),
        playsInSilentMode: true,
      }),
    );
  tail = next;
  return next;
}
