module.exports = function (api) {
  api.cache(true);

  // babel-preset-expo is hoisted to the workspace root but expo-router is not,
  // so the hasModule('expo-router') guard inside babel-preset-expo returns false
  // and expoRouterBabelPlugin is never added.  Register it explicitly here so
  // Metro can statically inline EXPO_ROUTER_APP_ROOT at bundle time.
  const { expoRouterBabelPlugin } = require("babel-preset-expo/build/expo-router-plugin");

  // Same hoisting problem hits the worklets transform: babel-preset-expo only
  // adds react-native-worklets/plugin when hasModule("react-native-worklets")
  // resolves from ITS location (workspace root), which fails in this pnpm
  // monorepo — leaving reanimated worklets untransformed and crashing at
  // runtime with "WorkletsError: Failed to create a worklet".  Register it
  // explicitly; it must be the LAST plugin.
  return {
    presets: [["babel-preset-expo", { unstable_transformImportMeta: true }]],
    plugins: [expoRouterBabelPlugin, require.resolve("react-native-worklets/plugin")],
  };
};
