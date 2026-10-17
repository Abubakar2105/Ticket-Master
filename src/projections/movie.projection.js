
const queryPrisma  = require("../config/query-prisma");

async function projectMovieCreated(event) {
  const movie = event.payload;

  await queryPrisma.movie.upsert({
    where: {
      id: movie.id,
    },
    create: {
      id: movie.id,
      name: movie.name,
      genre: movie.genre,
      duration: movie.duration,
      createdAt: new Date()
    },
    update: {
      name: movie.name,
      genre: movie.genre,
      duration: movie.duration,
    },
  });

  console.log(`Movie projection updated: ${movie.id}`);
}

module.exports = {projectMovieCreated}