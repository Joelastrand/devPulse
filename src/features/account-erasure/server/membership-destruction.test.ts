import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BoundConversation, ParticipantBindingsDeps } from "./participant-bindings-erasure";
import { ErasureWriteRefused } from "../../auth/server/erasure-write-fence";
import {
  destroyMembershipInstance,
  MembershipDestructionFailure,
  type MembershipDestructionFinalTransaction,
  type MembershipDestructionPort,
} from "./membership-destruction";

// TASK-038 owner decision (2026-11-02): ordinary admin removal and erasure destroy a membership through the same boundary. These
// are application tests over a recording port. They prove the ORDER of the reads and writes; they do not prove Firestore's
// conflict behaviour, which is the D-EMU gate. The per-conversation binding cleanup is stubbed here; its own tests cover it.

vi.mock("./participant-bindings-erasure", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./participant-bindings-erasure")>();
  return { ...actual, eraseParticipantBinding: vi.fn(async () => ({ ok: true, outcome: "cleaned" })) };
});
import { eraseParticipantBinding } from "./participant-bindings-erasure";

const MEMBERSHIP = "uid-m__team-1";
const UID = "uid-m";
const TARGET = { membershipId: MEMBERSHIP, uid: UID };
const TEAM = "team-1";
const REF = "ref-target";
const deps = {} as unknown as ParticipantBindingsDeps;

interface Harness {
  readonly log: string[];
  readonly roadmap: Map<string, { ownerRef: string | null; teamId: string; treeId: string }>;
  readonly bindings: BoundConversation[];
  readonly memberships: Map<string, Record<string, unknown>>;
  readonly port: MembershipDestructionPort;
}

function harness(init: {
  membership?: Record<string, unknown> | undefined;
  roadmap?: Array<[string, { ownerRef: string | null; teamId: string; treeId: string }]>;
  bindings?: BoundConversation[];
  /** uids whose erasure record exists (the fence refuses them). */
  erasingUids?: string[];
  /** Simulates an unreadable fence record: the read itself fails. */
  fenceReadFails?: boolean;
}): Harness {
  const log: string[] = [];
  const erasing = new Set(init.erasingUids ?? []);
  const fenceCheck = (uid: string) => {
    if (init.fenceReadFails === true) throw new Error("fence read failed");
    if (erasing.has(uid)) throw new ErasureWriteRefused();
  };
  const roadmap = new Map(init.roadmap ?? []);
  const bindings = [...(init.bindings ?? [])];
  const memberships = new Map<string, Record<string, unknown>>();
  if (init.membership !== undefined) memberships.set(MEMBERSHIP, init.membership);

  const finalTx: MembershipDestructionFinalTransaction = {
    async assertNoErasureRecord(uid) {
      log.push(`tx.assertNoErasureRecord:${uid}`);
      fenceCheck(uid);
    },
    async getMembership(id) {
      log.push(`tx.getMembership:${id}`);
      return memberships.get(id);
    },
    async roadmapItemIdsOwnedBy(teamId, memberRef, limit) {
      log.push(`tx.roadmapItemIdsOwnedBy:${teamId}`);
      return [...roadmap.entries()]
        .filter(([, item]) => item.teamId === teamId && item.ownerRef === memberRef)
        .map(([id]) => id)
        .slice(0, limit);
    },
    clearRoadmapOwnerRef(itemId) {
      log.push(`tx.clearRoadmapOwnerRef:${itemId}`);
      const item = roadmap.get(itemId);
      if (item !== undefined) roadmap.set(itemId, { ...item, ownerRef: null });
    },
    async boundConversationCount(memberRef, limit) {
      log.push(`tx.boundConversationCount:${memberRef}`);
      return Math.min(bindings.length, limit);
    },
    deleteMembership(id) {
      log.push(`tx.deleteMembership:${id}`);
      memberships.delete(id);
    },
  };

  const port: MembershipDestructionPort = {
    async assertNoErasureRecord(uid) {
      log.push(`port:assertNoErasureRecord:${uid}`);
      fenceCheck(uid);
    },
    async readMembership(id) {
      return memberships.get(id) as never;
    },
    async boundConversations(memberRef, limit) {
      log.push(`boundConversations:${memberRef}`);
      return bindings.slice(0, limit);
    },
    async runFinalTransaction(work) {
      log.push("final:begin");
      const result = await work(finalTx);
      log.push("final:commit");
      return result;
    },
  };
  return { log, roadmap, bindings, memberships, port };
}

