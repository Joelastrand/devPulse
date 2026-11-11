"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { UserCog } from "lucide-react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { Icon } from "../../../components/ui/Icon";
import { LoadingState } from "../../../components/ui/LoadingState";
import { useAuthGatedResource } from "../../auth/client/use-auth-gated-resource";
import {
  fetchAdminRoles,
  setAdminRoleArchived,
  type AdminRoleView,
  type FetchAdminRolesResult,
} from "../client/roles-gateway";
import { adminRolesCopy, roleErrorMessage } from "../copy";
import { RoleForm } from "./RoleForm";

type LoadedState = { phase: "loaded"; token: string; generation: number; result: FetchAdminRolesResult };
type ViewState = { phase: "loading" } | { phase: "signed_out" } | LoadedState;

/** The one open panel: the create form, or the edit form of one role. Only one is open at a time. */
type Panel = { kind: "create" } | { kind: "edit"; roleId: string } | null;

/**
 * Admin-only `/admin/roles` page (SPEC "Navigation and UX"). Lists roles with status, creates and edits them through the
 * admin routes, and archives or restores them (PG-6). Every call is re-authorized by the server; this component never
 * decides admin status itself. A response from a superseded sign-in is never applied.
 */
export function AdminRoles() {
  const [state, setState] = useState<ViewState>({ phase: "loading" });
  const [panel, setPanel] = useState<Panel>(null);
  const [busyRoleId, setBusyRoleId] = useState<string>();
  const [actionError, setActionError] = useState<{ roleId: string; message: string }>();
  const [selectedRoleId, setSelectedRoleId] = useState<string>();
  const isCurrentRef = useRef<((generation: number) => boolean) | null>(null);

  useAuthGatedResource((token, generation, isCurrentGeneration) => {
    isCurrentRef.current = isCurrentGeneration;
    setPanel(null);
    setActionError(undefined);
    if (!token) {
      setState({ phase: "signed_out" });
      return;
    }
    setState({ phase: "loading" });
    void fetchAdminRoles(token).then((result) => {
      if (isCurrentGeneration(generation)) setState({ phase: "loaded", token, generation, result });
    });
  });

  /** Refetches the list after a successful change, for the same auth generation only. */
  function refresh(loaded: LoadedState) {
    void fetchAdminRoles(loaded.token).then((result) => {
      if (isCurrentRef.current?.(loaded.generation)) setState({ ...loaded, result });
    });
  }

  async function changeArchived(loaded: LoadedState, roleId: string, archived: boolean) {
    setBusyRoleId(roleId);
    setActionError(undefined);
    const result = await setAdminRoleArchived(loaded.token, roleId, archived);
    setBusyRoleId(undefined);
    if (result.ok) refresh(loaded);
    else setActionError({ roleId, message: roleErrorMessage(result.error) });
  }

  if (state.phase === "loading") {
    return <LoadingState label={adminRolesCopy.loading} />;
  }
  if (state.phase === "signed_out") {
    return <SignInPrompt />;
  }

  const { result } = state;
  if (result.status === "unauthenticated") {
    return <SignInPrompt />;
  }
  if (result.status === "forbidden") {
    return <Alert variant="error">{adminRolesCopy.forbidden}</Alert>;
  }
  if (result.status === "read_failed") {
    return <Alert variant="error">{adminRolesCopy.readFailed}</Alert>;
  }

  const loadedRoles = state.phase === "loaded" && state.result.status === "ok" ? state.result.roles : [];
  const selectedRole = loadedRoles.find((role) => role.roleId === selectedRoleId) ?? loadedRoles[0];
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{adminRolesCopy.notice}</p>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-expanded={panel?.kind === "create"}
          aria-controls="role-create-form"
          onClick={() => setPanel(panel?.kind === "create" ? null : { kind: "create" })}
        >
          {adminRolesCopy.newRole}
        </Button>
      </div>

      {panel?.kind === "create" && (
        <div id="role-create-form">
          <RoleForm
            token={state.token}
            onSaved={() => {
              setPanel(null);
              refresh(state);
            }}
            onCancel={() => setPanel(null)}
          />
        </div>
      )}

      {result.roles.length === 0 ? (
        <p className="text-zinc-600 dark:text-zinc-400">{adminRolesCopy.empty}</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] lg:items-start">
          {/* Split view (visual-redesign TASK-015): on lg the list is the left column and only the selected role is shown on the right. */}
          <ul aria-label={adminRolesCopy.splitListLabel} className="hidden flex-col gap-2 lg:flex">
            {result.roles.map((role) => (
              <li key={role.roleId}>
                <button
                  type="button"
                  aria-pressed={role.roleId === selectedRole?.roleId}
                  onClick={() => {
                    setSelectedRoleId(role.roleId);
                    // An open editor belongs to the role it was opened for; it must not stay open on a hidden row.
                    if (panel?.kind === "edit" && panel.roleId !== role.roleId) setPanel(null);
                  }}
                  className={`flex w-full flex-col gap-1 rounded-md border px-3 py-2 text-left text-sm ${
                    role.roleId === selectedRole?.roleId ? "border-primary bg-primary-subtle" : "border-border-subtle"
                  }`}
                >
                  <span className="flex items-center gap-2 font-medium text-text-primary">
                    <Icon icon={UserCog} size="inline" />
                    {role.name}
                  </span>
                  <span className="line-clamp-2 text-xs text-text-secondary">{role.description}</span>
                  {role.archived && <span className="text-xs text-text-secondary">{adminRolesCopy.statusArchived}</span>}
                </button>
              </li>
            ))}
          </ul>
        <ul className="flex min-w-0 flex-col gap-4">
          {result.roles.map((role) => (
            <RoleRow
              key={role.roleId}
              role={role}
              selected={role.roleId === selectedRole?.roleId}
              token={state.token}
              editing={panel?.kind === "edit" && panel.roleId === role.roleId}
              busy={busyRoleId === role.roleId}
              actionError={actionError?.roleId === role.roleId ? actionError.message : undefined}
              onToggleEdit={() =>
                setPanel(panel?.kind === "edit" && panel.roleId === role.roleId ? null : { kind: "edit", roleId: role.roleId })
              }
              onSaved={() => {
                setPanel(null);
                refresh(state);
              }}
              onArchiveChange={(archived) => void changeArchived(state, role.roleId, archived)}
            />
          ))}
        </ul>
        </div>
      )}
    </div>
  );
}

