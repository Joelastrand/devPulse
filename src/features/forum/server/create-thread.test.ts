import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decrypt } from "../../../lib/encryption/encryption";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import * as createThreadModule from "./create-thread";
import type {
  CreateThreadDeps,
  ForumThreadsCollection,
  MembershipReader,
  TeamStatusReader,
} from "./create-thread";
import { createThread } from "./create-thread";
import type { ForumThreadRecord } from "../domain/forum-thread";

const TEAM_ID = "team-42";
const OTHER_TEAM_ID = "team-99";
const MEMBER_UID = "member-1";
const APP_ADMIN_EMAIL = "admin@example.com";
const NOW = new Date("2026-09-01T00:00:00Z");
const VALID_TITLE = "How do we own on-call rotations?";
const VALID_BODY = "We keep dropping pages overnight and nobody owns the rotation.";

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

function fakeForumThreadsCollection(): ForumThreadsCollection & { writes: ForumThreadRecord[] } {
  const writes: ForumThreadRecord[] = [];
  return {
    writes,
    add: vi.fn(async (record: ForumThreadRecord) => {
      writes.push(record);
      return { id: `generated-thread-${writes.length}` };
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

function baseDeps(overrides: Partial<CreateThreadDeps> = {}): CreateThreadDeps {
  return {
    verifyToken: verifyTokenReturning(identity()),
    membershipReader: fakeMembershipReader(membershipDoc(MEMBER_UID, TEAM_ID)),
    teamStatusReader: fakeTeamStatusReader("active"),
    collection: fakeForumThreadsCollection(),
    now: NOW,
    ...overrides,
  };
}

describe("createThread", () => {
  beforeEach(() => {
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts a valid submission from a real team member and persists an encrypted thread, returning its id", async () => {
    const collection = fakeForumThreadsCollection();
    const result = await createThread("token", TEAM_ID, VALID_TITLE, VALID_BODY, baseDeps({ collection }));

    expect(result).toEqual({ ok: true, threadId: "generated-thread-1" });
    expect(collection.writes).toHaveLength(1);
    const stored = collection.writes[0];
    expect(stored.teamId).toBe(TEAM_ID);
    expect(stored.authorUid).toBe(MEMBER_UID);
    expect(stored.createdAt).toEqual(NOW);
    expect(typeof stored.ciphertext).toBe("string");
    expect(typeof stored.iv).toBe("string");
    expect(typeof stored.authTag).toBe("string");
    expect(stored.keyVersion).toBe("v1");
  });

  it("persists exactly the intended creation shape — teamId, authorUid, encrypted fields, createdAt — and nothing else", async () => {
    const collection = fakeForumThreadsCollection();
    await createThread("token", TEAM_ID, VALID_TITLE, VALID_BODY, baseDeps({ collection }));

    const stored = collection.writes[0];
    expect(Object.keys(stored).sort()).toEqual(
      ["authTag", "authorUid", "ciphertext", "createdAt", "iv", "keyVersion", "teamId"].sort(),
    );
  });

  it("encrypts and persists the canonical trimmed title/body as JSON, never plaintext", async () => {
    const collection = fakeForumThreadsCollection();
    const paddedTitle = "   How do we own on-call rotations?   ";
    const paddedBody = "   We keep dropping pages overnight and nobody owns the rotation.   ";
    await createThread("token", TEAM_ID, paddedTitle, paddedBody, baseDeps({ collection }));

    const stored = collection.writes[0];
    const decrypted = decrypt({
      ciphertext: stored.ciphertext,
      iv: stored.iv,
      authTag: stored.authTag,
      keyVersion: stored.keyVersion,
    });
    expect(JSON.parse(decrypted)).toEqual({ title: paddedTitle.trim(), body: paddedBody.trim() });

    const serialized = JSON.stringify(stored);
    expect(serialized).not.toContain("on-call rotations");
    expect(serialized).not.toContain("dropping pages");
  });

  it("accepts the minimum boundary lengths for title (3 chars) and body (3 chars)", async () => {
    const collection = fakeForumThreadsCollection();
    const result = await createThread("token", TEAM_ID, "abc", "xyz", baseDeps({ collection }));

    expect(result.ok).toBe(true);
    expect(collection.writes).toHaveLength(1);
  });

  it("accepts the maximum boundary lengths for title (150 chars) and body (4000 chars)", async () => {
    const collection = fakeForumThreadsCollection();
    const maxTitle = "a".repeat(150);
    const maxBody = "b".repeat(4000);
    const result = await createThread("token", TEAM_ID, maxTitle, maxBody, baseDeps({ collection }));

    expect(result.ok).toBe(true);
    expect(collection.writes).toHaveLength(1);
  });

  it("rejects an invalid title before any Firestore read, and writes nothing", async () => {
    const invalidTitles: unknown[] = ["ab", "a".repeat(151), "", "   ", 42, null, undefined];

    for (const invalidTitle of invalidTitles) {
      const collection = fakeForumThreadsCollection();
      const membershipReader = fakeMembershipReader(membershipDoc(MEMBER_UID, TEAM_ID));
      const teamStatusReader = fakeTeamStatusReader("active");

      const result = await createThread(
        "token",
        TEAM_ID,
        invalidTitle,
        VALID_BODY,
        baseDeps({ collection, membershipReader, teamStatusReader }),
      );

      expect(result).toEqual({ ok: false, error: "invalid_input" });
      expect(collection.writes).toHaveLength(0);
      expect(membershipReader.calls).toHaveLength(0);
      expect(teamStatusReader.calls).toHaveLength(0);
    }
  });

  it("rejects an invalid body before any Firestore read, and writes nothing", async () => {
    const invalidBodies: unknown[] = ["ab", "a".repeat(4001), "", "   ", 42, null, undefined];

    for (const invalidBody of invalidBodies) {
      const collection = fakeForumThreadsCollection();
      const membershipReader = fakeMembershipReader(membershipDoc(MEMBER_UID, TEAM_ID));
      const teamStatusReader = fakeTeamStatusReader("active");

      const result = await createThread(
        "token",
        TEAM_ID,
        VALID_TITLE,
        invalidBody,
        baseDeps({ collection, membershipReader, teamStatusReader }),
      );

      expect(result).toEqual({ ok: false, error: "invalid_input" });
      expect(collection.writes).toHaveLength(0);
      expect(membershipReader.calls).toHaveLength(0);
      expect(teamStatusReader.calls).toHaveLength(0);
    }
  });

  it("rejects an unauthenticated/invalid-token caller and performs zero Firestore reads or writes", async () => {
    const collection = fakeForumThreadsCollection();
    const membershipReader = fakeMembershipReader(membershipDoc(MEMBER_UID, TEAM_ID));
    const teamStatusReader = fakeTeamStatusReader("active");
    const verifyToken = vi.fn().mockRejectedValue(new Error("bad token"));

    const result = await createThread(
      "bad-token",
      TEAM_ID,
      VALID_TITLE,
      VALID_BODY,
      baseDeps({ collection, membershipReader, teamStatusReader, verifyToken }),
    );

    expect(result).toEqual({ ok: false, error: "sign_in_required" });
    expect(collection.writes).toHaveLength(0);
    expect(membershipReader.calls).toHaveLength(0);
    expect(teamStatusReader.calls).toHaveLength(0);
  });

  it("rejects a signed-in caller with no real membership for the team, and writes nothing", async () => {
    const collection = fakeForumThreadsCollection();
    const membershipReader = fakeMembershipReader(undefined);

    const result = await createThread(
      "token",
      TEAM_ID,
      VALID_TITLE,
      VALID_BODY,
      baseDeps({ collection, membershipReader }),
    );

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(collection.writes).toHaveLength(0);
  });

  it("rejects a member of a different team (wrong-team membership), and writes nothing", async () => {
    const collection = fakeForumThreadsCollection();
    const membershipReader = fakeMembershipReader(membershipDoc(MEMBER_UID, OTHER_TEAM_ID));

    const result = await createThread(
      "token",
      TEAM_ID,
      VALID_TITLE,
      VALID_BODY,
      baseDeps({ collection, membershipReader }),
    );

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(collection.writes).toHaveLength(0);
  });

  it("rejects a malformed membership record (missing uid/teamId fields), and writes nothing", async () => {
    const collection = fakeForumThreadsCollection();
    const membershipReader = fakeMembershipReader({ notUid: "x" });

    const result = await createThread(
      "token",
      TEAM_ID,
      VALID_TITLE,
      VALID_BODY,
      baseDeps({ collection, membershipReader }),
    );

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(collection.writes).toHaveLength(0);
  });

  it("rejects an app admin with no real membership record — admin status alone is never sufficient (BR-1)", async () => {
    const collection = fakeForumThreadsCollection();
    const membershipReader = fakeMembershipReader(undefined);
    const verifyToken = verifyTokenReturning(identity({ email: APP_ADMIN_EMAIL }));

    const result = await createThread(
      "token",
      TEAM_ID,
      VALID_TITLE,
      VALID_BODY,
      baseDeps({ collection, membershipReader, verifyToken }),
    );

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(collection.writes).toHaveLength(0);
  });

  it("succeeds for an active team", async () => {
    const collection = fakeForumThreadsCollection();
    const teamStatusReader = fakeTeamStatusReader("active");

    const result = await createThread(
      "token",
      TEAM_ID,
      VALID_TITLE,
      VALID_BODY,
      baseDeps({ collection, teamStatusReader }),
    );

    expect(result.ok).toBe(true);
  });

  it("rejects creation for a disabled team, and writes nothing", async () => {
    const collection = fakeForumThreadsCollection();
    const teamStatusReader = fakeTeamStatusReader("disabled");

    const result = await createThread(
      "token",
      TEAM_ID,
      VALID_TITLE,
      VALID_BODY,
      baseDeps({ collection, teamStatusReader }),
    );

    expect(result).toEqual({ ok: false, error: "team_disabled" });
    expect(collection.writes).toHaveLength(0);
  });

  it("rejects creation for a nonexistent team, and writes nothing", async () => {
    const collection = fakeForumThreadsCollection();
    const teamStatusReader = fakeTeamStatusReader(undefined);
    const membershipReader = fakeMembershipReader(membershipDoc(MEMBER_UID, "no-such-team"));

    const result = await createThread(
      "token",
      "no-such-team",
      VALID_TITLE,
      VALID_BODY,
      baseDeps({ collection, teamStatusReader, membershipReader }),
    );

    expect(result).toEqual({ ok: false, error: "team_not_found" });
    expect(collection.writes).toHaveLength(0);
  });

  it("fails closed to team_not_found on a malformed/unrecognized team status", async () => {
    const collection = fakeForumThreadsCollection();
    const teamStatusReader = fakeTeamStatusReader("archived");

    const result = await createThread(
      "token",
      TEAM_ID,
      VALID_TITLE,
      VALID_BODY,
      baseDeps({ collection, teamStatusReader }),
    );

    expect(result).toEqual({ ok: false, error: "team_not_found" });
    expect(collection.writes).toHaveLength(0);
  });

  it("ignores client-supplied teamId/authorUid/threadId/deletedAt overrides — the trusted route-scoped teamId and verified uid always win (BR-2, BR-47)", async () => {
    // Simulates a route handler forwarding request-body-shaped values an
    // attacker crafted alongside the legitimate title/body fields.
    const collection = fakeForumThreadsCollection();

    const result = await createThread("token", TEAM_ID, VALID_TITLE, VALID_BODY, baseDeps({ collection }));

    expect(result.ok).toBe(true);
    expect(collection.writes[0].teamId).toBe(TEAM_ID);
    expect(collection.writes[0].teamId).not.toBe("attacker-team");
    expect(collection.writes[0].authorUid).toBe(MEMBER_UID);
    expect(collection.writes[0].authorUid).not.toBe("attacker-uid");
    expect(collection.writes[0]).not.toHaveProperty("threadId");
    expect(collection.writes[0]).not.toHaveProperty("deletedAt");
    expect(collection.writes[0]).not.toHaveProperty("deletedBy");
  });

  it("never persists an author-identity-shaped field beyond authorUid", async () => {
    const collection = fakeForumThreadsCollection();
    await createThread("token", TEAM_ID, VALID_TITLE, VALID_BODY, baseDeps({ collection }));

    const stored = collection.writes[0];
    for (const forbiddenField of [
      "email",
      "displayName",
      "name",
      "authorTag",
      "createdBy",
      "userId",
      "membershipId",
    ]) {
      expect(stored).not.toHaveProperty(forbiddenField);
    }
    const serialized = JSON.stringify(stored);
    expect(serialized).not.toContain("dev@example.com");
  });

  it("never persists a mutable status, deletedAt, or deletedBy field", async () => {
    const collection = fakeForumThreadsCollection();
    await createThread("token", TEAM_ID, VALID_TITLE, VALID_BODY, baseDeps({ collection }));

    expect(collection.writes[0]).not.toHaveProperty("status");
    expect(collection.writes[0]).not.toHaveProperty("deletedAt");
    expect(collection.writes[0]).not.toHaveProperty("deletedBy");
  });

  it("persists encrypted ciphertext, never the raw plaintext title or body", async () => {
    const collection = fakeForumThreadsCollection();
    await createThread("token", TEAM_ID, VALID_TITLE, VALID_BODY, baseDeps({ collection }));

    const serialized = JSON.stringify(collection.writes[0]);
    expect(serialized).not.toContain(VALID_TITLE);
    expect(serialized).not.toContain(VALID_BODY);
  });

  it("persists exactly keyVersion 'v1', matching encryption.ts's own output", async () => {
    const collection = fakeForumThreadsCollection();
    await createThread("token", TEAM_ID, VALID_TITLE, VALID_BODY, baseDeps({ collection }));

    expect(collection.writes[0].keyVersion).toBe("v1");
  });

  it("fails closed with encryption_failed and writes nothing when ENCRYPTION_KEY is missing", async () => {
    vi.stubEnv("ENCRYPTION_KEY", "");
    const collection = fakeForumThreadsCollection();

    const result = await createThread("token", TEAM_ID, VALID_TITLE, VALID_BODY, baseDeps({ collection }));

    expect(result).toEqual({ ok: false, error: "encryption_failed" });
    expect(collection.writes).toHaveLength(0);
  });

  it("reports persistence_failed, not a fabricated success, when the Firestore write fails", async () => {
    const collection: ForumThreadsCollection = {
      add: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };

    const result = await createThread("token", TEAM_ID, VALID_TITLE, VALID_BODY, baseDeps({ collection }));

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("reports persistence_failed when the membership read fails", async () => {
    const collection = fakeForumThreadsCollection();
    const membershipReader: MembershipReader = {
      getMembership: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };

    const result = await createThread(
      "token",
      TEAM_ID,
      VALID_TITLE,
      VALID_BODY,
      baseDeps({ collection, membershipReader }),
    );

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(collection.writes).toHaveLength(0);
  });

  it("reports persistence_failed when the team status read fails", async () => {
    const collection = fakeForumThreadsCollection();
    const teamStatusReader: TeamStatusReader = {
      getTeamStatus: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };

    const result = await createThread(
      "token",
      TEAM_ID,
      VALID_TITLE,
      VALID_BODY,
      baseDeps({ collection, teamStatusReader }),
    );

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(collection.writes).toHaveLength(0);
  });

  it("allows repeated creations from the same identity to all succeed independently, each with its own id (BR-9)", async () => {
    const collection = fakeForumThreadsCollection();
    const deps = baseDeps({ collection });

    const first = await createThread("token", TEAM_ID, VALID_TITLE, VALID_BODY, deps);
    const second = await createThread("token", TEAM_ID, VALID_TITLE, VALID_BODY, deps);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(first.ok && second.ok && first.threadId).not.toBe(second.ok && second.threadId);
    expect(collection.writes).toHaveLength(2);
  });

  it("never logs on success, rejection, or failure paths", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await createThread("token", TEAM_ID, VALID_TITLE, VALID_BODY, baseDeps());
    await createThread("token", TEAM_ID, "x", VALID_BODY, baseDeps());

    const membershipReader = fakeMembershipReader(undefined);
    await createThread("token", TEAM_ID, VALID_TITLE, VALID_BODY, baseDeps({ membershipReader }));

    const teamStatusReader = fakeTeamStatusReader("disabled");
    await createThread("token", TEAM_ID, VALID_TITLE, VALID_BODY, baseDeps({ teamStatusReader }));

    vi.stubEnv("ENCRYPTION_KEY", "");
    await createThread("token", TEAM_ID, VALID_TITLE, VALID_BODY, baseDeps());
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));

    const failingCollection: ForumThreadsCollection = {
      add: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };
    await createThread("token", TEAM_ID, VALID_TITLE, VALID_BODY, baseDeps({ collection: failingCollection }));

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("returns only the approved minimal success/failure shape", async () => {
    const successResult = await createThread("token", TEAM_ID, VALID_TITLE, VALID_BODY, baseDeps());
    expect(Object.keys(successResult).sort()).toEqual(["ok", "threadId"].sort());

    const membershipReader = fakeMembershipReader(undefined);
    const failureResult = await createThread(
      "token",
      TEAM_ID,
      VALID_TITLE,
      VALID_BODY,
      baseDeps({ membershipReader }),
    );
    expect(Object.keys(failureResult).sort()).toEqual(["error", "ok"]);
  });

  it("exposes no listing/edit-shaped export from this module", () => {
    expect(Object.keys(createThreadModule)).toEqual(["createThread"]);
  });

  describe("privacy regression", () => {
    it("the full serialized persisted record never contains an identity canary beyond authorUid itself", async () => {
      const collection = fakeForumThreadsCollection();
      await createThread("token", TEAM_ID, VALID_TITLE, VALID_BODY, baseDeps({ collection }));

      const stored = collection.writes[0];
      for (const forbiddenKey of ["email", "displayName", "authorTag"]) {
        expect(stored).not.toHaveProperty(forbiddenKey);
      }
      expect(JSON.stringify(stored)).not.toContain("dev@example.com");
    });

    it("the full serialized success/failure result never contains an identity canary", async () => {
      const result = await createThread("token", TEAM_ID, VALID_TITLE, VALID_BODY, baseDeps());
      const serialized = JSON.stringify(result);

      expect(serialized).not.toContain(MEMBER_UID);
      expect(serialized).not.toContain("dev@example.com");
    });
  });
});
