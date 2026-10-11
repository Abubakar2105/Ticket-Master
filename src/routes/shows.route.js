const express = require("express");
const showsRoutes = express.Router();

const {
  createShow, getShows
} = require("../controllers/shows.controller");

const {authenticateUser, authorizeAdmin} = require("../middleware/auth.middleware");

showsRoutes.post("/", authenticateUser, createShow);
showsRoutes.get("/", getShows);
module.exports = showsRoutes;