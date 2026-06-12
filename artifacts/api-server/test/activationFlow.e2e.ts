/**
 * Sign-up / activation-flow regression test.
 *
 * Boots the Express app in-process on an ephemeral port (so it does not depend
 * on the dev workflow being up and never runs the startup football sync in
 * `index.ts`), mints real Clerk session tokens for seeded users, and exercises
 * the auth → profile → mobile → activated foundation:
 *
 *   1. Activation ordering guard: the mobile OTP endpoints
 *      (`/me/mobile/send-otp`, `/me/mobile/verify-otp`) reject with 409 unless
 *      the account has already verified its email AND completed its profile.
 *      Once both prerequisites are met the guard no longer blocks (the request
 *      reaches the SMS provider stage).
 *   2. OTP expiry handling: `verify-otp` rejects a stale pending attempt with
 *      400 and flips its status to `expired` BEFORE contacting the provider; a
 *      subsequent verify with no live attempt is rejected with 400.
 *   3. One-mobile-per-account uniqueness: `send-otp` rejects (409) a number
 *      already verified on another account, and the DB `mobile_number` unique
 *      constraint is the final guard (a duplicate insert fails).
 *   4. JIT-provisioning sync safety: a transient Clerk identity-read failure
 *      does NOT downgrade a verified user (last-known local state is kept),
 *      while a definitive "email now unverified" identity DOES sync down —
 *      proving the transient-failure guard is what protected the user.
 *   5. Activation-gate routing (end-to-end via the `/me` contract the
 *      frontend `ActivationGate` consumes): as a signed-in user progresses
 *      through the stages, `/me` returns exactly the flag combination that
 *      routes the gate to the email screen → /onboarding → /verify-mobile →
 *      the activated app.
 *
 * The live SMS provider is forced OFFLINE for this process (the
 * `AUTHENTICA_API_KEY` env var is deleted BEFORE importing the app, mirroring
 * how `adminSync.e2e.ts` forces the offline mock football provider) so no real
 * SMS is ever sent. Clerk identity reads (`clerkClient.users.getUser`, used by
 * the on-read sync) are stubbed per-user so the email-verified state is fully
 * deterministic; the real JWT is still minted and verified by the middleware,
 * so authentication is exercised end-to-end.
 *
 * Every fixture is seeded directly and reverted at the end, leaving the DB as
 * found (matching the sibling e2e suites).
 *
 * Run with: pnpm --filter @workspace/api-server test
 */

// Force the SMS provider offline for this process BEFORE the app (and the
// memoized SMS service) is imported, so `send-otp` past the prerequisite gate
// returns 503 instead of dispatching a real OTP.
delete process.env.AUTHENTICA_API_KEY;

import { and, eq, inArray } from "drizzle-orm";
import { clerkClient } from "@clerk/express";
import {
  db,
  pool,
  usersTable,
  profilesTable,
  mobileVerificationsTable,
  teamsTable,
} from "@workspace/db";
import app from "../src/app";

const CLERK_API = "https://api.clerk.com/v1";
const USER_AGENT = "thaddi-activation-e2e/1.0";

const SECRET = process.env.CLERK_SECRET_KEY;
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
if (!SECRET) throw new Error("CLERK_SECRET_KEY is required");

// ---- Tiny assertion harness -------------------------------------------------

let passed = 0;
const failures: string[] = [];

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed += 1;
    console.log(`  \u2713 ${label}`);
  } else {
    const msg = detail ? `${label} \u2014 ${detail}` : label;
    failures.push(msg);
    console.error(`  \u2717 ${msg}`);
  }
}

// ---- Deterministic Clerk identity stub --------------------------------------
//
// `getOrProvisionUser` calls `clerkClient.users.getUser` on every read to sync
// the email + email-verified state from Clerk (the source of truth for email
// auth). We stub it per clerk user id so each activation stage is deterministic
// and so we can simulate a transient failure (throw) without deleting the
// underlying Clerk user (which would also invalidate the minted JWT).

type StubIdentity =
  | { email: string | null; emailVerified: boolean }
  | "throw";

const identityStub = new Map<string, StubIdentity>();

