import { describe, expect, it } from "vitest";
import { getBuiltInTemplate } from "./templates";
import { decodeResponsePayload, encodeResponsePayload } from "./response-payload";
import { computeSurveyStatistics } from "./question-statistics";
import {
  addOption,
  addQuestion,
  changeQuestionType,
  draftToPatch,
  generateId,
  moveQuestion,
  newQuestion,
  removeOption,
  toDateTimeLocal,
  draftFromSource,
} from "./survey-draft";
import type { AnswerValue, SurveyQuestion } from "./question-definitions";
import { groupSurveys, groupOf } from "../components/workspace/survey-groups";
import type { AdminSurveyEntry } from "../client/admin-survey-gateway";

const TEAM_PULSE = getBuiltInTemplate("team-pulse").questions;
const CONFIGURED = {
  questions: [
    { id: "energy", type: "rating", prompt: "Energi", required: true },
    {
      id: "mood",
      type: "single_choice",
      prompt: "Humør",
      required: true,
      options: [
        { id: "good", label: "Godt" },
        { id: "bad", label: "Dårlig" },
      ],
    },
  ] as SurveyQuestion[],
  questionSetVersion: 2 as const,
};

describe("response payload codec", () => {
  it("encodes a legacy survey as the original array, and decodes it back to question ids", () => {
    const plaintext = encodeResponsePayload({}, { flow: 2, stress: 3, fun: 4 });
    expect(plaintext).toBe("[2,3,4]");
    expect(decodeResponsePayload({}, "[2,3,4]")).toEqual({ flow: 2, stress: 3, fun: 4 });
  });

  it("encodes a configurable survey as a versioned envelope and decodes it", () => {
    const plaintext = encodeResponsePayload(CONFIGURED, { energy: 5, mood: "good" });
    expect(plaintext).toBe('{"version":2,"answers":{"energy":5,"mood":"good"}}');
    expect(decodeResponsePayload(CONFIGURED, plaintext as string)).toEqual({ energy: 5, mood: "good" });
  });

  it("refuses to encode an answer that the survey's own question set does not allow", () => {
    expect(encodeResponsePayload(CONFIGURED, { energy: 9, mood: "good" })).toBeNull();
    expect(encodeResponsePayload({}, { flow: 2 })).toBeNull();
  });

  it("returns null when decoding a payload that does not match the survey", () => {
    expect(decodeResponsePayload(CONFIGURED, "[1,2,3]")).toBeNull();
    expect(decodeResponsePayload({}, '{"version":2,"answers":{}}')).toBeNull();
    expect(decodeResponsePayload({}, "not json")).toBeNull();
  });

  it("maps legacy Team Pulse payloads onto the built-in question ids", () => {
    expect(decodeResponsePayload({ questions: TEAM_PULSE, questionSetVersion: undefined }, "[1,1,1]")).toEqual({
      flow: 1,
      stress: 1,
      fun: 1,
    });
  });
});

describe("computeSurveyStatistics", () => {
  const questions = CONFIGURED.questions;

  it("publishes nothing when the survey is below its threshold", () => {
    expect(computeSurveyStatistics(questions, [{ energy: 5 }], 3)).toEqual({ status: "insufficient" });
  });

  it("computes rating mean and distribution, and option counts", () => {
    const responses = [
      { energy: 5, mood: "good" },
      { energy: 3, mood: "bad" },
      { energy: 4, mood: "good" },
    ];
    const stats = computeSurveyStatistics(questions, responses, 3);
    if (stats.status !== "published") {
      throw new Error("expected published");
    }
    const [rating, choice] = stats.questions;
    expect(rating).toMatchObject({
      status: "published",
      mean: 4,
      distribution: { "1": 0, "2": 0, "3": 1, "4": 1, "5": 1 },
    });
    expect(choice).toMatchObject({
      status: "published",
      options: [
        { id: "good", count: 2 },
        { id: "bad", count: 1 },
      ],
    });
  });

  it("suppresses a question that fewer than the threshold answered, even if the survey publishes", () => {
    const responses: Record<string, AnswerValue>[] = [{ energy: 5 }, { energy: 4 }, { energy: 2 }, { energy: 1, mood: "good" }];
    const stats = computeSurveyStatistics(questions, responses, 3);
    if (stats.status !== "published") {
      throw new Error("expected published");
    }
    expect(stats.questions[1]).toEqual({
      questionId: "mood",
      prompt: "Humør",
      type: "single_choice",
      status: "insufficient",
    });
  });
});

