// Unit test for the Clerk error helpers (src/components/auth/clerkErrors.ts):
//   - isExistingSessionError: detects the "a session already exists" family of
//     Clerk codes (client/server desync) so the sign-in UI can RECOVER into the
//     app instead of dead-ending on the form with a generic error.
//   - clerkErrorMessage: maps known codes to localized keys, including the new
//     session-exists case, and falls back to the generic key for unknowns.
//
// This locks in the production sign-in dead-end fix: a real user whose Clerk
// FAPI session existed but whose client still showed the form kept getting the
// generic "something went wrong" on every re-submit (unmapped 400). Both Clerk
// error shapes are covered: Future/signals API returns `{ code }` directly,
// while the classic API nests it under `errors[0].code`.
//
// Run with: tsx --test test/clerk-errors.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clerkErrorCode,
  isExistingSessionError,
  clerkErrorMessage,
} from "../src/components/auth/clerkErrors";

// Identity translator: returns the key so we can assert which message was chosen
// without depending on the i18n dictionary.
const t = (key: string) => key;

test("clerkErrorCode reads both Clerk error shapes", () => {
  assert.equal(clerkErrorCode({ code: "session_exists" }), "session_exists");
  assert.equal(
    clerkErrorCode({ errors: [{ code: "form_password_incorrect" }] }),
    "form_password_incorrect",
  );
  assert.equal(clerkErrorCode(null), undefined);
  assert.equal(clerkErrorCode({}), undefined);
});

test("isExistingSessionError matches the known session-exists codes", () => {
  for (const code of [
    "session_exists",
    "identifier_already_signed_in",
    "single_session_mode",
  ]) {
    assert.equal(isExistingSessionError({ code }), true, code);
    // Classic shape too.
    assert.equal(isExistingSessionError({ errors: [{ code }] }), true, code);
  }
});

test("isExistingSessionError falls back to a defensive substring match", () => {
  // Future Clerk versions may prefix/suffix the code; the substring guard keeps
  // the recovery working without an exact-code allowlist update.
  assert.equal(
    isExistingSessionError({ code: "oauth_identifier_already_signed_in" }),
    true,
  );
  assert.equal(
    isExistingSessionError({ code: "client_session_exists_error" }),
    true,
  );
});

test("isExistingSessionError ignores unrelated and missing codes", () => {
  assert.equal(isExistingSessionError({ code: "form_password_incorrect" }), false);
  assert.equal(isExistingSessionError({ code: "too_many_requests" }), false);
  assert.equal(isExistingSessionError(null), false);
  assert.equal(isExistingSessionError({}), false);
});

test("clerkErrorMessage maps session-exists codes to the dedicated key", () => {
  for (const code of [
    "session_exists",
    "identifier_already_signed_in",
    "single_session_mode",
  ]) {
    assert.equal(clerkErrorMessage({ code }, t), "auth.err.sessionExists", code);
  }
});

test("clerkErrorMessage keeps existing mappings and the generic fallback", () => {
  assert.equal(
    clerkErrorMessage({ code: "form_password_incorrect" }, t),
    "auth.err.passwordIncorrect",
  );
  assert.equal(
    clerkErrorMessage({ code: "form_identifier_not_found" }, t),
    "auth.err.identifierNotFound",
  );
  assert.equal(
    clerkErrorMessage({ code: "too_many_requests" }, t),
    "auth.err.tooManyRequests",
  );
  // Unknown / unmapped code => generic, never a dead-end.
  assert.equal(
    clerkErrorMessage({ code: "some_unmapped_code" }, t),
    "auth.err.generic",
  );
  assert.equal(clerkErrorMessage(null, t), "auth.err.generic");
});
