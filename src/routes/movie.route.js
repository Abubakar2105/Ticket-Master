
const express = require("express");
const movieRoutes = express.Router();



const {authenticateUser, authorizeAdmin} = require("../middleware/auth.middleware");
const { createMovie } = require("../controllers/command/movie.controller");
const { getMovies } = require("../controllers/query/movie.controller");

movieRoutes.post("/", authenticateUser, createMovie);
movieRoutes.get("/", getMovies);

module.exports = movieRoutes;

