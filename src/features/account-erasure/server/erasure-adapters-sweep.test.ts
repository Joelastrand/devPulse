import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAdminFirestore } from "./admin-firestore.test-helper";
import { createSweepCounter, sweepCounterKeys, sweepKeyOf } from "./erasure-adapters-sweep";
import { inventorySweeps } from "./inventory";
import type { InventorySweep } from "./inventory";

// TASK-038 / BR-5: runtime coverage of the production residual counter over the Admin Firestore recording double.

const holder = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("../../../lib/firebase/admin", () => ({ getFirestoreDb: () => holder.db }));
vi.mock("server-only", () => ({}));

const UID = "uid-38s";
const OTHER = "uid-other";
const EMAIL = "erased@example.com";
let db: FakeAdminFirestore;

beforeEach(() => {
  db = new FakeAdminFirestore();
  holder.db = db;
});

function sweep(collection: string, query: InventorySweep["query"]): InventorySweep {
  return { rowId: "test", collection, query };
}

const binding = { uid: UID, normalizedEmail: EMAIL };

describe("production residual counter", () => {
  it("counts field-equality matches for the uid and the normalized e-mail, not other values", async () => {
    db.docs.set("surveys/s1", { createdBy: UID });
    db.docs.set("surveys/s2", { createdBy: OTHER });
    const counter = createSweepCounter();

    expect(await counter.countMatches(sweep("surveys", { kind: "fieldEquals", field: "createdBy", value: "uid" }), binding)).toBe(1);
    expect(await counter.countMatches(sweep("surveys", { kind: "fieldEquals", field: "createdBy", value: "uid" }), { uid: OTHER })).toBe(1);
  });

  it("fails closed when an e-mail-bound query has no normalized e-mail (no silent zero)", async () => {
    const counter = createSweepCounter();
    await expect(
      counter.countMatches(sweep("teamInvitations", { kind: "fieldEquals", field: "email", value: "email" }), { uid: UID }),
    ).rejects.toThrow("normalized e-mail is required");
    expect(db.reads).toEqual([]);
  });

  it("counts document-id equality and the uid__ prefix, and the e-mail document-id suffix", async () => {
    db.docs.set(`skillProfiles/${UID}`, {});
    db.docs.set(`teamMemberships/${UID}__t1`, { uid: UID });
    db.docs.set(`teamMemberships/${UID}__t2`, {});
    db.docs.set(`teamMemberships/${OTHER}__t1`, {});
    db.docs.set(`teamInvitations/t1__${EMAIL}`, { teamId: "t1", status: "pending" });
    db.docs.set(`teamInvitations/t2__other@example.com`, {});
    const counter = createSweepCounter();

    expect(await counter.countMatches(sweep("skillProfiles", { kind: "docIdEquals", value: "uid" }), binding)).toBe(1);
    expect(await counter.countMatches(sweep("teamMemberships", { kind: "docIdStartsWith", value: "uid" }), binding)).toBe(2);
    expect(await counter.countMatches(sweep("teamInvitations", { kind: "docIdEndsWith", value: "normalizedEmail" }), binding)).toBe(1);
  });

  it("counts a subtree under the owner and a collection-group match on participantUid", async () => {
    db.docs.set(`userDevelopment/${UID}/goals/g1`, {});
    db.docs.set(`userDevelopment/${UID}/goals/g2`, {});
    db.docs.set(`userDevelopment/${OTHER}/goals/g3`, {});
    db.docs.set(`userDevelopment/${OTHER}/conversations/c1`, { participantUid: UID });
    db.docs.set(`userDevelopment/${OTHER}/conversations/c2`, { participantUid: OTHER });
    const counter = createSweepCounter();

    expect(await counter.countMatches(sweep("userDevelopment/{uid}/goals", { kind: "subtree", path: "userDevelopment/{uid}/goals" }), binding)).toBe(2);
    expect(
      await counter.countMatches(sweep("conversations", { kind: "collectionGroupFieldEquals", field: "participantUid", value: "uid" }), binding),
    ).toBe(1);
  });

  it("counts a roadmap ownerRef that still names a membership of the uid, and drops to zero once nulled", async () => {
    db.docs.set(`teamMemberships/${UID}__t1`, { uid: UID, teamId: "t1", memberRef: "ref-1" });
    db.docs.set(`teamMemberships/${UID}__legacy`, { teamId: "legacy", memberRef: "ref-legacy" }); // no uid field
    db.docs.set("roadmapItems/t1__tree", { teamId: "t1", ownerRef: "ref-1" });
    db.docs.set("roadmapItems/legacy__tree", { teamId: "legacy", ownerRef: "ref-legacy" });
    const counter = createSweepCounter();
    const perMembership = sweep("roadmapItems", { kind: "perMembership", field: "ownerRef" });

    expect(await counter.countMatches(perMembership, binding)).toBe(2);

    db.docs.set("roadmapItems/t1__tree", { teamId: "t1", ownerRef: null });
    db.docs.set("roadmapItems/legacy__tree", { teamId: "legacy", ownerRef: null });
    expect(await counter.countMatches(perMembership, binding)).toBe(0);
  });

  it("returns only a number, with no identifiers", async () => {
    db.docs.set(`skillProfiles/${UID}`, {});
    const result = await createSweepCounter().countMatches(sweep("skillProfiles", { kind: "docIdEquals", value: "uid" }), binding);
    expect(typeof result).toBe("number");
  });
});

describe("sweep counter completeness (fail closed on a missing counter)", () => {
  it("has a counter for every inventory sweep the registry declares", () => {
    const missing = inventorySweeps()
      .map(sweepKeyOf)
      .filter((key, index, all) => all.indexOf(key) === index)
      .filter((key) => !sweepCounterKeys().includes(key));
    expect(missing).toEqual([]);
  });

  it("throws for a sweep that has no counter, instead of reporting zero", async () => {
    const unknown = { rowId: "x", collection: "notAnInventoryCollection", query: { kind: "fieldEquals", field: "uid", value: "uid" } } as const;
    await expect(createSweepCounter().countMatches(unknown as never, { uid: UID })).rejects.toThrow("no counter");
  });
});

describe("residual counter: an invitation whose id only coincides with the erased address is not a residual", () => {
  it("does not count a suffix match whose stored e-mail is another person's (TASK-038 finding 2)", async () => {
    db.docs.set(`teamInvitations/t9__a__${EMAIL}`, { teamId: "t9", email: `a__${EMAIL.replace("erased", "stranger")}`, status: "pending" });
    const count = await createSweepCounter().countMatches(
      sweep("teamInvitations", { kind: "docIdEndsWith", value: "normalizedEmail" }),
      binding,
    );
    expect(count).toBe(0);
  });
});
