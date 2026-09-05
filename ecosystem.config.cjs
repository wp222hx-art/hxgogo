module.exports = {
  apps: [
    {
      name: 'webapp',
      script: 'npx',
      args: 'wrangler pages dev dist --d1=webapp-production --local --ip 0.0.0.0 --port 3000',
      env: { NODE_ENV: 'development', PORT: 3000 },
      watch: false, instances: 1, exec_mode: 'fork',
      autorestart: true, max_restarts: 50, restart_delay: 3000
    },
    {
      // 常驻守护：每 15s 打 /api/keeper/tick，确保关掉所有网页后，后台同步/结算/AI 推理/学习/补齐仍持续运行
      name: 'keeper',
      script: './keeper.cjs',
      env: { KEEPER_BASE: 'http://127.0.0.1:3000', KEEPER_EVERY_MS: '15000' },
      watch: false, instances: 1, exec_mode: 'fork',
      autorestart: true, max_restarts: 1000, restart_delay: 5000
    }
  ]
}
