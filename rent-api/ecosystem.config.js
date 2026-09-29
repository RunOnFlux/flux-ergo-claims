// PM2 config for rent-api + rent-sweeper.
// Config & secrets live in a gitignored `.env` (copy from .env.example) — loaded
// via Node's built-in --env-file, so nothing sensitive sits in this file, the
// process args, or shell history. Start with:  pm2 start ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'rent-api',
      script: 'server.js',
      cwd: __dirname,
      node_args: '--env-file=.env',   // reads rent-api/.env
      instances: 1,                   // single instance — holds the box cache in memory
      autorestart: true,
      max_restarts: 20,
    },
    {
      name: 'rent-sweeper',
      script: 'rent-sweeper.js',
      cwd: __dirname,
      node_args: '--env-file=.env',   // same .env; provides SWEEP_PRIVATE_KEY / DRY_RUN etc.
      instances: 1,
      autorestart: true,
      max_restarts: 20,
    },
  ],
};
