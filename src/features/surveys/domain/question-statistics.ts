import type { AnswerValue, SurveyQuestion } from "./question-definitions";

/**
 * Per-question statistics for a closed survey (team-survey-builder SPEC —
 * "Statistics"). Pure: receives already-decoded, already-validated answers
 * and the survey's threshold, and never sees ciphertext or identity.
 *
 * Privacy rules enforced here:
 * - The survey as a whole publishes only when its valid response count reaches
 *   `minimumResponses`. Below that, no counts, means, or texts are returned.
 * - Each question publishes only when enough respondents answered *that*
 *   question, so an optional question can't reveal a small group's answers.
 * - Free-text answers are returned only inside a published question. They
 *   carry no timestamp, identity, or ordering that could link them to a person.
 */

export interface OptionCount {
  id: string;
  label: string;
  count: number;
}

export type QuestionStatistics =
  | {
      questionId: string;
      prompt: string;
      type: "rating";
      status: "published";
      answeredCount: number;
      mean: number;
      distribution: Record<"1" | "2" | "3" | "4" | "5", number>;
    }
  | {
      questionId: string;
      prompt: string;
      type: "single_choice" | "multiple_choice";
      status: "published";
      answeredCount: number;
      options: OptionCount[];
    }
  | {
      questionId: string;
      prompt: string;
      type: "free_text";
      status: "published";
      answeredCount: number;
      texts: string[];
    }
  | {
      questionId: string;
      prompt: string;
      type: "free_text";
      status: "restricted";
    }
  | {
      questionId: string;
      prompt: string;
      type: SurveyQuestion["type"];
      status: "insufficient";
    };

/**
 * Free-text answers are raw individual responses (docs/SECURITY.md invariant 17:
 * admin access does not imply access to raw responses). For a caller who is not
 * a non-admin team member, every free-text question is replaced by a
 * `restricted` marker that carries no text, so the content never leaves the
 * server for that caller.
 */
export function restrictFreeText(questions: readonly QuestionStatistics[]): QuestionStatistics[] {
  return questions.map((question) =>
    question.type === "free_text"
      ? { questionId: question.questionId, prompt: question.prompt, type: "free_text", status: "restricted" }
      : question,
  );
}

export type SurveyStatistics =
  | { status: "insufficient" }
  | { status: "published"; responseCount: number; questions: QuestionStatistics[] };

export function computeSurveyStatistics(
  questions: readonly SurveyQuestion[],
  responses: readonly Record<string, AnswerValue>[],
  minimumResponses: number,
): SurveyStatistics {
  if (responses.length < minimumResponses) {
    return { status: "insufficient" };
  }

  return {
    status: "published",
    responseCount: responses.length,
    questions: questions.map((question) => computeQuestionStatistics(question, responses, minimumResponses)),
  };
}

function computeQuestionStatistics(
  question: SurveyQuestion,
  responses: readonly Record<string, AnswerValue>[],
  minimumResponses: number,
): QuestionStatistics {
  const values = responses
    .map((response) => response[question.id])
    .filter((value): value is AnswerValue => value !== undefined);

  if (values.length < minimumResponses) {
    return { questionId: question.id, prompt: question.prompt, type: question.type, status: "insufficient" };
  }

  switch (question.type) {
    case "rating": {
      const ratings = values.filter((value): value is number => typeof value === "number");
      const distribution = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
      for (const rating of ratings) {
        distribution[String(rating) as keyof typeof distribution] += 1;
      }
      const sum = ratings.reduce((total, rating) => total + rating, 0);
      return {
        questionId: question.id,
        prompt: question.prompt,
        type: "rating",
        status: "published",
        answeredCount: ratings.length,
        mean: Math.round((sum / ratings.length) * 100) / 100,
        distribution,
      };
    }

    case "single_choice":
    case "multiple_choice": {
      const counts = new Map<string, number>(question.options.map((option) => [option.id, 0]));
      for (const value of values) {
        const selected = Array.isArray(value) ? value : [value];
        for (const id of selected) {
          if (typeof id === "string" && counts.has(id)) {
            counts.set(id, (counts.get(id) ?? 0) + 1);
          }
        }
      }
      return {
        questionId: question.id,
        prompt: question.prompt,
        type: question.type,
        status: "published",
        answeredCount: values.length,
        options: question.options.map((option) => ({
          id: option.id,
          label: option.label,
          count: counts.get(option.id) ?? 0,
        })),
      };
    }

    case "free_text": {
      const texts = values.filter((value): value is string => typeof value === "string" && value.length > 0);
      return {
        questionId: question.id,
        prompt: question.prompt,
        type: "free_text",
        status: "published",
        answeredCount: texts.length,
        texts,
      };
    }
  }
}
