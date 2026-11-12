import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeSourceRecord, sourceRecordContext } from "./source-record-codec";
import { FakePersonalRecordStore } from "./fake-personal-record-store";
import { listSelectableEvidence, readOwnedEvidenceSource } from "./owned-evidence-source";
import type { RecordCollection } from "../domain/record-schema";

/**
 * Owner-scoped evidence source reads (SECURITY-REVIEW §11.1 classes B to F, §11.2 N-E2). Real source-record encryption with a
 * random test key. Synthetic values only (invariant 15). Errors carry the code, never the stored content.
 */

const OWNER = "owner-1";
const OTHER = "owner-2";
const NOW = new Date("2026-10-01T08:00:00.000Z");

/** Builds the stored document of one responsibility or achievement, exactly as the create path writes it. */
function storedRecord(
  owner: string,
  collection: RecordCollection,
  id: string,
  payload: Record<string, unknown>,
  plain: Record<string, unknown>,
) {
  const encoded = encodeSourceRecord(payload, sourceRecordContext(owner, collection, id));
  if (!encoded.ok) throw new Error("fixture key unavailable");
  return { ...encoded.envelope, ...plain, createdAt: NOW, updatedAt: NOW, _collection: collection };
}

function responsibilityDoc(owner = OWNER, id = "resp-1") {
  return storedRecord(
    owner,
    "responsibilities",
    id,
    { title: "Synthetic ansvar", description: "Synthetic beskrivelse" },
    { status: "active", relationToRole: "within", startDate: "2026-01-01", endDate: null, goalIds: [] },
  );
}

function achievementDoc(owner = OWNER, id = "ach-1") {
  return storedRecord(
    owner,
    "achievements",
    id,
    { title: "Synthetic prestasjon", description: "Synthetic description", outcome: null },
    { relationToRole: "beyond", periodStart: null, periodEnd: "2026-09-30", goalIds: [], responsibilityIds: [] },
  );
}

/** Removes the test-only marker before the document is seeded. */
function seedable(data: Record<string, unknown>): Record<string, unknown> {
  const rest = { ...data };
  delete rest._collection;
  return rest;
}

let store: FakePersonalRecordStore;

