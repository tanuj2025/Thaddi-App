import { eq } from "drizzle-orm";
import { db, challengesTable } from "@workspace/db";

// Unambiguous alphabet (no 0/O/1/I) for short, WhatsApp-friendly codes.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;

function randomCode(): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

// Generates a code that is unique across the challenges table. Retries on the
// (rare) collision before giving up.
export async function generateInviteCode(): Promise<string> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const code = randomCode();
    const clash = await db.query.challengesTable.findFirst({
      where: eq(challengesTable.inviteCode, code),
    });
    if (!clash) return code;
  }
  throw new Error("Could not generate a unique invite code");
}

// Returns the canonical production join URL so mobile clients and QR codes
// always encode a tappable absolute link.
// Set APP_BASE_URL in the environment to override (e.g. for local dev / tests).
const APP_BASE_URL =
  (process.env.APP_BASE_URL ?? "https://thaddi.app").replace(/\/$/, "");

export function inviteLinkFor(code: string): string {
  return `${APP_BASE_URL}/join/${code}`;
}
