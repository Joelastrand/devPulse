import { describe, expect, it, vi } from "vitest";
import { verifiedSubject } from "../../../app/api/me/conversations/_auth";
import type { VerifiedIdentity } from "../auth/server/verify-identity";
import { isAppAdmin } from "../teams/domain/app-admin";
import { OWNER_DTO_KEYS, PARTICIPANT_DTO_KEYS, PENDING_DTO_KEYS } from "./domain/dto-keys";
import type { SharedGoalSnapshot } from "./domain/shared-goal-snapshot";
import type { SkillTreeNameReader } from "./server/area-names";
import { changeParticipant } from "./server/change-participant";
import { completeConversation } from "./server/complete-conversation";
import { deleteConversation } from "./server/delete-conversation";
import { createFakeContentCodec, type FakeContentCodec } from "./server/fake-content-codec";
import { createFakeConversationStore, type FakeConversationStore } from "./server/fake-conversation-store";
import { createFakeTeamEligibilityReader, type FakeTeamEligibilityState } from "./server/fake-team-eligibility";
import type { ParticipantRefReader } from "./server/member-ref-binding";
import { NOW, OWNER_UID, PARTICIPANT_MEMBER_REF, PARTICIPANT_UID, TEAM_ID, seedOwnerConversation } from "./server/owner-read-test-support";
import { createProductionParticipantStateResolver } from "./server/owner-participant-state";
import { readConversationForCaller, type ReadConversationForCallerDeps } from "./server/read-conversation-for-caller";
import { acceptInvitation, leaveParticipation } from "./server/respond-to-participation";
import { updateOwnerSections } from "./server/update-owner-sections";
import { writeParticipantNotes } from "./server/write-participant-notes";

/**
 * Cross-cutting authorization and privacy regression (SPEC "Test boundaries" authorization matrix, BR-14, BR-15, BR-17,
 * BR-18, BR-20, BR-21, BR-27, BR-30, BR-35, D2-SI-1, D2-SI-2, D2-SI-3, D2-SI-6, D2-SI-8 to D2-SI-10; TASK-034).
 *
 * Every row of the matrix is one caller state. Every operation runs on a fresh fixture, so no outcome depends on an
 * earlier write. Expected outcomes are written from the SPEC rules named above, not copied from the code. The fixtures are
 * the in-memory fakes of the server operations (no Firebase, no emulator). The unauthenticated row exercises the shared
 * subject helper that every conversation route uses. Each route also has its own 401 test in its `route.test.ts`.
 *
 * Admin status is not an input to any operation: each takes the caller's uid only. The two admin rows carry a verified
 * identity that the production `isAppAdmin` predicate accepts (the allow-list is injected, no environment change), and the
 * tests check that the admin status changes no outcome. The unit tests of each operation own the finer cases (stale index,
 * key outage, malformed payload, races).
 */

// Synthetic fixtures only (invariant 15). Every uid, title, note and reference is fictional.
const CONVERSATION_ID = "conv-1";
const LEAD_UID = "lead-1";
const LEAD_ADMIN_UID = "lead-admin-1";
const MEMBER_UID = "member-1";
const ADMIN_UID = "admin-1";
const OUTSIDER_UID = "outsider-1";
const OWNER_MEMBER_REF = "zyxwvtsrqpnmkjhgfedcba9876";
const LEAD_REF = "2345678abcdefghjkmnpqrstvw";
const LEAD_ADMIN_REF = "abcdefghjkmnpqrstvwxyz0123";
const MEMBER_REF = "9876543210zyxwvtsrqponmlkj";
const REJOINED_REF = "abcdefghjkmnpqrstvwxyz0123";
const CAPTURED_AT = new Date("2026-10-10T08:00:00.000Z");
const CONTENT = {
  title: "Synthetic title",
  ownerNotes: "Synthetic owner note",
  nextSteps: ["Synthetic next step"],
  participantNotes: "Synthetic participant note",
  plannedFor: "2026-11-01",
};
const SHARED_GOAL: SharedGoalSnapshot = { goalTitle: "Synthetic goal", treeId: "tree-a", targetDate: null, status: "active", capturedAt: CAPTURED_AT };

