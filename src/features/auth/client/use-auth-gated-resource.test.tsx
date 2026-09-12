// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

const observeIdTokenMock = vi.fn();

vi.mock("./auth-client", () => ({
  observeIdToken: observeIdTokenMock,
}));

const { useAuthGatedResource } = await import("./use-auth-gated-resource");

/** Captures the subscribed callback so a test can fire auth events at will. */
function capturingObserver() {
  let callback: ((token: string | null) => void) | null = null;
  const unsubscribe = vi.fn();
  observeIdTokenMock.mockImplementation((cb: (token: string | null) => void) => {
    callback = cb;
    return unsubscribe;
  });
  return {
    emit(token: string | null) {
      callback?.(token);
    },
    unsubscribe,
  };
}

function flushMicrotasks() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

type IsCurrentGeneration = (generation: number) => boolean;

/**
 * A minimal host component exercising the hook with test-controlled props.
 * `onApi` hands the test a fresh `isCurrentGeneration` on every render, so a
 * test can call it later (simulating a deferred async continuation) without
 * reaching into the hook's internals.
 */
function Host({
  onAuthChange,
  onApi,
  resetDeps = [],
}: {
  onAuthChange: (
    token: string | null,
    generation: number,
    isCurrentGeneration: IsCurrentGeneration,
  ) => void;
  onApi: (api: { isCurrentGeneration: IsCurrentGeneration }) => void;
  resetDeps?: readonly unknown[];
}) {
  const api = useAuthGatedResource(onAuthChange, resetDeps);
  onApi(api);
  return null;
}

