const { rateLimit } = require("express-rate-limit")

const generalLimiter = rateLimit({
    windowMs: 60*1000,
    limit:120,
    standardHeaders:"draft-8",
    legacyHeaders:"false",
     message: {
    error: "Too many requests. Please try again in a minute.",
  },
})

const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10, // Maximum 10 requests per IP per minute
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    error: "Too many authentication attempts. Please try again later.",
  },
});

const reservationLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    error: "Too many reservation requests. Please try again later.",
  },
});

const paymentLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    error: "Too many payment requests. Please try again later.",
  },
});

module.exports = {
  generalLimiter,
  authLimiter,
  reservationLimiter,
  paymentLimiter,
};