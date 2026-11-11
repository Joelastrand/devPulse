import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakePersonalRecordStore } from "./fake-personal-record-store";
import {
  createAchievement,
  createResponsibility,
  deleteAchievement,
  deleteResponsibility,
  listAchievements,
  listResponsibilities,
  updateResponsibility,
  type PersonalRecordDeps,
} from "./record-operations";
import { encodeSourceRecord } from "./source-record-codec";
import { RESPONSIBILITY_CAP } from "../domain/constants";

const KEY = Buffer.alloc(32, 7).toString("base64");
const OTHER_KEY = Buffer.alloc(32, 9).toString("base64");
const original = process.env.ENCRYPTION_KEY;
const OWNER = "owner-uid";
const OTHER_USER = "other-uid";
const KNOWN_GOAL = "goal-1";

let store: FakePersonalRecordStore;
let deps: PersonalRecordDeps;

beforeEach(() => {
  process.env.ENCRYPTION_KEY = KEY;
  store = new FakePersonalRecordStore();
  deps = {
    store,
    goalExists: async (ownerUid, goalId) => ownerUid === OWNER && goalId === KNOWN_GOAL,
    clock: () => new Date("2026-11-10T10:00:00.000Z"),
  };
});
afterEach(() => {
  if (original === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = original;
});

const validCreate = {
  title: "Driftsansvar for API",
  description: "Syntetisk beskrivelse",
  status: "active",
  relationToRole: "within",
  startDate: "2026-01-01",
  endDate: null,
  goalIds: [KNOWN_GOAL],
};

/** A stored record sealed with the configured key, for seeding the fake store. */
function sealedDocument(payload: Record<string, unknown>, plain: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  const sealed = encodeSourceRecord(payload);
  if (!sealed.ok) throw new Error("setup failed");
  const stamp = new Date("2026-11-01T00:00:00.000Z");
  return { ...sealed.envelope, ...plain, createdAt: stamp, updatedAt: stamp, ...overrides };
}

const plainOf = { status: "active", relationToRole: "within", startDate: null, endDate: null, goalIds: [] };

describe("responsibilities: owner-only create, list and update (SPEC BR-10 to BR-16)", () => {
  it("creates a record and returns the explicit DTO with no internal fields", async () => {
    const result = await createResponsibility(OWNER, validCreate, deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.dto).sort()).toEqual(
      ["id", "title", "description", "status", "relationToRole", "startDate", "endDate", "goalIds", "createdAt", "updatedAt"].sort(),
    );
    expect(result.dto.title).toBe("Driftsansvar for API");
  });

  it("stores title and description only inside the encrypted envelope", async () => {
    const result = await createResponsibility(OWNER, validCreate, deps);
    if (!result.ok) throw new Error("create failed");
    const stored = store.peek(OWNER, "responsibilities", String(result.dto.id));
    expect(stored).toBeDefined();
    expect(JSON.stringify(stored)).not.toContain("Driftsansvar");
    expect(JSON.stringify(stored)).not.toContain("Syntetisk");
    expect(stored).not.toHaveProperty("title");
  });

  it("lists the owner's records and never returns another user's records", async () => {
    await createResponsibility(OWNER, validCreate, deps);
    await createResponsibility(OTHER_USER, { ...validCreate, title: "Annen person" }, deps);
    const list = await listResponsibilities(OWNER, deps);
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    const titles = list.result.items.flatMap((item) => (item.kind === "record" ? [item.dto.title] : []));
    expect(titles).toEqual(["Driftsansvar for API"]);
  });

  it("rejects an invalid title with no write", async () => {
    const result = await createResponsibility(OWNER, { ...validCreate, title: "   " }, deps);
    expect(result).toEqual({ ok: false, error: "invalid_input" });
    expect(store.count(OWNER, "responsibilities")).toBe(0);
  });

  it("rejects an end date before the start date with no write", async () => {
    const result = await createResponsibility(OWNER, { ...validCreate, startDate: "2026-05-01", endDate: "2026-04-01" }, deps);
    expect(result).toEqual({ ok: false, error: "invalid_input" });
    expect(store.count(OWNER, "responsibilities")).toBe(0);
  });

  it("rejects an unknown or foreign goal id with invalid_reference and no write", async () => {
    const result = await createResponsibility(OWNER, { ...validCreate, goalIds: ["someone-elses-goal"] }, deps);
    expect(result).toEqual({ ok: false, error: "invalid_reference" });
    expect(store.count(OWNER, "responsibilities")).toBe(0);
  });

  it("enforces the per-person cap with no write", async () => {
    for (let index = 0; index < RESPONSIBILITY_CAP; index += 1) {
      store.seed(OWNER, "responsibilities", `seed-${index}`, sealedDocument({ title: "t", description: null }, plainOf));
    }
    const result = await createResponsibility(OWNER, validCreate, deps);
    expect(result).toEqual({ ok: false, error: "record_limit" });
    expect(store.count(OWNER, "responsibilities")).toBe(RESPONSIBILITY_CAP);
  });

  it("refuses a create when the configured key is missing, with no write", async () => {
    delete process.env.ENCRYPTION_KEY;
    const result = await createResponsibility(OWNER, validCreate, deps);
    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(store.count(OWNER, "responsibilities")).toBe(0);
  });

  it("refuses a create when an existing record was sealed with a different key, with no write", async () => {
    process.env.ENCRYPTION_KEY = OTHER_KEY;
    store.seed(OWNER, "responsibilities", "old-record", sealedDocument({ title: "t", description: null }, plainOf));
    process.env.ENCRYPTION_KEY = KEY;
    const result = await createResponsibility(OWNER, validCreate, deps);
    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(store.count(OWNER, "responsibilities")).toBe(1);
  });
});

