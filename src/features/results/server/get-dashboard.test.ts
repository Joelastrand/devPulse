import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encrypt } from "../../../lib/encryption/encryption";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import type { ResultsCollection, ResultsQueryRecord } from "./get-dashboard";
import { getDashboard } from "./get-dashboard";

const NOW = new Date("2026-09-05T12:00:00.000Z"); // 2026-W36 is the current (open) period.
const OPEN_PERIOD = "2026-W36";
const MOST_RECENT_CLOSED_PERIOD = "2026-W35";
const VERIFIED_EMAIL = "dev@example.com";
const ASSIGNMENTS = { [VERIFIED_EMAIL]: "platform" };

function verifiedIdentity(overrides: Partial<VerifiedIdentity> = {}): VerifiedIdentity {
  return { uid: "user-1", email: VERIFIED_EMAIL, emailVerified: true, ...overrides };
}

function verifyTokenReturning(identity: VerifiedIdentity) {
  return vi.fn().mockResolvedValue({
    uid: identity.uid,
    email: identity.email,
    email_verified: identity.emailVerified,
  });
}

function encryptedAnswers(answers: [number, number, number]) {
  return encrypt(JSON.stringify(answers));
}

function fakeCollection(
  records: ResultsQueryRecord[] = [],
): ResultsCollection & { calls: Array<{ teamId: string; periods: readonly string[] }> } {
  const calls: Array<{ teamId: string; periods: readonly string[] }> = [];
  return {
    calls,
    async listForTeamAndPeriods(teamId, periods) {
      calls.push({ teamId, periods });
      return records.filter((record) => periods.includes(record.period));
    },
  };
}

function fiveValidRecordsFor(period: string): ResultsQueryRecord[] {
  return [
    [1, 2, 3],
    [2, 3, 4],
    [3, 4, 5],
    [4, 5, 1],
    [5, 1, 2],
  ].map((answers) => ({ period, ...encryptedAnswers(answers as [number, number, number]) }));
}

describe("getDashboard", () => {
  beforeEach(() => {
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects an invalid token before resolving a team or reading any data", async () => {
    const collection = fakeCollection();
    const verifyToken = vi.fn().mockRejectedValue(new Error("bad token"));

    const result = await getDashboard("bad-token", { verifyToken, collection, now: NOW });

    expect(result).toEqual({ ok: false, error: "unauthenticated" });
    expect(collection.calls).toHaveLength(0);
  });

  it("returns no_team for a verified email absent from the assignment mapping, without reading data", async () => {
    const collection = fakeCollection();
    const verifyToken = verifyTokenReturning(verifiedIdentity({ email: "nobody@example.com" }));

    const result = await getDashboard("token", {
      verifyToken,
      assignments: ASSIGNMENTS,
      collection,
      now: NOW,
    });

    expect(result).toEqual({ ok: false, error: "no_team" });
    expect(collection.calls).toHaveLength(0);
  });

  it("returns no_team for a mapped but unverified email, without reading data", async () => {
    const collection = fakeCollection();
    const verifyToken = verifyTokenReturning(verifiedIdentity({ emailVerified: false }));

    const result = await getDashboard("token", {
      verifyToken,
      assignments: ASSIGNMENTS,
      collection,
      now: NOW,
    });

    expect(result).toEqual({ ok: false, error: "no_team" });
    expect(collection.calls).toHaveLength(0);
  });

  it("queries only the caller's own resolved team, never a client-supplied one", async () => {
    const collection = fakeCollection();
    const verifyToken = verifyTokenReturning(verifiedIdentity());

    await getDashboard("token", {
      verifyToken,
      assignments: ASSIGNMENTS,
      collection,
      now: NOW,
    });

    expect(collection.calls).toHaveLength(1);
    expect(collection.calls[0].teamId).toBe("platform");
  });

  it("requests exactly the 12 preceding closed periods, never the open period", async () => {
    const collection = fakeCollection();
    const verifyToken = verifyTokenReturning(verifiedIdentity());

    await getDashboard("token", {
      verifyToken,
      assignments: ASSIGNMENTS,
      collection,
      now: NOW,
    });

    const requestedPeriods = collection.calls[0].periods;
    expect(requestedPeriods).toHaveLength(12);
    expect(requestedPeriods).not.toContain(OPEN_PERIOD);
    expect(requestedPeriods[requestedPeriods.length - 1]).toBe(MOST_RECENT_CLOSED_PERIOD);
  });

  it("returns the most recently closed period as `current`, matching the trend's last entry", async () => {
    const collection = fakeCollection(fiveValidRecordsFor(MOST_RECENT_CLOSED_PERIOD));
    const verifyToken = verifyTokenReturning(verifiedIdentity());

    const result = await getDashboard("token", {
      verifyToken,
      assignments: ASSIGNMENTS,
      collection,
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.current).toEqual(result.trend[result.trend.length - 1]);
    expect(result.current).toEqual({
      period: MOST_RECENT_CLOSED_PERIOD,
      status: "published",
      mean: { flow: 3, stress: 3, fun: 3 },
      count: 5,
    });
  });

  it("marks a period with no responses as insufficient, never as an aggregate with a zero count", async () => {
    const collection = fakeCollection();
    const verifyToken = verifyTokenReturning(verifiedIdentity());

    const result = await getDashboard("token", {
      verifyToken,
      assignments: ASSIGNMENTS,
      collection,
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.current).toEqual({ period: MOST_RECENT_CLOSED_PERIOD, status: "insufficient" });
    expect(result.trend.every((entry) => entry.status !== "not_available")).toBe(true);
  });

  it("reports a read failure as a failure result, not a partial/fabricated dashboard", async () => {
    const collection: ResultsCollection = {
      listForTeamAndPeriods: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };
    const verifyToken = verifyTokenReturning(verifiedIdentity());

    const result = await getDashboard("token", {
      verifyToken,
      assignments: ASSIGNMENTS,
      collection,
      now: NOW,
    });

    expect(result).toEqual({ ok: false, error: "read_failed" });
  });

  it("is deterministic: requesting the same closed-period data twice yields identical results (BR-12)", async () => {
    const records = fiveValidRecordsFor(MOST_RECENT_CLOSED_PERIOD);
    const verifyToken = verifyTokenReturning(verifiedIdentity());

    const first = await getDashboard("token", {
      verifyToken,
      assignments: ASSIGNMENTS,
      collection: fakeCollection(records),
      now: NOW,
    });
    const second = await getDashboard("token", {
      verifyToken,
      assignments: ASSIGNMENTS,
      collection: fakeCollection(records),
      now: NOW,
    });

    expect(first).toEqual(second);
  });

  it("never logs the token, identity, decrypted content, or read-failure detail", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const verifyToken = verifyTokenReturning(verifiedIdentity());
    await getDashboard("token", {
      verifyToken,
      assignments: ASSIGNMENTS,
      collection: fakeCollection(fiveValidRecordsFor(MOST_RECENT_CLOSED_PERIOD)),
      now: NOW,
    });

    const failingCollection: ResultsCollection = {
      listForTeamAndPeriods: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };
    await getDashboard("token", {
      verifyToken,
      assignments: ASSIGNMENTS,
      collection: failingCollection,
      now: NOW,
    });

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
