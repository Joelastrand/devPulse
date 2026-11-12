"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { resendVerificationEmail, signOut } from "../client/auth-client";
import { authCopy } from "../copy";

/** The client-side wait between resend requests. Firebase applies its own limits on top of this. */
const RESEND_COOLDOWN_SECONDS = 60;

type ResendState = "idle" | "sending" | "sent" | "failed";

interface VerificationPendingProps {
  /** `created`: right after sign-up. `unverified`: sign-in found an account whose address is not yet verified. */
  variant: "created" | "unverified";
}

/**
 * Explains that the address still has to be verified, offers a resend, and returns the person to the login route.
 * The login action signs out first: a signed-in visitor is redirected away from `/sign-in`, so the sign-in page can only
 * be reached cleanly without the pending session. Login then re-checks verification from a fresh session.
 */
export function VerificationPending({ variant }: VerificationPendingProps) {
  const router = useRouter();
  const copy = authCopy.verification;
  const [resendState, setResendState] = useState<ResendState>("idle");
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function handleResend() {
    setResendState("sending");
    const result = await resendVerificationEmail();
    if (result.ok) {
      setResendState("sent");
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } else {
      setResendState("failed");
    }
  }

  async function handleLogin() {
    await signOut();
    router.push("/sign-in");
  }

  const heading = variant === "created" ? copy.createdHeading : copy.unverifiedHeading;
  const description = variant === "created" ? copy.createdDescription : copy.unverifiedDescription;
  const resendDisabled = resendState === "sending" || cooldown > 0;

  return (
    <section aria-labelledby="verification-pending-heading" className="mt-6 flex flex-col gap-4">
      <h2 id="verification-pending-heading" className="text-xl font-semibold text-text-primary">
        {heading}
      </h2>
      <p className="text-base text-text-secondary">{description}</p>
      <p className="text-sm text-text-secondary">{copy.spamReminder}</p>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button type="button" variant="primary" onClick={handleLogin}>
          {copy.loginAction}
        </Button>
        <Button type="button" variant="secondary" onClick={handleResend} disabled={resendDisabled} pending={resendState === "sending"}>
          {resendState === "sending" ? copy.resendPending : copy.resendAction}
        </Button>
      </div>

      {resendState === "sent" && (
        <p role="status" className="text-sm text-text-secondary">
          {copy.resendSent}
          {cooldown > 0 && ` ${copy.resendCooldown(cooldown)}`}
        </p>
      )}
      {resendState === "failed" && (
        <p role="alert" className="text-sm text-danger-text">
          {copy.resendFailed}
        </p>
      )}
    </section>
  );
}
