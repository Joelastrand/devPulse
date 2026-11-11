"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useAuthGatedResource } from "../../auth/client/use-auth-gated-resource";
import { SELF_ASSESSED_LEVEL_COPY } from "../../skill-profiles/copy";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import { LoadingState } from "../../../components/ui/LoadingState";
import { TextArea } from "../../../components/ui/TextArea";
import { TextField } from "../../../components/ui/TextField";
import { teamSkillsCopy } from "../copy";
import type { TeamSkillGuidance } from "../domain/team-skill";
import {
  createTeamSkill,
  fetchTeamSkills,
  updateTeamSkill,
  type TeamSkillsListResult,
  type TeamSkillView,
} from "../client/team-skills-gateway";

type Notice = { variant: "success" | "error"; text: string } | null;

function errorText(status: string): string {
  return (teamSkillsCopy.errors as Record<string, string>)[status] ?? teamSkillsCopy.errors.write_failed;
}

interface DraftValues {
  name: string;
  description: string;
  category: string;
  guidance: Record<"1" | "2" | "3" | "4", string>;
}

function draftFrom(skill: TeamSkillView | null): DraftValues {
  return {
    name: skill?.name ?? "",
    description: skill?.description ?? "",
    category: skill?.category ?? "",
    guidance: {
      "1": skill?.guidance["1"] ?? "",
      "2": skill?.guidance["2"] ?? "",
      "3": skill?.guidance["3"] ?? "",
      "4": skill?.guidance["4"] ?? "",
    },
  };
}

function guidanceOf(draft: DraftValues): TeamSkillGuidance {
  const out: TeamSkillGuidance = {};
  for (const key of ["1", "2", "3", "4"] as const) {
    const text = draft.guidance[key].trim();
    if (text.length > 0) out[key] = text;
  }
  return out;
}

/**
 * Administration of a team's own skill definitions (docs/features/team-owned-skills/SPEC.md §4). The list is loaded for
 * the signed-in user; `canEdit` only shows or hides controls. The server re-checks every write.
 */
export function TeamSkillsAdmin({ teamId }: { teamId: string }) {
  const [result, setResult] = useState<TeamSkillsListResult | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [editing, setEditing] = useState<"new" | string | null>(null);
  const [draft, setDraft] = useState<DraftValues>(draftFrom(null));
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);

  useAuthGatedResource((nextToken) => {
    setToken(nextToken);
    setResult(null);
    if (nextToken === null) {
      setResult({ status: "unauthenticated" });
      return;
    }
    void fetchTeamSkills(nextToken, teamId).then(setResult);
  }, [teamId, generation]);

  function reload() {
    setGeneration((value) => value + 1);
  }

  function startEdit(skill: TeamSkillView | null) {
    setEditing(skill === null ? "new" : skill.skillId);
    setDraft(draftFrom(skill));
    setNotice(null);
  }

  async function save(event: FormEvent<HTMLFormElement>, skill: TeamSkillView | null) {
    event.preventDefault();
    if (token === null || busy) return;
    setBusy(true);
    const body = { name: draft.name.trim(), description: draft.description.trim(), category: draft.category.trim() || null, guidance: guidanceOf(draft) };
    const outcome =
      skill === null
        ? await createTeamSkill(token, teamId, { ...body, category: draft.category.trim() })
        : await updateTeamSkill(token, teamId, skill.skillId, body);
    setBusy(false);
    if (outcome.status === "ok") {
      setEditing(null);
      setNotice({ variant: "success", text: skill === null ? teamSkillsCopy.createdNotice : teamSkillsCopy.savedNotice });
      reload();
      return;
    }
    setNotice({ variant: "error", text: errorText(outcome.status) });
  }

  async function setActive(skill: TeamSkillView, active: boolean) {
    if (token === null || busy) return;
    setBusy(true);
    const outcome = await updateTeamSkill(token, teamId, skill.skillId, { active });
    setBusy(false);
    if (outcome.status === "ok") {
      setNotice({ variant: "success", text: active ? teamSkillsCopy.reactivatedNotice : teamSkillsCopy.deactivatedNotice });
      reload();
      return;
    }
    setNotice({ variant: "error", text: errorText(outcome.status) });
  }

  if (result === null) return <LoadingState label={teamSkillsCopy.loading} />;
  if (result.status !== "ok") return <Alert variant="error">{errorText(result.status)}</Alert>;

  const active = result.skills.filter((skill) => skill.active);
  const inactive = result.skills.filter((skill) => !skill.active);

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-text-secondary">{teamSkillsCopy.intro}</p>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="font-medium text-text-primary">{teamSkillsCopy.activeCount(active.length)}</span>
        <span className="text-text-secondary">{teamSkillsCopy.inactiveCount(inactive.length)}</span>
        {result.canEdit && editing === null ? (
          <Button size="sm" className="ml-auto" onClick={() => startEdit(null)}>
            {teamSkillsCopy.createButton}
          </Button>
        ) : null}
      </div>
      {!result.canEdit ? <Alert variant="info">{teamSkillsCopy.readOnlyNotice}</Alert> : null}
      {notice ? <Alert variant={notice.variant === "success" ? "success" : "error"}>{notice.text}</Alert> : null}

      {editing === "new" && result.canEdit ? (
        <SkillForm title={teamSkillsCopy.createHeading} draft={draft} setDraft={setDraft} busy={busy} onSubmit={(event) => save(event, null)} onCancel={() => setEditing(null)} />
      ) : null}

      <SkillGroup title={teamSkillsCopy.activeGroup} empty={teamSkillsCopy.emptyActive}>
        {active.map((skill) =>
          editing === skill.skillId && result.canEdit ? (
            <SkillForm key={skill.skillId} title={teamSkillsCopy.editHeading} draft={draft} setDraft={setDraft} busy={busy} onSubmit={(event) => save(event, skill)} onCancel={() => setEditing(null)} />
          ) : (
            <SkillRow key={skill.skillId} skill={skill} canEdit={result.canEdit} busy={busy} onEdit={() => startEdit(skill)} onToggle={() => setActive(skill, false)} />
          ),
        )}
      </SkillGroup>

      {inactive.length > 0 ? (
        <SkillGroup title={teamSkillsCopy.inactiveGroup} note={teamSkillsCopy.inactiveNote} empty={teamSkillsCopy.emptyInactive}>
          {inactive.map((skill) => (
            <SkillRow key={skill.skillId} skill={skill} canEdit={result.canEdit} busy={busy} onEdit={() => startEdit(skill)} onToggle={() => setActive(skill, true)} />
          ))}
        </SkillGroup>
      ) : null}
    </div>
  );
}

