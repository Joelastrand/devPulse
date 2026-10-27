import { describe, expect, it } from "vitest";
import { membershipDocId } from "../../teams/domain/team-membership";
import type { RawConversationData } from "./conversation-store-types";
import { createFakeContentCodec, type FakeContentCodec } from "./fake-content-codec";
import { createFakeConversationStore, type FakeConversationStore } from "./fake-conversation-store";
import { OTHER_OWNER_UID, OWNER_UID, TEAM_ID, seedOwnerConversation } from "./owner-read-test-support";
import { readSelectableMembers, type SelectableMembersDeps, type SelectableMembersReader, type SelectableRow } from "./read-selectable-members";

/*
 * Owner selector read (SPEC Amendment 2026-10-19, TASK-029 review finding I-1). Every uid, team id, name and ref here is
 * synthetic. The I-1 cases are first: an app admin, or an ordinary member of a disabled team, must never obtain a roster.
 */

const CONVERSATION_ID = "conv-1";
const DISABLED = "disabled";

/** A valid 26-character member reference for member `n`. Synthetic and unique per `n`. */
function ref(n: number): string {
  return `r${String(n).padStart(25, "0")}`;
}

/** A well-formed membership row for `uid` in the test team, with a join time that orders by `n`. */
function memberRow(uid: string, n: number, extra: Record<string, unknown> = {}): SelectableRow {
  return {
    id: membershipDocId(uid, TEAM_ID),
    data: { uid, teamId: TEAM_ID, createdAt: new Date(1_000_000 * n), memberRef: ref(n), ...extra },
  };
}

interface Fixture {
  teamStatus?: unknown;
  rows?: SelectableRow[];
  failTeamRead?: boolean;
  failMembershipRead?: boolean;
  failListRead?: boolean;
}

/** In-memory selector reader. It answers the three raw reads and records each call so tests can assert the bounds. */
function fakeReader(fixture: Fixture) {
  const calls = { teamReads: 0, membershipReads: 0, listCalls: [] as Array<{ teamId: string; limit: number }> };
  const rows = fixture.rows ?? [];
  const reader: SelectableMembersReader = {
    async getTeamStatus() {
      calls.teamReads += 1;
      if (fixture.failTeamRead) throw new Error("simulated team read failure");
      return fixture.teamStatus ?? "active";
    },
    async getMembership(uid, teamId) {
      calls.membershipReads += 1;
      if (fixture.failMembershipRead) throw new Error("simulated membership read failure");
      return rows.find((row) => row.id === membershipDocId(uid, teamId))?.data;
    },
    async listMembershipDocuments(teamId, limit) {
      calls.listCalls.push({ teamId, limit });
      if (fixture.failListRead) throw new Error("simulated list read failure");
      return rows.filter((row) => rowTeamId(row) === teamId).slice(0, limit);
    },
  };
  return { reader, calls };
}

function rowTeamId(row: SelectableRow): unknown {
  const data = row.data;
  return typeof data === "object" && data !== null ? (data as Record<string, unknown>).teamId : undefined;
}

async function setup(fixture: Fixture = {}, names: Record<string, string> = {}) {
  const store: FakeConversationStore = createFakeConversationStore({ generateId: () => "unused" });
  const codec: FakeContentCodec = createFakeContentCodec();
  const { reader, calls } = fakeReader(fixture);
  const nameCalls: string[][] = [];
  const deps: SelectableMembersDeps = {
    store,
    codec,
    reader,
    getNames: async (uids) => {
      nameCalls.push([...uids]);
      return new Map(uids.flatMap((uid) => (names[uid] === undefined ? [] : [[uid, names[uid]] as const])));
    },
  };
  return { store, codec, deps, calls, nameCalls };
}

/** The caller owns the conversation, with a valid membership row for itself unless the test omits it. */
async function seedOwnedBy(setupResult: Awaited<ReturnType<typeof setup>>, options: { teamId?: string | null; status?: "open" | "completed" } = {}) {
  await seedOwnerConversation(setupResult.store, setupResult.codec, {
    conversationId: CONVERSATION_ID,
    teamId: options.teamId,
    status: options.status,
  });
}

const OWNER_ROW = (n = 1) => memberRow(OWNER_UID, n);

