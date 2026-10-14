const commandPrisma = require("../../config/command-prisma");
const  cache  = require("../../utils/cache");

const createMovie = async (req, res) => {
  try {
    const { name, genre, duration } = req.body;
    if (!name || !genre || duration === undefined) {
      return res.status(400).json({
        message: "Name, genre, and duration are required",
      });
    }
    const movie = await commandPrisma.movie.create({
      data: {
        name: name.trim(),
        genre: genre.trim(),
        duration,
      },
    });
    return res
      .status(201)
      .json({ message: "Movie created successfully", movie });
  } catch (error) {
    return res.status(500).json({ message: "Failed to create movie" });
  }
};



module.exports = { createMovie };