beforeEach(() => {
  vi.mocked(eraseParticipantBinding).mockClear();
});

describe("ordinary removal: roadmap owner references", () => {
  it("clears the ownerRef that names the destroyed membership, then deletes the membership in the final transaction", async () => {
    const h = harness({
      membership: { uid: UID, teamId: TEAM, memberRef: REF },
      roadmap: [["item-a", { ownerRef: REF, teamId: TEAM, treeId: "tree-1" }]],
    });

    await expect(destroyMembershipInstance({ port: h.port, bindings: deps }, TARGET, 100)).resolves.toBe("done");

    expect(h.roadmap.get("item-a")).toEqual({ ownerRef: null, teamId: TEAM, treeId: "tree-1" });
    expect(h.memberships.has(MEMBERSHIP)).toBe(false);
  });

  it("leaves unrelated ownerRefs and the roadmap business record intact (only ownerRef changes)", async () => {
    const h = harness({
      membership: { uid: UID, teamId: TEAM, memberRef: REF },
      roadmap: [
        ["item-a", { ownerRef: REF, teamId: TEAM, treeId: "tree-1" }],
        ["item-b", { ownerRef: "ref-other", teamId: TEAM, treeId: "tree-2" }],
        ["item-c", { ownerRef: REF, teamId: "team-other", treeId: "tree-3" }],
      ],
    });

    await destroyMembershipInstance({ port: h.port, bindings: deps }, TARGET, 100);

    expect(h.roadmap.get("item-b")).toEqual({ ownerRef: "ref-other", teamId: TEAM, treeId: "tree-2" });
    expect(h.roadmap.get("item-c")).toEqual({ ownerRef: REF, teamId: "team-other", treeId: "tree-3" });
    expect(h.roadmap.get("item-a")).toMatchObject({ teamId: TEAM, treeId: "tree-1" });
  });
});

describe("ordinary removal: participant bindings", () => {
  it("clears exactly the bindings that name the destroyed membership, through the approved binding cleanup", async () => {
    const h = harness({
      membership: { uid: UID, teamId: TEAM, memberRef: REF },
      bindings: [{ ownerUid: "owner-1", conversationId: "c-1" }],
    });

    // A successful cleanup removes the binding from the bound set, as the real cleanup does.
    vi.mocked(eraseParticipantBinding).mockImplementationOnce(async (_deps, binding) => {
      h.bindings.splice(h.bindings.findIndex((b) => b.conversationId === binding.conversationId), 1);
      return { ok: true, outcome: "cleaned" } as never;
    });

    await destroyMembershipInstance({ port: h.port, bindings: deps }, TARGET, 100);

    expect(eraseParticipantBinding).toHaveBeenCalledWith(deps, { ownerUid: "owner-1", conversationId: "c-1" }, UID);
    expect(h.memberships.has(MEMBERSHIP)).toBe(false);
  });

  it("fails at once with binding_inconsistent when a binding names the memberRef but is not owned by this uid (no retry loop)", async () => {
    vi.mocked(eraseParticipantBinding).mockResolvedValueOnce({ ok: true, outcome: "skipped" } as never);
    const h = harness({
      membership: { uid: UID, teamId: TEAM, memberRef: REF },
      bindings: [{ ownerUid: "owner-1", conversationId: "c-1" }],
    });

    await expect(destroyMembershipInstance({ port: h.port, bindings: deps }, TARGET, 100)).rejects.toMatchObject({
      reason: "binding_inconsistent",
    });
    expect(h.memberships.has(MEMBERSHIP)).toBe(true);
    expect(eraseParticipantBinding).toHaveBeenCalledTimes(1);
  });

  it("does not delete the membership while a binding cleanup has failed, and surfaces the failure", async () => {
    vi.mocked(eraseParticipantBinding).mockResolvedValueOnce({ ok: false, error: "payload_unreadable" } as never);
    const h = harness({
      membership: { uid: UID, teamId: TEAM, memberRef: REF },
      bindings: [{ ownerUid: "owner-1", conversationId: "c-1" }],
    });

    await expect(destroyMembershipInstance({ port: h.port, bindings: deps }, TARGET, 100)).rejects.toBeInstanceOf(
      MembershipDestructionFailure,
    );
    expect(h.memberships.has(MEMBERSHIP)).toBe(true);
    expect(h.log).not.toContain("tx.deleteMembership:" + MEMBERSHIP);
  });
});

