// Whether the live demo-data testing harness UI (admin nav item + route) should
// be shown. Always available outside production; in production it is OFF by
// default and only enabled when VITE_DEMO_HARNESS_PROD_ENABLED is set to a
// truthy value at build time. This mirrors the backend's isDemoHarnessEnabled()
// (DEMO_HARNESS_PROD_ENABLED) so the UI and API stay in lockstep.
export function isDemoHarnessEnabled(): boolean {
  if (!import.meta.env.PROD) return true;
  const raw = String(import.meta.env.VITE_DEMO_HARNESS_PROD_ENABLED ?? "")
    .trim()
    .toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}
