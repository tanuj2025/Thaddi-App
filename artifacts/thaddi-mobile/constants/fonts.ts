/**
 * Brand typography. Cairo is the Arabic-first UI face (it also renders Latin
 * cleanly, so it is safe to use for both AR and EN — Outfit has no Arabic
 * glyphs). Outfit is reserved for purely-Latin display moments.
 */
export const fonts = {
  regular: "Cairo_400Regular",
  medium: "Cairo_500Medium",
  semibold: "Cairo_600SemiBold",
  bold: "Cairo_700Bold",
  extrabold: "Cairo_800ExtraBold",
  displayRegular: "Outfit_400Regular",
  displayBold: "Outfit_700Bold",
} as const;

export type FontWeightKey =
  | "regular"
  | "medium"
  | "semibold"
  | "bold"
  | "extrabold";
