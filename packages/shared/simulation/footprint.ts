import type { Vector2 } from "./types";

/** Normalized left-foot sole, with toes toward negative Y. */
export const FOOTPRINT_SOLE: readonly Vector2[] = [
  { x: -0.44, y: -0.25 },
  { x: -0.5, y: -0.15 },
  { x: -0.48, y: -0.04 },
  { x: -0.4, y: 0.06 },
  { x: -0.27, y: 0.16 },
  { x: -0.26, y: 0.3 },
  { x: -0.19, y: 0.43 },
  { x: 0, y: 0.48 },
  { x: 0.19, y: 0.43 },
  { x: 0.26, y: 0.3 },
  { x: 0.23, y: 0.18 },
  { x: 0.16, y: 0.09 },
  { x: 0.29, y: 0.03 },
  { x: 0.44, y: -0.08 },
  { x: 0.48, y: -0.18 },
  { x: 0.44, y: -0.27 },
] as const;

export interface FootprintToe {
  center: Vector2;
  radius: Vector2;
}

export const FOOTPRINT_TOES: readonly FootprintToe[] = [
  { center: { x: -0.38, y: -0.38 }, radius: { x: 0.105, y: 0.05 } },
  { center: { x: -0.2, y: -0.42 }, radius: { x: 0.12, y: 0.058 } },
  { center: { x: 0, y: -0.44 }, radius: { x: 0.135, y: 0.066 } },
  { center: { x: 0.21, y: -0.42 }, radius: { x: 0.118, y: 0.057 } },
  { center: { x: 0.39, y: -0.37 }, radius: { x: 0.094, y: 0.045 } },
] as const;

function isInsidePolygon(point: Vector2, polygon: readonly Vector2[]): boolean {
  let inside = false;
  for (
    let index = 0, previous = polygon.length - 1;
    index < polygon.length;
    previous = index, index += 1
  ) {
    const currentPoint = polygon[index];
    const previousPoint = polygon[previous];
    if (!currentPoint || !previousPoint) continue;
    const crosses =
      currentPoint.y > point.y !== previousPoint.y > point.y &&
      point.x <
        ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) /
          (previousPoint.y - currentPoint.y) +
          currentPoint.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function isInsideNormalizedFootprint(point: Vector2): boolean {
  if (isInsidePolygon(point, FOOTPRINT_SOLE)) return true;
  return FOOTPRINT_TOES.some((toe) => {
    const x = (point.x - toe.center.x) / toe.radius.x;
    const y = (point.y - toe.center.y) / toe.radius.y;
    return x * x + y * y <= 1;
  });
}
