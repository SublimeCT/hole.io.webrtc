import { afterEach, describe, expect, it, vi } from "vitest";

import { getDefaultRenderFrameRate, hasPersistedPlayerName, loadPreferences } from "./preferences";

const PREFERENCES_KEY = "hole-city-player-preferences";

function stubPointer(coarse: boolean): void {
  vi.stubGlobal("window", {
    matchMedia: vi.fn().mockReturnValue({ matches: coarse }),
  });
}

function stubSavedPreferences(value: unknown): void {
  const saved = JSON.stringify(value);
  vi.stubGlobal("localStorage", {
    getItem: vi.fn((key: string) => (key === PREFERENCES_KEY ? saved : null)),
    setItem: vi.fn(),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("render frame rate preferences", () => {
  it("defaults coarse touch devices to 45fps and desktop devices to 60fps", () => {
    stubPointer(true);
    expect(getDefaultRenderFrameRate()).toBe(45);

    stubPointer(false);
    expect(getDefaultRenderFrameRate()).toBe(60);
  });

  it("adds the device default when loading preferences saved before the setting existed", () => {
    stubPointer(true);
    stubSavedPreferences({
      playerName: "测试玩家",
      playerRingColor: "#ff5c8a",
      language: "zh-CN",
    });

    expect(loadPreferences()).toEqual({
      playerName: "测试玩家",
      playerRingColor: "#ff5c8a",
      language: "zh-CN",
      renderFrameRate: 45,
      snapshotFrequency: 30,
    });
  });

  it("keeps an explicitly saved frame rate instead of applying the device default", () => {
    stubPointer(true);
    stubSavedPreferences({
      playerName: "测试玩家",
      playerRingColor: "#ff5c8a",
      language: "zh-CN",
      renderFrameRate: 60,
    });

    expect(loadPreferences().renderFrameRate).toBe(60);
  });
});

describe("persisted player profile", () => {
  it("requires a deliberately saved valid player name before online play", () => {
    vi.stubGlobal("localStorage", { getItem: vi.fn(() => null), setItem: vi.fn() });
    expect(hasPersistedPlayerName()).toBe(false);

    stubSavedPreferences({ playerName: "测试玩家" });
    expect(hasPersistedPlayerName()).toBe(true);

    stubSavedPreferences({ playerName: " " });
    expect(hasPersistedPlayerName()).toBe(false);
  });
});
