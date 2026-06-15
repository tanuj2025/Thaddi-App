// Clerk surfaces errors in two shapes depending on the API generation:
//  - Future/signals API methods *return* a single `ClerkError` which carries
//    the machine-stable `code` directly.
//  - The classic API *throws* a `ClerkAPIResponseError` whose codes live under
//    `errors[0].code`.
// Read both so the helpers work regardless of which shape we get.
type ClerkLikeError = {
  code?: string;
  errors?: Array<{ code?: string }>;
};

// Extract the first Clerk API error code, if any. Useful for branching on
// specific cases (e.g. non-enumerating password reset) without surfacing a
// message.
export function clerkErrorCode(err: unknown): string | undefined {
  const e = err as ClerkLikeError | null | undefined;
  return e?.errors?.[0]?.code ?? e?.code;
}

// Map a Clerk API error to a localized, user-facing message. Falls back to a
// generic message so the UI never dead-ends on an unexpected error code.
export function clerkErrorMessage(
  err: unknown,
  t: (key: string) => string,
): string {
  const code = clerkErrorCode(err);
  switch (code) {
    case "form_password_incorrect":
      return t("auth.err.passwordIncorrect");
    case "form_identifier_not_found":
      return t("auth.err.identifierNotFound");
    case "form_param_format_invalid":
    case "form_param_type_invalid":
    case "form_param_type_invalid__email_address":
    case "form_param_nil":
      return t("auth.err.emailInvalid");
    case "form_code_incorrect":
    case "verification_failed":
      return t("auth.err.codeIncorrect");
    case "verification_expired":
    case "expired":
      return t("auth.err.codeExpired");
    case "form_password_pwned":
    case "form_password_pwned__sign_in":
      return t("auth.err.passwordPwned");
    case "form_password_length_too_short":
      return t("auth.err.passwordTooShort");
    case "too_many_requests":
      return t("auth.err.tooManyRequests");
    default:
      return t("auth.err.generic");
  }
}
