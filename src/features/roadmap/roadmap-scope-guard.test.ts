import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildDemoLogicalFixtures, DEMO_ROADMAP_PLANS } from "../demo-team/fixtures";
import type { RoadmapItemRecord } from "./domain/roadmap-item";

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const normalized = (path: string) => read(path).replace(/\r\n/g, "\n");

function sourceFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/**
 * Compile-time exhaustive key map: adding or removing a `RoadmapItemRecord` field without updating
 * this map is a type error (missing property / excess property), so the persisted shape cannot drift
 * silently. The runtime list below then pins the same set.
 */
const PERSISTED_KEYS = {
  teamId: true,
  treeId: true,
  targetNodeId: true,
  priority: true,
  status: true,
  startDate: true,
  targetDate: true,
  ownerRef: true,
  completedAt: true,
  archivedAt: true,
  archivedBy: true,
  createdAt: true,
  createdBy: true,
  updatedAt: true,
  updatedBy: true,
} as const satisfies Record<keyof RoadmapItemRecord, true>;
const PERSISTED = new Set<string>(Object.keys(PERSISTED_KEYS));

/**
 * Automated scope guard for Team Roadmap (TASK-012). It protects the canonical roadmap persistence,
 * index, rule, fixture and API boundaries. It does NOT prove that every unrelated repository file is
 * byte-for-byte unchanged — that is verified by reviewing the git diff.
 */
describe("Team Roadmap scope guard (TASK-012)", () => {
  it("pins the persisted roadmap record to the approved canonical fields (no derived field)", () => {
    expect([...PERSISTED].sort()).toEqual(
      [
        "archivedAt", "archivedBy", "completedAt", "createdAt", "createdBy", "ownerRef", "priority", "startDate",
        "status", "targetDate", "targetNodeId", "teamId", "treeId", "updatedAt", "updatedBy",
      ].sort(),
    );
  });

  it("creates and updates only persisted fields through the roadmap server writes", () => {
    // Create: a single `tx.create(...)` of the record built from the parsed body; the exact written
    // key set is asserted behaviorally in create-roadmap-item.test.ts.
    const update = read("src/features/roadmap/server/update-roadmap-item.ts");
    const written = new Set<string>();
    for (const match of update.matchAll(/patch\.set\.(\w+)\s*=/g)) written.add(match[1]);
    for (const match of update.matchAll(/patch\.remove\.push\(([^)]*)\)/g)) {
      for (const key of match[1].matchAll(/"(\w+)"/g)) written.add(key[1]);
    }
    for (const match of update.matchAll(/set:\s*\{([^}]*)\}/g)) {
      for (const key of match[1].matchAll(/(\w+)\s*:/g)) written.add(key[1]);
    }
    expect(written.size).toBeGreaterThan(0);
    for (const key of written) expect(PERSISTED.has(key), `update writes non-persisted field "${key}"`).toBe(true);
    // The generic `fields[field]` remove loop is the only dynamic write; it only receives `patch.remove`.
    expect(update).toMatch(/for \(const field of patch\.remove\) fields\[field\] = FieldValue\.delete\(\)/);
  });

  it("only writes to the roadmapItems collection from the roadmap server modules", () => {
    for (const file of sourceFiles("src/features/roadmap")) {
      const text = read(file);
      // Every collection access goes through a named constant, never an inline literal.
      expect(text, file).not.toMatch(/\.collection\(\s*["'`]/);
      expect(text, file).not.toMatch(/\.collectionGroup\(/);
      expect(text, file).not.toMatch(/\.batch\(|\.add\(\s*\{/);
      // Every write targets the roadmap-owned collection; other collections are read-only dependencies.
      const writes = [...text.matchAll(/\btx\.(?:create|update|set|delete)\(\s*db\./g)].length;
      const roadmapWrites = [...text.matchAll(/\btx\.(?:create|update|set|delete)\(\s*db\.collection\(ROADMAP_COLLECTION\)/g)].length;
      expect(roadmapWrites, file).toBe(writes);
      for (const match of text.matchAll(/ROADMAP_COLLECTION = "([^"]+)"/g)) expect(match[1]).toBe("roadmapItems");
    }
  });

  it("adds no route method: GET and POST on the collection route, PATCH on the item route", () => {
    const exported = (path: string) =>
      [...read(path).matchAll(/^export (?:async function|const) (GET|POST|PUT|PATCH|DELETE)\b/gm)].map((m) => m[1]);
    expect(exported("app/api/teams/[teamId]/roadmap-items/route.ts").sort()).toEqual(["GET", "POST"]);
    expect(exported("app/api/teams/[teamId]/roadmap-items/[treeId]/route.ts")).toEqual(["PATCH"]);
  });

  it("pins the approved Firestore index configuration (no roadmap index added)", () => {
    expect(JSON.parse(read("firestore.indexes.json"))).toEqual({
      indexes: [
        {
          collectionGroup: "teamInvitations",
          queryScope: "COLLECTION",
          fields: [
            { fieldPath: "email", order: "ASCENDING" },
            { fieldPath: "status", order: "ASCENDING" },
          ],
        },
        {
          collectionGroup: "teamAccessRequests",
          queryScope: "COLLECTION",
          fields: [
            { fieldPath: "teamId", order: "ASCENDING" },
            { fieldPath: "status", order: "ASCENDING" },
          ],
        },
        {
          collectionGroup: "forumThreads",
          queryScope: "COLLECTION",
          fields: [
            { fieldPath: "teamId", order: "ASCENDING" },
            { fieldPath: "createdAt", order: "DESCENDING" },
          ],
        },
        {
          collectionGroup: "forumReplies",
          queryScope: "COLLECTION",
          fields: [
            { fieldPath: "threadId", order: "ASCENDING" },
            { fieldPath: "createdAt", order: "ASCENDING" },
          ],
        },
      ],
      fieldOverrides: [],
    });
  });

  it("keeps the roadmapItems rule a single deny-all block and grants no roadmap access elsewhere", () => {
    const rules = normalized("firestore.rules");
    const header = "match /roadmapItems/{document=**} {";
    expect(rules.split(header)).toHaveLength(2);
    const start = rules.indexOf(header) + header.length;
    const block = rules.slice(start, rules.indexOf("}", start));
    expect(block.replace(/\s+/g, " ").trim()).toBe("allow read, write: if false;");
  });

  it("keeps the approved Demo Team roadmap fixtures (canonical fields only)", () => {
    const { roadmapItems } = buildDemoLogicalFixtures({
      presenterUid: "presenter-uid",
      asOf: new Date("2026-06-01T00:00:00.000Z"),
    });
    expect(DEMO_ROADMAP_PLANS.map(({ treeId, targetNodeId, status, priority }) => ({ treeId, targetNodeId, status, priority }))).toEqual([
      { treeId: "demo-skill-testing", targetNodeId: "node-4", status: "active", priority: "high" },
      { treeId: "demo-skill-observability", targetNodeId: "node-2", status: "planned", priority: "medium" },
      { treeId: "demo-skill-delivery", targetNodeId: "node-4", status: "completed", priority: "low" },
    ]);
    expect(roadmapItems.map((item) => item.treeId)).toEqual(DEMO_ROADMAP_PLANS.map((plan) => plan.treeId));
    for (const { record } of roadmapItems) {
      for (const key of Object.keys(record)) expect(PERSISTED.has(key), `fixture field "${key}"`).toBe(true);
      expect(record.teamId).toBe("demo-team");
      expect("ownerRef" in record || "archivedAt" in record).toBe(false);
    }
  });
});
