import { describe, expect, it } from "vitest";
import {
  DEFAULT_SIGN_IN_DESTINATION,
  isValidSurveyContinuationPath,
  resolveSignInDestination,
} from "./continuation";

describe("isValidSurveyContinuationPath", () => {
  it.each([
    "/survey/abc123",
    "/survey/opaque-firestore-id",
    "/survey/AbC-123_xyz",
  ])("accepts %s", (path) => {
    expect(isValidSurveyContinuationPath(path)).toBe(true);
  });

  it.each([
    ["https://evil.example", "absolute external URL"],
    ["//evil.example", "protocol-relative URL"],
    ["http://evil.example/survey/x", "absolute URL with a survey-shaped path"],
    ["javascript:alert(1)", "javascript: scheme"],
    ["data:text/html,<script>alert(1)</script>", "data: scheme"],
    ["/admin/teams", "admin route"],
    ["/teams/team-a", "team route"],
    ["/sign-in", "sign-in route"],
    ["/sign-in/", "sign-in route with trailing slash"],
    ["/survey/", "empty survey id"],
    ["/survey/a/b", "extra path segment"],
    ["/survey/../admin", "path traversal"],
    ["/survey/abc?evil=1", "embedded query string"],
    ["/survey/abc#frag", "embedded fragment"],
    ["/survey/abc?continue=/evil", "nested continue= parameter"],
    ["%2Fsurvey%2Fabc", "single-encoded value (not yet decoded by this layer)"],
    ["%252Fsurvey%252Fabc", "double-encoded value"],
    ["/survey/abc%2Fdef", "encoded slash inside the id"],
    ["survey/abc123", "missing leading slash"],
    ["/Survey/abc123", "wrong case route segment"],
    ["", "empty string"],
  ])("rejects %s (%s)", (path) => {
    expect(isValidSurveyContinuationPath(path)).toBe(false);
  });
});

describe("resolveSignInDestination", () => {
  it("returns the default /teams destination when no continuation is supplied", () => {
    expect(resolveSignInDestination(undefined)).toEqual(DEFAULT_SIGN_IN_DESTINATION);
    expect(resolveSignInDestination(null)).toEqual(DEFAULT_SIGN_IN_DESTINATION);
  });

  it("returns the validated survey path for a valid continuation", () => {
    expect(resolveSignInDestination("/survey/abc123")).toEqual({
      path: "/survey/abc123",
      isSurveyContinuation: true,
    });
  });

  it("falls back to /teams for an external URL", () => {
    expect(resolveSignInDestination("https://evil.example")).toEqual(
      DEFAULT_SIGN_IN_DESTINATION,
    );
  });

  it("falls back to /teams for a malformed value", () => {
    expect(resolveSignInDestination("/survey/a/b")).toEqual(DEFAULT_SIGN_IN_DESTINATION);
  });

  it("takes only the first value of a repeated query parameter", () => {
    expect(resolveSignInDestination(["/survey/abc123", "/survey/other"])).toEqual({
      path: "/survey/abc123",
      isSurveyContinuation: true,
    });
  });

  it("falls back to /teams when the first repeated value is invalid", () => {
    expect(resolveSignInDestination(["https://evil.example", "/survey/abc123"])).toEqual(
      DEFAULT_SIGN_IN_DESTINATION,
    );
  });
});
