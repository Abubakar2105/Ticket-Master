const cache = require("../../utils/cache");
const queryPrisma = require("../../config/query-prisma");

const getShows = async (_, res) => {
  try {
    const cachedData = await cache.get("shows:all");
    if (cachedData) {
      return res.status(200).json({
        count: cachedData.length,
        cachedData,
      });
    }

    const shows = await queryPrisma.show.findMany({
      include: {
        movie: true,
      },
      orderBy: {
        startTime: "asc",
      },
    });
    await cache.set("shows:all", 30, shows);

    return res.status(200).json({
      count: shows.length,
      shows,
    });
  } catch (error) {
    console.error("Get shows error:", error);

    return res.status(500).json({
      message: "Failed to fetch shows",
    });
  }
};

module.exports = {getShows}
