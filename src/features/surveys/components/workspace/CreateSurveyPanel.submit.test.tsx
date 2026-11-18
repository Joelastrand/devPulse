// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { CreateSurveyPanel } from "./CreateSurveyPanel";

const createAdminSurvey = vi.fn();

vi.mock("../../client/admin-survey-gateway", () => ({
  createAdminSurvey: (...args: unknown[]) => createAdminSurvey(...args),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function formOf(container: HTMLElement): HTMLFormElement {
  const form = container.querySelector("form");
  if (!form) throw new Error("no form");
  return form;
}

describe("CreateSurveyPanel submission", () => {
  afterEach(() => {
    cleanup();
    createAdminSurvey.mockReset();
  });

  it("sends one create request when the form is submitted again while the first is in flight", async () => {
    const pending = deferred<{ ok: true; surveyId: string }>();
    createAdminSurvey.mockReturnValue(pending.promise);
    const onCreated = vi.fn();
    const { container } = render(<CreateSurveyPanel teamId="team-1" token="token-a" onCreated={onCreated} onCancel={() => undefined} />);

    fireEvent.submit(formOf(container));
    fireEvent.submit(formOf(container));
    expect(createAdminSurvey).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve({ ok: true, surveyId: "s1" });
    });
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("s1"));
  });

  it("does not open the created survey for a superseded identity whose create response arrives late", async () => {
    const pending = deferred<{ ok: true; surveyId: string }>();
    createAdminSurvey.mockReturnValue(pending.promise);
    const onCreated = vi.fn();
    const { container, rerender } = render(
      <CreateSurveyPanel teamId="team-1" token="token-a" onCreated={onCreated} onCancel={() => undefined} />,
    );
    fireEvent.submit(formOf(container));

    rerender(<CreateSurveyPanel teamId="team-1" token="token-b" onCreated={onCreated} onCancel={() => undefined} />);
    await act(async () => {
      pending.resolve({ ok: true, surveyId: "s1" });
    });

    // The write was sent for the first identity, and its success still did not open anything for the second.
    expect(createAdminSurvey).toHaveBeenCalledWith("token-a", "team-1", expect.anything());
    expect(onCreated).not.toHaveBeenCalled();
  });
});
