import "server-only";
import { Timestamp, type Firestore, type Transaction } from "firebase-admin/firestore";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { verifyIdToken, type VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import { type AuthRefusal, authRefusalFor } from "../../auth/server/auth-refusal";
import { runFencedTransaction, writeRefusalFor } from "../../auth/server/erasure-write-fence";
import { isValidTeamStatus } from "../../teams/domain/team";
import { isValidMembershipFor, membershipDocId } from "../../teams/domain/team-membership";
import { openFavoriteTeamId, sealFavoriteContent, FAVORITE_CONTENT_FIELD } from "./system-favorites-codec";

/**
 * Personal Systemoversikt favorites (Phase 2F.1). Every operation takes the caller's identity from a verified ID token; no
 * client-supplied uid is read. Team membership is checked on the active team's membership document, and a write also checks
 * that the target system exists in that same team. The write is an idempotent "set this favorite on or off" for the caller
 * only, so a retried request cannot toggle the state twice. Writes go through the erasure fence, so an erasure in progress
 * refuses them.
 */

const USER_DEVELOPMENT_COLLECTION = "userDevelopment";
const FAVORITES_COLLECTION = "systemFavorites";
const MEMBERSHIPS_COLLECTION = "teamMemberships";
const TEAMS_COLLECTION = "teams";
const SYSTEMS_COLLECTION = "teamSystems";

/** Most favorites one read returns. A person can favorite at most the systems of the teams they belong to, far below this. */
export const FAVORITE_READ_LIMIT = 1000;

const SYSTEM_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export type FavoriteError =
  | AuthRefusal
  | "forbidden"
  | "team_disabled"
  | "invalid_request"
  | "not_found"
  | "erasure_in_progress"
  | "persistence_failed";

export type ReadFavoritesResult = { ok: true; systemIds: string[] } | { ok: false; error: FavoriteError };
export type SetFavoriteResult = { ok: true; favorite: boolean } | { ok: false; error: FavoriteError };

/** Raw reads and writes available inside one favorite-write transaction. Every read happens before the writes. */
export interface FavoriteWriteTx {
  getMembership(uid: string, teamId: string): Promise<unknown>;
  getTeamStatus(teamId: string): Promise<unknown>;
  /** The stored `teamId` of a system, `undefined` when the system does not exist. */
  getSystemTeamId(systemId: string): Promise<unknown>;
  setFavorite(uid: string, systemId: string, data: Record<string, unknown>): void;
  deleteFavorite(uid: string, systemId: string): void;
}

export interface FavoriteStore {
  getMembership(uid: string, teamId: string): Promise<unknown>;
  getTeamStatus(teamId: string): Promise<unknown>;
  /** Raw favorite documents of one person: id and data. */
  listFavorites(uid: string): Promise<{ id: string; data: unknown }[]>;
  runWriteTransaction<T>(actorUid: string, fn: (tx: FavoriteWriteTx) => Promise<T>): Promise<T>;
}

export interface FavoriteDeps {
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  store?: FavoriteStore;
  now?: () => Date;
}

function favoriteRef(db: Firestore, uid: string, systemId: string) {
  return db.collection(USER_DEVELOPMENT_COLLECTION).doc(uid).collection(FAVORITES_COLLECTION).doc(systemId);
}

function toFirestoreStore(db: Firestore): FavoriteStore {
  return {
    async getMembership(uid, teamId) {
      const snapshot = await db.collection(MEMBERSHIPS_COLLECTION).doc(membershipDocId(uid, teamId)).get();
      return snapshot.exists ? snapshot.data() : undefined;
    },
    async getTeamStatus(teamId) {
      const snapshot = await db.collection(TEAMS_COLLECTION).doc(teamId).get();
      return snapshot.exists ? snapshot.data()?.status : undefined;
    },
    async listFavorites(uid) {
      const snapshot = await db
        .collection(USER_DEVELOPMENT_COLLECTION)
        .doc(uid)
        .collection(FAVORITES_COLLECTION)
        .limit(FAVORITE_READ_LIMIT)
        .get();
      return snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
    },
    runWriteTransaction(actorUid, fn) {
      return runFencedTransaction(db, actorUid, (tx) => fn(toFirestoreTx(db, tx)));
    },
  };
}

function toFirestoreTx(db: Firestore, tx: Transaction): FavoriteWriteTx {
  return {
    async getMembership(uid, teamId) {
      const snapshot = await tx.get(db.collection(MEMBERSHIPS_COLLECTION).doc(membershipDocId(uid, teamId)));
      return snapshot.exists ? snapshot.data() : undefined;
    },
    async getTeamStatus(teamId) {
      const snapshot = await tx.get(db.collection(TEAMS_COLLECTION).doc(teamId));
      return snapshot.exists ? snapshot.data()?.status : undefined;
    },
    async getSystemTeamId(systemId) {
      const snapshot = await tx.get(db.collection(SYSTEMS_COLLECTION).doc(systemId));
      return snapshot.exists ? snapshot.data()?.teamId : undefined;
    },
    setFavorite(uid, systemId, data) {
      tx.set(favoriteRef(db, uid, systemId), data);
    },
    deleteFavorite(uid, systemId) {
      tx.delete(favoriteRef(db, uid, systemId));
    },
  };
}

function getDefaultStore(): FavoriteStore {
  return toFirestoreStore(getFirestoreDb());
}

export function isSystemIdSegment(value: unknown): value is string {
  return typeof value === "string" && SYSTEM_ID_PATTERN.test(value);
}

/**
 * The caller's favorite system ids in one team. Only favorites whose sealed team id matches are returned, and only for a caller
 * who is a genuine member of that team. Unreadable records are skipped, so no half-valid record is shown.
 */
export async function listSystemFavorites(
  idToken: string,
  teamId: string,
  deps: FavoriteDeps = {},
): Promise<ReadFavoritesResult> {
  const verified = await verifyIdToken(idToken, { verifyToken: deps.verifyToken });
  if (!verified.ok) return { ok: false, error: authRefusalFor(verified) };
  const uid = verified.identity.uid;
  const store = deps.store ?? getDefaultStore();

  try {
    const membership = await store.getMembership(uid, teamId);
    if (!isValidMembershipFor(membership, { uid, teamId })) return { ok: false, error: "forbidden" };

    const docs = await store.listFavorites(uid);
    const systemIds: string[] = [];
    for (const { id, data } of docs) {
      if (!isSystemIdSegment(id)) continue;
      if (openFavoriteTeamId(uid, id, data) === teamId) systemIds.push(id);
    }
    return { ok: true, systemIds: systemIds.sort() };
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}

/**
 * Sets one system as the caller's favorite, or removes it, for a system in `teamId`. The request names the desired state, so
 * repeating it changes nothing. Authorization: a genuine membership, on an `active` team, re-read inside the transaction. A
 * system id that is not in the team is `not_found`, so the caller learns nothing about other teams.
 */
export async function setSystemFavorite(
  idToken: string,
  teamId: string,
  systemId: string,
  favorite: boolean,
  deps: FavoriteDeps = {},
): Promise<SetFavoriteResult> {
  const verified = await verifyIdToken(idToken, { verifyToken: deps.verifyToken });
  if (!verified.ok) return { ok: false, error: authRefusalFor(verified) };
  const uid = verified.identity.uid;
  if (!isSystemIdSegment(systemId) || typeof favorite !== "boolean") return { ok: false, error: "invalid_request" };

  const now = (deps.now ?? (() => new Date()))();
  const store = deps.store ?? getDefaultStore();

  try {
    return await store.runWriteTransaction(uid, async (tx): Promise<SetFavoriteResult> => {
      const fail = (error: FavoriteError): SetFavoriteResult => ({ ok: false, error });

      const membership = await tx.getMembership(uid, teamId);
      if (!isValidMembershipFor(membership, { uid, teamId })) return fail("forbidden");
      const teamStatus = await tx.getTeamStatus(teamId);
      if (!isValidTeamStatus(teamStatus) || teamStatus !== "active") return fail("team_disabled");

      const systemTeamId = await tx.getSystemTeamId(systemId);
      if (systemTeamId === undefined || systemTeamId !== teamId) return fail("not_found");

      if (favorite) {
        tx.setFavorite(uid, systemId, {
          [FAVORITE_CONTENT_FIELD]: sealFavoriteContent(uid, systemId, teamId),
          favoritedAt: Timestamp.fromDate(now),
        });
      } else {
        tx.deleteFavorite(uid, systemId);
      }
      return { ok: true, favorite };
    });
  } catch (error) {
    return { ok: false, error: writeRefusalFor(error) };
  }
}
