import { describe, expect, it } from "vitest";
import { readSetRoleTargetRequest } from "./role-target-request-body";

function bodyRequest(text: string): Request {
  return new Request("http://localhost/api/me/role-target", { method: "PUT", body: text });
}

describe("readSetRoleTargetRequest", () => {
  it("accepts exactly { roleId } with a string roleId", async () => {
    expect(await readSetRoleTargetRequest(bodyRequest('{"roleId":"role-1"}'))).toEqual({ ok: true, roleId: "role-1" });
  });

  it.each([
    ["an extra key", '{"roleId":"role-1","uid":"u1"}'],
    ["an e-mail key", '{"roleId":"role-1","email":"x@example.com"}'],
    ["no roleId", "{}"],
    ["a non-string roleId", '{"roleId":42}'],
    ["an array", '["role-1"]'],
    ["a scalar", '"role-1"'],
    ["malformed JSON", "{roleId:"],
  ])("refuses %s", async (_label, text) => {
    expect(await readSetRoleTargetRequest(bodyRequest(text))).toEqual({ ok: false });
  });

  it("refuses a body longer than the bound before parsing it", async () => {
    const padding = "x".repeat(2000);
    expect(await readSetRoleTargetRequest(bodyRequest(`{"roleId":"role-1","pad":"${padding}"}`))).toEqual({ ok: false });
  });
});
