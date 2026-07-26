import { describe, expect, it } from "vitest";
import { TEMP_BLOCK_MS } from "../constants.js";
import { MemoryPersistence } from "../db/memoryPersistence.js";
import { AccessService } from "./accessService.js";

describe("AccessService", () => {
  it("temporarily blocks at 5 misses and permanently blocks at 10", async () => {
    let now = 1_000;
    const service = new AccessService(new MemoryPersistence(), () => now);
    for (let attempt = 1; attempt < 5; attempt += 1) {
      expect(await service.recordMissingRoom("203.0.113.10")).toEqual({ allowed: true });
    }
    expect(await service.recordMissingRoom("203.0.113.10")).toMatchObject({
      allowed: false,
      permanent: false,
    });

    now += TEMP_BLOCK_MS + 1;
    expect(await service.check("203.0.113.10")).toEqual({ allowed: true });
    for (let attempt = 6; attempt < 10; attempt += 1) {
      await service.recordMissingRoom("203.0.113.10");
    }
    expect(await service.recordMissingRoom("203.0.113.10")).toEqual({
      allowed: false,
      permanent: true,
      retryAt: null,
    });
  });

  it("resets consecutive misses after a successful room entry", async () => {
    const persistence = new MemoryPersistence();
    const service = new AccessService(persistence, () => 1_000);
    await service.recordMissingRoom("203.0.113.20");
    await service.recordMissingRoom("203.0.113.20");
    await service.recordSuccessfulEntry("203.0.113.20");
    expect(await persistence.getIpAccess("203.0.113.20")).toMatchObject({
      consecutiveMisses: 0,
      totalMisses: 2,
    });
  });
});