describe("readSelectableMembers: I-1 owner eligibility (no admin bypass, SPEC Amendment 2026-10-19 rules 7 and 8)", () => {
  it("refuses an app admin who has no membership of the team, with no roster and no name read (I-1)", async () => {
    const env = await setup({ rows: [memberRow("colleague-a", 2), memberRow("colleague-b", 3)] }, { "colleague-a": "Synthetic A" });
    await seedOwnedBy(env);

    const result = await readSelectableMembers(OWNER_UID, CONVERSATION_ID, env.deps);

    expect(result).toEqual({ ok: false, error: "conversation_not_found" });
    expect(env.calls.listCalls).toEqual([]);
    expect(env.nameCalls).toEqual([]);
  });

  it("refuses an app admin whose membership was removed while other members remain (I-1)", async () => {
    const env = await setup({ rows: [memberRow("colleague-a", 2)] }, { "colleague-a": "Synthetic A" });
    await seedOwnedBy(env);

    expect(await readSelectableMembers(OWNER_UID, CONVERSATION_ID, env.deps)).toEqual({
      ok: false,
      error: "conversation_not_found",
    });
    expect(env.nameCalls).toEqual([]);
  });

  it("refuses an ordinary member of a disabled team, with no roster (I-1, disabled-team case)", async () => {
    const env = await setup({ teamStatus: DISABLED, rows: [OWNER_ROW(), memberRow("colleague-a", 2)] }, { "colleague-a": "Synthetic A" });
    await seedOwnedBy(env);

    expect(await readSelectableMembers(OWNER_UID, CONVERSATION_ID, env.deps)).toEqual({
      ok: false,
      error: "conversation_not_found",
    });
    expect(env.calls.listCalls).toEqual([]);
    expect(env.nameCalls).toEqual([]);
  });

  it("refuses an app admin who is a lead member of a disabled team, with no roster (I-1, disabled-team case)", async () => {
    const env = await setup({ teamStatus: DISABLED, rows: [memberRow(OWNER_UID, 1, { role: "lead" }), memberRow("colleague-a", 2)] });
    await seedOwnedBy(env);

    expect(await readSelectableMembers(OWNER_UID, CONVERSATION_ID, env.deps)).toEqual({
      ok: false,
      error: "conversation_not_found",
    });
    expect(env.calls.listCalls).toEqual([]);
  });

  it("refuses a caller whose only membership is of another team (ordinary non-member)", async () => {
    const env = await setup({ rows: [{ id: membershipDocId(OWNER_UID, "team-other"), data: { uid: OWNER_UID, teamId: "team-other", memberRef: ref(1) } }] });
    await seedOwnedBy(env);

    expect(await readSelectableMembers(OWNER_UID, CONVERSATION_ID, env.deps)).toEqual({
      ok: false,
      error: "conversation_not_found",
    });
    expect(env.calls.listCalls).toEqual([]);
  });

  it("refuses a team member who is not the owner, and the owner's conversation is not read through their own subtree", async () => {
    const env = await setup({ rows: [memberRow("caller-x", 1), memberRow("owner-of-other", 2)] });
    await seedOwnerConversation(env.store, env.codec, { ownerUid: OTHER_OWNER_UID, conversationId: CONVERSATION_ID });

    expect(await readSelectableMembers("caller-x", CONVERSATION_ID, env.deps)).toEqual({
      ok: false,
      error: "conversation_not_found",
    });
    expect(env.calls.listCalls).toEqual([]);
    expect(env.nameCalls).toEqual([]);
  });
});

describe("readSelectableMembers: conversation and team classification", () => {
  it("returns the selector to the genuine active owner, with self marked and the exact DTO keys", async () => {
    const env = await setup({ rows: [OWNER_ROW(1), memberRow("colleague-a", 2)] }, { [OWNER_UID]: "Synthetic Owner", "colleague-a": "Synthetic A" });
    await seedOwnedBy(env);

    const result = await readSelectableMembers(OWNER_UID, CONVERSATION_ID, env.deps);

    expect(result).toEqual({
      ok: true,
      members: [
        { memberRef: ref(2), displayName: "Synthetic A", ordinal: null, isSelf: false },
        { memberRef: ref(1), displayName: "Synthetic Owner", ordinal: null, isSelf: true },
      ],
      unavailableCount: 0,
      truncated: false,
    });
    expect(env.calls.listCalls).toEqual([{ teamId: TEAM_ID, limit: 501 }]);
  });

  it("returns invalid_participant for a conversation with no team, and reads no team or membership", async () => {
    const env = await setup({ rows: [OWNER_ROW()] });
    await seedOwnedBy(env, { teamId: null });

    expect(await readSelectableMembers(OWNER_UID, CONVERSATION_ID, env.deps)).toEqual({
      ok: false,
      error: "invalid_participant",
    });
    expect(env.calls.teamReads).toBe(0);
    expect(env.calls.membershipReads).toBe(0);
  });

  it("returns conversation_completed for a completed conversation, before any team read", async () => {
    const env = await setup({ rows: [OWNER_ROW()] });
    await seedOwnedBy(env, { status: "completed" });

    expect(await readSelectableMembers(OWNER_UID, CONVERSATION_ID, env.deps)).toEqual({
      ok: false,
      error: "conversation_completed",
    });
    expect(env.calls.teamReads).toBe(0);
    expect(env.calls.listCalls).toEqual([]);
    expect(env.nameCalls).toEqual([]);
  });

  it("returns invalid_participant for a teamless conversation and names no colleague, even when one is in the team", async () => {
    const env = await setup({ rows: [OWNER_ROW(), memberRow("colleague-a", 2)] }, { "colleague-a": "Synthetic A" });
    await seedOwnedBy(env, { teamId: null });

    expect(await readSelectableMembers(OWNER_UID, CONVERSATION_ID, env.deps)).toEqual({ ok: false, error: "invalid_participant" });
    expect(env.calls.listCalls).toEqual([]);
    expect(env.nameCalls).toEqual([]);
  });

  it("returns conversation_not_found for a malformed owner document, with no team read", async () => {
    const env = await setup({ rows: [OWNER_ROW()] });
    await seedOwnedBy(env);
    const record: RawConversationData = { ...(await env.store.getOwner(OWNER_UID, CONVERSATION_ID)) };
    env.store.seedRawOwner(OWNER_UID, CONVERSATION_ID, { ...record, title: "extra plaintext key" });

    expect(await readSelectableMembers(OWNER_UID, CONVERSATION_ID, env.deps)).toEqual({
      ok: false,
      error: "conversation_not_found",
    });
    expect(env.calls.teamReads).toBe(0);
  });

  it("returns conversation_not_found for a malformed conversation id, with no read", async () => {
    const env = await setup({ rows: [OWNER_ROW()] });

    expect(await readSelectableMembers(OWNER_UID, "bad__id", env.deps)).toEqual({
      ok: false,
      error: "conversation_not_found",
    });
    expect(env.calls.teamReads).toBe(0);
  });
});

