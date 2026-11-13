"use client";

import { useState, type FormEvent } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { EmptyState } from "../../../components/ui/EmptyState";
import { LoadingState } from "../../../components/ui/LoadingState";
import { TextField } from "../../../components/ui/TextField";
import { useAuthGatedResource } from "../../auth/client/use-auth-gated-resource";
import {
  fetchAuthUserDetail,
  fetchAuthUsers,
  setAuthUserDisabled,
  type AuthUserEntry,
  type TeamEntry,
} from "../client/user-management-gateway";
import { userManagementCopy as copy, userManagementErrorMessage } from "../user-management-copy";

type Notice = { variant: "success" | "error"; message: string };
type Detail = { readonly user: AuthUserEntry; readonly teams: readonly TeamEntry[] };

/**
 * Superadmin user management (`/admin/superadmins`, below the registry). Pages through Auth users, searches by exact e-mail,
 * and disables or re-enables one account. Every call is re-authorized by the server. The component never decides admin status.
 */
export function AdminUsers() {
  const [token, setToken] = useState<string | null>(null);
  const [users, setUsers] = useState<readonly AuthUserEntry[] | null>(null);
  const [cursors, setCursors] = useState<readonly (string | null)[]>([null]);
  const [nextToken, setNextToken] = useState<string | null>(null);
  const [listError, setListError] = useState<string>();
  const [query, setQuery] = useState("");
  const [activeEmail, setActiveEmail] = useState<string | undefined>();
  const [detail, setDetail] = useState<Detail>();
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<Notice>();
  const [busy, setBusy] = useState(false);

  useAuthGatedResource((nextTokenValue) => {
    setToken(nextTokenValue);
    if (!nextTokenValue) {
      setUsers(null);
      return;
    }
    void load(nextTokenValue, null, undefined);
  }, []);

  async function load(activeToken: string, pageToken: string | null, email: string | undefined) {
    setListError(undefined);
    const result = await fetchAuthUsers(activeToken, { pageToken, email });
    if (!result.ok) {
      setUsers([]);
      setListError(userManagementErrorMessage(result.error));
      return;
    }
    setUsers(result.users);
    setNextToken(result.nextPageToken);
  }

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || busy) return;
    const email = query.trim();
    setActiveEmail(email.length > 0 ? email : undefined);
    setCursors([null]);
    setDetail(undefined);
    setConfirming(false);
    void load(token, null, email.length > 0 ? email : undefined);
  }

  function handleNextPage() {
    if (!token || !nextToken) return;
    setCursors((previous) => [...previous, nextToken]);
    void load(token, nextToken, activeEmail);
  }

  async function openDetail(uid: string) {
    if (!token) return;
    setNotice(undefined);
    setConfirming(false);
    const result = await fetchAuthUserDetail(token, uid);
    if (!result.ok) {
      setDetail(undefined);
      setNotice({ variant: "error", message: userManagementErrorMessage(result.error) });
      return;
    }
    setDetail({ user: result.user, teams: result.teams });
  }

  async function changeDisabled(disabled: boolean) {
    if (!token || !detail || busy) return;
    setBusy(true);
    const result = await setAuthUserDisabled(token, detail.user.uid, disabled);
    setBusy(false);
    setConfirming(false);
    if (!result.ok) {
      setNotice({ variant: "error", message: userManagementErrorMessage(result.error) });
      return;
    }
    setNotice({ variant: "success", message: disabled ? copy.disabledOk : copy.enabledOk });
    await openDetail(detail.user.uid);
    await load(token, cursors[cursors.length - 1] ?? null, activeEmail);
  }

  return (
    <section aria-labelledby="admin-users-heading" className="flex flex-col gap-4">
      <div>
        <h2 id="admin-users-heading" className="text-lg font-semibold text-text-primary">
          {copy.sectionTitle}
        </h2>
        <p className="mt-1 text-sm text-text-secondary">{copy.sectionDescription}</p>
      </div>

      <form onSubmit={handleSearch} className="flex flex-col gap-3 sm:flex-row sm:items-end" noValidate>
        <TextField
          id="admin-users-search"
          label={copy.searchLabel}
          type="email"
          autoComplete="off"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button type="submit" variant="secondary" pending={busy}>
          {copy.searchSubmit}
        </Button>
      </form>

      {notice && (
        <Alert variant={notice.variant === "error" ? "error" : "success"} className="text-sm">
          {notice.message}
        </Alert>
      )}

      {users === null && <LoadingState label={copy.listLoading} />}
      {listError && (
        <Alert variant="error" className="text-sm">
          {listError}
        </Alert>
      )}
      {users !== null && users.length === 0 && !listError && <EmptyState>{copy.listEmpty}</EmptyState>}

      {users !== null && users.length > 0 && (
        <ul className="flex flex-col divide-y divide-border-subtle rounded-control border border-border-subtle">
          {users.map((user) => (
            <li key={user.uid} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate font-medium text-text-primary">{user.email ?? copy.noAddress}</p>
                <p className="text-sm text-text-secondary">
                  {user.emailVerified ? copy.verified : copy.notVerified} · {user.disabled ? copy.disabled : copy.enabled}
                </p>
              </div>
              <Button type="button" variant="secondary" size="sm" onClick={() => void openDetail(user.uid)}>
                {copy.view}
                <span className="sr-only"> {user.email ?? copy.noAddress}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}

      {users !== null && users.length > 0 && nextToken && (
        <div>
          <Button type="button" variant="tertiary" onClick={handleNextPage}>
            {copy.nextPage}
          </Button>
        </div>
      )}

      {detail && (
        <div className="flex flex-col gap-3 rounded-control border border-border-subtle p-4" aria-live="polite">
          <p className="font-medium text-text-primary">{detail.user.email ?? copy.noAddress}</p>
          <dl className="grid grid-cols-1 gap-1 text-sm text-text-secondary sm:grid-cols-2">
            <dt className="font-medium">{copy.createdAt}</dt>
            <dd>{detail.user.createdAt ? new Date(detail.user.createdAt).toLocaleString("nb-NO") : copy.never}</dd>
            <dt className="font-medium">{copy.lastSignInAt}</dt>
            <dd>{detail.user.lastSignInAt ? new Date(detail.user.lastSignInAt).toLocaleString("nb-NO") : copy.never}</dd>
          </dl>
          <div>
            <h3 className="text-sm font-medium text-text-primary">{copy.teams}</h3>
            {detail.teams.length === 0 ? (
              <p className="text-sm text-text-secondary">{copy.noTeams}</p>
            ) : (
              <ul className="mt-1 list-disc pl-5 text-sm text-text-secondary">
                {detail.teams.map((team) => (
                  <li key={team.teamId}>
                    {team.teamId} ({team.role === "teamadmin" ? copy.teamadmin : copy.member})
                  </li>
                ))}
              </ul>
            )}
          </div>

          {detail.user.disabled ? (
            <Button type="button" variant="secondary" pending={busy} onClick={() => void changeDisabled(false)}>
              {copy.enable}
            </Button>
          ) : confirming ? (
            <div role="group" aria-labelledby="confirm-disable-title" className="flex flex-col gap-3 rounded-control border border-danger-text p-4">
              <p id="confirm-disable-title" className="font-medium text-text-primary">
                {copy.confirmDisableTitle}
              </p>
              <p className="text-sm text-text-secondary">{copy.confirmDisableBody}</p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button type="button" variant="destructive" pending={busy} onClick={() => void changeDisabled(true)}>
                  {copy.confirmDisable}
                </Button>
                <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
                  {copy.cancel}
                </Button>
              </div>
            </div>
          ) : (
            <Button type="button" variant="destructive" onClick={() => setConfirming(true)}>
              {copy.disable}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
