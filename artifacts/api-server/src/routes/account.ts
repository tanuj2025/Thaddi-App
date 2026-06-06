import { Router, type IRouter } from "express";
import { and, eq, ne } from "drizzle-orm";
import { db, usersTable, profilesTable } from "@workspace/db";
import {
  UpdateProfileBody,
  CheckDisplayNameAvailabilityQueryParams,
  CheckUsernameAvailabilityQueryParams,
} from "@workspace/api-zod";
import {
  requireCurrentUser,
  serializeCurrentUser,
} from "../lib/currentUser";

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
  res.json(serializeCurrentUser(record));
});

router.patch("/me/profile", async (req, res) => {
  const record = await requireCurrentUser(req, res);
  if (!record) return;

  const parsed = UpdateProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid profile data" });
    return;
  }
  const { realName, displayName, username, avatarUrl } = parsed.data;

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
  if (realName !== undefined) {
    const [updated] = await db
      .update(usersTable)
      .set({ realName, updatedAt: new Date() })
      .where(eq(usersTable.id, record.user.id))
      .returning();
    user = updated;
  }

  res.json(serializeCurrentUser({ user, profile }));
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
