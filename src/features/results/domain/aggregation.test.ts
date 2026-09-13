import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encrypt } from "../../../lib/encryption/encryption";
import { computeSurveyAggregate, type CandidateResponseRecord } from "./aggregation";

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

describe("computeSurveyAggregate", () => {
  const SURVEY_ID = "survey-1";

  beforeEach(() => {
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("withholds the count and publishes 'insufficient' below the survey's own threshold, including zero", () => {
    const zero = computeSurveyAggregate(SURVEY_ID, [], 5);
    const belowThreshold = computeSurveyAggregate(SURVEY_ID, fiveValidRecords().slice(0, 4), 5);

    expect(zero).toEqual({ surveyId: SURVEY_ID, status: "insufficient" });
    expect(belowThreshold).toEqual({ surveyId: SURVEY_ID, status: "insufficient" });
  });

  it("publishes mean and count once the survey's own threshold is met", () => {
    const result = computeSurveyAggregate(SURVEY_ID, fiveValidRecords(), 5);

    expect(result).toEqual({
      surveyId: SURVEY_ID,
      status: "published",
      mean: { flow: 3, stress: 3, fun: 3 },
      count: 5,
    });
  });

  it("uses a lower threshold (3) to publish with fewer responses", () => {
    const result = computeSurveyAggregate(SURVEY_ID, fiveValidRecords().slice(0, 3), 3);

    expect(result.status).toBe("published");
    if (result.status === "published") {
      expect(result.count).toBe(3);
    }
  });

  it("threshold matrix: minimumResponses=3 — 2 responses suppressed, 3 published", () => {
    const two = computeSurveyAggregate(SURVEY_ID, fiveValidRecords().slice(0, 2), 3);
    const three = computeSurveyAggregate(SURVEY_ID, fiveValidRecords().slice(0, 3), 3);

    expect(two).toEqual({ surveyId: SURVEY_ID, status: "insufficient" });
    expect(three.status).toBe("published");
  });

  it("threshold matrix: minimumResponses=5 — 4 responses suppressed, 5 published", () => {
    const four = computeSurveyAggregate(SURVEY_ID, fiveValidRecords().slice(0, 4), 5);
    const five = computeSurveyAggregate(SURVEY_ID, fiveValidRecords(), 5);

    expect(four).toEqual({ surveyId: SURVEY_ID, status: "insufficient" });
    expect(five.status).toBe("published");
  });

  it("threshold matrix: minimumResponses=10 — 9 responses suppressed, 10 published", () => {
    const nineRecords = [
      ...fiveValidRecords(),
      ...fiveValidRecords().slice(0, 4),
    ];
    const tenRecords = [...fiveValidRecords(), ...fiveValidRecords()];

    const nine = computeSurveyAggregate(SURVEY_ID, nineRecords, 10);
    const ten = computeSurveyAggregate(SURVEY_ID, tenRecords, 10);

    expect(nine).toEqual({ surveyId: SURVEY_ID, status: "insufficient" });
    expect(ten.status).toBe("published");
  });

  it("never decrypts candidates when the raw count already proves it's below threshold", () => {
    const spy = vi.spyOn(JSON, "parse");
    computeSurveyAggregate(SURVEY_ID, fiveValidRecords().slice(0, 2), 5);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("excludes undecryptable (tampered) records from both count and mean without throwing", () => {
    const records = [
      ...fiveValidRecords(),
      tamper(encryptedAnswers([5, 5, 5])),
      tamper(encryptedAnswers([5, 5, 5])),
    ];

    expect(() => computeSurveyAggregate(SURVEY_ID, records, 5)).not.toThrow();
    const result = computeSurveyAggregate(SURVEY_ID, records, 5);
    expect(result).toEqual({
      surveyId: SURVEY_ID,
      status: "published",
      mean: { flow: 3, stress: 3, fun: 3 },
      count: 5,
    });
  });

  it("becomes insufficient when enough records fail to decrypt to drop below the threshold, even though the raw count met it", () => {
    const records = [
      ...fiveValidRecords().slice(0, 2),
      tamper(encryptedAnswers([5, 5, 5])),
      tamper(encryptedAnswers([5, 5, 5])),
      tamper(encryptedAnswers([5, 5, 5])),
    ];

    const result = computeSurveyAggregate(SURVEY_ID, records, 5);

    expect(result).toEqual({ surveyId: SURVEY_ID, status: "insufficient" });
  });

  it("is deterministic: recomputing from an identical input set yields the same result", () => {
    const records = fiveValidRecords();

    const first = computeSurveyAggregate(SURVEY_ID, records, 5);
    const second = computeSurveyAggregate(SURVEY_ID, records, 5);

    expect(first).toEqual(second);
  });
});
