const queryPrisma = require("../config/query-prisma");
const cache = require("../utils/cache");

async function projectMovieCreated(event) {
  const movie = event.payload;
  const data = {
    id: movie.id,
    name: movie.name,
    genre: movie.genre,
    duration: movie.duration,
    createdAt: new Date(movie.createdAt),
  };
  await queryPrisma.movie.upsert({
    where: { id: movie.id },
    create: data,
    update: data,
  });
  await cache.del("movies:all");
}

module.exports = { projectMovieCreated };
