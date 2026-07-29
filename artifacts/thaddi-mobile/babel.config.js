module.exports = function (api) {
  api.cache(true);

  // babel-preset-expo is hoisted to the workspace root but expo-router is not,
  // so the hasModule('expo-router') guard inside babel-preset-expo returns false
  // and expoRouterBabelPlugin is never added.  Register it explicitly here so
  // Metro can statically inline EXPO_ROUTER_APP_ROOT at bundle time.
  const { expoRouterBabelPlugin } = require("babel-preset-expo/build/expo-router-plugin");

  return {
    presets: [["babel-preset-expo", { unstable_transformImportMeta: true }]],
    plugins: [expoRouterBabelPlugin],
  };
};
