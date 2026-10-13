const prisma = require("../config/prisma");
const  cache  = require("../utils/cache");

const createMovie = async (req, res) => {
  try {
    const { name, genre, duration } = req.body;
    if (!name || !genre || duration === undefined) {
      return res.status(400).json({
        message: "Name, genre, and duration are required",
      });
    }
    const movie = await prisma.movie.create({
      data: {
        name: name.trim(),
        genre: genre.trim(),
        duration,
      },
    });
    await cache.del("movies:all");
    return res
      .status(201)
      .json({ message: "Movie created successfully", movie });
  } catch (error) {
    return res.status(500).json({ message: "Failed to create movie" });
  }
};

const getMovies = async (req, res) => {
  try {
    const cachedData = await cache.get("movies:all");
    if(cachedData){
      return res.status(200).json({count:cachedData.length,movies:cachedData});
    }
    
    const movies = await prisma.movie.findMany({
      orderBy: { createdAt: "desc" },
    });
      await cache.set("movies:all",60,movies);
    return res.status(200).json({ count: movies.length, movies });
  } catch (error) {
    console.error("Get movies error:", error);
    return res.status(500).json({ message: "Failed to fetch movies" });
  }
};

module.exports = { getMovies, createMovie };