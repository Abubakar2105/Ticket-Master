const express = require("express");
const paymentRouter = express.Router();

const {
  initiatePayment,
  verifyPayment,
} = require("../controllers/command/payment.controller");

const {authenticateUser} = require("../middleware/auth.middleware");

paymentRouter.post("/initiate", authenticateUser, initiatePayment);
paymentRouter.post("/verify", authenticateUser, verifyPayment);

module.exports = paymentRouter;
