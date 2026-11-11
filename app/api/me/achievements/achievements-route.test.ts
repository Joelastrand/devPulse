import { describe, expect, it } from "vitest";
import { GET, POST } from "./route";
import { DELETE, PATCH } from "./[recordId]/route";

/**
 * Route-level negative paths for the achievement routes (SECURITY-REVIEW §11.6). No valid token is supplied, so these checks
 * never reach the store. Owner identity comes only from a verified token; a uid in the body is never read as an owner.
 */

const context = (recordId: string) => ({ params: Promise.resolve({ recordId }) });

describe("achievement routes: negative paths (PR-SI-1)", () => {
  it("refuses an unauthenticated list with 401 and no record content", async () => {
    const response = await GET(new Request("http://localhost/api/me/achievements"));
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain("records");
  });

  it("refuses an unauthenticated create with 401 before reading the body", async () => {
    const response = await POST(
      new Request("http://localhost/api/me/achievements", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Syntetisk", uid: "someone-else" }),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("refuses an unauthenticated update and delete with 401", async () => {
    const patch = await PATCH(new Request("http://localhost/api/me/achievements/a-1", { method: "PATCH", body: "{}" }), context("a-1"));
    const remove = await DELETE(new Request("http://localhost/api/me/achievements/a-1", { method: "DELETE" }), context("a-1"));
    expect(patch.status).toBe(401);
    expect(remove.status).toBe(401);
  });

  it("does not treat an owner field in the body as identity, even with an invalid bearer token", async () => {
    const response = await POST(
      new Request("http://localhost/api/me/achievements", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer not-a-real-token" },
        body: JSON.stringify({ title: "Syntetisk", ownerUid: "someone-else" }),
      }),
    );
    expect([401, 503]).toContain(response.status);
  });
});
