// Registers the import.meta.env shim loader (see ./vite-env-loader.mjs) for the
// jsdom render tests. Imported via `node --import` AFTER tsx so the hook sees the
// already-transpiled JS and runs before tsx in the load chain.
import { register } from "node:module";
register("./vite-env-loader.mjs", import.meta.url);
