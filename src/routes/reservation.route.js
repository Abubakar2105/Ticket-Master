const express = require("express");
const reservationRoute = express.Router();

const {
  checkSeatAvailability,
  reserveSeat,
  getUserReservations,
  cancelReservation,
} = require("../controllers/reservation.controller");
const { authenticateUser } = require("../middleware/auth.middleware");

reservationRoute.get("/:seat_id", checkSeatAvailability);
reservationRoute.post("/reserve",authenticateUser, reserveSeat);
reservationRoute.get("/reservation/:user_id", authenticateUser, getUserReservations);
reservationRoute.post(
  "/reservation/cancel",
  authenticateUser,
  cancelReservation
);
module.exports = reservationRoute;
