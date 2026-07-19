import { HOLE_LEVELS } from "./constants";

export interface HoleProgress {
  level: number;
  radius: number;
  currentScore: number;
  nextScore: number | null;
  progress: number;
}

export function getHoleProgress(score: number): HoleProgress {
  let level = 0;
  for (let index = 0; index < HOLE_LEVELS.length; index += 1) {
    const candidate = HOLE_LEVELS[index];
    if (candidate && score >= candidate.minimumScore) {
      level = index;
    }
  }
  const current = HOLE_LEVELS[level] ?? HOLE_LEVELS[0];
  if (!current) {
    throw new Error("At least one hole level is required");
  }
  const next = HOLE_LEVELS[level + 1];
  if (!next) {
    const bandSize = current.minimumScore;
    const overflowBand = Math.floor((score - current.minimumScore) / bandSize);
    const currentScore = current.minimumScore + overflowBand * bandSize;
    const nextScore = currentScore + bandSize;
    const progress = Math.min(1, (score - currentScore) / bandSize);
    return {
      level: level + overflowBand,
      radius: current.radius * Math.sqrt(Math.max(1, score / current.minimumScore)),
      currentScore,
      nextScore,
      progress,
    };
  }
  const progress = Math.min(
    1,
    (score - current.minimumScore) / (next.minimumScore - current.minimumScore),
  );
  return {
    level,
    radius: current.radius + (next.radius - current.radius) * progress,
    currentScore: current.minimumScore,
    nextScore: next.minimumScore,
    progress,
  };
}
