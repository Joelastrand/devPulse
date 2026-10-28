import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import { toFirestoreRoleData, toRawRoleData } from "./role-store";

const SOURCE = readFileSync(fileURLToPath(new URL("./role-store.ts", import.meta.url)), "utf8");
const CREATED_AT = new Date("2026-10-01T10:00:00Z");

describe("Admin role store mappers", () => {
  it("writes only the stored keys, converting dates to Timestamps and omitting absent optionals", () => {
    const data = toFirestoreRoleData({
      name: "Backend",
      expectations: [{ treeId: "api", expectedLevel: 3 }],
      createdAt: CREATED_AT,
      createdBy: "admin-uid",
    });
    expect(data).toEqual({
      name: "Backend",
      expectations: [{ treeId: "api", expectedLevel: 3 }],
      createdAt: Timestamp.fromDate(CREATED_AT),
      createdBy: "admin-uid",
    });
    expect(data).not.toHaveProperty("description");
    expect(data).not.toHaveProperty("archivedAt");
  });

  it("writes the optional fields when present", () => {
    const data = toFirestoreRoleData({
      name: "Backend",
      description: "Owns APIs",
      expectations: [],
      createdAt: CREATED_AT,
      createdBy: "admin-uid",
      updatedAt: CREATED_AT,
      updatedBy: "admin-2",
      archivedAt: CREATED_AT,
      archivedBy: "admin-3",
    });
    expect(data).toMatchObject({
      description: "Owns APIs",
      updatedAt: Timestamp.fromDate(CREATED_AT),
      updatedBy: "admin-2",
      archivedAt: Timestamp.fromDate(CREATED_AT),
      archivedBy: "admin-3",
    });
  });

  it("maps top-level Timestamps to Dates and passes other values through unchanged", () => {
    const raw = toRawRoleData({
      name: "Backend",
      createdAt: Timestamp.fromDate(CREATED_AT),
      expectations: [{ treeId: "api", expectedLevel: 2 }],
      malformed: 42,
    });
    expect(raw).toEqual({
      name: "Backend",
      createdAt: CREATED_AT,
      expectations: [{ treeId: "api", expectedLevel: 2 }],
      malformed: 42,
    });
  });
});

describe("Admin role store source constraints (AD-7, PG-5)", () => {
  it("performs no where or collection-group query", () => {
    expect(SOURCE).not.toMatch(/\.where\(/);
    expect(SOURCE).not.toMatch(/collection\s*Group/);
  });

  it("orders the list by createdAt ascending with a 51-document limit", () => {
    expect(SOURCE).toMatch(/orderBy\(CREATED_AT_FIELD, "asc"\)\.limit\(ROLE_RAW_READ_LIMIT\)/);
  });

  it("never names a uid in a document path", () => {
    expect(SOURCE).not.toMatch(/\.doc\(\s*(ownerUid|uid|createdBy)/);
  });
});
