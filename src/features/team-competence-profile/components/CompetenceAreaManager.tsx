"use client";

import { useEffect, useId, useState } from "react";
import { COLLABORATIVE_PANEL_COPY } from "../copy";
import {
  assignTeamArea,
  setTeamAreaStatus,
  type CollaborativeWriteStatus,
  type TeamAreaView,
} from "../client/collaborative-gateway";
import { fetchSkillNeeds, type SkillCatalogEntry } from "../../team-skills/client/team-skills-gateway";

type AreaStatus = TeamAreaView["status"];
const STATUS_OPTIONS: readonly AreaStatus[] = ["active", "inactive", "archived"];

const STATUS_COPY: Record<AreaStatus, string> = {
  active: COLLABORATIVE_PANEL_COPY.statusActive,
  inactive: COLLABORATIVE_PANEL_COPY.statusInactive,
  archived: COLLABORATIVE_PANEL_COPY.statusArchived,
};

interface CompetenceAreaManagerProps {
  readonly teamId: string;
  readonly token: string;
  readonly areas: readonly TeamAreaView[];
  readonly onChanged: () => void;
}

/** Teamadmin management of the team's competence areas: change status and add a catalog area. Server decides every write. */
export function CompetenceAreaManager({ teamId, token, areas, onChanged }: CompetenceAreaManagerProps) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-base font-semibold text-text-primary">{COLLABORATIVE_PANEL_COPY.areasHeading}</h3>
        <p className="text-sm text-text-secondary">{COLLABORATIVE_PANEL_COPY.areasIntro}</p>
      </div>
      {areas.length === 0 ? <p className="text-sm text-text-secondary">{COLLABORATIVE_PANEL_COPY.emptyAreas}</p> : null}
      <ul className="flex flex-col gap-2">
        {areas.map((area) => (
          <AreaStatusItem key={area.treeId} teamId={teamId} token={token} area={area} onChanged={onChanged} />
        ))}
      </ul>
      <AddAreaForm teamId={teamId} token={token} existing={areas} onChanged={onChanged} />
    </div>
  );
}

function AreaStatusItem({
  teamId,
  token,
  area,
  onChanged,
}: {
  readonly teamId: string;
  readonly token: string;
  readonly area: TeamAreaView;
  readonly onChanged: () => void;
}) {
  const selectId = useId();
  const [draft, setDraft] = useState<AreaStatus>(area.status);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | CollaborativeWriteStatus>("idle");
  const label = area.name ?? COLLABORATIVE_PANEL_COPY.unnamedArea;
  const dirty = draft !== area.status;

  async function handleSave() {
    setStatus("saving");
    const result = await setTeamAreaStatus(token, teamId, area.treeId, draft);
    if (result.status === "ok") {
      setStatus("saved");
      onChanged();
      return;
    }
    setStatus(result.status);
  }

  const failed = status !== "idle" && status !== "saving" && status !== "saved";

  return (
    <li className="flex flex-col gap-2 rounded-md border border-border-subtle bg-surface p-3 sm:flex-row sm:items-center sm:justify-between">
      <label htmlFor={selectId} className="font-medium text-text-primary">
        {label}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <select
          id={selectId}
          aria-label={COLLABORATIVE_PANEL_COPY.statusLabel(label)}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value as AreaStatus);
            setStatus("idle");
          }}
          disabled={status === "saving"}
          className="rounded-md border border-border-strong bg-surface px-2 py-1.5 text-sm text-text-primary"
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {STATUS_COPY[option]}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || status === "saving"}
          className="rounded-md border border-border-strong px-3 py-1.5 text-sm text-text-primary disabled:opacity-50"
        >
          {COLLABORATIVE_PANEL_COPY.areaSave}
        </button>
        {status === "saved" && !dirty ? (
          <span role="status" className="text-sm text-text-secondary">
            {COLLABORATIVE_PANEL_COPY.saved}
          </span>
        ) : null}
        {failed ? (
          <span role="alert" className="text-sm text-text-primary">
            {status === "conflict" ? COLLABORATIVE_PANEL_COPY.conflict : COLLABORATIVE_PANEL_COPY.saveFailed}
          </span>
        ) : null}
      </div>
    </li>
  );
}

type CatalogState = { phase: "loading" } | { phase: "ready"; entries: readonly SkillCatalogEntry[] } | { phase: "unavailable" };

function AddAreaForm({
  teamId,
  token,
  existing,
  onChanged,
}: {
  readonly teamId: string;
  readonly token: string;
  readonly existing: readonly TeamAreaView[];
  readonly onChanged: () => void;
}) {
  const selectId = useId();
  const [catalog, setCatalog] = useState<CatalogState>({ phase: "loading" });
  const [choice, setChoice] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | CollaborativeWriteStatus>("idle");

  useEffect(() => {
    let cancelled = false;
    void fetchSkillNeeds(token, teamId).then((result) => {
      if (cancelled) return;
      setCatalog(result.status === "ok" ? { phase: "ready", entries: result.catalog } : { phase: "unavailable" });
    });
    return () => {
      cancelled = true;
    };
  }, [token, teamId]);

  const assigned = new Set(existing.map((area) => area.treeId));
  const available = catalog.phase === "ready" ? catalog.entries.filter((entry) => !assigned.has(entry.treeId)) : [];

  async function handleAdd() {
    if (choice === "") return;
    setStatus("saving");
    const result = await assignTeamArea(token, teamId, choice);
    if (result.status === "ok") {
      setChoice("");
      setStatus("idle");
      onChanged();
      return;
    }
    setStatus(result.status);
  }

  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-sm font-semibold text-text-primary">{COLLABORATIVE_PANEL_COPY.addHeading}</h4>
      {catalog.phase === "unavailable" ? (
        <p className="text-sm text-text-secondary">{COLLABORATIVE_PANEL_COPY.catalogUnavailable}</p>
      ) : null}
      {catalog.phase === "ready" && available.length === 0 ? (
        <p className="text-sm text-text-secondary">{COLLABORATIVE_PANEL_COPY.addNone}</p>
      ) : null}
      {available.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={selectId} className="text-sm text-text-primary">
            {COLLABORATIVE_PANEL_COPY.addLabel}
          </label>
          <select
            id={selectId}
            value={choice}
            onChange={(event) => setChoice(event.target.value)}
            disabled={status === "saving"}
            className="rounded-md border border-border-strong bg-surface px-2 py-1.5 text-sm text-text-primary"
          >
            <option value="">—</option>
            {available.map((entry) => (
              <option key={entry.treeId} value={entry.treeId}>
                {entry.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleAdd}
            disabled={choice === "" || status === "saving"}
            className="rounded-md border border-border-strong px-3 py-1.5 text-sm text-text-primary disabled:opacity-50"
          >
            {COLLABORATIVE_PANEL_COPY.addButton}
          </button>
        </div>
      ) : null}
      {status !== "idle" && status !== "saving" ? (
        <p role="alert" className="text-sm text-text-primary">
          {status === "conflict" ? COLLABORATIVE_PANEL_COPY.conflict : COLLABORATIVE_PANEL_COPY.saveFailed}
        </p>
      ) : null}
    </div>
  );
}