describe("ordinary removal: atomicity and ordering", () => {
  it("deletes the membership only in a final transaction that read it and found no roadmap or binding reference", async () => {
    const h = harness({
      membership: { uid: UID, teamId: TEAM, memberRef: REF },
      roadmap: [["item-a", { ownerRef: REF, teamId: TEAM, treeId: "tree-1" }]],
    });

    await destroyMembershipInstance({ port: h.port, bindings: deps }, TARGET, 100);

    const deleteAt = h.log.indexOf("tx.deleteMembership:" + MEMBERSHIP);
    const clearAt = h.log.indexOf("tx.clearRoadmapOwnerRef:item-a");
    expect(clearAt).toBeGreaterThanOrEqual(0);
    expect(deleteAt).toBeGreaterThan(clearAt);
    // The delete transaction re-reads the membership and the owner set before it deletes, in that order.
    const finalBegins = h.log.lastIndexOf("final:begin");
    const finalRead = h.log.indexOf("tx.getMembership:" + MEMBERSHIP, finalBegins);
    const finalOwners = h.log.indexOf("tx.roadmapItemIdsOwnedBy:" + TEAM, finalBegins);
    expect(finalRead).toBeGreaterThan(finalBegins);
    expect(finalOwners).toBeGreaterThan(finalRead);
    expect(h.log.slice(finalBegins).indexOf("tx.deleteMembership:" + MEMBERSHIP)).toBeGreaterThan(
      h.log.slice(finalBegins).indexOf("tx.roadmapItemIdsOwnedBy:" + TEAM),
    );
  });

  it("writes nothing into the roadmap or the bindings except the approved clears, and adds no uid, e-mail or historical marker", async () => {
    const h = harness({
      membership: { uid: UID, teamId: TEAM, memberRef: REF },
      roadmap: [["item-a", { ownerRef: REF, teamId: TEAM, treeId: "tree-1" }]],
    });

    await destroyMembershipInstance({ port: h.port, bindings: deps }, TARGET, 100);

    const roadmapItem = h.roadmap.get("item-a") as unknown as Record<string, unknown>;
    expect(Object.keys(roadmapItem).sort()).toEqual(["ownerRef", "teamId", "treeId"]);
    expect(JSON.stringify(roadmapItem)).not.toMatch(/uid-m|@example|ref-target/);
  });
});

describe("ordinary removal: idempotence and failure modes", () => {
  it("an absent membership is already destroyed: done, with no writes", async () => {
    const h = harness({});

    await expect(destroyMembershipInstance({ port: h.port, bindings: deps }, TARGET, 100)).resolves.toBe("done");

    expect(h.log.some((entry) => entry.startsWith("final:"))).toBe(false);
  });

  it("a legacy membership with no memberRef has no dependent references, and is simply deleted", async () => {
    const h = harness({ membership: { uid: UID, teamId: TEAM } });

    await destroyMembershipInstance({ port: h.port, bindings: deps }, TARGET, 100);

    expect(h.memberships.has(MEMBERSHIP)).toBe(false);
    expect(h.log.some((entry) => entry.startsWith("boundConversations"))).toBe(false);
  });

  it("a malformed memberRef is refused, and nothing is cleared or deleted", async () => {
    const h = harness({ membership: { uid: UID, teamId: TEAM, memberRef: 42 } });

    await expect(destroyMembershipInstance({ port: h.port, bindings: deps }, TARGET, 100)).rejects.toMatchObject({
      reason: "membership_malformed",
    });
    expect(h.memberships.has(MEMBERSHIP)).toBe(true);
  });

  it("a zero write budget is refused as a programming error, not reported as done", async () => {
    const h = harness({ membership: { uid: UID, teamId: TEAM, memberRef: REF } });

    await expect(destroyMembershipInstance({ port: h.port, bindings: deps }, TARGET, 0)).rejects.toBeInstanceOf(
      MembershipDestructionFailure,
    );
  });
});

