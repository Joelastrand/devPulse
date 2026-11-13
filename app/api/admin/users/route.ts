import { NextResponse } from "next/server";
import { listAuthUsers } from "../../../../src/features/superadmins/server/user-management";
import { listQueryFrom, userManagementErrorStatus } from "../../../../src/features/superadmins/server/user-management-http";
import { bearerTokenFrom } from "../../../../src/features/superadmins/server/superadmin-http";

/**
 * Superadmin user list (`/admin/users`): one page per request, or one exact e-mail lookup. The operation re-authorizes the
 * caller on every request; the query values are untrusted input.
 */
export async function GET(request: Request) {
  const result = await listAuthUsers(
    bearerTokenFrom(request.headers.get("authorization")),
    listQueryFrom(new URL(request.url)),
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: userManagementErrorStatus(result.error) });
  return NextResponse.json({ users: result.users, nextPageToken: result.nextPageToken }, { status: 200 });
}
