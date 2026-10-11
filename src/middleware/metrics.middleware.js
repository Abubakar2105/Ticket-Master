
const {
  httpRequestsTotal,
  httpRequestDuration,
} = require("../config/metrics");

const metricsMiddleware = (req, res, next) => {
  // Don't count Prometheus scraping itself as an API request.
  if (req.path === "/metrics") {
    return next();
  }

  const start = process.hrtime.bigint();

  res.on("finish", () => {
    const duration =
      Number(process.hrtime.bigint() - start) / 1e9;

    // Use route templates, not raw URLs containing IDs.
    const route = req.route
      ? `${req.baseUrl}${req.route.path}`
      : "unmatched";

    const labels = {
      method: req.method,
      route,
      status_code: String(res.statusCode),
    };

    httpRequestsTotal.inc(labels);
    httpRequestDuration.observe(labels, duration);
  });

  next();
};

module.exports = metricsMiddleware;