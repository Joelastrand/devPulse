import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decrypt } from "../../../lib/encryption/encryption";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import * as submitChallengeModule from "./submit-challenge";
import type {
  ChallengeRecord,
  ChallengesCollection,
  MembershipReader,
  SubmitChallengeDeps,
  TeamStatusReader,
} from "./submit-challenge";
import { submitChallenge } from "./submit-challenge";

const TEAM_ID = "team-42";
const OTHER_TEAM_ID = "team-99";
const MEMBER_UID = "member-1";
const APP_ADMIN_EMAIL = "admin@example.com";
const NOW = new Date("2026-09-01T00:00:00Z");
const VALID_TEXT = "Deploys have no clear owner and this causes delays.";

function identity(overrides: Partial<VerifiedIdentity> = {}): VerifiedIdentity {
  return { uid: MEMBER_UID, email: "dev@example.com", emailVerified: true, ...overrides };
}

function verifyTokenReturning(verified: VerifiedIdentity) {
  return vi.fn().mockResolvedValue({
    uid: verified.uid,
    email: verified.email,
    email_verified: verified.emailVerified,
  });
}

function fakeChallengesCollection(): ChallengesCollection & { writes: ChallengeRecord[] } {
  const writes: ChallengeRecord[] = [];
  return {
    writes,
    add: vi.fn(async (record: ChallengeRecord) => {
      writes.push(record);
      return { id: `generated-challenge-${writes.length}` };
    }),
  };
}

function fakeMembershipReader(data: unknown): MembershipReader & { calls: Array<[string, string]> } {
  const calls: Array<[string, string]> = [];
  return {
    calls,
    getMembership: vi.fn(async (uid: string, teamId: string) => {
      calls.push([uid, teamId]);
      return data;
    }),
  };
}

function fakeTeamStatusReader(status: unknown): TeamStatusReader & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    getTeamStatus: vi.fn(async (teamId: string) => {
      calls.push(teamId);
      return status;
    }),
  };
}

function membershipDoc(uid: string, teamId: string): Record<string, unknown> {
  return { uid, teamId, createdAt: new Date("2026-08-01T00:00:00Z"), createdVia: "admin_direct", grantedBy: "admin" };
}

function baseDeps(overrides: Partial<SubmitChallengeDeps> = {}): SubmitChallengeDeps {
  return {
    verifyToken: verifyTokenReturning(identity()),
    membershipReader: fakeMembershipReader(membershipDoc(MEMBER_UID, TEAM_ID)),
    teamStatusReader: fakeTeamStatusReader("active"),
    collection: fakeChallengesCollection(),
    now: NOW,
    ...overrides,
  };
}

