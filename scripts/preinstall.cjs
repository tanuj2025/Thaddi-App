const fs = require('fs');
const path = require('path');

// Delete package-lock.json and yarn.lock if they exist to prevent lock conflicts
const rootDir = path.resolve(__dirname, '..');
const filesToDelete = ['package-lock.json', 'yarn.lock'];

filesToDelete.forEach(file => {
  const filePath = path.join(rootDir, file);
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
      console.log(`Deleted conflict lockfile: ${file}`);
    } catch (err) {
      console.warn(`Could not delete lockfile ${file}:`, err.message);
    }
  }
});

// Ensure pnpm is being used for installations
const userAgent = process.env.npm_config_user_agent || '';
if (!userAgent.startsWith('pnpm/')) {
  console.error('\x1b[31m%s\x1b[0m', 'Error: Use pnpm instead of npm or yarn.');
  process.exit(1);
}
