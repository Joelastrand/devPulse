import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// This file tests the real implementation, not the feature-test replacement.
vi.unmock("./admin");

type FakeApp = { name: string; options: { projectId?: string; credential?: unknown } };

const apps = vi.hoisted(() => ({ list: [] as FakeApp[] }));
const initializeApp = vi.hoisted(() =>
  vi.fn((options: { projectId?: string; credential?: unknown }, name?: string): FakeApp => {
    const app: FakeApp = { name: name ?? "[DEFAULT]", options };
    apps.list.push(app);
    return app;
  }),
);
const getFirestore = vi.hoisted(() => vi.fn((app: FakeApp) => ({ app })));

vi.mock("firebase-admin/app", () => ({
  applicationDefault: () => ({ kind: "adc" }),
  cert: (account: { projectId: string }) => ({ kind: "cert", projectId: account.projectId }),
  getApps: () => apps.list,
  initializeApp,
}));
vi.mock("firebase-admin/auth", () => ({ getAuth: () => ({}) }));
vi.mock("firebase-admin/firestore", () => ({ getFirestore }));

const EXPECTED = "devpulse-nve";

async function loadAdmin() {
  vi.resetModules();
  return import("./admin");
}

describe("Firebase Admin app selection (owner operations and the binding check share one instance)", () => {
  beforeEach(() => {
    apps.list.length = 0;
    initializeApp.mockClear();
    getFirestore.mockClear();
    delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.FIREBASE_CLIENT_EMAIL;
    delete process.env.FIREBASE_PRIVATE_KEY;
  });

  it("with a named app and a default app present, the binding check reports the DEFAULT app's project and owner access uses that same app", async () => {
    apps.list.push({ name: "demo-team-seed", options: { projectId: EXPECTED } });
    apps.list.push({ name: "[DEFAULT]", options: { projectId: "devpulse-other" } });
    const admin = await loadAdmin();
    expect(admin.getAdminAppProjectId()).toBe("devpulse-other");
    admin.getFirestoreDb();
    expect(getFirestore).toHaveBeenLastCalledWith(apps.list[1]);
    expect(initializeApp).not.toHaveBeenCalled();
  });

  it("a named app with the expected project never stands in for a missing default app: the default is initialized from the environment instead", async () => {
    apps.list.push({ name: "demo-team-seed", options: { projectId: EXPECTED } });
    process.env.FIREBASE_PROJECT_ID = "devpulse-other";
    const admin = await loadAdmin();
    expect(admin.getAdminAppProjectId()).toBe("devpulse-other");
    expect(initializeApp).toHaveBeenCalledTimes(1);
    const created = apps.list.find((app) => app.name === "[DEFAULT]");
    expect(created?.options.projectId).toBe("devpulse-other");
  });

  it("a default app bound to another project is reported as that project, so a caller requiring the expected project refuses", async () => {
    apps.list.push({ name: "[DEFAULT]", options: { projectId: "devpulse-other" } });
    const admin = await loadAdmin();
    const bound = admin.getAdminAppProjectId();
    expect(bound).not.toBe(EXPECTED);
  });

  it("a default app with no determinable project fails closed: the binding is undefined, never a guess", async () => {
    apps.list.push({ name: "[DEFAULT]", options: { credential: { kind: "adc" } } });
    const admin = await loadAdmin();
    expect(admin.getAdminAppProjectId()).toBeUndefined();
  });

  it("the project is read from a service-account credential when the app options carry no project id", async () => {
    apps.list.push({ name: "[DEFAULT]", options: { credential: { kind: "cert", projectId: EXPECTED } } });
    const admin = await loadAdmin();
    expect(admin.getAdminAppProjectId()).toBe(EXPECTED);
  });
});