describe("responsibilities: key failures never become deletable items (PR-SI-5, C-5)", () => {
  it("fails the whole list with a wrong key and returns no item and no id", async () => {
    process.env.ENCRYPTION_KEY = OTHER_KEY;
    store.seed(OWNER, "responsibilities", "rec-a", sealedDocument({ title: "t", description: null }, plainOf));
    process.env.ENCRYPTION_KEY = KEY;
    const list = await listResponsibilities(OWNER, deps);
    expect(list).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("reports a tampered record as unavailable, with no id", async () => {
    const document = sealedDocument({ title: "t", description: null }, plainOf);
    const bytes = Buffer.from(String(document.ciphertext), "base64");
    bytes[0] = bytes[0] ^ 0xff;
    store.seed(OWNER, "responsibilities", "rec-tampered", { ...document, ciphertext: bytes.toString("base64") });
    const list = await listResponsibilities(OWNER, deps);
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.result.items).toEqual([{ kind: "unavailable" }]);
  });

  it("refuses an update of a tampered record, with no write", async () => {
    const document = sealedDocument({ title: "t", description: null }, plainOf);
    const bytes = Buffer.from(String(document.ciphertext), "base64");
    bytes[0] = bytes[0] ^ 0xff;
    const tampered = { ...document, ciphertext: bytes.toString("base64") };
    store.seed(OWNER, "responsibilities", "rec-tampered", tampered);
    const result = await updateResponsibility(OWNER, "rec-tampered", { title: "Ny" }, deps);
    expect(result).toEqual({ ok: false, error: "record_unavailable" });
    expect(store.peek(OWNER, "responsibilities", "rec-tampered")).toEqual(tampered);
  });

  it("refuses an update with a wrong key without writing, and the stored document is unchanged", async () => {
    process.env.ENCRYPTION_KEY = OTHER_KEY;
    const document = sealedDocument({ title: "t", description: null }, plainOf);
    store.seed(OWNER, "responsibilities", "rec-b", document);
    process.env.ENCRYPTION_KEY = KEY;
    const result = await updateResponsibility(OWNER, "rec-b", { title: "Ny" }, deps);
    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(store.peek(OWNER, "responsibilities", "rec-b")).toEqual(document);
  });

  it("reports a structurally invalid record (extra field) as a delete-only recovery item", async () => {
    store.seed(OWNER, "responsibilities", "rec-extra", { ...sealedDocument({ title: "t", description: null }, plainOf), leaked: "x" });
    const list = await listResponsibilities(OWNER, deps);
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.result.items).toEqual([{ kind: "malformed", id: "rec-extra" }]);
  });

  it("refuses to update a malformed record, with no write", async () => {
    const malformed = { ...sealedDocument({ title: "t", description: null }, plainOf), leaked: "x" };
    store.seed(OWNER, "responsibilities", "rec-extra", malformed);
    const result = await updateResponsibility(OWNER, "rec-extra", { title: "Ny" }, deps);
    expect(result).toEqual({ ok: false, error: "record_unavailable" });
    expect(store.peek(OWNER, "responsibilities", "rec-extra")).toEqual(malformed);
  });

  it("deletes a record under a wrong key, without decrypting it", async () => {
    process.env.ENCRYPTION_KEY = OTHER_KEY;
    store.seed(OWNER, "responsibilities", "rec-c", sealedDocument({ title: "t", description: null }, plainOf));
    process.env.ENCRYPTION_KEY = KEY;
    const result = await deleteResponsibility(OWNER, "rec-c", deps);
    expect(result).toEqual({ ok: true });
    expect(store.count(OWNER, "responsibilities")).toBe(0);
  });
});

