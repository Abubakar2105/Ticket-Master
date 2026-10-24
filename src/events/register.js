const { subscribe } = require("./publish");
const { projectMovieCreated } = require("../projections/movie.projection");
const {
  projectUserCreated,
  projectShowCreated,
  projectReservationChanged,
  projectPaymentChanged,
  projectNotificationCreated,
} = require("../projections/api.projection");

const setupEventSubscribers = () => {
  subscribe("movie-created", projectMovieCreated);
  subscribe("user-created", projectUserCreated);
  subscribe("show-created", projectShowCreated);
  subscribe("reservation-created", projectReservationChanged);
  subscribe("reservation-updated", projectReservationChanged);
  subscribe("reservation-canceled", projectReservationChanged);
  subscribe("payment-created", projectPaymentChanged);
  subscribe("payment-updated", projectPaymentChanged);
  subscribe("notification-created", projectNotificationCreated);
};

module.exports = { setupEventSubscribers };
