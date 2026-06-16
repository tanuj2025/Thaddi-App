import { Router, type IRouter } from "express";
import { and, eq, ne } from "drizzle-orm";
import { clerkClient, getAuth } from "@clerk/express";
import {
  db,
  usersTable,
  profilesTable,
  teamsTable,
  accountDeletionsTable,
} from "@workspace/db";
import {
  UpdateProfileBody,
  CheckDisplayNameAvailabilityQueryParams,
  CheckUsernameAvailabilityQueryParams,
} from "@workspace/api-zod";
import {
  requireCurrentUser,
  serializeCurrentUser,
  getFavoriteTeam,
} from "../lib/currentUser";
import { recordEvent } from "../lib/analytics";
import { CURRENT_TERMS_VERSION } from "../lib/terms";

const router: IRouter = Router();

const RESERVED_USERNAMES = new Set([
  "admin",
  "thaddi",
  "support",
  "root",
  "api",
  "me",
  "system",
  "official",
]);

const USERNAME_RE = /^[a-zA-Z0-9_]+$/;

router.get("/me", async (req, res) => {
  const record = await requireCurrentUser(req, res);
  if (!record) return;
  // Best-effort DAU ping (de-duplicated per user per UTC day in recordEvent).
  await recordEvent({ type: "daily_active", userId: record.user.id });
  const team = await getFavoriteTeam(record.user);
  // Identity/entitlement state must always be fresh (plan changes, team
  // changes) — never cached by the browser or any intermediary.
  res.set("Cache-Control", "no-store");
  res.json(serializeCurrentUser(record, team));
});

// Permanently delete the signed-in account (App Store guideline 5.1.1(v)).
// Clerk is the source of truth for identity, so we delete the Clerk user FIRST;
// only if that succeeds do we write a tombstone and hard-delete the local row
// (FK cascade removes all dependent data). Ordering this way means a failure
// never leaves an orphaned Clerk identity that can still authenticate.
router.delete("/me", async (req, res) => {
  // Resolve the caller straight from the verified JWT subject rather than via
  // requireCurrentUser/getOrProvisionUser. Once the Clerk identity is gone (a
  // previous attempt deleted it but local cleanup rolled back), getOrProvisionUser
  // refuses to serve the account — which would otherwise lock the user out of
  // finishing their OWN deletion. This handler must stay reachable to self-heal.
  // It only ever deletes the caller's own account, so it remains safe.
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  // Delete the Clerk identity first so a failure never strands local data while
  // the account can still authenticate and re-provision. An already-deleted
  // identity (404) is treated as success so a retry — after a previous attempt
  // deleted Clerk but failed before local cleanup committed — can finish the job
  // instead of being permanently blocked by a 502.
  try {
    await clerkClient.users.deleteUser(clerkUserId);
  } catch (err) {
    const status = (err as { status?: number } | null)?.status;
    if (status !== 404) {
      res.status(502).json({ error: "Could not delete account, please retry" });
      return;
    }
  }

  try {
    await db.transaction(async (tx) => {
      // Tombstone + hard-delete atomically so the two never disagree. The
      // tombstone outlives the (still signature-valid) session token, and
      // getOrProvisionUser checks it before returning any row, so a deleted
      // account can neither re-provision nor resolve to a lingering row. Delete
      // by clerkUserId (not a pre-fetched row id) so a retry after a rolled-back
      // cleanup still finds and removes the lingering row. The FK cascade removes
      // all dependent data.
      await tx
        .insert(accountDeletionsTable)
        .values({ clerkUserId })
        .onConflictDoNothing();
      await tx
        .delete(usersTable)
        .where(eq(usersTable.clerkUserId, clerkUserId));
    });
  } catch (err) {
    // Cleanup failed after the identity was deleted. The transaction rolled back
    // (no tombstone, row intact), so surface a 500 to make the client retry: the
    // retry re-enters this handler (it doesn't depend on getOrProvisionUser),
    // hits the idempotent 404 branch above, and completes — leaving no orphaned
    // data. Meanwhile every other endpoint already refuses the deleted identity.
    console.error(
      `account deletion: local cleanup failed after Clerk delete for clerkUserId=${clerkUserId}`,
      err,
    );
    res.status(500).json({ error: "Could not delete account, please retry" });
    return;
  }

  res.json({ success: true });
});