describe("submitChallenge", () => {
  beforeEach(() => {
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts a valid submission from a real team member and persists an encrypted, anonymous challenge", async () => {
    const collection = fakeChallengesCollection();
    const result = await submitChallenge("token", TEAM_ID, VALID_TEXT, baseDeps({ collection }));

    expect(result).toEqual({ ok: true });
    expect(collection.writes).toHaveLength(1);
    const stored = collection.writes[0];
    expect(stored.teamId).toBe(TEAM_ID);
    expect(stored.submittedAt).toEqual(NOW);
    expect(typeof stored.ciphertext).toBe("string");
    expect(typeof stored.iv).toBe("string");
    expect(typeof stored.authTag).toBe("string");
    expect(stored.keyVersion).toBe("v1");
  });

  it("persists exactly the intended creation shape — teamId, encrypted fields, submittedAt — and nothing else", async () => {
    const collection = fakeChallengesCollection();
    await submitChallenge("token", TEAM_ID, VALID_TEXT, baseDeps({ collection }));

    const stored = collection.writes[0];
    expect(Object.keys(stored).sort()).toEqual(
      ["authTag", "ciphertext", "iv", "keyVersion", "submittedAt", "teamId"].sort(),
    );
  });

  it("encrypts and persists the canonical trimmed text, never plaintext, never the untrimmed original", async () => {
    const collection = fakeChallengesCollection();
    const paddedText = "   Code review regularly takes more than two days.   ";
    await submitChallenge("token", TEAM_ID, paddedText, baseDeps({ collection }));

    const stored = collection.writes[0];
    const decrypted = decrypt({
      ciphertext: stored.ciphertext,
      iv: stored.iv,
      authTag: stored.authTag,
      keyVersion: stored.keyVersion,
    });
    expect(decrypted).toBe(paddedText.trim());
    const serialized = JSON.stringify(stored);
    expect(serialized).not.toContain("Code review regularly");
  });

  it("accepts the minimum boundary length (3 trimmed characters)", async () => {
    const collection = fakeChallengesCollection();
    const result = await submitChallenge("token", TEAM_ID, "abc", baseDeps({ collection }));

    expect(result).toEqual({ ok: true });
    expect(collection.writes).toHaveLength(1);
  });

  it("accepts the maximum boundary length (2000 trimmed characters)", async () => {
    const collection = fakeChallengesCollection();
    const maxText = "a".repeat(2000);
    const result = await submitChallenge("token", TEAM_ID, maxText, baseDeps({ collection }));

    expect(result).toEqual({ ok: true });
    expect(collection.writes).toHaveLength(1);
  });

  it("rejects invalid text before any Firestore read, and writes nothing", async () => {
    const invalidInputs: unknown[] = ["ab", "a".repeat(2001), "", "   ", 42, null, undefined];

    for (const invalidInput of invalidInputs) {
      const collection = fakeChallengesCollection();
      const membershipReader = fakeMembershipReader(membershipDoc(MEMBER_UID, TEAM_ID));
      const teamStatusReader = fakeTeamStatusReader("active");

      const result = await submitChallenge(
        "token",
        TEAM_ID,
        invalidInput,
        baseDeps({ collection, membershipReader, teamStatusReader }),
      );

      expect(result).toEqual({ ok: false, error: "invalid_input" });
      expect(collection.writes).toHaveLength(0);
      expect(membershipReader.calls).toHaveLength(0);
      expect(teamStatusReader.calls).toHaveLength(0);
    }
  });

  it("rejects an unauthenticated/invalid-token caller and performs zero Firestore reads or writes", async () => {
    const collection = fakeChallengesCollection();
    const membershipReader = fakeMembershipReader(membershipDoc(MEMBER_UID, TEAM_ID));
    const teamStatusReader = fakeTeamStatusReader("active");
    const verifyToken = vi.fn().mockRejectedValue(new Error("bad token"));

    const result = await submitChallenge(
      "bad-token",
      TEAM_ID,
      VALID_TEXT,
      baseDeps({ collection, membershipReader, teamStatusReader, verifyToken }),
    );

    expect(result).toEqual({ ok: false, error: "sign_in_required" });
    expect(collection.writes).toHaveLength(0);
    expect(membershipReader.calls).toHaveLength(0);
    expect(teamStatusReader.calls).toHaveLength(0);
  });

  it("rejects a signed-in caller with no real membership for the team, and writes nothing", async () => {
    const collection = fakeChallengesCollection();
    const membershipReader = fakeMembershipReader(undefined);

    const result = await submitChallenge(
      "token",
      TEAM_ID,
      VALID_TEXT,
      baseDeps({ collection, membershipReader }),
    );

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(collection.writes).toHaveLength(0);
  });

  it("rejects a member of a different team (wrong-team membership), and writes nothing", async () => {
    const collection = fakeChallengesCollection();
    const membershipReader = fakeMembershipReader(membershipDoc(MEMBER_UID, OTHER_TEAM_ID));

    const result = await submitChallenge(
      "token",
      TEAM_ID,
      VALID_TEXT,
      baseDeps({ collection, membershipReader }),
    );

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(collection.writes).toHaveLength(0);
  });

  it("succeeds for an authorized real team member", async () => {
    const collection = fakeChallengesCollection();
    const membershipReader = fakeMembershipReader(membershipDoc(MEMBER_UID, TEAM_ID));

    const result = await submitChallenge(
      "token",
      TEAM_ID,
      VALID_TEXT,
      baseDeps({ collection, membershipReader }),
    );

    expect(result).toEqual({ ok: true });
    expect(collection.writes).toHaveLength(1);
  });

  it("rejects an app admin with no real membership record — admin status alone is never sufficient (BR-1)", async () => {
    const collection = fakeChallengesCollection();
    const membershipReader = fakeMembershipReader(undefined);
    const verifyToken = verifyTokenReturning(identity({ email: APP_ADMIN_EMAIL }));

    const result = await submitChallenge(
      "token",
      TEAM_ID,
      VALID_TEXT,
      baseDeps({ collection, membershipReader, verifyToken }),
    );

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(collection.writes).toHaveLength(0);
  });

  it("succeeds for an active team", async () => {
    const collection = fakeChallengesCollection();
    const teamStatusReader = fakeTeamStatusReader("active");

    const result = await submitChallenge(
      "token",
      TEAM_ID,
      VALID_TEXT,
      baseDeps({ collection, teamStatusReader }),
    );

    expect(result).toEqual({ ok: true });
  });

  it("rejects submission to a disabled team, and writes nothing", async () => {
    const collection = fakeChallengesCollection();
    const teamStatusReader = fakeTeamStatusReader("disabled");

    const result = await submitChallenge(
      "token",
      TEAM_ID,
      VALID_TEXT,
      baseDeps({ collection, teamStatusReader }),
    );

    expect(result).toEqual({ ok: false, error: "team_disabled" });
    expect(collection.writes).toHaveLength(0);
  });

  it("rejects submission to a nonexistent team, and writes nothing", async () => {
    const collection = fakeChallengesCollection();
    const teamStatusReader = fakeTeamStatusReader(undefined);
    const membershipReader = fakeMembershipReader(membershipDoc(MEMBER_UID, "no-such-team"));

    const result = await submitChallenge(
      "token",
      "no-such-team",
      VALID_TEXT,
      baseDeps({ collection, teamStatusReader, membershipReader }),
    );

    expect(result).toEqual({ ok: false, error: "team_not_found" });
    expect(collection.writes).toHaveLength(0);
  });

  it("fails closed to team_not_found on a malformed/unrecognized team status", async () => {
    const collection = fakeChallengesCollection();
    const teamStatusReader = fakeTeamStatusReader("archived");

    const result = await submitChallenge(
      "token",
      TEAM_ID,
      VALID_TEXT,
      baseDeps({ collection, teamStatusReader }),
    );

    expect(result).toEqual({ ok: false, error: "team_not_found" });
    expect(collection.writes).toHaveLength(0);
  });

  it("ignores a client-supplied teamId injected into the raw request body — the trusted route-scoped teamId always wins", async () => {
    // Simulates a route handler forwarding the parsed request body, which an
    // attacker crafted to include a teamId-shaped property alongside the
    // text field.
    const attackerBody = { text: VALID_TEXT, teamId: "attacker-team" };
    const collection = fakeChallengesCollection();

    // A route only ever extracts the text field and passes the *trusted*
    // route-scoped teamId as its own argument — submitChallenge itself has
    // no teamId-shaped input to read from rawText.
    const result = await submitChallenge(
      "token",
      TEAM_ID,
      attackerBody.text,
      baseDeps({ collection }),
    );

    expect(result).toEqual({ ok: true });
    expect(collection.writes[0].teamId).toBe(TEAM_ID);
    expect(collection.writes[0].teamId).not.toBe("attacker-team");
  });

  it("rejects the raw request body object itself as invalid input if passed as rawText, never reading a teamId from it", async () => {
    const attackerBody = { text: VALID_TEXT, teamId: "attacker-team" };
    const collection = fakeChallengesCollection();

    const result = await submitChallenge("token", TEAM_ID, attackerBody, baseDeps({ collection }));

    expect(result).toEqual({ ok: false, error: "invalid_input" });
    expect(collection.writes).toHaveLength(0);
  });

  it("never persists a submitter-identity-shaped field of any kind", async () => {
    const collection = fakeChallengesCollection();
    await submitChallenge("token", TEAM_ID, VALID_TEXT, baseDeps({ collection }));

    const stored = collection.writes[0];
    for (const forbiddenField of [
      "uid",
      "email",
      "displayName",
      "name",
      "submittedBy",
      "userId",
      "membershipId",
      "ip",
      "ipAddress",
      "userAgent",
      "sessionId",
    ]) {
      expect(stored).not.toHaveProperty(forbiddenField);
    }
    const serialized = JSON.stringify(stored);
    expect(serialized).not.toContain(MEMBER_UID);
    expect(serialized).not.toContain("dev@example.com");
  });

  it("never persists a mutable status field", async () => {
    const collection = fakeChallengesCollection();
    await submitChallenge("token", TEAM_ID, VALID_TEXT, baseDeps({ collection }));

    expect(collection.writes[0]).not.toHaveProperty("status");
  });

  it("never persists resolvedAt/resolvedBy at creation", async () => {
    const collection = fakeChallengesCollection();
    await submitChallenge("token", TEAM_ID, VALID_TEXT, baseDeps({ collection }));

    expect(collection.writes[0]).not.toHaveProperty("resolvedAt");
    expect(collection.writes[0]).not.toHaveProperty("resolvedBy");
  });

  it("never persists archivedAt/archivedBy at creation", async () => {
    const collection = fakeChallengesCollection();
    await submitChallenge("token", TEAM_ID, VALID_TEXT, baseDeps({ collection }));

    expect(collection.writes[0]).not.toHaveProperty("archivedAt");
    expect(collection.writes[0]).not.toHaveProperty("archivedBy");
  });

  it("persists encrypted ciphertext, never the raw plaintext challenge text", async () => {
    const collection = fakeChallengesCollection();
    await submitChallenge("token", TEAM_ID, VALID_TEXT, baseDeps({ collection }));

    const serialized = JSON.stringify(collection.writes[0]);
    expect(serialized).not.toContain(VALID_TEXT);
    expect(collection.writes[0].ciphertext).not.toBe(VALID_TEXT);
  });

  it("persists exactly keyVersion 'v1', matching TASK-001's ChallengeKeyVersion and encryption.ts's own output", async () => {
    const collection = fakeChallengesCollection();
    await submitChallenge("token", TEAM_ID, VALID_TEXT, baseDeps({ collection }));

    expect(collection.writes[0].keyVersion).toBe("v1");
  });

  it("fails closed with encryption_failed and writes nothing when ENCRYPTION_KEY is missing", async () => {
    vi.stubEnv("ENCRYPTION_KEY", "");
    const collection = fakeChallengesCollection();

    const result = await submitChallenge("token", TEAM_ID, VALID_TEXT, baseDeps({ collection }));

    expect(result).toEqual({ ok: false, error: "encryption_failed" });
    expect(collection.writes).toHaveLength(0);
  });

  it("reports persistence_failed, not a fabricated success, when the Firestore write fails", async () => {
    const collection: ChallengesCollection = {
      add: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };

    const result = await submitChallenge("token", TEAM_ID, VALID_TEXT, baseDeps({ collection }));

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("reports persistence_failed when the membership read fails", async () => {
    const collection = fakeChallengesCollection();
    const membershipReader: MembershipReader = {
      getMembership: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };

    const result = await submitChallenge(
      "token",
      TEAM_ID,
      VALID_TEXT,
      baseDeps({ collection, membershipReader }),
    );

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(collection.writes).toHaveLength(0);
  });

  it("reports persistence_failed when the team status read fails", async () => {
    const collection = fakeChallengesCollection();
    const teamStatusReader: TeamStatusReader = {
      getTeamStatus: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };

    const result = await submitChallenge(
      "token",
      TEAM_ID,
      VALID_TEXT,
      baseDeps({ collection, teamStatusReader }),
    );

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(collection.writes).toHaveLength(0);
  });

  it("allows repeated submissions from the same identity to all succeed independently (BR-8)", async () => {
    const collection = fakeChallengesCollection();
    const deps = baseDeps({ collection });

    const first = await submitChallenge("token", TEAM_ID, VALID_TEXT, deps);
    const second = await submitChallenge("token", TEAM_ID, VALID_TEXT, deps);

    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: true });
    expect(collection.writes).toHaveLength(2);
  });

  it("never logs on success, rejection, or failure paths", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await submitChallenge("token", TEAM_ID, VALID_TEXT, baseDeps());

    await submitChallenge("token", TEAM_ID, "x", baseDeps());

    const membershipReader = fakeMembershipReader(undefined);
    await submitChallenge("token", TEAM_ID, VALID_TEXT, baseDeps({ membershipReader }));

    const teamStatusReader = fakeTeamStatusReader("disabled");
    await submitChallenge("token", TEAM_ID, VALID_TEXT, baseDeps({ teamStatusReader }));

    vi.stubEnv("ENCRYPTION_KEY", "");
    await submitChallenge("token", TEAM_ID, VALID_TEXT, baseDeps());
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));

    const failingCollection: ChallengesCollection = {
      add: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };
    await submitChallenge("token", TEAM_ID, VALID_TEXT, baseDeps({ collection: failingCollection }));

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("returns only the approved minimal success/failure shape — no challengeId, no echoed text, no identity", async () => {
    const successResult = await submitChallenge("token", TEAM_ID, VALID_TEXT, baseDeps());
    expect(Object.keys(successResult)).toEqual(["ok"]);

    const membershipReader = fakeMembershipReader(undefined);
    const failureResult = await submitChallenge(
      "token",
      TEAM_ID,
      VALID_TEXT,
      baseDeps({ membershipReader }),
    );
    expect(Object.keys(failureResult).sort()).toEqual(["error", "ok"]);
  });

  it("exposes no TASK-003 listing behavior from this module", () => {
    expect(submitChallengeModule).not.toHaveProperty("listTeamChallengesForMember");
    expect(submitChallengeModule).not.toHaveProperty("listTeamChallengesForAdmin");
    expect(Object.keys(submitChallengeModule)).toEqual(["submitChallenge"]);
  });

  describe("privacy regression", () => {
    it("the full serialized persisted record never contains an identity canary", async () => {
      const collection = fakeChallengesCollection();
      await submitChallenge("token", TEAM_ID, VALID_TEXT, baseDeps({ collection }));

      const serialized = JSON.stringify(collection.writes[0]);
      for (const canary of [MEMBER_UID, "dev@example.com", APP_ADMIN_EMAIL, "uid", "email", "displayName"]) {
        if (canary === "uid" || canary === "email" || canary === "displayName") {
          // These are checked as absent *keys*, not substrings, since
          // "keyVersion"/"teamId" etc. legitimately contain unrelated text.
          expect(collection.writes[0]).not.toHaveProperty(canary);
        } else {
          expect(serialized).not.toContain(canary);
        }
      }
    });

    it("the full serialized success/failure result never contains an identity canary", async () => {
      const result = await submitChallenge("token", TEAM_ID, VALID_TEXT, baseDeps());
      const serialized = JSON.stringify(result);

      expect(serialized).not.toContain(MEMBER_UID);
      expect(serialized).not.toContain("dev@example.com");
    });
  });
});
