const commandPrisma = require("../../config/command-prisma");
const { withSeatLock } = require("../../utils/seatLock");
const { append } = require("../../events/store");

const reserveSeat = async (req, res) => {
  try {
    const { show_id, seat_id } = req.body || {};
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }
    if (typeof show_id !== "string" || !show_id.trim()) {
      return res.status(400).json({ message: "show_id is required" });
    }
    if (typeof seat_id !== "string" || !seat_id.trim() || seat_id.trim().length > 10) {
      return res.status(400).json({ message: "A valid seat_id is required" });
    }

    const showId = show_id.trim();
    const seatNumber = seat_id.trim().toUpperCase();
    const reservation = await withSeatLock(showId, seatNumber, () =>
      commandPrisma.$transaction(async (tx) => {
        const show = await tx.show.findUnique({
          where: { id: showId },
          select: { id: true, startTime: true },
        });
        if (!show) {
          const error = new Error("Show not found");
          error.statusCode = 404;
          throw error;
        }
        const now = new Date();
        if (show.startTime <= now) {
          const error = new Error("Cannot reserve a seat for a show that has already started");
          error.statusCode = 400;
          throw error;
        }

        const expiredHolds = await tx.reservation.findMany({
          where: { showId, seatNumber, status: "HELD", expiresAt: { lte: now } },
        });
        for (const hold of expiredHolds) {
          const expired = await tx.reservation.update({
            where: { id: hold.id },
            data: { status: "EXPIRED" },
          });
          await append({ eventType: "reservation-updated", aggregateId: expired.id, payload: expired }, tx);
          const payment = await tx.payment.findUnique({ where: { reservationId: hold.id } });
          if (payment?.status === "PENDING") {
            const failedPayment = await tx.payment.update({
              where: { id: payment.id },
              data: { status: "FAILED" },
            });
            await append({ eventType: "payment-updated", aggregateId: failedPayment.id, payload: failedPayment }, tx);
          }
        }

        const existingReservation = await tx.reservation.findFirst({
          where: {
            showId,
            seatNumber,
            OR: [{ status: "CONFIRMED" }, { status: "HELD", expiresAt: { gt: now } }],
          },
          select: { id: true },
        });
        if (existingReservation) {
          const error = new Error("This seat is already reserved");
          error.statusCode = 409;
          throw error;
        }

        const savedReservation = await tx.reservation.create({
          data: {
            userId,
            showId,
            seatNumber,
            status: "HELD",
            expiresAt: new Date(Math.min(now.getTime() + 2 * 60 * 1000, show.startTime.getTime())),
          },
        });
        await append({
          eventType: "reservation-created",
          aggregateId: savedReservation.id,
          payload: savedReservation,
        }, tx);
        return savedReservation;
      }, { maxWait: 5000, timeout: 5000 })
    );

    return res.status(201).json({
      message: "Seat reserved successfully",
      reservation: {
        id: reservation.id,
        user_id: reservation.userId,
        show_id: reservation.showId,
        seat_number: reservation.seatNumber,
        status: reservation.status,
        expires_at: reservation.expiresAt,
        created_at: reservation.createdAt,
      },
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    if (error.code === "P2002") {
      return res.status(409).json({ message: "This seat is already reserved" });
    }
    console.error("Reserve seat error:", error);
    return res.status(500).json({ message: "Failed to reserve seat" });
  }
};

const cancelReservation = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { reservation_id } = req.body || {};
    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }
    if (typeof reservation_id !== "string" || !reservation_id.trim()) {
      return res.status(400).json({ message: "reservation_id is required" });
    }
    const reservationId = reservation_id.trim();
    const lockTarget = await commandPrisma.reservation.findUnique({ where: { id: reservationId } });
    if (!lockTarget) {
      return res.status(404).json({ message: "Reservation not found" });
    }
    if (lockTarget.userId !== userId) {
      return res.status(403).json({ message: "You cannot cancel another user's reservation" });
    }

    const outcome = await withSeatLock(lockTarget.showId, lockTarget.seatNumber, () =>
      commandPrisma.$transaction(async (tx) => {
        const reservation = await tx.reservation.findUnique({
          where: { id: reservationId },
          include: { payment: true },
        });
        if (!reservation) {
          return { error: "Reservation not found", statusCode: 404 };
        }
        if (reservation.userId !== userId) {
          return { error: "You cannot cancel another user's reservation", statusCode: 403 };
        }
        if (reservation.status !== "HELD") {
          return { error: `Cannot cancel a reservation with status ${reservation.status}`, statusCode: 409 };
        }

        const status = reservation.expiresAt <= new Date() ? "EXPIRED" : "CANCELLED";
        const changed = await tx.reservation.updateMany({
          where: { id: reservationId, userId, status: "HELD" },
          data: { status },
        });
        if (changed.count !== 1) {
          return { error: "Reservation could not be cancelled", statusCode: 409 };
        }
        const updatedReservation = await tx.reservation.findUnique({ where: { id: reservationId } });
        await append({
          eventType: "reservation-updated",
          aggregateId: updatedReservation.id,
          payload: updatedReservation,
        }, tx);

        if (reservation.payment?.status === "PENDING") {
          const changedPayment = await tx.payment.updateMany({
            where: { id: reservation.payment.id, status: "PENDING" },
            data: { status: "FAILED" },
          });
          if (changedPayment.count !== 1) {
            throw new Error("Payment status update failed");
          }
          const payment = await tx.payment.findUnique({ where: { id: reservation.payment.id } });
          await append({ eventType: "payment-updated", aggregateId: payment.id, payload: payment }, tx);
        }

        return status === "EXPIRED"
          ? { error: "Reservation has already expired", statusCode: 409 }
          : { reservation: updatedReservation };
      }, { maxWait: 5000, timeout: 5000 })
    );
    if (outcome.error) {
      return res.status(outcome.statusCode).json({ message: outcome.error });
    }
    return res.status(200).json({
      message: "Reservation cancelled successfully",
      reservation: {
        id: outcome.reservation.id,
        user_id: outcome.reservation.userId,
        show_id: outcome.reservation.showId,
        seat_number: outcome.reservation.seatNumber,
        status: outcome.reservation.status,
        expires_at: outcome.reservation.expiresAt,
        updated_at: outcome.reservation.updatedAt,
      },
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    console.error("Cancel reservation error:", error);
    return res.status(500).json({ message: "Failed to cancel reservation" });
  }
};

module.exports = { reserveSeat, cancelReservation };
