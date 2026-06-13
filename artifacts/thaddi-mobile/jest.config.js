/**
 * Jest config for the THADDI Expo app smoke tests.
 *
 * Uses the `jest-expo` preset (matches SDK 54) which wires up the babel
 * transform + auto-mocks for React Native and the Expo native modules. We mount
 * the real screen components in a node test renderer and assert they mount
 * without throwing, with the auth/network/router seams mocked (see jest/setup.ts).
 */
module.exports = {
  preset: "jest-expo",
  setupFilesAfterEnv: ["<rootDir>/jest/setup.ts"],
  testMatch: ["<rootDir>/__tests__/**/*.test.tsx"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
};
