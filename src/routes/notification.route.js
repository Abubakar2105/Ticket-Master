
const express = require("express");
const notificationRouter = express.Router();

const {
  getUserNotifications,
} = require("../controllers/notification.controller");

const {authenticateUser} = require("../middleware/auth.middleware");

notificationRouter.get("/:user_id", authenticateUser, getUserNotifications);

module.exports = notificationRouter;

