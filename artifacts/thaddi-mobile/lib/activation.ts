import type { CurrentUser } from "@workspace/api-client-react";

/**
 * The native activation flow mirrors the web ActivationGate order:
 *   email verified -> profile complete -> mobile verified -> favourite team -> activated.
 *
 * `nextActivationRoute` is the single source of truth for "what comes next".
 * Both the gate (to redirect into the flow) and each step's onSuccess (to advance)
 * call it, so the order can never drift between the two places.
 */
export type ActivationRoute =
  | "/(activation)/onboarding"
  | "/(activation)/verify-mobile"
  | "/(activation)/pick-team"
  | "/(tabs)";

export function nextActivationRoute(me: CurrentUser): ActivationRoute {
  if (!me.profileComplete) return "/(activation)/onboarding";
  if (!me.mobileVerified) return "/(activation)/verify-mobile";
  if (!me.favoriteTeamSelected) return "/(activation)/pick-team";
  return "/(tabs)";
}
