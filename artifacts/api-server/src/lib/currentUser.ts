import type { Request, Response } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { eq } from "drizzle-orm";
import {
  db,
  usersTable,
  profilesTable,
  teamsTable,
  type User,
  type Profile,
  type Team,
} from "@workspace/db";
import { recordEvent } from "./analytics";

export interface CurrentUserRecord {
  user: User;
  profile: Profile;
}

// Shape returned by the API (matches CurrentUser in the OpenAPI spec).
export function serializeCurrentUser(
  { user, profile }: CurrentUserRecord,
  team?: Team | null,
) {
  const profileComplete = Boolean(profile.displayName && profile.username);
  const favoriteTeamSelected = user.favoriteTeamId !== null;
  const activated =
    user.emailVerified &&
    user.mobileVerified &&
    profileComplete &&
    favoriteTeamSelected;
  return {
    id: user.id,
    email: user.email ?? null,
    emailVerified: user.emailVerified,
    realName: user.realName ?? null,
    displayName: profile.displayName ?? null,
    username: profile.username ?? null,
    avatarUrl: profile.avatarUrl ?? null,
    mobileNumber: user.mobileNumber ?? null,
    mobileVerified: user.mobileVerified,
    role: user.role,
    level: user.level,
    totalPoints: user.totalPoints,
    profileComplete,
    favoriteTeamSelected,
    favoriteTeam: team
      ? { id: team.id, nameEn: team.nameEn, nameAr: team.nameAr, flagUrl: team.flagUrl ?? null }
      : null,
    activated,
    createdAt: user.createdAt,
  };
}

// Fetches the favorite team for a user record (null if none set).
export async function getFavoriteTeam(user: User): Promise<Team | null> {
  if (!user.favoriteTeamId) return null;
  const [team] = await db
    .select()
    .from(teamsTable)
    .where(eq(teamsTable.id, user.favoriteTeamId))
    .limit(1);
  return team ?? null;
}

// Emails listed in the BOOTSTRAP_ADMIN_EMAILS secret (comma-separated) are
// auto-promoted to an active admin on login. This is the supported way to seed
// the first admin in an environment whose database is otherwise read-only
// (e.g. production), and is idempotent on every authenticated read.
function bootstrapAdminEmails(): Set<string> {
  return new Set(
    (process.env.BOOTSTRAP_ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

function isBootstrapAdmin(email: string | null): boolean {
  if (!email) return false;
  return bootstrapAdminEmails().has(email.toLowerCase());
}

// Pulls the latest email + email verification status from Clerk (the source of
// truth for email auth).
async function readClerkIdentity(clerkUserId: string): Promise<{
  email: string | null;
  emailVerified: boolean;
} | null> {
  try {
    const cu = await clerkClient.users.getUser(clerkUserId);
    const primary = cu.emailAddresses.find(
      (e) => e.id === cu.primaryEmailAddressId,
    );
    return {
      email: primary?.emailAddress ?? cu.emailAddresses[0]?.emailAddress ?? null,
      emailVerified: primary?.verification?.status === "verified",
    };
  } catch {
    // Transient Clerk failure: signal "unknown" so callers keep the last-known
    // local state instead of downgrading a verified user.
    return null;
  }
}

// JIT-provisions a local user from the authenticated Clerk identity and keeps
// email/verification in sync on every read. Returns null when unauthenticated.
export async function getOrProvisionUser(
  req: Request,
): Promise<CurrentUserRecord | null> {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return null;

  const identity = await readClerkIdentity(clerkUserId);

  const existing = await db.query.usersTable.findFirst({
    where: eq(usersTable.clerkUserId, clerkUserId),
  });

  if (existing) {
    let user = existing;
    // Only sync when Clerk returned a definitive identity. On a transient Clerk
    // failure (identity === null) we keep the last-known local state.
    if (identity) {
      // Bootstrap admins are promoted to an active admin whenever their email
      // matches the BOOTSTRAP_ADMIN_EMAILS secret and they aren't already one.
      const promoteToAdmin =
        isBootstrapAdmin(identity.email) &&
        (existing.role !== "admin" || existing.status !== "active");
      const needsSync =
        existing.email !== identity.email ||
        existing.emailVerified !== identity.emailVerified ||
        promoteToAdmin;
      if (needsSync) {
        const becameVerified =
          !existing.emailVerified && identity.emailVerified;
        const [updated] = await db
          .update(usersTable)
          .set({
            email: identity.email,
            emailVerified: identity.emailVerified,
            ...(promoteToAdmin
              ? { role: "admin" as const, status: "active" as const }
              : {}),
            updatedAt: new Date(),
          })
          .where(eq(usersTable.id, existing.id))
          .returning();
        user = updated;
        if (becameVerified) {
          await recordEvent({ type: "email_verified", userId: user.id });
        }
      }
    }
    const profile = await ensureProfile(user.id);
    return { user, profile };
  }

  const [user] = await db
    .insert(usersTable)
    .values({
      clerkUserId,
      email: identity?.email ?? null,
      emailVerified: identity?.emailVerified ?? false,
      ...(isBootstrapAdmin(identity?.email ?? null)
        ? { role: "admin" as const, status: "active" as const }
        : {}),
    })
    .returning();
  const profile = await ensureProfile(user.id);
  await recordEvent({ type: "registration", userId: user.id });
  if (user.emailVerified) {
    await recordEvent({ type: "email_verified", userId: user.id });
  }
  return { user, profile };
}

async function ensureProfile(userId: string): Promise<Profile> {
  const existing = await db.query.profilesTable.findFirst({
    where: eq(profilesTable.userId, userId),
  });
  if (existing) return existing;
  const [created] = await db
    .insert(profilesTable)
    .values({ userId })
    .returning();
  return created;
}

// Helper for routes: returns the current record or sends a 401 and returns null.
export async function requireCurrentUser(
  req: Request,
  res: Response,
): Promise<CurrentUserRecord | null> {
  const record = await getOrProvisionUser(req);
  if (!record) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return record;
}

// Whether the account has completed activation (email + mobile verified, a
// complete public profile, and a favourite team selected).
// Mirrors `serializeCurrentUser.activated`.
export function isActivated({ user, profile }: CurrentUserRecord): boolean {
  const profileComplete = Boolean(profile.displayName && profile.username);
  return (
    user.emailVerified &&
    user.mobileVerified &&
    profileComplete &&
    user.favoriteTeamId !== null
  );
}

// Helper for routes that require a fully activated account (create/join).
// Sends 401 when unauthenticated and 403 when not yet activated.
export async function requireActivatedUser(
  req: Request,
  res: Response,
): Promise<CurrentUserRecord | null> {
  const record = await requireCurrentUser(req, res);
  if (!record) return null;
  if (!isActivated(record)) {
    res.status(403).json({ error: "Account not activated" });
    return null;
  }
  return record;
}

// Helper for admin-only routes. Sends 401 when unauthenticated and 403 when the
// authenticated user is not an active platform admin. Activation (email/mobile)
// is intentionally NOT required, but the account status must be "active": a
// suspended or deleted admin must lose admin access immediately.
export async function requireAdminUser(
  req: Request,
  res: Response,
): Promise<CurrentUserRecord | null> {
  const record = await requireCurrentUser(req, res);
  if (!record) return null;
  if (record.user.role !== "admin" || record.user.status !== "active") {
    res.status(403).json({ error: "Admin access required" });
    return null;
  }
  return record;
}
