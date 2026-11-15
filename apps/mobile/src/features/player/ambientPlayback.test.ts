import { describe, expect, it, vi } from "vite-plus/test";

import { createAmbientPlayback } from "./ambientPlayback";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function harness(configure = vi.fn(async () => {})) {
  let recording = false;
  const player = {
    playing: false,
    currentTime: 0,
    loop: false,
    volume: 0.5,
    muted: true,
    play: vi.fn(() => {
      player.playing = true;
    }),
    pause: vi.fn(() => {
      player.playing = false;
    }),
    replace: vi.fn(() => {
      player.currentTime = 0;
      player.loop = false;
      player.volume = 1;
      player.muted = false;
    }),
  };
  const onError = vi.fn();
  const playback = createAmbientPlayback({
    player,
    configure,
    recording: () => recording,
    onError,
  });
  return {
    player,
    playback,
    onError,
    configure,
    set recording(value: boolean) {
      recording = value;
    },
  };
}

describe("continuous ambient playback", () => {
  it("keeps a perpetual loop and preserves phase while changing volume or mute", async () => {
    const h = harness();
    h.playback.setGain(0.4, false);
    await h.playback.update(1, false);
    h.player.currentTime = 19.4;
    const pauses = h.player.pause.mock.calls.length;
    h.playback.setGain(0.2, true);
    h.playback.setGain(0.7, false);
    expect(h.player.currentTime).toBe(19.4);
    expect(h.player.playing).toBe(true);
    expect(h.player.loop).toBe(true);
    expect(h.player.volume).toBe(0.7);
    expect(h.player.muted).toBe(false);
    expect(h.player.replace).toHaveBeenCalledTimes(1);
    expect(h.player.play).toHaveBeenCalledTimes(1);
    expect(h.player.pause).toHaveBeenCalledTimes(pauses);
  });

  it("pauses for dictation and resumes at the same position without replacing the scene", async () => {
    const h = harness();
    await h.playback.update(1, false);
    h.player.currentTime = 12.3;
    h.recording = true;
    await h.playback.update(1, true);
    expect(h.player.playing).toBe(false);
    h.recording = false;
    await h.playback.update(1, false);
    expect(h.player.playing).toBe(true);
    expect(h.player.currentTime).toBe(12.3);
    expect(h.player.replace).toHaveBeenCalledTimes(1);
  });

  it("does not resume a stale session when recording starts during configuration", async () => {
    const gate = deferred();
    const h = harness(vi.fn(() => gate.promise));
    const loading = h.playback.update(1, false);
    h.recording = true;
    await h.playback.update(1, true);
    gate.resolve();
    await loading;
    expect(h.player.play).not.toHaveBeenCalled();
  });

  it("fences account teardown and supports an effect replay without reviving old callbacks", async () => {
    const gate = deferred();
    const h = harness(vi.fn(() => gate.promise));
    const old = h.playback.update(1, false);
    h.playback.dispose();
    h.playback.activate();
    gate.resolve();
    await old;
    expect(h.player.play).not.toHaveBeenCalled();
    await h.playback.update(1, false);
    expect(h.player.play).toHaveBeenCalledTimes(1);
  });

  it("restores looping and saved gain after web media replacement, and retries directly on gesture", async () => {
    const h = harness();
    h.playback.setGain(0.3, false);
    await h.playback.update(1, false);
    await h.playback.update(2, false);
    expect(h.player.loop).toBe(true);
    expect(h.player.volume).toBe(0.3);
    h.player.playing = false;
    const calls = h.player.play.mock.calls.length;
    h.playback.retry();
    expect(h.player.play).toHaveBeenCalledTimes(calls + 1);
    expect(h.player.replace).toHaveBeenCalledTimes(2);
    h.playback.retry(true);
    expect(h.player.replace).toHaveBeenCalledTimes(3);
    expect(h.player.loop).toBe(true);
    expect(h.player.volume).toBe(0.3);
  });
});
