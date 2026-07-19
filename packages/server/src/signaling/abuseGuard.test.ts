import { describe, it, expect } from "vitest";
import { AbuseGuard } from "./abuseGuard.js";

function guard(
  overrides: Partial<{ maxConnections: number; maxConnectionsPerIp: number }> = {},
): AbuseGuard {
  return new AbuseGuard({
    maxConnections: overrides.maxConnections ?? 100,
    maxConnectionsPerIp: overrides.maxConnectionsPerIp ?? 5,
  });
}

describe("AbuseGuard", () => {
  it("admits a connection within limits and tracks the count", () => {
    const g = guard();
    expect(g.acquire("1.2.3.4")).toEqual({ ok: true });
    expect(g.connections).toBe(1);
  });

  it("rejects with GLOBAL_FULL when total connections are exhausted", () => {
    const g = guard({ maxConnections: 1 });
    expect(g.acquire("1.2.3.4")).toEqual({ ok: true });
    expect(g.acquire("5.6.7.8")).toEqual({ ok: false, reason: "GLOBAL_FULL" });
    expect(g.connections).toBe(1);
  });

  it("rejects with IP_FULL when a single IP exceeds its concurrent cap", () => {
    const g = guard({ maxConnectionsPerIp: 2 });
    expect(g.acquire("1.2.3.4")).toEqual({ ok: true });
    expect(g.acquire("1.2.3.4")).toEqual({ ok: true });
    expect(g.acquire("1.2.3.4")).toEqual({ ok: false, reason: "IP_FULL" });
    // 另一 IP 不受影响
    expect(g.acquire("9.9.9.9")).toEqual({ ok: true });
  });

  it("decrements counts on release and allows re-acquire", () => {
    const g = guard({ maxConnectionsPerIp: 1 });
    expect(g.acquire("1.2.3.4")).toEqual({ ok: true });
    expect(g.acquire("1.2.3.4")).toEqual({ ok: false, reason: "IP_FULL" });
    g.release("1.2.3.4");
    expect(g.connections).toBe(0);
    expect(g.acquire("1.2.3.4")).toEqual({ ok: true });
  });

  it("counts IPs independently", () => {
    const g = guard({ maxConnectionsPerIp: 1 });
    expect(g.acquire("1.1.1.1")).toEqual({ ok: true });
    expect(g.acquire("2.2.2.2")).toEqual({ ok: true });
    expect(g.acquire("1.1.1.1")).toEqual({ ok: false, reason: "IP_FULL" });
    expect(g.connections).toBe(2);
  });
});
