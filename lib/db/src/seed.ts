/**
 * CLI entry point for seeding THADDI reference data.
 *
 * Run: pnpm --filter @workspace/db run seed
 *
 * The actual seed logic lives in `seed-reference.ts` (exported as
 * `seedReferenceData`) so it can be shared with the admin API.
 */
import { pool } from "./index";
import { seedReferenceData } from "./seed-reference";

seedReferenceData()
  .then(async (summary) => {
    console.log("Seed complete. New rows inserted:", summary);
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("Seed failed:", err);
    await pool.end();
    process.exit(1);
  });
