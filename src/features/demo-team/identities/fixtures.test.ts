import { describe, expect, it } from "vitest";
import { normalizeDisplayName } from "../../profiles/domain/display-name";
import {
  DEMO_MEMBER_IDENTITIES,
  buildIdentityAuthRequest,
  buildIdentityMembership,
  buildIdentityProfile,
  validateDemoMemberIdentities,
  type DemoMemberIdentity,
} from "./fixtures";

const PRESENTER = "koEwzQcj5Uc0hnjTgZBLithgkYB3";
const AS_OF = new Date("2026-11-14T00:00:00.000Z");

describe("fictional member fixtures", () => {
  it("defines exactly 10 unique, valid identities", () => {
    expect(DEMO_MEMBER_IDENTITIES).toHaveLength(10);
    expect(new Set(DEMO_MEMBER_IDENTITIES.map((i) => i.uid)).size).toBe(10);
    expect(validateDemoMemberIdentities(DEMO_MEMBER_IDENTITIES, PRESENTER)).toEqual([]);
  });

  it("uses stable, deterministic uids", () => {
    expect(DEMO_MEMBER_IDENTITIES.map((i) => i.uid)).toEqual(
      Array.from({ length: 10 }, (_, n) => `demo-member-${String(n + 1).padStart(2, "0")}`),
    );
  });

  it("gives every member a unique reserved example.com address", () => {
    const emails = DEMO_MEMBER_IDENTITIES.map((i) => i.email);
    expect(new Set(emails).size).toBe(10);
    for (const email of emails) expect(email).toMatch(/^[a-z]+\.[a-z]+@example\.com$/);
  });

  it("gives every member a display name that passes the profile's own name rules", () => {
    for (const identity of DEMO_MEMBER_IDENTITIES) {
      const name = normalizeDisplayName(identity.fullName);
      expect(name.ok && name.displayName === identity.fullName).toBe(true);
    }
  });

  it("only ever plans ordinary members, never a team administrator", () => {
    expect(DEMO_MEMBER_IDENTITIES.every((i) => i.teamRole === "member")).toBe(true);
  });

  it("builds the Auth request as disabled and unverified, with no password or claims", () => {
    for (const identity of DEMO_MEMBER_IDENTITIES) {
      const request = buildIdentityAuthRequest(identity);
      expect(Object.keys(request).sort()).toEqual(["disabled", "email", "emailVerified", "uid"]);
      expect(request).toEqual({ uid: identity.uid, email: identity.email, emailVerified: false, disabled: true });
    }
  });

  it("builds membership and profile fixtures, with the uid kept out of the profile", () => {
    const identity = DEMO_MEMBER_IDENTITIES[0];
    expect(buildIdentityMembership(identity, "team-x", AS_OF)).toEqual({
      uid: identity.uid,
      teamId: "team-x",
      createdAt: AS_OF,
      createdVia: "admin_direct",
      grantedBy: "demo-seed",
    });
    expect(buildIdentityProfile(identity, AS_OF).displayName).toBe(identity.fullName);
  });

  it("rejects a fixture that collides with the presenter, uses a real domain, or repeats a uid or address", () => {
    const base = DEMO_MEMBER_IDENTITIES;
    const categoriesOf = (list: DemoMemberIdentity[]) => validateDemoMemberIdentities(list, PRESENTER).map((p) => p.category);

    expect(categoriesOf([{ ...base[0], uid: PRESENTER }, ...base.slice(1)])).toContain("uid-duplicate");
    expect(categoriesOf([{ ...base[0], email: "ingrid.solberg@nve.no" }, ...base.slice(1)])).toContain("email-domain");
    expect(categoriesOf([{ ...base[0], email: base[1].email }, ...base.slice(1)])).toContain("email-duplicate");
    expect(categoriesOf([{ ...base[0], uid: base[1].uid }, ...base.slice(1)])).toContain("uid-duplicate");
    expect(categoriesOf(base.slice(0, 9))).toContain("count");
  });
});
