// Normalizes Saudi mobile numbers to E.164 (+9665XXXXXXXX).
// Accepts: 05XXXXXXXX, 5XXXXXXXX, 9665XXXXXXXX, +9665XXXXXXXX (with spaces/dashes).
export function normalizeSaudiMobile(input: string): string | null {
  const digits = (input || "").replace(/[\s\-()]/g, "");
  let local: string | null = null;

  if (/^\+9665\d{8}$/.test(digits)) {
    local = digits.slice(4); // strip +966
  } else if (/^009665\d{8}$/.test(digits)) {
    local = digits.slice(5);
  } else if (/^9665\d{8}$/.test(digits)) {
    local = digits.slice(3);
  } else if (/^05\d{8}$/.test(digits)) {
    local = digits.slice(1);
  } else if (/^5\d{8}$/.test(digits)) {
    local = digits;
  }

  if (!local) return null;
  return `+966${local}`;
}
