const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

function toAsciiDigits(value: string): string {
  return Array.from(value, (character) => {
    const arabicIndex = ARABIC_DIGITS.indexOf(character);
    if (arabicIndex >= 0) return String(arabicIndex);

    const persianIndex = PERSIAN_DIGITS.indexOf(character);
    if (persianIndex >= 0) return String(persianIndex);

    return character;
  }).join("");
}

/** Keep pasted/native OTP input numeric and bounded for the API contract. */
export function normalizeOtp(value: string): string {
  return toAsciiDigits(value).replace(/\D/g, "").slice(0, 8);
}

export function isValidOtp(value: string): boolean {
  return /^[0-9]{4,8}$/.test(value);
}