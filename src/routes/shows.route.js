const express = require("express");
const showsRoutes = express.Router();

const {
  createShow
} = require("../controllers/shows.controller");

const {authenticateUser, authorizeAdmin} = require("../middleware/auth.middleware");
const { getShows } = require("../controllers/query/show.controller");

showsRoutes.post("/", authenticateUser, authorizeAdmin,createShow);
showsRoutes.get("/", getShows);
module.exports = showsRoutes;