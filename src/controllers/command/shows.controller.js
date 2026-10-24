const commandPrisma = require("../../config/command-prisma");
const { append } = require("../../events/store");

const createShow = async (req, res) => {
  try {
    const { movie_id, theater, start_time } = req.body || {};

    if (
      typeof movie_id !== "string" ||
      !movie_id.trim() ||
      typeof theater !== "string" ||
      !theater.trim() ||
      theater.trim().length > 100 ||
      typeof start_time !== "string" ||
      !start_time.trim()
    ) {
      return res.status(400).json({
        message: "A valid movie_id, theater, and start_time are required",
      });
    }

    const parsedStartTime = new Date(start_time);
    if (Number.isNaN(parsedStartTime.getTime())) {
      return res.status(400).json({ message: "Invalid start_time" });
    }

    if (parsedStartTime <= new Date()) {
      return res.status(400).json({ message: "Show start time must be in the future" });
    }

    const show = await commandPrisma.$transaction(async (tx) => {
      const movie = await tx.movie.findUnique({ where: { id: movie_id.trim() } });
      if (!movie) {
        throw new Error("MOVIE_NOT_FOUND");
      }

      const createdShow = await tx.show.create({
        data: {
          movieId: movie.id,
          theater: theater.trim(),
          startTime: parsedStartTime,
          endTime: new Date(parsedStartTime.getTime() + movie.duration * 60 * 1000),
        },
        include: { movie: true },
      });

      await append({
        eventType: "show-created",
        aggregateId: createdShow.id,
        payload: createdShow,
      }, tx);

      return createdShow;
    });

    return res.status(201).json({ message: "Show created successfully", show });
  } catch (error) {
    if (error.message === "MOVIE_NOT_FOUND") {
      return res.status(404).json({ message: "Movie not found" });
    }

    console.error("Create show error:", error);
    return res.status(500).json({ message: "Failed to create show" });
  }
};

module.exports = { createShow };