const verifyIdTokenMock = vi.hoisted(() => vi.fn());
vi.mock("../auth/server/verify-identity", () => ({ verifyIdToken: verifyIdTokenMock }));

const NOT_FOUND = "conversation_not_found";
const OK = "ok";

type RowId =
  | "owner"
  | "pending"
  | "accepted"
  | "accepted-ineligible"
  | "lead"
  | "member"
  | "lead-and-admin"
  | "non-member-admin"
  | "former-member"
  | "rejoined-member"
  | "unrelated";

type OpId = "detail" | "notes" | "accept" | "leave" | "complete" | "sections" | "removeParticipant" | "delete";

const OPS: readonly OpId[] = ["detail", "notes", "accept", "leave", "complete", "sections", "removeParticipant", "delete"];

/** Synthetic e-mails on the admin allow-list. Only the two admin rows hold one, and the predicate needs it verified. */
const ADMIN_EMAIL = "synthetic-admin@example.test";
const LEAD_ADMIN_EMAIL = "synthetic-lead-admin@example.test";
const ADMIN_ALLOW_LIST: readonly string[] = [ADMIN_EMAIL, LEAD_ADMIN_EMAIL];

function verified(uid: string): VerifiedIdentity {
  return { uid, email: `${uid}@example.test`, emailVerified: true };
}

/**
 * The verified identity of each row. The operations receive only its uid. Admin status is a property of the identity, read
 * by the production `isAppAdmin` predicate, so the admin rows differ from the others only by that predicate.
 */
const IDENTITY: Record<RowId, VerifiedIdentity> = {
  owner: verified(OWNER_UID),
  pending: verified(PARTICIPANT_UID),
  accepted: verified(PARTICIPANT_UID),
  "accepted-ineligible": verified(PARTICIPANT_UID),
  lead: verified(LEAD_UID),
  member: verified(MEMBER_UID),
  "lead-and-admin": { uid: LEAD_ADMIN_UID, email: LEAD_ADMIN_EMAIL, emailVerified: true },
  "non-member-admin": { uid: ADMIN_UID, email: ADMIN_EMAIL, emailVerified: true },
  "former-member": verified(PARTICIPANT_UID),
  "rejoined-member": verified(PARTICIPANT_UID),
  unrelated: verified(OUTSIDER_UID),
};

const ADMIN_ROWS: ReadonlySet<RowId> = new Set<RowId>(["lead-and-admin", "non-member-admin"]);

/** Rows whose caller holds a participant index entry (BR-15, BR-17). */
const HAS_INDEX: ReadonlySet<RowId> = new Set<RowId>(["pending", "accepted", "accepted-ineligible", "former-member", "rejoined-member"]);

/** The expected outcome of every operation for every row, from BR-14, BR-15, BR-17, BR-18, BR-20, BR-21, BR-27 and BR-35. */
const MATRIX: Record<RowId, Record<OpId, string>> = {
  owner: { detail: "owner", notes: NOT_FOUND, accept: NOT_FOUND, leave: NOT_FOUND, complete: OK, sections: OK, removeParticipant: OK, delete: OK },
  pending: {
    detail: "pending",
    notes: NOT_FOUND,
    accept: OK,
    leave: OK,
    complete: NOT_FOUND,
    sections: NOT_FOUND,
    removeParticipant: NOT_FOUND,
    delete: NOT_FOUND,
  },
  accepted: {
    detail: "participant",
    notes: OK,
    accept: NOT_FOUND,
    leave: OK,
    complete: NOT_FOUND,
    sections: NOT_FOUND,
    removeParticipant: NOT_FOUND,
    delete: NOT_FOUND,
  },
  "accepted-ineligible": {
    detail: NOT_FOUND,
    notes: NOT_FOUND,
    accept: NOT_FOUND,
    leave: OK,
    complete: NOT_FOUND,
    sections: NOT_FOUND,
    removeParticipant: NOT_FOUND,
    delete: NOT_FOUND,
  },
  lead: allDenied(),
  member: allDenied(),
  "lead-and-admin": allDenied(),
  "non-member-admin": allDenied(),
  "former-member": {
    detail: NOT_FOUND,
    notes: NOT_FOUND,
    accept: NOT_FOUND,
    leave: OK,
    complete: NOT_FOUND,
    sections: NOT_FOUND,
    removeParticipant: NOT_FOUND,
    delete: NOT_FOUND,
  },
  "rejoined-member": {
    detail: NOT_FOUND,
    notes: NOT_FOUND,
    accept: NOT_FOUND,
    leave: OK,
    complete: NOT_FOUND,
    sections: NOT_FOUND,
    removeParticipant: NOT_FOUND,
    delete: NOT_FOUND,
  },
  unrelated: allDenied(),
};

