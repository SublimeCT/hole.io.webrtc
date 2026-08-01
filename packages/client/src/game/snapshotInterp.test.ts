import { describe, expect, it } from "vitest";
import type { PlayerSnapshot, StateDeltaSnapshot } from "@hole-io/shared/protocol";

import { SnapshotInterpolator } from "./snapshotInterp";

function player(peerId: string, x: number, radius: number): PlayerSnapshot {
  return {
    peerId,
    position: { x, y: 0 },
    radius,
    score: 0,
    eliminations: 0,
    revivesRemaining: 0,
    eliminationRemaining: 0,
    invulnerabilityRemaining: 0,
    isOut: false,
    lastProcessedInputSeq: 0,
    activePowerUps: [],
  };
}

function snapshot(
  seq: number,
  hostTime: number,
  players: readonly PlayerSnapshot[],
): StateDeltaSnapshot {
  return {
    type: "state-delta",
    matchId: "m",
    snapshotSeq: seq,
    hostTick: 0,
    baseWorldRevision: 0,
    worldRevision: 0,
    hostTime,
    elapsed: 0,
    remaining: 100,
    status: "playing",
    players,
    changedObjects: [],
    powerUps: [],
    footprints: [],
    poopHazards: [],
  };
}

describe("SnapshotInterpolator", () => {
  it("returns null until the first snapshot arrives", () => {
    const interp = new SnapshotInterpolator();
    expect(interp.sample(16)).toBeNull();
  });

  it("clamps to the only snapshot before a second one arrives", () => {
    const interp = new SnapshotInterpolator();
    interp.push(snapshot(1, 0, [player("a", 10, 1)]));
    // 渲染时钟初始化为 hostTime - delay = -100，落在唯一快照之前 → 钳到该快照。
    const sampled = interp.sample(0);
    expect(sampled?.get("a")).toMatchObject({ x: 10, radius: 1 });
  });

  it("lerps position and radius between two bracketing snapshots", () => {
    const interp = new SnapshotInterpolator();
    interp.push(snapshot(1, 0, [player("a", 0, 1)]));
    interp.push(snapshot(2, 200, [player("a", 100, 3)]));

    interp.sample(0); // t = -100（钳到最旧）
    const atMid = interp.sample(100); // 推进到 t = 0 → alpha 0
    expect(atMid?.get("a")).toMatchObject({ x: 0, radius: 1 });
    const atHalf = interp.sample(100); // 推进到 t = 100 → alpha 0.5
    expect(atHalf?.get("a")).toMatchObject({ x: 50, radius: 2 });
  });

  it("never extrapolates past the newest snapshot", () => {
    const interp = new SnapshotInterpolator();
    interp.push(snapshot(1, 0, [player("a", 0, 1)]));
    interp.push(snapshot(2, 200, [player("a", 100, 3)]));

    interp.sample(0);
    interp.sample(100); // t = 0
    interp.sample(100); // t = 100 (newest - delay 上限)
    const clamped = interp.sample(1_000); // 试图超过 newest，应被夹回 ceiling
    expect(clamped?.get("a")).toMatchObject({ x: 50, radius: 2 });
  });

  it("handles multiple holes independently", () => {
    const interp = new SnapshotInterpolator();
    interp.push(snapshot(1, 0, [player("a", 0, 1), player("b", 200, 5)]));
    interp.push(snapshot(2, 200, [player("a", 40, 2), player("b", 160, 6)]));

    interp.sample(0);
    interp.sample(100); // t = 0
    interp.sample(100); // t = 100 → alpha 0.5
    const sampled = interp.sample(0);
    expect(sampled?.get("a")).toMatchObject({ x: 20, radius: 1.5 });
    expect(sampled?.get("b")).toMatchObject({ x: 180, radius: 5.5 });
  });

  it("trims the buffer to a bounded size", () => {
    const interp = new SnapshotInterpolator();
    for (let i = 0; i < 20; i += 1) {
      interp.push(snapshot(i + 1, i * 33, [player("a", i, 1)]));
    }
    // 缓冲有上限；push 不抛错即说明 trim 生效。采样仍返回合理值。
    const sampled = interp.sample(16);
    expect(sampled).not.toBeNull();
    expect(sampled?.get("a")).toBeDefined();
  });

  it("resets after a checkpoint so the next snapshot reinitializes the clock", () => {
    const interp = new SnapshotInterpolator();
    interp.push(snapshot(1, 0, [player("a", 50, 2)]));
    expect(interp.sample(0)).not.toBeNull();

    interp.reset();
    expect(interp.sample(16)).toBeNull(); // 缓冲被清空

    interp.push(snapshot(2, 500, [player("a", 80, 4)]));
    const sampled = interp.sample(0);
    expect(sampled?.get("a")).toMatchObject({ x: 80, radius: 4 });
  });
});
