import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openSurveyDocument, splitSurveyContent, toPersistedSurvey } from "./survey-content-codec";

/**
 * Storage boundary of the survey authored content. The persisted document must hold no plaintext title, description or
 * question; authorized reads open it; a missing key, tampering and cross-record substitution all fail closed.
 */
const SURVEY_ID = "survey-1";
const TEAM_ID = "team-1";
const SECRET_TITLE = "Synthetic pulse title";
const SECRET_QUESTION = "Synthetic question text";

const plain = {
  teamId: TEAM_ID,
  accessMode: "public",
  minimumResponses: 5,
  questionSetVersion: 2,
  createdAt: new Date("2026-08-01T00:00:00Z"),
  createdBy: "admin-1",
  title: SECRET_TITLE,
  description: "Synthetic description",
  questions: [{ id: "q1", prompt: SECRET_QUESTION }],
};

beforeEach(() => {
  vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
});

describe("survey content storage boundary", () => {
  it("persists no plaintext title, description or question, and keeps identifiers and lifecycle metadata plaintext", () => {
    const persisted = toPersistedSurvey(SURVEY_ID, plain);

    expect(persisted).toMatchObject({ teamId: TEAM_ID, accessMode: "public", minimumResponses: 5, questionSetVersion: 2, createdBy: "admin-1" });
    expect(persisted).not.toHaveProperty("title");
    expect(persisted).not.toHaveProperty("description");
    expect(persisted).not.toHaveProperty("questions");
    expect(persisted.content).toMatchObject({ keyVersion: "v2", keyId: "k1" });
    expect(JSON.stringify(persisted)).not.toContain(SECRET_TITLE);
    expect(JSON.stringify(persisted)).not.toContain(SECRET_QUESTION);
  });

  it("opens the persisted document back to its authored fields for the owning survey", () => {
    const opened = openSurveyDocument(SURVEY_ID, toPersistedSurvey(SURVEY_ID, plain)) as Record<string, unknown>;

    expect(opened).toMatchObject({ teamId: TEAM_ID, title: SECRET_TITLE, description: "Synthetic description" });
    expect(opened.questions).toEqual(plain.questions);
    expect(opened).not.toHaveProperty("content");
  });

  it("leaves an absent optional title and description absent after opening", () => {
    const { title: _title, description: _description, ...withoutOptional } = plain;
    const opened = openSurveyDocument(SURVEY_ID, toPersistedSurvey(SURVEY_ID, withoutOptional)) as Record<string, unknown>;

    expect(opened).not.toHaveProperty("title");
    expect(opened).not.toHaveProperty("description");
  });

  it("refuses a document that still carries plaintext authored content", () => {
    const persisted = toPersistedSurvey(SURVEY_ID, plain);

    expect(openSurveyDocument(SURVEY_ID, { ...persisted, title: SECRET_TITLE })).toBeNull();
    expect(openSurveyDocument(SURVEY_ID, { teamId: TEAM_ID, accessMode: "public", questions: plain.questions })).toBeNull();
  });

  it("fails closed when the key is missing, with no plaintext fallback", () => {
    const persisted = toPersistedSurvey(SURVEY_ID, plain);
    vi.stubEnv("ENCRYPTION_KEY", "");

    expect(() => openSurveyDocument(SURVEY_ID, persisted)).toThrow();
  });

  it("rejects tampered ciphertext instead of returning altered content", () => {
    const persisted = toPersistedSurvey(SURVEY_ID, plain);
    const content = persisted.content as { ciphertext: string };
    const flipped = Buffer.from(content.ciphertext, "base64");
    flipped[0] = (flipped[0] ?? 0) ^ 0xff;
    const tampered = { ...persisted, content: { ...content, ciphertext: flipped.toString("base64") } };

    expect(openSurveyDocument(SURVEY_ID, tampered)).toBeNull();
  });

  it("rejects an envelope moved to another survey of the same team", () => {
    const persisted = toPersistedSurvey(SURVEY_ID, plain);

    expect(openSurveyDocument("survey-2", persisted)).toBeNull();
  });

  it("rejects an envelope moved to another team", () => {
    const persisted = toPersistedSurvey(SURVEY_ID, plain);

    expect(openSurveyDocument(SURVEY_ID, { ...persisted, teamId: "team-2" })).toBeNull();
  });

  it("splits only the authored fields into content and keeps everything else as metadata", () => {
    const { metadata, content } = splitSurveyContent(plain);

    expect(Object.keys(content).sort()).toEqual(["description", "questions", "title"]);
    expect(metadata).not.toHaveProperty("questions");
    expect(metadata.teamId).toBe(TEAM_ID);
  });
});
