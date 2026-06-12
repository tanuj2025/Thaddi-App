import colors, { type ColorPalette } from "@/constants/colors";

/**
 * Returns the design tokens for the thaddi brand.
 *
 * thaddi is a "dark premium stadium" brand: the web forces the dark concept via
 * <html class="dark"> with no light toggle. Mobile mirrors that — we always
 * return the dark palette regardless of the device appearance so the brand looks
 * identical everywhere. The light palette is kept in constants/colors.ts for
 * reference/parity only.
 */
export function useColors(): ColorPalette & { radius: number } {
  return { ...colors.dark, radius: colors.radius };
}
