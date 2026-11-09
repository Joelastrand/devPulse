import { describe, expect, it } from "vitest";
import {
  BOOTSTRAP_CONTROL_COLLECTION,
  BOOTSTRAP_CONTROL_DOC_ID,
  BOOTSTRAP_SUPERADMIN_COLLECTION,
  bootstrapSuperadmin,
  buildInitialSuperadminRecord,
  type AuthUser,
  type BootstrapPorts,
} from "./bootstrap-superadmin";

const OWNER_EMAIL = "owner@example.test";
const NOW = new Date("2026-11-06T10:00:00.000Z");

/** Synthetic in-memory registry with the production document shapes; writes apply only after the work resolves. */
function fakePorts(options: {
  users?: Record<string, AuthUser>;
  active?: string[];
  control?: unknown;
}) {
  const users = new Map(Object.entries(options.users ?? {}));
  const registry = {
    active: new Set(options.active ?? []),
    control: options.control as number | undefined | "absent",
    writes: 0,
  };
  const ports: BootstrapPorts = {
    async lookupUserByEmail(email) {
      return users.get(email);
    },
    async runTransaction(work) {
      return work({
        async readActiveUids() {
          return [...registry.active];
        },
        async readActiveCount() {
          if (registry.control === "absent") return 0;
          return registry.control;
        },
        writeInitialSuperadmin(uid) {
          registry.writes += 1;
          registry.active.add(uid);
          registry.control = 1;
        },
      });
    },
  };
  return { ports, registry };
}

const OWNER: AuthUser = { uid: "owner-uid", emailVerified: true, disabled: false };

describe("bootstrap registry constants", () => {
  it("match the production registry collections", () => {
    expect(BOOTSTRAP_SUPERADMIN_COLLECTION).toBe("superadmins");
    expect(BOOTSTRAP_CONTROL_COLLECTION).toBe("superadminRegistry");
    expect(BOOTSTRAP_CONTROL_DOC_ID).toBe("control");
  });
});

describe("bootstrapSuperadmin", () => {
  it("dry run reports the resolved UID and writes nothing", async () => {
    const { ports, registry } = fakePorts({ users: { [OWNER_EMAIL]: OWNER }, control: "absent" });

    const report = await bootstrapSuperadmin(ports, { email: OWNER_EMAIL, apply: false, now: NOW });

    expect(report).toEqual({ ok: true, status: "would_grant", uid: "owner-uid" });
    expect(registry.writes).toBe(0);
  });

  it("apply grants exactly one initial superadmin, resolved by the Auth UID", async () => {
    const { ports, registry } = fakePorts({ users: { [OWNER_EMAIL]: OWNER }, control: "absent" });

    const report = await bootstrapSuperadmin(ports, { email: "  Owner@Example.test ", apply: true, now: NOW });

    expect(report).toEqual({ ok: true, status: "granted", uid: "owner-uid" });
    expect([...registry.active]).toEqual(["owner-uid"]);
    expect(registry.control).toBe(1);
    expect(registry.writes).toBe(1);
  });

  it("is idempotent: re-running when the owner is already the only active superadmin writes nothing", async () => {
    const { ports, registry } = fakePorts({ users: { [OWNER_EMAIL]: OWNER }, active: ["owner-uid"], control: 1 });

    const report = await bootstrapSuperadmin(ports, { email: OWNER_EMAIL, apply: true, now: NOW });

    expect(report).toEqual({ ok: true, status: "already_superadmin", uid: "owner-uid" });
    expect(registry.writes).toBe(0);
  });

  it("refuses to create a second initial superadmin when another active superadmin exists", async () => {
    const { ports, registry } = fakePorts({
      users: { [OWNER_EMAIL]: OWNER },
      active: ["someone-uid"],
      control: 1,
    });

    const report = await bootstrapSuperadmin(ports, { email: OWNER_EMAIL, apply: true, now: NOW });

    expect(report).toEqual({ ok: false, refusal: "initial_superadmin_exists" });
    expect(registry.writes).toBe(0);
  });

  it("refuses an unknown e-mail: no account is created and nothing is written", async () => {
    const { ports, registry } = fakePorts({ users: {}, control: "absent" });

    const report = await bootstrapSuperadmin(ports, { email: OWNER_EMAIL, apply: true, now: NOW });

    expect(report).toEqual({ ok: false, refusal: "target_not_found" });
    expect(registry.writes).toBe(0);
  });

  it("refuses an unverified account", async () => {
    const { ports, registry } = fakePorts({
      users: { [OWNER_EMAIL]: { uid: "owner-uid", emailVerified: false, disabled: false } },
      control: "absent",
    });

    expect(await bootstrapSuperadmin(ports, { email: OWNER_EMAIL, apply: true, now: NOW })).toEqual({
      ok: false,
      refusal: "target_unverified",
    });
    expect(registry.writes).toBe(0);
  });

  it("refuses a disabled account", async () => {
    const { ports, registry } = fakePorts({
      users: { [OWNER_EMAIL]: { uid: "owner-uid", emailVerified: true, disabled: true } },
      control: "absent",
    });

    expect(await bootstrapSuperadmin(ports, { email: OWNER_EMAIL, apply: true, now: NOW })).toEqual({
      ok: false,
      refusal: "target_disabled",
    });
    expect(registry.writes).toBe(0);
  });

  it("refuses a malformed e-mail before any Auth lookup", async () => {
    const { ports, registry } = fakePorts({ users: { [OWNER_EMAIL]: OWNER }, control: "absent" });

    expect(await bootstrapSuperadmin(ports, { email: "not-an-address", apply: true, now: NOW })).toEqual({
      ok: false,
      refusal: "invalid_email",
    });
    expect(registry.writes).toBe(0);
  });

  it("refuses an inconsistent registry (count says active, no active record) rather than repairing it", async () => {
    const { ports, registry } = fakePorts({ users: { [OWNER_EMAIL]: OWNER }, active: [], control: 1 });

    expect(await bootstrapSuperadmin(ports, { email: OWNER_EMAIL, apply: true, now: NOW })).toEqual({
      ok: false,
      refusal: "registry_inconsistent",
    });
    expect(registry.writes).toBe(0);
  });

  it("refuses an unreadable (malformed) count", async () => {
    const { ports, registry } = fakePorts({ users: { [OWNER_EMAIL]: OWNER }, control: undefined });

    expect(await bootstrapSuperadmin(ports, { email: OWNER_EMAIL, apply: true, now: NOW })).toEqual({
      ok: false,
      refusal: "registry_inconsistent",
    });
    expect(registry.writes).toBe(0);
  });
});

describe("initial superadmin record", () => {
  it("writes grantedByUid as null, never a non-UID marker string", () => {
    const record = buildInitialSuperadminRecord("owner-uid", NOW);

    expect(record.grantedByUid).toBeNull();
    expect(record.revokedByUid).toBeNull();
    expect(record).toMatchObject({ uid: "owner-uid", active: true });
  });
});
