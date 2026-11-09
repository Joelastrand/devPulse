"use client";

import { useState, type FormEvent } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { EmptyState } from "../../../components/ui/EmptyState";
import { LoadingState } from "../../../components/ui/LoadingState";
import { TextField } from "../../../components/ui/TextField";
import { useAuthGatedResource } from "../../auth/client/use-auth-gated-resource";
import {
  fetchSuperadmins,
  grantSuperadmin,
  revokeSuperadmin,
  type SuperadminEntry,
} from "../client/superadmins-gateway";
import { superadminErrorMessage, superadminsCopy } from "../copy";

type ListState = { status: "loading" } | { status: "ok"; entries: readonly SuperadminEntry[] } | { status: "error"; message: string };
type Notice = { variant: "success" | "error"; message: string };

/**
 * Superadmin management (`/admin/superadmins`). Lists active superadmins, adds an existing verified Auth user by e-mail, and
 * revokes another superadmin only after an explicit confirmation. Every call is re-authorized by the server; this component
 * never decides admin status and never sends a UID as a grant target.
 */
export function AdminSuperadmins() {
  const [token, setToken] = useState<string | null>(null);
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [notice, setNotice] = useState<Notice>();
  const [email, setEmail] = useState("");
  const [pendingRevokeUid, setPendingRevokeUid] = useState<string>();
  const [busy, setBusy] = useState<"add" | "revoke">();

  useAuthGatedResource((nextToken, generation, isCurrentGeneration) => {
    setToken(nextToken);
    setNotice(undefined);
    setPendingRevokeUid(undefined);
    if (!nextToken) {
      setList({ status: "loading" });
      return;
    }
    setList({ status: "loading" });
    void fetchSuperadmins(nextToken).then((result) => {
      if (!isCurrentGeneration(generation)) return;
      setList(result.ok ? { status: "ok", entries: result.superadmins } : { status: "error", message: superadminErrorMessage(result.error) });
    });
  }, []);

  async function reload(activeToken: string) {
    const result = await fetchSuperadmins(activeToken);
    setList(result.ok ? { status: "ok", entries: result.superadmins } : { status: "error", message: superadminErrorMessage(result.error) });
  }

  async function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || busy) return;
    const trimmed = email.trim();
    if (trimmed.length === 0) {
      setNotice({ variant: "error", message: superadminErrorMessage("invalid_input") });
      return;
    }
    setBusy("add");
    setNotice(undefined);
    const result = await grantSuperadmin(token, trimmed);
    setBusy(undefined);
    if (result.ok) {
      setEmail("");
      setNotice({
        variant: "success",
        message: result.outcome === "already_superadmin" ? superadminsCopy.addAlreadySuperadmin : superadminsCopy.addSuccess,
      });
      await reload(token);
    } else {
      setNotice({ variant: "error", message: superadminErrorMessage(result.error) });
    }
  }

  async function handleRevoke(uid: string) {
    if (!token || busy) return;
    setBusy("revoke");
    setNotice(undefined);
    const result = await revokeSuperadmin(token, uid);
    setBusy(undefined);
    setPendingRevokeUid(undefined);
    setNotice(
      result.ok
        ? { variant: "success", message: superadminsCopy.revokeSuccess }
        : { variant: "error", message: superadminErrorMessage(result.error) },
    );
    await reload(token);
  }

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="superadmin-add-heading" className="flex flex-col gap-3">
        <h2 id="superadmin-add-heading" className="text-lg font-semibold text-text-primary">
          {superadminsCopy.addHeading}
        </h2>
        <p className="text-sm text-text-secondary">{superadminsCopy.addDescription}</p>
        <form onSubmit={handleAdd} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <TextField
              id="superadmin-email"
              label={superadminsCopy.emailLabel}
              type="email"
              name="email"
              autoComplete="off"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <Button type="submit" variant="primary" pending={busy === "add"} disabled={!token}>
            {busy === "add" ? superadminsCopy.addPending : superadminsCopy.addSubmit}
          </Button>
        </form>
      </section>

      {notice ? <Alert variant={notice.variant}>{notice.message}</Alert> : null}

      <section aria-labelledby="superadmin-list-heading" className="flex flex-col gap-3">
        <h2 id="superadmin-list-heading" className="text-lg font-semibold text-text-primary">
          {superadminsCopy.listHeading}
        </h2>
        {list.status === "loading" ? <LoadingState label={superadminsCopy.listLoading} /> : null}
        {list.status === "error" ? <Alert variant="error">{list.message}</Alert> : null}
        {list.status === "ok" && list.entries.length === 0 ? <EmptyState>{superadminsCopy.listEmpty}</EmptyState> : null}
        {list.status === "ok" && list.entries.length > 0 ? (
          <ul className="flex flex-col divide-y divide-border">
            {list.entries.map((entry) => (
              <li key={entry.uid} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="break-all font-mono text-sm text-text-primary">{entry.uid}</p>
                  <p className="text-xs text-text-secondary">
                    {superadminsCopy.grantedAt}:{" "}
                    {entry.grantedAt === null
                      ? superadminsCopy.grantedAtUnknown
                      : new Date(entry.grantedAt).toLocaleDateString("nb-NO")}
                  </p>
                </div>
                {pendingRevokeUid === entry.uid ? (
                  <div role="group" aria-label={superadminsCopy.revokeConfirmTitle} className="flex flex-col gap-2 sm:items-end">
                    <p className="text-sm font-medium text-text-primary">{superadminsCopy.revokeConfirmTitle}</p>
                    <p className="text-sm text-text-secondary">{superadminsCopy.revokeConfirmBody}</p>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        pending={busy === "revoke"}
                        onClick={() => void handleRevoke(entry.uid)}
                      >
                        {busy === "revoke" ? superadminsCopy.revokeConfirmPending : superadminsCopy.revokeConfirmSubmit}
                      </Button>
                      <Button type="button" variant="secondary" size="sm" disabled={busy === "revoke"} onClick={() => setPendingRevokeUid(undefined)}>
                        {superadminsCopy.revokeCancel}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={busy !== undefined || !token}
                    onClick={() => setPendingRevokeUid(entry.uid)}
                  >
                    {superadminsCopy.revokeButton}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}
