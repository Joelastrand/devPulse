import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { authRefusalFor, authRefusalStatus, isAuthRefusal } from "./auth-refusal";

const verifyIdTokenMock = vi.hoisted(() => vi.fn());
const listActiveRolesMock = vi.hoisted(() => vi.fn());

vi.mock("./verify-identity", () => ({ verifyIdToken: verifyIdTokenMock }));
vi.mock("../../role-profiles/server/list-active-roles", () => ({ listActiveRolesForPerson: listActiveRolesMock }));

const { GET: getRoles } = await import("../../../../app/api/roles/route");

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

describe("auth refusal mapping (TASK-009 D-AUTHFAIL)", () => {
  it("keeps a genuine rejection on the existing unauthenticated code and 401", () => {
    expect(authRefusalFor({ error: "invalid_token" })).toBe("unauthenticated");
    expect(authRefusalStatus("unauthenticated")).toBe(401);
  });

  it("keeps erasure_in_progress as its own code and 403, never 401", () => {
    expect(authRefusalFor({ error: "erasure_in_progress" })).toBe("erasure_in_progress");
    expect(authRefusalStatus("erasure_in_progress")).toBe(403);
  });

  it("keeps auth_unavailable as its own code and 503, never 401", () => {
    expect(authRefusalFor({ error: "auth_unavailable" })).toBe("auth_unavailable");
    expect(authRefusalStatus("auth_unavailable")).toBe(503);
  });

  it("recognises only the three refusal codes", () => {
    expect(isAuthRefusal("auth_unavailable")).toBe(true);
    expect(isAuthRefusal("forbidden")).toBe(false);
  });
});

describe("protected route refusal responses (no data access after refusal)", () => {
  beforeEach(() => {
    verifyIdTokenMock.mockReset();
    listActiveRolesMock.mockReset();
  });

  const request = () => new Request("https://example.test/api/roles", { headers: { authorization: "Bearer t" } });

  it("answers an in-progress erasure with 403 and reads no role catalog", async () => {
    verifyIdTokenMock.mockResolvedValue({ ok: false, error: "erasure_in_progress" });
    const response = await getRoles(request());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "erasure_in_progress" });
    expect(listActiveRolesMock).not.toHaveBeenCalled();
  });

  it("answers an unavailable fence with 503 and reads no role catalog", async () => {
    verifyIdTokenMock.mockResolvedValue({ ok: false, error: "auth_unavailable" });
    const response = await getRoles(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "auth_unavailable" });
    expect(listActiveRolesMock).not.toHaveBeenCalled();
  });

  it("keeps a genuine rejection on 401 with the unchanged body", async () => {
    verifyIdTokenMock.mockResolvedValue({ ok: false, error: "invalid_token" });
    const response = await getRoles(request());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthenticated" });
    expect(listActiveRolesMock).not.toHaveBeenCalled();
  });
});

/** Non-test production source under `src/` and `app/`, as repository-relative paths. */
function productionSources(): Array<{ path: string; text: string }> {
  const out: Array<{ path: string; text: string }> = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) {
        out.push({ path: relative(ROOT, full).split("\\").join("/"), text: readFileSync(full, "utf8") });
      }
    }
  };
  walk(join(ROOT, "src"));
  walk(join(ROOT, "app"));
  return out;
}

