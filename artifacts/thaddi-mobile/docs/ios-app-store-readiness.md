# iOS App Store Review Readiness

## Release candidate

- App name: THADDI
- Bundle identifier: `app.thaddi`
- Sign in with Apple capability: enabled
- Payments: native subscriptions only through RevenueCat; no external checkout links
- Competition presentation: generic football language in the mobile UI

## Guideline 5.2.1 content decision

The submitted mobile build must not imply affiliation with FIFA or another
third-party competition organizer. User-facing competition labels use
“World Championship 2026” / “بطولة العالم 2026”. The build does
not use FIFA marks, logos, official tournament artwork, or “official” team
merchandising language.

The app may continue to receive football fixtures, team names, and crests from
the configured data provider, but those assets must be reviewed before each
submission. If any provider response contains a protected competition name,
mark, logo, or confusingly similar artwork, the owner must either document
authorization for App Review or remove/replace that content before submission.
This project does not claim FIFA authorization.

## Sign in with Apple review notes

Apple users authenticate through the native Apple flow and then continue
through the existing activation sequence:

1. Verify email when required by the account state.
2. Complete the private profile.
3. Verify a mobile number.
4. Select a favourite team.

Apple supplies the email address, including a private relay address when the
user chooses Hide My Email. On first authorization, Clerk persists the supplied
name. The activation screen uses that persisted Clerk name for the private
real-name field and does not ask the user to type it again. Returning Apple
sign-ins may not resend a name, so the persisted Clerk value is preferred and
the flow remains safe for returning users.

The app still asks for its own display name and username because those are
THADDI-specific profile fields, not duplicate Apple identity fields.

## Final owner checks before submission

- Confirm the App Store screenshots and description use the same generic
  competition wording as the release candidate.
- Review live/provider-supplied competition and team imagery for authorization
  status; do not submit protected material without documentation.
- Test first-time Apple sign-in with Hide My Email and a returning Apple sign-in
  on a native iOS build.
- Include the above Apple flow and generic-content explanation in App Review
  notes.