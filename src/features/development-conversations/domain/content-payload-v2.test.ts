import { describe, expect, it } from "vitest";
import { parseConversationContent } from "./content-payload";
import { parseSharedEvidenceList, serializeSharedEvidenceSnapshot } from "./shared-evidence-snapshot";

/** Synthetic, obviously fictional fixtures only. */
const CAPTURED = "2026-11-01T09:00:00.000Z";

const baseV1 = () => ({
  title: "Synthetisk samtale",
  ownerNotes: "Syntetiske notater",
  nextSteps: ["Synthetic step"],
  participantNotes: "",
  sharedGoals: [
    {
      goalTitle: "Synthetic goal",
      treeId: null,
      targetDate: null,
      status: "active",
      capturedAt: CAPTURED,
    },
  ],
});

const responsibility = (overrides: Record<string, unknown> = {}) => ({
  kind: "responsibility",
  title: "Synthetic responsibility",
  description: null,
  status: "active",
  relationToRole: "unspecified",
  period: { start: null, end: null },
  capturedAt: CAPTURED,
  ...overrides,
});

const achievement = (overrides: Record<string, unknown> = {}) => ({
  kind: "achievement",
  title: "Synthetic achievement",
  description: "Synthetic description",
  outcome: null,
  period: { start: "2026-01-01", end: "2026-03-31" },
  relationToRole: "within",
  capturedAt: CAPTURED,
  ...overrides,
});

/** Returns a copy without one key, so a test can omit a field without an unused binding. */
const without = (value: Record<string, unknown>, key: string): Record<string, unknown> =>
  Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));

describe("payload v1 and v2 key sets (BR-51, Amendment C2)", () => {
  it("reads a v1 payload with the unchanged five keys and an empty evidence list", () => {
    const result = parseConversationContent(baseV1());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content.sharedEvidence).toEqual([]);
    expect(result.content.sharedGoals).toHaveLength(1);
    expect(result.content.sharedGoals[0].goalTitle).toBe("Synthetic goal");
  });

  it("reads a v2 payload with explicit evidence and preserves the goal snapshot", () => {
    const result = parseConversationContent({ ...baseV1(), sharedEvidence: [responsibility(), achievement()] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content.sharedEvidence.map((item) => item.kind)).toEqual(["responsibility", "achievement"]);
    expect(result.content.sharedGoals[0].goalTitle).toBe("Synthetic goal");
  });

  it("rejects sharedEvidence: null, which is neither absent nor an array", () => {
    expect(parseConversationContent({ ...baseV1(), sharedEvidence: null }).ok).toBe(false);
  });

  it("rejects a non-array sharedEvidence value", () => {
    expect(parseConversationContent({ ...baseV1(), sharedEvidence: {} }).ok).toBe(false);
  });

  it("rejects an extra payload key on top of the v2 set", () => {
    expect(parseConversationContent({ ...baseV1(), sharedEvidence: [], extra: "x" }).ok).toBe(false);
  });

  it("rejects a v2 payload missing a required v1 key", () => {
    expect(parseConversationContent(without({ ...baseV1(), sharedEvidence: [] }, "sharedGoals")).ok).toBe(false);
  });

  it("rejects a payload with a sharedEvidence key but a wrong key set (wrong key)", () => {
    expect(parseConversationContent(without({ ...baseV1(), sharedEvidence: [] }, "ownerNotes")).ok).toBe(false);
  });

  it("rejects a non-object payload", () => {
    expect(parseConversationContent(["not", "an", "object"]).ok).toBe(false);
    expect(parseConversationContent(null).ok).toBe(false);
  });
});

describe("evidence snapshot allow-list (Amendment C2, evidence snapshot schema)", () => {
  it("accepts a responsibility snapshot with the exact allow-list", () => {
    expect(parseSharedEvidenceList([responsibility({ description: "Synthetic note", period: { start: "2026-01-01", end: null } })]).ok).toBe(true);
  });

  it("rejects an evidence item carrying a source id", () => {
    expect(parseSharedEvidenceList([responsibility({ id: "src-1" })]).ok).toBe(false);
  });

  it("rejects an evidence item carrying goal or responsibility links", () => {
    expect(parseSharedEvidenceList([achievement({ goalIds: ["g1"] })]).ok).toBe(false);
    expect(parseSharedEvidenceList([achievement({ responsibilityIds: ["r1"] })]).ok).toBe(false);
  });

  it("rejects an evidence item carrying an owner uid or record timestamps", () => {
    expect(parseSharedEvidenceList([achievement({ ownerUid: "u1" })]).ok).toBe(false);
    expect(parseSharedEvidenceList([achievement({ createdAt: CAPTURED })]).ok).toBe(false);
  });

  it("rejects an unknown kind", () => {
    expect(parseSharedEvidenceList([responsibility({ kind: "goal" })]).ok).toBe(false);
  });

  it("rejects a responsibility missing its status", () => {
    expect(parseSharedEvidenceList([without(responsibility(), "status")]).ok).toBe(false);
  });

  it("rejects a title that would need trimming, rather than repairing it", () => {
    expect(parseSharedEvidenceList([responsibility({ title: " padded " })]).ok).toBe(false);
  });

  it("rejects a non-canonical capturedAt", () => {
    expect(parseSharedEvidenceList([achievement({ capturedAt: "2026-11-01" })]).ok).toBe(false);
  });

  it("rejects a period whose end is before its start", () => {
    expect(parseSharedEvidenceList([achievement({ period: { start: "2026-05-01", end: "2026-01-01" } })]).ok).toBe(false);
  });

  it("rejects an achievement without a description", () => {
    expect(parseSharedEvidenceList([achievement({ description: null })]).ok).toBe(false);
  });

  it("enforces five responsibility snapshots and five achievement snapshots", () => {
    const fiveAndFive = [
      ...Array.from({ length: 5 }, () => responsibility()),
      ...Array.from({ length: 5 }, () => achievement()),
    ];
    expect(parseSharedEvidenceList(fiveAndFive).ok).toBe(true);
    expect(parseSharedEvidenceList([...fiveAndFive, responsibility()]).ok).toBe(false);
    expect(parseSharedEvidenceList([...fiveAndFive, achievement()]).ok).toBe(false);
  });

  it("serializes with the fixed allow-list keys and a canonical capturedAt", () => {
    const parsed = parseSharedEvidenceList([achievement()]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const serialized = serializeSharedEvidenceSnapshot(parsed.value[0]);
    expect(Object.keys(serialized)).toEqual(["kind", "title", "description", "outcome", "period", "relationToRole", "capturedAt"]);
    expect(serialized.capturedAt).toBe(CAPTURED);
  });

  it("round-trips a serialized list through the parser unchanged", () => {
    const first = parseSharedEvidenceList([responsibility(), achievement()]);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const serialized = first.value.map(serializeSharedEvidenceSnapshot);
    const again = parseSharedEvidenceList(serialized);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.value.map(serializeSharedEvidenceSnapshot)).toEqual(serialized);
  });
});
