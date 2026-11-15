import type { AudioSource } from "expo-audio";

type AmbientPlayer = {
  readonly playing: boolean;
  loop: boolean;
  volume: number;
  muted: boolean;
  readonly play: () => void;
  readonly pause: () => void;
  readonly replace: (source: AudioSource) => void;
};

/** Keep gain edits independent of playback position and fence delayed session setup. */
export function createAmbientPlayback(deps: {
  readonly player: AmbientPlayer;
  readonly configure: () => Promise<void>;
  readonly recording: () => boolean;
  readonly onError: (message: string | null) => void;
}) {
  let source: AudioSource = null;
  let interrupted = false;
  let disposed = false;
  let revision = 0;
  let volume = 0.5;
  let muted = true;
  let configured = false;
  function activate() {
    disposed = false;
    configured = false;
  }
  function applyGain() {
    deps.player.loop = true;
    deps.player.volume = volume;
    deps.player.muted = muted;
  }
  function setGain(nextVolume: number, nextMuted: boolean) {
    volume = Math.max(0, Math.min(1, nextVolume));
    muted = nextMuted;
    if (!disposed) {
      try {
        applyGain();
      } catch {
        deps.onError("Sound could not be adjusted. Try starting it again.");
      }
    }
  }
  async function update(nextSource: AudioSource, nextInterrupted: boolean) {
    if (disposed) return;
    const ownRevision = ++revision;
    interrupted = nextInterrupted;
    try {
      if (nextSource !== source) {
        deps.player.pause();
        source = nextSource;
        deps.player.replace(source);
        // Web replace creates a new media element, so restore its loop and gain.
        applyGain();
        deps.onError(null);
      }
      if (source === null || interrupted || deps.recording()) {
        configured = false;
        deps.player.pause();
        return;
      }
      if (deps.player.playing) return;
      await deps.configure();
      if (disposed || ownRevision !== revision || interrupted || deps.recording()) return;
      configured = true;
      deps.player.play();
    } catch {
      if (!disposed && ownRevision === revision)
        deps.onError("Sound is paused. Start it again when you're ready.");
    }
  }
  function retry(reload = false) {
    if (disposed || source === null || interrupted || deps.recording()) return;
    deps.onError(null);
    try {
      if (reload) {
        deps.player.pause();
        deps.player.replace(source);
        applyGain();
      }
      // Invoke play directly inside the user's gesture for web autoplay recovery.
      if (configured) deps.player.play();
      else void update(source, interrupted);
    } catch {
      deps.onError("Sound is unavailable. Your work timer is still running.");
    }
  }
  function dispose() {
    disposed = true;
    revision += 1;
    // The hook may already have released the native handle during teardown.
    try {
      deps.player.pause();
    } catch {
      /* Released handles have no playback left to stop. */
    }
  }
  return { activate, setGain, update, retry, dispose };
}
