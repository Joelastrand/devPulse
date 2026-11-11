import type { Parsed } from "./text";

export type RecordCollection = "responsibilities" | "achievements";

/**
 * One record type as the storage engine sees it. A schema owns its field rules; the engine owns the envelope, the
 * key checks and the transaction shape. `fromInput` and `fromStored` apply the same rules: a stored value that fails
 * them is malformed (SPEC E-4), never repaired.
 */
export interface RecordSchema<C> {
  readonly collection: RecordCollection;
  readonly cap: number;
  /** Keys of the encrypted payload, exactly. */
  readonly payloadKeys: readonly string[];
  /** Plain structured keys, exactly (no envelope keys, no timestamps). */
  readonly plainKeys: readonly string[];
  /** Validates a complete raw content object (every field present; absent optionals are `null`). */
  fromInput(raw: Record<string, unknown>): Parsed<C>;
  /** Splits a valid content into the encrypted payload and the plain part. */
  split(content: C): { payload: Record<string, unknown>; plain: Record<string, unknown> };
  /** The DTO of a valid record: an explicit allow-list, with no internal field. */
  toDto(id: string, content: C, createdAt: Date, updatedAt: Date): Record<string, unknown>;
  /** Keys of the DTO, in order. Tests pin this list. */
  readonly dtoKeys: readonly string[];
}
