import { NextResponse } from "next/server";
import { authenticate, RECORD_ERROR_STATUS } from "../../../../src/features/personal-role-workspace/server/route-support";
import { listResponsibilities, createResponsibility, productionPersonalRecordDeps } from "../../../../src/features/personal-role-workspace/server/record-operations";
import { readResponsibilityCreate } from "../../../../src/features/personal-role-workspace/server/request-body";
import { authRefusalStatus } from "../../../../src/features/auth/server/auth-refusal";

const NO_STORE = { "Cache-Control": "no-store" };
const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: NO_STORE });

/**
 * Own responsibilities (SPEC BR-10 to BR-16; SECURITY.md PR-SI-1). The subject is the verified token's uid only. The
 * response lists records with an explicit allow-list, plus delete-only recovery items (`{ id }`) and a count of unavailable
 * records with no id.
 */
export async function GET(request: Request) {
  const verified = await authenticate(request);
  if (!verified.ok) return json({ error: verified.error }, authRefusalStatus(verified.error));

  const result = await listResponsibilities(verified.uid, productionPersonalRecordDeps());
  if (!result.ok) return json({ error: "persistence_failed" }, 500);

  const { items, truncated } = result.result;
  return json(
    {
      records: items.flatMap((item) => (item.kind === "record" ? [item.dto] : [])),
      recoveryItems: items.flatMap((item) => (item.kind === "malformed" ? [{ id: item.id }] : [])),
      unavailableCount: items.filter((item) => item.kind === "unavailable").length,
      truncated,
    },
    200,
  );
}

export async function POST(request: Request) {
  const verified = await authenticate(request);
  if (!verified.ok) return json({ error: verified.error }, authRefusalStatus(verified.error));

  const body = await readResponsibilityCreate(request);
  if (!body.ok) return json({ error: body.error }, body.error === "payload_too_large" ? 413 : 400);

  const result = await createResponsibility(verified.uid, body.value, productionPersonalRecordDeps());
  if (!result.ok) return json({ error: result.error }, RECORD_ERROR_STATUS[result.error]);
  return json(result.dto, 201);
}
