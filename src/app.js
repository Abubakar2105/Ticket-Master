const express = require('express');
const commandPrisma = require("./config/command-prisma")
const metricsMiddleware = require('./middleware/metrics.middleware');
const path = require("path");
const app = express();

app.use(express.json())
app.use(metricsMiddleware);
app.use(express.static(path.join(__dirname, "../public")));
app.get('/ping', (req, res) => res.send('ok'));
const userRoutes = require("./routes/user.route");
const movieRoutes = require('./routes/movie.route');
// const showsRoutes = require('./routes/shows.route');
// const reservationRoute = require('./routes/reservation.route');
// const paymentRouter = require('./routes/payment.route');
// const notificationRouter = require('./routes/notification.route');
const metricRouter = require('./routes/metric.route');



app.get('/health',async(req,res)=>{
    try { 
        await commandPrisma.$queryRaw`SELECT 1`; 
        return res.json({
  status: 'healthy',
  message: 'API and database are running',
  database: 'connected',
  instance: process.env.HOSTNAME || require("os").hostname(),
  timestamp: new Date().toISOString()
});
        } catch (error) { 
            console.error("Health check failed:", error); 
            return res.status(503).json({ 
                status: "unhealthy", 
                message: "Database connection failed", 
                database: "disconnected", 
                timestamp: new Date().toISOString(), 
         });
         
} });

const { authLimiter, generalLimiter, reservationLimiter, paymentLimiter } = require("./middleware/ratelimit.middleware")

app.use("/users",authLimiter, userRoutes);
app.use("/movies",movieRoutes);
// app.use("/shows",generalLimiter,showsRoutes);
// app.use("/seats",reservationLimiter, reservationRoute);
// app.use("/payments",paymentLimiter , paymentRouter)
// app.use("/notification",generalLimiter,notificationRouter)
app.use('/metrics',metricRouter);



module.exports = app;