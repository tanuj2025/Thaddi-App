import { Router, type IRouter } from "express";
import { and, eq, ne, desc } from "drizzle-orm";
import {
  db,
  usersTable,
  mobileVerificationsTable,
} from "@workspace/db";
import { SendMobileOtpBody, VerifyMobileOtpBody } from "@workspace/api-zod";
import {
  requireCurrentUser,
  serializeCurrentUser,
} from "../lib/currentUser";
import { normalizeSaudiMobile } from "../lib/phone";
import { getSmsVerificationService } from "../services/smsVerification";

const router: IRouter = Router();

router.post("/me/mobile/send-otp", async (req, res) => {
  const record = await requireCurrentUser(req, res);
  if (!record) return;

  const parsed = SendMobileOtpBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Phone number is required" });
    return;
  }
  const phone = normalizeSaudiMobile(parsed.data.phoneNumber);
  if (!phone) {
    res.status(400).json({ error: "Enter a valid Saudi mobile number" });
    return;
  }

  // One mobile number per account (anti-cheating).
  const taken = await db.query.usersTable.findFirst({
    where: and(
      eq(usersTable.mobileNumber, phone),
      eq(usersTable.mobileVerified, true),
      ne(usersTable.id, record.user.id),
    ),
  });
  if (taken) {
    res
      .status(409)
      .json({ error: "This mobile number is already in use by another account" });
    return;
  }

  const service = getSmsVerificationService();
  if (!service) {
    res.status(503).json({
      error: "Mobile verification is temporarily unavailable",
    });
    return;
  }

  const result = await service.sendOtp(phone);
  if (!result.success) {
    res.status(400).json({ error: result.message });
    return;
  }

  await db.insert(mobileVerificationsTable).values({
    userId: record.user.id,
    phoneNumber: phone,
    status: "pending",
    provider: service.name,
    providerRef: result.providerRef ?? null,
    expiresAt: result.expiresInSeconds
      ? new Date(Date.now() + result.expiresInSeconds * 1000)
      : null,
  });

  res.json({
    success: true,
    message: result.message,
    expiresInSeconds: result.expiresInSeconds,
  });
});

router.post("/me/mobile/verify-otp", async (req, res) => {
  const record = await requireCurrentUser(req, res);
  if (!record) return;

  const parsed = VerifyMobileOtpBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Verification code is required" });
    return;
  }

  const attempt = await db.query.mobileVerificationsTable.findFirst({
    where: and(
      eq(mobileVerificationsTable.userId, record.user.id),
      eq(mobileVerificationsTable.status, "pending"),
    ),
    orderBy: [desc(mobileVerificationsTable.requestedAt)],
  });
  if (!attempt) {
    res
      .status(400)
      .json({ error: "No pending verification. Request a new code." });
    return;
  }

  const service = getSmsVerificationService();
  if (!service) {
    res.status(503).json({
      error: "Mobile verification is temporarily unavailable",
    });
    return;
  }

  const result = await service.verifyOtp(attempt.phoneNumber, parsed.data.code);
  if (!result.success) {
    res.status(400).json({ error: result.message });
    return;
  }

  // Re-check uniqueness at verification time (the unique constraint is the
  // final guard).
  const taken = await db.query.usersTable.findFirst({
    where: and(
      eq(usersTable.mobileNumber, attempt.phoneNumber),
      eq(usersTable.mobileVerified, true),
      ne(usersTable.id, record.user.id),
    ),
  });
  if (taken) {
    res
      .status(409)
      .json({ error: "This mobile number is already in use by another account" });
    return;
  }

  await db
    .update(mobileVerificationsTable)
    .set({ status: "verified", verifiedAt: new Date() })
    .where(eq(mobileVerificationsTable.id, attempt.id));

  const [user] = await db
    .update(usersTable)
    .set({
      mobileNumber: attempt.phoneNumber,
      mobileVerified: true,
      updatedAt: new Date(),
    })
    .where(eq(usersTable.id, record.user.id))
    .returning();

  res.json(serializeCurrentUser({ user, profile: record.profile }));
});

export default router;
