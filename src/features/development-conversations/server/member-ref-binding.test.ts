import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { generateMemberRef } from "../../teams/domain/member-ref";
import { createFakeTeamEligibilityReader, type FakeTeamEligibilityState } from "./fake-team-eligibility";
import {
  bindingMatches,
  resolveParticipantRef,
  SELECTABLE_MEMBERS_MAX,
  type ParticipantRefReader,
} from "./member-ref-binding";
import { readGenuineActiveMembership } from "./team-eligibility";

// Synthetic fixtures only. Both refs satisfy the TASK-002 grammar (26 characters of lowercase Crockford base32).
const TEAM_ID = "team-alpha";
const OTHER_TEAM_ID = "team-beta";
const OWNER_UID = "owner-1";
const CANDIDATE_UID = "candidate-2";
const REF_A = "0123456789abcdefghjkmnpqrs";
const REF_B = "zyxwvtsrqpnmkjhgfedcba9876";

interface SyntheticMember {
  uid: string;
  teamId?: string;
  memberRef?: unknown;
  role?: "lead";
  displayName?: string;
}

function member(overrides: SyntheticMember): Record<string, unknown> {
  const { uid, teamId = TEAM_ID, memberRef, ...rest } = overrides;
  return { uid, teamId, createdAt: new Date(0), ...(memberRef === undefined ? {} : { memberRef }), ...rest };
}

/** Builds a reader whose membership list and point reads come from the same synthetic documents. */
function readerFor(
  members: Record<string, unknown>[],
  overrides: Partial<FakeTeamEligibilityState> = {},
): ParticipantRefReader & { limits: number[] } {
  const limits: number[] = [];
  const fake: FakeTeamEligibilityState = {
    teamStatus: { [TEAM_ID]: "active" },
    memberships: Object.fromEntries(members.map((doc) => [`${doc.uid}__${doc.teamId}`, doc])),
    ...overrides,
  };
  return {
    ...createFakeTeamEligibilityReader(fake),
    limits,
    async listMemberships(_teamId, limit) {
      limits.push(limit);
      return members.slice(0, limit);
    },
  };
}

const OWNER = member({ uid: OWNER_UID, memberRef: REF_A });
const CANDIDATE = member({ uid: CANDIDATE_UID, memberRef: REF_B });

describe("bindingMatches", () => {
  it("matches the same valid member reference", () => {
    expect(bindingMatches(REF_A, { memberRef: REF_A })).toBe(true);
  });

  it("does not match two different valid member references", () => {
    expect(bindingMatches(REF_A, { memberRef: REF_B })).toBe(false);
  });

  it("does not match when the current membership has no valid reference", () => {
    expect(bindingMatches(REF_A, { memberRef: null })).toBe(false);
  });

  it("does not match when the stored reference is absent", () => {
    expect(bindingMatches(null, { memberRef: REF_A })).toBe(false);
  });

  it("never treats two absent references as a match", () => {
    expect(bindingMatches(null, { memberRef: null })).toBe(false);
    expect(bindingMatches(undefined, { memberRef: undefined })).toBe(false);
  });

  it("does not match a malformed current reference, even when the stored text is identical", () => {
    const malformed = "0123456789abcdefghjkmnpqil"; // contains the excluded letters i and l
    expect(bindingMatches(malformed, { memberRef: malformed })).toBe(false);
  });

  it("does not match a malformed stored reference, even when the current reference is valid", () => {
    expect(bindingMatches("0123456789ABCDEFGHJKMNPQRS", { memberRef: "0123456789ABCDEFGHJKMNPQRS" })).toBe(false);
    expect(bindingMatches("short", { memberRef: REF_A })).toBe(false);
  });

  it("matches a reference from the production generator", () => {
    const ref = generateMemberRef();
    expect(bindingMatches(ref, { memberRef: ref })).toBe(true);
  });

  it("ignores role, lead status and other fields on the current membership", () => {
    const lead = { memberRef: REF_A, role: "lead" }; // a variable, so the membership's extra fields are not an excess literal
    expect(bindingMatches(REF_A, lead)).toBe(true);
    expect(bindingMatches(REF_B, lead)).toBe(false);
  });
});