function SkillGroup({ title, note, empty, children }: { title: string; note?: string; empty: string; children: ReactNode }) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : [];
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">{title}</h3>
      {note ? <p className="text-sm text-text-secondary">{note}</p> : null}
      {items.length === 0 ? <EmptyState>{empty}</EmptyState> : <ul className="flex flex-col gap-2">{items}</ul>}
    </section>
  );
}

function SkillRow({
  skill,
  canEdit,
  busy,
  onEdit,
  onToggle,
}: {
  skill: TeamSkillView;
  canEdit: boolean;
  busy: boolean;
  onEdit: () => void;
  onToggle: () => void;
}) {
  const guidanceCount = Object.keys(skill.guidance).length;
  return (
    <Card as="li" padding="sm" variant="bordered" className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1">
        <p className="break-words font-medium text-text-primary">{skill.name}</p>
        {skill.description ? <p className="break-words text-sm text-text-secondary">{skill.description}</p> : null}
        <p className="text-xs text-text-secondary">
          {skill.category ? `${skill.category} · ` : ""}
          {guidanceCount === 0 ? teamSkillsCopy.own.criteriaGuidanceNone : `${guidanceCount} av 4 nivåer har veiledning`}
        </p>
      </div>
      {canEdit ? (
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={onEdit} disabled={busy}>
            {teamSkillsCopy.editButton}
          </Button>
          <Button size="sm" variant="tertiary" onClick={onToggle} disabled={busy}>
            {skill.active ? teamSkillsCopy.deactivateButton : teamSkillsCopy.reactivateButton}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

function SkillForm({
  title,
  draft,
  setDraft,
  busy,
  onSubmit,
  onCancel,
}: {
  title: string;
  draft: DraftValues;
  setDraft: (next: DraftValues) => void;
  busy: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}) {
  return (
    <Card as="section" padding="md" variant="elevated" aria-label={title}>
      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <h3 className="text-base font-semibold text-text-primary">{title}</h3>
        <TextField id="team-skill-name" label={teamSkillsCopy.nameLabel} description={teamSkillsCopy.nameDescription} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} maxLength={80} required />
        <TextArea id="team-skill-description" label={teamSkillsCopy.descriptionLabel} optional value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} maxLength={500} />
        <TextField id="team-skill-category" label={teamSkillsCopy.categoryLabel} optional description={teamSkillsCopy.categoryDescription} value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })} maxLength={60} />
        <fieldset className="flex flex-col gap-3">
          <legend className="text-sm font-semibold text-text-primary">{teamSkillsCopy.guidanceHeading}</legend>
          <p className="text-sm text-text-secondary">{teamSkillsCopy.guidanceDescription}</p>
          {(["1", "2", "3", "4"] as const).map((key) => {
            const level = Number(key) as 1 | 2 | 3 | 4;
            return (
              <TextArea
                key={key}
                id={`team-skill-guidance-${key}`}
                label={teamSkillsCopy.guidanceLabel(level, SELF_ASSESSED_LEVEL_COPY[level].name)}
                optional
                value={draft.guidance[key]}
                onChange={(event) => setDraft({ ...draft, guidance: { ...draft.guidance, [key]: event.target.value } })}
                maxLength={300}
              />
            );
          })}
        </fieldset>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy} pending={busy}>
            {busy ? teamSkillsCopy.savingButton : teamSkillsCopy.saveButton}
          </Button>
          <Button type="button" variant="tertiary" onClick={onCancel} disabled={busy}>
            {teamSkillsCopy.cancelButton}
          </Button>
        </div>
      </form>
    </Card>
  );
}
