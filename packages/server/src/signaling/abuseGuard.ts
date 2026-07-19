// 连接级防滥用：全局并发上限、单 IP 并发上限、单 IP 建连速率。
// 这是缓解层（AGENTS.md §8），不是根治——休闲游戏够用。
// now 由调用方注入，便于测试时间推进。

export type AcquireFailureReason = "GLOBAL_FULL" | "IP_FULL" | "RATE";

export type AcquireResult = { ok: true } | { ok: false; reason: AcquireFailureReason };

export interface AbuseGuardOptions {
  maxConnections: number;
  maxConnectionsPerIp: number;
  connectRatePerMinute: number;
}

const MINUTE_MS = 60_000;

export class AbuseGuard {
  private connectionCount = 0;
  private readonly ipConnections = new Map<string, number>();
  private readonly ipConnectLog = new Map<string, number[]>();
  private readonly options: AbuseGuardOptions;

  constructor(options: AbuseGuardOptions) {
    this.options = options;
  }

  /** 当前全局并发连接数（测试/监控用）。 */
  get connections(): number {
    return this.connectionCount;
  }

  /**
   * 尝试放行一次新连接。成功才记账；失败不记账。
   * 清理该 IP 一分钟外的建连记录后再判定。
   */
  acquire(ip: string, now: number): AcquireResult {
    const cutoff = now - MINUTE_MS;
    const recentLog = (this.ipConnectLog.get(ip) ?? []).filter((t) => t > cutoff);
    if (recentLog.length === 0) this.ipConnectLog.delete(ip);
    else this.ipConnectLog.set(ip, recentLog);

    if (this.connectionCount >= this.options.maxConnections) {
      return { ok: false, reason: "GLOBAL_FULL" };
    }
    const ipCount = this.ipConnections.get(ip) ?? 0;
    if (ipCount >= this.options.maxConnectionsPerIp) {
      return { ok: false, reason: "IP_FULL" };
    }
    if (recentLog.length >= this.options.connectRatePerMinute) {
      return { ok: false, reason: "RATE" };
    }

    this.connectionCount += 1;
    this.ipConnections.set(ip, ipCount + 1);
    recentLog.push(now);
    this.ipConnectLog.set(ip, recentLog);
    return { ok: true };
  }

  /** 释放一次连接（连接关闭时调用）。 */
  release(ip: string): void {
    this.connectionCount = Math.max(0, this.connectionCount - 1);
    const count = this.ipConnections.get(ip);
    if (count === undefined) return;
    if (count <= 1) this.ipConnections.delete(ip);
    else this.ipConnections.set(ip, count - 1);
  }
}
