import { describe, expect, it } from "vitest";

import { createInitialSimulation } from "../simulation/world.js";
import {
  applyCheckpointToState,
  applyDeltaToState,
  buildFullCheckpoint,
  simulationEventToWorldEvent,
  stateToDeltaSnapshot,
} from "./snapshotCodec.js";

function resizedFixture() {
  const initial = createInitialSimulation();
  const object = initial.objects.find(
    (candidate) => candidate.status === "static" && candidate.motion === null,
  );
  if (object === undefined) throw new Error("Static object fixture is required");
  const resized = {
    ...object,
    sizeMultiplier: object.sizeMultiplier * 0.5,
    size: { x: object.size.x * 0.5, y: object.size.y * 0.5 },
    height: object.height * 0.5,
    fitDiameter: object.fitDiameter * 0.5,
    centerY: object.centerY * 0.5,
  };
  return { initial, object, resized, state: { ...initial, objects: [resized] } };
}

describe("simulationEventToWorldEvent", () => {
  it("maps poop hits to a reliable event for the affected guest", () => {
    expect(
      simulationEventToWorldEvent(
        { type: "poop-hit", holeId: "guest-1" },
        { matchId: "match-1", worldRevision: 7, powerUps: [] },
      ),
    ).toEqual({
      type: "poop-hit",
      matchId: "match-1",
      worldRevision: 7,
      peerId: "guest-1",
    });
  });
});

describe("resized object overrides", () => {
  it("emits a resized static object once and applies all dimensions", () => {
    const { initial, object, resized, state } = resizedFixture();
    const emittedResized = new Set<string>();
    const input = {
      state,
      matchId: "match-1",
      snapshotSeq: 1,
      hostTick: 2,
      hostTime: 100,
      baseWorldRevision: 0,
      worldRevision: 1,
      lastProcessedInputByPeer: new Map<string, number>(),
      emittedConsumed: new Set<string>(),
      emittedResized,
      initialObjects: initial.objects,
    };
    const delta = stateToDeltaSnapshot(input);

    expect(delta.changedObjects).toEqual([
      {
        id: object.id,
        state: "resized",
        sizeMultiplier: resized.sizeMultiplier,
        size: resized.size,
        height: resized.height,
        fitDiameter: resized.fitDiameter,
        centerY: resized.centerY,
      },
    ]);
    expect(stateToDeltaSnapshot({ ...input, snapshotSeq: 2 }).changedObjects).toEqual([]);
    expect(applyDeltaToState({ ...initial, objects: [object] }, delta).objects[0]).toMatchObject({
      status: "static",
      position: object.position,
      rotation: object.rotation,
      sizeMultiplier: resized.sizeMultiplier,
      size: resized.size,
      height: resized.height,
      fitDiameter: resized.fitDiameter,
      centerY: resized.centerY,
    });
  });

  it("includes every resized static object in a full checkpoint", () => {
    const { initial, object, resized, state } = resizedFixture();
    const checkpoint = buildFullCheckpoint({
      state,
      matchId: "match-1",
      checkpointId: "checkpoint-1",
      snapshotSeq: 3,
      hostTick: 4,
      worldRevision: 2,
      hostTime: 200,
      initialObjects: initial.objects,
    });

    expect(checkpoint.objectOverrides[0]?.state).toBe("resized");
    expect(
      applyCheckpointToState({ ...initial, objects: [object] }, checkpoint).objects[0],
    ).toMatchObject({
      sizeMultiplier: resized.sizeMultiplier,
      size: resized.size,
      height: resized.height,
      fitDiameter: resized.fitDiameter,
      centerY: resized.centerY,
    });
  });
});
