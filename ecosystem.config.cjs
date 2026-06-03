module.exports = {
  apps: [
    {
      name: "feipao-kb-web",
      script: "server.mjs",
      instances: 1,
      autorestart: true,
      max_memory_restart: "300M",
      time: true,
      out_file: "logs/feipao-kb-web.out.log",
      error_file: "logs/feipao-kb-web.err.log",
      env_production: {
        NODE_ENV: "production",
        HOST: "0.0.0.0"
      }
    }
  ]
};
