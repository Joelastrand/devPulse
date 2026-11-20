import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import {
  authorizeBoundParticipant,
  confirmBoundColleague,
  createFirestoreSharedTeamReader,
  resolveColleagueRef,
  type BoundColleague,
} from "./shared-team-binding";
import { createTransactionTeamEligibilityReader } from "./team-eligibility";

/**
 * Shared-team eligibility on the Firestore EMULATOR (A2.1, revised per-team bindings). The production reader runs the owner's
 * bounded membership list and the exact point reads. The transactional reader runs the revalidation inside a transaction.
 * Runs only with `FIRESTORE_EMULATOR_HOST` and a `demo-` project id, like the other emulator suites. Skipped otherwise.
 * Synthetic fixtures only.
 */

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT_ID = process.env.DEVPULSE_EMULATOR_PROJECT;
const CONFIGURED =
  typeof EMULATOR_HOST === "string" && EMULATOR_HOST.length > 0 && typeof PROJECT_ID === "string" && PROJECT_ID.startsWith("demo-");

const OWNER = "emu-sht-owner";
const COLLEAGUE = "emu-sht-colleague";
const OUTSIDER = "emu-sht-outsider";
const TEAM = "emu-sht-team";
const SECOND_TEAM = "emu-sht-team-second";
const OTHER_TEAM = "emu-sht-team-other";
const OWNER_REF = "2468ace7bdfhjkmnpqrstvwxyz";
const COLLEAGUE_REF = "0123456789abcdefghjkmnpqrs";
const SECOND_OWNER_REF = "zyxwvtsrqpnmkjhgfedcba9876";
const SECOND_COLLEAGUE_REF = "mnpqrstvwxyz0123456789abcd";
const OUTSIDER_REF = "abcdefghjkmnpqrstvwxyz0123";
const NEW_REF = "9876543210zyxwvtsrqpnmkjhg";
const CREATED = new Date("2026-10-01T08:00:00.000Z");

const membershipId = (uid: string, teamId: string) => `${uid}__${teamId}`;
const membershipRef = (uid: string, teamId: string) => getFirestoreDb().collection("teamMemberships").doc(membershipId(uid, teamId));

/** The binding a fresh invitation records for the two shared teams below. */
const BINDINGS = {
  [TEAM]: { ownerMemberRef: OWNER_REF, participantMemberRef: COLLEAGUE_REF },
  [SECOND_TEAM]: { ownerMemberRef: SECOND_OWNER_REF, participantMemberRef: SECOND_COLLEAGUE_REF },
};

/**
 * Removes or changes one membership document for the duration of `work`, then restores the original data. Restoration runs
 * even when `work` fails, so one test cannot leak state into the next.
 */
async function withMembership(uid: string, teamId: string, change: "delete" | { memberRef: string }, work: () => Promise<void>) {
  const ref = membershipRef(uid, teamId);
  const before = (await ref.get()).data();
  if (change === "delete") await ref.delete();
  else await ref.update({ memberRef: change.memberRef });
  try {
    await work();
  } finally {
    await ref.set(before ?? {});
  }
}

