export interface PlayerStats {
  bestScore: number;
}

const PLAYER_STATS_KEY = "hole-city-player-stats";

const DEFAULT_PLAYER_STATS: PlayerStats = {
  bestScore: 0,
};

export function loadPlayerStats(): PlayerStats {
  try {
    const stored = localStorage.getItem(PLAYER_STATS_KEY);
    if (!stored) return { ...DEFAULT_PLAYER_STATS };
    const parsed: unknown = JSON.parse(stored);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "bestScore" in parsed &&
      typeof parsed.bestScore === "number" &&
      Number.isFinite(parsed.bestScore) &&
      parsed.bestScore >= 0
    ) {
      return { bestScore: parsed.bestScore };
    }
  } catch {
    // Persistent statistics are optional in restricted browser contexts.
  }
  return { ...DEFAULT_PLAYER_STATS };
}

export function recordBestScore(score: number): PlayerStats {
  const current = loadPlayerStats();
  const bestScore = Math.max(current.bestScore, Number.isFinite(score) ? Math.max(0, score) : 0);
  const next = { bestScore };
  try {
    localStorage.setItem(PLAYER_STATS_KEY, JSON.stringify(next));
  } catch {
    // Match completion must still succeed if persistence is unavailable.
  }
  return next;
}
