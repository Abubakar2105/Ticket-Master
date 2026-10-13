const redis = require("../config/redis");

const cache = {
    async get(key){
        try {
            const cachedData = await redis.get(key);
            if(cachedData){
             return JSON.parse(cachedData);   
            }
            return null;
        } catch (error) {
            console.error("redis get error");
            return null; 
        }
    },

    async set(key,ttl,data){
        try {
            await redis.setex(key,ttl,JSON.stringify(data))
            console.log("CACHE MISS");
            
        } catch (error) {
            console.error(`Redis SET error (${key}):`, err);
        }
    },

    async del(key) {
        try {
            await redis.del(key);
    }   catch (err) {
            console.error(`Redis DEL error (${key}):`, err);
    }
  }
}

module.exports = cache