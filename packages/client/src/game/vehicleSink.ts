export const VEHICLE_SINK_DURATION_SECONDS = 0.72;

const VEHICLE_SINK_MINIMUM_DISTANCE = 7.2;

export interface VehicleSinkTransform {
  visible: boolean;
  verticalOffset: number;
  scaleMultiplier: 1;
}

export function getVehicleSinkTransform(
  elapsedSeconds: number,
  objectHeight: number,
): VehicleSinkTransform {
  const progress = Math.max(0, Math.min(1, elapsedSeconds / VEHICLE_SINK_DURATION_SECONDS));
  return {
    visible: progress < 1,
    verticalOffset: progress * progress * Math.max(VEHICLE_SINK_MINIMUM_DISTANCE, objectHeight * 2),
    scaleMultiplier: 1,
  };
}
