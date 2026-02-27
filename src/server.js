const { buildApp } = require("./app");

const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || "3000");

async function start() {
  const app = await buildApp();

  try {
    await app.listen({ host, port });
  } catch (err) {
    app.log.error(err, "Server failed to start");
    process.exit(1);
  }
}

start();