function allDenied(): Record<OpId, string> {
  return {
    detail: NOT_FOUND,
    notes: NOT_FOUND,
    accept: NOT_FOUND,
    leave: NOT_FOUND,
    complete: NOT_FOUND,
    sections: NOT_FOUND,
    removeParticipant: NOT_FOUND,
    delete: NOT_FOUND,
  };
}

/** One team membership document in the shape the membership check reads (TASK-006), with optional extra fields. */
function membership(uid: string, memberRef: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { uid, teamId: TEAM_ID, createdAt: new Date(0), memberRef, ...extra };
}

/** The team memberships of one row. The owner is always an active member, so owner operations are not refused for that reason. */
function memberships(row: RowId): Record<string, unknown> {
  const out: Record<string, unknown> = { [`${OWNER_UID}__${TEAM_ID}`]: membership(OWNER_UID, OWNER_MEMBER_REF) };
  if (row !== "former-member") {
    out[`${PARTICIPANT_UID}__${TEAM_ID}`] = membership(PARTICIPANT_UID, row === "rejoined-member" ? REJOINED_REF : PARTICIPANT_MEMBER_REF);
  }
  if (row === "lead") out[`${LEAD_UID}__${TEAM_ID}`] = membership(LEAD_UID, LEAD_REF, { role: "lead" });
  if (row === "lead-and-admin") out[`${LEAD_ADMIN_UID}__${TEAM_ID}`] = membership(LEAD_ADMIN_UID, LEAD_ADMIN_REF, { role: "lead" });
  if (row === "member") out[`${MEMBER_UID}__${TEAM_ID}`] = membership(MEMBER_UID, MEMBER_REF);
  return out;
}

const clock = () => new Date(NOW.getTime() + 60_000);

interface World {
  store: FakeConversationStore;
  codec: FakeContentCodec;
  teamState: FakeTeamEligibilityState;
  refReader: ParticipantRefReader;
  readDeps: ReadConversationForCallerDeps;
}

const areaNameReader: SkillTreeNameReader = {
  getSkillTree: async (treeId) =>
    treeId === "tree-a"
      ? { name: "Synthetic area", nodes: [{ nodeId: "node-0", label: "Start", order: 0 }], createdAt: new Date(0), createdBy: "admin-1" }
      : undefined,
};

