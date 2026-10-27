import { describe, expect, it } from "vitest";
import { productionConversationViewDeps } from "./conversation-view-route-deps";

/**
 * Wiring only (TASK-024): the production factory composes the owner, accepted participant and pending seams for the
 * detail dispatch. Nothing here reads Firestore, so the test asserts shape and that each seam is a function. Behaviour is
 * covered by the dispatch operation and each branch's tests.
 */
describe("production conversation view dependencies", () => {
  it("supplies the store and the owner read seams, including the BR-21 resolver", () => {
    const deps = productionConversationViewDeps();
    expect(typeof deps.store.getOwner).toBe("function");
    expect(typeof deps.owner.resolveParticipantState).toBe("function");
    expect(typeof deps.owner.codec.probeKey).toBe("function");
  });

  it("supplies the accepted participant seams, with the key probe and the team name reader", () => {
    const deps = productionConversationViewDeps();
    expect(typeof deps.participant.store.getParticipation).toBe("function");
    expect(typeof deps.participant.codec.probeKey).toBe("function");
    expect(typeof deps.participant.codec.decryptForClassification).toBe("function");
    expect(typeof deps.participant.teamNameReader.getTeamName).toBe("function");
  });

  it("supplies the pending seams without any key codec, so a pending view can never reach the key", () => {
    const deps = productionConversationViewDeps();
    expect(Object.keys(deps.pending).sort()).toEqual(["store", "teamNameReader", "teamReader"]);
  });
});
