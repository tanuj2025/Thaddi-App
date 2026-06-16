import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { UpdatePreferencesBody, RespondFriendRequestBody } from "@workspace/api-zod";
import {
  requireCurrentUser,
  requireActivatedUser,
  serializeCurrentUser,
  getFavoriteTeam,
} from "../lib/currentUser";
import {
  buildPlayerProfile,
  getSocialOverview,
  listFollowers,
  listFollowing,
  followUser,
  unfollowUser,
  sendFriendRequest,
  respondFriendRequest,
  cancelFriendRequest,
  removeFriend,
  blockUser,
  unblockUser,
  relationshipResult,
  DEFAULT_LIMIT,
} from "../services/social";

const router: IRouter = Router();

// Query params for the follow lists are simple bounded integers; req.query
// values are strings so we parse + clamp manually (the generated zod params
// schema only validates the path id).
function parsePaging(req: { query: Record<string, unknown> }): {
  limit: number;
  offset: number;
} {
  const rawLimit = Number(req.query.limit);
  const rawOffset = Number(req.query.offset);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(100, Math.max(1, Math.trunc(rawLimit)))
    : DEFAULT_LIMIT;
  const offset = Number.isFinite(rawOffset)
    ? Math.max(0, Math.trunc(rawOffset))
    : 0;
  return { limit, offset };
}

// Update the signed-in user's preferences (currently the hide-predictions
// toggle). Returns the refreshed CurrentUser so the client can update in place.
router.patch("/me/preferences", async (req, res) => {
  const record = await requireCurrentUser(req, res);
  if (!record) return;
  const parsed = UpdatePreferencesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid preferences" });
    return;
  }
  const [user] = await db
    .update(usersTable)
    .set({ hidePredictions: parsed.data.hidePredictions, updatedAt: new Date() })
    .where(eq(usersTable.id, record.user.id))
    .returning();
  const team = await getFavoriteTeam(user);
  res.set("Cache-Control", "no-store");
  res.json(serializeCurrentUser({ user, profile: record.profile }, team));
});

// The signed-in user's social overview: friends + pending requests + counts.
router.get("/me/social", async (req, res) => {
  const record = await requireCurrentUser(req, res);
  if (!record) return;
  res.json(await getSocialOverview(record.user.id));
});

// A player's public profile (signed-in callers only).
router.get("/users/:id/profile", async (req, res) => {
  const record = await requireCurrentUser(req, res);
  if (!record) return;
  const profile = await buildPlayerProfile(req.params.id, record.user.id);
  if (!profile) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(profile);
});

router.get("/users/:id/followers", async (req, res) => {
  const record = await requireCurrentUser(req, res);
  if (!record) return;
  const { limit, offset } = parsePaging(req);
  const page = await listFollowers(record.user.id, req.params.id, limit, offset);
  if (!page) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(page);
});

router.get("/users/:id/following", async (req, res) => {
  const record = await requireCurrentUser(req, res);
  if (!record) return;
  const { limit, offset } = parsePaging(req);
  const page = await listFollowing(record.user.id, req.params.id, limit, offset);
  if (!page) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(page);
});

router.post("/users/:id/follow", async (req, res) => {
  const record = await requireActivatedUser(req, res);
  if (!record) return;
  const r = await followUser(record, req.params.id);
  if (r.error) {
    res.status(r.error.status).json({ error: r.error.message });
    return;
  }
  res.json(await relationshipResult(record.user.id, req.params.id));
});

router.delete("/users/:id/follow", async (req, res) => {
  const record = await requireActivatedUser(req, res);
  if (!record) return;
  const r = await unfollowUser(record.user.id, req.params.id);
  if (r.error) {
    res.status(r.error.status).json({ error: r.error.message });
    return;
  }
  res.json(await relationshipResult(record.user.id, req.params.id));
});

router.post("/users/:id/friend-request", async (req, res) => {
  const record = await requireActivatedUser(req, res);
  if (!record) return;
  const r = await sendFriendRequest(record, req.params.id);
  if (r.error) {
    res.status(r.error.status).json({ error: r.error.message });
    return;
  }
  res.json(await relationshipResult(record.user.id, req.params.id));
});

router.delete("/users/:id/friend-request", async (req, res) => {
  const record = await requireActivatedUser(req, res);
  if (!record) return;
  const r = await cancelFriendRequest(record.user.id, req.params.id);
  if (r.error) {
    res.status(r.error.status).json({ error: r.error.message });
    return;
  }
  res.json(await relationshipResult(record.user.id, req.params.id));
});

router.delete("/users/:id/friend", async (req, res) => {
  const record = await requireActivatedUser(req, res);
  if (!record) return;
  const r = await removeFriend(record.user.id, req.params.id);
  if (r.error) {
    res.status(r.error.status).json({ error: r.error.message });
    return;
  }
  res.json(await relationshipResult(record.user.id, req.params.id));
});

router.post("/users/:id/block", async (req, res) => {
  const record = await requireActivatedUser(req, res);
  if (!record) return;
  const r = await blockUser(record, req.params.id);
  if (r.error) {
    res.status(r.error.status).json({ error: r.error.message });
    return;
  }
  res.json(await relationshipResult(record.user.id, req.params.id));
});

router.delete("/users/:id/block", async (req, res) => {
  const record = await requireActivatedUser(req, res);
  if (!record) return;
  const r = await unblockUser(record.user.id, req.params.id);
  if (r.error) {
    res.status(r.error.status).json({ error: r.error.message });
    return;
  }
  res.json(await relationshipResult(record.user.id, req.params.id));
});

router.post("/friend-requests/:requestId/respond", async (req, res) => {
  const record = await requireActivatedUser(req, res);
  if (!record) return;
  const parsed = RespondFriendRequestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid response" });
    return;
  }
  const r = await respondFriendRequest(
    record,
    req.params.requestId,
    parsed.data.accept,
  );
  if (r.error) {
    res.status(r.error.status).json({ error: r.error.message });
    return;
  }
  res.json(await relationshipResult(record.user.id, r.requesterId!));
});

export default router;