describe("readSelectableMembers: operational failures fail closed (BR-47, BR-53)", () => {
  it("returns persistence_failed with no roster when the key probe fails", async () => {
    const env = await setup({ rows: [OWNER_ROW(), memberRow("colleague-a", 2)] });
    await seedOwnedBy(env);
    env.codec.setKeyFailure("key_unavailable");

    expect(await readSelectableMembers(OWNER_UID, CONVERSATION_ID, env.deps)).toEqual({ ok: false, error: "persistence_failed" });
    expect(env.calls.listCalls).toEqual([]);
  });

  it("returns persistence_failed with no roster when the team read fails", async () => {
    const env = await setup({ failTeamRead: true, rows: [OWNER_ROW(), memberRow("colleague-a", 2)] });
    await seedOwnedBy(env);

    expect(await readSelectableMembers(OWNER_UID, CONVERSATION_ID, env.deps)).toEqual({ ok: false, error: "persistence_failed" });
    expect(env.calls.listCalls).toEqual([]);
  });

  it("returns persistence_failed with no partial roster when the membership list read fails", async () => {
    const env = await setup({ failListRead: true, rows: [OWNER_ROW(), memberRow("colleague-a", 2)] });
    await seedOwnedBy(env);

    expect(await readSelectableMembers(OWNER_UID, CONVERSATION_ID, env.deps)).toEqual({ ok: false, error: "persistence_failed" });
    expect(env.nameCalls).toEqual([]);
  });

  it("returns persistence_failed with no partial roster when the display-name read fails", async () => {
    const env = await setup({ rows: [OWNER_ROW(), memberRow("colleague-a", 2)] });
    await seedOwnedBy(env);
    env.deps.getNames = async () => {
      throw new Error("simulated profile failure");
    };

    expect(await readSelectableMembers(OWNER_UID, CONVERSATION_ID, env.deps)).toEqual({ ok: false, error: "persistence_failed" });
  });
});

