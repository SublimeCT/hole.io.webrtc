import { PLAYER_NAME_PATTERN } from "@hole-io/shared/protocol";
import { isLanguage, type Language } from "./i18n";

export const RENDER_FRAME_RATES = [60, 45] as const;
export type RenderFrameRate = (typeof RENDER_FRAME_RATES)[number];

export interface GamePreferences {
  playerName: string;
  playerRingColor: string;
  language: Language;
  renderFrameRate: RenderFrameRate;
}

const PREFERENCES_KEY = "hole-city-player-preferences";
const PLAYER_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

export const DEFAULT_PREFERENCES: GamePreferences = {
  playerName: "玩家",
  playerRingColor: "#2bf0ff",
  language: "zh-CN",
  renderFrameRate: 60,
};

function isRenderFrameRate(value: unknown): value is RenderFrameRate {
  return RENDER_FRAME_RATES.some((frameRate) => frameRate === value);
}

export function getDefaultRenderFrameRate(): RenderFrameRate {
  const isCoarseTouchDevice =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(hover: none) and (pointer: coarse)").matches;
  return isCoarseTouchDevice ? 45 : 60;
}

function createDefaultPreferences(): GamePreferences {
  return {
    ...DEFAULT_PREFERENCES,
    renderFrameRate: getDefaultRenderFrameRate(),
  };
}

export function loadPreferences(): GamePreferences {
  try {
    const saved = localStorage.getItem(PREFERENCES_KEY);
    if (!saved) return createDefaultPreferences();
    const parsed: unknown = JSON.parse(saved);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "playerName" in parsed &&
      "playerRingColor" in parsed &&
      typeof parsed.playerName === "string" &&
      typeof parsed.playerRingColor === "string"
    ) {
      const playerName = parsed.playerName.normalize("NFKC").trim();
      const playerNameLength = Array.from(playerName).length;
      return {
        playerName:
          playerNameLength >= 2 && playerNameLength <= 10 && PLAYER_NAME_PATTERN.test(playerName)
            ? playerName
            : DEFAULT_PREFERENCES.playerName,
        playerRingColor: PLAYER_COLOR_PATTERN.test(parsed.playerRingColor)
          ? parsed.playerRingColor
          : DEFAULT_PREFERENCES.playerRingColor,
        language: "language" in parsed && isLanguage(parsed.language) ? parsed.language : "zh-CN",
        renderFrameRate:
          "renderFrameRate" in parsed && isRenderFrameRate(parsed.renderFrameRate)
            ? parsed.renderFrameRate
            : getDefaultRenderFrameRate(),
      };
    }
  } catch {
    // Local preferences are optional.
  }
  return createDefaultPreferences();
}

export function hasPersistedPlayerName(): boolean {
  try {
    const saved = localStorage.getItem(PREFERENCES_KEY);
    if (!saved) return false;
    const parsed: unknown = JSON.parse(saved);
    if (typeof parsed !== "object" || parsed === null || !("playerName" in parsed)) return false;
    if (typeof parsed.playerName !== "string") return false;
    const playerName = parsed.playerName.normalize("NFKC").trim();
    const length = Array.from(playerName).length;
    return length >= 2 && length <= 10 && PLAYER_NAME_PATTERN.test(playerName);
  } catch {
    return false;
  }
}

export function persistPreferences(preferences: GamePreferences): void {
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    // Storage may be unavailable in restricted browser contexts.
  }
}
