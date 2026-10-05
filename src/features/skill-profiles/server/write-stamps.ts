import { hasValidCreatedAt } from "../domain/skill-profile";
import type { SkillProfileStamps } from "./skill-profile-store";

/** Repair-on-write (SPEC BR-10): `updatedAt` always; `createdAt` only when absent or invalid. */
export function stampsForWrite(existing: Readonly<Record<string, unknown>> | undefined, now: Date): SkillProfileStamps {
  return hasValidCreatedAt(existing) ? { updatedAt: now } : { updatedAt: now, createdAt: now };
}
