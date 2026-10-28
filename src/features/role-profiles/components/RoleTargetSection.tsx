"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { LoadingState } from "../../../components/ui/LoadingState";
import { useAuthGatedResource } from "../../auth/client/use-auth-gated-resource";
import {
  clearOwnRoleTarget,
  fetchOwnRoleTarget,
  fetchRoleCatalog,
  fetchRoleComparison,
  setOwnRoleTarget,
  type CatalogRoleView,
  type FetchComparisonResult,
  type RoleTargetView,
} from "../client/role-target-gateway";
import { personRoleCopy, targetErrorMessage } from "../copy";
import { ComparisonRows } from "./ComparisonRows";
import { RoleTargetSelector } from "./RoleTargetSelector";

interface LoadedState {
  phase: "loaded";
  token: string;
  generation: number;
  target: RoleTargetView;
  roles: CatalogRoleView[];
  /** The comparison is read separately: its failure is shown in its own area and never hides the target. */
  comparison: FetchComparisonResult;
}

type ViewState = { phase: "loading" } | { phase: "signed_out" } | { phase: "error" } | LoadedState;

/**
 * The person's role section on `/me/skills` (SPEC "Navigation and UX", PG-2, PG-3, PG-4). Shows the target and its states,
 * lets the owner select, change or clear it, and shows the owner's own comparison rows. It never shows another person's
 * data. Every call is authorized by the server from the verified token; this component decides nothing about access.
 */
export function RoleTargetSection() {
  const [state, setState] = useState<ViewState>({ phase: "loading" });
  const [editing, setEditing] = useState(false);
  const [clearError, setClearError] = useState<string>();
  const isCurrentRef = useRef<((generation: number) => boolean) | null>(null);

  useAuthGatedResource((token, generation, isCurrentGeneration) => {
    isCurrentRef.current = isCurrentGeneration;
    setEditing(false);
    setClearError(undefined);
    if (!token) {
      setState({ phase: "signed_out" });
      return;
    }
    setState({ phase: "loading" });
    void Promise.all([fetchOwnRoleTarget(token), fetchRoleCatalog(token), fetchRoleComparison(token)]).then(
      ([target, catalog, comparison]) => {
        if (!isCurrentGeneration(generation)) return;
        if (target.status === "unauthenticated" || catalog.status === "unauthenticated") {
          setState({ phase: "signed_out" });
          return;
        }
        if (target.status !== "ok" || catalog.status !== "ok") {
          setState({ phase: "error" });
          return;
        }
        setState({ phase: "loaded", token, generation, target: target.view, roles: catalog.roles, comparison });
      },
    );
  });

  /** Reloads the target, catalog and comparison after a change, for the same auth generation only. */
  function refresh(loaded: LoadedState) {
    void Promise.all([
      fetchOwnRoleTarget(loaded.token),
      fetchRoleCatalog(loaded.token),
      fetchRoleComparison(loaded.token),
    ]).then(([target, catalog, comparison]) => {
      if (!isCurrentRef.current?.(loaded.generation)) return;
      if (target.status !== "ok" || catalog.status !== "ok") {
        setState({ phase: "error" });
        return;
      }
      setState({ ...loaded, target: target.view, roles: catalog.roles, comparison });
    });
  }

  async function selectRole(loaded: LoadedState, roleId: string): Promise<string | undefined> {
    const result = await setOwnRoleTarget(loaded.token, roleId);
    if (!result.ok) return targetErrorMessage(result.error);
    setEditing(false);
    refresh(loaded);
    return undefined;
  }

  async function clearRole(loaded: LoadedState) {
    setClearError(undefined);
    const result = await clearOwnRoleTarget(loaded.token);
    if (result.ok) refresh(loaded);
    else setClearError(targetErrorMessage(result.error));
  }

  return (
    <section aria-labelledby="role-target-heading" className="mt-10 flex flex-col gap-4">
      <h2 id="role-target-heading" className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        {personRoleCopy.sectionHeading}
      </h2>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{personRoleCopy.sectionDescription}</p>

      {state.phase === "loading" && <LoadingState label={personRoleCopy.loading} />}
      {state.phase === "signed_out" && <SignInPrompt />}
      {state.phase === "error" && <Alert variant="error">{personRoleCopy.readFailed}</Alert>}
      {state.phase === "loaded" && (
        <TargetContent
          loaded={state}
          editing={editing}
          clearError={clearError}
          onStartEdit={() => setEditing(true)}
          onStopEdit={() => setEditing(false)}
          onSelect={(roleId) => selectRole(state, roleId)}
          onClear={() => void clearRole(state)}
        />
      )}
    </section>
  );
}

interface TargetContentProps {
  loaded: LoadedState;
  editing: boolean;
  clearError?: string;
  onStartEdit: () => void;
  onStopEdit: () => void;
  onSelect: (roleId: string) => Promise<string | undefined>;
  onClear: () => void;
}

function TargetContent({ loaded, editing, clearError, onStartEdit, onStopEdit, onSelect, onClear }: TargetContentProps) {
  const selectable = loaded.roles.filter((role) => role.selectable);
  const target = loaded.target;
  const selectedRole = target.status === "selected" ? loaded.roles.find((role) => role.roleId === target.target.roleId) : undefined;
  const showSelector = editing || target.status === "none";

  return (
    <div className="flex flex-col gap-4">
      {target.status === "none" && <p className="text-zinc-800 dark:text-zinc-200">{personRoleCopy.noTarget}</p>}

      {target.status === "unavailable" && <Alert variant="error">{personRoleCopy.unavailable}</Alert>}

      {target.status === "selected" && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <p className="text-zinc-800 dark:text-zinc-200">
              <span className="font-medium">{target.target.name}</span>
            </p>
            {target.target.archived && <Alert variant="error">{personRoleCopy.archived}</Alert>}
            {!target.target.archived && selectedRole !== undefined && selectedRole.expectations.length === 0 && (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">{personRoleCopy.noExpectations}</p>
            )}
          </div>
          {loaded.comparison.status === "ok" ? (
            <ComparisonRows comparison={loaded.comparison.view} />
          ) : (
            <Alert variant="error">{personRoleCopy.comparison.readFailed}</Alert>
          )}
        </div>
      )}

      {showSelector &&
        (selectable.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{personRoleCopy.noRoles}</p>
        ) : (
          <RoleTargetSelector
            roles={selectable}
            selectedRoleId={target.status === "selected" ? target.target.roleId : undefined}
            onSelect={onSelect}
            onCancel={target.status === "none" ? undefined : onStopEdit}
          />
        ))}

      {!showSelector && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={onStartEdit}>
            {personRoleCopy.changeRole}
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={onClear}>
            {personRoleCopy.clearRole}
          </Button>
        </div>
      )}
      {clearError !== undefined && <Alert variant="error">{clearError}</Alert>}
    </div>
  );
}

function SignInPrompt() {
  return (
    <p className="text-zinc-600 dark:text-zinc-400">
      {personRoleCopy.signInPrompt}{" "}
      <Link href="/sign-in" className="font-medium text-zinc-900 underline dark:text-zinc-50">
        {personRoleCopy.signInLink}
      </Link>{" "}
      {personRoleCopy.signInSuffix}
    </p>
  );
}
