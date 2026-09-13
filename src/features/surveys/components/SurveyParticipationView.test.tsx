// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const observeIdTokenMock = vi.fn();
const fetchSurveyParticipationMock = vi.fn();

vi.mock("../../auth/client/auth-client", () => ({
  observeIdToken: observeIdTokenMock,
}));

vi.mock("../client/survey-participation-gateway", () => ({
  fetchSurveyParticipation: fetchSurveyParticipationMock,
}));

const { SurveyParticipationView } = await import("./SurveyParticipationView");

/** Simulates the auth subscription immediately emitting one token value on every (re-)subscribe. */
function subscribingWith(token: string | null) {
  return (callback: (token: string | null) => void) => {
    callback(token);
    return () => {};
  };
}

/** Captures the `observeIdToken` callback so a test can fire multiple auth events at will. */
function capturingObserver() {
  let callback: ((token: string | null) => void) | null = null;
  observeIdTokenMock.mockImplementation((cb: (token: string | null) => void) => {
    callback = cb;
    return () => {};
  });
  return {
    emit(token: string | null) {
      callback?.(token);
    },
  };
}

/** Queues one manually-resolvable promise per call, in call order. */
function queuedCalls(mock: ReturnType<typeof vi.fn>) {
  const resolvers: Array<(value: unknown) => void> = [];
  mock.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolvers.push(resolve);
      }),
  );
  return {
    resolve(callIndex: number, value: unknown) {
      resolvers[callIndex](value);
    },
  };
}

function flushMicrotasks() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("SurveyParticipationView", () => {
  afterEach(() => {
    cleanup();
    observeIdTokenMock.mockReset();
    fetchSurveyParticipationMock.mockReset();
  });

  it("shows a Norwegian loading state before auth resolves, and never fetches yet", () => {
    observeIdTokenMock.mockImplementation(() => () => {});

    render(<SurveyParticipationView surveyId="survey-1" />);

    expect(screen.getByRole("status").textContent).toMatch(/laster/i);
    expect(fetchSurveyParticipationMock).not.toHaveBeenCalled();
  });

  it("resolves a public survey without any token, and asks the server with none", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith(null));
    fetchSurveyParticipationMock.mockResolvedValue({
      status: "answerable",
      survey: { surveyId: "survey-1" },
    });

    render(<SurveyParticipationView surveyId="survey-1" />);

    await screen.findByRole("group", { name: /arbeidsflyt/i });
    expect(fetchSurveyParticipationMock).toHaveBeenCalledWith("survey-1", undefined);
  });

  it("shows a not-found notice for an unknown surveyId", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith(null));
    fetchSurveyParticipationMock.mockResolvedValue({ status: "not_found" });

    render(<SurveyParticipationView surveyId="survey-1" />);

    const alert = await screen.findByText(/finnes ikke/i);
    expect(alert.getAttribute("role")).toBe("status");
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("shows only a sign-in prompt for a signed-out authenticated survey — no title, team name, or form", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith(null));
    fetchSurveyParticipationMock.mockResolvedValue({ status: "sign_in_required" });

    render(<SurveyParticipationView surveyId="survey-1" />);

    const link = await screen.findByRole("link", { name: /logg inn/i });
    expect(link.getAttribute("href")).toBe("/sign-in?continue=%2Fsurvey%2Fsurvey-1");
    expect(screen.queryByRole("group")).toBeNull();
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("shows a non-sensitive forbidden notice for a signed-in non-member", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchSurveyParticipationMock.mockResolvedValue({ status: "forbidden" });

    render(<SurveyParticipationView surveyId="survey-1" />);

    const alert = await screen.findByText(/ikke tilgang/i);
    expect(alert.getAttribute("role")).toBe("status");
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("shows title/team name and a not-yet-started notice for a scheduled survey, with no form", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith(null));
    fetchSurveyParticipationMock.mockResolvedValue({
      status: "scheduled",
      survey: { surveyId: "survey-1", title: "Uke 36", teamName: "Platform" },
    });

    render(<SurveyParticipationView surveyId="survey-1" />);

    expect(await screen.findByRole("heading", { name: "Uke 36" })).toBeTruthy();
    expect(screen.getByText("Platform")).toBeTruthy();
    expect(screen.getByText(/ikke startet ennå/i)).toBeTruthy();
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("shows title/team name and a closed notice for a closed survey, with no form", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith(null));
    fetchSurveyParticipationMock.mockResolvedValue({
      status: "closed",
      survey: { surveyId: "survey-1", title: "Uke 36", teamName: "Platform" },
    });

    render(<SurveyParticipationView surveyId="survey-1" />);

    expect(await screen.findByText(/avsluttet/i)).toBeTruthy();
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("renders the fallback title when a survey has none", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith(null));
    fetchSurveyParticipationMock.mockResolvedValue({
      status: "answerable",
      survey: { surveyId: "survey-1" },
    });

    render(<SurveyParticipationView surveyId="survey-1" />);

    expect(await screen.findByRole("heading", { name: "Undersøkelse" })).toBeTruthy();
  });

  it("renders the answer form only for the answerable outcome", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith(null));
    fetchSurveyParticipationMock.mockResolvedValue({
      status: "answerable",
      survey: { surveyId: "survey-1", title: "Uke 36", teamName: "Platform" },
    });

    render(<SurveyParticipationView surveyId="survey-1" />);

    expect(await screen.findByRole("group", { name: /arbeidsflyt/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /send inn/i })).toBeTruthy();
  });

  it("shows a generic Norwegian read-failure notice on a server read failure", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith(null));
    fetchSurveyParticipationMock.mockResolvedValue({ status: "read_failed" });

    render(<SurveyParticipationView surveyId="survey-1" />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/noe gikk galt/i);
  });

  it("unsubscribes from id token updates on unmount", () => {
    const unsubscribe = vi.fn();
    observeIdTokenMock.mockImplementation(() => unsubscribe);

    const { unmount } = render(<SurveyParticipationView surveyId="survey-1" />);
    unmount();

    expect(unsubscribe).toHaveBeenCalled();
  });

  it("contains no leftover English copy", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith(null));
    fetchSurveyParticipationMock.mockResolvedValue({ status: "not_found" });

    render(<SurveyParticipationView surveyId="survey-1" />);
    await screen.findByText(/finnes ikke/i);

    expect(screen.queryByText(/not found/i)).toBeNull();
    expect(screen.queryByText(/^sign in$/i)).toBeNull();
  });
});

