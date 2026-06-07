/**
 * Account-change (mobile number) flow regression test.
 *
 * The self-service "change mobile number" dialog reuses the activation OTP
 * endpoints (`POST /me/mobile/send-otp`, `POST /me/mobile/verify-otp`), so this
 * suite drives those endpoints in-process (Express app booted on an ephemeral
 * port, exactly like `playerFlows.e2e.ts`) against a LOCAL stub of the SMS
 * provider (Authentica). It exercises the branching that carries real risk:
 *
 *   send-otp:
 *     1. unauthenticated  -> 401
 *     2. activation prerequisites not met (email unverified / incomplete
 *        profile) -> 409
 *     3. invalid Saudi mobile number -> 400
 *     4. number already verified on ANOTHER account -> 409 (anti-cheating)
 *     5. happy path -> 200 + a pending `mobile_verifications` row is recorded
 *
 *   verify-otp:
 *     6. provider rejects the code (wrong OTP) -> 400, no mutation
 *     7. the pending code has expired -> 400 + the attempt is marked `expired`
 *        (the expiry guard runs BEFORE the provider is contacted)
 *     8. the number got taken by another account between send and verify -> 409
 *     9. happy path -> 200, the user's mobileNumber is set + mobileVerified=true
 *        and the attempt row flips to `verified`
 *
 * A local HTTP stub stands in for Authentica: `AUTHENTICA_API_KEY` +
 * `AUTHENTICA_BASE_URL` are pointed at it BEFORE any request (the provider is
 * constructed lazily on first use, so setting env at top-level is sufficient).
 * Every fixture is seeded directly and reverted at the end, leaving the DB as
 * found.
 *
 * Run with: pnpm --filter @workspace/api-server test
 */

import { createServer, type Server as HttpServer } from "http";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  pool,
  usersTable,
  profilesTable,
  mobileVerificationsTable,
} from "@workspace/db";

// ---- Stub the SMS provider BEFORE importing the app/service ----------------
// The Authentica service reads these at construction time (lazily, on the first
// request), so assigning them here — before any endpoint is hit — is enough to
// make `getSmsVerificationService()` resolve to a working provider that talks to
// our local stub instead of the real network.
const VALID_OTP = "123456";
const smsStub: HttpServer = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    let payload: any = {};
    try {
      payload = JSON.parse(body || "{}");
    } catch {
      payload = {};
    }
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/send-otp") {
      res.statusCode = 200;
      res.end(JSON.stringify({ success: true, message: "sent", id: "stub-ref" }));
      return;
    }
    if (req.url === "/verify-otp") {
      if (payload.otp === VALID_OTP) {
        res.statusCode = 200;
        res.end(JSON.stringify({ success: true, message: "ok" }));
      } else {
        res.statusCode = 400;
        res.end(JSON.stringify({ message: "Invalid or expired code" }));
      }
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ message: "not found" }));
  });
});

const CLERK_API = "https://api.clerk.com/v1";
const USER_AGENT = "thaddi-account-e2e/1.0";

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
    password: `Aa1!${email}${Date.now()}`,
    skip_password_checks: true,
    skip_legal_checks: true,
  });
  if (status >= 400) {
    throw new Error(`Clerk create user failed (${status}): ${JSON.stringify(data)}`);
  }
  return data.id;
}

