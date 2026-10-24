const commandPrisma = require("../../config/command-prisma");
const queryPrisma = require("../../config/query-prisma");
const cache = require("../../utils/cache");

const checkSeatAvailability = async (req, res) => {
  try {
    const { seat_id } = req.params;
    const { show_id } = req.query;
    if (typeof seat_id !== "string" || !seat_id.trim() || seat_id.trim().length > 10) {
      return res.status(400).json({ message: "A valid seat_id is required" });
    }
    if (typeof show_id !== "string" || !show_id.trim()) {
      return res.status(400).json({ message: "show_id is required" });
    }
    const seatNumber = seat_id.trim().toUpperCase();
    const showId = show_id.trim();
    // Availability must not depend on an eventually consistent cache or read model.
    const show = await commandPrisma.show.findUnique({
      where: { id: showId },
      select: { id: true, startTime: true },
    });
    if (!show) {
      return res.status(404).json({ message: "Show not found" });
    }
    const now = new Date();
    const reservation = await commandPrisma.reservation.findFirst({
      where: {
        showId,
        seatNumber,
        OR: [{ status: "CONFIRMED" }, { status: "HELD", expiresAt: { gt: now } }],
      },
      select: { status: true, expiresAt: true },
    });
    return res.status(200).json({
      show_id: showId,
      seat_number: seatNumber,
      available: show.startTime > now && !reservation,
      reservation: reservation || null,
    });
  } catch (error) {
    console.error("Check seat availability error:", error);
    return res.status(500).json({ message: "Failed to check seat availability" });
  }
};

const getUserReservations = async (req, res) => {
  try {
    const { user_id } = req.params;
    if (!req.user?.id) {
      return res.status(401).json({ message: "Authentication required" });
    }
    if (typeof user_id !== "string" || !user_id.trim()) {
      return res.status(400).json({ message: "user_id is required" });
    }
    const userId = user_id.trim();
    if (req.user.id !== userId && req.user.is_admin !== true) {
      return res.status(403).json({ message: "You can only view your own reservations" });
    }
    const key = `reservations:user:${userId}`;
    const cachedReservations = await cache.get(key);
    if (cachedReservations !== null) {
      return res.status(200).json({ count: cachedReservations.length, reservations: cachedReservations });
    }
    const reservationViews = await queryPrisma.reservation.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
    const payments = reservationViews.length === 0 ? [] : await queryPrisma.payment.findMany({
      where: { reservationId: { in: reservationViews.map((reservation) => reservation.id) } },
    });
    const paymentsByReservation = new Map(payments.map((payment) => [payment.reservationId, payment]));
    const reservations = reservationViews.map((reservation) => ({
      ...reservation,
      payment: paymentsByReservation.get(reservation.id) || null,
    }));
    await cache.set(key, 30, reservations);
    return res.status(200).json({ count: reservations.length, reservations });
  } catch (error) {
    console.error("Get user reservations error:", error);
    return res.status(500).json({ message: "Failed to fetch reservations" });
  }
};

module.exports = { checkSeatAvailability, getUserReservations };
