import { describe, expect, it, vi } from "vitest";
import { NVE_EMAIL_DOMAIN } from "../../auth/domain/nve-email";
import {
  buildOrganizationRecord,
  isCanonicalOrganization,
  ORGANIZATION_EMAIL_DOMAIN,
  ORGANIZATION_ID,
  ORGANIZATION_NAME,
  ORGANIZATION_PATH,
} from "../domain/organization";
import { initializeOrganization, type OrganizationStorePort } from "./initialize-organization";

const NOW = new Date("2026-11-13T08:00:00Z");

/** An in-memory store. `createIfAbsent` respects an existing document, as the Firestore transaction does. */
function fakeStore(initial?: unknown) {
  let doc: unknown = initial;
  const store: OrganizationStorePort = {
    read: vi.fn(async () => doc),
    createIfAbsent: vi.fn(async (record) => {
      if (doc !== undefined) return false;
      doc = record;
      return true;
    }),
  };
  return { store, current: () => doc };
}

describe("organization record", () => {
  it("uses the stable id nve, the approved name, and the NVE domain at the fixed path", () => {
    expect(ORGANIZATION_ID).toBe("nve");
    expect(ORGANIZATION_NAME).toBe("Norges vassdrags- og energidirektorat");
    expect(ORGANIZATION_PATH).toBe("organizations/nve");
  });

  it("keeps its domain equal to the access policy's domain, without a runtime dependency between the features", () => {
    expect(ORGANIZATION_EMAIL_DOMAIN).toBe(NVE_EMAIL_DOMAIN);
  });

  it("accepts only the canonical identity fields, ignoring timestamps", () => {
    expect(isCanonicalOrganization(buildOrganizationRecord(NOW))).toBe(true);
    expect(isCanonicalOrganization({ ...buildOrganizationRecord(NOW), name: "Another org" })).toBe(false);
    expect(isCanonicalOrganization({ ...buildOrganizationRecord(NOW), emailDomain: "nve.no.attacker.com" })).toBe(false);
    expect(isCanonicalOrganization(null)).toBe(false);
  });
});

describe("initializeOrganization", () => {
  it("reports a dry run without writing when no record exists", async () => {
    const { store, current } = fakeStore();

    const outcome = await initializeOrganization(store, { apply: false, now: NOW });

    expect(outcome).toBe("would_create");
    expect(store.createIfAbsent).not.toHaveBeenCalled();
    expect(current()).toBeUndefined();
  });

  it("creates the record once when none exists", async () => {
    const { store, current } = fakeStore();

    const outcome = await initializeOrganization(store, { apply: true, now: NOW });

    expect(outcome).toBe("created");
    expect(current()).toEqual(buildOrganizationRecord(NOW));
  });

  it("is idempotent: a second run on the canonical record writes nothing", async () => {
    const { store } = fakeStore(buildOrganizationRecord(NOW));

    const outcome = await initializeOrganization(store, { apply: true, now: new Date("2026-12-01T00:00:00Z") });

    expect(outcome).toBe("already_initialized");
    expect(store.createIfAbsent).not.toHaveBeenCalled();
  });

  it("never overwrites a different record at the path; it reports a conflict", async () => {
    const other = { ...buildOrganizationRecord(NOW), name: "Other" };
    const { store, current } = fakeStore(other);

    const outcome = await initializeOrganization(store, { apply: true, now: NOW });

    expect(outcome).toBe("conflict");
    expect(store.createIfAbsent).not.toHaveBeenCalled();
    expect(current()).toBe(other);
  });

  it("reports a race when another writer creates a different record between read and create", async () => {
    const other = { ...buildOrganizationRecord(NOW), name: "Other" };
    let calls = 0;
    const store: OrganizationStorePort = {
      read: vi.fn(async () => (calls++ === 0 ? undefined : other)),
      createIfAbsent: vi.fn(async () => false),
    };

    const outcome = await initializeOrganization(store, { apply: true, now: NOW });

    expect(outcome).toBe("raced");
  });

  it("writes only the organization path: it reads and creates that one document and nothing else", async () => {
    const { store } = fakeStore();
    await initializeOrganization(store, { apply: true, now: NOW });

    // The store port has no other write surface, so the only effect is the single create of the organization record.
    expect(store.createIfAbsent).toHaveBeenCalledTimes(1);
    expect(store.createIfAbsent).toHaveBeenCalledWith(buildOrganizationRecord(NOW));
  });
});
