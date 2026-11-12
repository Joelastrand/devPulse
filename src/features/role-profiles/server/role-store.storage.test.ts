import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDefaultRoleWriteStore } from "./role-store";

/**
 * Storage boundary of the role store's transactional writes. A Firestore double records the exact payloads written and serves
 * stored documents back, so the test proves what is persisted, that every change re-seals the whole content, and that a
 * lifecycle-only change leaves the content untouched. Synthetic fixtures only.
 */
const holder = vi.hoisted(() => ({
  docs: new Map<string, Record<string, unknown>>(),
  writes: [] as Array<{ kind: "create" | "update"; path: string; data: Record<string, unknown> }>,
}));

vi.mock("firebase-admin/firestore", () => {
  class Timestamp {
    constructor(private readonly value: Date) {}
    static fromDate(value: Date): Timestamp {
      return new Timestamp(value);
    }
    toDate(): Date {
      return this.value;
    }
  }
  const DELETE = { __fieldDelete: true };
  return { Timestamp, FieldValue: { delete: () => DELETE } };
});

vi.mock("../../../lib/firebase/admin", () => {
  const db = {
    collection: (name: string) => ({
      doc: (id?: string) => {
        const docId = id ?? `auto-${holder.docs.size + 1}`;
        const path = `${name}/${docId}`;
        return {
          id: docId,
          path,
          async get() {
            const data = holder.docs.get(path);
            return { exists: data !== undefined, data: () => (data === undefined ? undefined : { ...data }) };
          },
        };
      },
    }),
    runTransaction: async <T>(work: (tx: unknown) => Promise<T>) =>
      work({
        async get(ref: { path: string }) {
          const data = holder.docs.get(ref.path);
          return { exists: data !== undefined, data: () => (data === undefined ? undefined : { ...data }) };
        },
        create(ref: { path: string }, data: Record<string, unknown>) {
          holder.writes.push({ kind: "create", path: ref.path, data });
          holder.docs.set(ref.path, { ...data });
        },
        update(ref: { path: string }, data: Record<string, unknown>) {
          holder.writes.push({ kind: "update", path: ref.path, data });
          const next: Record<string, unknown> = { ...holder.docs.get(ref.path) };
          for (const [key, value] of Object.entries(data)) {
            if (typeof value === "object" && value !== null && (value as { __fieldDelete?: boolean }).__fieldDelete) {
              delete next[key];
            } else {
              next[key] = value;
            }
          }
          holder.docs.set(ref.path, next);
        },
      }),
  };
  return { getFirestoreDb: () => db };
});

vi.mock("../../auth/server/erasure-write-fence", () => ({
  runFencedTransaction: async (db: { runTransaction: (work: (tx: unknown) => Promise<unknown>) => Promise<unknown> }, _uid: string, work: (tx: unknown) => Promise<unknown>) =>
    db.runTransaction(work),
}));

const ROLE = "role-storage-1";
const OTHER_ROLE = "role-storage-2";
const ACTOR = "admin-1";
const CREATED_AT = new Date("2026-01-01T00:00:00Z");

function store() {
  return getDefaultRoleWriteStore(ACTOR, { generateId: () => ROLE });
}

function storedContent(roleId: string): unknown {
  return (holder.docs.get(`roleDefinitions/${roleId}`) ?? {}).content;
}

beforeEach(() => {
  vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  holder.docs.clear();
  holder.writes.length = 0;
});