describe.skipIf(!CONFIGURED)("shared-team eligibility on the Firestore emulator (A2.1, per-team bindings)", () => {
  beforeAll(async () => {
    process.env.FIREBASE_PROJECT_ID = `${PROJECT_ID}-sht`;
    const db = getFirestoreDb();
    for (const team of [TEAM, SECOND_TEAM, OTHER_TEAM]) {
      await db.collection("teams").doc(team).set({ name: "Synthetic team", status: "active" });
    }
    const rows: Array<[string, string, string]> = [
      [OWNER, TEAM, OWNER_REF],
      [COLLEAGUE, TEAM, COLLEAGUE_REF],
      [OWNER, SECOND_TEAM, SECOND_OWNER_REF],
      [COLLEAGUE, SECOND_TEAM, SECOND_COLLEAGUE_REF],
      [OUTSIDER, OTHER_TEAM, OUTSIDER_REF],
    ];
    for (const [uid, teamId, memberRef] of rows) {
      await db.collection("teamMemberships").doc(membershipId(uid, teamId)).set({ uid, teamId, createdAt: CREATED, memberRef });
    }
  });

  afterAll(async () => {
    const db = getFirestoreDb();
    for (const [uid, teamId] of [
      [OWNER, TEAM],
      [COLLEAGUE, TEAM],
      [OWNER, SECOND_TEAM],
      [COLLEAGUE, SECOND_TEAM],
      [OUTSIDER, OTHER_TEAM],
    ]) {
      await db.collection("teamMemberships").doc(membershipId(uid, teamId)).delete();
    }
    for (const team of [TEAM, SECOND_TEAM, OTHER_TEAM]) {
      await db.collection("teams").doc(team).delete();
    }
  });

  it("derives the bindings for every shared team from the owner's bounded membership list", async () => {
    const result = await resolveColleagueRef(OWNER, COLLEAGUE_REF, createFirestoreSharedTeamReader());
    expect(result).toEqual({ ok: true, colleague: { uid: COLLEAGUE, bindings: BINDINGS } });
  });

  it("refuses a colleague who shares no team with the owner, on the real database", async () => {
    expect(await resolveColleagueRef(OWNER, OUTSIDER_REF, createFirestoreSharedTeamReader())).toEqual({ ok: false, error: "not_eligible" });
  });

  it("confirms the bound colleague inside a transaction while every recorded binding holds", async () => {
    const db = getFirestoreDb();
    const colleague: BoundColleague = { uid: COLLEAGUE, bindings: BINDINGS };
    expect(await db.runTransaction((tx) => confirmBoundColleague(OWNER, colleague, createTransactionTeamEligibilityReader(db, tx)))).toEqual({
      ok: true,
    });
  });

  it("keeps access while one recorded team still holds after the other is left (policy 3)", async () => {
    await withMembership(COLLEAGUE, TEAM, "delete", async () => {
      expect(await authorizeBoundParticipant(OWNER, COLLEAGUE, BINDINGS, createFirestoreSharedTeamReader())).toEqual({
        ok: true,
        teamId: SECOND_TEAM,
      });
    });
  });

  it("denies access on the next request once every recorded team is gone (policy 6)", async () => {
    await withMembership(COLLEAGUE, TEAM, "delete", async () => {
      await withMembership(COLLEAGUE, SECOND_TEAM, "delete", async () => {
        expect(await authorizeBoundParticipant(OWNER, COLLEAGUE, BINDINGS, createFirestoreSharedTeamReader())).toEqual({
          ok: false,
          error: "not_eligible",
        });
      });
    });
  });

  it("does not restore access when the participant rejoins a recorded team under a new memberRef (CL-23, policy 4)", async () => {
    await withMembership(COLLEAGUE, TEAM, { memberRef: NEW_REF }, async () => {
      await withMembership(COLLEAGUE, SECOND_TEAM, { memberRef: NEW_REF }, async () => {
        expect(await authorizeBoundParticipant(OWNER, COLLEAGUE, BINDINGS, createFirestoreSharedTeamReader())).toEqual({
          ok: false,
          error: "not_eligible",
        });
      });
    });
  });

  it("refuses a transactional revalidation that finds the owner's membership gone in a recorded team", async () => {
    const db = getFirestoreDb();
    const colleague: BoundColleague = { uid: COLLEAGUE, bindings: BINDINGS };
    await withMembership(OWNER, TEAM, "delete", async () => {
      expect(await db.runTransaction((tx) => confirmBoundColleague(OWNER, colleague, createTransactionTeamEligibilityReader(db, tx)))).toEqual({
        ok: false,
        error: "not_eligible",
      });
    });
  });
});