describe("ordinary removal: target-person erasure fence (BR-4(b), decision 2026-11-02)", () => {
  it("a removed member under erasure is refused, and no membership, roadmap or binding is changed", async () => {
    vi.mocked(eraseParticipantBinding).mockClear();
    const h = harness({
      membership: { uid: UID, teamId: TEAM, memberRef: REF },
      roadmap: [["item-a", { ownerRef: REF, teamId: TEAM, treeId: "tree-1" }]],
      bindings: [{ ownerUid: "owner-1", conversationId: "c-1" }],
      erasingUids: [UID],
    });

    await expect(destroyMembershipInstance({ port: h.port, bindings: deps }, TARGET, 100)).rejects.toBeInstanceOf(
      ErasureWriteRefused,
    );

    expect(h.memberships.has(MEMBERSHIP)).toBe(true);
    expect(h.roadmap.get("item-a")).toEqual({ ownerRef: REF, teamId: TEAM, treeId: "tree-1" });
    expect(eraseParticipantBinding).not.toHaveBeenCalled();
    expect(h.log.some((entry) => entry.startsWith("tx.clear") || entry.startsWith("tx.delete"))).toBe(false);
  });

  it("the fence subject is the target uid: an erasure record for some other uid does not block the removal", async () => {
    const h = harness({
      membership: { uid: UID, teamId: TEAM, memberRef: REF },
      erasingUids: ["admin-acting-uid"],
    });

    await expect(destroyMembershipInstance({ port: h.port, bindings: deps }, TARGET, 100)).resolves.toBe("done");

    expect(h.log).toContain(`port:assertNoErasureRecord:${UID}`);
    expect(h.log.some((entry) => entry.includes("admin-acting-uid"))).toBe(false);
    expect(h.memberships.has(MEMBERSHIP)).toBe(false);
  });

  it("reads the target's fence inside the final transaction, before the membership read and the delete", async () => {
    const h = harness({
      membership: { uid: UID, teamId: TEAM, memberRef: REF },
      roadmap: [["item-a", { ownerRef: REF, teamId: TEAM, treeId: "tree-1" }]],
    });

    await destroyMembershipInstance({ port: h.port, bindings: deps }, TARGET, 100);

    const finalBegins = h.log.lastIndexOf("final:begin");
    const fenceAt = h.log.indexOf(`tx.assertNoErasureRecord:${UID}`, finalBegins);
    expect(fenceAt).toBeGreaterThan(finalBegins);
    expect(h.log.indexOf(`tx.getMembership:${MEMBERSHIP}`, finalBegins)).toBeGreaterThan(fenceAt);
    expect(h.log.indexOf(`tx.deleteMembership:${MEMBERSHIP}`)).toBeGreaterThan(fenceAt);
  });

  it("an unreadable fence fails closed: the removal throws, and nothing is cleared or deleted", async () => {
    const h = harness({
      membership: { uid: UID, teamId: TEAM, memberRef: REF },
      roadmap: [["item-a", { ownerRef: REF, teamId: TEAM, treeId: "tree-1" }]],
      bindings: [{ ownerUid: "owner-1", conversationId: "c-1" }],
      fenceReadFails: true,
    });

    await expect(destroyMembershipInstance({ port: h.port, bindings: deps }, TARGET, 100)).rejects.toThrow("fence read failed");

    expect(h.memberships.has(MEMBERSHIP)).toBe(true);
    expect(h.roadmap.get("item-a")).toEqual({ ownerRef: REF, teamId: TEAM, treeId: "tree-1" });
    expect(eraseParticipantBinding).not.toHaveBeenCalled();
  });

  it("a membership whose stored uid differs from the target is malformed, and nothing is cleared", async () => {
    const h = harness({
      membership: { uid: "someone-else", teamId: TEAM, memberRef: REF },
      roadmap: [["item-a", { ownerRef: REF, teamId: TEAM, treeId: "tree-1" }]],
    });

    await expect(destroyMembershipInstance({ port: h.port, bindings: deps }, TARGET, 100)).rejects.toMatchObject({
      reason: "membership_malformed",
    });
    expect(h.roadmap.get("item-a")).toEqual({ ownerRef: REF, teamId: TEAM, treeId: "tree-1" });
    expect(h.memberships.has(MEMBERSHIP)).toBe(true);
  });

  it("a normal removal without an erasure record still destroys the membership and clears its reference", async () => {
    const h = harness({
      membership: { uid: UID, teamId: TEAM, memberRef: REF },
      roadmap: [["item-a", { ownerRef: REF, teamId: TEAM, treeId: "tree-1" }]],
    });

    await expect(destroyMembershipInstance({ port: h.port, bindings: deps }, TARGET, 100)).resolves.toBe("done");

    expect(h.roadmap.get("item-a")).toEqual({ ownerRef: null, teamId: TEAM, treeId: "tree-1" });
    expect(h.memberships.has(MEMBERSHIP)).toBe(false);
  });
});
