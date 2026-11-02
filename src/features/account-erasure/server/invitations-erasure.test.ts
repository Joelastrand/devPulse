import { describe, expect, it, vi } from "vitest";
import { invitationBelongsToErasedPerson } from "./invitation-match";

vi.mock("server-only", () => ({}));

import { ErasureStepFailure } from "./erasure-runner";
import {
  runInvitationsBatch,
  type InvitationsErasurePort,
  type InvitationsStepDeps,
  type InvitationTransaction,
} from "./invitations-erasure";

// TASK-017: access requests and invitations. Fixtures are synthetic. The erased person is UID with email ERASED_EMAIL.

const UID = "erased-uid";
const OTHER_UID = "other-uid";
const TEAM = "team-1";
const ERASED_EMAIL = "Dev@Example.com";
const NORMALIZED = "dev@example.com";

type Doc = Record<string, unknown>;

function fakeInvitationsStore(options: { requests?: Record<string, Doc>; invitations?: Record<string, Doc> } = {}) {
  const requests = new Map<string, Doc>(Object.entries(options.requests ?? {}));
  const invitations = new Map<string, Doc>(Object.entries(options.invitations ?? {}));
  const log: string[] = [];

  const tx: InvitationTransaction = {
    async getAccessRequest(id) {
      const doc = requests.get(id);
      return doc === undefined ? undefined : { ...doc };
    },
    async getInvitation(id) {
      const doc = invitations.get(id);
      return doc === undefined ? undefined : { ...doc };
    },
    deleteAccessRequest(id) {
      log.push(`delete-request:${id}`);
      requests.delete(id);
    },
    deleteInvitation(id) {
      log.push(`delete-invitation:${id}`);
      invitations.delete(id);
    },
    clearAccessRequestResolvedBy(id) {
      log.push(`clear-resolvedBy:${id}`);
      const doc = requests.get(id);
      if (doc) requests.set(id, { ...doc, resolvedBy: null });
    },
    clearInvitationInvitedBy(id) {
      log.push(`clear-invitedBy:${id}`);
      const doc = invitations.get(id);
      if (doc) invitations.set(id, { ...doc, invitedBy: null });
    },
  };

  const port: InvitationsErasurePort = {
    async runTransaction(work) {
      return work(tx);
    },
    async accessRequestIdsFor(uid, limit) {
      return [...requests.entries()]
        .filter(([id, doc]) => (doc.uid !== undefined ? doc.uid === uid : id.startsWith(`${uid}__`)))
        .map(([id]) => id)
        .slice(0, limit);
    },
    async invitationIdsFor(normalizedEmail, uid, limit) {
      return [...invitations.entries()]
        .filter(([id, doc]) => doc.email === normalizedEmail || invitationBelongsToErasedPerson(id, doc, normalizedEmail, uid))
        .map(([id]) => id)
        .slice(0, limit);
    },
    async accessRequestIdsResolvedBy(uid, limit) {
      return [...requests.entries()].filter(([, doc]) => doc.resolvedBy === uid).map(([id]) => id).slice(0, limit);
    },
    async invitationIdsInvitedBy(uid, limit) {
      return [...invitations.entries()].filter(([, doc]) => doc.invitedBy === uid).map(([id]) => id).slice(0, limit);
    },
  };

  return { port, requests, invitations, log };
}

function depsFor(port: InvitationsErasurePort, normalizedEmailOf: InvitationsStepDeps["normalizedEmailOf"] = async () => ERASED_EMAIL): InvitationsStepDeps {
  return { port, normalizedEmailOf };
}

async function runToDone(deps: InvitationsStepDeps, uid: string, maxWrites = 100): Promise<void> {
  for (let batch = 0; batch < 50; batch += 1) {
    if ((await runInvitationsBatch(deps, uid, maxWrites)) === "done") return;
  }
  throw new Error("step did not reach done");
}