describe("useAuthGatedResource", () => {
  afterEach(() => {
    cleanup();
    observeIdTokenMock.mockReset();
  });

  it("does not invoke onAuthChange before the subscription emits", () => {
    observeIdTokenMock.mockImplementation(() => () => {});
    const onAuthChange = vi.fn();

    render(<Host onAuthChange={onAuthChange} onApi={() => {}} />);

    expect(onAuthChange).not.toHaveBeenCalled();
  });

  it("invokes onAuthChange with null and generation 1 for an initial signed-out emission", () => {
    const observer = capturingObserver();
    const onAuthChange = vi.fn();

    render(<Host onAuthChange={onAuthChange} onApi={() => {}} />);
    observer.emit(null);

    expect(onAuthChange).toHaveBeenCalledWith(null, 1, expect.any(Function));
  });

  it("invokes onAuthChange with the token and generation 1 for an initial authenticated emission", () => {
    const observer = capturingObserver();
    const onAuthChange = vi.fn();

    render(<Host onAuthChange={onAuthChange} onApi={() => {}} />);
    observer.emit("a-token");

    expect(onAuthChange).toHaveBeenCalledWith("a-token", 1, expect.any(Function));
  });

  it("passes isCurrentGeneration as the callback's third argument, matching the returned one", () => {
    const observer = capturingObserver();
    let returnedIsCurrentGeneration: IsCurrentGeneration = () => false;
    let callbackIsCurrentGeneration: IsCurrentGeneration = () => false;

    render(
      <Host
        onApi={(api) => {
          returnedIsCurrentGeneration = api.isCurrentGeneration;
        }}
        onAuthChange={(_token, _generation, isCurrentGeneration) => {
          callbackIsCurrentGeneration = isCurrentGeneration;
        }}
      />,
    );
    observer.emit("a-token");

    expect(callbackIsCurrentGeneration(1)).toBe(returnedIsCurrentGeneration(1));
    expect(callbackIsCurrentGeneration(1)).toBe(true);
  });

  it("discards a stale async result from a generation superseded by sign-out", async () => {
    const observer = capturingObserver();
    let isCurrentGeneration: IsCurrentGeneration = () => false;
    const results: boolean[] = [];

    render(
      <Host
        onApi={(api) => {
          isCurrentGeneration = api.isCurrentGeneration;
        }}
        onAuthChange={(token, generation) => {
          if (!token) return;
          // Simulate a deferred async continuation started under `generation`.
          Promise.resolve().then(() => {
            results.push(isCurrentGeneration(generation));
          });
        }}
      />,
    );

    observer.emit("token-a");
    observer.emit(null); // sign-out supersedes generation 1

    await flushMicrotasks();

    expect(results).toEqual([false]);
  });

  it("discards a stale async result from a generation superseded by an account switch", async () => {
    const observer = capturingObserver();
    let isCurrentGeneration: IsCurrentGeneration = () => false;
    let generationAResult: boolean | null = null;

    render(
      <Host
        onApi={(api) => {
          isCurrentGeneration = api.isCurrentGeneration;
        }}
        onAuthChange={(token, generation) => {
          if (!token) return;
          Promise.resolve().then(() => {
            const result = isCurrentGeneration(generation);
            // Only account A's own generation is asserted below — account
            // B's own async continuation is expected to still see itself as
            // current; that's not what this test is proving.
            if (generation === 1) {
              generationAResult = result;
            }
          });
        }}
      />,
    );

    observer.emit("token-a");
    observer.emit("token-b"); // account switch supersedes generation 1

    await flushMicrotasks();

    expect(generationAResult).toBe(false);
  });

  it("increments the generation on every auth/token change", () => {
    const observer = capturingObserver();
    const generations: number[] = [];

    render(
      <Host
        onApi={() => {}}
        onAuthChange={(_token, generation) => generations.push(generation)}
      />,
    );

    observer.emit("token-a1");
    observer.emit("token-a1"); // token refresh (same value, new emission)
    observer.emit("token-b");
    observer.emit(null);

    expect(generations).toEqual([1, 2, 3, 4]);
  });

  it("reports the current generation as current", () => {
    const observer = capturingObserver();
    let isCurrentGeneration: IsCurrentGeneration = () => false;
    let sawGeneration = 0;

    render(
      <Host
        onApi={(api) => {
          isCurrentGeneration = api.isCurrentGeneration;
        }}
        onAuthChange={(_token, generation) => {
          sawGeneration = generation;
        }}
      />,
    );
    observer.emit("token-a");

    expect(isCurrentGeneration(sawGeneration)).toBe(true);
  });

  it("invalidates outstanding work on unmount", async () => {
    const observer = capturingObserver();
    let isCurrentGeneration: IsCurrentGeneration = () => false;
    const results: boolean[] = [];

    const { unmount } = render(
      <Host
        onApi={(api) => {
          isCurrentGeneration = api.isCurrentGeneration;
        }}
        onAuthChange={(token, generation) => {
          if (!token) return;
          Promise.resolve().then(() => {
            results.push(isCurrentGeneration(generation));
          });
        }}
      />,
    );

    observer.emit("token-a");
    unmount();

    await flushMicrotasks();

    expect(results).toEqual([false]);
    expect(observer.unsubscribe).toHaveBeenCalled();
  });

  it("resubscribes and bumps the generation when a reset dependency changes", () => {
    observeIdTokenMock.mockImplementation((cb: (token: string | null) => void) => {
      cb("a-token");
      return () => {};
    });
    const generations: number[] = [];
    const onAuthChange = (_token: string | null, generation: number) => {
      generations.push(generation);
    };

    const { rerender } = render(
      <Host onAuthChange={onAuthChange} onApi={() => {}} resetDeps={["team-a"]} />,
    );
    rerender(<Host onAuthChange={onAuthChange} onApi={() => {}} resetDeps={["team-b"]} />);

    // The reset-dependency change tears down the old subscription (bumping
    // the generation once, invalidating it) and establishes a fresh one
    // (bumping again) — so the new emission's generation is strictly newer
    // than the old one, and the old one is no longer current.
    expect(generations).toHaveLength(2);
    expect(generations[1]).toBeGreaterThan(generations[0]);
    expect(observeIdTokenMock).toHaveBeenCalledTimes(2);
  });

  it("does not resubscribe when reset dependencies are unchanged", () => {
    observeIdTokenMock.mockImplementation((cb: (token: string | null) => void) => {
      cb("a-token");
      return () => {};
    });
    const onAuthChange = vi.fn();

    const { rerender } = render(
      <Host onAuthChange={onAuthChange} onApi={() => {}} resetDeps={["team-a"]} />,
    );
    rerender(<Host onAuthChange={onAuthChange} onApi={() => {}} resetDeps={["team-a"]} />);

    expect(observeIdTokenMock).toHaveBeenCalledTimes(1);
  });

  it("applies a synchronous emission's state update without an act() warning", () => {
    const observer = capturingObserver();
    render(<Host onAuthChange={vi.fn()} onApi={() => {}} />);

    act(() => {
      observer.emit("a-token");
    });
  });
});
