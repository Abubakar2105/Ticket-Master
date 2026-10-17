
const cache = require('../../utils/cache')

const queryPrisma = require("../../config/query-prisma");

const getMovies = async (req, res) => {
  try {
    const cachedData = await cache.get("movies:all");
    

    if (cachedData !== null) {
      const movies = JSON.parse(cachedData);
      return res.status(200).json({
        count: movies.length,
        movies,
      });
    }


    const movies = await queryPrisma.movie.findMany({
      orderBy: {
        createdAt: "desc",
      },
    });

    const json = JSON.stringify(movies);
   
    await cache.set("movies:all", 60, json);

    return res.status(200).json({
      count: movies.length,
      movies,
    });
  } catch (error) {
    console.error("Get movies error:", error);

    return res.status(500).json({
      message: "Failed to fetch movies",
    });
  }
};

module.exports = { getMovies };
