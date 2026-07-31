export interface PlayerStats {
  /** 历史最高单局分数。 */
  bestScore: number;
  /** 累计对局数（每次结算 +1）。 */
  gamesPlayed: number;
  /** 累计吞噬目标数（每次结算累加本局吞噬数）。 */
  totalSwallowed: number;
}

const PLAYER_STATS_KEY = "hole-city-player-stats";

const DEFAULT_PLAYER_STATS: PlayerStats = {
  bestScore: 0,
  gamesPlayed: 0,
  totalSwallowed: 0,
};

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function loadPlayerStats(): PlayerStats {
  try {
    const stored = localStorage.getItem(PLAYER_STATS_KEY);
    if (!stored) return { ...DEFAULT_PLAYER_STATS };
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed === "object" && parsed !== null) {
      const source = parsed as Record<string, unknown>;
      return {
        bestScore: isFiniteNonNegative(source.bestScore) ? source.bestScore : 0,
        gamesPlayed: isFiniteNonNegative(source.gamesPlayed) ? source.gamesPlayed : 0,
        totalSwallowed: isFiniteNonNegative(source.totalSwallowed) ? source.totalSwallowed : 0,
      };
    }
  } catch {
    // Persistent statistics are optional in restricted browser contexts.
  }
  return { ...DEFAULT_PLAYER_STATS };
}

export interface MatchStatsInput {
  score: number;
  /** 本局吞噬数；缺失或非法按 0 计。 */
  swallowCount?: number | undefined;
}

/**
 * 结算时累加本局战绩：刷新历史最高分、累计局数 +1、累计吞噬数累加。
 * 返回更新后的完整统计；持久化不可用时仍返回本次结果，保证结算流程不中断。
 */
export function recordMatchStats(input: MatchStatsInput): PlayerStats {
  const current = loadPlayerStats();
  const score = Number.isFinite(input.score) ? Math.max(0, input.score) : 0;
  const swallowed = isFiniteNonNegative(input.swallowCount) ? input.swallowCount : 0;
  const next: PlayerStats = {
    bestScore: Math.max(current.bestScore, score),
    gamesPlayed: current.gamesPlayed + 1,
    totalSwallowed: current.totalSwallowed + swallowed,
  };
  try {
    localStorage.setItem(PLAYER_STATS_KEY, JSON.stringify(next));
  } catch {
    // Match completion must still succeed if persistence is unavailable.
  }
  return next;
}