describe("static guards: protected callers cannot collapse the fence outcomes into 401", () => {
  const sources = productionSources();

  it("no route maps a refusal to 401 inline (the status must come from authRefusalStatus)", () => {
    // Status tables are checked by the next test; this one catches a literal 401 written inline beside a refusal.
    const inline = /error === "unauthenticated"\s*\?\s*401|if \(error === "unauthenticated"\) return 401|status:\s*401/;
    // The conversation error table maps only a genuine rejection; its routes pass fence refusals through authRefusalStatus.
    const exempt = new Set(["src/features/development-conversations/domain/errors.ts"]);
    const offenders = sources
      .filter((s) => s.path.startsWith("app/api/") && !s.path.startsWith("app/api/surveys/") && inline.test(s.text))
      .filter((s) => !exempt.has(s.path))
      .map((s) => s.path);
    expect(offenders).toEqual([]);
  });

  it("every status table that maps a refusal also maps both fence codes", () => {
    const table = /Record<string, number> = \{([\s\S]*?)\};/g;
    const offenders: string[] = [];
    for (const s of sources.filter((x) => x.path.startsWith("app/api/") || x.path.startsWith("src/features/"))) {
      for (const match of s.text.matchAll(table)) {
        const body = match[1];
        const mapsRefusal = /\b(sign_in_required|unauthenticated)\s*:/.test(body);
        if (mapsRefusal && !(/\berasure_in_progress\s*:/.test(body) && /\bauth_unavailable\s*:/.test(body))) {
          offenders.push(s.path);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no verifier failure is turned into a literal refusal outside the reviewed public paths", () => {
    // `resolve-survey-for-participation` answers a public lookup with `sign_in_required` and returns no protected data.
    const allowed = new Set(["src/features/surveys/server/resolve-survey-for-participation.ts"]);
    // A refusal produced through `authRefusalFor` is the shared mapping, so only literal refusals are reported.
    const pattern = /!verified\.ok\)\s*(\{\s*)?return(?![^;]*authRefusalFor)[^;]*"(unauthenticated|sign_in_required)"/;
    const offenders = sources.filter((s) => pattern.test(s.text) && !allowed.has(s.path)).map((s) => s.path);
    expect(offenders).toEqual([]);
  });

  it("the survey submission route maps both fence outcomes to their own statuses", () => {
    const route = sources.find((s) => s.path === "app/api/surveys/[surveyId]/responses/route.ts");
    expect(route?.text).toContain("erasure_in_progress: 403");
    expect(route?.text).toContain("auth_unavailable: 503");
  });

  it("the erasure resume capability is minted only by the erasure start/resume operation (exact allow-list, TASK-038)", () => {
    // The verifier accepts an opaque capability; only the start/resume operation mints one. Ordinary routes and other
    // features must not mint it, import the issuer, or name the bypass option.
    const issuerCallers = new Set(["src/features/account-erasure/server/start-erasure.ts"]);
    const issuerDefinition = "src/features/auth/server/erasure-resume-capability.ts";
    const authTestsOfTheBoundary = new Set([
      "src/features/auth/server/erasure-fence.test.ts",
      "src/features/auth/server/verify-identity-fence.test.ts",
    ]);
    const mintsOrImports = sources.filter((s) => s.text.includes("issueErasureResumeCapability"));
    const offenders = mintsOrImports
      .map((s) => s.path)
      .filter((path) => path !== issuerDefinition && !issuerCallers.has(path) && !authTestsOfTheBoundary.has(path));
    expect(offenders).toEqual([]);

    const approved = sources.find((s) => s.path === "src/features/account-erasure/server/start-erasure.ts");
    expect(approved?.text.match(/allowDuringErasure:\s*\w+\(\)/g)).toEqual(["allowDuringErasure: issueErasureResumeCapability()"]);
    expect(sources.some((s) => s.path.startsWith("app/") && s.text.includes("issueErasureResumeCapability"))).toBe(false);
    expect(sources.some((s) => s.path.startsWith("app/api/") && s.text.includes("allowDuringErasure"))).toBe(false);
  });

  it("the auth boundary does not import the account-erasure feature", () => {
    const offenders = sources
      .filter((s) => s.path.startsWith("src/features/auth/") && /from\s+["'][^"']*account-erasure/.test(s.text))
      .map((s) => s.path);
    expect(offenders).toEqual([]);
  });

  it("production code never imports the Vitest fence default (test-only coupling is detectable)", () => {
    const offenders = sources.filter((s) => s.text.includes("erasure-fence-default")).map((s) => s.path);
    expect(offenders).toEqual([]);
  });
});
