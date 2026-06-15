import { pgEnum } from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["user", "admin"]);
export const userStatusEnum = pgEnum("user_status", [
  "active",
  "suspended",
  "deleted",
]);

export const gamificationLevelEnum = pgEnum("gamification_level", [
  "bronze",
  "silver",
  "gold",
  "elite",
  "legend",
]);

export const tournamentTypeEnum = pgEnum("tournament_type", [
  "world_cup",
  "league",
  "cup",
  "continental",
  "friendly",
  "other",
]);
export const tournamentStatusEnum = pgEnum("tournament_status", [
  "upcoming",
  "active",
  "completed",
]);

export const stageTypeEnum = pgEnum("stage_type", [
  "group",
  "round_of_32",
  "round_of_16",
  "quarter_final",
  "semi_final",
  "third_place",
  "final",
  "league",
  "custom",
]);

export const matchStatusEnum = pgEnum("match_status", [
  "scheduled",
  "live",
  "half_time",
  "full_time",
  "finished",
  "postponed",
  "cancelled",
]);

export const challengeTypeEnum = pgEnum("challenge_type", [
  "family",
  "friends",
  "company",
  "fan",
  "world_cup",
  "custom",
]);
export const challengeVisibilityEnum = pgEnum("challenge_visibility", [
  "private",
  "unlisted",
  "public",
]);
export const challengeScopeEnum = pgEnum("challenge_scope", [
  "entire_tournament",
  "stage",
  "team_journey",
  "custom",
]);
export const challengeEndConditionEnum = pgEnum("challenge_end_condition", [
  "tournament_ends",
  "stage_ends",
  "team_eliminated",
  "matches_finish",
  "specific_date",
]);
export const challengeStatusEnum = pgEnum("challenge_status", [
  "draft",
  "active",
  "completed",
  "cancelled",
]);
export const predictionVisibilityEnum = pgEnum("prediction_visibility", [
  "reveal_after_kickoff",
  "hidden",
  "always_visible",
]);
export const participantStatusEnum = pgEnum("participant_status", [
  "active",
  "removed",
  "left",
]);

export const predictionOutcomeEnum = pgEnum("prediction_outcome", [
  "exact",
  "winner",
  "goal_difference",
  "submitted",
  "none",
  "pending",
]);

export const planCodeEnum = pgEnum("plan_code", [
  "free",
  "professional",
  "legend",
  "business",
]);
export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "active",
  "expired",
  "cancelled",
]);

export const notificationTypeEnum = pgEnum("notification_type", [
  "prediction_closing",
  "match_starting",
  "ranking_updated",
  "competition_ending",
  "badge_unlocked",
  "competition_won",
  "join_request_received",
  "join_request_approved",
  "join_request_declined",
  "new_follower",
  "friend_request_received",
  "friend_request_accepted",
  "general",
]);

export const joinRequestStatusEnum = pgEnum("join_request_status", [
  "pending",
  "approved",
  "declined",
]);

export const friendRequestStatusEnum = pgEnum("friend_request_status", [
  "pending",
  "accepted",
  "declined",
  "cancelled",
]);
export const notificationChannelEnum = pgEnum("notification_channel", [
  "in_app",
  "email",
  "push",
]);

export const rankingScopeEnum = pgEnum("ranking_scope", [
  "challenge",
  "global",
  "saudi",
]);

export const analyticsEventTypeEnum = pgEnum("analytics_event_type", [
  "registration",
  "email_verified",
  "mobile_verified",
  "challenge_created",
  "challenge_joined",
  "prediction_submitted",
  "whatsapp_share",
  "daily_active",
  "page_view",
  "clerk_proxy_error",
]);

export const mobileVerificationStatusEnum = pgEnum(
  "mobile_verification_status",
  ["pending", "verified", "failed", "expired"],
);

export const achievementTypeEnum = pgEnum("achievement_type", [
  "hall_of_fame",
  "milestone",
  "seasonal",
]);
