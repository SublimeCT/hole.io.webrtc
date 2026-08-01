import { describe, expect, it } from "vitest";
import { computeHoleMoveSpeed, type HoleState } from "@hole-io/shared/simulation";

import { LocalHolePredictor } from "./localHolePredictor";

function humanHole(position: { x: number; y: number }): HoleState {
  return {
    id: "p",
    kind: "human",
    position,
    radius: 1.15,
    score: 0,
    eliminationRemaining: 0,
    eliminations: 0,
    revivesRemaining: 1,
    invulnerabilityRemaining: 0,
    speedBoostRemaining: 0,
    speedBoostCooldown: 0,
    radiusBoostRemaining: 0,
    radiusBoostCooldown: 0,
    bombFuseRemaining: 0,
    bombCooldown: 0,
    activePowerUps: [],
    nextPoopDropIn: 0,
    isOut: false,
    bot: null,
  };
}

describe("LocalHolePredictor", () => {
  it("does nothing until reset with an authoritative position", () => {
    const predictor = new LocalHolePredictor();
    expect(predictor.position).toBeNull();
    predictor.advance({ x: 1, y: 0 }, 0.1, humanHole({ x: 0, y: 0 }));
    expect(predictor.position).toBeNull();
  });

  it("advances the predicted position by input × speed × dt", () => {
    const predictor = new LocalHolePredictor();
    const hole = humanHole({ x: 0, y: 0 });
    predictor.reset({ x: 0, y: 0 });
    predictor.advance({ x: 1, y: 0 }, 1, hole);
    const speed = computeHoleMoveSpeed({ ...hole, position: predictor.position ?? { x: 0, y: 0 } });
    expect(predictor.position?.x).toBeCloseTo(speed, 5);
    expect(predictor.position?.y).toBe(0);
  });

  it("reconciles to the authoritative position when no inputs are pending", () => {
    const predictor = new LocalHolePredictor();
    predictor.reset({ x: 0, y: 0 });
    predictor.advance({ x: 1, y: 0 }, 1, humanHole({ x: 0, y: 0 }));
    // host 权威位置（未确认输入为空）→ 直接采用，不回弹。
    predictor.reconcile({ x: 5, y: 5 }, 0, humanHole({ x: 5, y: 5 }), 0);
    expect(predictor.position).toMatchObject({ x: 5, y: 5 });
  });

  it("replays unacked inputs on top of the authoritative position (no rubber-band)", () => {
    const predictor = new LocalHolePredictor();
    const hole = humanHole({ x: 0, y: 0 });
    predictor.reset({ x: 0, y: 0 });
    // 输入 seq=1 在 t=1000 发出，host 仅确认到 seq=0，故 seq=1 需回放。
    predictor.recordInput(1, { x: 1, y: 0 }, 1000);
    // now=2000：该输入持有了 1s。
    predictor.reconcile({ x: 0, y: 0 }, 0, hole, 2000);
    const speed = computeHoleMoveSpeed({ ...hole, position: predictor.position ?? { x: 0, y: 0 } });
    expect(predictor.position?.x).toBeCloseTo(speed, 5);
    expect(predictor.position?.y).toBe(0);
  });

  it("drops acked inputs and only replays the rest", () => {
    const predictor = new LocalHolePredictor();
    const hole = humanHole({ x: 0, y: 0 });
    predictor.reset({ x: 0, y: 0 });
    predictor.recordInput(1, { x: 1, y: 0 }, 1000); // 已被 host 确认
    predictor.recordInput(2, { x: 0, y: 1 }, 1300); // 未确认，持到 now=1600
    predictor.reconcile({ x: 9, y: 0 }, 1, hole, 1600);
    // seq=1 丢弃；从权威 (9,0) 回放 seq=2：(0,1) × speed × 0.3s。
    const speed = computeHoleMoveSpeed({ ...hole, position: predictor.position ?? { x: 0, y: 0 } });
    expect(predictor.position?.x).toBeCloseTo(9, 5);
    expect(predictor.position?.y).toBeCloseTo(speed * 0.3, 5);
  });

  it("reset clears the input buffer", () => {
    const predictor = new LocalHolePredictor();
    predictor.reset({ x: 0, y: 0 });
    predictor.recordInput(1, { x: 1, y: 0 }, 1000);
    predictor.reset({ x: 7, y: 7 });
    // 重置后无待回放输入，和解直接采用权威位置。
    predictor.reconcile({ x: 0, y: 0 }, 0, humanHole({ x: 0, y: 0 }), 2000);
    expect(predictor.position).toMatchObject({ x: 0, y: 0 });
  });
});