/** The fixture for one row: the owner document with its one participant, the index when the row has one, and the team. */
async function world(row: RowId, options: { sharedGoals?: SharedGoalSnapshot[] } = {}): Promise<World> {
  const teamState: FakeTeamEligibilityState = {
    teamStatus: { [TEAM_ID]: row === "accepted-ineligible" ? "disabled" : "active" },
    memberships: memberships(row),
  };
  // The store reads the team and membership documents inside its transactions (accept, notes, removal), so it gets the
  // same live state as the read seam. Tests that change a membership change it in this one object.
  const store = createFakeConversationStore({ teams: teamState });
  const codec = createFakeContentCodec();
  const teamReader = createFakeTeamEligibilityReader(teamState);
  const getNames = async (uids: readonly string[]) => new Map(uids.filter((uid) => uid === OWNER_UID).map((uid) => [uid, "Synthetic owner"]));
  const teamNameReader = { getTeamName: async () => "Synthetic team" as unknown };

  await seedOwnerConversation(store, codec, {
    conversationId: CONVERSATION_ID,
    ...CONTENT,
    sharedGoals: options.sharedGoals ?? [],
    participant: { uid: PARTICIPANT_UID, state: row === "pending" ? "pending" : "accepted" },
  });
  if (HAS_INDEX.has(row)) {
    await store.runTransaction(async (tx) => {
      tx.setParticipation(PARTICIPANT_UID, CONVERSATION_ID, { ownerUid: OWNER_UID, invitedAt: new Date(NOW.getTime() + 1000) });
    });
  }

  const refReader: ParticipantRefReader = {
    ...teamReader,
    async listMemberships(_teamId, limit) {
      return Object.values(teamState.memberships).slice(0, limit);
    },
  };
  const readDeps: ReadConversationForCallerDeps = {
    store,
    owner: {
      store,
      codec,
      teamReader,
      resolveParticipantState: createProductionParticipantStateResolver(store),
      areaNameReader,
      getNames,
    },
    participant: { store, codec, teamReader, teamNameReader, areaNameReader, getNames },
    pending: { store, teamReader, teamNameReader, getNames },
  };
  return { store, codec, teamState, refReader, readDeps };
}

type Outcome = { ok: true } | { ok: false; error: string };

const outcome = (result: Outcome): string => (result.ok ? OK : result.error);
const viewOutcome = (result: { ok: true; view: { kind: string } } | { ok: false; error: string }): string =>
  result.ok ? result.view.kind : result.error;

/** Runs one operation as the row's caller on a fresh fixture, and returns its outcome code or view kind. */
async function runOp(row: RowId, op: OpId, w?: World): Promise<string> {
  const fixture = w ?? (await world(row));
  const caller = IDENTITY[row].uid;
  switch (op) {
    case "detail":
      return viewOutcome(await readConversationForCaller(caller, CONVERSATION_ID, fixture.readDeps));
    case "notes":
      return outcome(await writeParticipantNotes(caller, CONVERSATION_ID, "Synthetic new note", { store: fixture.store, codec: fixture.codec, clock }));
    case "accept":
      return outcome(await acceptInvitation(caller, CONVERSATION_ID, { store: fixture.store, codec: fixture.codec, clock }));
    case "leave":
      return outcome(await leaveParticipation(caller, CONVERSATION_ID, { store: fixture.store, codec: fixture.codec, clock }));
    case "complete":
      return outcome(await completeConversation(caller, CONVERSATION_ID, { store: fixture.store, clock }));
    case "sections":
      return outcome(
        await updateOwnerSections(caller, CONVERSATION_ID, { title: "Synthetic new title" }, { store: fixture.store, codec: fixture.codec, clock }),
      );
    case "removeParticipant":
      return outcome(
        await changeParticipant(
          caller,
          CONVERSATION_ID,
          { participantMemberRef: null },
          { store: fixture.store, codec: fixture.codec, refReader: fixture.refReader, clock },
        ),
      );
    case "delete":
      return outcome(await deleteConversation(caller, CONVERSATION_ID, { store: fixture.store }));
  }
}

describe("authorization matrix: every row, every operation (SPEC authorization matrix; D2-SI-2, D2-SI-10)", () => {
  const rows = Object.keys(MATRIX) as RowId[];
  for (const row of rows) {
    it(`${row}: the exact outcome of each operation`, async () => {
      const outcomes: Record<string, string> = {};
      for (const op of OPS) outcomes[op] = await runOp(row, op);
      expect(outcomes).toEqual(MATRIX[row]);
    });
  }
});