async function mintSessionToken(clerkUserId: string): Promise<string> {
  const sess = await clerk<{ id: string }>("POST", "/sessions", {
    user_id: clerkUserId,
  });
  if (sess.status >= 400) {
    throw new Error(`Clerk create session failed (${sess.status}): ${JSON.stringify(sess.data)}`);
  }
  const tok = await clerk<{ jwt: string }>(
    "POST",
    `/sessions/${sess.data.id}/tokens`,
    {},
  );
  if (tok.status >= 400 || !tok.data.jwt) {
    throw new Error(`Clerk mint token failed (${tok.status}): ${JSON.stringify(tok.data)}`);
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

// Generate a deterministic-but-unique Saudi mobile in `05XXXXXXXX` form, which
// normalizes to `+9665XXXXXXXX`.
function makeMobile(seed: number): { input: string; normalized: string } {
  const eight = String(seed).padStart(8, "0").slice(-8);
  return { input: `05${eight}`, normalized: `+9665${eight}` };
}

async function seedUser(
  label: string,
  stamp: number,
  opts: {
    emailVerified?: boolean;
    mobileVerified?: boolean;
    mobileNumber?: string | null;
    completeProfile?: boolean;
  } = {},
): Promise<{ clerkId: string; userId: string; token: string }> {
  const email = `thaddi-account-e2e-${label}-${stamp}@example.com`;
  const clerkId = await createClerkUser(email);
  const [row] = await db
    .insert(usersTable)
    .values({
      clerkUserId: clerkId,
      email,
      emailVerified: opts.emailVerified ?? true,
      mobileVerified: opts.mobileVerified ?? false,
      mobileNumber: opts.mobileNumber ?? null,
      status: "active",
    })
    .returning();
  const complete = opts.completeProfile ?? true;
  await db.insert(profilesTable).values({
    userId: row.id,
    displayName: complete ? `E2E ${label} ${stamp}` : null,
    username: complete ? `e2e_acct_${label}_${stamp}` : null,
  });
  const token = await mintSessionToken(clerkId);
  return { clerkId, userId: row.id, token };
}

// ---- Main -------------------------------------------------------------------

async function main(): Promise<void> {
  const stamp = Date.now();

  // Boot the SMS provider stub and point the service at it.
  const stubPort = await new Promise<number>((resolve) => {
    smsStub.listen(0, () => {
      const a = smsStub.address();
      resolve(typeof a === "object" && a ? a.port : 0);
    });
  });
  process.env.AUTHENTICA_API_KEY = "stub-key";
  process.env.AUTHENTICA_BASE_URL = `http://127.0.0.1:${stubPort}`;

  const { default: app } = await import("../src/app");

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

  try {
    // --- Seed users ---
    // Fully-activatable user (email verified + complete profile, mobile not yet
    // verified) — the account performing a mobile change.
    const changer = await seedUser("changer", stamp, {
      emailVerified: true,
      mobileVerified: false,
      completeProfile: true,
    });
    // A user with an INCOMPLETE profile — fails the activation gate. (Email
    // verification can't be forced off here: Clerk-created emails come back
    // verified and the on-read identity sync restores emailVerified=true, so we
    // exercise the gate via the profile-complete half of the prerequisite.)
    const unready = await seedUser("unready", stamp, {
      emailVerified: true,
      completeProfile: false,
    });
    for (const u of [changer, unready]) {
      created.clerkIds.push(u.clerkId);
      created.userIds.push(u.userId);
    }

    // A bystander who already owns a verified mobile number (used for the
    // "number already in use" rejections).
    const taken = makeMobile(stamp % 100000000);
    const owner = await seedUser("owner", stamp + 1, {
      emailVerified: true,
      mobileVerified: true,
      mobileNumber: taken.normalized,
      completeProfile: true,
    });
    created.clerkIds.push(owner.clerkId);
    created.userIds.push(owner.userId);

    // =================================================================
    // send-otp
    // =================================================================
    console.log("\nsend-otp:");

    const fresh = makeMobile((stamp + 7) % 100000000);

    const sendUnauth = await api("POST", "/me/mobile/send-otp", {
      body: { phoneNumber: fresh.input },
    });
    check(
      "send-otp unauthenticated -> 401",
      sendUnauth.status === 401,
      `got ${sendUnauth.status}`,
    );

    const sendUnready = await api("POST", "/me/mobile/send-otp", {
      token: unready.token,
      body: { phoneNumber: fresh.input },
    });
    check(
      "send-otp before email verified / profile complete -> 409",
      sendUnready.status === 409,
      `got ${sendUnready.status}: ${JSON.stringify(sendUnready.data).slice(0, 140)}`,
    );

    const sendBadPhone = await api("POST", "/me/mobile/send-otp", {
      token: changer.token,
      body: { phoneNumber: "123" },
    });
    check(
      "send-otp with an invalid Saudi number -> 400",
      sendBadPhone.status === 400,
      `got ${sendBadPhone.status}: ${JSON.stringify(sendBadPhone.data).slice(0, 140)}`,
    );

    const sendTaken = await api("POST", "/me/mobile/send-otp", {
      token: changer.token,
      body: { phoneNumber: taken.input },
    });
    check(
      "send-otp for a number used by another account -> 409",
      sendTaken.status === 409,
      `got ${sendTaken.status}: ${JSON.stringify(sendTaken.data).slice(0, 140)}`,
    );

    const sendOk = await api("POST", "/me/mobile/send-otp", {
      token: changer.token,
      body: { phoneNumber: fresh.input },
    });
    check(
      "send-otp happy path -> 200 success",
      sendOk.status === 200 && sendOk.data?.success === true,
      `got ${sendOk.status}: ${JSON.stringify(sendOk.data).slice(0, 140)}`,
    );
    const pendingRows = await db
      .select()
      .from(mobileVerificationsTable)
      .where(
        and(
          eq(mobileVerificationsTable.userId, changer.userId),
          eq(mobileVerificationsTable.status, "pending"),
        ),
      );
    check(
      "send-otp records a pending verification for the normalized number",
      pendingRows.length === 1 &&
        pendingRows[0].phoneNumber === fresh.normalized,
      `rows=${pendingRows.length} phone=${pendingRows[0]?.phoneNumber}`,
    );

    // =================================================================
    // verify-otp
    // =================================================================
    console.log("\nverify-otp:");

    const verifyWrong = await api("POST", "/me/mobile/verify-otp", {
      token: changer.token,
      body: { code: "000000" },
    });
    check(
      "verify-otp with the wrong code -> 400",
      verifyWrong.status === 400,
      `got ${verifyWrong.status}: ${JSON.stringify(verifyWrong.data).slice(0, 140)}`,
    );
    const stillUnverified = await db.query.usersTable.findFirst({
      where: eq(usersTable.id, changer.userId),
    });
    check(
      "verify-otp wrong code leaves the account unverified",
      stillUnverified?.mobileVerified === false &&
        (stillUnverified?.mobileNumber ?? null) === null,
      `mobileVerified=${stillUnverified?.mobileVerified} number=${stillUnverified?.mobileNumber}`,
    );

    // Expired-code path: insert a pending attempt whose expiresAt is in the past
    // for a dedicated user, then verify -> 400 + the attempt is marked expired.
    const expiryUser = await seedUser("expiry", stamp + 2, {
      emailVerified: true,
      completeProfile: true,
    });
    created.clerkIds.push(expiryUser.clerkId);
    created.userIds.push(expiryUser.userId);
    const expired = makeMobile((stamp + 11) % 100000000);
    const [expiredRow] = await db
      .insert(mobileVerificationsTable)
      .values({
        userId: expiryUser.userId,
        phoneNumber: expired.normalized,
        status: "pending",
        provider: "authentica",
        expiresAt: new Date(Date.now() - 60 * 1000),
      })
      .returning();
    const verifyExpired = await api("POST", "/me/mobile/verify-otp", {
      token: expiryUser.token,
      body: { code: VALID_OTP },
    });
    check(
      "verify-otp with an expired code -> 400",
      verifyExpired.status === 400,
      `got ${verifyExpired.status}: ${JSON.stringify(verifyExpired.data).slice(0, 140)}`,
    );
    const expiredAfter = await db.query.mobileVerificationsTable.findFirst({
      where: eq(mobileVerificationsTable.id, expiredRow.id),
    });
    check(
      "expired attempt is marked 'expired' (before the provider is contacted)",
      expiredAfter?.status === "expired",
      `status=${expiredAfter?.status}`,
    );

    // Number-taken-at-verify path: a dedicated user has a pending attempt for a
    // number that another account verifies before they confirm -> 409.
    const raceUser = await seedUser("race", stamp + 3, {
      emailVerified: true,
      completeProfile: true,
    });
    created.clerkIds.push(raceUser.clerkId);
    created.userIds.push(raceUser.userId);
    const raced = makeMobile((stamp + 23) % 100000000);
    await db.insert(mobileVerificationsTable).values({
      userId: raceUser.userId,
      phoneNumber: raced.normalized,
      status: "pending",
      provider: "authentica",
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });
    // Another account claims that number in the meantime.
    const claimer = await seedUser("claimer", stamp + 4, {
      emailVerified: true,
      mobileVerified: true,
      mobileNumber: raced.normalized,
      completeProfile: true,
    });
    created.clerkIds.push(claimer.clerkId);
    created.userIds.push(claimer.userId);
    const verifyRaced = await api("POST", "/me/mobile/verify-otp", {
      token: raceUser.token,
      body: { code: VALID_OTP },
    });
    check(
      "verify-otp for a number taken since send-otp -> 409",
      verifyRaced.status === 409,
      `got ${verifyRaced.status}: ${JSON.stringify(verifyRaced.data).slice(0, 140)}`,
    );
    const raceUserAfter = await db.query.usersTable.findFirst({
      where: eq(usersTable.id, raceUser.userId),
    });
    check(
      "verify-otp 409 leaves the racing account unverified",
      raceUserAfter?.mobileVerified === false,
      `mobileVerified=${raceUserAfter?.mobileVerified}`,
    );

    // Happy path: the original changer verifies the real OTP -> their number is
    // set + verified and the pending attempt flips to 'verified'.
    const verifyOk = await api("POST", "/me/mobile/verify-otp", {
      token: changer.token,
      body: { code: VALID_OTP },
    });
    check(
      "verify-otp happy path -> 200",
      verifyOk.status === 200,
      `got ${verifyOk.status}: ${JSON.stringify(verifyOk.data).slice(0, 160)}`,
    );
    const changerAfter = await db.query.usersTable.findFirst({
      where: eq(usersTable.id, changer.userId),
    });
    check(
      "verify-otp sets the verified mobile number on the account",
      changerAfter?.mobileVerified === true &&
        changerAfter?.mobileNumber === fresh.normalized,
      `mobileVerified=${changerAfter?.mobileVerified} number=${changerAfter?.mobileNumber}`,
    );
    const verifiedAttempt = await db.query.mobileVerificationsTable.findFirst({
      where: and(
        eq(mobileVerificationsTable.userId, changer.userId),
        eq(mobileVerificationsTable.status, "verified"),
      ),
    });
    check(
      "the pending attempt is marked 'verified'",
      Boolean(verifiedAttempt) && verifiedAttempt?.verifiedAt != null,
      `verified=${Boolean(verifiedAttempt)} at=${verifiedAttempt?.verifiedAt}`,
    );
  } finally {
    // --- Teardown: delete everything created, leaving the DB as found ---
    if (created.userIds.length > 0) {
      await db
        .delete(mobileVerificationsTable)
        .where(inArray(mobileVerificationsTable.userId, created.userIds));
      await db
        .delete(profilesTable)
        .where(inArray(profilesTable.userId, created.userIds));
      await db
        .delete(usersTable)
        .where(inArray(usersTable.id, created.userIds));
    }
    for (const id of created.clerkIds) await deleteClerkUser(id);

    await new Promise<void>((resolve) => server.close(() => resolve()));
    await new Promise<void>((resolve) => smsStub.close(() => resolve()));
    await pool.end();
  }

  console.log(`\n${passed} checks passed, ${failures.length} failed.`);
  if (failures.length > 0) {
    console.error("\nFailures:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
