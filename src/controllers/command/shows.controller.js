const cache = require("../../utils/cache");
const commandPrisma = require("../../config/command-prisma");


const cache = require("../../utils/cache");
const commandPrisma = require("../../config/command-prisma");

const createShow = async (req, res) => {
  try {
    const { movie_id, theater, start_time } = req.body;

   
    if (
      typeof movie_id !== "string" ||
      !movie_id.trim() ||
      typeof theater !== "string" ||
      !theater.trim() ||
      !start_time
    ) {
      return res.status(400).json({
        message: "movie_id, theater, and start_time are required",
      });
    }

    const parsedStartTime = new Date(start_time);

    if (Number.isNaN(parsedStartTime.getTime())) {
      return res.status(400).json({
        message: "Invalid start_time",
      });
    }

    if (parsedStartTime <= new Date()) {
      return res.status(400).json({
        message: "Show start time must be in the future",
      });
    }

    const show = await commandPrisma.$transaction(async (tx) => {

      const movie = await tx.movie.findUnique({
        where: { id: movie_id.trim() },
      });

      if (!movie) {
        const error = new Error("MOVIE_NOT_FOUND");
        throw error;
      }

    
      const show = await tx.show.create({
        data: {
          movieId: movie_id.trim(),
          theater: theater.trim(),
          startTime: parsedStartTime,
          endTime: new Date(
            parsedStartTime.getTime() + 150 * 60 * 1000
          ),
        },
        include: {
          movie: true,
        },
      });

     
      await tx.outboxEvent.create({
        data: {
          eventType: "show-created",
          aggregateId: show.id,
          payload: show,
          status: "PENDING",
        },
      });

      return show;
    });


    await cache.del("shows:all");

    return res.status(201).json({
      message: "Show created successfully",
      show,
    });
  } catch (error) {
    console.error("Create show error:", error);

    if (error.message === "MOVIE_NOT_FOUND") {
      return res.status(404).json({
        message: "Movie not found",
      });
    }

    return res.status(500).json({
      message: "Failed to create show",
    });
  }
};



module.exports = { createShow };
