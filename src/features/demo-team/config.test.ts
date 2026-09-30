import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolveDemoSeedConfig,
  type DemoSeedConfigErrorCategory,
  type DemoSeedConfigResult,
} from "./config";

// All ids, emails and keys below are obviously fake; nothing refers to a real project.
const PROJECT = "demo-fake-project";
const PRESENTER = "presenter-uid-fixture";
const PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\nFAKE-KEY-MATERIAL\n-----END PRIVATE KEY-----\n";
const NOW = new Date("2031-03-09T15:45:10.000Z");
const now = () => NOW;

const validEnv = {
  FIREBASE_PROJECT_ID: PROJECT,
  FIREBASE_CLIENT_EMAIL: `seed-sa@${PROJECT}.iam.gserviceaccount.com`,
  FIREBASE_PRIVATE_KEY: PRIVATE_KEY,
};

const baseArgv = ["--project", PROJECT, "--presenter-uid", PRESENTER];

function resolve(
  argv: string[],
  env: Record<string, string | undefined> = validEnv,
): DemoSeedConfigResult {
  return resolveDemoSeedConfig({ argv, env, now });
}

function expectError(result: DemoSeedConfigResult, category: DemoSeedConfigErrorCategory): void {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.category).toBe(category);
}

function expectConfig(result: DemoSeedConfigResult) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("expected a valid configuration");
  return result.config;
}

describe("resolveDemoSeedConfig — modes", () => {
  it("defaults to an online dry-run that performs no writes", () => {
    const config = expectConfig(resolve(baseArgv));

    expect(config.mode).toBe("online-dry-run");
    expect(config.network).toBe(true);
    expect(config.writesAllowed).toBe(false);
    expect(config.projectId).toBe(PROJECT);
    expect(config.presenterUid).toBe(PRESENTER);
  });

  it("models --offline as a typed no-network capability with no credentials", () => {
    const config = expectConfig(resolve([...baseArgv, "--offline"]));

    expect(config.mode).toBe("offline-dry-run");
    expect(config.network).toBe(false);
    expect(config.writesAllowed).toBe(false);
    expect(config.credentials).toBeNull();
  });

  it("enters write mode only with --write and a matching --confirm", () => {
    const config = expectConfig(resolve([...baseArgv, "--write", "--confirm", PROJECT]));

    expect(config.mode).toBe("write");
    expect(config.network).toBe(true);
    expect(config.writesAllowed).toBe(true);
  });

  it("accepts --flag=value syntax", () => {
    const config = expectConfig(
      resolve([`--project=${PROJECT}`, `--presenter-uid=${PRESENTER}`, "--as-of=2031-01-31"]),
    );

    expect(config.projectId).toBe(PROJECT);
    expect(config.asOf.toISOString()).toBe("2031-01-31T00:00:00.000Z");
  });

  it("carries the service-account credentials only for online modes", () => {
    const online = expectConfig(resolve(baseArgv));

    expect(online.credentials).toEqual({
      clientEmail: validEnv.FIREBASE_CLIENT_EMAIL,
      privateKey: PRIVATE_KEY,
    });
  });
});

describe("resolveDemoSeedConfig — argument failures", () => {
  it.each<[string, string[], DemoSeedConfigErrorCategory]>([
    ["missing --project", ["--presenter-uid", PRESENTER], "missing-flag"],
    ["missing --presenter-uid", ["--project", PROJECT], "missing-flag"],
    ["no arguments at all", [], "missing-flag"],
    ["unknown flag", [...baseArgv, "--force"], "unknown-flag"],
    ["unknown flag with value syntax", [...baseArgv, "--email=a@b.c"], "unknown-flag"],
    ["positional argument", [...baseArgv, "stray"], "unknown-flag"],
    ["bare -- separator", ["--", ...baseArgv], "unknown-flag"],
    ["duplicate --project", [...baseArgv, "--project", PROJECT], "duplicate-flag"],
    ["duplicate via mixed syntax", [...baseArgv, `--presenter-uid=${PRESENTER}`], "duplicate-flag"],
    ["duplicate --offline", [...baseArgv, "--offline", "--offline"], "duplicate-flag"],
    ["--project without value", ["--presenter-uid", PRESENTER, "--project"], "missing-value"],
    ["--project followed by another flag", ["--project", "--offline", "--presenter-uid", PRESENTER], "missing-value"],
    ["empty --project value", ["--project=", "--presenter-uid", PRESENTER], "missing-value"],
    ["value given to a boolean flag", [...baseArgv, "--offline=true"], "unexpected-value"],
    ["--write with --offline", [...baseArgv, "--offline", "--write", "--confirm", PROJECT], "conflicting-flags"],
    ["--confirm without --write", [...baseArgv, "--confirm", PROJECT], "conflicting-flags"],
    ["--write without --confirm", [...baseArgv, "--write"], "confirm-required"],
    ["--confirm different from --project", [...baseArgv, "--write", "--confirm", "other-fake-project"], "confirm-mismatch"],
    ["--confirm differing only by case", [...baseArgv, "--write", "--confirm", PROJECT.toUpperCase()], "confirm-mismatch"],
    ["invalid project id shape", ["--project", "Not A Project", "--presenter-uid", PRESENTER], "invalid-project-id"],
    ["project id with a path separator", ["--project", "a/b-project", "--presenter-uid", PRESENTER], "invalid-project-id"],
    ["presenter uid with a path separator", ["--project", PROJECT, "--presenter-uid", "a/b"], "invalid-presenter-uid"],
    ["presenter uid with whitespace", ["--project", PROJECT, "--presenter-uid", "a b"], "invalid-presenter-uid"],
    ["presenter uid that is a dot segment", ["--project", PROJECT, "--presenter-uid", ".."], "invalid-presenter-uid"],
    ["as-of in the wrong format", [...baseArgv, "--as-of", "2031/03/09"], "invalid-as-of"],
    ["as-of with a time part", [...baseArgv, "--as-of", "2031-03-09T00:00:00Z"], "invalid-as-of"],
    ["as-of that is not a real date", [...baseArgv, "--as-of", "2031-02-30"], "invalid-as-of"],
    ["as-of month out of range", [...baseArgv, "--as-of", "2031-13-01"], "invalid-as-of"],
  ])("rejects %s", (_label, argv, category) => {
    expectError(resolve(argv), category);
  });

  it("does not reach environment validation when arguments are invalid", () => {
    // An unset environment would otherwise yield env-incomplete.
    expectError(resolve([...baseArgv, "--force"], {}), "unknown-flag");
  });
});

