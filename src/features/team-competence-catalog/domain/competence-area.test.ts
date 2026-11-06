import { describe, expect, it } from "vitest";
import {
  COMPETENCE_AREAS_PER_TEAM_MAX,
  competenceAreaDocId,
  isValidCompetenceArea,
  parseAssignCompetenceAreaBody,
  parseCompetenceAreaOrderBody,
  parseCompetenceAreaStatusBody,
  transitionCompetenceAreaStatus,
} from "./competence-area";

const T = new Date("2026-05-01T09:00:00Z");
const TREE = "tree-alpha";
const DOC = competenceAreaDocId("team-1", TREE);

function stored(extra: Record<string, unknown> = {}) {
  return { teamId: "team-1", treeId: TREE, status: "active", sortOrder: 0, createdAt: T, updatedAt: T, ...extra };
}

describe("isValidCompetenceArea (fail closed)", () => {
  it("accepts a complete record whose id is teamId__treeId", () => {
    expect(isValidCompetenceArea(stored(), { docId: DOC })).toBe(true);
  });

  it.each([
    ["an extra key such as an actor uid", { uid: "u" }],
    ["an unknown status", { status: "deleted" }],
    ["a negative order", { sortOrder: -1 }],
    ["an order at the maximum", { sortOrder: COMPETENCE_AREAS_PER_TEAM_MAX }],
    ["a non-integer order", { sortOrder: 1.5 }],
    ["a malformed tree id", { treeId: "../x" }],
    ["an invalid timestamp", { createdAt: new Date("nope") }],
  ])("rejects a record with %s", (_label, patch) => {
    expect(isValidCompetenceArea(stored(patch), { docId: DOC })).toBe(false);
  });

  it("rejects a document whose id does not match its stored team and tree", () => {
    expect(isValidCompetenceArea(stored(), { docId: competenceAreaDocId("team-2", TREE) })).toBe(false);
  });

  it("rejects a missing key", () => {
    const partial: Record<string, unknown> = { ...stored() };
    delete partial.sortOrder;
    expect(isValidCompetenceArea(partial, { docId: DOC })).toBe(false);
  });
});

describe("transitionCompetenceAreaStatus", () => {
  it("allows active and inactive to move in either direction, and to archive", () => {
    expect(transitionCompetenceAreaStatus("active", "inactive")).toEqual({ ok: true, changed: true });
    expect(transitionCompetenceAreaStatus("inactive", "active")).toEqual({ ok: true, changed: true });
    expect(transitionCompetenceAreaStatus("active", "archived")).toEqual({ ok: true, changed: true });
  });

  it("reports an unchanged status as a no-op", () => {
    expect(transitionCompetenceAreaStatus("active", "active")).toEqual({ ok: true, changed: false });
  });

  it("treats archived as terminal", () => {
    expect(transitionCompetenceAreaStatus("archived", "active")).toEqual({ ok: false, error: "area_archived" });
    expect(transitionCompetenceAreaStatus("archived", "archived")).toEqual({ ok: false, error: "area_archived" });
  });
});

describe("request body parsers", () => {
  it("assign accepts exactly a well-formed treeId", () => {
    expect(parseAssignCompetenceAreaBody({ treeId: TREE })).toEqual({ ok: true, value: { treeId: TREE } });
    expect(parseAssignCompetenceAreaBody({ treeId: TREE, extra: 1 })).toEqual({ ok: false, error: "invalid_request" });
    expect(parseAssignCompetenceAreaBody("x")).toEqual({ ok: false, error: "invalid_request" });
  });

  it("status accepts only the three statuses", () => {
    expect(parseCompetenceAreaStatusBody({ status: "inactive" })).toEqual({ ok: true, value: { status: "inactive" } });
    expect(parseCompetenceAreaStatusBody({ status: "deleted" })).toEqual({ ok: false, error: "invalid_input" });
  });

  it("order requires unique well-formed ids within the maximum", () => {
    expect(parseCompetenceAreaOrderBody({ order: [TREE, "tree-beta"] })).toEqual({ ok: true, value: { order: [TREE, "tree-beta"] } });
    expect(parseCompetenceAreaOrderBody({ order: [TREE, TREE] })).toEqual({ ok: false, error: "invalid_input" });
    expect(parseCompetenceAreaOrderBody({ order: [TREE, "a/b"] })).toEqual({ ok: false, error: "invalid_input" });
  });
});
