const commandPrisma = require("../../config/command-prisma");
const cache = require("../../utils/cache")

const createMovie = async (req, res) => {
  try {
    const { name, genre, duration } = req.body;

    if ( !name?.trim() || !genre?.trim() || duration === undefined || duration === null) {
      return res.status(400).json({
        message: "Name, genre, and duration are required",
      });
    }

    const movieData = {
      name: name.trim(),
      genre: genre.trim(),
      duration,
    };

    const movie = await commandPrisma.$transaction(async (tx) => {
      const createdMovie = await tx.movie.create({
        data: movieData,
      });

      await tx.outboxEvent.create({
        data: {
          eventType: "movie-created",
          aggregateId: createdMovie.id,
          payload: createdMovie,
          status: "PENDING",
        },
      });

      return createdMovie;
    });

    await cache.del("movies:all");

    return res.status(201).json({
      message: "Movie created successfully",
      movie,
    });
  } catch (error) {
    console.error("Create movie error:", error);

    return res.status(500).json({
      message: "Failed to create movie",
    });
  }
};

module.exports = {
  createMovie,
};