describe("resolveDemoSeedConfig — as-of date", () => {
  it("defaults to midnight UTC of the injected clock's day", () => {
    const config = expectConfig(resolve(baseArgv));

    expect(config.asOf.toISOString()).toBe("2031-03-09T00:00:00.000Z");
  });

  it("uses the UTC day, not the local day, near a day boundary", () => {
    const late = resolveDemoSeedConfig({
      argv: baseArgv,
      env: validEnv,
      now: () => new Date("2031-12-31T23:59:59.999Z"),
    });

    expect(expectConfig(late).asOf.toISOString()).toBe("2031-12-31T00:00:00.000Z");
  });

  it("accepts an explicit past, leap-day or future date", () => {
    for (const asOf of ["2020-01-01", "2032-02-29", "2099-12-31"]) {
      const config = expectConfig(resolve([...baseArgv, "--as-of", asOf]));
      expect(config.asOf.toISOString()).toBe(`${asOf}T00:00:00.000Z`);
    }
  });

  it("rejects 29 February in a non-leap year", () => {
    expectError(resolve([...baseArgv, "--as-of", "2031-02-29"]), "invalid-as-of");
  });
});

describe("resolveDemoSeedConfig — environment and target proof", () => {
  it.each(["FIREBASE_PROJECT_ID", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY"])(
    "fails closed when %s is missing",
    (name) => {
      const env: Record<string, string | undefined> = { ...validEnv };
      delete env[name];
      expectError(resolve(baseArgv, env), "env-incomplete");
    },
  );

  it.each(["FIREBASE_PROJECT_ID", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY"])(
    "treats an empty or blank %s as missing",
    (name) => {
      expectError(resolve(baseArgv, { ...validEnv, [name]: "" }), "env-incomplete");
      expectError(resolve(baseArgv, { ...validEnv, [name]: "   " }), "env-incomplete");
    },
  );

  it("fails closed for an empty environment — no ambient-credential fallback", () => {
    expectError(resolve(baseArgv, {}), "env-incomplete");
  });

  it("rejects --project that differs from FIREBASE_PROJECT_ID", () => {
    expectError(
      resolve(baseArgv, { ...validEnv, FIREBASE_PROJECT_ID: "other-fake-project" }),
      "project-mismatch",
    );
  });

  it("rejects a service-account email whose domain names a different project", () => {
    expectError(
      resolve(baseArgv, {
        ...validEnv,
        FIREBASE_CLIENT_EMAIL: "seed-sa@other-fake-project.iam.gserviceaccount.com",
      }),
      "service-account-mismatch",
    );
  });

  it.each([
    ["a non-service-account domain", "seed-sa@example.invalid"],
    ["a suffix-spoofed domain", `seed-sa@evil.${PROJECT}.iam.gserviceaccount.com`],
    ["no local part", `@${PROJECT}.iam.gserviceaccount.com`],
    ["an embedded second @", `a@b@${PROJECT}.iam.gserviceaccount.com`],
    ["a trailing suffix", `seed-sa@${PROJECT}.iam.gserviceaccount.com.evil.invalid`],
  ])("rejects a service-account email with %s", (_label, email) => {
    expectError(resolve(baseArgv, { ...validEnv, FIREBASE_CLIENT_EMAIL: email }), "service-account-mismatch");
  });

  it("accepts a matching NEXT_PUBLIC_FIREBASE_PROJECT_ID", () => {
    const config = expectConfig(
      resolve(baseArgv, { ...validEnv, NEXT_PUBLIC_FIREBASE_PROJECT_ID: PROJECT }),
    );

    expect(config.projectId).toBe(PROJECT);
  });

  it("rejects a NEXT_PUBLIC_FIREBASE_PROJECT_ID that differs when it is set", () => {
    expectError(
      resolve(baseArgv, { ...validEnv, NEXT_PUBLIC_FIREBASE_PROJECT_ID: "other-fake-project" }),
      "public-project-mismatch",
    );
  });

  it("treats an empty NEXT_PUBLIC_FIREBASE_PROJECT_ID as unset", () => {
    expectConfig(resolve(baseArgv, { ...validEnv, NEXT_PUBLIC_FIREBASE_PROJECT_ID: "" }));
  });

  it("runs the full target proof in offline mode too, before any network", () => {
    expectError(
      resolve([...baseArgv, "--offline"], { ...validEnv, FIREBASE_PROJECT_ID: "other-fake-project" }),
      "project-mismatch",
    );
    expectError(resolve([...baseArgv, "--offline"], {}), "env-incomplete");
  });

  it("does not read ambient variables: only the injected env matters", () => {
    const before = process.env.FIREBASE_PROJECT_ID;
    process.env.FIREBASE_PROJECT_ID = PROJECT;
    try {
      expectError(resolve(baseArgv, {}), "env-incomplete");
    } finally {
      if (before === undefined) delete process.env.FIREBASE_PROJECT_ID;
      else process.env.FIREBASE_PROJECT_ID = before;
    }
  });
});

describe("resolveDemoSeedConfig — no secret echo", () => {
  const secretValues = [PRIVATE_KEY, "FAKE-KEY-MATERIAL", validEnv.FIREBASE_CLIENT_EMAIL];

  const failingCases: Array<[string, string[], Record<string, string | undefined>]> = [
    ["env incomplete", baseArgv, { FIREBASE_PRIVATE_KEY: PRIVATE_KEY }],
    ["project mismatch", baseArgv, { ...validEnv, FIREBASE_PROJECT_ID: "other-fake-project" }],
    [
      "service-account mismatch",
      baseArgv,
      { ...validEnv, FIREBASE_CLIENT_EMAIL: "seed-sa@other-fake-project.iam.gserviceaccount.com" },
    ],
    ["confirm mismatch", [...baseArgv, "--write", "--confirm", "other-fake-project"], validEnv],
    ["unknown flag", [...baseArgv, "--token=FAKE-KEY-MATERIAL"], validEnv],
  ];

  it.each(failingCases)("never includes credentials or env values in the %s error", (_label, argv, env) => {
    const result = resolve(argv, env);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const serialized = JSON.stringify(result);
    for (const secret of secretValues) expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("BEGIN PRIVATE KEY");
  });

  it("does not echo the raw value of an unknown flag", () => {
    const result = resolve([...baseArgv, "--leaky-flag-name=super-secret-value"]);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(JSON.stringify(result)).not.toContain("super-secret-value");
  });

  it("does not echo the raw value of an invalid --as-of or --presenter-uid", () => {
    const asOf = resolve([...baseArgv, "--as-of", "not-a-date-xyz"]);
    const uid = resolve(["--project", PROJECT, "--presenter-uid", "bad/uid-xyz"]);

    expect(JSON.stringify(asOf)).not.toContain("not-a-date-xyz");
    expect(JSON.stringify(uid)).not.toContain("bad/uid-xyz");
  });
});

describe("resolveDemoSeedConfig — purity", () => {
  it("does not mutate its inputs", () => {
    const argv = [...baseArgv, "--offline"];
    const env = { ...validEnv };
    const argvCopy = [...argv];
    const envCopy = { ...env };

    resolveDemoSeedConfig({ argv, env, now });

    expect(argv).toEqual(argvCopy);
    expect(env).toEqual(envCopy);
  });
});

describe("demo-team slice — target-safety static checks", () => {
  // Built from parts so this test file never contains the forbidden literals
  // that it asserts are absent elsewhere in the slice.
  const forbidden = [
    "application" + "Default",
    ".firebase" + "rc",
    "firebase" + "-tools",
    "g" + "cloud",
    "devpulse-" + "ac26e",
    "GOOGLE_APPLICATION" + "_CREDENTIALS",
  ];

  const sliceDir = __dirname;
  const sourceFiles = readdirSync(sliceDir).filter(
    (name) => /\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name),
  );

  it("finds the slice's source files", () => {
    expect(sourceFiles).toContain("config.ts");
  });

  it.each(forbidden)("no source file in the slice references %s", (needle) => {
    for (const name of sourceFiles) {
      const content = readFileSync(join(sliceDir, name), "utf8");
      expect(content.includes(needle), `${name} must not contain ${needle}`).toBe(false);
    }
  });

  it("config.ts imports neither firebase-admin nor a server-only module and does no I/O", () => {
    const content = readFileSync(join(sliceDir, "config.ts"), "utf8");

    expect(content).not.toMatch(/from\s+["'](firebase|firebase-admin)/);
    expect(content).not.toMatch(/server-only/);
    expect(content).not.toMatch(/from\s+["']node:(fs|child_process|net|http|https|dns)/);
    expect(content).not.toMatch(/\bprocess\.(env|argv)\b/);
    expect(content).not.toMatch(/\bfetch\(/);
  });
});
