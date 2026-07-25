import { isLanguage, type Language } from "./i18n";

export interface GamePreferences {
  playerName: string;
  playerRingColor: string;
  language: Language;
}

const PREFERENCES_KEY = "hole-city-player-preferences";

export const DEFAULT_PREFERENCES: GamePreferences = {
  playerName: "玩家",
  playerRingColor: "#2bf0ff",
  language: "zh-CN",
};

export function loadPreferences(): GamePreferences {
  try {
    const saved = localStorage.getItem(PREFERENCES_KEY);
    if (!saved) return { ...DEFAULT_PREFERENCES };
    const parsed: unknown = JSON.parse(saved);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "playerName" in parsed &&
      "playerRingColor" in parsed &&
      typeof parsed.playerName === "string" &&
      typeof parsed.playerRingColor === "string"
    ) {
      return {
        playerName: parsed.playerName.slice(0, 9).trim() || DEFAULT_PREFERENCES.playerName,
        playerRingColor: parsed.playerRingColor,
        language: "language" in parsed && isLanguage(parsed.language) ? parsed.language : "zh-CN",
      };
    }
  } catch {
    // Local preferences are optional.
  }
  return { ...DEFAULT_PREFERENCES };
}

export function persistPreferences(preferences: GamePreferences): void {
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    // Storage may be unavailable in restricted browser contexts.
  }
}