describe("SurveyParticipationView auth/route races", () => {
  afterEach(() => {
    cleanup();
    observeIdTokenMock.mockReset();
    fetchSurveyParticipationMock.mockReset();
  });

  it("ignores a stale result that resolves after the user has signed out", async () => {
    const observer = capturingObserver();
    const calls = queuedCalls(fetchSurveyParticipationMock);

    render(<SurveyParticipationView surveyId="survey-1" />);
    observer.emit("token-a");
    await waitFor(() => expect(fetchSurveyParticipationMock).toHaveBeenCalledTimes(1));

    observer.emit(null);
    await waitFor(() => expect(fetchSurveyParticipationMock).toHaveBeenCalledTimes(2));

    calls.resolve(0, { status: "answerable", survey: { surveyId: "survey-1", title: "Stale" } });
    await flushMicrotasks();

    expect(screen.queryByText("Stale")).toBeNull();
  });

  it("does not update state after unmount even if a pending fetch resolves later", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const observer = capturingObserver();
    const calls = queuedCalls(fetchSurveyParticipationMock);

    const { unmount } = render(<SurveyParticipationView surveyId="survey-1" />);
    observer.emit("token-a");
    await waitFor(() => expect(fetchSurveyParticipationMock).toHaveBeenCalledTimes(1));

    unmount();

    expect(() =>
      calls.resolve(0, { status: "answerable", survey: { surveyId: "survey-1" } }),
    ).not.toThrow();
    await flushMicrotasks();

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("ignores survey A's stale result once the route has changed to survey B", async () => {
    let resolveSurveyA: (value: unknown) => void = () => {};
    observeIdTokenMock.mockImplementation(subscribingWith(null));
    fetchSurveyParticipationMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSurveyA = resolve;
          }),
      )
      .mockResolvedValue({ status: "answerable", survey: { surveyId: "survey-b", title: "Survey B" } });

    const { rerender } = render(<SurveyParticipationView surveyId="survey-a" />);
    rerender(<SurveyParticipationView surveyId="survey-b" />);

    await screen.findByRole("heading", { name: "Survey B" });

    resolveSurveyA({ status: "answerable", survey: { surveyId: "survey-a", title: "Survey A" } });
    await flushMicrotasks();

    expect(screen.queryByText("Survey A")).toBeNull();
    expect(screen.getByRole("heading", { name: "Survey B" })).toBeTruthy();
  });
});
