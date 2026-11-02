import { describe, expect, it, vi } from "vitest";
import { ErasureWriteRefused } from "../../auth/server/erasure-write-fence";
import { invitationDocId } from "../domain/team-invitation";
import { membershipDocId } from "../domain/team-membership";
import { grantTeamMembership } from "./grant-team-membership";
import { resolveInvitations } from "./resolve-invitations";

// TASK-030: production membership-writing transactions over a recording Admin Firestore double (structural, not Firestore's
// conflict behaviour, which is the D-EMU gate). Each membership write reads the target uid's erasure fence first, in the same
// transaction, and writes nothing when the fence refuses. Fixtures are synthetic.

const holder = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("../../../lib/firebase/admin", () => ({
  getFirestoreDb: () => holder.db,
}));
vi.mock("server-only", () => ({}));

const TEAM_ID = "team-30";
const UID = "invitee-1";
const EMAIL = "invitee@example.com";
const INVITER = "admin-1";
const NOW = new Date("2026-10-29T10:00:00Z");

type Data = Record<string, unknown>;

interface Double {
  db: unknown;
  log: string[];
  docs: Map<string, Data>;
  committed: string[];
}

function createDouble(seed: Record<string, Data>): Double {
  const double: Double = { db: undefined, log: [], docs: new Map(Object.entries(seed)), committed: [] };

  const docRef = (path: string) => ({
    path,
    id: path.split("/").at(-1) as string,
    async get() {
      double.log.push(`get|${path}`);
      return { exists: double.docs.has(path), data: () => double.docs.get(path) };
    },
  });

  const query = (collection: string, filters: Array<[string, string]>) => ({
    where: (field: string, _op: string, value: string) => query(collection, [...filters, [field, value]]),
    async get() {
      double.log.push(`query|${collection}`);
      const matches = [...double.docs.entries()].filter(
        ([path, data]) => path.startsWith(`${collection}/`) && filters.every(([field, value]) => data[field] === value),
      );
      return { docs: matches.map(([path, data]) => ({ id: path.split("/").at(-1), data: () => data, ref: docRef(path) })) };
    },
  });

  double.db = {
    collection: (name: string) => ({
      doc: (id: string) => docRef(`${name}/${id}`),
      where: (field: string, _op: string, value: string) => query(name, [[field, value]]),
    }),
    async runTransaction(work: (tx: unknown) => Promise<unknown>) {
      double.log.push("runTransaction");
      const pending: Array<[string, Data]> = [];
      const tx = {
        async get(ref: { path: string }) {
          double.log.push(`tx.get|${ref.path}`);
          return { exists: double.docs.has(ref.path), data: () => double.docs.get(ref.path) };
        },
        set(ref: { path: string }, data: Data) {
          double.log.push(`tx.set|${ref.path}`);
          pending.push([ref.path, data]);
        },
        update(ref: { path: string }, data: Data) {
          double.log.push(`tx.update|${ref.path}`);
          pending.push([ref.path, { ...(double.docs.get(ref.path) ?? {}), ...data }]);
        },
      };
      const result = await work(tx);
      for (const [path, data] of pending) {
        double.docs.set(path, data);
        double.committed.push(path);
      }
      return result;
    },
  };
  return double;
}

const fence = `accountErasures/${UID}`;
const membership = `teamMemberships/${membershipDocId(UID, TEAM_ID)}`;
const invitation = `teamInvitations/${invitationDocId(TEAM_ID, EMAIL)}`;

function pendingInvitation(): Data {
  return { teamId: TEAM_ID, email: EMAIL, status: "pending", invitedBy: INVITER, createdAt: NOW };
}

describe("membership-writing transactions are fenced by the target uid (TASK-030, BR-4(b))", () => {
  it("grant refuses with ErasureWriteRefused and writes no membership when the target has an erasure record", async () => {
    const double = createDouble({ [fence]: { status: "in_progress" } });
    holder.db = double.db;

    await expect(
      grantTeamMembership({ uid: UID, teamId: TEAM_ID, createdAt: NOW, createdVia: "invitation", grantedBy: INVITER }),
    ).rejects.toBeInstanceOf(ErasureWriteRefused);
    expect(double.committed).toEqual([]);
    expect(double.docs.has(membership)).toBe(false);
  });

  it("grant reads the target's fence first, in the same transaction as the membership write, when no record exists", async () => {
    const double = createDouble({});
    holder.db = double.db;

    expect(
      await grantTeamMembership({ uid: UID, teamId: TEAM_ID, createdAt: NOW, createdVia: "invitation", grantedBy: INVITER }),
    ).toBe("created");
    expect(double.log.indexOf(`tx.get|${fence}`)).toBeLessThan(double.log.indexOf(`tx.set|${membership}`));
    expect(double.committed).toEqual([membership]);
  });

  it("resolution with an in-progress erasure creates no membership and leaves the invitation pending", async () => {
    const double = createDouble({ [fence]: { status: "in_progress" }, [invitation]: pendingInvitation() });
    holder.db = double.db;

    const result = await resolveInvitations(
      { uid: UID, email: EMAIL, emailVerified: true },
      { now: NOW },
    );

    expect(double.log).toContain(`tx.get|${fence}`);
    expect(double.log).not.toContain(`tx.get|${invitation}`);
    expect(result).toEqual({ ok: false, error: "erasure_in_progress" });
    expect(double.committed).toEqual([]);
    expect(double.docs.has(membership)).toBe(false);
    expect(double.docs.get(invitation)?.status).toBe("pending");
  });

  it("resolution without an erasure record creates the membership and accepts the invitation (behaviour unchanged)", async () => {
    const double = createDouble({ [invitation]: pendingInvitation() });
    holder.db = double.db;

    const result = await resolveInvitations({ uid: UID, email: EMAIL, emailVerified: true }, { now: NOW });

    expect(result).toEqual({ ok: true, membershipsCreated: 1 });
    expect(double.log).toContain(`tx.get|${fence}`);
    expect(double.log.indexOf(`tx.get|${fence}`)).toBeLessThan(double.log.indexOf(`tx.update|${invitation}`));
    expect(double.committed).toEqual(expect.arrayContaining([membership, invitation]));
    expect(double.docs.get(invitation)?.status).toBe("accepted");
  });
});
