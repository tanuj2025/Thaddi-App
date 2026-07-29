import fs from "fs";
import path from "path";

// Load local environment variables from the root .env file
try {
  const envContent = fs.readFileSync("../../.env", "utf8");
  envContent.split("\n").forEach((line) => {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith("#")) return;
    const eqIdx = trimmedLine.indexOf("=");
    if (eqIdx > 0) {
      const key = trimmedLine.substring(0, eqIdx).trim();
      let val = trimmedLine.substring(eqIdx + 1).trim();
      if (val.startsWith('"') && val.endsWith('"')) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  });
} catch (e) {
  // Try fallback path if executed from root
  try {
    const envContent = fs.readFileSync(".env", "utf8");
    envContent.split("\n").forEach((line) => {
      const trimmedLine = line.trim();
      if (!trimmedLine || trimmedLine.startsWith("#")) return;
      const eqIdx = trimmedLine.indexOf("=");
      if (eqIdx > 0) {
        const key = trimmedLine.substring(0, eqIdx).trim();
        let val = trimmedLine.substring(eqIdx + 1).trim();
        if (val.startsWith('"') && val.endsWith('"')) {
          val = val.slice(1, -1);
        }
        process.env[key] = val;
      }
    });
  } catch (err) {}
}

const emailArg = process.argv[2];
if (!emailArg) {
  console.error("Error: Please provide an email address.");
  console.log("Usage: pnpm --filter @workspace/db run make-admin <email>");
  process.exit(1);
}

const targetEmail = emailArg.trim().toLowerCase();

async function run() {
  const { db, pool } = await import("./index");
  const { usersTable } = await import("./schema/users");
  const { eq } = await import("drizzle-orm");

  console.log(`Checking user with email: ${targetEmail}`);

  try {
    // 1. Check if the user already exists in the local database
    const existingUser = await db.query.usersTable.findFirst({
      where: eq(usersTable.email, targetEmail),
    });

    if (existingUser) {
      console.log(`User found! ID: ${existingUser.id}, Current Role: ${existingUser.role}`);
      
      // Update role and verification status
      await db
        .update(usersTable)
        .set({
          role: "admin",
          status: "active",
          emailVerified: true,
          mobileVerified: true,
          updatedAt: new Date(),
        })
        .where(eq(usersTable.id, existingUser.id));

      console.log(`Successfully updated ${targetEmail} to ADMIN and marked email & mobile as VERIFIED.`);
    } else {
      console.log(`No user with email ${targetEmail} exists in the local database yet.`);
      console.log(`\nTo make this work:`);
      console.log(`1. Run the app and sign up via the app UI using ${targetEmail} (which registers you in Clerk).`);
      console.log(`2. This will provision your local user row in the PostgreSQL database.`);
      console.log(`3. Re-run this script to promote that account to an admin.`);
      console.log(`\nAlternatively, you can add your email to BOOTSTRAP_ADMIN_EMAILS in d:/app/.env:`);
      console.log(`BOOTSTRAP_ADMIN_EMAILS="${targetEmail}"`);
      console.log(`This will automatically make you an admin the first time you sign in!`);
    }
  } catch (error) {
    console.error("Database operation failed:", error);
  } finally {
    await pool.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
