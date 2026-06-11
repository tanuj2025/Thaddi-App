export * from "./generated/api";
export * from "./generated/types";
// `getChallengeMessages` has both a path param and query params, so orval emits
// a `GetChallengeMessagesParams` zod schema (path params, in ./generated/api)
// AND a `GetChallengeMessagesParams` query-params type (in ./generated/types).
// Re-export the zod schema explicitly to resolve the `export *` ambiguity. The
// explicit `.ts` extension keeps tsx's ESM resolver deterministic (an
// extensionless named re-export races against the `export *` resolution above).
export { GetChallengeMessagesParams } from "./generated/api.ts";
// `resolveJoinRequest` PATCH emits both a path-param schema AND a body type
// under the same name `ResolveJoinRequestBody`. Prefer the Zod schema.
export { ResolveJoinRequestBody } from "./generated/api.ts";
// `updateFavoriteTeam` PATCH emits both a path-param schema AND a body type
// under the same name `UpdateFavoriteTeamBody`. Prefer the Zod schema.
export { UpdateFavoriteTeamBody } from "./generated/api.ts";
// `adminSetUserPlan` PATCH and the announcement create/update ops emit both a
// path-param/body Zod schema AND a body type under the same name. Prefer Zod.
export { AdminSetUserPlanBody } from "./generated/api.ts";
export { AdminCreateAnnouncementBody } from "./generated/api.ts";
export { AdminUpdateAnnouncementBody } from "./generated/api.ts";
