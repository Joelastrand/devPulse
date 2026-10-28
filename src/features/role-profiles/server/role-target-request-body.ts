/** A `roleId` is short; anything larger is not a request this route accepts. */
const MAX_BODY_CHARACTERS = 1024;

export type ReadSetRoleTargetRequestResult = { ok: true; roleId: string } | { ok: false };

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Strict `PUT /api/me/role-target` body reading (SPEC API, BR-10). The body is exactly `{ roleId }`: a bounded JSON
 * object whose only key is `roleId`, a string. Any other key, including a uid or e-mail, is refused. Business validity
 * belongs to the operation. Nothing from a rejected body is returned or logged.
 */
export async function readSetRoleTargetRequest(request: Request): Promise<ReadSetRoleTargetRequestResult> {
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false };
  }
  if (text.length > MAX_BODY_CHARACTERS) return { ok: false };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false };
  }
  if (!isPlainObject(parsed)) return { ok: false };
  if (Object.keys(parsed).length !== 1 || !("roleId" in parsed)) return { ok: false };

  const { roleId } = parsed;
  if (typeof roleId !== "string") return { ok: false };
  return { ok: true, roleId };
}
