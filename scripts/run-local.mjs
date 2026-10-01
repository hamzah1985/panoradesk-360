// Rebuilds the renderer and export player, then launches the app from this
// folder with a fresh build number. No installer, no reinstall.
import { spawnSync } from 'node:child_process';

const run = (command, env = {}) => {
  const result = spawnSync(command, { stdio: 'inherit', shell: true, env: { ...process.env, ...env } });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

run('npm run vendor:bundle');
run('npx vite build');
run('npx electron .', { PANORADESK_USE_DIST: '1' });