describe("removal and rejoin (CL-23)", () => {
  it("binds the same membership instance and refuses a rejoined membership with a new ref", async () => {
    const storedRef = REF_A; // the accepted participation stored membership A
    const beforeRemoval = readerFor([member({ uid: CANDIDATE_UID, memberRef: REF_A })]);
    const bound = await readGenuineActiveMembership(CANDIDATE_UID, TEAM_ID, beforeRemoval);
    expect(bindingMatches(storedRef, bound.ok ? bound : { memberRef: null })).toBe(true);

    const afterRejoin = readerFor([member({ uid: CANDIDATE_UID, memberRef: REF_B })]);
    const rejoined = await readGenuineActiveMembership(CANDIDATE_UID, TEAM_ID, afterRejoin);
    expect(rejoined.ok).toBe(true);
    expect(bindingMatches(storedRef, rejoined.ok ? rejoined : { memberRef: null })).toBe(false);
  });

  it("refuses the stored reference after removal, when there is no current genuine membership", async () => {
    const removed = readerFor([]);
    const current = await readGenuineActiveMembership(CANDIDATE_UID, TEAM_ID, removed);

    expect(current).toEqual({ ok: false, error: "not_eligible" });
    expect(bindingMatches(REF_A, { memberRef: null })).toBe(false);
  });

  it("does not let the same uid change the mismatch result", () => {
    const candidateRecord = { memberRef: REF_B, uid: CANDIDATE_UID };
    const ownerRecord = { memberRef: REF_B, uid: OWNER_UID };
    expect(bindingMatches(REF_A, candidateRecord)).toBe(false);
    expect(bindingMatches(REF_A, ownerRecord)).toBe(false);
  });
});