describe("readSelectableMembers: bounded window, raw slots and malformed rows (Amendment rules 9 to 11)", () => {
  it("reads at most 501 rows through the team query and reports truncation only when a 501st row exists", async () => {
    const colleagues = Array.from({ length: 501 }, (_, index) => memberRow(`colleague-${index}`, index + 2));
    const env = await setup({ rows: [OWNER_ROW(), ...colleagues] });
    await seedOwnedBy(env);

    const result = await readSelectableMembers(OWNER_UID, CONVERSATION_ID, env.deps);

    expect(env.calls.listCalls).toEqual([{ teamId: TEAM_ID, limit: 501 }]);
    expect(result.ok && result.truncated).toBe(true);
    expect(result.ok && result.members.length).toBe(500);
  });

  it("lets a malformed row consume a raw slot, so a valid row beyond the first 500 raw rows is not offered", async () => {
    const malformed: SelectableRow = { id: "not-the-doc-id", data: { uid: "colleague-bad", teamId: TEAM_ID, memberRef: ref(900) } };
    const valid = Array.from({ length: 498 }, (_, index) => memberRow(`colleague-${index}`, index + 2));
    const beyond = memberRow("colleague-beyond", 999);
    const env = await setup({ rows: [OWNER_ROW(), malformed, ...valid, beyond] });
    await seedOwnedBy(env);

    const result = await readSelectableMembers(OWNER_UID, CONVERSATION_ID, env.deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.truncated).toBe(true);
    expect(result.unavailableCount).toBe(1);
    expect(result.members.map((member) => member.memberRef)).not.toContain(ref(999));
    expect(result.members.map((member) => member.memberRef)).not.toContain(ref(900));
    expect(result.members.length).toBe(499);
  });

  it("omits rows missing a uid, carrying another team's id, or missing a memberRef, even when the reader returns them", async () => {
    const env = await setup({ rows: [OWNER_ROW(1)] });
    await seedOwnedBy(env);
    env.deps.reader.listMembershipDocuments = async () => [
      OWNER_ROW(1),
      { id: membershipDocId(OWNER_UID, TEAM_ID), data: { teamId: TEAM_ID, memberRef: ref(7) } },
      { id: membershipDocId("colleague-t", TEAM_ID), data: { uid: "colleague-t", teamId: "team-other", memberRef: ref(8) } },
      { id: membershipDocId("colleague-m", TEAM_ID), data: { uid: "colleague-m", teamId: TEAM_ID } },
    ];

    const result = await readSelectableMembers(OWNER_UID, CONVERSATION_ID, env.deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.members.map((member) => member.memberRef)).toEqual([ref(1)]);
    expect(result.unavailableCount).toBe(3);
    expect(env.nameCalls).toEqual([[OWNER_UID]]);
  });

  it("omits rows whose id, uid, team or memberRef is wrong, and rows sharing a memberRef, and counts them without naming them", async () => {
    const env = await setup({
      rows: [
        OWNER_ROW(1),
        memberRow("colleague-a", 2),
        { id: membershipDocId("colleague-b", TEAM_ID), data: { uid: "colleague-c", teamId: TEAM_ID, memberRef: ref(3) } },
        { id: membershipDocId("colleague-d", TEAM_ID), data: { uid: "colleague-d", teamId: TEAM_ID, memberRef: "not-a-ref" } },
        memberRow("colleague-e", 5),
        memberRow("colleague-f", 5),
      ],
    });
    await seedOwnedBy(env);

    const result = await readSelectableMembers(OWNER_UID, CONVERSATION_ID, env.deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.members.map((member) => member.memberRef)).toEqual([ref(1), ref(2)]);
    expect(result.unavailableCount).toBe(4);
  });
});

describe("readSelectableMembers: display names, ordinals and the DTO (Amendment rules 13 to 16)", () => {
  it("gives duplicate names ordinals by join date, and returns an unnamed member with a null name", async () => {
    const env = await setup(
      {
        rows: [OWNER_ROW(1), memberRow("colleague-late", 4), memberRow("colleague-early", 2), memberRow("colleague-unnamed", 3)],
      },
      { [OWNER_UID]: "Synthetic Owner", "colleague-late": "Kari", "colleague-early": "Kari" },
    );
    await seedOwnedBy(env);

    const result = await readSelectableMembers(OWNER_UID, CONVERSATION_ID, env.deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const kari = result.members.filter((member) => member.displayName === "Kari");
    expect(kari.map((member) => [member.memberRef, member.ordinal])).toEqual([
      [ref(2), 1],
      [ref(4), 2],
    ]);
    expect(result.members.find((member) => member.memberRef === ref(3))?.displayName).toBeNull();
  });

  it("returns no uid, e-mail, role, membership document id or team id anywhere in the response", async () => {
    const env = await setup(
      { rows: [OWNER_ROW(1), memberRow("colleague-a", 2, { role: "lead", email: "colleague@example.test" })] },
      { "colleague-a": "Synthetic A" },
    );
    await seedOwnedBy(env);

    const result = await readSelectableMembers(OWNER_UID, CONVERSATION_ID, env.deps);
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain(OWNER_UID);
    expect(serialized).not.toContain("colleague-a");
    expect(serialized).not.toContain("colleague@example.test");
    expect(serialized).not.toContain(TEAM_ID);
    expect(serialized).not.toContain(membershipDocId(OWNER_UID, TEAM_ID));
    expect(serialized).not.toContain("lead");
  });

  it("asks for names only for offered uids, after owner eligibility", async () => {
    const env = await setup({ rows: [OWNER_ROW(1), memberRow("colleague-a", 2)] }, { "colleague-a": "Synthetic A" });
    await seedOwnedBy(env);

    await readSelectableMembers(OWNER_UID, CONVERSATION_ID, env.deps);

    expect(env.nameCalls).toEqual([[OWNER_UID, "colleague-a"]]);
  });
});
