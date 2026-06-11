import { Router, type IRouter } from "express";
import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import { db, announcementsTable, type Announcement } from "@workspace/db";
import { requireCurrentUser } from "../lib/currentUser";

const router: IRouter = Router();

function serialize(a: Announcement) {
  return {
    id: a.id,
    titleEn: a.titleEn,
    titleAr: a.titleAr,
    bodyEn: a.bodyEn ?? null,
    bodyAr: a.bodyAr ?? null,
    createdAt: a.createdAt,
  };
}

// Active, non-expired announcements for the signed-in user's dashboard banner.
router.get("/announcements/active", async (req, res) => {
  const record = await requireCurrentUser(req, res);
  if (!record) return;
  const now = new Date();
  const rows = await db
    .select()
    .from(announcementsTable)
    .where(
      and(
        eq(announcementsTable.isActive, true),
        or(
          isNull(announcementsTable.expiresAt),
          gt(announcementsTable.expiresAt, now),
        ),
      ),
    )
    .orderBy(desc(announcementsTable.createdAt));
  res.json({ announcements: rows.map(serialize) });
});

export default router;
