import { Router, type IRouter } from "express";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db, notificationsTable, type Notification } from "@workspace/db";
import { requireCurrentUser } from "../lib/currentUser";

const router: IRouter = Router();

function serialize(n: Notification) {
  return {
    id: n.id,
    type: n.type,
    channel: n.channel,
    titleEn: n.titleEn,
    titleAr: n.titleAr,
    bodyEn: n.bodyEn ?? null,
    bodyAr: n.bodyAr ?? null,
    data: n.data ?? null,
    read: n.readAt != null,
    readAt: n.readAt,
    createdAt: n.createdAt,
  };
}

async function countUnread(userId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(notificationsTable)
    .where(
      and(
        eq(notificationsTable.userId, userId),
        isNull(notificationsTable.readAt),
      ),
    );
  return row?.count ?? 0;
}

router.get("/me/notifications", async (req, res) => {
  const record = await requireCurrentUser(req, res);
  if (!record) return;
  const limit = Math.min(
    100,
    Math.max(1, Number(req.query.limit) || 30),
  );
  const unreadOnly = req.query.unreadOnly === "true";
  const rows = await db
    .select()
    .from(notificationsTable)
    .where(
      unreadOnly
        ? and(
            eq(notificationsTable.userId, record.user.id),
            isNull(notificationsTable.readAt),
          )
        : eq(notificationsTable.userId, record.user.id),
    )
    .orderBy(desc(notificationsTable.createdAt))
    .limit(limit);
  const unreadCount = await countUnread(record.user.id);
  res.json({ notifications: rows.map(serialize), unreadCount });
});

router.get("/me/notifications/unread-count", async (req, res) => {
  const record = await requireCurrentUser(req, res);
  if (!record) return;
  res.json({ unreadCount: await countUnread(record.user.id) });
});

router.post("/me/notifications/:id/read", async (req, res) => {
  const record = await requireCurrentUser(req, res);
  if (!record) return;
  const updated = await db
    .update(notificationsTable)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notificationsTable.id, req.params.id),
        eq(notificationsTable.userId, record.user.id),
        isNull(notificationsTable.readAt),
      ),
    )
    .returning();
  if (updated.length === 0) {
    // Either not found, not owned, or already read — verify existence/ownership.
    const exists = await db.query.notificationsTable.findFirst({
      where: and(
        eq(notificationsTable.id, req.params.id),
        eq(notificationsTable.userId, record.user.id),
      ),
    });
    if (!exists) {
      res.status(404).json({ error: "Notification not found" });
      return;
    }
    res.json(serialize(exists));
    return;
  }
  res.json(serialize(updated[0]));
});

router.post("/me/notifications/read-all", async (req, res) => {
  const record = await requireCurrentUser(req, res);
  if (!record) return;
  await db
    .update(notificationsTable)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notificationsTable.userId, record.user.id),
        isNull(notificationsTable.readAt),
      ),
    );
  res.json({ unreadCount: 0 });
});

export default router;
