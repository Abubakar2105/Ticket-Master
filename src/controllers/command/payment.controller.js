const commandPrisma = require("../../config/command-prisma");
const { append } = require("../../events/store");
const { withSeatLock } = require("../../utils/seatLock");

const initiatePayment = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { reservation_id, amount } = req.body || {};

    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }

    if (typeof reservation_id !== "string" || !reservation_id.trim()) {
      return res.status(400).json({ message: "reservation_id is required" });
    }

    if (!["string", "number"].includes(typeof amount)) {
      return res.status(400).json({ message: "amount must be a number or decimal string" });
    }
    const amountText = typeof amount === "string" ? amount.trim() : String(amount);
    const paymentAmount = Number(amountText);
    if (
      !/^\d+(?:\.\d{1,2})?$/.test(amountText) ||
      !Number.isFinite(paymentAmount) ||
      paymentAmount <= 0 ||
      paymentAmount > 99999999.99
    ) {
      return res.status(400).json({
        message: "amount must be positive, at most 99999999.99, with up to two decimal places",
      });
    }

    const reservationId = reservation_id.trim();
    const lockTarget = await commandPrisma.reservation.findUnique({
      where: { id: reservationId },
      select: { showId: true, seatNumber: true, userId: true },
    });

    if (!lockTarget) {
      return res.status(404).json({ message: "Reservation not found" });
    }
    if (lockTarget.userId !== userId) {
      return res.status(403).json({ message: "You cannot pay for another user's reservation" });
    }

    const outcome = await withSeatLock(lockTarget.showId, lockTarget.seatNumber, () =>
      commandPrisma.$transaction(async (tx) => {
        const reservation = await tx.reservation.findUnique({
          where: { id: reservationId },
        });

        if (!reservation) {
          return { error: "Reservation not found", statusCode: 404 };
        }
        if (reservation.userId !== userId) {
          return { error: "You cannot pay for another user's reservation", statusCode: 403 };
        }
        if (reservation.status !== "HELD") {
          return { error: "Reservation is not awaiting payment", statusCode: 409 };
        }

        const now = new Date();
        if (reservation.expiresAt <= now) {
          const expired = await tx.reservation.updateMany({
            where: { id: reservation.id, userId, status: "HELD", expiresAt: { lte: now } },
            data: { status: "EXPIRED" },
          });
          if (expired.count === 1) {
            const savedReservation = await tx.reservation.findUnique({ where: { id: reservation.id } });
            await append({
              eventType: "reservation-updated",
              aggregateId: reservation.id,
              payload: savedReservation,
            }, tx);
          }
          const pendingPayment = await tx.payment.findUnique({ where: { reservationId: reservation.id } });
          if (pendingPayment?.status === "PENDING") {
            const failed = await tx.payment.updateMany({
              where: { id: pendingPayment.id, status: "PENDING" },
              data: { status: "FAILED" },
            });
            if (failed.count !== 1) {
              throw new Error("Payment status update failed");
            }
            const savedPayment = await tx.payment.findUnique({ where: { id: pendingPayment.id } });
            await append({ eventType: "payment-updated", aggregateId: savedPayment.id, payload: savedPayment }, tx);
          }
          return { error: "Reservation expired. Please reserve the seat again.", statusCode: 409 };
        }

        const existingPayment = await tx.payment.findUnique({
          where: { reservationId: reservation.id },
        });
        if (existingPayment) {
          return { error: "A payment record already exists for this reservation", statusCode: 409 };
        }

        const payment = await tx.payment.create({
          data: {
            reservationId: reservation.id,
            userId,
            amount: amountText,
            status: "PENDING",
            provider: "SIMULATED",
          },
        });
        await append({ eventType: "payment-created", aggregateId: payment.id, payload: payment }, tx);
        return { payment };
      }, { maxWait: 5000, timeout: 5000 })
    );

    if (outcome.error) {
      return res.status(outcome.statusCode).json({ message: outcome.error });
    }

    const payment = outcome.payment;
    return res.status(201).json({
      message: "Payment initiated successfully",
      payment: {
        id: payment.id,
        reservation_id: payment.reservationId,
        amount: payment.amount,
        status: payment.status,
        provider: payment.provider,
      },
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    if (error.code === "P2002") {
      return res.status(409).json({ message: "A payment record already exists for this reservation" });
    }
    console.error("Initiate payment error:", error);
    return res.status(500).json({ message: "Failed to initiate payment" });
  }
};

