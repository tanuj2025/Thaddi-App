import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { logger } from "../../lib/logger";
import { notify } from "./index";

// Cap how many existing users are nudged per boot so a large backfill is spread
// across restarts rather than firing thousands of emails in one batch.
const NUDGE_BATCH_LIMIT = 200;

// One-time nudge for existing users who picked a favorite national team before
// favorite *clubs* existed, prompting them to also choose a club now that the
// multi-competition catalog ships clubs.
//
// At-most-once is enforced by the atomic claim: a single UPDATE stamps
// favoriteClubNudgedAt for the eligible batch and RETURNs only the rows it
// actually claimed. Two concurrent boots (autoscale) can never double-notify a
// user — the second UPDATE re-checks `favoriteClubNudgedAt IS NULL` after taking
// the row lock, so an already-claimed row is excluded even if both instances
// selected it. (The bounded inner SELECT only sizes the batch; the repeated
// outer predicate is what guarantees the invariant.)
export async function nudgeUsersForFavoriteClub(
  opts: { limit?: number } = {},
): Promise<{ claimed: number; sent: number }> {
  const limit = opts.limit ?? NUDGE_BATCH_LIMIT;

  const eligible = and(
    isNotNull(usersTable.favoriteTeamId),
    isNull(usersTable.favoriteClubId),
    isNull(usersTable.favoriteClubNudgedAt),
    eq(usersTable.status, "active"),
  );

  const claimed = await db
    .update(usersTable)
    .set({ favoriteClubNudgedAt: new Date() })
    .where(
      and(
        eligible,
        inArray(
          usersTable.id,
          db
            .select({ id: usersTable.id })
            .from(usersTable)
            .where(eligible)
            .limit(limit),
        ),
      ),
    )
    .returning({ id: usersTable.id });

  let sent = 0;
  for (const row of claimed) {
    try {
      await notify(row.id, "favorite_club_nudge", { ctaUrl: "/profile" });
      sent += 1;
    } catch (err) {
      // notify is already best-effort, but guard the loop so one bad row never
      // aborts the rest of the claimed batch.
      logger.error({ err, userId: row.id }, "favorite club nudge notify failed");
    }
  }

  if (claimed.length > 0) {
    logger.info({ claimed: claimed.length, sent }, "Favorite-club nudge batch sent");
  }

  return { claimed: claimed.length, sent };
}