describe("app-admin rows are genuine app admins under production semantics (BR-5, BR-6, D2-SI-2)", () => {
  const deps = { allowList: ADMIN_ALLOW_LIST };

  it("the non-member-admin and lead-and-admin identities pass isAppAdmin, with the allow-list injected", () => {
    expect(isAppAdmin(IDENTITY["non-member-admin"], deps)).toBe(true);
    expect(isAppAdmin(IDENTITY["lead-and-admin"], deps)).toBe(true);
  });

  it("no other row's identity is an app admin, so the admin rows differ from the rest only by admin status", () => {
    for (const row of Object.keys(MATRIX) as RowId[]) {
      expect(isAppAdmin(IDENTITY[row], deps), row).toBe(ADMIN_ROWS.has(row));
    }
  });

  it("an allow-listed e-mail that is not verified is not app-admin status", () => {
    expect(isAppAdmin({ ...IDENTITY["non-member-admin"], emailVerified: false }, deps)).toBe(false);
  });

  it("non-member-admin holds no membership in any team, so the row is a true non-member", async () => {
    const w = await world("non-member-admin");
    expect(Object.keys(w.teamState.memberships).some((key) => key.startsWith(`${ADMIN_UID}__`))).toBe(false);
  });

  it("lead-and-admin is an active lead: a lead membership with role lead on an active team", async () => {
    const w = await world("lead-and-admin");
    expect(w.teamState.teamStatus[TEAM_ID]).toBe("active");
    expect(w.teamState.memberships[`${LEAD_ADMIN_UID}__${TEAM_ID}`]).toMatchObject({ uid: LEAD_ADMIN_UID, role: "lead" });
  });

  it("app-admin status alone grants nothing: a non-member admin gets the unrelated user's outcome for every operation", async () => {
    for (const op of OPS) {
      expect(await runOp("non-member-admin", op), op).toBe(await runOp("unrelated", op));
    }
  });

  it("a lead who is also an app admin gets the lead's outcome for every operation", async () => {
    for (const op of OPS) {
      expect(await runOp("lead-and-admin", op), op).toBe(await runOp("lead", op));
    }
  });
});

describe("hidden content and shared content (D2-SI-3, D2-SI-6, D2-SI-8, D2-SI-9, BR-18, BR-30)", () => {
  it("after acceptance, the owner and the participant each receive every section with the exact allow-list keys", async () => {
    const w = await world("pending", { sharedGoals: [SHARED_GOAL] });
    expect(outcome(await acceptInvitation(PARTICIPANT_UID, CONVERSATION_ID, { store: w.store, codec: w.codec, clock }))).toBe(OK);

    const owner = await readConversationForCaller(OWNER_UID, CONVERSATION_ID, w.readDeps);
    const participant = await readConversationForCaller(PARTICIPANT_UID, CONVERSATION_ID, w.readDeps);

    expect(owner.ok && owner.view.kind === "owner" ? Object.keys(owner.view.dto).sort() : []).toEqual([...OWNER_DTO_KEYS].sort());
    expect(participant.ok && participant.view.kind === "participant" ? Object.keys(participant.view.dto).sort() : []).toEqual(
      [...PARTICIPANT_DTO_KEYS].sort(),
    );
    for (const view of [owner, participant]) {
      if (!view.ok || (view.view.kind !== "owner" && view.view.kind !== "participant")) throw new Error("expected a content view");
      expect(view.view.dto.ownerNotes).toBe(CONTENT.ownerNotes);
      expect(view.view.dto.nextSteps).toEqual(CONTENT.nextSteps);
      expect(view.view.dto.sharedGoals).toHaveLength(1);
    }
  });

  it("a pending invitee sees only the pending keys, before and after the invitation is accepted", async () => {
    const w = await world("pending");
    const pending = await readConversationForCaller(PARTICIPANT_UID, CONVERSATION_ID, w.readDeps);
    expect(pending.ok && pending.view.kind === "pending" ? Object.keys(pending.view.dto).sort() : []).toEqual([...PENDING_DTO_KEYS].sort());
  });

  it("an ineligible participant's access ends, but the owner still sees the participant's notes with state unavailable (BR-18)", async () => {
    const w = await world("accepted-ineligible");

    expect(await runOp("accepted-ineligible", "detail", w)).toBe(NOT_FOUND);
    const owner = await readConversationForCaller(OWNER_UID, CONVERSATION_ID, w.readDeps);
    expect(owner.ok && owner.view.kind === "owner" ? owner.view.dto.participant.state : null).toBe("unavailable");
    expect(owner.ok && owner.view.kind === "owner" ? owner.view.dto.participantNotes : null).toBe(CONTENT.participantNotes);
    expect(owner.ok && owner.view.kind === "owner" ? owner.view.dto.ownerNotes : null).toBe(CONTENT.ownerNotes);
  });

  it("after completion the owner and an eligible accepted participant keep the content, and the participant keeps access (D2-SI-9, BR-30)", async () => {
    const w = await world("accepted", { sharedGoals: [SHARED_GOAL] });
    expect(outcome(await completeConversation(OWNER_UID, CONVERSATION_ID, { store: w.store, clock }))).toBe(OK);

    for (const caller of [OWNER_UID, PARTICIPANT_UID]) {
      const view = await readConversationForCaller(caller, CONVERSATION_ID, w.readDeps);
      if (!view.ok || (view.view.kind !== "owner" && view.view.kind !== "participant")) throw new Error(`expected a content view for ${caller}`);
      expect(view.view.dto.status).toBe("completed");
      expect(view.view.dto.ownerNotes).toBe(CONTENT.ownerNotes);
      expect(view.view.dto.nextSteps).toEqual(CONTENT.nextSteps);
      expect(view.view.dto.sharedGoals).toHaveLength(1);
    }
  });
});