describe("invitations and access-requests erasure step (TASK-017)", () => {
  it("deletes the erased person's own access requests by uid field and by the legacy uid__ prefix, and keeps others'", async () => {
    const store = fakeInvitationsStore({
      requests: {
        [`${TEAM}__${UID}`]: { uid: UID, teamId: TEAM, status: "pending" },
        [`${UID}__legacy-team`]: { teamId: "legacy-team", status: "pending" },
        [`${OTHER_UID}__${TEAM}`]: { uid: OTHER_UID, teamId: TEAM, status: "pending" },
      },
    });

    await runToDone(depsFor(store.port), UID);

    expect(store.requests.has(`${TEAM}__${UID}`)).toBe(false);
    expect(store.requests.has(`${UID}__legacy-team`)).toBe(false);
    expect(store.requests.has(`${OTHER_UID}__${TEAM}`)).toBe(true);
  });

  it("deletes invitations whose stored normalized email matches in any status, and those resolved to the uid", async () => {
    const store = fakeInvitationsStore({
      invitations: {
        "inv-pending": { email: NORMALIZED, status: "pending", invitedBy: OTHER_UID },
        "inv-accepted": { email: NORMALIZED, status: "accepted", invitedBy: OTHER_UID },
        "inv-canceled": { email: NORMALIZED, status: "canceled", invitedBy: OTHER_UID },
        "inv-resolved": { email: "someone@example.com", status: "accepted", invitedBy: OTHER_UID, resolvedUid: UID },
      },
    });

    await runToDone(depsFor(store.port), UID);

    expect([...store.invitations.keys()]).toEqual([]);
  });

  it("deletes an invitation whose exact document id carries the erased email when no stored e-mail field exists", async () => {
    const store = fakeInvitationsStore({
      invitations: {
        [`${TEAM}__${NORMALIZED}`]: { teamId: TEAM, status: "pending", invitedBy: OTHER_UID },
      },
    });

    await runToDone(depsFor(store.port), UID);

    expect(store.invitations.has(`${TEAM}__${NORMALIZED}`)).toBe(false);
  });

  it("keeps an invitation whose id ends with the erased address but whose stored e-mail is a different person (TASK-038 finding 2)", async () => {
    // The id suffix alone must never delete another person's invitation. Here the id is "T__a__erased@…" and the stored e-mail is a
    // different address, so the suffix match is a coincidence and the record is kept.
    const other = "a__" + NORMALIZED;
    const store = fakeInvitationsStore({
      invitations: {
        [`${TEAM}__${other}`]: { email: "a__" + NORMALIZED.replace("erased", "stranger"), teamId: TEAM, status: "pending" },
      },
    });

    await runToDone(depsFor(store.port), UID);

    expect(store.invitations.has(`${TEAM}__${other}`)).toBe(true);
  });

  it("keeps other invitations untouched when their email and resolvedUid do not match", async () => {
    const store = fakeInvitationsStore({
      invitations: {
        "inv-other": { email: "other@example.com", status: "pending", invitedBy: OTHER_UID },
      },
    });

    await runToDone(depsFor(store.port), UID);

    expect(store.invitations.get("inv-other")).toEqual({ email: "other@example.com", status: "pending", invitedBy: OTHER_UID });
  });

  it("nulls resolvedBy on others' access requests and keeps the record", async () => {
    const store = fakeInvitationsStore({
      requests: { [`${OTHER_UID}__${TEAM}`]: { uid: OTHER_UID, teamId: TEAM, status: "approved", resolvedBy: UID } },
    });

    await runToDone(depsFor(store.port), UID);

    expect(store.requests.get(`${OTHER_UID}__${TEAM}`)).toMatchObject({ uid: OTHER_UID, status: "approved", resolvedBy: null });
  });

  it("nulls invitedBy on others' invitations for other emails and keeps the record", async () => {
    const store = fakeInvitationsStore({
      invitations: { "inv-other": { email: "other@example.com", status: "pending", invitedBy: UID } },
    });

    await runToDone(depsFor(store.port), UID);

    expect(store.invitations.get("inv-other")).toMatchObject({ email: "other@example.com", status: "pending", invitedBy: null });
  });

  it("orders the work: own access requests and matching invitations are deleted before any null-out of others' records", async () => {
    const store = fakeInvitationsStore({
      requests: {
        [`${TEAM}__${UID}`]: { uid: UID, teamId: TEAM, status: "pending" },
        [`${OTHER_UID}__${TEAM}`]: { uid: OTHER_UID, teamId: TEAM, status: "approved", resolvedBy: UID },
      },
      invitations: {
        "inv-own": { email: NORMALIZED, status: "pending", invitedBy: OTHER_UID },
        "inv-other": { email: "other@example.com", status: "pending", invitedBy: UID },
      },
    });

    await runToDone(depsFor(store.port), UID);

    expect(store.log).toEqual([
      `delete-request:${TEAM}__${UID}`,
      "delete-invitation:inv-own",
      `clear-resolvedBy:${OTHER_UID}__${TEAM}`,
      "clear-invitedBy:inv-other",
    ]);
  });

  it("reports done only when nothing matches in any category", async () => {
    const store = fakeInvitationsStore();
    expect(await runInvitationsBatch(depsFor(store.port), UID, 100)).toBe("done");
  });

  it("resolves the normalized email and fails closed with auth_unavailable when it cannot be resolved, with no write", async () => {
    const store = fakeInvitationsStore({
      invitations: { "inv-own": { email: NORMALIZED, status: "pending", invitedBy: OTHER_UID } },
    });
    const deps = depsFor(store.port, async () => {
      throw new Error("auth lookup failed");
    });

    await expect(runInvitationsBatch(deps, UID, 100)).rejects.toMatchObject({ code: "auth_unavailable" });
    expect(store.log).toEqual([]);
  });

  it("fails closed, with no delete, when a stored email is returned by the query but does not normalize to the erased email", async () => {
    const faulty = fakeInvitationsStore({
      invitations: { "inv-odd": { email: "someone-else@example.com", status: "pending", invitedBy: OTHER_UID } },
    });
    const port: InvitationsErasurePort = { ...faulty.port, invitationIdsFor: async () => ["inv-odd"] };

    await expect(runInvitationsBatch(depsFor(port), UID, 100)).rejects.toBeInstanceOf(ErasureStepFailure);
    expect(faulty.invitations.has("inv-odd")).toBe(true);
  });

  it("fails closed, with no null-out, when an access request's resolvedBy is not the erased uid", async () => {
    const faulty = fakeInvitationsStore({
      requests: { [`${OTHER_UID}__${TEAM}`]: { uid: OTHER_UID, teamId: TEAM, status: "approved", resolvedBy: OTHER_UID } },
    });
    const port: InvitationsErasurePort = { ...faulty.port, accessRequestIdsResolvedBy: async () => [`${OTHER_UID}__${TEAM}`] };

    await expect(runInvitationsBatch(depsFor(port), UID, 100)).rejects.toMatchObject({ code: "verification_failed" });
    expect(faulty.log).toEqual([]);
  });

  describe("a record already cleared to null by an earlier step (preserved state, re-run safe)", () => {
    it("deletes the erased person's own access request whose resolvedBy was cleared to null", async () => {
      const store = fakeInvitationsStore({
        requests: { [`${TEAM}__${UID}`]: { uid: UID, teamId: TEAM, status: "approved", resolvedBy: null } },
      });

      await runToDone(depsFor(store.port), UID);

      expect(store.requests.has(`${TEAM}__${UID}`)).toBe(false);
    });

    it("deletes a matching invitation whose invitedBy was cleared to null", async () => {
      const store = fakeInvitationsStore({
        invitations: { "inv-own": { email: NORMALIZED, status: "pending", invitedBy: null } },
      });

      await runToDone(depsFor(store.port), UID);

      expect(store.invitations.has("inv-own")).toBe(false);
    });

    it("still fails closed on a null uid, which is not a cleared actor field", async () => {
      const store = fakeInvitationsStore({
        requests: { [`${TEAM}__${UID}`]: { uid: null, teamId: TEAM, status: "pending" } },
      });
      // A faulty port that hands the step this request anyway, so the step's own parse guard is what is tested.
      const port: InvitationsErasurePort = { ...store.port, accessRequestIdsFor: async () => [`${TEAM}__${UID}`] };

      await expect(runInvitationsBatch(depsFor(port), UID, 100)).rejects.toMatchObject({
        code: "verification_failed",
      });
      expect(store.requests.has(`${TEAM}__${UID}`)).toBe(true);
    });
  });

  it("refuses a zero write budget as a programming error, not as a batch result", async () => {
    const store = fakeInvitationsStore();
    await expect(runInvitationsBatch(depsFor(store.port), UID, 0)).rejects.toBeInstanceOf(ErasureStepFailure);
  });
});