// Client-reported results are only safe for simulation; real payments require trusted provider verification.
const verifyPayment = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { payment_id, payment_result } = req.body || {};

    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }
    if (
      typeof payment_id !== "string" ||
      !payment_id.trim() ||
      !["SUCCESS", "FAILED"].includes(payment_result)
    ) {
      return res.status(400).json({
        message: "payment_id and a valid payment_result (SUCCESS or FAILED) are required",
      });
    }

    const paymentId = payment_id.trim();
    const lockTarget = await commandPrisma.payment.findUnique({
      where: { id: paymentId },
      select: { userId: true, reservation: { select: { showId: true, seatNumber: true } } },
    });
    if (!lockTarget) {
      return res.status(404).json({ message: "Payment not found" });
    }
    if (lockTarget.userId !== userId) {
      return res.status(403).json({ message: "You cannot verify another user's payment" });
    }

    const outcome = await withSeatLock(
      lockTarget.reservation.showId,
      lockTarget.reservation.seatNumber,
      () => commandPrisma.$transaction(async (tx) => {
        const payment = await tx.payment.findUnique({
          where: { id: paymentId },
          include: { reservation: true },
        });
        if (!payment) {
          return { error: "Payment not found", statusCode: 404 };
        }
        if (payment.userId !== userId) {
          return { error: "You cannot verify another user's payment", statusCode: 403 };
        }
        if (payment.status !== "PENDING") {
          return { error: `Payment has already been processed: ${payment.status}`, statusCode: 409 };
        }

        let reservation = payment.reservation;
        const now = new Date();
        if (reservation.status === "HELD" && reservation.expiresAt <= now) {
          const expired = await tx.reservation.updateMany({
            where: { id: reservation.id, userId, status: "HELD", expiresAt: { lte: now } },
            data: { status: "EXPIRED" },
          });
          if (expired.count === 1) {
            reservation = await tx.reservation.findUnique({ where: { id: reservation.id } });
            await append({
              eventType: "reservation-updated",
              aggregateId: reservation.id,
              payload: reservation,
            }, tx);
          }
        }

        if (payment_result === "FAILED" || reservation.status !== "HELD" || reservation.expiresAt <= now) {
          const updated = await tx.payment.updateMany({
            where: { id: payment.id, status: "PENDING" },
            data: { status: "FAILED" },
          });
          if (updated.count !== 1) {
            return { error: "Payment could not be processed", statusCode: 409 };
          }
          const savedPayment = await tx.payment.findUnique({ where: { id: payment.id } });
          await append({ eventType: "payment-updated", aggregateId: payment.id, payload: savedPayment }, tx);

          if (payment_result === "SUCCESS") {
            return { error: "Reservation is no longer valid. Payment marked as failed.", statusCode: 409 };
          }
          return { result: "FAILED", payment: savedPayment, reservationStatus: reservation.status };
        }

        const confirmed = await tx.reservation.updateMany({
          where: { id: reservation.id, userId, status: "HELD", expiresAt: { gt: new Date() } },
          data: { status: "CONFIRMED" },
        });
        if (confirmed.count !== 1) {
          const expired = await tx.reservation.updateMany({
            where: { id: reservation.id, userId, status: "HELD", expiresAt: { lte: new Date() } },
            data: { status: "EXPIRED" },
          });
          if (expired.count === 1) {
            const savedReservation = await tx.reservation.findUnique({ where: { id: reservation.id } });
            await append({ eventType: "reservation-updated", aggregateId: reservation.id, payload: savedReservation }, tx);
          }
          const failed = await tx.payment.updateMany({
            where: { id: payment.id, status: "PENDING" },
            data: { status: "FAILED" },
          });
          if (failed.count === 1) {
            const savedPayment = await tx.payment.findUnique({ where: { id: payment.id } });
            await append({ eventType: "payment-updated", aggregateId: payment.id, payload: savedPayment }, tx);
          }
          return { error: "Reservation could not be confirmed", statusCode: 409 };
        }

        const updatedPayment = await tx.payment.updateMany({
          where: { id: payment.id, status: "PENDING" },
          data: { status: "SUCCESS" },
        });
        if (updatedPayment.count !== 1) {
          const error = new Error("Payment could not be processed");
          error.statusCode = 409;
          throw error;
        }

        const savedPayment = await tx.payment.findUnique({ where: { id: payment.id } });
        const savedReservation = await tx.reservation.findUnique({ where: { id: reservation.id } });
        await append({ eventType: "payment-updated", aggregateId: payment.id, payload: savedPayment }, tx);
        await append({
          eventType: "reservation-updated",
          aggregateId: reservation.id,
          payload: savedReservation,
        }, tx);

        const notification = await tx.notification.create({
          data: {
            userId,
            type: "PAYMENT_SUCCESS",
            message: `Payment confirmed for reservation ${reservation.id}`,
          },
        });
        await append({
          eventType: "notification-created",
          aggregateId: notification.id,
          payload: notification,
        }, tx);

        return { result: "SUCCESS", payment: savedPayment, reservationStatus: "CONFIRMED" };
      }, { maxWait: 5000, timeout: 5000 })
    );

    if (outcome.error) {
      return res.status(outcome.statusCode).json({ message: outcome.error });
    }
    return res.status(200).json({
      message: outcome.result === "SUCCESS"
        ? "Payment successful and reservation confirmed"
        : "Payment failed",
      payment: {
        id: outcome.payment.id,
        reservation_id: outcome.payment.reservationId,
        amount: outcome.payment.amount,
        status: outcome.payment.status,
      },
      reservation_status: outcome.reservationStatus,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    console.error("Verify payment error:", error);
    return res.status(500).json({ message: "Failed to verify payment" });
  }
};

module.exports = { initiatePayment, verifyPayment };
