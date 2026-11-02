import { beforeEach, describe, expect, it, vi } from "vitest";
import { closeSurvey } from "./close-survey";
import { createSurvey } from "./create-survey";
import { deleteOrArchiveSurvey } from "./delete-or-archive-survey";
import { openSurvey } from "./open-survey";

// TASK-034: admin writes that stamp the admin's uid on survey documents (create) and admin lifecycle writes that share the
// same erasure guard (open, close) read the admin's erasure fence first, in the same transaction, and write nothing when it
// refuses. Structural test over recording doubles. Fixtures are synthetic; the admin uid is fictional.

const holder = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("../../../lib/firebase/admin", () => ({
  getFirestoreDb: () => holder.db,
}));
vi.mock("server-only", () => ({}));

const ADMIN_UID = "admin-34";
const ADMIN_EMAIL = "admin34@example.com";
const TEAM_ID = "team-34";
const ADMIN_FENCE = `accountErasures/${ADMIN_UID}`;

type Data = Record<string, unknown>;

const docs = new Map<string, Data>();
const writes: string[] = [];
let nextId = 0;

holder.db = {
  collection: (name: string) => ({
    doc: (id?: string) => {
      const docId = id ?? `generated-${(nextId += 1)}`;
      const path = `${name}/${docId}`;
      return { id: docId, path, get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }) };
    },
  }),
  async runTransaction(work: (tx: unknown) => Promise<unknown>) {
    const tx = {
      async get(ref: string | { path: string }) {
        const path = typeof ref === "string" ? ref : ref.path;
        return { exists: docs.has(path), data: () => docs.get(path) };
      },
      create(ref: { path: string }, data: Data) {
        writes.push(`create|${ref.path}`);
        docs.set(ref.path, data);
      },
      set(path: string, data: Data) {
        writes.push(`set|${path}`);
        docs.set(path, data);
      },
      update(ref: string | { path: string }, data: Data) {
        const path = typeof ref === "string" ? ref : ref.path;
        writes.push(`update|${path}`);
        docs.set(path, { ...docs.get(path), ...data });
      },
      delete(ref: string | { path: string }) {
        const path = typeof ref === "string" ? ref : ref.path;
        writes.push(`delete|${path}`);
        docs.delete(path);
      },
    };
    return work(tx);
  },
};

const verifyToken = vi.fn().mockResolvedValue({ uid: ADMIN_UID, email: ADMIN_EMAIL, email_verified: true });
const allowList = [ADMIN_EMAIL];
const teamStatusReader = { getTeamStatus: async () => "active" };

beforeEach(() => {
  docs.clear();
  writes.length = 0;
  nextId = 0;
  docs.set(ADMIN_FENCE, { status: "in_progress", step: "forum" });
});

describe("admin survey stamp writes are refused while the admin's erasure record exists", () => {
  it("create refuses with erasure_in_progress and creates no survey", async () => {
    const result = await createSurvey("t", TEAM_ID, { accessMode: "public", minimumResponses: 5 }, {
      verifyToken,
      allowList,
      teamStatusReader,
    });

    expect(result).toEqual({ ok: false, error: "erasure_in_progress" });
    expect(writes).toEqual([]);
  });

  it("open refuses with erasure_in_progress and opens nothing", async () => {
    docs.set("surveys/survey-1", { teamId: TEAM_ID });

    const result = await openSurvey("t", TEAM_ID, "survey-1", { verifyToken, allowList, db: holder.db as never });

    expect(result).toEqual({ ok: false, error: "erasure_in_progress" });
    expect(writes).toEqual([]);
  });

  it("close refuses with erasure_in_progress and closes nothing", async () => {
    docs.set("surveys/survey-1", { teamId: TEAM_ID });

    const result = await closeSurvey("t", "survey-1", { verifyToken, allowList, db: holder.db as never });

    expect(result).toEqual({ ok: false, error: "erasure_in_progress" });
    expect(writes).toEqual([]);
  });
});

describe("admin survey delete and archive writes are refused while the admin's erasure record exists", () => {
  const SURVEY_PATH = "surveys/survey-1";
  const surveyFixture = {
    teamId: TEAM_ID,
    accessMode: "public",
    minimumResponses: 5,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    createdBy: ADMIN_UID,
    openedAt: new Date("2026-01-02T00:00:00Z"),
    closedAt: new Date("2026-01-03T00:00:00Z"),
  };
  const noResponses = { hasAnyResponses: async () => false };

  it("delete refuses with erasure_in_progress and removes nothing", async () => {
    docs.set(SURVEY_PATH, surveyFixture);
    docs.set(ADMIN_FENCE, { status: "in_progress", step: "forum" });

    const result = await deleteOrArchiveSurvey("t", TEAM_ID, "survey-1", {
      verifyToken,
      allowList,
      responses: noResponses,
    });

    expect(result).toEqual({ ok: false, error: "erasure_in_progress" });
    expect(docs.has(SURVEY_PATH)).toBe(true);
    expect(writes).toEqual([]);
  });

  it("archive refuses with erasure_in_progress and stamps no archivedAt", async () => {
    docs.set(SURVEY_PATH, surveyFixture);
    docs.set(ADMIN_FENCE, { status: "in_progress", step: "forum" });

    const result = await deleteOrArchiveSurvey("t", TEAM_ID, "survey-1", {
      verifyToken,
      allowList,
      responses: { hasAnyResponses: async () => true },
    });

    expect(result).toEqual({ ok: false, error: "erasure_in_progress" });
    expect(docs.get(SURVEY_PATH)).not.toHaveProperty("archivedAt");
    expect(writes).toEqual([]);
  });

  it("delete without an erasure record removes the survey (unchanged behaviour)", async () => {
    docs.delete(ADMIN_FENCE);
    docs.set(SURVEY_PATH, surveyFixture);

    const result = await deleteOrArchiveSurvey("t", TEAM_ID, "survey-1", {
      verifyToken,
      allowList,
      responses: noResponses,
    });

    expect(result).toEqual({ ok: true, outcome: "deleted" });
    expect(docs.has(SURVEY_PATH)).toBe(false);
  });
});
