import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, expectTypeOf, it } from "vitest";
import { ErasureStepFailure } from "./erasure-runner";
import {
  runSurveyParticipationsBatch,
  type SurveyParticipationTransaction,
  type SurveyParticipationsErasurePort,
} from "./survey-participations-erasure";

// TASK-021: survey participations. Fixtures are synthetic. Anonymous responses are never touched; the fake keeps them in a
// map that the port has no access to, so an accidental read or write is detectable.

const UID = "erased-uid";
const OTHER = "other-uid";

function fakeStore(options: { participations?: Record<string, Record<string, unknown>>; responses?: Record<string, unknown> } = {}) {
  const participations = new Map<string, Record<string, unknown>>(Object.entries(options.participations ?? {}));
  const responses = new Map<string, unknown>(Object.entries(options.responses ?? {}));
  const log: string[] = [];

  const tx: SurveyParticipationTransaction = {
    async getParticipation(id) {
      const doc = participations.get(id);
      return doc === undefined ? undefined : { ...doc };
    },
    deleteParticipation(id) {
      log.push(`delete:${id}`);
      participations.delete(id);
    },
  };

  const port: SurveyParticipationsErasurePort = {
    async runTransaction(work) {
      return work(tx);
    },
    async participationIdsFor(uid, limit) {
      return [...participations.entries()]
        .filter(([id, doc]) => (doc.uid !== undefined ? doc.uid === uid : id.startsWith(`${uid}__`)))
        .map(([id]) => id)
        .slice(0, limit);
    },
  };

  return { port, participations, responses, log };
}

async function runToDone(port: SurveyParticipationsErasurePort, uid: string): Promise<void> {
  for (let batch = 0; batch < 50; batch += 1) {
    if ((await runSurveyParticipationsBatch({ port }, uid, 100)) === "done") return;
  }
  throw new Error("survey participations step did not reach done");
}

describe("survey participations erasure step (TASK-021)", () => {
  it("deletes the erased person's participations by the uid field, including an open authenticated survey", async () => {
    const store = fakeStore({
      participations: {
        [`${UID}__survey-1`]: { uid: UID, surveyId: "survey-1" },
        [`${UID}__open-survey`]: { uid: UID, surveyId: "open-survey" },
      },
    });

    await runToDone(store.port, UID);

    expect(store.participations.size).toBe(0);
  });

  it("deletes a legacy participation with no uid field by its uid__ document-id prefix", async () => {
    const store = fakeStore({ participations: { [`${UID}__survey-legacy`]: { surveyId: "survey-legacy" } } });

    await runToDone(store.port, UID);

    expect(store.participations.size).toBe(0);
  });

  it("leaves another person's participations untouched", async () => {
    const store = fakeStore({
      participations: {
        [`${UID}__survey-1`]: { uid: UID, surveyId: "survey-1" },
        [`${OTHER}__survey-1`]: { uid: OTHER, surveyId: "survey-1" },
      },
    });

    await runToDone(store.port, UID);

    expect(store.participations.has(`${OTHER}__survey-1`)).toBe(true);
    expect(store.log).toEqual([`delete:${UID}__survey-1`]);
  });

  it("cannot reach anonymous survey responses (AE-SI-8), checked at compile time and in the step source", () => {
    // Compile-time: the step's own port and transaction types. A response method added to either would fail typecheck.
    expectTypeOf<keyof SurveyParticipationsErasurePort>().toEqualTypeOf<"runTransaction" | "participationIdsFor">();
    expectTypeOf<keyof SurveyParticipationTransaction>().toEqualTypeOf<"getParticipation" | "deleteParticipation">();

    // Source: every module specifier in the step file, static or dynamic, must be exactly the erasure runner. Multi-line
    // imports and dynamic imports are both covered. A surveys import of any form fails this check.
    const source = readFileSync(join(process.cwd(), "src/features/account-erasure/server/survey-participations-erasure.ts"), "utf8");
    // Covers `from`, bare `import`, dynamic `import()` and CommonJS `require()`. A specifier inside a comment would also
    // match, so the check can over-report but cannot miss a real import in those forms.
    const specifiers = [...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*|\brequire\s*\(\s*)["']([^"']+)["']/g)].map(
      (match) => match[1],
    );
    expect(specifiers).toEqual(["./erasure-runner"]);
  });

  it("does not delete on a listed id that has no record: the step fails closed and deletes nothing", async () => {
    const deletes: string[] = [];
    const port: SurveyParticipationsErasurePort = {
      runTransaction: async (work) =>
        work({
          getParticipation: async () => undefined,
          deleteParticipation: (id) => {
            deletes.push(id);
          },
        }),
      participationIdsFor: async () => [`${UID}__ghost`],
    };

    await expect(runSurveyParticipationsBatch({ port }, UID, 100)).rejects.toMatchObject({ code: "verification_failed" });
    expect(deletes).toEqual([]);
  });

  it("fails closed on a legacy record whose uid contains '__' and whose id only shares the erased uid's prefix", async () => {
    // The record belongs to uid `${UID}__b` (not the erased uid). Its id starts with `${UID}__`, but it is not exactly
    // `${UID}__${surveyId}` for its own surveyId, so it is not attributed to the erased uid and is not deleted.
    const store = fakeStore({ participations: { [`${UID}__b__s`]: { surveyId: "s" } } });
    const faulty: SurveyParticipationsErasurePort = { ...store.port, participationIdsFor: async () => [`${UID}__b__s`] };

    await expect(runSurveyParticipationsBatch({ port: faulty }, UID, 100)).rejects.toMatchObject({ code: "verification_failed" });
    expect(store.participations.has(`${UID}__b__s`)).toBe(true);
  });

  it("fails closed, with no delete, when a participation's uid field belongs to someone else", async () => {
    const store = fakeStore({ participations: { [`${UID}__survey-1`]: { uid: OTHER, surveyId: "survey-1" } } });
    const faulty: SurveyParticipationsErasurePort = { ...store.port, participationIdsFor: async () => [`${UID}__survey-1`] };

    await expect(runSurveyParticipationsBatch({ port: faulty }, UID, 100)).rejects.toMatchObject({ code: "verification_failed" });
    expect(store.log).toEqual([]);
  });

  it("fails closed on a legacy record with no uid field whose id does not start with the erased uid", async () => {
    const store = fakeStore({ participations: { [`${OTHER}__survey-1`]: { surveyId: "survey-1" } } });
    const faulty: SurveyParticipationsErasurePort = { ...store.port, participationIdsFor: async () => [`${OTHER}__survey-1`] };

    await expect(runSurveyParticipationsBatch({ port: faulty }, UID, 100)).rejects.toMatchObject({ code: "verification_failed" });
    expect(store.participations.has(`${OTHER}__survey-1`)).toBe(true);
  });

  it("reports done only when no participation of the uid is left", async () => {
    const store = fakeStore();
    expect(await runSurveyParticipationsBatch({ port: store.port }, UID, 100)).toBe("done");
  });

  it("refuses a zero write budget as a programming error", async () => {
    const store = fakeStore();
    await expect(runSurveyParticipationsBatch({ port: store.port }, UID, 0)).rejects.toBeInstanceOf(ErasureStepFailure);
  });
});