interface RoleRowProps {
  role: AdminRoleView;
  /** On lg the split view shows only the selected role; below lg every role stays visible. */
  selected: boolean;
  token: string;
  editing: boolean;
  busy: boolean;
  actionError?: string;
  onToggleEdit: () => void;
  onSaved: () => void;
  onArchiveChange: (archived: boolean) => void;
}

function RoleRow({
  role,
  selected,
  token,
  editing,
  busy,
  actionError,
  onToggleEdit,
  onSaved,
  onArchiveChange,
}: RoleRowProps) {
  return (
    <li className={`rounded-md border border-zinc-200 p-4 dark:border-zinc-800 ${selected ? "" : "lg:hidden"}`}>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{role.name}</h2>
        <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          {role.archived ? adminRolesCopy.statusArchived : adminRolesCopy.statusActive}
        </span>
      </div>
      {(
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{role.description}</p>
      )}

      {editing ? (
        <div className="mt-4">
          <RoleForm
            token={token}
            role={role}
            onSaved={onSaved}
            onCancel={onToggleEdit}
          />
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={role.archived || busy}
            aria-expanded={editing}
            aria-label={`${adminRolesCopy.editRole} ${role.name}`}
            onClick={onToggleEdit}
          >
            {adminRolesCopy.editRole}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy}
            aria-label={`${role.archived ? adminRolesCopy.restoreRole : adminRolesCopy.archiveRole} ${role.name}`}
            onClick={() => onArchiveChange(!role.archived)}
          >
            {role.archived ? adminRolesCopy.restoreRole : adminRolesCopy.archiveRole}
          </Button>
        </div>
      )}
      {actionError !== undefined && <Alert variant="error">{actionError}</Alert>}
    </li>
  );
}

function SignInPrompt() {
  return (
    <p className="text-zinc-600 dark:text-zinc-400">
      {adminRolesCopy.signInPrompt}{" "}
      <Link href="/sign-in" className="font-medium text-zinc-900 underline dark:text-zinc-50">
        {adminRolesCopy.signInLink}
      </Link>{" "}
      {adminRolesCopy.signInSuffix}
    </p>
  );
}
