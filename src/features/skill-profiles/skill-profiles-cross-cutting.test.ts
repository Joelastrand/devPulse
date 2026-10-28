import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SELF_ASSESSED_LEVELS } from "./domain/self-assessed-level";
import { SELF_ASSESSED_LEVEL_COPY, skillProfileCopy } from "./copy";

/**
 * C1 cross-cutting verification (TASK-010): anti-surveillance wording (BR-22), C1/C2 scope identifiers on
 * ALL C1 surfaces including the page route (BR-19), browser Firestore isolation, and no index/Demo drift.
 * Every scan is scoped to the C1 surfaces only — never repository-wide — so unrelated features that
 * legitimately use words like "aggregate" or "matrix" do not fail. Not a proof of runtime behavior.
 */

const ROOT = process.cwd();
const read = (path: string) => readFileSync(`${ROOT}/${path}`, "utf8").replace(/\r\n/g, "\n");

function walk(dir: string): string[] {
  return readdirSync(`${ROOT}/${dir}`, { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return walk(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

const C1_PRODUCTION = [
  ...walk("src/features/skill-profiles"),
  ...walk("app/api/me/skills"),
  ...walk("app/me/skills"),
].filter((path) => !/\.test\.tsx?$/.test(path) && !path.endsWith("/fake-skill-profile-store.ts"));

/** Built indirectly so this file is not itself a collection reference for the TASK-005 allow-list guard. */
const PERSONAL_COLLECTION = new RegExp(["skill", "Profiles"].join(""));

const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** Every user-visible string in copy.ts, with sample arguments for the parameterised ones. */
function allCopyStrings(): string[] {
  const strings: string[] = [];
  for (const value of Object.values(skillProfileCopy)) {
    if (typeof value === "string") strings.push(value);
    else strings.push((value as (...args: never[]) => string)(...([2, 5] as never[])));
  }
  for (const level of SELF_ASSESSED_LEVELS) {
    strings.push(SELF_ASSESSED_LEVEL_COPY[level].name, SELF_ASSESSED_LEVEL_COPY[level].description);
  }
  return strings;
}

const SURVEILLANCE_PATTERNS: [string, RegExp][] = [
  ["score", /\bscore|poeng|\bscor/i],
  ["average", /gjennomsnitt|\baverage|\bsnitt\b/i],
  ["percentage", /%|prosent|percent/i],
  ["grade/rank", /\bkarakter|\brank|\bplassering|\btopp\b|\bbunn\b|\btop\b|\bbottom/i],
  ["badge/streak/leaderboard", /\bbadge|\bstreak|leaderboard|\bmerke\b/i],
  ["goal/progress", /\bmål\b|fremgang til|progress to/i],
  ["comparison", /sammenlign|\bcompare|\bkolleg|\bandre i teamet|\bteamets/i],
  ["evaluative", /\bsvak|\bsterk|\bdårlig|\bbra\b|\bmangler\b/i],
  ["completeness nagging", /\bmå fylle|\bfullfør|\bhusk å|\bikke ferdig/i],
  ["never-used promise", /\baldri\b|\bnever\b/i],
  ["lead/admin/team visibility implied", /kan se (den|dem|det)\b(?!.*ikke)|deles med|synlig for/i],
];

/**
 * The approved C1 role-comparison notice (role-profiles TASK-022, approved 2026-10-28). It is the only copy string
 * exempt from the scan, matched by exact value: it describes the owner's own target-role comparison, which the
 * `comparison` and `lead/admin/team visibility` patterns would otherwise reject. Every other string is still scanned.
 */
const APPROVED_ROLE_COMPARISON_NOTICE =
  "Dine ferdighetsvurderinger er private. De kan brukes til en valgfri sammenligning med din egen valgte målrolle. Sammenligningen er bare synlig for deg.";

describe("C1 anti-surveillance wording (BR-22) — copy.ts", () => {
  const strings = allCopyStrings().filter((text) => text !== APPROVED_ROLE_COMPARISON_NOTICE);

  it("scans a non-trivial amount of copy", () => {
    expect(strings.length).toBeGreaterThan(30);
  });

  it("pins the approved role-comparison notice word for word, and a near-copy with comparison wording is still scanned", () => {
    expect(skillProfileCopy.roleComparisonNotice).toBe(APPROVED_ROLE_COMPARISON_NOTICE);
    const nearCopy = APPROVED_ROLE_COMPARISON_NOTICE.replace("valgfri sammenligning", "sammenligning av kolleger");
    expect(SURVEILLANCE_PATTERNS.some(([, pattern]) => pattern.test(nearCopy))).toBe(true);
  });

  it.each(SURVEILLANCE_PATTERNS)("contains no %s wording", (_name, pattern) => {
    expect(strings.filter((text) => pattern.test(text))).toEqual([]);
  });

  it("states person ownership, hidden exact levels, optional team-by-team participation and thresholded team use (C2 BR-29)", () => {
    const notice = skillProfileCopy.privacyNotice;
    expect(notice).toBe(
      "Egenvurderingen din er din egen. Teamkolleger, teamledere og administratorer kan ikke se nivåene du setter. Du kan velge, team for team, at den skal telle med i en personvernbeskyttet teamoversikt der teamet bare ser en grov status per kompetansebehov.",
    );
    expect(notice).toMatch(/din egen/);
    expect(notice).toMatch(/Teamkolleger, teamledere og administratorer kan ikke se nivåene du setter/);
    expect(notice).toMatch(/Du kan velge, team for team/);
    expect(notice).toMatch(/personvernbeskyttet/);
    expect(notice).toMatch(/grov status/);
    expect(skillProfileCopy.pageDescription).toMatch(/din egen utvikling/);
  });

  it("makes no absolute, automatic-sharing, anonymity or count claim in the privacy notice", () => {
    const notice = skillProfileCopy.privacyNotice;
    expect(notice).not.toMatch(/ingen|ingen andre|kan ikke se den|aldri|anonym/i);
    expect(notice).not.toMatch(/automatisk|[0-9]/);
    expect(notice).not.toContain("Andre brukere");
  });

  it("uses exactly the four canonical levels, with 'Avansert' as level 4 and no mentoring requirement", () => {
    expect([...SELF_ASSESSED_LEVELS]).toEqual([1, 2, 3, 4]);
    expect(Object.keys(SELF_ASSESSED_LEVEL_COPY)).toEqual(["1", "2", "3", "4"]);
    expect(SELF_ASSESSED_LEVEL_COPY[4].name).toBe("Avansert");
  });

  it("the scanner would catch evaluative or comparative wording (negative fixtures)", () => {
    const flagged = (text: string) => SURVEILLANCE_PATTERNS.some(([, pattern]) => pattern.test(text));
    for (const bad of [
      "Din score er 3",
      "Gjennomsnitt: 2,5",
      "75 % vurdert",
      "Du er sterk på testing",
      "Sammenlign med teamet",
      "Teamlederen kan se den",
      "Dette brukes aldri andre steder",
    ]) {
      expect(flagged(bad), bad).toBe(true);
    }
    expect(flagged("Du har vurdert 2 av 5 ferdigheter.")).toBe(false);
  });
});

describe("C1 scope on all C1 surfaces including the page route (BR-19, BR-29, BR-35)", () => {
  const FORBIDDEN = [
    "teamSkillNeeds",
    "matrix",
    "aggregate",
    "threshold",
    "consent",
    "sharedWith",
    "sharing",
    "history",
    "ranking",
    "leaderboard",
    "coverage",
    "roleExpectation",
    "checkin",
  ];

  it("includes the page route in the scanned surface", () => {
    expect(C1_PRODUCTION).toContain("app/me/skills/page.tsx");
    expect(C1_PRODUCTION).toContain("src/features/skill-profiles/copy.ts");
  });

  it("C1 production code contains no C2, sharing, history, ranking or aggregate identifiers", () => {
    const hits = C1_PRODUCTION.flatMap((path) => {
      const code = stripComments(read(path)).toLowerCase();
      return FORBIDDEN.filter((id) => code.includes(id.toLowerCase())).map((id) => `${path}: ${id}`);
    });
    expect(hits).toEqual([]);
  });

  it("no chart/canvas/svg element or chart library is used by C1 UI", () => {
    const ui = C1_PRODUCTION.filter((p) => p.endsWith(".tsx") && !p.startsWith("app/api/"));
    const hits = ui.filter((p) => /<(svg|canvas)\b|recharts|chart\.js|d3/i.test(stripComments(read(p))));
    expect(hits).toEqual([]);
  });

  it("browser-reachable C1 code never imports a Firestore SDK or server modules", () => {
    const browser = C1_PRODUCTION.filter(
      (p) => p.startsWith("app/me/") || /skill-profiles\/(client|components|domain)\//.test(p) || p.endsWith("/copy.ts"),
    );
    expect(browser.length).toBeGreaterThan(4);
    const hits = browser.filter((p) =>
      /firebase\/firestore|firebase-admin|lib\/firebase\/|getFirestore|skill-profiles\/server|\.\/server\/|\.\.\/server\//.test(
        stripComments(read(p)),
      ),
    );
    expect(hits).toEqual([]);
  });

  it("no composite index mentions the personal collection and the personal collection has no Demo fixture", () => {
    expect(read("firestore.indexes.json")).not.toMatch(PERSONAL_COLLECTION);
    const demo = walk("src/features/demo-team").map((p) => [p, read(p)] as const);
    expect(demo.filter(([, text]) => PERSONAL_COLLECTION.test(text) || /skill-profiles/.test(text)).map(([p]) => p)).toEqual([]);
    expect(existsSync(`${ROOT}/src/features/demo-team`)).toBe(true);
  });
});
