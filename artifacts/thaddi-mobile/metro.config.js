const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// ---------------------------------------------------------------------------
// Dedupe React across the pnpm workspace.
//
// The dev script runs Metro with EXPO_USE_METRO_WORKSPACE_ROOT=1, so module
// resolution spans the whole monorepo.  The workspace root has a physically
// hoisted copy of react (node_modules/react is a real directory), while this
// app's node_modules/react is a symlink into the pnpm store — two distinct
// real paths.  Hoisted packages (e.g. expo-keep-awake) resolve the root copy
// while react-native's renderer uses the app-local one, producing the classic
// "Invalid hook call … more than one copy of React" crash at launch
// (`Cannot read property 'useId' of null` from useKeepAwake).
//
// Fix: force every request for these packages (bare name or deep import) to
// resolve as if it originated inside this app directory, so exactly one copy
// of each ends up in the bundle.
// ---------------------------------------------------------------------------

const PINNED_PACKAGES = [
  "react",
  "react-dom",
  "scheduler",
  "react-native",
  "@babel/runtime",
];

// A synthetic origin inside the app dir; resolution walks up from here and
// finds artifacts/thaddi-mobile/node_modules first.
const APP_ORIGIN = path.join(__dirname, "_pin_origin_.js");

const priorResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const pinned = PINNED_PACKAGES.some(
    (pkg) => moduleName === pkg || moduleName.startsWith(pkg + "/"),
  );
  if (pinned) {
    return context.resolveRequest(
      { ...context, originModulePath: APP_ORIGIN },
      moduleName,
      platform,
    );
  }
  return (priorResolveRequest ?? context.resolveRequest)(
    context,
    moduleName,
    platform,
  );
};

module.exports = config;
