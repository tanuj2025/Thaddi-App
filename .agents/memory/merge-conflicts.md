---
name: Merge conflict validation
description: Handling source and lockfile conflict markers after concurrent workspace changes
---

When concurrent changes arrive during an active edit, pnpm can say it auto-merged the lockfile while source files remain unmerged. Resolve all affected files, scan tracked content for `<<<<<<<`, `=======`, and `>>>>>>>`, then run `pnpm install --frozen-lockfile` before typechecking.

**Why:** A single remaining marker in an unrelated artifact can make the repository-wide typecheck fail before the requested package is checked, and a peer-resolution mismatch in the lockfile can recreate the problem on the next install.

**How to apply:** After any incoming merge or task update, inspect `git diff --name-only --diff-filter=U`, resolve those paths together, and validate both the lockfile and full workspace.