// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

type Emit = (token: string | null, uid: string | null) => void;
let emitter: Emit | null = null;
const observeIdTokenMock = vi.fn((callback: Emit) => {
  emitter = callback;
  return () => {};
});
vi.mock("./auth-client", () => ({ observeIdToken: observeIdTokenMock }));

const { useAuthGatedResource } = await import("./use-auth-gated-resource");
import type { AuthChange } from "./use-auth-gated-resource";

function Host({ onAuthChange }: { onAuthChange: (token: string | null, change: AuthChange) => void }) {
  useAuthGatedResource((token, _generation, _isCurrent, change) => onAuthChange(token, change));
  return null;
}

function emit(token: string | null, uid: string | null) {
  act(() => {
    emitter?.(token, uid);
  });
}

afterEach(() => {
  cleanup();
  emitter = null;
  observeIdTokenMock.mockClear();
});

describe("useAuthGatedResource: change kind from the account UID", () => {
  it("reports the first sign-in as signed_in", () => {
    const onAuthChange = vi.fn();
    render(<Host onAuthChange={onAuthChange} />);

    emit("token-1", "uid-a");

    expect(onAuthChange).toHaveBeenLastCalledWith("token-1", "signed_in");
  });

  it("reports a new token for the same account as refreshed, not switched", () => {
    const onAuthChange = vi.fn();
    render(<Host onAuthChange={onAuthChange} />);
    emit("token-1", "uid-a");

    emit("token-2", "uid-a");

    expect(onAuthChange).toHaveBeenLastCalledWith("token-2", "refreshed");
  });

  it("reports a different account delivered without a sign-out in between as switched", () => {
    const onAuthChange = vi.fn();
    render(<Host onAuthChange={onAuthChange} />);
    emit("token-1", "uid-a");

    emit("token-b", "uid-b");

    expect(onAuthChange).toHaveBeenLastCalledWith("token-b", "switched");
  });

  it("reports sign-out as signed_out, and a later sign-in as signed_in", () => {
    const onAuthChange = vi.fn();
    render(<Host onAuthChange={onAuthChange} />);
    emit("token-a", "uid-a");

    emit(null, null);
    expect(onAuthChange).toHaveBeenLastCalledWith(null, "signed_out");

    emit("token-b", "uid-b");
    expect(onAuthChange).toHaveBeenLastCalledWith("token-b", "signed_in");
  });

  it("fails closed: a token without a UID is treated as switched, never as a refresh", () => {
    const onAuthChange = vi.fn();
    render(<Host onAuthChange={onAuthChange} />);
    emit("token-a", "uid-a");

    emit("token-unknown", null);

    expect(onAuthChange).toHaveBeenLastCalledWith("token-unknown", "switched");
  });

  it("compares against the last signed-in account, so a refresh after a switch is refreshed", () => {
    const onAuthChange = vi.fn();
    render(<Host onAuthChange={onAuthChange} />);
    emit("token-a", "uid-a");
    emit("token-b", "uid-b");

    emit("token-b-2", "uid-b");

    expect(onAuthChange).toHaveBeenLastCalledWith("token-b-2", "refreshed");
  });
});
