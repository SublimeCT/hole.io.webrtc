import { describe, expect, it } from "vitest";
import { VEHICLE_SINK_DURATION_SECONDS, getVehicleSinkTransform } from "./vehicleSink";

describe("vehicle sink animation", () => {
  it("falls below the hole while preserving the authored vehicle scale", () => {
    const start = getVehicleSinkTransform(0, 1.6);
    const middle = getVehicleSinkTransform(VEHICLE_SINK_DURATION_SECONDS / 2, 1.6);
    const end = getVehicleSinkTransform(VEHICLE_SINK_DURATION_SECONDS, 1.6);

    expect(start).toMatchObject({ visible: true, verticalOffset: 0, scaleMultiplier: 1 });
    expect(middle.verticalOffset).toBeGreaterThan(0);
    expect(end.verticalOffset).toBeGreaterThan(middle.verticalOffset);
    expect(middle.scaleMultiplier).toBe(1);
    expect(end).toMatchObject({ visible: false, scaleMultiplier: 1 });
  });
});
