const path = require('node:path');
const fs = require('node:fs');
const root = __dirname;
const session = process.env.SF_GRAND_SESSION || path.join(root, '.cache/grandsimulation', 'pm2-' + new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(session, { recursive: true });
module.exports = { apps: [{
  name: 'stellarfronts-grandsimulation', cwd: root,
  script: 'server/grand-simulation-cli.ts', interpreter: 'node', node_args: ['--import', 'tsx'],
  args: ['--session', session, '--hours', '15', '--logging', 'forensic', '--max-data-gb', '80', '--checkpoint-minutes', '5'],
  exec_mode: 'fork', instances: 1, watch: false, autorestart: true, stop_exit_codes: [0],
  merge_logs: true, min_uptime: 10000, max_restarts: 10, kill_timeout: 180000,
  out_file: path.join(session, 'console-out.log'), error_file: path.join(session, 'console-error.log'), time: true,
}] };