beforeEach(() => {
  vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  store = new FakePersonalRecordStore();
  store.seed(OWNER, "responsibilities", "resp-1", seedable(responsibilityDoc()));
  store.seed(OWNER, "achievements", "ach-1", seedable(achievementDoc()));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("readOwnedEvidenceSource: one owner's record, allow-listed fields only", () => {
  it("returns the responsibility's source fields with no id and no timestamps", async () => {
    const result = await readOwnedEvidenceSource(OWNER, "responsibility", "resp-1", store);
    expect(result).toEqual({
      ok: true,
      fields: {
        kind: "responsibility",
        title: "Synthetic ansvar",
        description: "Synthetic beskrivelse",
        status: "active",
        relationToRole: "within",
        startDate: "2026-01-01",
        endDate: null,
      },
    });
  });

  it("returns the achievement's source fields, including the outcome-free period", async () => {
    const result = await readOwnedEvidenceSource(OWNER, "achievement", "ach-1", store);
    expect(result).toEqual({
      ok: true,
      fields: {
        kind: "achievement",
        title: "Synthetic prestasjon",
        description: "Synthetic description",
        outcome: null,
        relationToRole: "beyond",
        periodStart: null,
        periodEnd: "2026-09-30",
      },
    });
  });

  it("returns not_found for another owner's record id, with no field", async () => {
    store.seed(OTHER, "responsibilities", "resp-2", seedable(responsibilityDoc(OTHER, "resp-2")));
    expect(await readOwnedEvidenceSource(OWNER, "responsibility", "resp-2", store)).toEqual({ ok: false, error: "not_found" });
  });

  it("returns not_found for an unknown id, the same neutral answer as a foreign id", async () => {
    expect(await readOwnedEvidenceSource(OWNER, "responsibility", "missing-1", store)).toEqual({ ok: false, error: "not_found" });
  });

  it("returns not_found for a record of the other kind, never a wrong-type field set", async () => {
    expect(await readOwnedEvidenceSource(OWNER, "achievement", "resp-1", store)).toEqual({ ok: false, error: "not_found" });
  });

  it("returns not_found for a tampered ciphertext with a matching key check, and never a field (class D)", async () => {
    const doc = store.peek(OWNER, "responsibilities", "resp-1");
    if (doc === undefined) throw new Error("fixture missing");
    store.seed(OWNER, "responsibilities", "resp-1", { ...doc, ciphertext: Buffer.alloc(16, 1).toString("base64") });

    expect(await readOwnedEvidenceSource(OWNER, "responsibility", "resp-1", store)).toEqual({ ok: false, error: "not_found" });
  });

  it("returns persistence_failed for a wrong key, with no field, id or key detail (class C)", async () => {
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    const result = await readOwnedEvidenceSource(OWNER, "responsibility", "resp-1", store);
    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(JSON.stringify(result)).not.toMatch(/Synthetic|resp-1/);
  });

  it("returns persistence_failed for a missing key, without decrypting", async () => {
    delete process.env.ENCRYPTION_KEY;
    expect(await readOwnedEvidenceSource(OWNER, "responsibility", "resp-1", store)).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("returns persistence_failed when the store read rejects, and never the raw error", async () => {
    const failing = {
      ...store,
      get: async () => {
        throw new Error("secret store path");
      },
    } as unknown as FakePersonalRecordStore;
    const result = await readOwnedEvidenceSource(OWNER, "responsibility", "resp-1", failing);
    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(JSON.stringify(result)).not.toContain("secret store path");
  });
});

describe("listSelectableEvidence: owner list without link lookups", () => {
  it("lists the owner's decrypted records with their ids, kinds and titles", async () => {
    const result = await listSelectableEvidence(OWNER, store);
    expect(result).toEqual({
      ok: true,
      list: {
        items: [
          { kind: "responsibility", id: "resp-1", title: "Synthetic ansvar", status: "active" },
          { kind: "achievement", id: "ach-1", title: "Synthetic prestasjon", status: null },
        ],
        truncated: false,
      },
    });
  });

  it("does not list another owner's records", async () => {
    store.seed(OTHER, "responsibilities", "resp-9", seedable(responsibilityDoc(OTHER, "resp-9")));
    const result = await listSelectableEvidence(OWNER, store);
    expect(result.ok && result.list.items.map((item) => item.id)).toEqual(["resp-1", "ach-1"]);
  });

  it("skips a malformed record instead of offering it, and does not repair it", async () => {
    store.seed(OWNER, "responsibilities", "resp-bad", { ciphertext: "not-an-envelope" });
    const result = await listSelectableEvidence(OWNER, store);
    expect(result.ok && result.list.items.map((item) => item.id)).toEqual(["resp-1", "ach-1"]);
  });

  it("fails the whole list with persistence_failed under a wrong key, with no items", async () => {
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    expect(await listSelectableEvidence(OWNER, store)).toEqual({ ok: false, error: "persistence_failed" });
  });
});

describe("the owner read never reaches another person's collection (PR-SI-1)", () => {
  it("reads only the verified owner's subtree", async () => {
    const seen: Array<{ ownerUid: string; collection: RecordCollection }> = [];
    const spy = {
      get: async (ownerUid: string, collection: RecordCollection, id: string) => {
        seen.push({ ownerUid, collection });
        return store.get(ownerUid, collection, id);
      },
      list: async (ownerUid: string, collection: RecordCollection, limit: number) => {
        seen.push({ ownerUid, collection });
        return store.list(ownerUid, collection, limit);
      },
    } as unknown as FakePersonalRecordStore;
    await readOwnedEvidenceSource(OWNER, "achievement", "ach-1", spy);
    await listSelectableEvidence(OWNER, spy);
    expect(seen.every((entry) => entry.ownerUid === OWNER)).toBe(true);
  });
});
