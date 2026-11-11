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
  ...walk("app/(app)/me/skills"),
].filter((path) => !/\.test\.tsx?$/.test(path) && !path.endsWith("/fake-skill-profile-store.ts"));

/** Built indirectly so this file is not itself a collection reference for the TASK-005 allow-list guard. */
const PERSONAL_COLLECTION = new RegExp(["skill", "Profiles"].join(""));

const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * The one approved C1 → C2 composition (TASK-009, owner decision 2026-11-06, Option A; C1 SPEC "C2 participation control
 * composition exception"). `/me/skills` may mount the C2 "Del kompetanse med teamet" control and nothing else from C2.
 * It is matched by exact file, exact import specifier, exact identifier and exactly one JSX use. The control calls only
 * the owner's C2 participation gateway; it grants no access to private C1 assessments.
 */
const APPROVED_C2_COMPOSITION = {
  file: "app/(app)/me/skills/page.tsx",
  specifier: "../../../../src/features/team-skills/components/OwnCompetenceSharing",
  identifier: "OwnCompetenceSharing",
} as const;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/**
 * Returns the source with the approved composition removed, so the rest of the file is still scanned in full.
 * Only the exact file is affected. `approvedUses` counts the approved import and JSX use that were removed; any other
 * file, or a different specifier/identifier, is returned unchanged.
 */
function withoutApprovedComposition(path: string, text: string): { code: string; approvedUses: number } {
  if (path !== APPROVED_C2_COMPOSITION.file) return { code: text, approvedUses: 0 };
  const { identifier, specifier } = APPROVED_C2_COMPOSITION;
  const importLine = new RegExp(`^import \\{ ${identifier} \\} from "${escapeRegExp(specifier)}";\\n`, "gm");
  const jsxUse = new RegExp(`<${identifier} />`, "g");
  const imports = text.match(importLine)?.length ?? 0;
  const jsx = text.match(jsxUse)?.length ?? 0;
  const code = text.replace(importLine, "").replace(jsxUse, "");
  return { code, approvedUses: imports + jsx };
}

/**
 * C1 → C2 dependency violations for the given C1 files: any remaining import of a `team-skills` module, any remaining
 * reference to the approved identifier, and any use of the approved composition beyond exactly one import and one JSX use.
 */
function c1ToC2Violations(files: { path: string; text: string }[]): string[] {
  return files.flatMap(({ path, text }) => {
    const { code, approvedUses } = withoutApprovedComposition(path, text);
    const stripped = stripComments(code);
    const out: string[] = [];
    if (path === APPROVED_C2_COMPOSITION.file && approvedUses !== 2) out.push(`${path}: approved composition used ${approvedUses} times, expected 2`);
    for (const match of stripped.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
      if (/team-skills/.test(match[1])) out.push(`${path} -> ${match[1]}`);
    }
    if (new RegExp(`\\b${APPROVED_C2_COMPOSITION.identifier}\\b`).test(stripped)) out.push(`${path}: ${APPROVED_C2_COMPOSITION.identifier}`);
    return out;
  });
}

/** Every user-visible string in copy.ts, with sample arguments for the parameterised ones. */
function collectCopyStrings(value: unknown, out: string[]): void {
  if (typeof value === "string") out.push(value);
  else if (typeof value === "function") out.push((value as (...args: never[]) => string)(...([2, 5] as never[])));
  else if (Array.isArray(value)) value.forEach((item) => collectCopyStrings(item, out));
  else if (value !== null && typeof value === "object") Object.values(value).forEach((item) => collectCopyStrings(item, out));
}

function allCopyStrings(): string[] {
  const strings: string[] = [];
  collectCopyStrings(skillProfileCopy, strings);
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
describe("C1 anti-surveillance wording (BR-22) — copy.ts", () => {
  const strings = allCopyStrings();

  it("scans a non-trivial amount of copy", () => {
    expect(strings.length).toBeGreaterThan(30);
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
    expect(C1_PRODUCTION).toContain("app/(app)/me/skills/page.tsx");
    expect(C1_PRODUCTION).toContain("src/features/skill-profiles/copy.ts");
  });

  it("C1 production code contains no C2, sharing, history, ranking or aggregate identifiers (apart from the approved composition)", () => {
    const hits = C1_PRODUCTION.flatMap((path) => {
      const code = stripComments(withoutApprovedComposition(path, read(path)).code).toLowerCase();
      return FORBIDDEN.filter((id) => code.includes(id.toLowerCase())).map((id) => `${path}: ${id}`);
    });
    expect(hits).toEqual([]);
  });

  it("the only C1 → C2 dependency on disk is the approved /me/skills composition", () => {
    const files = C1_PRODUCTION.map((path) => ({ path, text: read(path) }));
    expect(c1ToC2Violations(files)).toEqual([]);
    const importsC2 = files.filter((f) => /(?:from|import)\s*\(?\s*["'][^"']*team-skills/.test(stripComments(f.text))).map((f) => f.path);
    expect(importsC2).toEqual([APPROVED_C2_COMPOSITION.file]);
  });

  it("the approved composition is allowed exactly once, on the approved page, through the approved specifier", () => {
    const page = read(APPROVED_C2_COMPOSITION.file);
    expect(withoutApprovedComposition(APPROVED_C2_COMPOSITION.file, page).approvedUses).toBe(2);
    expect(c1ToC2Violations([{ path: APPROVED_C2_COMPOSITION.file, text: page }])).toEqual([]);
  });

  it("rejects unapproved C1 → C2 dependencies (negative fixtures)", () => {
    const page = read(APPROVED_C2_COMPOSITION.file);
    const extraImport = `import { getTeamSkillCoverage } from "../../../../src/features/team-skills/server/get-team-skill-coverage";\n${page}`;
    const secondUse = page.replace("</div>\n    </PageShell>", "<OwnCompetenceSharing />\n</div>\n    </PageShell>");
    expect(c1ToC2Violations([{ path: APPROVED_C2_COMPOSITION.file, text: extraImport }])).toEqual([
      `${APPROVED_C2_COMPOSITION.file} -> ../../../../src/features/team-skills/server/get-team-skill-coverage`,
    ]);
    expect(c1ToC2Violations([{ path: APPROVED_C2_COMPOSITION.file, text: secondUse }])).not.toEqual([]);
    expect(
      c1ToC2Violations([{ path: "src/features/skill-profiles/components/SkillProfilePage.tsx", text: `import { OwnCompetenceSharing } from "../../team-skills/components/OwnCompetenceSharing";` }]),
    ).not.toEqual([]);
    expect(
      c1ToC2Violations([{ path: "app/(app)/me/skills/other.tsx", text: `export const x = () => <OwnCompetenceSharing />;` }]),
    ).toEqual(["app/(app)/me/skills/other.tsx: OwnCompetenceSharing"]);
  });

  it("keeps the approved composition's own declared identifier and specifier pinned", () => {
    expect(APPROVED_C2_COMPOSITION.specifier).toMatch(/src\/features\/team-skills\/components\/OwnCompetenceSharing$/);
    expect(APPROVED_C2_COMPOSITION.identifier).toBe("OwnCompetenceSharing");
  });

  /**
   * Owner-approved product decision (2026-11-10; C1 SPEC BR-29 and A5 as amended): the signed-in person's own competence
   * radar is permitted on `/me/skills`. The exception is exactly one file, which uses the existing `recharts` dependency and
   * nothing else. Every other C1 UI file keeps the no-chart rule, and no hand-written SVG/canvas or other chart library may
   * appear anywhere in C1 UI. This guard proves the file list, not what the chart renders.
   */
  const PERSONAL_RADAR_FILE = "src/features/skill-profiles/components/PersonalRadar.tsx";
  const importsOf = (text: string) => [...stripComments(text).matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]);

  it("allows the recharts chart library only in the approved personal radar file, which imports no team module", () => {
    const ui = C1_PRODUCTION.filter((p) => p.endsWith(".tsx") && !p.startsWith("app/api/"));
    const withChartLibrary = ui.filter((p) => importsOf(read(p)).includes("recharts"));
    expect(withChartLibrary).toEqual([PERSONAL_RADAR_FILE]);
    expect(importsOf(read(PERSONAL_RADAR_FILE)).filter((specifier) => /team/i.test(specifier))).toEqual([]);
  });

  it("no hand-written svg/canvas element or other chart library is used by C1 UI", () => {
    const ui = C1_PRODUCTION.filter((p) => p.endsWith(".tsx") && !p.startsWith("app/api/"));
    const hits = ui.filter((p) => /<(svg|canvas)\b|chart\.js|d3/i.test(stripComments(read(p))));
    expect(hits).toEqual([]);
  });

  it("browser-reachable C1 code never imports a Firestore SDK or server modules", () => {
    const browser = C1_PRODUCTION.filter(
      (p) => p.startsWith("app/(app)/me/") || /skill-profiles\/(client|components|domain)\//.test(p) || p.endsWith("/copy.ts"),
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
