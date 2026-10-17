
const { subscribe } = require("./publish");
const { projectMovieCreated } = require("../projections/movie.projection");


const setupEventSubscribers = ()=>{

    subscribe("movie-created", projectMovieCreated);
    console.log("movie-created projection registered");
}

module.exports = {setupEventSubscribers}

