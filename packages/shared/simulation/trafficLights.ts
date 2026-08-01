import { TRAFFIC_CYCLE_SECONDS, TRAFFIC_NS_GREEN_SECONDS } from "./constants";
import type { RouteAxis, Vector2, WorldObjectState } from "./types";

function wrapRoutePosition(value: number, minimum: number, maximum: number): number {
  const span = maximum - minimum;
  if (span <= 0) return minimum;
  return minimum + ((((value - minimum) % span) + span) % span);
}

/** Total green-light time granted to one axis since the match began. */
export function greenTimeAccumulated(axis: RouteAxis, elapsed: number): number {
  const safeElapsed = Math.max(0, elapsed);
  const completeCycles = Math.floor(safeElapsed / TRAFFIC_CYCLE_SECONDS);
  const cycleElapsed = safeElapsed - completeCycles * TRAFFIC_CYCLE_SECONDS;
  if (axis === "y") {
    return (
      completeCycles * TRAFFIC_NS_GREEN_SECONDS + Math.min(cycleElapsed, TRAFFIC_NS_GREEN_SECONDS)
    );
  }
  return (
    completeCycles * (TRAFFIC_CYCLE_SECONDS - TRAFFIC_NS_GREEN_SECONDS) +
    Math.max(0, cycleElapsed - TRAFFIC_NS_GREEN_SECONDS)
  );
}

/** Deterministic route position derived only from the initial route phase and elapsed time. */
export function routedPositionAt(object: WorldObjectState, elapsed: number): Vector2 {
  const motion = object.routeMotion ?? object.motion;
  if (motion === null) return object.position;
  const position =
    motion.axis === "x"
      ? { x: motion.initialCoordinate, y: motion.lateralCoordinate }
      : { x: motion.lateralCoordinate, y: motion.initialCoordinate };
  position[motion.axis] = wrapRoutePosition(
    motion.initialCoordinate +
      motion.direction * motion.speed * greenTimeAccumulated(motion.axis, elapsed),
    motion.minimum,
    motion.maximum,
  );
  return position;
}

export function greenAxisAt(elapsed: number): RouteAxis {
  const cycleElapsed = Math.max(0, elapsed) % TRAFFIC_CYCLE_SECONDS;
  return cycleElapsed < TRAFFIC_NS_GREEN_SECONDS ? "y" : "x";
}
