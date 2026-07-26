import { PERMANENT_BLOCK_THRESHOLD, TEMP_BLOCK_MS, TEMP_BLOCK_THRESHOLD } from "../constants.js";
import type { Persistence, IpAccessState } from "../db/persistence.js";

export type AccessDecision =
  | { allowed: true }
  | { allowed: false; permanent: boolean; retryAt: number | null };

const WHITELISTED_IPS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

export class AccessService {
  private readonly persistence: Persistence;
  private readonly now: () => number;
  private readonly pendingByIp = new Map<string, Promise<void>>();

  constructor(persistence: Persistence, now: () => number) {
    this.persistence = persistence;
    this.now = now;
  }

  private isWhitelisted(ip: string): boolean {
    return WHITELISTED_IPS.has(ip);
  }

  async check(ip: string): Promise<AccessDecision> {
    if (this.isWhitelisted(ip)) return { allowed: true };
    const state = await this.persistence.getIpAccess(ip);
    if (state === null) return { allowed: true };
    if (state.permanentlyBlocked) {
      return { allowed: false, permanent: true, retryAt: null };
    }
    if (state.blockedUntil !== null && state.blockedUntil > this.now()) {
      return { allowed: false, permanent: false, retryAt: state.blockedUntil };
    }
    return { allowed: true };
  }

  async recordMissingRoom(ip: string): Promise<AccessDecision> {
    if (this.isWhitelisted(ip)) return { allowed: true };
    return this.exclusive(ip, async () => {
      const now = this.now();
      const existing = await this.persistence.getIpAccess(ip);
      const state: IpAccessState = existing ?? {
        ip,
        consecutiveMisses: 0,
        totalMisses: 0,
        blockedUntil: null,
        permanentlyBlocked: false,
        updatedAt: now,
      };
      if (state.blockedUntil !== null && state.blockedUntil <= now) state.blockedUntil = null;
      state.consecutiveMisses += 1;
      state.totalMisses += 1;
      state.updatedAt = now;

      if (state.totalMisses >= PERMANENT_BLOCK_THRESHOLD) {
        state.permanentlyBlocked = true;
        state.blockedUntil = null;
        state.consecutiveMisses = 0;
      } else if (state.consecutiveMisses >= TEMP_BLOCK_THRESHOLD) {
        state.blockedUntil = now + TEMP_BLOCK_MS;
        state.consecutiveMisses = 0;
      }

      await this.persistence.saveIpAccess(state);
      if (state.permanentlyBlocked) {
        return { allowed: false, permanent: true, retryAt: null };
      }
      if (state.blockedUntil !== null && state.blockedUntil > now) {
        return { allowed: false, permanent: false, retryAt: state.blockedUntil };
      }
      return { allowed: true };
    });
  }

  async recordSuccessfulEntry(ip: string): Promise<void> {
    if (this.isWhitelisted(ip)) return;
    await this.exclusive(ip, async () => {
      const state = await this.persistence.getIpAccess(ip);
      if (state === null || state.consecutiveMisses === 0) return;
      await this.persistence.saveIpAccess({
        ...state,
        consecutiveMisses: 0,
        updatedAt: this.now(),
      });
    });
  }

  private async exclusive<T>(ip: string, action: () => Promise<T>): Promise<T> {
    const previous = this.pendingByIp.get(ip) ?? Promise.resolve();
    const task = previous.catch(() => undefined).then(action);
    const settled = task.then(
      () => undefined,
      () => undefined,
    );
    this.pendingByIp.set(ip, settled);
    try {
      return await task;
    } finally {
      if (this.pendingByIp.get(ip) === settled) this.pendingByIp.delete(ip);
    }
  }
}
