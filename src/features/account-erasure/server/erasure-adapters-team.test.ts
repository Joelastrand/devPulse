import { sealedPlanFixture, openedPlanFixture, stubRoadmapKey } from "../../roadmap/domain/roadmap-item-test-fixtures";
stubRoadmapKey();
import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAdminFirestore } from "./admin-firestore.test-helper";
import { createMembershipStepHandler } from "./membership-erasure";
import { createInvitationsStepHandler } from "./invitations-erasure";
import { createInvitationsPort, createMembershipPort } from "./erasure-adapters-team";
import { invitationEmailIndex } from "../../teams/domain/team-invitation-content-codec";
vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));

// TASK-038: runtime coverage of the production team adapters over the Admin Firestore recording double (structural).
// Real transaction conflict behaviour is the D-EMU gate; it is not claimed here.

const holder = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("../../../lib/firebase/admin", () => ({ getFirestoreDb: () => holder.db }));
vi.mock("server-only", () => ({}));

const UID = "uid-38t";
const OTHER = "uid-other";
const TEAM = "team-38";
const MEMBER_REF = "member-ref-38";
let db: FakeAdminFirestore;

beforeEach(() => {
  db = new FakeAdminFirestore();
  holder.db = db;
});

describe("membership adapter with the membership step", () => {
  it("nulls the roadmap ownerRef before deleting the membership, and leaves other members and teams alone", async () => {
    db.docs.set(`teamMemberships/${UID}__${TEAM}`, { uid: UID, teamId: TEAM, memberRef: MEMBER_REF, role: "teamadmin" });
    db.docs.set(`teamMemberships/${OTHER}__${TEAM}`, { uid: OTHER, teamId: TEAM, memberRef: "other-ref" });
    db.docs.set(`roadmapItems/${TEAM}__tree-1`, sealedPlanFixture(TEAM, "tree-1", { ownerRef: MEMBER_REF, targetNodeId: "n" }));
    db.docs.set(`roadmapItems/other-team__tree-1`, sealedPlanFixture("other-team", "tree-1", { ownerRef: MEMBER_REF }));
    const handler = createMembershipStepHandler({ port: createMembershipPort() });

    let result = "more";
    for (let i = 0; i < 10 && result !== "done"; i += 1) result = await handler.runBatch({ uid: UID, maxWrites: 100 });

    expect(result).toBe("done");
    expect(db.docs.has(`teamMemberships/${UID}__${TEAM}`)).toBe(false);
    expect(openedPlanFixture(db.docs.get(`roadmapItems/${TEAM}__tree-1`))).not.toHaveProperty("ownerRef");
    expect(openedPlanFixture(db.docs.get("roadmapItems/other-team__tree-1"))).toMatchObject({ ownerRef: MEMBER_REF });
    expect(db.docs.has(`teamMemberships/${OTHER}__${TEAM}`)).toBe(true);
    const clearIndex = db.writes.findIndex((w) => w.kind === "set" && w.path === `roadmapItems/${TEAM}__tree-1`);
    const deleteIndex = db.writes.findIndex((w) => w.kind === "delete" && w.path === `teamMemberships/${UID}__${TEAM}`);
    expect(clearIndex).toBeGreaterThanOrEqual(0);
    expect(deleteIndex).toBeGreaterThan(clearIndex);
  });

  it("reads the ownerRef list inside the transaction, not with a plain query", async () => {
    db.docs.set(`teamMemberships/${UID}__${TEAM}`, { uid: UID, teamId: TEAM, memberRef: MEMBER_REF });
    db.docs.set(`roadmapItems/${TEAM}__tree-1`, sealedPlanFixture(TEAM, "tree-1", { ownerRef: MEMBER_REF }));
    const handler = createMembershipStepHandler({ port: createMembershipPort() });

    await handler.runBatch({ uid: UID, maxWrites: 100 });

    expect(db.transactionalReads).toContain(`roadmapItems`);
  });

  it("lists the uid field and a legacy id-prefix document, but never a foreign document that shares the prefix", async () => {
    db.docs.set(`teamMemberships/${UID}__${TEAM}`, { uid: UID, teamId: TEAM });
    db.docs.set(`teamMemberships/${UID}__legacy-team`, { teamId: "legacy-team" }); // legacy: no uid field
    db.docs.set(`teamMemberships/${UID}__foreign`, { uid: OTHER, teamId: "foreign" }); // prefix only
    const ids = await createMembershipPort().membershipIdsOf(UID, 10);
    expect(ids.sort()).toEqual([`${UID}__legacy-team`, `${UID}__${TEAM}`]);
  });
});

