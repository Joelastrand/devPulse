import { describe, expect, it } from "vitest";
import { parseStoredRoleTarget } from "./role-target";

const UPDATED_AT = new Date("2026-10-02T09:00:00Z");

describe("parseStoredRoleTarget", () => {
  it("accepts exactly roleId and updatedAt", () => {
    expect(parseStoredRoleTarget({ roleId: "role-1", updatedAt: UPDATED_AT })).toEqual({
      ok: true,
      target: { roleId: "role-1", updatedAt: UPDATED_AT },
    });
  });

  it("rejects any stored key beyond roleId and updatedAt", () => {
    expect(parseStoredRoleTarget({ roleId: "role-1", updatedAt: UPDATED_AT, uid: "u1" })).toEqual({ ok: false });
  });

  it("rejects a missing or empty roleId", () => {
    expect(parseStoredRoleTarget({ updatedAt: UPDATED_AT })).toEqual({ ok: false });
    expect(parseStoredRoleTarget({ roleId: "", updatedAt: UPDATED_AT })).toEqual({ ok: false });
    expect(parseStoredRoleTarget({ roleId: 42, updatedAt: UPDATED_AT })).toEqual({ ok: false });
  });

  it("rejects a missing or invalid updatedAt", () => {
    expect(parseStoredRoleTarget({ roleId: "role-1" })).toEqual({ ok: false });
    expect(parseStoredRoleTarget({ roleId: "role-1", updatedAt: "2026-10-02" })).toEqual({ ok: false });
    expect(parseStoredRoleTarget({ roleId: "role-1", updatedAt: new Date("not a date") })).toEqual({ ok: false });
  });

  it("rejects non-object content", () => {
    expect(parseStoredRoleTarget(undefined)).toEqual({ ok: false });
    expect(parseStoredRoleTarget(null)).toEqual({ ok: false });
    expect(parseStoredRoleTarget(["role-1"])).toEqual({ ok: false });
    expect(parseStoredRoleTarget("role-1")).toEqual({ ok: false });
  });
});
