
const express = require("express");
const movieRoutes = express.Router();

const {
  createMovie, getMovies
} = require("../controllers/movie.controller");

const {authenticateUser, authorizeAdmin} = require("../middleware/auth.middleware");

movieRoutes.post("/", authenticateUser, authorizeAdmin, createMovie);
movieRoutes.get("/", getMovies);

module.exports = movieRoutes;

