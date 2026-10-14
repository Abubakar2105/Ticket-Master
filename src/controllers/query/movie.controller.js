const cache = require("../../utils/cache");
const queryPrisma = require("../../config/query-prisma");

const getMovies = async (req, res) => {
  try {
    const cachedData = await cache.get("movies:all");
    if(cachedData){
      return res.status(200).json({count:cachedData.length,movies:cachedData});
    }
    
    const movies = await queryPrisma.movie.findMany({
      orderBy: { createdAt: "desc" },
    });
      await cache.set("movies:all",60,movies);
    return res.status(200).json({ count: movies.length, movies });
  } catch (error) {
    console.error("Get movies error:", error);
    return res.status(500).json({ message: "Failed to fetch movies" });
  }
};

module.exports = {getMovies}