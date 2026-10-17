
require("dotenv").config();

const { performance } = require("node:perf_hooks");
const redis = require("./src/config/redis");

async function run() {
  try {
    await redis.ping();

    const testData = JSON.stringify(
      Array.from({ length: 100 }, (_, i) => ({
        id: i,
        name: `Movie ${i}`,
        genre: "Action",
        duration: 120,
      }))
    );

    for (let i = 1; i <= 5; i++) {
      let start = performance.now();
      await redis.set("latency-test", testData);
      const setMs = performance.now() - start;

      start = performance.now();
      await redis.get("latency-test");
      const getMs = performance.now() - start;

      console.log({
        iteration: i,
        setMs: setMs.toFixed(2),
        getMs: getMs.toFixed(2),
      });
    }
  } catch (error) {
    console.error(error);
  } finally {
    await redis.quit();
  }
}

run();