describe("survey draft model", () => {
  it("generates ids that are unique within a set and match the server id pattern", () => {
    const taken = new Set(["q1"]);
    const id = generateId("q", taken);
    expect(id).not.toBe("q1");
    expect(id).toMatch(/^[a-z][a-z0-9_]{0,39}$/);
  });

  it("adds a question with a fresh id and stops at the server maximum of 20", () => {
    let questions: SurveyQuestion[] = [];
    for (let i = 0; i < 25; i += 1) {
      questions = addQuestion(questions, "rating");
    }
    expect(questions).toHaveLength(20);
    expect(new Set(questions.map((question) => question.id)).size).toBe(20);
  });

  it("moves a question and ignores out-of-range moves", () => {
    const [a, b, c] = TEAM_PULSE;
    expect(moveQuestion([a, b, c], 0, 1).map((q) => q.id)).toEqual(["stress", "flow", "fun"]);
    expect(moveQuestion([a, b, c], 0, -1).map((q) => q.id)).toEqual(["flow", "stress", "fun"]);
  });

  it("switching to free text makes the question optional, and switching back keeps options", () => {
    const choice = newQuestion("single_choice", []);
    const asText = changeQuestionType({ ...choice, required: true }, "free_text");
    expect(asText).toMatchObject({ type: "free_text", required: false });
    const backToChoice = changeQuestionType(choice, "multiple_choice");
    expect(backToChoice).toMatchObject({
      type: "multiple_choice",
      options: choice.type === "single_choice" ? choice.options : [],
    });
  });

  it("caps options at ten and removes them without going below zero", () => {
    let question = newQuestion("single_choice", []);
    for (let i = 0; i < 12; i += 1) {
      question = addOption(question);
    }
    if (question.type !== "single_choice") {
      throw new Error("expected choice");
    }
    expect(question.options).toHaveLength(10);
    let shrunk: SurveyQuestion = question;
    for (let i = 0; i < 12; i += 1) {
      shrunk = removeOption(shrunk, 0);
    }
    if (shrunk.type !== "single_choice") {
      throw new Error("expected choice");
    }
    expect(shrunk.options).toHaveLength(0);
  });

  it("maps empty optional text to null in the patch, and keeps the question order", () => {
    const draft = draftFromSource({ title: "  ", description: "", startAt: "", endAt: "", questions: TEAM_PULSE });
    const patch = draftToPatch(draft);
    expect(patch).toMatchObject({ title: null, description: null, startAt: null, endAt: null });
    expect(patch.questions.map((question) => question.id)).toEqual(["flow", "stress", "fun"]);
  });

  it("formats an ISO instant for a datetime-local input and returns empty for missing input", () => {
    expect(toDateTimeLocal(undefined)).toBe("");
    expect(toDateTimeLocal("not a date")).toBe("");
    expect(toDateTimeLocal("2026-10-01T10:30:00.000Z")).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });
});

function entry(overrides: Partial<AdminSurveyEntry>): AdminSurveyEntry {
  return {
    surveyId: "s",
    accessMode: "public",
    minimumResponses: 5,
    lifecycle: "scheduled",
    archived: false,
    createdBy: "admin",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("workspace grouping", () => {
  it("shows a never-opened survey as a draft even when it has a planned start", () => {
    expect(groupOf(entry({ startAt: "2026-10-01T00:00:00.000Z" }))).toBe("draft");
  });

  it("groups open, closed and archived surveys separately, and archived wins over closed", () => {
    const groups = groupSurveys([
      entry({ surveyId: "a", lifecycle: "open" }),
      entry({ surveyId: "b", lifecycle: "closed" }),
      entry({ surveyId: "c", lifecycle: "closed", archived: true }),
    ]);
    expect(groups.open.map((survey) => survey.surveyId)).toEqual(["a"]);
    expect(groups.closed.map((survey) => survey.surveyId)).toEqual(["b"]);
    expect(groups.archived.map((survey) => survey.surveyId)).toEqual(["c"]);
  });
});
