import { recordMatchStats } from "./playerStats";

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
  /** 本局玩家累计吞噬的目标数（结算数据卡用，可选以兼容旧存档）。 */
  swallowCount?: number | undefined;
  /** 本局玩家累计阵亡次数（结算数据卡用，可选以兼容旧存档）。 */
  eliminations?: number | undefined;
  /** 本局已经过的秒数（结算副标题用，可选以兼容旧存档）。 */
  elapsedSeconds?: number | undefined;
  /** 单局最大允许复活次数，用于「阵亡 / N」显示。 */
  maxRevives?: number | undefined;
}

const MATCH_RESULT_KEY = "hole-city-last-match";

export function saveMatchResult(result: MatchResult): void {
  recordMatchStats({ score: result.playerScore, swallowCount: result.swallowCount });
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
    const source = parsed as Record<string, unknown>;
    const optionalNumeric = (value: unknown): number | undefined =>
      typeof value === "number" && Number.isFinite(value) ? value : undefined;
    return {
      playerRank: parsed.playerRank,
      playerScore: parsed.playerScore,
      ranking,
      swallowCount: optionalNumeric(source.swallowCount),
      eliminations: optionalNumeric(source.eliminations),
      elapsedSeconds: optionalNumeric(source.elapsedSeconds),
      maxRevives: optionalNumeric(source.maxRevives),
    };
  } catch {
    return null;
  }
}
