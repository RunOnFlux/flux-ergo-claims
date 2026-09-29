// PM2 config for rent-api.  Start with:  pm2 start ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'rent-api',
      script: 'server.js',
      cwd: __dirname,
      instances: 1,          // single instance — it holds the box cache in memory
      autorestart: true,
      max_restarts: 20,
      env: {
        ERGO_NODE_URL: 'http://127.0.0.1:9053',
        ALLOW_ORIGIN: 'https://ergo.runonflux.com',
        PORT: '8480',
        // optional tuning (defaults shown):
        // LOOKAHEAD_DAYS: '14',
        // OVERDUE_LOOKBACK_BLOCKS: '4320',
        // SCAN_INTERVAL_MS: '60000',
        // CONCURRENCY: '12',
      },
    },
    {
      name: 'rent-sweeper',
      script: 'rent-sweeper.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      max_restarts: 20,
      env: {
        ERGO_NODE_URL: 'http://127.0.0.1:9053',
        RENT_API_URL: 'http://127.0.0.1:8480',
        // SWEEP_MNEMONIC: set this in the environment, NOT in the repo
        DRY_RUN: '1',              // SAFE: builds + logs, does not broadcast. Set '0' to go live.
        // SAFE_ADDRESS: '9...',   // where sweeps go; defaults to the wallet address
        // BATCH_CAP: '20',
        // MIN_MARGIN: '2000000',  // 0.002 ERG
        // KEEP_TOKENS: '1',       // '0' burns tokens instead of keeping them
      },
    },
  ],
};