router.patch("/me/profile", async (req, res) => {
  const record = await requireCurrentUser(req, res);
  if (!record) return;

  const parsed = UpdateProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid profile data" });
    return;
  }
  const { realName, displayName, username, avatarUrl, termsAccepted } =
    parsed.data;

  if (displayName !== undefined) {
    const clash = await db.query.profilesTable.findFirst({
      where: and(
        eq(profilesTable.displayName, displayName),
        ne(profilesTable.userId, record.user.id),
      ),
    });
    if (clash) {
      res.status(409).json({ error: "Display name is already taken" });
      return;
    }
  }

  if (username !== undefined) {
    if (!USERNAME_RE.test(username) || RESERVED_USERNAMES.has(username.toLowerCase())) {
      res.status(400).json({ error: "Username is invalid or reserved" });
      return;
    }
    const clash = await db.query.profilesTable.findFirst({
      where: and(
        eq(profilesTable.username, username.toLowerCase()),
        ne(profilesTable.userId, record.user.id),
      ),
    });
    if (clash) {
      res.status(409).json({ error: "Username is already taken" });
      return;
    }
  }

  const profilePatch: Record<string, unknown> = { updatedAt: new Date() };
  if (displayName !== undefined) profilePatch.displayName = displayName;
  if (username !== undefined) profilePatch.username = username.toLowerCase();
  if (avatarUrl !== undefined) profilePatch.avatarUrl = avatarUrl;

  const [profile] = await db
    .update(profilesTable)
    .set(profilePatch)
    .where(eq(profilesTable.userId, record.user.id))
    .returning();

  let user = record.user;
  const userPatch: Record<string, unknown> = {};
  if (realName !== undefined) userPatch.realName = realName;
  // Record consent only on the transition (first acceptance), preserving the
  // original timestamp/version on later profile edits that re-send the flag.
  if (termsAccepted === true && !record.user.termsAcceptedAt) {
    userPatch.termsAcceptedAt = new Date();
    userPatch.termsVersion = CURRENT_TERMS_VERSION;
  }
  if (Object.keys(userPatch).length > 0) {
    userPatch.updatedAt = new Date();
    const [updated] = await db
      .update(usersTable)
      .set(userPatch)
      .where(eq(usersTable.id, record.user.id))
      .returning();
    user = updated;
  }

  const team = await getFavoriteTeam(user);
  res.json(serializeCurrentUser({ ...record, user, profile }, team));
});

router.patch("/me/favorite-team", async (req, res) => {
  const record = await requireCurrentUser(req, res);
  if (!record) return;

  const { teamId } = req.body as { teamId?: unknown };
  if (typeof teamId !== "string") {
    res.status(400).json({ error: "teamId must be a string uuid" });
    return;
  }
  const [team] = await db
    .select()
    .from(teamsTable)
    .where(eq(teamsTable.id, teamId))
    .limit(1);
  if (!team) {
    res.status(404).json({ error: "Team not found" });
    return;
  }
  const [user] = await db
    .update(usersTable)
    .set({ favoriteTeamId: team.id, updatedAt: new Date() })
    .where(eq(usersTable.id, record.user.id))
    .returning();
  res.json(serializeCurrentUser({ ...record, user }, team));
});

router.get("/me/display-name-availability", async (req, res) => {
  const record = await requireCurrentUser(req, res);
  if (!record) return;

  const parsed = CheckDisplayNameAvailabilityQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing displayName" });
    return;
  }
  const value = parsed.data.displayName.trim();
  if (value.length < 2 || value.length > 40) {
    res.json({ value, available: false, reason: "invalid" });
    return;
  }
  const clash = await db.query.profilesTable.findFirst({
    where: and(
      eq(profilesTable.displayName, value),
      ne(profilesTable.userId, record.user.id),
    ),
  });
  res.json({ value, available: !clash, reason: clash ? "taken" : null });
});

router.get("/me/username-availability", async (req, res) => {
  const record = await requireCurrentUser(req, res);
  if (!record) return;

  const parsed = CheckUsernameAvailabilityQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing username" });
    return;
  }
  const raw = parsed.data.username.trim();
  const value = raw.toLowerCase();
  if (value.length < 3 || value.length > 30 || !USERNAME_RE.test(value)) {
    res.json({ value: raw, available: false, reason: "invalid" });
    return;
  }
  if (RESERVED_USERNAMES.has(value)) {
    res.json({ value: raw, available: false, reason: "reserved" });
    return;
  }
  const clash = await db.query.profilesTable.findFirst({
    where: and(
      eq(profilesTable.username, value),
      ne(profilesTable.userId, record.user.id),
    ),
  });
  res.json({ value: raw, available: !clash, reason: clash ? "taken" : null });
});

const SUGGESTION_PREFIXES = [
  "Captain",
  "Striker",
  "Maestro",
  "Falcon",
  "Sniper",
  "Tactician",
  "Goal",
  "Eagle",
  "Desert",
  "Phantom",
];
const SUGGESTION_SUFFIXES = [
  "Predictor",
  "Pro",
  "Legend",
  "Master",
  "King",
  "Ace",
  "Wizard",
  "Hawk",
];

router.get("/me/suggested-display-names", async (req, res) => {
  const record = await requireCurrentUser(req, res);
  if (!record) return;

  const suggestions: string[] = [];
  let attempts = 0;
  while (suggestions.length < 5 && attempts < 60) {
    attempts += 1;
    const prefix =
      SUGGESTION_PREFIXES[
        Math.floor(Math.random() * SUGGESTION_PREFIXES.length)
      ];
    const suffix =
      SUGGESTION_SUFFIXES[
        Math.floor(Math.random() * SUGGESTION_SUFFIXES.length)
      ];
    const num = Math.floor(Math.random() * 900) + 100;
    const candidate = `${prefix}${suffix}${num}`;
    if (suggestions.includes(candidate)) continue;
    const clash = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.displayName, candidate),
    });
    if (!clash) suggestions.push(candidate);
  }
  res.json({ suggestions });
});

export default router;
