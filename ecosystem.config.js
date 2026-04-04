module.exports = {
  apps: [{
    name: 'telegram-bot',
    script: 'bot.js',
    cwd: __dirname,
    watch: false,
    autorestart: true,
    max_restarts: 10,
    restart_delay: 5000,
    env: {
      NODE_ENV: 'production'
    }
  }]
};
