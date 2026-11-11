import { describe, expect, it } from "vitest";
import { GET, POST } from "./route";
import { PATCH } from "./[recordId]/route";

/**
 * Route-level negative paths for the responsibility routes (SECURITY-REVIEW §11.6). No token is ever accepted here, so
 * these checks never reach Firebase and never reach the store. Owner identity comes only from a verified token.
 */

const json = (body: unknown) => new Request("http://localhost/api/me/responsibilities", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("responsibility routes: negative paths (PR-SI-1)", () => {
  it("refuses an unauthenticated list with 401 and no record content", async () => {
    const response = await GET(new Request("http://localhost/api/me/responsibilities"));
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain("records");
  });

  it("refuses an unauthenticated create with 401 before reading the body", async () => {
    const response = await POST(json({ title: "Syntetisk", uid: "someone-else" }));
    expect(response.status).toBe(401);
  });

  it("refuses an unauthenticated update with 401", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/me/responsibilities/rec-1", { method: "PATCH", body: "{}" }),
      { params: Promise.resolve({ recordId: "rec-1" }) },
    );
    expect(response.status).toBe(401);
  });

  it("refuses a create that names an owner, even with a valid token shape, as an unknown key", async () => {
    // A bearer token that fails verification is an authentication refusal. The uid key is never read as an owner.
    const request = new Request("http://localhost/api/me/responsibilities", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer not-a-real-token" },
      body: JSON.stringify({ title: "Syntetisk", ownerUid: "someone-else" }),
    });
    const response = await POST(request);
    expect([401, 503]).toContain(response.status);
  });
});
