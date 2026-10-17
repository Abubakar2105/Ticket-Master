
const redis = require("../config/redis");

const cache = {
  async get(key) {
    try {
      const cachedData = await redis.get(key);

      if (cachedData) {
        return JSON.parse(cachedData);
      }

      return null;
    } catch (error) {
      console.error(`Redis GET error (${key}):`, error);
      return null;
    }
  },

  async set(key, ttl, data) {
    try {
      await redis.setex(key, ttl, JSON.stringify(data));
    } catch (error) {
      console.error(`Redis SET error (${key}):`, error);
    }
  },

  async del(key) {
    try {
      await redis.del(key);
    } catch (error) {
      console.error(`Redis DEL error (${key}):`, error);
    }
  },
};

module.exports = cache;
