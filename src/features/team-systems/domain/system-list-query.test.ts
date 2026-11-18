import { describe, expect, it } from "vitest";
import {
  DEFAULT_SYSTEM_LIST_STATE,
  SYSTEM_PAGE_SIZE_MAX,
  parseSystemListQuery,
  returnStateFrom,
  serializeSystemListQuery,
  systemsListHref,
  type SystemListState,
} from "./system-list-query";
import { DEFAULT_SYSTEM_FILTER } from "./team-system-summary";

const parse = (query: string) => parseSystemListQuery(new URLSearchParams(query));

describe("Systemoversikt URL state: parsing (Phase 2F.1)", () => {
  it("reads the default list from an empty query", () => {
    expect(parse("")).toEqual(DEFAULT_SYSTEM_LIST_STATE);
  });

  it("restores every filter, the favorites switch and the rows shown", () => {
    const state = parse("q=sak&plassering=eksternt&oppfolging=attention&kompetanse=high&kritikalitet=kritisk&favoritter=1&vis=30");
    expect(state).toEqual({
      filter: {
        query: "sak",
        systemType: "eksternt",
        attention: "attention",
        knowledge: "high",
        criticality: "kritisk",
        favoritesOnly: true,
      },
      pageSize: 30,
    });
  });

  it.each([
    ["plassering", "ukjent"],
    ["plassering", "<script>"],
    ["kompetanse", "very-high"],
    ["kritikalitet", "super"],
    ["oppfolging", "yes"],
    ["favoritter", "true"],
  ])("falls back to the default for an unknown %s value %j", (key, value) => {
    const state = parse(`${key}=${encodeURIComponent(value)}`);
    expect(state.filter).toEqual(DEFAULT_SYSTEM_FILTER);
  });

  it.each(["7", "0", "-10", "510", "abc", "10.5", "1e3", "99999"])("falls back to ten rows for an invalid page size %j", (vis) => {
    expect(parse(`vis=${vis}`).pageSize).toBe(10);
  });

  it("accepts every valid page size up to the maximum", () => {
    expect(parse(`vis=${SYSTEM_PAGE_SIZE_MAX}`).pageSize).toBe(SYSTEM_PAGE_SIZE_MAX);
  });

  it("caps an overlong search text at 100 characters", () => {
    expect(parse(`q=${"a".repeat(500)}`).filter.query).toHaveLength(100);
  });

  it("ignores keys it does not know", () => {
    expect(parse("unknown=1&team=evil")).toEqual(DEFAULT_SYSTEM_LIST_STATE);
  });
});

describe("Systemoversikt URL state: serialization (Phase 2F.1)", () => {
  it("writes an empty query for the default list", () => {
    expect(serializeSystemListQuery(DEFAULT_SYSTEM_LIST_STATE)).toBe("");
  });

  it("round-trips a non-default state exactly", () => {
    const state: SystemListState = {
      filter: { ...DEFAULT_SYSTEM_FILTER, query: "Lønn & sak", systemType: "uavklart", favoritesOnly: true },
      pageSize: 20,
    };
    expect(parse(serializeSystemListQuery(state))).toEqual(state);
  });

  it("omits keys that hold their default value", () => {
    const query = serializeSystemListQuery({ filter: { ...DEFAULT_SYSTEM_FILTER, systemType: "internt" }, pageSize: 10 });
    expect(query).toBe("plassering=internt");
  });

  it("does not write a whitespace-only search", () => {
    const query = serializeSystemListQuery({ filter: { ...DEFAULT_SYSTEM_FILTER, query: "   " }, pageSize: 10 });
    expect(query).toBe("");
  });
});

describe("Systemoversikt return link (Phase 2F.1)", () => {
  it("builds the list href under the given team, with the encoded team id", () => {
    expect(systemsListHref("a b/c", DEFAULT_SYSTEM_LIST_STATE)).toBe("/teams/a%20b%2Fc/systems");
  });

  it("keeps the restored state in the list href", () => {
    const state: SystemListState = { filter: { ...DEFAULT_SYSTEM_FILTER, favoritesOnly: true }, pageSize: 30 };
    expect(systemsListHref("team-1", state)).toBe("/teams/team-1/systems?favoritter=1&vis=30");
  });

  it.each([
    "https://evil.example/steal",
    "//evil.example/steal",
    "/teams/other-team/roadmap",
    "javascript:alert(1)",
    "../../admin",
  ])("never returns a location outside the team's list for the hostile from value %j", (from) => {
    const state = returnStateFrom(from);
    const href = systemsListHref("team-1", state);
    expect(href.startsWith("/teams/team-1/systems")).toBe(true);
    expect(href).not.toMatch(/^(https?:|\/\/|javascript:)/);
  });

  it("falls back to the default list when the from value is missing", () => {
    expect(returnStateFrom(null)).toEqual(DEFAULT_SYSTEM_LIST_STATE);
  });
});
