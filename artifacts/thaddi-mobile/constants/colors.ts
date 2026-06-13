/**
 * Semantic design tokens for the thaddi mobile app.
 *
 * Synced from the sibling web artifact (artifacts/thaddi/src/index.css) so both
 * surfaces share one "dark premium stadium" identity: deep navy base, vivid
 * Saudi green primary, trophy-gold secondary. The web forces the dark concept
 * via <html class="dark">; mobile mirrors that by defaulting to the dark
 * palette regardless of the device appearance (see ThemeProvider).
 *
 * HSL values from index.css were converted to hex. Reference the tokens via the
 * useColors() hook — never hardcode hex in components.
 */

const colors = {
  light: {
    text: "#0f1729",
    tint: "#006b36",

    background: "#ffffff",
    foreground: "#0f1729",

    card: "#ffffff",
    cardForeground: "#0f1729",

    primary: "#006b36",
    primaryForeground: "#ffffff",

    secondary: "#d4af35",
    secondaryForeground: "#ffffff",

    muted: "#f1f5f9",
    mutedForeground: "#64748b",

    accent: "#f1f5f9",
    accentForeground: "#0f172a",

    destructive: "#ef4444",
    destructiveForeground: "#f8fafc",

    border: "#e1e7ef",
    input: "#e1e7ef",

    // Brand + stadium glow stops
    thaddiGreen: "#006b36",
    thaddiGold: "#d4af35",
    stadiumGlowGreen: "rgba(0,107,54,0.10)",
    stadiumGlowGold: "rgba(212,175,53,0.08)",

    // Podium medals (decorative — Top-3 leaderboard)
    podiumSilver: "#9aa6b6",
    podiumBronze: "#bd7b45",
  },

  dark: {
    text: "#f8f6f2",
    tint: "#27b070",

    // Premium "stadium under lights" base — deep navy-charcoal
    background: "#060914",
    foreground: "#f8f6f2",

    card: "#0b111d",
    cardForeground: "#f8f6f2",

    // Vivid Saudi green, tuned for contrast on dark
    primary: "#27b070",
    primaryForeground: "#070b18",

    // Rich trophy gold
    secondary: "#e8b430",
    secondaryForeground: "#070b18",

    muted: "#181e2a",
    mutedForeground: "#969fb0",

    accent: "#1c2331",
    accentForeground: "#f8f6f2",

    destructive: "#dc2828",
    destructiveForeground: "#f8f6f2",

    border: "#1b2232",
    input: "#1b2232",

    // Brand + stadium glow stops
    thaddiGreen: "#27b070",
    thaddiGold: "#e8b430",
    stadiumGlowGreen: "rgba(39,176,112,0.18)",
    stadiumGlowGold: "rgba(232,180,48,0.12)",

    // Podium medals (decorative — Top-3 leaderboard)
    podiumSilver: "#c4cdd8",
    podiumBronze: "#c98a4b",
  },

  // Border radius (px). Synced from web --radius (0.75rem = 12px).
  radius: 12,
};

export type ColorPalette = typeof colors.dark;

export default colors;