describe("invitations adapter with the invitations step", () => {
  it("matches an invitation by its stored email, by resolvedUid, and by a document-id suffix whose email field differs", async () => {
    const email = "erased@example.com";
    db.docs.set(`teamInvitations/${TEAM}__${invitationEmailIndex(email)}`, { emailIndex: invitationEmailIndex(email), status: "pending", invitedBy: OTHER });
    db.docs.set(`teamInvitations/${TEAM}__${invitationEmailIndex(email)}-b`, { emailIndex: invitationEmailIndex("x@example.com"), status: "accepted", resolvedUid: UID });
    db.docs.set(`teamInvitations/other-team__${invitationEmailIndex(email)}`, { teamId: "other-team", status: "pending" }); // no email field, exact id
    db.docs.set(`teamInvitations/${TEAM}__${invitationEmailIndex("unrelated@example.com")}`, { emailIndex: invitationEmailIndex("unrelated@example.com"), invitedBy: OTHER });
    const ids = await createInvitationsPort().invitationIdsFor(email, UID, 10);
    // Matched by stored email, by resolvedUid, and by the document-id suffix. The unrelated invitation is not matched.
    expect(ids.sort()).toEqual([`${TEAM}__${invitationEmailIndex(email)}`, `${TEAM}__${invitationEmailIndex(email)}-b`, `other-team__${invitationEmailIndex(email)}`].sort());
  });

  it("clears only the approved reference fields and deletes only the matched records", async () => {
    db.docs.set(`teamAccessRequests/${UID}__${TEAM}`, { uid: UID, teamId: TEAM, status: "pending" });
    db.docs.set(`teamAccessRequests/${OTHER}__${TEAM}`, { uid: OTHER, teamId: TEAM, resolvedBy: UID, status: "approved" });
    db.docs.set(`teamInvitations/${TEAM}__${invitationEmailIndex("x@example.com")}`, { emailIndex: invitationEmailIndex("x@example.com"), invitedBy: UID, status: "accepted" });
    const port = createInvitationsPort();

    const ids = await port.accessRequestIdsFor(UID, 10);
    expect(ids).toEqual([`${UID}__${TEAM}`]);
    expect(await port.accessRequestIdsResolvedBy(UID, 10)).toEqual([`${OTHER}__${TEAM}`]);
    expect(await port.invitationIdsInvitedBy(UID, 10)).toEqual([`${TEAM}__${invitationEmailIndex("x@example.com")}`]);

    await port.runTransaction(async (tx) => {
      tx.clearAccessRequestResolvedBy(`${OTHER}__${TEAM}`);
      tx.clearInvitationInvitedBy(`${TEAM}__${invitationEmailIndex("x@example.com")}`);
      tx.deleteAccessRequest(`${UID}__${TEAM}`);
    });

    expect(db.docs.get(`teamAccessRequests/${OTHER}__${TEAM}`)).toEqual({
      uid: OTHER,
      teamId: TEAM,
      resolvedBy: null,
      status: "approved",
    });
    expect(db.docs.get(`teamInvitations/${TEAM}__${invitationEmailIndex("x@example.com")}`)).toMatchObject({ invitedBy: null, status: "accepted" });
    expect(db.docs.has(`teamAccessRequests/${UID}__${TEAM}`)).toBe(false);
  });

  it("the invitations step does not delete an unrelated invitation (end to end over the production adapter)", async () => {
    const email = "erased@example.com";
    db.docs.set(`teamInvitations/${TEAM}__${invitationEmailIndex(email)}`, { emailIndex: invitationEmailIndex(email), status: "pending" });
    db.docs.set(`teamInvitations/${TEAM}__${invitationEmailIndex("keep@example.com")}`, { emailIndex: invitationEmailIndex("keep@example.com"), status: "pending" });
    const handler = createInvitationsStepHandler({
      port: createInvitationsPort(),
      normalizedEmailOf: async () => email,
    });

    let result = "more";
    for (let i = 0; i < 10 && result !== "done"; i += 1) result = await handler.runBatch({ uid: UID, maxWrites: 100 });

    expect(result).toBe("done");
    expect(db.docs.has(`teamInvitations/${TEAM}__${invitationEmailIndex(email)}`)).toBe(false);
    expect(db.docs.has(`teamInvitations/${TEAM}__${invitationEmailIndex("keep@example.com")}`)).toBe(true);
  });
});
