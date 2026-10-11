
const express = require("express");
const metricRouter = express.Router();

const { register } = require("../config/metrics");

metricRouter.get("/", async (req, res, next) => {
  try {
    res.set("Content-Type", register.contentType);
    res.end(await register.metrics());
  } catch (error) {
    next(error);
  }
});

module.exports = metricRouter;