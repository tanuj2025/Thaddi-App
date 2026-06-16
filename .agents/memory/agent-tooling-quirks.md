---
name: Agent tooling quirks (this environment)
description: Non-obvious behaviors of the shell/grep tooling in this Replit environment that can mislead verification.
---

# ripgrep match-highlight renders matched substring as `n`

In this environment, `rg`/`grep` output shown back to the agent renders the
**matched substring** (the part the pattern matched) as the literal letter `n`.
The surrounding text is shown verbatim. This makes generated/spec identifiers
look "mangled" when they are actually correct.

Worked examples (pattern → how the real name displayed):
- `essageReport` matched inside `MessageReportInput` → displayed `MnInput`
- `eportChallengeMessage` inside `ReportChallengeMessageParams` → `RnParams`
- `lockUser` inside `BlockUserParams` → `BnParams`
- `nblockUser` inside `UnblockUserParams` → `UnParams`
- `message-reports` inside `/admin/message-reports` → `/admin/n`
- `getMessageReports` (whole match) → `n`

**Why it matters:** twice this looked like orval was mangling schema names
(`Mn`/`Rn`/`Bn`/`Un`) and sent me chasing a non-existent codegen bug. The
existing "orval mangles 'revenuecat'→'n'" note was almost certainly this same
render artifact, not a real orval bug (the `iap` rename shipped anyway, so leave
it).

**How to apply:** never trust a grep *snippet* to judge whether a generated or
spec identifier is correct. Verify with `read`/`cat`, or re-run with
`rg --color=never`, which prints the true text without the `n` substitution.
