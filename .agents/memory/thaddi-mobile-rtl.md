---
name: thaddi-mobile RTL
description: How RTL/Arabic layout is achieved in the Expo mobile app (no forceRTL), and the React Navigation v7 tab-order gotcha.
---

# thaddi-mobile RTL conventions

The Expo app (`artifacts/thaddi-mobile`) supports a runtime ar(rtl)/en(ltr) toggle via a custom `useI18n()` context (`dir`, `t`, `lang`).

**Rule:** NEVER use `I18nManager.forceRTL` — every layout mirrors itself by reading `dir` and using `flexDirection: dir==="rtl" ? "row-reverse" : "row"`. Helpers live in `lib/i18n.tsx`: `rowDirection`, `textAlign`, `writingDirection`, `forwardChevron`/`backChevron`, and `ltrIsolate`.

**Why:** forceRTL requires a native reload and fights Expo Go / runtime language switching; dir-mirroring flips instantly with the toggle and keeps en mode untouched.

## Bottom-tab order can't be set via tabBarStyle (React Navigation v7)
`@react-navigation/bottom-tabs` v7 lays the tab items inside an INTERNAL content View (`styles.bottomContent`, `flexDirection:"row"`). `tabBarStyle` (and all `screenOptions`) only reach the OUTER `Animated.View`, so `tabBarStyle.flexDirection: "row-reverse"` does NOT reorder tabs — it's a no-op for order.

**How to apply:** to reorder tabs for RTL, render a custom `tabBar` render prop on expo-router's `<Tabs>` and control `flexDirection` on YOUR OWN container. The custom bar must re-implement the canonical pattern: map `state.routes`, read `descriptors[key].options` (title, tabBarIcon, tabBarAccessibilityLabel), highlight via `state.index`, fire `navigation.emit({type:"tabPress",target,canPreventDefault:true})` then `navigation.navigate(route.name, route.params)`, plus `tabLongPress`.

**Typing without a direct dep:** `@react-navigation/bottom-tabs` is NOT a direct dependency and does not resolve from the mobile package. Derive the tab-bar props type as `Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0]` instead of importing it. Do NOT add the package as a direct dep — a version-pinned copy risks a duplicate React Navigation instance under pnpm.

## Bidi countdown scrambling
Mixed digit+Arabic-letter tokens (countdown segments like "45د") scramble under the bidi algorithm. Wrap each segment in U+2066 (LRI) … U+2069 (PDI) via `ltrIsolate()` and render in a `Text` with `writingDirection:"ltr"`. Note: RN `writingDirection` is historically iOS/web-only, so on Android the inter-token order (not the within-token digits) may differ — acceptable, the digit-scramble was the real bug.

## No RTL guard for mobile
The `rtl` validation workflow scans `artifacts/thaddi` and `artifacts/mockup-sandbox` only — it does NOT scan `thaddi-mobile`. RTL correctness in the mobile app is enforced by convention + review, not the AST guard.