describe("roles, admin status, e-mail and display name never grant access (D2-SI-2)", () => {
  it("a member whose membership carries lead, admin, e-mail and display-name fields gets no detail, note, accept or leave", async () => {
    const w = await world("member");
    w.teamState.memberships[`${MEMBER_UID}__${TEAM_ID}`] = membership(MEMBER_UID, MEMBER_REF, {
      role: "admin",
      lead: true,
      isAppAdmin: true,
      email: "synthetic-member@example.test",
      displayName: "Synthetic admin",
    });

    for (const op of ["detail", "notes", "accept", "leave"] as const) {
      expect(await runOp("member", op, w), op).toBe(NOT_FOUND);
    }
  });

  it("admin fields on a participant's own membership change nothing: the memberRef binding alone decides access", async () => {
    const w = await world("accepted");
    // The admin fields are added to the participant's own membership. The binding (memberRef) is unchanged, so the
    // participant still reads through the authoritative predicate, and no admin field adds or removes anything.
    w.teamState.memberships[`${PARTICIPANT_UID}__${TEAM_ID}`] = membership(PARTICIPANT_UID, PARTICIPANT_MEMBER_REF, {
      role: "admin",
      isAppAdmin: true,
    });
    expect(await runOp("accepted", "detail", w)).toBe("participant");

    // A same-uid membership with a different memberRef is the rejoin case, and grants nothing despite its admin fields.
    w.teamState.memberships[`${PARTICIPANT_UID}__${TEAM_ID}`] = membership(PARTICIPANT_UID, REJOINED_REF, {
      role: "admin",
      isAppAdmin: true,
    });
    expect(await runOp("accepted", "detail", w)).toBe(NOT_FOUND);
  });
});

describe("an unauthenticated request has no subject (D2-SI-1)", () => {
  it("a missing or unverifiable bearer token yields no subject, and a verified token yields only the token's uid", async () => {
    verifyIdTokenMock.mockResolvedValue({ ok: false });
    expect(await verifiedSubject(new Request("https://example.test/"))).toBeNull();
    expect(await verifiedSubject(new Request("https://example.test/", { headers: { authorization: "Bearer bad.token" } }))).toBeNull();

    verifyIdTokenMock.mockResolvedValue({ ok: true, identity: { uid: PARTICIPANT_UID } });
    expect(await verifiedSubject(new Request("https://example.test/", { headers: { authorization: "Bearer good.token" } }))).toBe(
      PARTICIPANT_UID,
    );
  });
});
