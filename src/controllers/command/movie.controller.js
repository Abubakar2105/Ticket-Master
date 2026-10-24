const commandPrisma = require("../../config/command-prisma");
const { append } = require("../../events/store");

const createMovie = async (req, res) => {
  try {
    const { name, genre, duration } = req.body || {};

    if (
      typeof name !== "string" ||
      !name.trim() ||
      name.trim().length > 255 ||
      typeof genre !== "string" ||
      !genre.trim() ||
      genre.trim().length > 50 ||
      !Number.isInteger(duration) ||
      duration <= 0 ||
      duration > 2147483647
    ) {
      return res.status(400).json({
        message: "A valid name, genre, and positive integer duration are required",
      });
    }

    const movie = await commandPrisma.$transaction(async (tx) => {
      const createdMovie = await tx.movie.create({
        data: {
          name: name.trim(),
          genre: genre.trim(),
          duration,
        },
      });

      await append({
        eventType: "movie-created",
        aggregateId: createdMovie.id,
        payload: createdMovie,
      }, tx);

      return createdMovie;
    });

    return res.status(201).json({
      message: "Movie created successfully",
      movie,
    });
  } catch (error) {
    console.error("Create movie error:", error);
    return res.status(500).json({ message: "Failed to create movie" });
  }
};

module.exports = { createMovie };
