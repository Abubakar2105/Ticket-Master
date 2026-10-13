const prisma = require("../config/prisma");
const cache = require("../utils/cache");

const createShow = async (req, res) => {
  try {
    const { movie_id, theater, start_time } = req.body;
    if (
      !movie_id.trim() ||
      !theater.trim() ||
      !start_time
    ) {
      return res
        .status(400)
        .json({ message: "movie_id, theater, and start_time are required" });
    }
    const parsedStartTime = new Date(start_time);
    if (Number.isNaN(parsedStartTime.getTime())) {
      return res.status(400).json({ message: "Invalid start_time" });
    }
    if (parsedStartTime <= new Date()) {
      return res
        .status(400)
        .json({ message: "Show start time must be in the future" });
    }
    const movie = await prisma.movie.findUnique({ where: { id: movie_id } });
    if (!movie) {
      return res.status(404).json({ message: "Movie not found" });
    }
    const show = await prisma.show.create({
      data: {
        movieId: movie_id,
        theater: theater.trim(),
        startTime: parsedStartTime,
        endTime: new Date(parsedStartTime.getTime() + 150 * 60 * 1000),
      },
      include: { movie: true },
    });
    await cache.del("shows:all");
    return res.status(201).json({ message: "Show created successfully", show });
  } catch (error) {
    console.error("Create show error:", error);
    return res.status(500).json({ message: "Failed to create show" });
  }
};


const getShows = async (req, res) => {
  try {
    const cachedData = await cache.get("shows:all");
    if(cachedData){
      return res.status(200).json({   count: cachedData.length,
      cachedData,})
    }

    const shows = await prisma.show.findMany({
      include: {
        movie: true,
      },
      orderBy: {
        startTime: "asc",
      },
    });
    await cache.set("shows:all",30,shows);

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



module.exports = { createShow, getShows };
