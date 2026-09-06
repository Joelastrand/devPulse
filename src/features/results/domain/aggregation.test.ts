import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encrypt } from "../../../lib/encryption/encryption";
import {
  computePeriodAggregate,
  MIN_RESPONSE_THRESHOLD,
  type CandidateResponseRecord,
} from "./aggregation";

const NOW = new Date("2026-09-05T12:00:00.000Z"); // 2026-W36 is the current (open) period.
const CLOSED_PERIOD = "2026-W35";
const OPEN_PERIOD = "2026-W36";
const FUTURE_PERIOD = "2026-W37";

function encryptedAnswers(answers: [number, number, number]): CandidateResponseRecord {
  return encrypt(JSON.stringify(answers));
}

function tamper(record: CandidateResponseRecord): CandidateResponseRecord {
  const bytes = Buffer.from(record.ciphertext, "base64");
  bytes[0] = bytes[0] ^ 0xff;
  return { ...record, ciphertext: bytes.toString("base64") };
}

function fiveValidRecords(): CandidateResponseRecord[] {
  return [
    encryptedAnswers([1, 2, 3]),
    encryptedAnswers([2, 3, 4]),
    encryptedAnswers([3, 4, 5]),
    encryptedAnswers([4, 5, 1]),
    encryptedAnswers([5, 1, 2]),
  ];
}

describe("computePeriodAggregate", () => {
  beforeEach(() => {
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("never produces an aggregate for the current (open) period, regardless of input", () => {
    const result = computePeriodAggregate(OPEN_PERIOD, fiveValidRecords(), {
      now: NOW,
    });

    expect(result).toEqual({ period: OPEN_PERIOD, status: "not_available" });
  });

  it("never produces an aggregate for a period after the current one", () => {
    const result = computePeriodAggregate(FUTURE_PERIOD, fiveValidRecords(), {
      now: NOW,
    });

    expect(result).toEqual({ period: FUTURE_PERIOD, status: "not_available" });
  });

  it("treats the open period as ineligible even with zero candidate records", () => {
    const result = computePeriodAggregate(OPEN_PERIOD, [], { now: NOW });

    expect(result).toEqual({ period: OPEN_PERIOD, status: "not_available" });
  });

  it("withholds the count and publishes 'insufficient' below the threshold, including zero", () => {
    const zero = computePeriodAggregate(CLOSED_PERIOD, [], { now: NOW });
    const belowThreshold = computePeriodAggregate(
      CLOSED_PERIOD,
      fiveValidRecords().slice(0, MIN_RESPONSE_THRESHOLD - 1),
      { now: NOW },
    );

    expect(zero).toEqual({ period: CLOSED_PERIOD, status: "insufficient" });
    expect(belowThreshold).toEqual({
      period: CLOSED_PERIOD,
      status: "insufficient",
    });
  });

  it("publishes mean and count once the threshold is met for a closed period", () => {
    const result = computePeriodAggregate(CLOSED_PERIOD, fiveValidRecords(), {
      now: NOW,
    });

    expect(result).toEqual({
      period: CLOSED_PERIOD,
      status: "published",
      mean: { flow: 3, stress: 3, fun: 3 },
      count: 5,
    });
  });

  it("excludes undecryptable (tampered) records from both count and mean without throwing", () => {
    const records = [
      ...fiveValidRecords(),
      tamper(encryptedAnswers([5, 5, 5])),
      tamper(encryptedAnswers([5, 5, 5])),
    ];

    expect(() =>
      computePeriodAggregate(CLOSED_PERIOD, records, { now: NOW }),
    ).not.toThrow();

    const result = computePeriodAggregate(CLOSED_PERIOD, records, { now: NOW });
    expect(result).toEqual({
      period: CLOSED_PERIOD,
      status: "published",
      mean: { flow: 3, stress: 3, fun: 3 },
      count: 5,
    });
  });

  it("excludes schema-invalid decrypted content (out-of-range/malformed) from count and mean", () => {
    const outOfRange = encrypt(JSON.stringify([0, 6, 3]));
    const wrongShape = encrypt(JSON.stringify([1, 2]));
    const nonJson = encrypt("not json");

    const records = [
      ...fiveValidRecords(),
      outOfRange,
      wrongShape,
      nonJson,
    ];

    const result = computePeriodAggregate(CLOSED_PERIOD, records, { now: NOW });

    expect(result).toEqual({
      period: CLOSED_PERIOD,
      status: "published",
      mean: { flow: 3, stress: 3, fun: 3 },
      count: 5,
    });
  });

  it("respects a configured threshold override", () => {
    const result = computePeriodAggregate(
      CLOSED_PERIOD,
      fiveValidRecords().slice(0, 2),
      { now: NOW, threshold: 2 },
    );

    expect(result.status).toBe("published");
  });

  it("is deterministic: recomputing from an identical closed-period input set yields the same result (BR-12)", () => {
    const records = fiveValidRecords();

    const first = computePeriodAggregate(CLOSED_PERIOD, records, { now: NOW });
    const second = computePeriodAggregate(CLOSED_PERIOD, records, { now: NOW });

    expect(first).toEqual(second);
  });
});
