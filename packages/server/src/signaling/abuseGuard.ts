// 连接级防滥用：全局并发上限、单 IP 并发上限。
// 建连-断开循环由「单 IP 并发上限」间接限制（占满并发槽后新连接被拒）。
// 这是缓解层（AGENTS.md §8），不是根治——休闲游戏够用。

export type AcquireFailureReason = "GLOBAL_FULL" | "IP_FULL";

export type AcquireResult = { ok: true } | { ok: false; reason: AcquireFailureReason };

export interface AbuseGuardOptions {
  maxConnections: number;
  maxConnectionsPerIp: number;
}

export class AbuseGuard {
  private connectionCount = 0;
  private readonly ipConnections = new Map<string, number>();
  private readonly options: AbuseGuardOptions;

  constructor(options: AbuseGuardOptions) {
    this.options = options;
  }

  /** 当前全局并发连接数（监控/测试用）。 */
  get connections(): number {
    return this.connectionCount;
  }

  /** 尝试放行一次新连接。成功才记账；失败不记账。 */
  acquire(ip: string): AcquireResult {
    if (this.connectionCount >= this.options.maxConnections) {
      return { ok: false, reason: "GLOBAL_FULL" };
    }
    const ipCount = this.ipConnections.get(ip) ?? 0;
    if (ipCount >= this.options.maxConnectionsPerIp) {
      return { ok: false, reason: "IP_FULL" };
    }
    this.connectionCount += 1;
    this.ipConnections.set(ip, ipCount + 1);
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
