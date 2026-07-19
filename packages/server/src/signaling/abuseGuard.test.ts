import { describe, it, expect } from "vitest";
import { AbuseGuard } from "./abuseGuard.js";

function guard(
  overrides: Partial<{
    maxConnections: number;
    maxConnectionsPerIp: number;
    connectRatePerMinute: number;
  }> = {},
): AbuseGuard {
  return new AbuseGuard({
    maxConnections: overrides.maxConnections ?? 1000,
    maxConnectionsPerIp: overrides.maxConnectionsPerIp ?? 20,
    connectRatePerMinute: overrides.connectRatePerMinute ?? 60,
  });
}

describe("AbuseGuard", () => {
  it("admits a connection within limits and tracks the count", () => {
    const g = guard();
    expect(g.acquire("1.2.3.4", 0)).toEqual({ ok: true });
    expect(g.connections).toBe(1);
  });

  it("rejects with GLOBAL_FULL when total connections are exhausted", () => {
    const g = guard({ maxConnections: 1 });
    expect(g.acquire("1.2.3.4", 0)).toEqual({ ok: true });
    expect(g.acquire("5.6.7.8", 0)).toEqual({ ok: false, reason: "GLOBAL_FULL" });
    expect(g.connections).toBe(1);
  });

  it("rejects with IP_FULL when a single IP exceeds its concurrent cap", () => {
    const g = guard({ maxConnectionsPerIp: 2 });
    expect(g.acquire("1.2.3.4", 0)).toEqual({ ok: true });
    expect(g.acquire("1.2.3.4", 0)).toEqual({ ok: true });
    expect(g.acquire("1.2.3.4", 0)).toEqual({ ok: false, reason: "IP_FULL" });
    // 另一 IP 不受影响
    expect(g.acquire("9.9.9.9", 0)).toEqual({ ok: true });
  });

  it("rejects with RATE when an IP exceeds the per-minute connect rate", () => {
    const g = guard({ connectRatePerMinute: 3, maxConnections: 100, maxConnectionsPerIp: 100 });
    // 同一分钟内成功 3 次（连着没释放也算建连次数）
    expect(g.acquire("1.2.3.4", 1_000)).toEqual({ ok: true });
    expect(g.acquire("1.2.3.4", 2_000)).toEqual({ ok: true });
    expect(g.acquire("1.2.3.4", 3_000)).toEqual({ ok: true });
    expect(g.acquire("1.2.3.4", 4_000)).toEqual({ ok: false, reason: "RATE" });
  });

  it("forgets connect attempts older than one minute", () => {
    const g = guard({ connectRatePerMinute: 1, maxConnections: 100, maxConnectionsPerIp: 100 });
    expect(g.acquire("1.2.3.4", 0)).toEqual({ ok: true });
    expect(g.acquire("1.2.3.4", 1_000)).toEqual({ ok: false, reason: "RATE" });
    // 61 秒后旧的已过期，重新放行
    expect(g.acquire("1.2.3.4", 61_000)).toEqual({ ok: true });
  });

  it("decrements counts on release and allows re-acquire", () => {
    const g = guard({ maxConnectionsPerIp: 1 });
    expect(g.acquire("1.2.3.4", 0)).toEqual({ ok: true });
    expect(g.acquire("1.2.3.4", 0)).toEqual({ ok: false, reason: "IP_FULL" });
    g.release("1.2.3.4");
    expect(g.connections).toBe(0);
    expect(g.acquire("1.2.3.4", 0)).toEqual({ ok: true });
  });

  it("counts IPs independently", () => {
    const g = guard({ maxConnectionsPerIp: 1, maxConnections: 100 });
    expect(g.acquire("1.1.1.1", 0)).toEqual({ ok: true });
    expect(g.acquire("2.2.2.2", 0)).toEqual({ ok: true });
    expect(g.acquire("1.1.1.1", 0)).toEqual({ ok: false, reason: "IP_FULL" });
    expect(g.connections).toBe(2);
  });
});
