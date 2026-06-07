// Node module-customization hook used only by the jsdom render tests.
//
// The app's source reads Vite's `import.meta.env` (e.g. `import.meta.env.BASE_URL`),
// which Vite injects at build time. Under plain Node/tsx that object does not
// exist, so importing a page module crashes at load with "Cannot read properties
// of undefined (reading 'BASE_URL')". This loader runs AFTER tsx (so it sees the
// already-transpiled JS) and prepends a tiny shim that seeds `import.meta.env`
// from a global the test sets up, without altering any app source on disk.
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (
    url.includes("/artifacts/thaddi/src/") &&
    result.format === "module" &&
    typeof result.source !== "undefined"
  ) {
    const source =
      "import.meta.env = Object.assign({ BASE_URL: '/', MODE: 'test', DEV: true, PROD: false }, globalThis.__VITE_ENV__ || {}, import.meta.env || {});\n" +
      result.source.toString();
    return { ...result, source };
  }
  return result;
}
