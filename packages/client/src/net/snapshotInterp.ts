// guest 端 unreliable 增量快照缓冲。
// v1：按 snapshotSeq 丢弃旧包/乱序包，把最新 delta 交给 driver 应用。
// 位置插值（双缓冲 + hostTime 对齐）留作后续平滑优化，当前直接 applyDelta（10Hz 更新，可玩）。
import type { StateDeltaSnapshot } from "@hole-io/shared/protocol";

export class SnapshotInterpolator {
  #lastSnapshotSeq = -1;

  /** 返回应当应用的 delta（seq 严格更新），旧/重复/乱序返回 null。 */
  push(delta: StateDeltaSnapshot): StateDeltaSnapshot | null {
    if (delta.snapshotSeq <= this.#lastSnapshotSeq) return null;
    this.#lastSnapshotSeq = delta.snapshotSeq;
    return delta;
  }

  reset(): void {
    this.#lastSnapshotSeq = -1;
  }
}
