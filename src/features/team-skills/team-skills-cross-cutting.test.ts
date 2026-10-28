import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { describe, expect, it } from "vitest";
import { skillProfileCopy } from "../skill-profiles/copy";
import { SKILL_COVERAGE_MIN_CONTRIBUTORS } from "./domain/skill-coverage-policy";
import { participationCopy, teamSkillsCopy } from "./copy";

/**
 * Feature-wide scope, copy and logging regression for C2 (TASK-019). The per-task suites and
 * `team-skills-scope-guard.test.ts` own the detailed boundaries; this file adds only the cross-cutting
 * evidence they do not carry: Demo / D-concept / index / env non-integration, a joint scan of every C1 and C2
 * user-facing privacy string, and the "no logging in C2" check. Change-detection only, like the guard.
 */

const ROOT = process.cwd();
const SELF = "src/features/team-skills/team-skills-cross-cutting.test.ts";

function walk(dir: string): string[] {
  const absolute = join(ROOT, dir);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const path = posix.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : walk(path);
    return /\.(ts|tsx|json|mjs)$/.test(entry.name) ? [path] : [];
  });
}

const isTest = (path: string) => /\.test\.tsx?$/.test(path);
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const C2_ROUTES = walk("app/api/teams").filter((p) => /\/skill-(needs|contribution|coverage)\//.test(p));
const C2_PRODUCTION = [...walk("src/features/team-skills"), ...C2_ROUTES].filter((p) => !isTest(p));

describe("C2 scope regression — nothing outside the approved surface (BR-35, BR-24, Demo decision)", () => {
  it("finds the production tree it is meant to scan", () => {
    expect(C2_PRODUCTION.length).toBeGreaterThan(20);
    expect(C2_ROUTES.length).toBe(8);
  });

  it("Demo Team fixtures, plan, seed and writer name no C2 or personal-assessment data", () => {
    const demo = walk("src/features/demo-team").filter((p) => !isTest(p));
    expect(demo.length).toBeGreaterThan(5);
    const offenders = demo.filter((p) => /team-?skill-?needs|skill-?contribution|skill-?profile|team-skills/i.test(read(p)));
    expect(offenders).toEqual([]);
  });

  it("no production code introduces D1/D2 concepts", () => {
    const d = /\b(roleDefinitions|developmentGoals|progressEntries|checkIns)\b/;
    // PG-12: exact file-level role-profiles entry; the role store alone holds the `roleDefinitions` literal.
    const ROLE_PROFILES_ROLE_DEFINITION_STORE = ["src/features/role-profiles/server/role-store.ts"];
    const offenders = [...walk("src"), ...walk("app")].filter(
      (p) => !isTest(p) && !ROLE_PROFILES_ROLE_DEFINITION_STORE.includes(p) && d.test(read(p)),
    );
    expect(offenders).toEqual([]);
  });

  it("C2 production code never reads or writes skillProgress or roadmapItems", () => {
    const offenders = C2_PRODUCTION.filter((p) => /skillProgress|roadmapItems|features\/roadmap/.test(read(p)));
    expect(offenders).toEqual([]);
  });

  // Complementary token scans. TASK-017 (team-skills-scope-guard.test.ts) owns the EXACT collection / path / writer
  // allow-lists; nothing below replaces it, and a differently-named hypothetical collection starting with "team"
  // would pass the loose collection regex here (the exact guard would still fail it).
  it("complementary scan: no C2 index entry, no env read, and no C2 collection literal outside team*/skillTrees", () => {
    const indexes = read("firestore.indexes.json");
    expect(indexes).not.toMatch(/team-?skill-?needs|teamMemberships|skill-?profile|skill-?contribution|coverage/i);
    expect(JSON.parse(indexes).indexes.map((i: { collectionGroup: string }) => i.collectionGroup)).toEqual([
      "teamInvitations",
      "teamAccessRequests",
      "forumThreads",
      "forumReplies",
    ]);
    expect(C2_PRODUCTION.filter((p) => /process\.env|import\.meta\.env/.test(read(p)))).toEqual([]);
    expect(C2_PRODUCTION.filter((p) => /\.collection\(\s*["'`](?!team|skillTrees)/.test(read(p)))).toEqual([]);
  });

  it("complementary scan: the threshold literal has one production owner; write-style calls appear only in the two stores", () => {
    const owner = "src/features/team-skills/domain/skill-coverage-policy.ts";
    expect(read(owner)).toMatch(/SKILL_COVERAGE_MIN_CONTRIBUTORS\s*=\s*5/);
    const redeclared = C2_PRODUCTION.filter((p) => p !== owner && /SKILL_COVERAGE_MIN_CONTRIBUTORS\s*=|\bk\s*=\s*5\b/.test(read(p)));
    expect(redeclared).toEqual([]);
    // Token scan only: it does not prove persistence is impossible; the exact writer statements are pinned by TASK-017.
    expect(C2_PRODUCTION.filter((p) => /\.(set|create|update|delete)\(/.test(read(p)) && !/skill-needs-store|skill-contribution-store/.test(p))).toEqual([]);
  });

  it("team navigation still exposes only Oversikt and Roadmap (no C2 destination)", () => {
    const nav = walk("src/features/teams/components").filter((p) => /Nav\.tsx$/.test(p));
    expect(nav.length).toBeGreaterThan(0);
    // Links are declared as `{ href: base | `${base}/roadmap`, label }` — any other destination fails.
    for (const p of nav) expect(read(p)).not.toMatch(/href:\s*`\$\{base\}\/(?!roadmap`)/);
  });
});

describe("C2 logging calls", () => {
  it("the repository's only logging mechanism is console.* in the Demo CLI; C2 production code has no console, stdout or logger call", () => {
    const all = [...walk("src"), ...walk("app")].filter((p) => !isTest(p) && /\.tsx?$/.test(p));
    const withConsole = all.filter((p) => /\bconsole\.\w+\s*\(/.test(read(p)));
    expect(withConsole).toEqual(["src/features/demo-team/cli.ts"]);
    const loggerLike = C2_PRODUCTION.filter((p) => /\bconsole\b|process\.(stdout|stderr)|\blogger\b|\blog(Error|Warn|Info)\b/.test(read(p)));
    expect(loggerLike).toEqual([]);
  });

  it("the identity-stripped batch adapter and the profile store it uses also contain no logging call", () => {
    for (const p of [
      "src/features/skill-profiles/server/read-skill-levels-batch.ts",
      "src/features/skill-profiles/server/skill-profile-store.ts",
    ]) {
      expect(read(p)).not.toMatch(/\bconsole\b|\blogger\b/);
    }
  });
  // Runtime evidence that a failing read logs nothing and leaks no detail lives in
  // server/get-team-skill-coverage-privacy.test.ts ("the serialized response ... logs nothing").
});

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "function") return strings((value as (arg: string) => unknown)("Team Alfa"));
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

describe("C1 + C2 privacy copy, scanned together (BR-21, BR-25, BR-27, BR-29)", () => {
  const c2 = [...strings(teamSkillsCopy), ...strings(participationCopy)];
  const c1Notice = skillProfileCopy.privacyNotice;
  const all = [...c2, c1Notice, skillProfileCopy.roleComparisonNotice];
  const sentences = all.flatMap((s) => s.split(/(?<=[.!?])\s+/));

  it("never says anonymous without an explicit negation, and never promises formal anonymity", () => {
    for (const s of sentences) {
      if (/anonym/i.test(s)) expect(s).toMatch(/\bikke\b/i);
    }
    expect(all.join(" ")).not.toMatch(/garanter|100\s?%|helt anonym|fullstendig anonym/i);
  });

  it("never claims categorical output prevents inference or that nobody can learn anything", () => {
    const joined = all.join(" ");
    expect(joined).not.toMatch(/umulig å (utlede|identifisere|spore)|kan ikke utledes|forhindr|ingen kan (noen gang )?(finne ut|utlede|vite)/i);
    // the residual-risk caveat is present instead
    expect(participationCopy.noticePoints("X").join(" ")).toMatch(/kan statusene i noen tilfeller gi grov informasjon/);
  });

  it("states participation as optional, per team and revocable, never automatic or global", () => {
    const points = participationCopy.noticePoints("Team Alfa").join(" ");
    expect(points).toMatch(/Valgfritt/);
    expect(points).toMatch(/team for team/);
    expect(points).toMatch(/slutte når som helst/);
    expect(c1Notice).toMatch(/Du kan velge, team for team/);
    expect(all.join(" ")).not.toMatch(/automatisk|som standard|alle team|globalt/i);
  });

  it("withdrawal copy keeps the self-assessment and says nothing about deleting it", () => {
    const withdrawal = participationCopy.disclosurePoints.find((p) => /slutter å bidra/.test(p)) ?? "";
    expect(withdrawal).toMatch(/slettes ikke/);
    expect(participationCopy.withdrawn).not.toMatch(/slett|fjern/i);
  });

  it("C1 and C2 agree: levels are not shown to others, and only a coarse status reaches the team", () => {
    expect(c1Notice).toMatch(/ikke se nivåene du setter/);
    expect(c1Notice).toMatch(/personvernbeskyttet/);
    expect(c1Notice).toMatch(/grov status/);
    expect(participationCopy.noticePoints("X")[1]).toMatch(/aldri nivåene du har satt/);
    expect(participationCopy.noticePoints("X")[2]).toMatch(/grov status/);
    // the number in the notice is the policy constant, not a second definition
    expect(participationCopy.noticePoints("X")[2]).toContain(`minst ${SKILL_COVERAGE_MIN_CONTRIBUTORS} bidragsytere`);
  });

  it("carries no counts, percentages, evaluative or employee-evaluation framing", () => {
    const joined = c2.join(" ");
    expect(joined).not.toMatch(/\d+\s?%|\b(kun|bare|færre enn) \d|\d+ av \d+/i);
    expect(joined).not.toMatch(
      /\b(svak(est)?|sterk(est)?|kritisk|rangering|ranger(e|t)?(?! personer)|score|poengsum|leaderboard|ytelse|prestasjon|ansatte?|dårligst|beste)\b/i,
    );
    // the one place ranking/comparison appears is the explicit negation
    const negations = c2.filter((s) => /rangere/i.test(s));
    expect(negations.every((s) => /ikke/.test(s))).toBe(true);
  });

  it("the suppressed-state copy names no number and no cause", () => {
    for (const s of [teamSkillsCopy.needs.coverageInsufficient, teamSkillsCopy.needs.coverageInsufficientHint]) {
      expect(s).not.toMatch(/\d/);
      expect(s).not.toMatch(/opt|samtykke|vurdert av|ingen har|noen har/i);
    }
  });
});

/**
 * BR-21 in test sources and comments: nothing may claim that categorical output (or the fixed threshold)
 * prevents inference, makes anyone unidentifiable, or guarantees anonymity. The rule is semantic, not a ban on
 * the words: a sentence that states the LIMIT ("does not prevent inference", "cannot guarantee anonymity") is
 * correct threat-model documentation and is allowed.
 *
 * Each family below names one forbidden claim. Negation is local: a `negatable` family is excused only when a
 * negator directly governs the claim verb ("does not prevent", "cannot guarantee"). Passive/agent families such as
 * "cannot be inferred" are positive guarantees whose own wording contains a negator, so they are only excused when
 * nested inside an explicitly denied guarantee ("does not guarantee that individuals cannot be inferred").
 */
interface ClaimFamily {
  name: string;
  pattern: RegExp;
  /** true: "does not <claim verb>" negates the claim; false: the negator is part of the claim itself. */
  negatable: boolean;
  /** Negation that follows the verb inside the match itself ("gjør ikke … anonym"). */
  selfNegated?: RegExp;
}

const OBJECT = String.raw`[^.;]{0,60}?\b(?:infer\w*|inference|identif\w+|anonymity|anonymous\w*|anonymi[sz]\w*)`;
const CLAIM_FAMILIES: ClaimFamily[] = [
  // "prevents inference", "guarantees anonymity", "ensures anonymity", "rules out identification"
  {
    name: "prevention/guarantee verb",
    pattern: new RegExp(String.raw`\b(?:prevent(?:s|ing)?|rules?\s+out|eliminat(?:e|es|ing)|guarantee[sd]?|ensur(?:e|es|ing))\b${OBJECT}`, "gi"),
    negatable: true,
  },
  // "inference is impossible/prevented", "impossible to infer/identify", "makes inference impossible"
  {
    name: "impossible/prevented state",
    pattern:
      /\b(?:(?:inference|identification)\s+(?:is|are|becomes?|remains?)\s+(?:impossible|prevented|ruled\s+out)|impossible\s+to\s+(?:infer|identify|deduce)|(?:make|makes|made)\s+(?:\w+\s+){0,2}(?:inference|identification)\s+impossible)/gi,
    negatable: true,
  },
  // "makes users anonymous", "renders contributors anonymous", "anonymizes everyone"
  {
    name: "anonymizing verb",
    pattern: /\b(?:(?:make|makes|made|render|renders|rendered)\s+(?:\w+\s+){0,2}anonymous\b|anonymi[sz](?:e|es|ed|ing)\b)/gi,
    negatable: true,
  },
  // "cannot be inferred/identified" is itself the guarantee (contrast: "cannot guarantee anonymity")
  {
    name: "passive unidentifiable guarantee",
    pattern: /\b(?:cannot|can't|can\s+not|won't|will\s+not|never)\s+be\s+(?:inferred|identified|deduced|traced)\b/gi,
    negatable: false,
  },
  // "nobody can infer", "no one can identify", "users cannot infer individual levels"
  {
    name: "agent cannot infer",
    pattern:
      /\b(?:(?:nobody|no\s*one|none)\s+(?:can|could|will)\s+(?:ever\s+)?(?:infer|identify|deduce|learn|work\s+out)|(?:users|members|leads|admins|anyone|people|teammates)\s+(?:cannot|can't|can\s+not)\s+(?:infer|identify|deduce))\b/gi,
    negatable: false,
  },
  // Norwegian: "umulig å utlede", "forhindrer utledning", "garanterer anonymitet", "gjør … anonym"
  {
    name: "norwegian prevention/guarantee",
    pattern:
      /\b(?:umulig\s+å\s+(?:utlede|identifisere)|(?:for)?hindr\w+\s+(?:utledning|identifisering)|garanter\w+\s+(?:full\s+|absolutt\s+)?anonym\w*|gjør\w*\s+(?:\w+\s+){0,2}anonym\w*)/gi,
    negatable: true,
    selfNegated: /^gjør\w*\s+ikke\b/i,
  },
  {
    name: "norwegian passive guarantee",
    pattern: /\bkan\s+ikke\s+(?:utledes|identifiseres|spores)\b/gi,
    negatable: false,
  },
];
/**
 * A negator is local only when it is the auxiliary that directly governs the claim verb ("does not prevent",
 * "cannot guarantee"), optionally with one hedge ("does not really prevent"). Negation elsewhere in the sentence
 * ("does not expose names but guarantees anonymity") never excuses a claim.
 */
const DIRECT_NEGATOR =
  /\b(?:(?:does|do|did|is|are|was|were|will|would|should|could|can)\s+not|doesn't|don't|didn't|isn't|aren't|won't|wouldn't|shouldn't|couldn't|cannot|can't|never|no\s+longer)\s+(?:(?:really|necessarily|actually|always)\s+)?$/i;
/**
 * The one definition of a clause boundary. A comma, colon or subordinating/coordinating word starts another
 * proposition, so the sentence is cut into clauses BEFORE any claim is matched: a claim pattern (including its
 * object window) can then never run across a boundary and swallow a later clause's positive guarantee.
 * Deliberately not boundaries: "as" and "then" (too ambiguous: "as a threshold", "then 5"). KNOWN LIMIT: a claim after
 * them in the same clause as a negated guarantee is treated as part of the denied span and is not caught.
 */
const CLAUSE_BREAK = /[,:]|\s(?:but|and|so|while|whereas|yet|because|since|although|though)\s/i;

interface Hit {
  start: number;
  negated: boolean;
}

function hits(clause: string): Hit[] {
  return CLAIM_FAMILIES.flatMap((family) =>
    [...clause.matchAll(family.pattern)].map((match) => {
      const start = match.index ?? 0;
      const negated =
        family.negatable &&
        (DIRECT_NEGATOR.test(clause.slice(0, start)) || (family.selfNegated?.test(match[0]) ?? false));
      return { start, negated };
    }),
  );
}

/**
 * Wording nested inside an explicitly denied guarantee ("does not guarantee that individuals cannot be
 * inferred") is the thing being denied, not an independent guarantee. Within one clause the denied span runs from
 * the negated claim to the end of that clause.
 */
function hasUndeniedClaim(clause: string): boolean {
  const found = hits(clause);
  const deniedFrom = Math.min(...found.filter((hit) => hit.negated).map((hit) => hit.start));
  return found.some((hit) => !hit.negated && hit.start < deniedFrom);
}

function inferenceGuaranteeClaims(text: string): string[] {
  const flat = text.replace(/^\s*(\/\/+|\*+|\/\*+)\s?/gm, "").replace(/\s+/g, " ");
  return flat
    .split(/(?<=[.!?;])\s+/)
    .filter((sentence) => sentence.split(new RegExp(CLAUSE_BREAK, "gi")).some(hasUndeniedClaim));
}

describe("BR-21 — no test or comment claims that categorical output prevents inference", () => {
  // Every C1/C2 test source, nested directories and .test.ts/.test.tsx alike. The only exclusion is this file, because it
  // necessarily contains the forbidden-claim fixtures below (exact path, no pattern). The two scope guards are scanned too.
  const sources = [...walk("src/features/team-skills"), ...walk("src/features/skill-profiles"), ...C2_ROUTES].filter(
    (p) => isTest(p) && p !== SELF,
  );

  it("finds the test sources it is meant to scan", () => {
    expect(sources.length).toBeGreaterThan(40);
    for (const expected of [
      "src/features/team-skills/server/get-team-skill-coverage-privacy.test.ts",
      "src/features/team-skills/components/TeamSkillNeedsSection.test.tsx",
      "src/features/team-skills/team-skills-scope-guard.test.ts",
      "src/features/skill-profiles/skill-profiles-scope-guard.test.ts",
    ]) {
      expect(sources).toContain(expected);
    }
  });

  it.each([
    "Individual levels cannot be inferred from the output.",
    "Individual levels can't be inferred from the output.",
    "Categorical output makes users anonymous.",
    "Categorical output renders contributors anonymous.",
    "The threshold anonymizes everyone.",
    "The threshold anonymises everyone.",
    "Categorical output prevents inference, not just counts.",
    "Inference is impossible with k = 5.",
    "Nobody can infer an individual level.",
    "Categorical output prevents inference.",
    "// The threshold guarantees anonymity for every contributor.",
    "No counts are shown, and categorical output prevents inference.",
    "It is impossible to infer who contributed.",
    "Contributors cannot be identified.",
    "Users cannot infer individual levels.",
    "Kategorisk status gjør det umulig å utlede nivåer.",
    "Nivåene kan ikke utledes.",
    // unrelated earlier negation in another clause must not excuse the guarantee
    "The output cannot reveal counts and makes contributors anonymous.",
    "The threshold does not expose names but guarantees anonymity.",
    "This does not show counts, but it prevents inference.",
    "This does not show counts, but prevents inference.",
    "We do not expose identities; individual levels cannot be inferred.",
    "No percentages are shown, so nobody can infer a person's level.",
    "We cannot guarantee names, but contributors cannot be identified.",
    "Terskelen garanterer anonymitet.",
    "Kategorisk status hindrer utledning av nivåer.",
    "Kategorisk status forhindrer utledning av nivåer.",
    "Kategorisk status gjør bidragsytere anonyme.",
    "Terskelen gjør alle anonyme.",
    "Nivåene er umulig å utlede.",
    // a negated claim must not swallow a later positive guarantee across a clause boundary
    "The threshold does not prevent leaks but guarantees anonymity.",
    "The threshold does not prevent leaks and guarantees anonymity.",
    "We cannot guarantee names, but prevents inference.",
    "This does not guarantee names and prevents inference.",
    "The output does not guarantee names but ensures anonymity.",
    "This does not ensure names and guarantees anonymity.",
    "This does not guarantee anonymity; it prevents inference.",
    "This does not guarantee names so it prevents inference.",
    "This does not guarantee names while it prevents inference.",
    "This does not guarantee names whereas it prevents inference.",
    "This does not guarantee names yet it prevents inference.",
    "This does not guarantee anonymity because the output prevents inference.",
    "This does not guarantee anonymity since the output prevents inference.",
    "This does not guarantee anonymity although the output prevents inference.",
    "This does not guarantee anonymity though the output prevents inference.",
    "The output guarantees anonymity but does not prevent inference.",
    "The output does not guarantee anonymity but prevents inference.",
    "The output makes contributors anonymous but does not prevent inference.",
    "The output does not make contributors anonymous but guarantees anonymity.",
    "The threshold prevents inference and does not guarantee anonymity.",
    "The threshold does not prevent inference and guarantees anonymity.",
    "This does not guarantee that individuals cannot be inferred, but it guarantees anonymity.",
    "We cannot guarantee that contributors cannot be identified and the output prevents inference.",
  ])("rejects the guarantee: %s", (claim) => {
    expect(inferenceGuaranteeClaims(claim)).not.toEqual([]);
  });

  it.each([
    "Categorical output does not prevent inference.",
    "Categorical output doesn't prevent inference.",
    "Categorical output do not prevent inference over time.",
    "The threshold does not guarantee anonymity.",
    "The threshold doesn't guarantee anonymity.",
    "This cannot guarantee anonymity.",
    "Categorical output does not make inference impossible.",
    "Thresholding does not make users anonymous.",
    "k = 5 is a product threshold, not an anonymity guarantee.",
    "Dette er ikke full anonymitet.",
    "Kategorisk status forhindrer ikke utledning.",
    "Levels are not shown directly.",
    "This does not guarantee that individuals cannot be inferred.",
    "We cannot guarantee that contributors cannot be identified.",
    "The threshold does not ensure that individual levels cannot be inferred.",
    "The threshold does not prevent inference over time.",
    "Categorical output does not make contributors anonymous.",
    "The threshold does not render users anonymous.",
    "The threshold cannot ensure anonymity.",
    "The threshold doesn't guarantee anonymity.",
    "Kategorisk status gjør ikke bidragsytere anonyme.",
    "Kategorisk status hindrer ikke utledning.",
    "Kategorisk status garanterer ikke anonymitet.",
    "The output does not guarantee anonymity and does not prevent inference.",
    "The output does not make contributors anonymous and does not guarantee anonymity.",
    "The threshold does not prevent inference and does not ensure anonymity.",
  ])("allows the stated limit: %s", (ok) => {
    expect(inferenceGuaranteeClaims(ok)).toEqual([]);
  });

  it("allows the real threat-model comment in the privacy suite, which must stay in the scanned sources", () => {
    const path = "src/features/team-skills/server/get-team-skill-coverage-privacy.test.ts";
    const source = read(path);
    expect(source).toMatch(/does not prevent inference/);
    expect(sources).toContain(path);
    expect(inferenceGuaranteeClaims(source)).toEqual([]);
  });

  it("no C1/C2 test source or comment claims inference prevention or an anonymity guarantee", () => {
    const offenders = sources.flatMap((p) => inferenceGuaranteeClaims(read(p)).map((s) => `${p}: ${s.slice(0, 100)}`));
    expect(offenders).toEqual([]);
  });

  it("the production sources and copy make no such claim either", () => {
    const offenders = C2_PRODUCTION.filter((p) => /\.(ts|tsx)$/.test(p)).flatMap((p) =>
      inferenceGuaranteeClaims(read(p)).map((s) => `${p}: ${s.slice(0, 100)}`),
    );
    expect(offenders).toEqual([]);
  });
});

describe("Threat-model residual rows are disclosed to the user (SPEC threat model rows 2, 5, 6, 7, 9; BR-21, BR-25)", () => {
  // Key phrases only: editorial rewording must not break these, but dropping the meaning must.
  const notice = participationCopy.noticePoints("Team Alfa").join(" ");
  const disclosure = participationCopy.disclosurePoints.join(" ");

  it("row 2 (lead changing needs and comparing statuses over time) is stated in the disclosure", () => {
    expect(disclosure).toMatch(/Teamledere kan endre kompetansebehovene/);
    expect(disclosure).toMatch(/over tid og sammenligne statusene/);
    expect(disclosure).toMatch(/utlede grov informasjon om gruppen/);
  });

  it("row 5 (homogeneous cohort) is stated in the disclosure", () => {
    expect(disclosure).toMatch(/samme side av et nivå/);
  });

  it("row 9 (colleagues who know each other's levels collaborating) is stated in the disclosure", () => {
    expect(disclosure).toMatch(/kolleger som kjenner hverandres nivåer/);
  });

  it("rows 6 and 7 (roster and participation changes) are stated, with the anonymity limit, in the primary notice", () => {
    expect(notice).toMatch(/ikke full anonymitet/);
    expect(notice).toMatch(/blir med, forlater teamet eller slutter å bidra/);
    expect(notice).toMatch(/grov informasjon om gruppen/);
  });

  // Row 8 (self-subtraction) is deliberately NOT asserted here: the approved BR-25 wording does not describe it
  // separately. It is covered only by the general limit above; see the TASK-019 notes for the honest classification.
});
