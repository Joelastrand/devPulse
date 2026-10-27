import { describe, expect, it } from "vitest";
import { productionOwnerReadDeps, productionSetSharedGoalsDeps } from "./owner-route-deps";

/**
 * Wiring only: the production factories compose the seams the owner routes pass to the operations. Nothing here reads
 * Firestore or the network, so the test asserts shape and that each seam is a function, not behaviour (behaviour is
 * covered by the operation and resolver tests).
 */
describe("production owner route dependencies", () => {
  it("supplies every seam the owner read operations need, including the BR-21 resolver", () => {
    const deps = productionOwnerReadDeps();
    expect(typeof deps.store.getOwner).toBe("function");
    expect(typeof deps.store.listOwnerWindow).toBe("function");
    expect(typeof deps.codec.probeKey).toBe("function");
    expect(typeof deps.codec.decryptForClassification).toBe("function");
    expect(typeof deps.teamReader.getTeamStatus).toBe("function");
    expect(typeof deps.teamReader.getMembership).toBe("function");
    expect(typeof deps.resolveParticipantState).toBe("function");
  });

  it("supplies the store, codec, D1 snapshot seam and server clock for the goal-set write", () => {
    const deps = productionSetSharedGoalsDeps();
    expect(typeof deps.store.runTransaction).toBe("function");
    expect(typeof deps.codec.encodeContent).toBe("function");
    expect(typeof deps.codec.probeKey).toBe("function");
    expect(typeof deps.goalStore.get).toBe("function");
    expect(deps.clock()).toBeInstanceOf(Date);
  });

  it("hands the goal-set write only the D1 get capability, with no create, update or delete reachable", () => {
    const goalStore = productionSetSharedGoalsDeps().goalStore as unknown as Record<string, unknown>;
    expect(Object.keys(goalStore)).toEqual(["get"]);
  });
});
