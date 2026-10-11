
const prisma = require("../config/prisma");

// ======================================================
// 1. INITIATE PAYMENT
// POST /payments/initiate
// Requires authentication
//
// Expected body:
// {
//   "reservation_id": "RESERVATION_ID",
//   "amount": 1500
// }
// ======================================================

const initiatePayment = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { reservation_id, amount } = req.body;

    if (!userId) {
      return res.status(401).json({
        message: "Authentication required",
      });
    }

    if (
      typeof reservation_id !== "string" ||
      !reservation_id.trim() ||
      amount === undefined ||
      amount === null ||
      amount === ""
    ) {
      return res.status(400).json({
        message: "reservation_id and amount are required",
      });
    }

    const paymentAmount = Number(amount);

    if (
      !Number.isFinite(paymentAmount) ||
      paymentAmount <= 0
    ) {
      return res.status(400).json({
        message: "amount must be a positive number",
      });
    }

    const reservationId = reservation_id.trim();

    const outcome = await prisma.$transaction(async (tx) => {
      const reservation = await tx.reservation.findUnique({
        where: { id: reservationId },
      });

      if (!reservation) {
        return {
          error: "Reservation not found",
          statusCode: 404,
        };
      }

      if (reservation.userId !== userId) {
        return {
          error: "You cannot pay for another user's reservation",
          statusCode: 403,
        };
      }

      if (reservation.status !== "HELD") {
        return {
          error: "Reservation is not awaiting payment",
          statusCode: 409,
        };
      }

      const now = new Date();

      if (reservation.expiresAt <= now) {
        await tx.reservation.updateMany({
          where: {
            id: reservation.id,
            userId,
            status: "HELD",
            expiresAt: { lte: now },
          },
          data: {
            status: "EXPIRED",
          },
        });

        return {
          error: "Reservation expired. Please reserve the seat again.",
          statusCode: 409,
        };
      }

      const existingPayment = await tx.payment.findUnique({
        where: {
          reservationId: reservation.id,
        },
      });

      if (existingPayment) {
        return {
          error: "A payment record already exists for this reservation",
          statusCode: 409,
        };
      }

      const payment = await tx.payment.create({
        data: {
          reservationId: reservation.id,
          userId,
          amount: paymentAmount,
          status: "PENDING",
          provider: "SIMULATED",
        },
        select: {
          id: true,
          reservationId: true,
          amount: true,
          status: true,
          provider: true,
        },
      });

      return { payment };
    });

    if (outcome.error) {
      return res.status(outcome.statusCode).json({
        message: outcome.error,
      });
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
    // The database unique constraint prevents two payment
    // records from being created for the same reservation.
    if (error.code === "P2002") {
      return res.status(409).json({
        message: "A payment record already exists for this reservation",
      });
    }

    console.error("Initiate payment error:", error);

    return res.status(500).json({
      message: "Failed to initiate payment",
    });
  }
};

// ======================================================
// 2. VERIFY SIMULATED PAYMENT
// POST /payments/verify
// Requires authentication
//
// Expected body:
// {
//   "payment_id": "PAYMENT_ID",
//   "payment_result": "SUCCESS"
// }
//
// IMPORTANT: This is a learning simulation.
// A real payment result must come from a trusted provider.
// ======================================================

const verifyPayment = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { payment_id, payment_result } = req.body;

    if (!userId) {
      return res.status(401).json({
        message: "Authentication required",
      });
    }

    if (
      typeof payment_id !== "string" ||
      !payment_id.trim() ||
      !["SUCCESS", "FAILED"].includes(payment_result)
    ) {
      return res.status(400).json({
        message:
          "payment_id and a valid payment_result (SUCCESS or FAILED) are required",
      });
    }

    const paymentId = payment_id.trim();

    const outcome = await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({
        where: { id: paymentId },
        include: {
          reservation: true,
        },
      });

      if (!payment) {
        return {
          error: "Payment not found",
          statusCode: 404,
        };
      }

      if (payment.userId !== userId) {
        return {
          error: "You cannot verify another user's payment",
          statusCode: 403,
        };
      }

      if (payment.status !== "PENDING") {
        return {
          error: `Payment has already been processed: ${payment.status}`,
          statusCode: 409,
        };
      }

      const reservation = payment.reservation;
      const now = new Date();

      // Simulated payment failure: mark payment failed.
      // The seat remains HELD until it expires or is otherwise
      // released. A cleanup job should expire abandoned holds.
      if (payment_result === "FAILED") {
        const updated = await tx.payment.updateMany({
          where: {
            id: payment.id,
            status: "PENDING",
          },
          data: {
            status: "FAILED",
          },
        });

        if (updated.count !== 1) {
          return {
            error: "Payment could not be processed",
            statusCode: 409,
          };
        }

        return {
          result: "FAILED",
          payment: {
            id: payment.id,
            reservationId: payment.reservationId,
            amount: payment.amount,
            status: "FAILED",
          },
          reservationStatus: reservation.status,
        };
      }

      // Payment result is SUCCESS from the simulated client.
      // Ensure the reservation is still valid before confirming.
      if (
        reservation.status !== "HELD" ||
        reservation.expiresAt <= now
      ) {
        if (
          reservation.status === "HELD" &&
          reservation.expiresAt <= now
        ) {
          await tx.reservation.updateMany({
            where: {
              id: reservation.id,
              status: "HELD",
              expiresAt: { lte: now },
            },
            data: {
              status: "EXPIRED",
            },
          });
        }

        await tx.payment.updateMany({
          where: {
            id: payment.id,
            status: "PENDING",
          },
          data: {
            status: "FAILED",
          },
        });

        return {
          error:
            "Reservation is no longer valid. Payment marked as failed.",
          statusCode: 409,
        };
      }

      // Confirm only if the reservation is still HELD and
      // has not expired. The condition protects against races.
      const confirmed = await tx.reservation.updateMany({
        where: {
          id: reservation.id,
          userId,
          status: "HELD",
          expiresAt: { gt: now },
        },
        data: {
          status: "CONFIRMED",
        },
      });

      if (confirmed.count !== 1) {
        // Returning an error outcome commits any database
        // updates made in this transaction.
        await tx.payment.updateMany({
          where: {
            id: payment.id,
            status: "PENDING",
          },
          data: {
            status: "FAILED",
          },
        });

        return {
          error: "Reservation could not be confirmed",
          statusCode: 409,
        };
      }

      const updatedPayment = await tx.payment.updateMany({
        where: {
          id: payment.id,
          status: "PENDING",
        },
        data: {
          status: "SUCCESS",
        },
      });

      if (updatedPayment.count !== 1) {
        // Throwing rolls back the reservation confirmation too.
        throw new Error("Payment status update failed");
      }

      const savedPayment = await tx.payment.findUnique({
        where: { id: payment.id },
        select: {
          id: true,
          reservationId: true,
          amount: true,
          status: true,
        },
      });

      return {
        result: "SUCCESS",
        payment: savedPayment,
        reservationStatus: "CONFIRMED",
      };
    });

    if (outcome.error) {
      return res.status(outcome.statusCode).json({
        message: outcome.error,
      });
    }

    return res.status(200).json({
      message:
        outcome.result === "SUCCESS"
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
    console.error("Verify payment error:", error);

    return res.status(500).json({
      message: "Failed to verify payment",
    });
  }
};

module.exports = {
  initiatePayment,
  verifyPayment,
};