import { afterEach, describe, expect, it, vi } from "vitest";
import { isForumEnabled } from "./is-forum-enabled";

describe("isForumEnabled", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is disabled when FEATURE_FORUM_ENABLED is missing", () => {
    vi.stubEnv("FEATURE_FORUM_ENABLED", undefined);

    expect(isForumEnabled()).toBe(false);
  });

  it('is disabled when FEATURE_FORUM_ENABLED is "false"', () => {
    vi.stubEnv("FEATURE_FORUM_ENABLED", "false");

    expect(isForumEnabled()).toBe(false);
  });

  it('is enabled only when FEATURE_FORUM_ENABLED is exactly "true"', () => {
    vi.stubEnv("FEATURE_FORUM_ENABLED", "true");

    expect(isForumEnabled()).toBe(true);
  });

  it.each(["TRUE", "True", " true", "true ", "1", "yes", "on", ""])(
    "is disabled for the malformed/other value %j",
    (value) => {
      vi.stubEnv("FEATURE_FORUM_ENABLED", value);

      expect(isForumEnabled()).toBe(false);
    },
  );

  it("prefers an injected value over the environment variable", () => {
    vi.stubEnv("FEATURE_FORUM_ENABLED", "true");

    expect(isForumEnabled({ value: "false" })).toBe(false);
    expect(isForumEnabled({ value: "true" })).toBe(true);
  });
});
