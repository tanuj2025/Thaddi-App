/**
 * Official brand SVG icons for Google and Apple social sign-in buttons.
 * Using react-native-svg for pixel-accurate, license-compliant rendering
 * instead of font glyph approximations from @expo/vector-icons.
 */
import React from "react";
import Svg, { Path, G, ClipPath, Defs, Rect } from "react-native-svg";

/** Google "G" logo in official brand colours (#4285F4, #34A853, #FBBC05, #EA4335). */
export function GoogleIcon({ size = 18 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 18 18">
      <Defs>
        <ClipPath id="google-clip">
          <Rect width={18} height={18} rx={2} />
        </ClipPath>
      </Defs>
      <G clipPath="url(#google-clip)">
        {/* Blue — right arm of the G */}
        <Path
          d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
          fill="#4285F4"
        />
        {/* Green — bottom of the G */}
        <Path
          d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
          fill="#34A853"
        />
        {/* Yellow — left bottom of the G */}
        <Path
          d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
          fill="#FBBC05"
        />
        {/* Red — top of the G */}
        <Path
          d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
          fill="#EA4335"
        />
      </G>
    </Svg>
  );
}

/** Apple logo in a neutral colour (matches the button text colour). */
export function AppleIcon({ size = 20, color = "#000" }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 814 1000">
      <Path
        d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76 0-103.7 40.8-165.9 40.8s-105-43.1-149.2-101.2C90.7 658.5 51 565 51 475.3c0-145.3 94.7-222.2 186.5-222.2 49.5 0 90.9 32.6 121.9 32.6 29.6 0 76.9-34.8 136.8-34.8 55.3 0 108.8 21.8 148.7 63.7zM562.7 147.8c22.5-26.3 38.6-62.7 38.6-99.1 0-5.1-.4-10.3-1.3-14.6-36.8 1.4-80.8 24.7-107.2 53.9-20.4 23.3-39.8 59.7-39.8 96.6 0 5.6.7 11.3 1.1 13.1 2.3.4 5.8.7 9.2.7 33.2 0 74.7-22.2 99.4-50.6z"
        fill={color}
      />
    </Svg>
  );
}
