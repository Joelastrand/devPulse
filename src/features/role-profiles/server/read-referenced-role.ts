import { parseStoredRoleDefinition, type RoleDefinition } from "../domain/role-definition";
import { InvalidRoleStoreKeyError, type RawRoleData } from "./role-store-types";

/** Reads one raw role document, plain or transactional. Absence is `undefined`; a failed read rejects. */
export type RawRoleReader = (roleId: string) => Promise<RawRoleData | undefined>;

/**
 * The referenced role if it exists and is valid (archived included). A missing, malformed or unaddressable reference
 * is `undefined`. A failed read rejects: it is never reported as missing (BR-20).
 */
export async function readReferencedRole(readRaw: RawRoleReader, roleId: string): Promise<RoleDefinition | undefined> {
  let raw: RawRoleData | undefined;
  try {
    raw = await readRaw(roleId);
  } catch (error) {
    if (error instanceof InvalidRoleStoreKeyError) return undefined;
    throw error;
  }
  if (raw === undefined) return undefined;
  const parsed = parseStoredRoleDefinition(raw);
  return parsed.ok ? parsed.role : undefined;
}
