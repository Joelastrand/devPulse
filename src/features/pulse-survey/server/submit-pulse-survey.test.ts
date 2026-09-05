import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PulseSurveyCollection } from "./submit-pulse-survey";
import { submitPulseSurvey } from "./submit-pulse-survey";

const validPayload = {
  answers: [1, 5, 3],
  teamId: "platform",
};

function fakeCollection(
  overrides: Partial<PulseSurveyCollection> = {},
): PulseSurveyCollection & { writes: unknown[] } {
  const writes: unknown[] = [];
  return {
    writes,
    add: vi.fn(async (record) => {
      writes.push(record);
      return { id: "fake-id" };
    }),
    ...overrides,
  };
}

describe("submitPulseSurvey", () => {
  beforeEach(() => {
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("persists exactly one minimal-shape, encrypted document for a valid submission", async () => {
    const collection = fakeCollection();

    const result = await submitPulseSurvey(validPayload, {
      now: new Date("2026-09-01T00:00:00Z"),
      collection,
    });

    expect(result).toEqual({ ok: true });
    expect(collection.writes).toHaveLength(1);

    const written = collection.writes[0] as Record<string, unknown>;
    expect(Object.keys(written).sort()).toEqual(
      ["authTag", "ciphertext", "iv", "keyVersion", "period", "teamId"].sort(),
    );
    expect(written.teamId).toBe("platform");
    expect(written.period).toBe("2026-W36");
    expect(typeof written.ciphertext).toBe("string");
    expect(typeof written.iv).toBe("string");
    expect(typeof written.authTag).toBe("string");
    expect(written.keyVersion).toBe("v1");
  });

  it("never persists the raw answer values in plaintext", async () => {
    const collection = fakeCollection();

    await submitPulseSurvey(validPayload, { collection });

    const written = JSON.stringify(collection.writes[0]);
    expect(written).not.toContain("1,5,3");
    expect(written).not.toMatch(/"answers"/);
  });

  it("rejects an invalid submission and attempts no write", async () => {
    const collection = fakeCollection();

    const result = await submitPulseSurvey(
      { answers: [1, 6, 3], teamId: "platform" },
      { collection },
    );

    expect(result).toEqual({ ok: false, error: "invalid_submission" });
    expect(collection.writes).toHaveLength(0);
  });

  it("rejects a missing/invalid teamId and attempts no write", async () => {
    const collection = fakeCollection();

    const result = await submitPulseSurvey(
      { answers: [1, 5, 3], teamId: "not-a-team" },
      { collection },
    );

    expect(result).toEqual({ ok: false, error: "invalid_submission" });
    expect(collection.writes).toHaveLength(0);
  });

  it("rejects a malformed (non-object) payload and attempts no write", async () => {
    const collection = fakeCollection();

    const result = await submitPulseSurvey("not an object", { collection });

    expect(result).toEqual({ ok: false, error: "invalid_submission" });
    expect(collection.writes).toHaveLength(0);
  });

  it("reports failure, not partial success, when the Firestore write fails", async () => {
    const collection = fakeCollection({
      add: vi.fn(async () => {
        throw new Error("simulated firestore outage");
      }),
    });

    const result = await submitPulseSurvey(validPayload, { collection });

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("fails closed with a generic error and attempts no write when ENCRYPTION_KEY is missing", async () => {
    vi.stubEnv("ENCRYPTION_KEY", "");
    const collection = fakeCollection();

    const result = await submitPulseSurvey(validPayload, { collection });

    expect(result).toEqual({ ok: false, error: "encryption_failed" });
    expect(collection.writes).toHaveLength(0);
  });

  it("fails closed with a generic error and attempts no write when ENCRYPTION_KEY is invalid", async () => {
    vi.stubEnv("ENCRYPTION_KEY", "abc");
    const collection = fakeCollection();

    const result = await submitPulseSurvey(validPayload, { collection });

    expect(result).toEqual({ ok: false, error: "encryption_failed" });
    expect(collection.writes).toHaveLength(0);
  });

  it("allows two submissions for the same period to both succeed independently", async () => {
    const collection = fakeCollection();

    const first = await submitPulseSurvey(validPayload, { collection });
    const second = await submitPulseSurvey(validPayload, { collection });

    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: true });
    expect(collection.writes).toHaveLength(2);
  });

  it("produces distinct ciphertext for two submissions with identical answers", async () => {
    const collection = fakeCollection();

    await submitPulseSurvey(validPayload, { collection });
    await submitPulseSurvey(validPayload, { collection });

    const [first, second] = collection.writes as Array<Record<string, unknown>>;
    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(first.iv).not.toBe(second.iv);
  });

  it("uses the server-computed period, ignoring any client-supplied period value", async () => {
    const collection = fakeCollection();

    const result = await submitPulseSurvey(
      { ...validPayload, period: "2020-W01" },
      { now: new Date("2026-09-01T00:00:00Z"), collection },
    );

    expect(result).toEqual({ ok: true });
    expect((collection.writes[0] as Record<string, unknown>).period).toBe(
      "2026-W36",
    );
  });

  it("never logs the request payload, answers, or key material for success or failure", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const collection = fakeCollection();
    await submitPulseSurvey(validPayload, { collection });

    const failingCollection = fakeCollection({
      add: vi.fn(async () => {
        throw new Error("simulated firestore outage");
      }),
    });
    await submitPulseSurvey(validPayload, { collection: failingCollection });

    vi.stubEnv("ENCRYPTION_KEY", "");
    const encryptionFailureResult = await submitPulseSurvey(validPayload, {
      collection,
    });

    expect(encryptionFailureResult).toEqual({
      ok: false,
      error: "encryption_failed",
    });
    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
