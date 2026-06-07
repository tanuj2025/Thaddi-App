export * from "./generated/api";
export * from "./generated/types";
// `getChallengeMessages` has both a path param and query params, so orval emits
// a `GetChallengeMessagesParams` zod schema (path params, in ./generated/api)
// AND a `GetChallengeMessagesParams` query-params type (in ./generated/types).
// Re-export the zod schema explicitly to resolve the `export *` ambiguity. The
// explicit `.ts` extension keeps tsx's ESM resolver deterministic (an
// extensionless named re-export races against the `export *` resolution above).
export { GetChallengeMessagesParams } from "./generated/api.ts";