describe("resolveParticipantRef", () => {
  it("resolves a selected member of the team to the candidate uid", async () => {
    const result = await resolveParticipantRef(OWNER_UID, TEAM_ID, REF_B, readerFor([OWNER, CANDIDATE]));

    expect(result).toEqual({ ok: true, candidateUid: CANDIDATE_UID, memberRef: REF_B });
  });

  it("reads at most the bounded window plus one to detect truncation", async () => {
    const reader = readerFor([OWNER, CANDIDATE]);
    await resolveParticipantRef(OWNER_UID, TEAM_ID, REF_B, reader);

    expect(reader.limits).toEqual([SELECTABLE_MEMBERS_MAX + 1]);
  });

  it("refuses an unknown reference", async () => {
    const result = await resolveParticipantRef(OWNER_UID, TEAM_ID, REF_A.replace("0", "1"), readerFor([OWNER, CANDIDATE]));

    expect(result).toEqual({ ok: false, error: "invalid_participant" });
  });

  it("refuses a malformed reference without reading the list", async () => {
    const reader = readerFor([OWNER, CANDIDATE]);
    const result = await resolveParticipantRef(OWNER_UID, TEAM_ID, "not-a-ref", reader);

    expect(result).toEqual({ ok: false, error: "invalid_participant" });
    expect(reader.limits).toEqual([]);
  });

  it("refuses a reference that belongs to another team", async () => {
    const otherTeam = member({ uid: CANDIDATE_UID, teamId: OTHER_TEAM_ID, memberRef: REF_B });
    const result = await resolveParticipantRef(OWNER_UID, TEAM_ID, REF_B, readerFor([OWNER, otherTeam]));

    expect(result).toEqual({ ok: false, error: "invalid_participant" });
  });

  it("refuses a duplicate reference in the list (fail closed)", async () => {
    const twin = member({ uid: "candidate-3", memberRef: REF_B });
    const result = await resolveParticipantRef(OWNER_UID, TEAM_ID, REF_B, readerFor([OWNER, CANDIDATE, twin]));

    expect(result).toEqual({ ok: false, error: "invalid_participant" });
  });

  it("refuses the owner's own reference (self)", async () => {
    const result = await resolveParticipantRef(OWNER_UID, TEAM_ID, REF_A, readerFor([OWNER]));

    expect(result).toEqual({ ok: false, error: "invalid_participant" });
  });

  it("refuses a candidate whose membership document is not a genuine membership (memberRef alone grants nothing)", async () => {
    // The list still names the candidate, but the candidate's own membership document is missing.
    const reader = readerFor([OWNER, CANDIDATE], { memberships: { [`${OWNER_UID}__${TEAM_ID}`]: OWNER } });
    const result = await resolveParticipantRef(OWNER_UID, TEAM_ID, REF_B, reader);

    expect(result).toEqual({ ok: false, error: "invalid_participant" });
  });

  it("refuses a candidate in a disabled team", async () => {
    const reader = readerFor([OWNER, CANDIDATE], { teamStatus: { [TEAM_ID]: "disabled" } });
    const result = await resolveParticipantRef(OWNER_UID, TEAM_ID, REF_B, reader);

    expect(result).toEqual({ ok: false, error: "invalid_participant" });
  });

  it("refuses when the candidate's current reference changed after the list was read", async () => {
    const changed = member({ uid: CANDIDATE_UID, memberRef: REF_A });
    const reader = readerFor([OWNER, CANDIDATE], {
      memberships: { [`${OWNER_UID}__${TEAM_ID}`]: OWNER, [`${CANDIDATE_UID}__${TEAM_ID}`]: changed },
    });
    const result = await resolveParticipantRef(OWNER_UID, TEAM_ID, REF_B, reader);

    expect(result).toEqual({ ok: false, error: "invalid_participant" });
  });

  it("refuses when the owner is not an eligible member of the team", async () => {
    const result = await resolveParticipantRef(OWNER_UID, TEAM_ID, REF_B, readerFor([CANDIDATE], { teamStatus: { [TEAM_ID]: "disabled" } }));

    expect(result).toEqual({ ok: false, error: "invalid_participant" });
  });

  it("refuses an app admin without membership, because admin status is never consulted", async () => {
    const adminRef = generateMemberRef(); // valid grammar, held by no listed membership
    const result = await resolveParticipantRef(OWNER_UID, TEAM_ID, adminRef, readerFor([OWNER, CANDIDATE]));

    expect(result).toEqual({ ok: false, error: "invalid_participant" });
  });

  it("resolves a lead candidate exactly like an ordinary member", async () => {
    const lead = member({ uid: CANDIDATE_UID, memberRef: REF_B, role: "lead" });
    const result = await resolveParticipantRef(OWNER_UID, TEAM_ID, REF_B, readerFor([OWNER, lead]));

    expect(result).toEqual({ ok: true, candidateUid: CANDIDATE_UID, memberRef: REF_B });
  });

  it("is unaffected by a display name equal to the owner's name", async () => {
    const sameName = member({ uid: CANDIDATE_UID, memberRef: REF_B, displayName: "Synthetic Owner" });
    const ownerNamed = member({ uid: OWNER_UID, memberRef: REF_A, displayName: "Synthetic Owner" });
    const result = await resolveParticipantRef(OWNER_UID, TEAM_ID, REF_B, readerFor([ownerNamed, sameName]));

    expect(result).toEqual({ ok: true, candidateUid: CANDIDATE_UID, memberRef: REF_B });
  });

  it("selects a member inside the window of a truncated list", async () => {
    const filler = Array.from({ length: SELECTABLE_MEMBERS_MAX }, (_, i) =>
      member({ uid: `filler-${i}`, memberRef: generateMemberRef() }),
    );
    const result = await resolveParticipantRef(OWNER_UID, TEAM_ID, REF_B, readerFor([OWNER, CANDIDATE, ...filler]));

    expect(result).toEqual({ ok: true, candidateUid: CANDIDATE_UID, memberRef: REF_B });
  });

  it("refuses a member beyond the 500-member window (truncation)", async () => {
    const filler = Array.from({ length: SELECTABLE_MEMBERS_MAX }, (_, i) =>
      member({ uid: `filler-${i}`, memberRef: generateMemberRef() }),
    );
    const beyond = member({ uid: CANDIDATE_UID, memberRef: REF_B });
    const result = await resolveParticipantRef(OWNER_UID, TEAM_ID, REF_B, readerFor([OWNER, ...filler, beyond]));

    expect(result).toEqual({ ok: false, error: "invalid_participant" });
  });

  it("maps a team read failure to persistence_failed, never to invalid_participant", async () => {
    const result = await resolveParticipantRef(OWNER_UID, TEAM_ID, REF_B, readerFor([OWNER, CANDIDATE], { failTeamRead: true }));

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("maps a membership read failure to persistence_failed, never to invalid_participant", async () => {
    const result = await resolveParticipantRef(OWNER_UID, TEAM_ID, REF_B, readerFor([OWNER, CANDIDATE], { failMembershipRead: true }));

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("maps a failed membership list read to persistence_failed", async () => {
    const reader: ParticipantRefReader = {
      ...readerFor([OWNER]),
      async listMemberships() {
        throw new Error("simulated list failure");
      },
    };
    const result = await resolveParticipantRef(OWNER_UID, TEAM_ID, REF_B, reader);

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("returns only the error code on failure, with no uid, reference or raw error text", async () => {
    const result = await resolveParticipantRef(OWNER_UID, TEAM_ID, REF_B, readerFor([OWNER, CANDIDATE], { failMembershipRead: true }));
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain(OWNER_UID);
    expect(serialized).not.toContain(CANDIDATE_UID);
    expect(serialized).not.toContain(REF_B);
    expect(serialized).not.toContain("simulated");
  });

  it("returns only the internal fields on success", async () => {
    const result = await resolveParticipantRef(OWNER_UID, TEAM_ID, REF_B, readerFor([OWNER, CANDIDATE]));

    expect(Object.keys(result).sort()).toEqual(["candidateUid", "memberRef", "ok"]);
  });
});

describe("short-circuits, boundary and failure paths", () => {
  /** Wraps a reader and records each list call and each candidate-or-owner membership point read. */
  function recording(base: ParticipantRefReader) {
    const calls = { list: 0, membershipUids: [] as string[] };
    const reader: ParticipantRefReader = {
      ...base,
      async listMemberships(teamId, limit) {
        calls.list += 1;
        return base.listMemberships(teamId, limit);
      },
      async getMembership(uid, teamId) {
        calls.membershipUids.push(uid);
        return base.getMembership(uid, teamId);
      },
    };
    return { reader, calls };
  }

  it("does not enumerate the membership list when the owner's team is disabled", async () => {
    const { reader, calls } = recording(readerFor([OWNER, CANDIDATE], { teamStatus: { [TEAM_ID]: "disabled" } }));
    const result = await resolveParticipantRef(OWNER_UID, TEAM_ID, REF_B, reader);

    expect(result).toEqual({ ok: false, error: "invalid_participant" });
    expect(calls.list).toBe(0);
  });

  it("does not enumerate the membership list when the owner has no membership", async () => {
    const { reader, calls } = recording(readerFor([CANDIDATE]));
    const result = await resolveParticipantRef(OWNER_UID, TEAM_ID, REF_B, reader);

    expect(result).toEqual({ ok: false, error: "invalid_participant" });
    expect(calls.list).toBe(0);
  });

  it("does not enumerate the membership list when the owner's team read fails", async () => {
    const { reader, calls } = recording(readerFor([OWNER, CANDIDATE], { failTeamRead: true }));
    const result = await resolveParticipantRef(OWNER_UID, TEAM_ID, REF_B, reader);

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(calls.list).toBe(0);
  });

  it("does not enumerate the membership list when the owner's membership read fails", async () => {
    const { reader, calls } = recording(readerFor([OWNER, CANDIDATE], { failMembershipRead: true }));
    const result = await resolveParticipantRef(OWNER_UID, TEAM_ID, REF_B, reader);

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(calls.list).toBe(0);
  });

  it("maps a candidate membership read failure to persistence_failed, not to invalid_participant", async () => {
    const base = readerFor([OWNER, CANDIDATE]);
    const reader: ParticipantRefReader = {
      ...base,
      async getMembership(uid, teamId) {
        if (uid === CANDIDATE_UID) {
          throw new Error("simulated candidate read failure");
        }
        return base.getMembership(uid, teamId);
      },
    };
    const result = await resolveParticipantRef(OWNER_UID, TEAM_ID, REF_B, reader);

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("does not read the candidate's membership when the list read fails", async () => {
    const base = readerFor([OWNER, CANDIDATE]);
    const { reader, calls } = recording({
      ...base,
      async listMemberships() {
        throw new Error("simulated list failure");
      },
    });
    const result = await resolveParticipantRef(OWNER_UID, TEAM_ID, REF_B, reader);

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(calls.membershipUids).toEqual([OWNER_UID]);
  });

  it("resolves a candidate at position 500, the last selectable slot, when a probe entry follows", async () => {
    const filler = Array.from({ length: SELECTABLE_MEMBERS_MAX - 2 }, (_, i) =>
      member({ uid: `filler-${i}`, memberRef: generateMemberRef() }),
    );
    const probe = member({ uid: "probe-501", memberRef: generateMemberRef() });
    // Index 0 owner, 1..498 filler, 499 candidate (the 500th entry), 500 probe (the 501st, truncation only).
    const list = [OWNER, ...filler, CANDIDATE, probe];
    const reader = readerFor(list);
    const result = await resolveParticipantRef(OWNER_UID, TEAM_ID, REF_B, reader);

    expect(list.indexOf(CANDIDATE)).toBe(SELECTABLE_MEMBERS_MAX - 1);
    expect(result).toEqual({ ok: true, candidateUid: CANDIDATE_UID, memberRef: REF_B });
    expect(reader.limits).toEqual([SELECTABLE_MEMBERS_MAX + 1]);
  });

  it("makes exactly one bounded list read and no bypass lookup for a candidate beyond the cutoff", async () => {
    const filler = Array.from({ length: SELECTABLE_MEMBERS_MAX }, (_, i) =>
      member({ uid: `filler-${i}`, memberRef: generateMemberRef() }),
    );
    const beyond = member({ uid: CANDIDATE_UID, memberRef: REF_B });
    const { reader, calls } = recording(readerFor([OWNER, ...filler, beyond]));
    const result = await resolveParticipantRef(OWNER_UID, TEAM_ID, REF_B, reader);

    expect(result).toEqual({ ok: false, error: "invalid_participant" });
    expect(calls.list).toBe(1);
    expect(calls.membershipUids).toEqual([OWNER_UID]);
  });

  it("counts malformed rows against the raw 500 window and does not refill past them", async () => {
    const malformedRows = Array.from({ length: SELECTABLE_MEMBERS_MAX - 2 }, (_, i) =>
      member({ uid: `bad-${i}`, memberRef: "not-a-valid-ref" }),
    );
    // Index 0 owner, 1..498 malformed, 499 valid filler, 500 candidate: the candidate is the 501st raw row, so it is outside the window.
    const list = [OWNER, ...malformedRows, member({ uid: "filler-last", memberRef: generateMemberRef() }), CANDIDATE];
    const result = await resolveParticipantRef(OWNER_UID, TEAM_ID, REF_B, readerFor(list));

    expect(list.indexOf(CANDIDATE)).toBe(SELECTABLE_MEMBERS_MAX);
    expect(result).toEqual({ ok: false, error: "invalid_participant" });
  });

  it("refuses a matching record whose uid is empty, because no candidate identity can be established", async () => {
    const emptyUid = member({ uid: "", memberRef: REF_B });
    const result = await resolveParticipantRef(OWNER_UID, TEAM_ID, REF_B, readerFor([OWNER, emptyUid]));

    expect(result).toEqual({ ok: false, error: "invalid_participant" });
  });
});

describe("bindingMatches with non-string and non-canonical values", () => {
  it("never matches a non-string, an object, or an uppercase form of a valid ref", () => {
    expect(bindingMatches(123, { memberRef: 123 })).toBe(false);
    expect(bindingMatches({ ref: REF_A }, { memberRef: { ref: REF_A } })).toBe(false);
    expect(bindingMatches(REF_A.toUpperCase(), { memberRef: REF_A.toUpperCase() })).toBe(false);
    expect(bindingMatches(REF_A, { memberRef: REF_A.toUpperCase() })).toBe(false);
  });
});

describe("module boundaries", () => {
  const source = readFileSync(resolve(__dirname, "member-ref-binding.ts"), "utf8");

  it("imports no team authority helper and no teams server module", () => {
    expect(source).not.toMatch(/authorizeTeamAccess|resolveTeamRole|requireAppAdmin|isAppAdmin/);
    expect(source).not.toMatch(/teams\/server/);
  });

  it("reads no role field in any decision", () => {
    expect(source).not.toMatch(/\.role\b|\["role"\]|'role'|"role"/);
  });

  it("imports neither the encryption helper nor the content codec", () => {
    expect(source).not.toMatch(/content-codec|lib\/encryption/);
  });
});