describe("role store storage boundary", () => {
  it("persists the title and description only inside the sealed content, and reads them back", async () => {
    await store().create({ name: "Synthetic role title", description: "Synthetic role description", createdAt: CREATED_AT, createdBy: ACTOR });

    expect(holder.writes).toHaveLength(1);
    const payload = holder.writes[0].data;
    expect(payload).not.toHaveProperty("name");
    expect(payload).not.toHaveProperty("description");
    expect(JSON.stringify(payload)).not.toContain("Synthetic role title");
    expect(JSON.stringify(payload)).not.toContain("Synthetic role description");
    expect(payload.content).toMatchObject({ keyVersion: "v2", keyId: "k1" });
    expect(await store().get(ROLE)).toMatchObject({ name: "Synthetic role title", description: "Synthetic role description" });
  });

  it("re-seals the whole content when the title changes, keeping the description", async () => {
    await store().create({ name: "Synthetic role title", description: "Synthetic role description", createdAt: CREATED_AT, createdBy: ACTOR });
    const before = storedContent(ROLE);

    await store().update(ROLE, { set: { name: "Renamed synthetic title" }, unset: [] });

    expect(storedContent(ROLE)).not.toEqual(before);
    expect(holder.docs.get(`roleDefinitions/${ROLE}`)).not.toHaveProperty("name");
    expect(JSON.stringify(holder.docs.get(`roleDefinitions/${ROLE}`))).not.toContain("Renamed synthetic title");
    expect(await store().get(ROLE)).toMatchObject({ name: "Renamed synthetic title", description: "Synthetic role description" });
  });

  it("removes the description from the sealed content when it is unset, keeping the title", async () => {
    await store().create({ name: "Synthetic role title", description: "Synthetic role description", createdAt: CREATED_AT, createdBy: ACTOR });

    await store().update(ROLE, { set: {}, unset: ["description"] });

    const opened = await store().get(ROLE);
    expect(opened).toMatchObject({ name: "Synthetic role title" });
    expect(opened).not.toHaveProperty("description");
  });

  it("writes a lifecycle-only change without touching the sealed content", async () => {
    await store().create({ name: "Synthetic role title", description: "Synthetic role description", createdAt: CREATED_AT, createdBy: ACTOR });
    const before = storedContent(ROLE);
    const archivedAt = new Date("2026-02-01T00:00:00Z");

    await store().update(ROLE, { set: { archivedAt, archivedBy: "admin-2" }, unset: [] });

    const last = holder.writes[holder.writes.length - 1];
    expect(last.data).not.toHaveProperty("content");
    expect(storedContent(ROLE)).toEqual(before);
    expect(await store().get(ROLE)).toMatchObject({ name: "Synthetic role title", description: "Synthetic role description" });
  });

  it("refuses a change to a missing role and writes nothing", async () => {
    await expect(store().update("role-missing", { set: { name: "Synthetic" }, unset: [] })).rejects.toThrow("role_not_found");
    expect(holder.writes).toHaveLength(0);
  });

  it("refuses a change when the stored content cannot be opened, and writes nothing", async () => {
    await store().create({ name: "Synthetic role title", description: "Synthetic role description", createdAt: CREATED_AT, createdBy: ACTOR });
    const writesBefore = holder.writes.length;
    const stored = holder.docs.get(`roleDefinitions/${ROLE}`) as { content: { ciphertext: string } };
    const flipped = Buffer.from(stored.content.ciphertext, "base64");
    flipped[0] = (flipped[0] ?? 0) ^ 0x01;
    holder.docs.set(`roleDefinitions/${ROLE}`, { ...stored, content: { ...stored.content, ciphertext: flipped.toString("base64") } });

    await expect(store().update(ROLE, { set: { name: "Synthetic" }, unset: [] })).rejects.toThrow("role_content_unreadable");
    expect(holder.writes.length).toBe(writesBefore);
  });

  it("does not return another role's content for a substituted envelope", async () => {
    await store().create({ name: "Synthetic role title", description: "Synthetic role description", createdAt: CREATED_AT, createdBy: ACTOR });
    holder.docs.set(`roleDefinitions/${OTHER_ROLE}`, { ...holder.docs.get(`roleDefinitions/${ROLE}`) });

    const substituted = await getDefaultRoleWriteStore(ACTOR).get(OTHER_ROLE);
    expect(substituted).not.toHaveProperty("name");
  });

  it("fails closed when the key is missing, rather than returning plaintext", async () => {
    await store().create({ name: "Synthetic role title", description: "Synthetic role description", createdAt: CREATED_AT, createdBy: ACTOR });
    vi.stubEnv("ENCRYPTION_KEY", "");

    await expect(store().get(ROLE)).rejects.toThrow();
  });
});
