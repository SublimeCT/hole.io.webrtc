// guest 本地玩家洞的「客户端预测 + 和解」（client-side prediction & reconciliation）。
//
// 为什么需要：host 权威架构下，guest 自己的洞位置要等输入往返 host 再回显才有反馈，叠加快照插值的
// 恒定滞后，操作明显不跟手。本预测器在 guest 端用本地输入立即推进自己的洞位置（跟手），收到 host
// 快照时以权威位置为基准、回放尚未被确认的输入来「和解」，避免直接拉回造成的回弹。
//
// 严格遵守 AGENTS.md §0.1：guest 永不向 host 上报位置，只上报输入（带 seq）；host 仍是唯一权威，
// 预测仅用于本地渲染。位置推进复用 host 同款的共享纯函数 advanceHolePosition，保证两端速度公式一致。
import { advanceHolePosition, type HoleState, type Vector2 } from "@hole-io/shared/simulation";

interface BufferedInput {
  readonly seq: number;
  readonly direction: Vector2;
  /** 发送时刻的本地墙钟（performance.now()，ms），用于回放时计算每条输入的持有时长。 */
  readonly emittedAt: number;
}

/** 输入缓冲上限：~1s 的 30Hz 输入约 30 条，足够覆盖最坏往返时延，超出按丢弃处理。 */
const BUFFER_MAX_INPUTS = 60;

export class LocalHolePredictor {
  #position: Vector2 | null = null;
  #buffer: BufferedInput[] = [];

  get position(): Vector2 | null {
    return this.#position;
  }

  /** 首条快照或 checkpoint 后以权威位置初始化预测。 */
  reset(position: Vector2): void {
    this.#position = { x: position.x, y: position.y };
    this.#buffer = [];
  }

  /** guest 每次向 host 上报输入时调用，记录该输入供和解回放。emittedAt 为本地 performance.now()。 */
  recordInput(seq: number, direction: Vector2, emittedAt: number): void {
    this.#buffer.push({ seq, direction: { x: direction.x, y: direction.y }, emittedAt });
    while (this.#buffer.length > BUFFER_MAX_INPUTS) this.#buffer.shift();
  }

  /** 每渲染帧用本地输入推进预测位置。authHole 提供 score/radius/speedBoost 等速度因素（取自最新快照）。 */
  advance(direction: Vector2, deltaSeconds: number, authHole: HoleState): void {
    if (this.#position === null) return;
    this.#position = advanceHolePosition(
      { ...authHole, position: this.#position },
      direction,
      deltaSeconds,
    );
  }

  /**
   * 收到 host 快照后和解：丢弃已被 host 确认（seq ≤ lastProcessedInputSeq）的输入，以权威位置为基准，
   * 回放尚未确认的输入（每条按其持有时长），得到无回弹的当前预测位置。now 为本地 performance.now()。
   */
  reconcile(
    authoritativePosition: Vector2,
    lastProcessedInputSeq: number,
    authHole: HoleState,
    now: number,
  ): void {
    while (this.#buffer.length > 0) {
      const head = this.#buffer[0];
      if (head === undefined || head.seq > lastProcessedInputSeq) break;
      this.#buffer.shift();
    }
    let position: Vector2 = { x: authoritativePosition.x, y: authoritativePosition.y };
    for (let i = 0; i < this.#buffer.length; i += 1) {
      const input = this.#buffer[i];
      if (input === undefined) continue; // i < length 已保证非空，仅满足严格索引检查
      const nextInput = this.#buffer[i + 1];
      const nextEmittedAt = nextInput === undefined ? now : nextInput.emittedAt;
      const dt = Math.max(0, (nextEmittedAt - input.emittedAt) / 1000);
      position = advanceHolePosition({ ...authHole, position }, input.direction, dt);
    }
    this.#position = position;
  }
}
