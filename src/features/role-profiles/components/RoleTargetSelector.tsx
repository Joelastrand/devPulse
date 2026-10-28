"use client";

import { useState, type FormEvent } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { Select } from "../../../components/ui/Select";
import type { CatalogRoleView } from "../client/role-target-gateway";
import { personRoleCopy } from "../copy";

interface RoleTargetSelectorProps {
  /** Only roles the server marks `selectable` are offered (PG-2). */
  roles: CatalogRoleView[];
  selectedRoleId?: string;
  /** Resolves to `undefined` on success, or the user-facing message to show. */
  onSelect: (roleId: string) => Promise<string | undefined>;
  onCancel?: () => void;
}

/** The person's target-role choice. Only the selected role id is sent; the server re-checks every rule. */
export function RoleTargetSelector({ roles, selectedRoleId, onSelect, onCancel }: RoleTargetSelectorProps) {
  const [selected, setSelected] = useState(selectedRoleId ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || selected === "") return;
    setPending(true);
    setError(await onSelect(selected));
    setPending(false);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <Select
        id="role-target-select"
        label={personRoleCopy.chooseRole}
        value={selected}
        onChange={(event) => setSelected(event.target.value)}
      >
        <option value="">{personRoleCopy.selectPlaceholder}</option>
        {roles.map((role) => (
          <option key={role.roleId} value={role.roleId}>
            {role.name}
          </option>
        ))}
      </Select>
      {error !== undefined && <Alert variant="error">{error}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" pending={pending} disabled={pending || selected === ""}>
          {personRoleCopy.selectRole}
        </Button>
        {onCancel !== undefined && (
          <Button type="button" variant="secondary" onClick={onCancel}>
            {personRoleCopy.cancel}
          </Button>
        )}
      </div>
    </form>
  );
}
