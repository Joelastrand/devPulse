import { describe, expect, it } from "vitest";
import {
  validateAnswers,
  validateQuestionDefinitions,
  type SurveyQuestion,
} from "./question-definitions";
import { getBuiltInTemplate, listBuiltInTemplates } from "./templates";

const rating: SurveyQuestion = { id: "flow", type: "rating", prompt: "Flyt", required: true };
const single: SurveyQuestion = {
  id: "mood",
  type: "single_choice",
  prompt: "Humør",
  required: true,
  options: [
    { id: "good", label: "Bra" },
    { id: "bad", label: "Dårlig" },
  ],
};
const multi: SurveyQuestion = {
  id: "topics",
  type: "multiple_choice",
  prompt: "Temaer",
  required: false,
  options: [
    { id: "a", label: "A" },
    { id: "b", label: "B" },
  ],
};
const text: SurveyQuestion = {
  id: "note",
  type: "free_text",
  prompt: "Notat",
  required: false,
  maxLength: 20,
};

describe("validateQuestionDefinitions", () => {
  it("accepts one valid question of each type", () => {
    const result = validateQuestionDefinitions([rating, single, multi, text]);
    expect(result.ok).toBe(true);
  });

  it("rejects a non-array, an empty set, and more than 20 questions", () => {
    expect(validateQuestionDefinitions("nope")).toEqual({ ok: false, error: "invalid_questions" });
    expect(validateQuestionDefinitions([])).toEqual({ ok: false, error: "invalid_question_count" });
    const many = Array.from({ length: 21 }, (_, i) => ({ ...rating, id: `q${i}` }));
    expect(validateQuestionDefinitions(many)).toEqual({ ok: false, error: "invalid_question_count" });
  });

  it("rejects duplicate question ids", () => {
    expect(validateQuestionDefinitions([rating, { ...single, id: "flow" }])).toEqual({
      ok: false,
      error: "duplicate_question_id",
    });
  });

  it("rejects unknown question types", () => {
    expect(validateQuestionDefinitions([{ ...rating, type: "slider" }])).toEqual({
      ok: false,
      error: "invalid_question_type",
    });
  });

  it("rejects malformed ids and empty prompts", () => {
    expect(validateQuestionDefinitions([{ ...rating, id: "Bad Id" }])).toEqual({
      ok: false,
      error: "invalid_question_id",
    });
    expect(validateQuestionDefinitions([{ ...rating, prompt: "   " }])).toEqual({
      ok: false,
      error: "invalid_prompt",
    });
  });

  it("rejects choice questions with fewer than 2 options or duplicate option ids", () => {
    expect(
      validateQuestionDefinitions([{ ...single, options: [{ id: "a", label: "A" }] }]),
    ).toEqual({ ok: false, error: "invalid_options" });
    expect(
      validateQuestionDefinitions([
        {
          ...single,
          options: [
            { id: "a", label: "A" },
            { id: "a", label: "B" },
          ],
        },
      ]),
    ).toEqual({ ok: false, error: "duplicate_option_id" });
  });

  it("rejects an out-of-range free-text max length", () => {
    expect(validateQuestionDefinitions([{ ...text, maxLength: 0 }])).toEqual({
      ok: false,
      error: "invalid_max_length",
    });
  });
});

describe("validateAnswers", () => {
  const questions = [rating, single, multi, text];

  it("accepts a complete valid payload", () => {
    const result = validateAnswers(questions, {
      flow: 4,
      mood: "good",
      topics: ["b", "a"],
      note: "ok",
    });
    expect(result).toEqual({
      ok: true,
      answers: { flow: 4, mood: "good", topics: ["b", "a"], note: "ok" },
    });
  });

  it("rejects a missing required answer and an unknown key", () => {
    expect(validateAnswers(questions, { mood: "good" })).toEqual({
      ok: false,
      error: "invalid_answers",
    });
    expect(validateAnswers([rating], { flow: 3, extra: 1 })).toEqual({
      ok: false,
      error: "invalid_answers",
    });
  });

  it("rejects out-of-range ratings and non-integer ratings", () => {
    expect(validateAnswers([rating], { flow: 6 }).ok).toBe(false);
    expect(validateAnswers([rating], { flow: 2.5 }).ok).toBe(false);
    expect(validateAnswers([rating], { flow: "3" }).ok).toBe(false);
  });

  it("rejects an option id that is not part of the question", () => {
    expect(validateAnswers([single], { mood: "meh" }).ok).toBe(false);
  });

  it("rejects duplicate choices in a multiple-choice answer", () => {
    expect(validateAnswers([multi], { topics: ["a", "a"] }).ok).toBe(false);
  });

  it("omits an empty optional free-text answer and rejects an over-long one", () => {
    expect(validateAnswers([text], { note: "   " })).toEqual({ ok: true, answers: {} });
    expect(validateAnswers([text], { note: "x".repeat(21) }).ok).toBe(false);
  });
});

describe("free-text privacy rule", () => {
  it("rejects a required free-text question", () => {
    expect(validateQuestionDefinitions([{ ...text, required: true }])).toEqual({
      ok: false,
      error: "free_text_must_be_optional",
    });
  });

  it("accepts an optional free-text question", () => {
    expect(validateQuestionDefinitions([text]).ok).toBe(true);
  });
});

describe("built-in templates", () => {
  it("returns independent copies so editing one cannot change the template", () => {
    const first = getBuiltInTemplate("team-pulse");
    first.questions[0].prompt = "Changed";
    const second = getBuiltInTemplate("team-pulse");
    expect(second.questions[0].prompt).toBe("Arbeidsflyt og leveransetilfredshet");
  });

  it("keeps Team Pulse as the legacy Flow/Stress/Fun set", () => {
    const pulse = getBuiltInTemplate("team-pulse");
    expect(pulse.questions.map((question) => question.id)).toEqual(["flow", "stress", "fun"]);
  });

  it("every built-in template passes question validation", () => {
    for (const template of listBuiltInTemplates()) {
      expect(validateQuestionDefinitions(template.questions).ok).toBe(true);
    }
  });
});