describe("cross-user and fence negative paths (PR-SI-1, PR-SI-7)", () => {
  it("returns not_found when another user tries to update or delete a record by id", async () => {
    const created = await createResponsibility(OWNER, validCreate, deps);
    if (!created.ok) throw new Error("setup failed");
    const id = String(created.dto.id);
    const otherUpdate = await updateResponsibility(OTHER_USER, id, { title: "Stjålet" }, deps);
    const otherDelete = await deleteResponsibility(OTHER_USER, id, deps);
    expect(otherUpdate).toEqual({ ok: false, error: "not_found" });
    expect(otherDelete).toEqual({ ok: false, error: "not_found" });
    expect(store.count(OWNER, "responsibilities")).toBe(1);
  });

  it("refuses a create while the erasure fence holds, with no write", async () => {
    store.fencedUids.add(OWNER);
    const result = await createResponsibility(OWNER, validCreate, deps);
    expect(result).toEqual({ ok: false, error: "erasure_in_progress" });
    expect(store.count(OWNER, "responsibilities")).toBe(0);
  });

  it("refuses a delete while the erasure fence holds, with no write", async () => {
    const created = await createResponsibility(OWNER, validCreate, deps);
    if (!created.ok) throw new Error("setup failed");
    store.fencedUids.add(OWNER);
    const result = await deleteResponsibility(OWNER, String(created.dto.id), deps);
    expect(result).toEqual({ ok: false, error: "erasure_in_progress" });
    expect(store.count(OWNER, "responsibilities")).toBe(1);
  });

  it("maps an unexpected store failure to persistence_failed, not to a raw error", async () => {
    const failing: PersonalRecordDeps = {
      ...deps,
      store: {
        list: async () => {
          throw new Error("boom");
        },
        get: async () => undefined,
        exists: async () => false,
        runFenced: async () => {
          throw new Error("boom");
        },
      },
    };
    expect(await listResponsibilities(OWNER, failing)).toEqual({ ok: false, error: "persistence_failed" });
    expect(await createResponsibility(OWNER, validCreate, failing)).toEqual({ ok: false, error: "persistence_failed" });
  });
});

describe("achievements: responsibility links must be the owner's own records (BR-22, BR-60)", () => {
  it("rejects a responsibility id that the owner does not have", async () => {
    const result = await createAchievement(
      OWNER,
      { title: "Resultat", description: "Syntetisk", outcome: null, relationToRole: "beyond", periodStart: null, periodEnd: null, goalIds: [], responsibilityIds: ["missing-id"] },
      deps,
    );
    expect(result).toEqual({ ok: false, error: "invalid_reference" });
    expect(store.count(OWNER, "achievements")).toBe(0);
  });

  it("marks deleted responsibility and goal links on read without failing the list (BR-22, E-2, E-3)", async () => {
    const responsibility = await createResponsibility(OWNER, validCreate, deps);
    if (!responsibility.ok) throw new Error("setup failed");
    const responsibilityId = String(responsibility.dto.id);
    const achievement = await createAchievement(
      OWNER,
      { title: "Resultat", description: "Syntetisk", outcome: null, relationToRole: "beyond", periodStart: null, periodEnd: null, goalIds: [KNOWN_GOAL], responsibilityIds: [responsibilityId] },
      deps,
    );
    if (!achievement.ok) throw new Error("setup failed");
    expect(await deleteResponsibility(OWNER, responsibilityId, deps)).toEqual({ ok: true });
    deps = { ...deps, goalExists: async () => false };

    const listed = await listAchievements(OWNER, deps);
    if (!listed.ok) throw new Error("list failed");
    const [item] = listed.result.items;
    expect(item).toMatchObject({ kind: "record", dto: { id: achievement.dto.id, missingLinks: { goalIds: [KNOWN_GOAL], responsibilityIds: [responsibilityId] } } });
    expect(store.count(OWNER, "achievements")).toBe(1);
  });

  it("reports no missing links when every linked record still exists", async () => {
    const achievement = await createAchievement(
      OWNER,
      { title: "Resultat", description: "Syntetisk", outcome: null, relationToRole: "beyond", periodStart: null, periodEnd: null, goalIds: [KNOWN_GOAL], responsibilityIds: [] },
      deps,
    );
    if (!achievement.ok) throw new Error("setup failed");
    const listed = await listAchievements(OWNER, deps);
    if (!listed.ok) throw new Error("list failed");
    expect(listed.result.items[0]).toMatchObject({ kind: "record", dto: { missingLinks: { goalIds: [], responsibilityIds: [] } } });
  });

  it("deletes an achievement by its owner without touching responsibilities", async () => {
    const responsibility = await createResponsibility(OWNER, validCreate, deps);
    const achievement = await createAchievement(
      OWNER,
      { title: "Resultat", description: "Syntetisk", outcome: null, relationToRole: "beyond", periodStart: null, periodEnd: null, goalIds: [], responsibilityIds: responsibility.ok ? [String(responsibility.dto.id)] : [] },
      deps,
    );
    if (!achievement.ok) throw new Error("setup failed");
    expect(await deleteAchievement(OWNER, String(achievement.dto.id), deps)).toEqual({ ok: true });
    expect(store.count(OWNER, "responsibilities")).toBe(1);
  });
});