// Touch the proxy once so the lazily-created singleton client exists, then grab
// the (stable) users API object and override its getUser method in place.
const usersApi = clerkClient.users;
const realGetUser = usersApi.getUser.bind(usersApi);
usersApi.getUser = (async (clerkUserId: string) => {
  const entry = identityStub.get(clerkUserId);
  if (entry === "throw") {
    throw new Error("simulated transient Clerk failure");
  }
  if (entry) {
    return {
      id: clerkUserId,
      primaryEmailAddressId: "primary",
      emailAddresses: [
        {
          id: "primary",
          emailAddress: entry.email,
          verification: {
            status: entry.emailVerified ? "verified" : "unverified",
          },
        },
      ],
    } as any;
  }
  return realGetUser(clerkUserId);
}) as typeof usersApi.getUser;

// ---- Clerk admin REST helpers ----------------------------------------------

async function clerk<T = any>(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: T }> {
  const res = await fetch(CLERK_API + path, {
    method,
    headers: {
      Authorization: `Bearer ${SECRET}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: T;
  try {
    data = JSON.parse(text) as T;
  } catch {
    data = text as unknown as T;
  }
  return { status: res.status, data };
}

async function createClerkUser(email: string): Promise<string> {
  const { status, data } = await clerk<{ id: string }>("POST", "/users", {
    email_address: [email],
    password: `Aa1!${Math.random().toString(36).slice(2)}`,
    skip_password_checks: true,
    skip_legal_checks: true,
  });
  if (status >= 400) {
    throw new Error(
      `Clerk create user failed (${status}): ${JSON.stringify(data)}`,
    );
  }
  return data.id;
}

async function mintSessionToken(clerkUserId: string): Promise<string> {
  const sess = await clerk<{ id: string }>("POST", "/sessions", {
    user_id: clerkUserId,
  });
  if (sess.status >= 400) {
    throw new Error(
      `Clerk create session failed (${sess.status}): ${JSON.stringify(sess.data)}`,
    );
  }
  const tok = await clerk<{ jwt: string }>(
    "POST",
    `/sessions/${sess.data.id}/tokens`,
    {},
  );
  if (tok.status >= 400 || !tok.data.jwt) {
    throw new Error(
      `Clerk mint token failed (${tok.status}): ${JSON.stringify(tok.data)}`,
    );
  }
  return tok.data.jwt;
}

async function deleteClerkUser(clerkUserId: string): Promise<void> {
  try {
    await clerk("DELETE", `/users/${clerkUserId}`);
  } catch (err) {
    console.warn(`Failed to delete Clerk user ${clerkUserId}:`, err);
  }
}

// ---- API request helper -----------------------------------------------------

let baseUrl = "";

async function api(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = { "User-Agent": USER_AGENT };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`;
  const res = await fetch(baseUrl + path, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

// ---- Fixture helpers --------------------------------------------------------

interface SeededUser {
  clerkId: string;
  userId: string;
  email: string;
  token: string;
}

// Seed a Clerk user + a local user row + profile at a given activation stage.
async function seedUser(
  label: string,
  stamp: number,
  opts: {
    emailVerified?: boolean;
    profileComplete?: boolean;
    mobileVerified?: boolean;
    mobileNumber?: string | null;
  } = {},
): Promise<SeededUser> {
  const {
    emailVerified = false,
    profileComplete = false,
    mobileVerified = false,
    mobileNumber = null,
  } = opts;
  const email = `thaddi-activation-e2e-${label}-${stamp}@example.com`;
  const clerkId = await createClerkUser(email);
  // Keep the on-read identity sync in agreement with the seeded local state.
  identityStub.set(clerkId, { email, emailVerified });
  const [row] = await db
    .insert(usersTable)
    .values({
      clerkUserId: clerkId,
      email,
      emailVerified,
      mobileVerified,
      mobileNumber,
      status: "active",
    })
    .returning();
  await db.insert(profilesTable).values({
    userId: row.id,
    displayName: profileComplete ? `E2E ${label} ${stamp}` : null,
    username: profileComplete ? `e2e_${label}_${stamp}` : null,
  });
  const token = await mintSessionToken(clerkId);
  return { clerkId, userId: row.id, email, token };
}

// Move a seeded user to a new activation stage (mirrors the real flow's state
// transitions) and keep the Clerk identity stub consistent.
async function setStage(
  user: SeededUser,
  stage: {
    emailVerified: boolean;
    profileComplete: boolean;
    mobileVerified: boolean;
    favoriteTeamSelected?: boolean;
  },
): Promise<void> {
  identityStub.set(user.clerkId, {
    email: user.email,
    emailVerified: stage.emailVerified,
  });
  let favoriteTeamId: string | null = null;
  if (stage.favoriteTeamSelected) {
    const rows = await db.select({ id: teamsTable.id }).from(teamsTable).limit(1);
    favoriteTeamId = rows[0]?.id ?? null;
  }
  await db
    .update(usersTable)
    .set({
      emailVerified: stage.emailVerified,
      mobileVerified: stage.mobileVerified,
      favoriteTeamId,
    })
    .where(eq(usersTable.id, user.userId));
  await db
    .update(profilesTable)
    .set({
      displayName: stage.profileComplete ? `E2E ${user.userId}` : null,
      username: stage.profileComplete
        ? `e2e_${user.userId.replace(/-/g, "").slice(0, 16)}`
        : null,
    })
    .where(eq(profilesTable.userId, user.userId));
}

// Mirror of the frontend ActivationGate routing decision (ClerkConfig.tsx).
// The gate is a pure function of the `/me` flags, so asserting the route here
// is an end-to-end check of the data contract that drives it.
function gateRoute(me: {
  emailVerified: boolean;
  profileComplete: boolean;
  mobileVerified: boolean;
  favoriteTeamSelected: boolean;
  activated: boolean;
}): string {
  if (!me.emailVerified) return "email-gate";
  if (!me.profileComplete) return "/onboarding";
  if (!me.mobileVerified) return "/verify-mobile";
  if (!me.favoriteTeamSelected) return "/pick-team";
  if (me.activated) return "children";
  return "verifying";
}

// ---- Main -------------------------------------------------------------------

async function main(): Promise<void> {
  const stamp = Date.now();

  const server = await new Promise<import("http").Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  baseUrl = `http://127.0.0.1:${port}/api`;

  const created: { clerkIds: string[]; userIds: string[] } = {
    clerkIds: [],
    userIds: [],
  };
  const track = (u: SeededUser) => {
    created.clerkIds.push(u.clerkId);
    created.userIds.push(u.userId);
    return u;
  };

  const validPhone = `+9665${String(stamp).slice(-8)}`;

  try {
    // ===================================================================
    // Test 1: activation ordering guard (mobile OTP requires email+profile)
    // ===================================================================
    console.log("\nActivation ordering guard (send-otp / verify-otp):");

    // Stage: email NOT verified, profile incomplete.
    const gateUser = track(
      await seedUser("gate", stamp, {
        emailVerified: false,
        profileComplete: false,
      }),
    );

    const sendUnverified = await api("POST", "/me/mobile/send-otp", {
      token: gateUser.token,
      body: { phoneNumber: validPhone },
    });
    check(
      "send-otp rejected when email unverified (409)",
      sendUnverified.status === 409,
      `got ${sendUnverified.status}: ${JSON.stringify(sendUnverified.data).slice(0, 160)}`,
    );

    const verifyUnverified = await api("POST", "/me/mobile/verify-otp", {
      token: gateUser.token,
      body: { code: "123456" },
    });
    check(
      "verify-otp rejected when email unverified (409)",
      verifyUnverified.status === 409,
      `got ${verifyUnverified.status}: ${JSON.stringify(verifyUnverified.data).slice(0, 160)}`,
    );

    // Stage: email verified, profile STILL incomplete.
    await setStage(gateUser, {
      emailVerified: true,
      profileComplete: false,
      mobileVerified: false,
    });

    const sendNoProfile = await api("POST", "/me/mobile/send-otp", {
      token: gateUser.token,
      body: { phoneNumber: validPhone },
    });
    check(
      "send-otp rejected when profile incomplete (409)",
      sendNoProfile.status === 409,
      `got ${sendNoProfile.status}: ${JSON.stringify(sendNoProfile.data).slice(0, 160)}`,
    );

    const verifyNoProfile = await api("POST", "/me/mobile/verify-otp", {
      token: gateUser.token,
      body: { code: "123456" },
    });
    check(
      "verify-otp rejected when profile incomplete (409)",
      verifyNoProfile.status === 409,
      `got ${verifyNoProfile.status}: ${JSON.stringify(verifyNoProfile.data).slice(0, 160)}`,
    );

    // Stage: email verified AND profile complete -> the guard must let the
    // request through. With the SMS provider forced offline it reaches the
    // service stage and returns 503 (NOT the 409 prerequisite rejection).
    await setStage(gateUser, {
      emailVerified: true,
      profileComplete: true,
      mobileVerified: false,
    });

    const sendEligible = await api("POST", "/me/mobile/send-otp", {
      token: gateUser.token,
      body: { phoneNumber: validPhone },
    });
    check(
      "send-otp passes the prerequisite gate once email+profile complete",
      sendEligible.status === 503,
      `expected 503 (provider offline); got ${sendEligible.status}: ${JSON.stringify(sendEligible.data).slice(0, 160)}`,
    );

    // ===================================================================
    // Test 2: OTP expiry handling
    // ===================================================================
    console.log("\nOTP expiry handling:");

    // Insert a pending attempt that has already expired. verify-otp must reject
    // it and flip its status to `expired` BEFORE contacting the provider.
    const [staleAttempt] = await db
      .insert(mobileVerificationsTable)
      .values({
        userId: gateUser.userId,
        phoneNumber: validPhone,
        status: "pending",
        provider: "authentica",
        expiresAt: new Date(Date.now() - 60 * 1000),
      })
      .returning();

    const verifyExpired = await api("POST", "/me/mobile/verify-otp", {
      token: gateUser.token,
      body: { code: "123456" },
    });
    check(
      "verify-otp rejects an expired pending attempt (400)",
      verifyExpired.status === 400,
      `got ${verifyExpired.status}: ${JSON.stringify(verifyExpired.data).slice(0, 160)}`,
    );

    const refreshed = await db.query.mobileVerificationsTable.findFirst({
      where: eq(mobileVerificationsTable.id, staleAttempt.id),
    });
    check(
      "expired attempt is marked `expired` in the DB",
      refreshed?.status === "expired",
      `status=${refreshed?.status}`,
    );

    // With no live pending attempt left, verify-otp reports there is nothing to
    // verify (still 400, before the provider).
    const verifyNoPending = await api("POST", "/me/mobile/verify-otp", {
      token: gateUser.token,
      body: { code: "123456" },
    });
    check(
      "verify-otp rejects when there is no pending attempt (400)",
      verifyNoPending.status === 400,
      `got ${verifyNoPending.status}: ${JSON.stringify(verifyNoPending.data).slice(0, 160)}`,
    );

    // ===================================================================
    // Test 3: one-mobile-per-account uniqueness
    // ===================================================================
    console.log("\nOne-mobile-per-account uniqueness:");

    const takenPhone = `+9665${String(stamp + 1).slice(-8)}`;
    // An already-activated account that owns `takenPhone`.
    const ownerOfPhone = track(
      await seedUser("phoneowner", stamp, {
        emailVerified: true,
        profileComplete: true,
        mobileVerified: true,
        mobileNumber: takenPhone,
      }),
    );

    // A second, eligible (email+profile) account tries to claim the same number.
    const claimant = track(
      await seedUser("claimant", stamp, {
        emailVerified: true,
        profileComplete: true,
        mobileVerified: false,
      }),
    );

    const dupSend = await api("POST", "/me/mobile/send-otp", {
      token: claimant.token,
      body: { phoneNumber: takenPhone },
    });
    check(
      "send-otp rejects a number already verified on another account (409)",
      dupSend.status === 409,
      `got ${dupSend.status}: ${JSON.stringify(dupSend.data).slice(0, 160)}`,
    );

    // The DB unique constraint on users.mobile_number is the final guard.
    let dbGuardFired = false;
    try {
      await db
        .update(usersTable)
        .set({ mobileNumber: takenPhone, mobileVerified: true })
        .where(eq(usersTable.id, claimant.userId));
    } catch {
      dbGuardFired = true;
    }
    check(
      "DB unique constraint blocks a duplicate mobile_number",
      dbGuardFired,
      `expected the duplicate update to throw (owner=${ownerOfPhone.userId})`,
    );

    // ===================================================================
    // Test 4: JIT-provisioning sync — transient Clerk failure must not
    //         downgrade a verified user
    // ===================================================================
    console.log("\nJIT-provisioning sync safety:");

    const syncUser = track(
      await seedUser("sync", stamp, {
        emailVerified: true,
        profileComplete: true,
        mobileVerified: true,
      }),
    );

    // Simulate a transient Clerk identity-read failure: /me must keep the
    // last-known verified state (no downgrade).
    identityStub.set(syncUser.clerkId, "throw");
    const meDuringOutage = await api("GET", "/me", { token: syncUser.token });
    check(
      "transient Clerk failure does NOT downgrade a verified user",
      meDuringOutage.status === 200 &&
        meDuringOutage.data?.emailVerified === true,
      `status=${meDuringOutage.status} emailVerified=${meDuringOutage.data?.emailVerified}`,
    );

    // Contrast: a DEFINITIVE "email now unverified" identity DOES sync down,
    // proving the on-read sync is active and the transient guard above is what
    // protected the user.
    identityStub.set(syncUser.clerkId, {
      email: syncUser.email,
      emailVerified: false,
    });
    const meAfterDefinitive = await api("GET", "/me", {
      token: syncUser.token,
    });
    check(
      "a definitive unverified identity DOES downgrade (sync is active)",
      meAfterDefinitive.status === 200 &&
        meAfterDefinitive.data?.emailVerified === false,
      `status=${meAfterDefinitive.status} emailVerified=${meAfterDefinitive.data?.emailVerified}`,
    );

    // ===================================================================
    // Test 5: activation-gate routing end-to-end (the /me contract)
    // ===================================================================
    console.log("\nActivation-gate routing (via /me):");

    const flowUser = track(
      await seedUser("flow", stamp, {
        emailVerified: false,
        profileComplete: false,
        mobileVerified: false,
      }),
    );

    const stages: {
      label: string;
      stage: {
        emailVerified: boolean;
        profileComplete: boolean;
        mobileVerified: boolean;
        favoriteTeamSelected?: boolean;
      };
      expectedRoute: string;
    }[] = [
      {
        label: "unverified email -> email gate screen",
        stage: {
          emailVerified: false,
          profileComplete: false,
          mobileVerified: false,
        },
        expectedRoute: "email-gate",
      },
      {
        label: "email verified, no profile -> /onboarding",
        stage: {
          emailVerified: true,
          profileComplete: false,
          mobileVerified: false,
        },
        expectedRoute: "/onboarding",
      },
      {
        label: "profile complete, no mobile -> /verify-mobile",
        stage: {
          emailVerified: true,
          profileComplete: true,
          mobileVerified: false,
        },
        expectedRoute: "/verify-mobile",
      },
      {
        label: "mobile verified, no team -> /pick-team",
        stage: {
          emailVerified: true,
          profileComplete: true,
          mobileVerified: true,
          favoriteTeamSelected: false,
        },
        expectedRoute: "/pick-team",
      },
      {
        label: "fully activated -> renders the app",
        stage: {
          emailVerified: true,
          profileComplete: true,
          mobileVerified: true,
          favoriteTeamSelected: true,
        },
        expectedRoute: "children",
      },
    ];

    for (const { label, stage, expectedRoute } of stages) {
      await setStage(flowUser, stage);
      const me = await api("GET", "/me", { token: flowUser.token });
      const route = me.status === 200 ? gateRoute(me.data) : `http-${me.status}`;
      check(
        `gate routing: ${label}`,
        me.status === 200 && route === expectedRoute,
        `status=${me.status} route=${route} expected=${expectedRoute} ` +
          `flags={email:${me.data?.emailVerified},profile:${me.data?.profileComplete},mobile:${me.data?.mobileVerified},team:${me.data?.favoriteTeamSelected},activated:${me.data?.activated}}`,
      );
    }

    // -------------------------------------------------------------------
    // Extra: server-side enforcement — prediction write requires favoriteTeam
    //
    // PUT /matches/:id/prediction calls requireActivatedUser which now checks
    // favoriteTeamId != null. A dummy match UUID triggers the 403 BEFORE any
    // match lookup, so no real match fixture is needed.
    // -------------------------------------------------------------------
    console.log("\nPrediction-gate enforcement (server-side favoriteTeam check):");

    const dummyMatchId = "00000000-0000-0000-0000-000000000001";

    // Stage: all verified but NO team → activated=false → 403
    await setStage(flowUser, {
      emailVerified: true,
      profileComplete: true,
      mobileVerified: true,
      favoriteTeamSelected: false,
    });
    const predNoTeam = await api("PUT", `/matches/${dummyMatchId}/prediction`, {
      token: flowUser.token,
      body: { homeScore: 1, awayScore: 0 },
    });
    check(
      "prediction write blocked (403) when favorite team not selected",
      predNoTeam.status === 403,
      `status=${predNoTeam.status}`,
    );

    // Stage: all verified WITH team → activated=true → past the activation gate
    // (returns 404 or 409 for the dummy match, NOT 403)
    await setStage(flowUser, {
      emailVerified: true,
      profileComplete: true,
      mobileVerified: true,
      favoriteTeamSelected: true,
    });
    const predWithTeam = await api("PUT", `/matches/${dummyMatchId}/prediction`, {
      token: flowUser.token,
      body: { homeScore: 1, awayScore: 0 },
    });
    check(
      "prediction write allowed past activation gate once team is selected (not 403)",
      predWithTeam.status !== 403,
      `status=${predWithTeam.status}`,
    );

    // Extra: favourite-team pick is now changeable — a second PATCH returns 200
    // and actually switches the user to a DIFFERENT team than before.
    console.log("\nFavourite-team changeable:");
    const meBeforeChange = await api("GET", "/me", { token: flowUser.token });
    const currentTeamId: string | null =
      meBeforeChange.data?.favoriteTeam?.id ?? null;
    const someTeams = await db
      .select({ id: teamsTable.id })
      .from(teamsTable)
      .limit(5);
    // Pick a team that differs from the current favourite so the assertion
    // proves a real change, not a no-op re-selection.
    const newTeamId =
      someTeams.find((c) => c.id !== currentTeamId)?.id ??
      someTeams[0]?.id ??
      "00000000-0000-0000-0000-000000000001";
    check(
      "test setup: a different team is available to switch to",
      newTeamId !== currentTeamId,
      `current=${currentTeamId} new=${newTeamId}`,
    );
    const secondPick = await api("PATCH", "/me/favorite-team", {
      token: flowUser.token,
      body: { teamId: newTeamId },
    });
    check(
      "second favourite-team pick returns 200 (changeable)",
      secondPick.status === 200,
      `status=${secondPick.status}`,
    );
    check(
      "favourite-team change switched to the new team",
      secondPick.data?.favoriteTeam?.id === newTeamId,
      `favoriteTeam=${secondPick.data?.favoriteTeam?.id} expected=${newTeamId}`,
    );
  } finally {
    // --- Teardown: revert everything we created (child -> parent) ---
    console.log("\nTeardown:");
    const safe = async (label: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (err) {
        console.warn(`  teardown ${label} failed:`, err);
      }
    };

    if (created.userIds.length) {
      await safe("mobile_verifications", () =>
        db
          .delete(mobileVerificationsTable)
          .where(inArray(mobileVerificationsTable.userId, created.userIds)),
      );
      await safe("profiles", () =>
        db
          .delete(profilesTable)
          .where(inArray(profilesTable.userId, created.userIds)),
      );
      await safe("users", () =>
        db.delete(usersTable).where(inArray(usersTable.id, created.userIds)),
      );
    }
    for (const id of created.clerkIds) await deleteClerkUser(id);

    usersApi.getUser = realGetUser as typeof usersApi.getUser;
    await safe(
      "server close",
      () => new Promise((r) => server.close(() => r(null))),
    );
    await safe("pool end", () => pool.end());
  }

  // --- Report ---
  console.log(`\n${"=".repeat(60)}`);
  if (failures.length === 0) {
    console.log(`Activation-flow regression: ALL ${passed} checks passed.`);
  } else {
    console.error(
      `Activation-flow regression: ${failures.length} FAILED, ${passed} passed.`,
    );
    for (const f of failures) console.error(`  - ${f}`);
  }
  console.log("=".repeat(60));
}

main()
  .then(() => {
    process.exit(failures.length === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error("Activation-flow regression crashed:", err);
    process.exit(1);
  });
