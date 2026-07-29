import { describe, expect, it } from "vitest";

import { simulationEventToWorldEvent } from "./snapshotCodec.js";

describe("simulationEventToWorldEvent", () => {
  it("maps poop hits to a reliable event for the affected guest", () => {
    expect(
      simulationEventToWorldEvent(
        { type: "poop-hit", holeId: "guest-1" },
        { matchId: "match-1", worldRevision: 7, powerUps: [] },
      ),
    ).toEqual({
      type: "poop-hit",
      matchId: "match-1",
      worldRevision: 7,
      peerId: "guest-1",
    });
  });
});
