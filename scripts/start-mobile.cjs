const { spawn } = require('child_process');
const path = require('path');

// Load environment variables from local .env if available
try {
  // @ts-ignore
  process.loadEnvFile(path.resolve(__dirname, '..', '.env'));
} catch (e) {
  // Ignore if .env is missing (e.g. in Replit production)
}

const isReplit = !!process.env.REPL_ID;

const env = { ...process.env };

// Map Clerk Publishable Key for Expo (available locally and on Replit)
if (process.env.CLERK_PUBLISHABLE_KEY) {
  env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = process.env.CLERK_PUBLISHABLE_KEY;
}

if (isReplit) {
  if (process.env.REPLIT_EXPO_DEV_DOMAIN) {
    env.EXPO_PACKAGER_PROXY_URL = `https://${process.env.REPLIT_EXPO_DEV_DOMAIN}`;
  }
  if (process.env.REPLIT_DEV_DOMAIN) {
    env.EXPO_PUBLIC_DOMAIN = process.env.REPLIT_DEV_DOMAIN;
    env.REACT_NATIVE_PACKAGER_HOSTNAME = process.env.REPLIT_DEV_DOMAIN;
  }
  if (process.env.REPL_ID) {
    env.EXPO_PUBLIC_REPL_ID = process.env.REPL_ID;
  }
}

const args = ['exec', 'expo', 'start'];
if (isReplit) {
  args.push('--localhost');
  if (process.env.PORT) {
    args.push('--port', process.env.PORT);
  }
}

console.log(`Starting Expo with command: pnpm ${args.join(' ')}`);

const child = spawn('pnpm', args, {
  stdio: 'inherit',
  env,
  shell: true
});

child.on('exit', (code) => {
  process.exit(code || 0);
});
