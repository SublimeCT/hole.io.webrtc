export interface MatchResultEntry {
  id: string;
  name: string;
  score: number;
  isPlayer: boolean;
  isOut: boolean;
}

export interface MatchResult {
  playerRank: number;
  playerScore: number;
  ranking: readonly MatchResultEntry[];
}

const MATCH_RESULT_KEY = "hole-city-last-match";

export function saveMatchResult(result: MatchResult): void {
  try {
    sessionStorage.setItem(MATCH_RESULT_KEY, JSON.stringify(result));
  } catch {
    // Navigation still succeeds if session storage is unavailable.
  }
}

export function loadMatchResult(): MatchResult | null {
  try {
    const stored = sessionStorage.getItem(MATCH_RESULT_KEY);
    if (!stored) return null;
    const parsed: unknown = JSON.parse(stored);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("playerRank" in parsed) ||
      !("playerScore" in parsed) ||
      !("ranking" in parsed) ||
      typeof parsed.playerRank !== "number" ||
      typeof parsed.playerScore !== "number" ||
      !Array.isArray(parsed.ranking)
    ) {
      return null;
    }
    const ranking = parsed.ranking.filter((entry): entry is MatchResultEntry => {
      return (
        typeof entry === "object" &&
        entry !== null &&
        "id" in entry &&
        "name" in entry &&
        "score" in entry &&
        "isPlayer" in entry &&
        "isOut" in entry &&
        typeof entry.id === "string" &&
        typeof entry.name === "string" &&
        typeof entry.score === "number" &&
        typeof entry.isPlayer === "boolean" &&
        typeof entry.isOut === "boolean"
      );
    });
    if (ranking.length === 0) return null;
    return { playerRank: parsed.playerRank, playerScore: parsed.playerScore, ranking };
  } catch {
    return null;
  }
}
