import type { useSSO } from "@clerk/expo";

export type SSONavigateArgs = {
  session?: { currentTask?: unknown } | null;
  decorateUrl: (url: string) => string;
};

export type SSONavigate = (args: SSONavigateArgs) => void;

type SSOFlowResult = Awaited<ReturnType<ReturnType<typeof useSSO>["startSSOFlow"]>>;

/**
 * Drive a Clerk Expo SSO result to completion.
 *
 * Clerk surfaces the new session id in one of three places:
 *   1. `result.createdSessionId` — typically a fresh sign-up;
 *   2. `result.signIn.createdSessionId` once the signIn resource reaches status
 *      `complete` — an EXISTING user signing in with Google (the case that
 *      previously dead-ended: the screens only read the top-level id, so for
 *      existing users nothing happened and they bounced back to sign-in);
 *   3. `result.signUp.createdSessionId` once the signUp resource completes.
 *
 * In every case the session is activated via `setActive` (the mobile SDK has no
 * `finalize`; reading the resource's `createdSessionId` is its equivalent).
 * Returns `true` when a session was activated so callers can surface an error
 * on any unhandled / non-complete status instead of silently no-op'ing.
 */
export async function completeSSOFlow(
  result: SSOFlowResult,
  navigate: SSONavigate,
): Promise<boolean> {
  const { createdSessionId, setActive, signIn, signUp } = result;

  const sessionId =
    createdSessionId ??
    (signIn?.status === "complete" ? signIn.createdSessionId : null) ??
    (signUp?.status === "complete" ? signUp.createdSessionId : null);

  if (sessionId && setActive) {
    await setActive({ session: sessionId, navigate });
    return true;
  }
  return false;
}
