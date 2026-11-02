import { afterEach, describe, expect, it, vi } from "vitest";
import { issueErasureResumeCapability } from "./erasure-resume-capability";

// The setup file mocks the fence reader for feature tests. This file tests the real reader and the production default path.
vi.unmock("./erasure-fence");

const state = vi.hoisted(() => ({ records: new Map<string, unknown>(), failRead: false }));

vi.mock("../../../lib/firebase/admin", () => ({
  getAdminAuth: () => ({
    verifyIdToken: async () => {
      throw new Error("not used");
    },
  }),
  getFirestoreDb: () => ({
    collection: (name: string) => ({
      doc: (id: string) => ({
        get: async () => {
          if (state.failRead) throw new Error("firestore unavailable");
          if (name !== "accountErasures") throw new Error(`unexpected collection ${name}`);
          return state.records.has(id)
            ? { exists: true, data: () => state.records.get(id) }
            : { exists: false, data: () => undefined };
        },
      }),
    }),
  }),
}));

const { interpretErasureRecord, readErasureFenceFromFirestore } = await import("./erasure-fence");
const { verifyIdToken } = await import("./verify-identity");

afterEach(() => {
  state.records.clear();
  state.failRead = false;
});

const verifyAs = (uid: string) =>
  vi.fn().mockResolvedValue({ uid, email: "dev@example.com", email_verified: true });

describe("interpretErasureRecord", () => {
  it("maps in_progress to in_progress and the two terminal statuses to terminal", () => {
    expect(interpretErasureRecord({ status: "in_progress" })).toEqual({ kind: "in_progress" });
    expect(interpretErasureRecord({ status: "auth_deleted" })).toEqual({ kind: "terminal" });
    expect(interpretErasureRecord({ status: "completed" })).toEqual({ kind: "terminal" });
  });

  it("never coerces an unknown, missing, or non-object record into a clear state", () => {
    expect(interpretErasureRecord({ status: "reopened" })).toEqual({ kind: "malformed" });
    expect(interpretErasureRecord({})).toEqual({ kind: "malformed" });
    expect(interpretErasureRecord(null)).toEqual({ kind: "malformed" });
    expect(interpretErasureRecord("in_progress")).toEqual({ kind: "malformed" });
  });
});

describe("readErasureFenceFromFirestore (production reader)", () => {
  it("reports no record when the document is absent", async () => {
    state.records.clear();
    state.failRead = false;
    await expect(readErasureFenceFromFirestore("uid-a")).resolves.toEqual({ kind: "none" });
  });

  it("rejects when the read fails, so the caller can fail closed", async () => {
    state.failRead = true;
    await expect(readErasureFenceFromFirestore("uid-a")).rejects.toThrow("firestore unavailable");
    state.failRead = false;
  });
});

describe("verifyIdToken on the production fence path (no injected reader)", () => {
  it("admits a uid with no record, with the same identity shape as before", async () => {
    state.records.clear();
    const result = await verifyIdToken("token", { verifyToken: verifyAs("uid-a") });
    expect(result).toEqual({
      ok: true,
      identity: { uid: "uid-a", email: "dev@example.com", emailVerified: true },
    });
  });

  it("refuses an in-progress uid with erasure_in_progress, and admits it only with allowDuringErasure", async () => {
    state.records.set("uid-b", { status: "in_progress" });
    expect(await verifyIdToken("token", { verifyToken: verifyAs("uid-b") })).toEqual({
      ok: false,
      error: "erasure_in_progress",
    });
    expect(
      await verifyIdToken("token", { verifyToken: verifyAs("uid-b"), allowDuringErasure: issueErasureResumeCapability() }),
    ).toMatchObject({ ok: true, identity: { uid: "uid-b" } });
  });

  it("rejects a completed or auth_deleted uid as invalid_token", async () => {
    state.records.set("uid-c", { status: "completed" });
    expect(await verifyIdToken("token", { verifyToken: verifyAs("uid-c") })).toEqual({
      ok: false,
      error: "invalid_token",
    });
    state.records.set("uid-c", { status: "auth_deleted" });
    expect(await verifyIdToken("token", { verifyToken: verifyAs("uid-c") })).toEqual({
      ok: false,
      error: "invalid_token",
    });
  });

  it("fails closed as auth_unavailable on a malformed record or a failed Firestore read", async () => {
    state.records.set("uid-d", { status: "bogus" });
    expect(await verifyIdToken("token", { verifyToken: verifyAs("uid-d") })).toEqual({
      ok: false,
      error: "auth_unavailable",
    });
    state.records.clear();
    state.failRead = true;
    expect(await verifyIdToken("token", { verifyToken: verifyAs("uid-e") })).toEqual({
      ok: false,
      error: "auth_unavailable",
    });
    state.failRead = false;
  });
});
