"use client";

import { useState, type FormEvent } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { TextArea } from "../../../components/ui/TextArea";
import { TextField } from "../../../components/ui/TextField";
import type { AdminSkillTreeEntry } from "../../skill-trees/client/skill-trees-gateway";
import {
  normalizeRoleDescription,
  normalizeRoleName,
  validateRoleExpectations,
} from "../domain/role-definition";
import {
  createAdminRole,
  updateAdminRole,
  type AdminRoleExpectationInput,
  type AdminRoleView,
  type UpdateAdminRoleInput,
} from "../client/roles-gateway";
import { adminRolesCopy, roleErrorMessage } from "../copy";
import { ExpectationsEditor, type DraftExpectation } from "./ExpectationsEditor";

interface RoleFormProps {
  /** The verified-session token for the admin write (the server re-authorizes every call). */
  token: string;
  /** The role being edited, or `undefined` to create. */
  role?: AdminRoleView;
  catalog: AdminSkillTreeEntry[];
  catalogAvailable: boolean;
  onSaved: () => void;
  onCancel: () => void;
}

interface FormErrors {
  name?: string;
  description?: string;
  expectations?: string;
  form?: string;
}

function sameExpectations(next: AdminRoleExpectationInput[], current: AdminRoleView["expectations"]): boolean {
  return (
    next.length === current.length &&
    next.every((row, index) => row.treeId === current[index].treeId && row.expectedLevel === current[index].expectedLevel)
  );
}

/**
 * Create and edit form for one role (SPEC "Navigation and UX", PG-6, PG-10). Client validation reuses the domain rules,
 * so it cannot drift from the server, and the server stays authoritative. Edit sends only the changed fields. Creating
 * with zero expectations is allowed (BR-3). The personal-name notice is shown in the form.
 */
export function RoleForm({ token, role, catalog, catalogAvailable, onSaved, onCancel }: RoleFormProps) {
  const copy = adminRolesCopy.form;
  const idPrefix = role ? `edit-role-${role.roleId}` : "create-role";
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [expectations, setExpectations] = useState<DraftExpectation[]>(
    role ? role.expectations.map(({ treeId, expectedLevel }) => ({ treeId, expectedLevel })) : [],
  );
  const [errors, setErrors] = useState<FormErrors>({});
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !catalogAvailable) return;

    const nameResult = normalizeRoleName(name);
    const descriptionResult = normalizeRoleDescription(description);
    const expectationsResult = validateRoleExpectations(expectations);
    const nextErrors: FormErrors = {
      ...(nameResult.ok ? {} : { name: copy.nameError }),
      ...(descriptionResult.ok ? {} : { description: copy.descriptionError }),
      ...(expectationsResult.ok ? {} : { expectations: copy.expectationsError }),
    };
    if (!nameResult.ok || !descriptionResult.ok || !expectationsResult.ok) {
      setErrors(nextErrors);
      return;
    }
    setErrors({});

    if (role === undefined) {
      setPending(true);
      const created = await createAdminRole(token, {
        name: nameResult.name,
        ...(descriptionResult.description !== undefined ? { description: descriptionResult.description } : {}),
        expectations: expectationsResult.expectations,
      });
      setPending(false);
      if (created.ok) onSaved();
      else setErrors({ form: roleErrorMessage(created.error) });
      return;
    }

    const patch: UpdateAdminRoleInput = {};
    if (nameResult.name !== role.name) patch.name = nameResult.name;
    if (descriptionResult.description !== role.description) patch.description = descriptionResult.description ?? "";
    if (!sameExpectations(expectationsResult.expectations, role.expectations)) {
      patch.expectations = expectationsResult.expectations;
    }
    if (Object.keys(patch).length === 0) {
      onCancel();
      return;
    }

    setPending(true);
    const updated = await updateAdminRole(token, role.roleId, patch);
    setPending(false);
    if (updated.ok) onSaved();
    else setErrors({ form: roleErrorMessage(updated.error) });
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      aria-labelledby={`${idPrefix}-heading`}
      className="flex flex-col gap-5 rounded-md border border-zinc-200 p-4 dark:border-zinc-800"
    >
      <h2 id={`${idPrefix}-heading`} className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
        {role ? copy.editHeading(role.name) : copy.createHeading}
      </h2>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{adminRolesCopy.notice}</p>

      <TextField
        id={`${idPrefix}-name`}
        label={copy.nameLabel}
        description={copy.nameHint}
        value={name}
        onChange={(event) => setName(event.target.value)}
        error={errors.name}
        autoComplete="off"
      />
      <TextArea
        id={`${idPrefix}-description`}
        label={copy.descriptionLabel}
        description={copy.descriptionHint}
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        error={errors.description}
        rows={3}
      />

      {catalogAvailable ? (
        <ExpectationsEditor
          idPrefix={idPrefix}
          value={expectations}
          catalog={catalog}
          error={errors.expectations}
          onChange={setExpectations}
        />
      ) : (
        <Alert variant="error">{copy.noCatalog}</Alert>
      )}

      {errors.form !== undefined && <Alert variant="error">{errors.form}</Alert>}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" pending={pending} disabled={pending || !catalogAvailable}>
          {pending ? adminRolesCopy.saving : adminRolesCopy.save}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          {adminRolesCopy.cancel}
        </Button>
      </div>
    </form>
  );
}
