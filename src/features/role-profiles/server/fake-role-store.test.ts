import { describe, expect, it } from "vitest";
import type { StoredRoleDefinition } from "../domain/role-definition";
import { createFakeRoleStore } from "./fake-role-store";

const BASE = new Date("2026-10-01T10:00:00Z");

function role(name: string, offsetDays = 0): StoredRoleDefinition {
  return {
    name,
    expectations: [],
    createdAt: new Date(BASE.getTime() + offsetDays * 86_400_000),
    createdBy: "admin-uid",
  };
}

function sequentialIds() {
  let index = 0;
  return () => `role-${String(index++).padStart(3, "0")}`;
}

describe("fake role store", () => {
  it("create stores the document under the generated id and never overwrites", async () => {
    const store = createFakeRoleStore({ generateId: sequentialIds() });
    const id = await store.create(role("Backend"));
    expect(id).toBe("role-000");
    expect(await store.get(id)).toMatchObject({ name: "Backend", createdAt: BASE });
    await expect(store.create({ ...role("Other"), createdBy: "x" })).resolves.toBe("role-001");
  });

  it("refuses to overwrite an existing document", async () => {
    const store = createFakeRoleStore({ generateId: () => "fixed" });
    await store.create(role("First"));
    await expect(store.create(role("Second"))).rejects.toThrow("already exists");
  });

  it("get returns undefined for an absent document", async () => {
    const store = createFakeRoleStore();
    expect(await store.get("missing")).toBeUndefined();
  });

  it("refuses an unaddressable role id", async () => {
    const store = createFakeRoleStore();
    await expect(store.get("bad/id")).rejects.toThrow("invalid role store key");
    await expect(store.get("__reserved__")).rejects.toThrow("invalid role store key");
  });

  it("orders the window by createdAt ascending, then by document id", async () => {
    const store = createFakeRoleStore();
    store.seedRaw("b", { ...role("B", 1) });
    store.seedRaw("a", { ...role("A", 1) });
    store.seedRaw("c", { ...role("C", 0) });
    const { docs } = await store.listWindow();
    expect(docs.map((doc) => doc.id)).toEqual(["c", "a", "b"]);
  });

  it("returns at most 50 documents and reports 51 raw when more exist", async () => {
    const store = createFakeRoleStore();
    for (let index = 0; index < 60; index += 1) {
      store.seedRaw(`r-${String(index).padStart(2, "0")}`, { ...role(`R${index}`, index) });
    }
    const window = await store.listWindow();
    expect(window.docs).toHaveLength(50);
    expect(window.rawCount).toBe(51);
    expect(window.docs[49]?.id).toBe("r-49");
  });

  it("reports the raw count without truncation when there are exactly 50 documents", async () => {
    const store = createFakeRoleStore();
    for (let index = 0; index < 50; index += 1) {
      store.seedRaw(`r-${String(index).padStart(2, "0")}`, { ...role(`R${index}`, index) });
    }
    const window = await store.listWindow();
    expect(window.docs).toHaveLength(50);
    expect(window.rawCount).toBe(50);
  });

  it("excludes documents without createdAt from the ordered window but still counts them", async () => {
    const store = createFakeRoleStore();
    store.seedRaw("kept", { ...role("Kept") });
    store.seedRaw("no-timestamp", { name: "Missing", expectations: [], createdBy: "x" });
    const window = await store.listWindow();
    expect(window.docs.map((doc) => doc.id)).toEqual(["kept"]);
    expect(await store.count()).toBe(2);
  });

  it("lets a malformed document with a non-timestamp createdAt consume a window slot", async () => {
    const store = createFakeRoleStore();
    store.seedRaw("valid", { ...role("Valid", 5) });
    store.seedRaw("malformed", { ...role("Bad"), createdAt: "not-a-date" });
    const window = await store.listWindow();
    expect(window.docs.map((doc) => doc.id)).toEqual(["valid", "malformed"]);
    expect(window.rawCount).toBe(2);
  });

  it("counts every document, malformed included, for the cap", async () => {
    const store = createFakeRoleStore();
    for (let index = 0; index < 55; index += 1) {
      store.seedRaw(`r-${index}`, { ...role(`R${index}`, index) });
    }
    expect(await store.count()).toBe(55);
  });

  it("update applies set and unset fields", async () => {
    const store = createFakeRoleStore({ generateId: () => "r" });
    await store.create(role("Backend"));
    const archivedAt = new Date("2026-10-05T10:00:00Z");
    await store.update("r", { set: { archivedAt, archivedBy: "admin-2" }, unset: [] });
    expect(await store.get("r")).toMatchObject({ archivedAt, archivedBy: "admin-2" });
    await store.update("r", { set: {}, unset: ["archivedAt", "archivedBy"] });
    const restored = await store.get("r");
    expect(restored).not.toHaveProperty("archivedAt");
    expect(restored).not.toHaveProperty("archivedBy");
  });

  it("update never changes createdAt and refuses to set it", async () => {
    const store = createFakeRoleStore({ generateId: () => "r" });
    await store.create(role("Backend", 3));
    const forged: Record<string, unknown> = { createdAt: new Date() };
    await expect(store.update("r", { set: forged, unset: [] })).rejects.toThrow("invalid role store key");
    await expect(store.update("r", { set: { name: "Renamed" }, unset: [] })).resolves.toBeUndefined();
    expect(await store.get("r")).toMatchObject({ name: "Renamed", createdAt: new Date(BASE.getTime() + 3 * 86_400_000) });
  });

  it("update refuses an internal audit field outside the mutable set", async () => {
    const store = createFakeRoleStore({ generateId: () => "r" });
    await store.create(role("Backend"));
    const forged: Record<string, unknown> = { createdBy: "someone-else" };
    await expect(store.update("r", { set: forged, unset: [] })).rejects.toThrow("invalid role store key");
  });

  it("update rejects an absent document", async () => {
    const store = createFakeRoleStore();
    await expect(store.update("missing", { set: { name: "X" }, unset: [] })).rejects.toThrow("not found");
  });
});
