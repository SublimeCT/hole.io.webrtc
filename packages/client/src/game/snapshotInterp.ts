// guest 端 unreliable 增量快照的「双缓冲 + hostTime 对齐」位置插值器。
//
// 为什么需要：host 以 30Hz 广播快照，guest 若每条快照直接覆盖位置，渲染就是 30Hz 的离散跳变，
// 在 60fps 渲染下表现为明显卡顿。本插值器保留最近若干条快照，渲染时在两条相邻快照之间按
// hostTime 线性插值（位置 + 半径），把 30Hz 跳变平滑成 60fps 连续运动。代价是渲染恒定滞后
// INTERPOLATION_DELAY_MS，用来换取抗抖动余量、避免外推发散。严格遵守 AGENTS.md §0.1：
// host 仍权威，guest 只渲染快照、不做本地预测或自报位置。
//
// 时钟：所有时间戳是 host 的 performance.now()（见 Game.#broadcastSnapshot）。guest 用本地 dt
// 推进 renderHostTime，每条快照到达时夹取到 newest-delay 之内；两端 performance.now() 的偏移
// 在差分与 dt 推进中自然抵消，无需 NTP 对齐。
import type { StateDeltaSnapshot } from "@hole-io/shared/protocol";

/** 渲染滞后量（ms）：必须 ≥ 约 2 个快照间隔（30Hz→33ms）以容忍丢包/抖动，避免经常外推。 */
const INTERPOLATION_DELAY_MS = 100;
/** 缓冲最多保留多少条快照（100ms/33ms ≈ 3 条活跃，余量留给乱序/积压）。 */
const BUFFER_MAX_SNAPSHOTS = 8;
/** renderHostTime 落后目标超过此值时直接对齐（切后台/长卡顿后避免长时间慢慢追赶）。 */
const MAX_CATCHUP_MS = 500;

interface HoleSample {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

interface BufferedSnapshot {
  readonly hostTime: number;
  readonly holes: ReadonlyMap<string, HoleSample>;
}

export interface SampledHole {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

export class SnapshotInterpolator {
  #buffer: BufferedSnapshot[] = [];
  /** 当前渲染点在 host 时间轴上的位置（ms）。 */
  #renderHostTime = 0;
  #ready = false;

  /**
   * 入缓冲。调用方必须保证 snapshotSeq 严格递增（driver 已做去重），故缓冲天然按 hostTime 升序。
   * 同时推进/夹取渲染时钟，使其始终滞后 newest 一个 INTERPOLATION_DELAY_MS。
   */
  push(delta: StateDeltaSnapshot): void {
    const holes = new Map<string, HoleSample>();
    for (const player of delta.players) {
      holes.set(player.peerId, {
        x: player.position.x,
        y: player.position.y,
        radius: player.radius,
      });
    }
    this.#buffer.push({ hostTime: delta.hostTime, holes });
    while (this.#buffer.length > BUFFER_MAX_SNAPSHOTS) this.#buffer.shift();

    const target = delta.hostTime - INTERPOLATION_DELAY_MS;
    if (!this.#ready) {
      this.#renderHostTime = target;
      this.#ready = true;
      return;
    }
    const lag = target - this.#renderHostTime;
    // 长时间停滞（标签页隐藏等）后本地时钟严重落后：直接对齐，避免长时间追赶外推。
    // 本地时钟漂移跑到安全线之前（lag<0）：拉回到 newest-delay，绝不外推。
    if (lag > MAX_CATCHUP_MS || lag < 0) {
      this.#renderHostTime = target;
    }
  }

  /**
   * 推进渲染时钟并采样。每渲染帧调用一次，frameDeltaMs 为自上次 sample 的真实墙钟增量。
   * 返回 holeId → 插值后的 {x,y,radius}；缓冲不足（首帧 / checkpoint 后尚未收到快照）返回 null。
   */
  sample(frameDeltaMs: number): ReadonlyMap<string, SampledHole> | null {
    if (!this.#ready || this.#buffer.length === 0) return null;
    this.#renderHostTime += frameDeltaMs;
    const newestSnap = this.#buffer[this.#buffer.length - 1];
    if (newestSnap === undefined) return null; // length>0 已保证非空，仅满足严格索引检查
    const ceiling = newestSnap.hostTime - INTERPOLATION_DELAY_MS;
    if (this.#renderHostTime > ceiling) this.#renderHostTime = ceiling;

    const t = this.#renderHostTime;
    let prev: BufferedSnapshot | null = null;
    let next: BufferedSnapshot | null = null;
    for (const snap of this.#buffer) {
      if (snap.hostTime <= t) prev = snap;
      else {
        next = snap;
        break;
      }
    }
    const oldestSnap = this.#buffer[0];
    if (prev === null) return oldestSnap === undefined ? null : oldestSnap.holes; // 钳到最旧
    if (next === null) return prev.holes; // t 晚于最新：钳到最新，不外推

    const span = next.hostTime - prev.hostTime;
    const alpha = span > 0 ? (t - prev.hostTime) / span : 0;
    const out = new Map<string, SampledHole>();
    // 每条快照都携带全部玩家，故两帧的 holeId 集合一致；缺值时回退到较旧一帧。
    for (const [id, a] of prev.holes) {
      const b = next.holes.get(id);
      if (b === undefined) {
        out.set(id, a);
        continue;
      }
      out.set(id, {
        x: a.x + (b.x - a.x) * alpha,
        y: a.y + (b.y - a.y) * alpha,
        radius: a.radius + (b.radius - a.radius) * alpha,
      });
    }
    return out;
  }

  /** checkpoint 后清空缓冲，下一条快照重新初始化渲染时钟。 */
  reset(): void {
    this.#buffer = [];
    this.#renderHostTime = 0;
    this.#ready = false;
  }
}
