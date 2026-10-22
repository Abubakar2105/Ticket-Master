
const commandPrisma = require("../config/command-prisma");
const prisma = require("../config/prisma");
const { withSeatLock } = require("../utils/seatLock");


const checkSeatAvailability = async (req, res) => {
  try {
    const { seat_id } = req.params;
    const { show_id } = req.query;

    if (
      typeof seat_id !== "string" ||
      !seat_id.trim() ||
      seat_id.trim().length > 10
    ) {
      return res.status(400).json({
        message: "A valid seat_id is required",
      });
    }

    if (typeof show_id !== "string" || !show_id.trim()) {
      return res.status(400).json({
        message: "show_id is required",
      });
    }

    const seatNumber = seat_id.trim().toUpperCase();
    const showId = show_id.trim();

    const show = await prisma.show.findUnique({
      where: { id: showId },
      select: { id: true },
    });

    if (!show) {
      return res.status(404).json({
        message: "Show not found",
      });
    }

    const now = new Date();

    const reservation = await prisma.reservation.findFirst({
      where: {
        showId,
        seatNumber,
        OR: [
          { status: "CONFIRMED" },
          {
            status: "HELD",
            expiresAt: { gt: now },
          },
        ],
      },
      select: {
        id: true,
        status: true,
        expiresAt: true,
      },
    });

    return res.status(200).json({
      show_id: showId,
      seat_number: seatNumber,
      available: !reservation,
      reservation: reservation || null,
    });
  } catch (error) {
    console.error("Check seat availability error:", error);

    return res.status(500).json({
      message: "Failed to check seat availability",
    });
  }
};

const reserveSeat = async (req, res) => {
  try {
    const { show_id, seat_id } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        message: "Authentication required",
      });
    }

    if (typeof show_id !== "string" || !show_id.trim()) {
      return res.status(400).json({
        message: "show_id is required",
      });
    }

    if (
      typeof seat_id !== "string" ||
      !seat_id.trim() ||
      seat_id.trim().length > 10
    ) {
      return res.status(400).json({
        message: "A valid seat_id is required",
      });
    }

    const showId = show_id.trim();
    const seatNumber = seat_id.trim().toUpperCase();

   
    const reservation = await withSeatLock(
      showId,
      seatNumber,
      async () => {
        return commandPrisma.$transaction(async (tx) => {
          const show = await tx.show.findUnique({
            where: { id: showId },
            select: {
              id: true,
              startTime: true,
            },
          });

          if (!show) {
            const error = new Error("Show not found");
            error.statusCode = 404;
            throw error;
          }

          if (show.startTime <= new Date()) {
            const error = new Error(
              "Cannot reserve a seat for a show that has already started"
            );
            error.statusCode = 400;
            throw error;
          }

          const now = new Date();

          await tx.reservation.updateMany({
            where: {
              showId,
              seatNumber,
              status: "HELD",
              expiresAt: { lte: now },
            },
            data: {
              status: "EXPIRED",
            },
          });

          const existingReservation =
            await tx.reservation.findFirst({
              where: {
                showId,
                seatNumber,
                OR: [
                  { status: "CONFIRMED" },
                  {
                    status: "HELD",
                    expiresAt: { gt: now },
                  },
                ],
              },
              select: { id: true },
            });

          if (existingReservation) {
            const error = new Error(
              "This seat is already reserved"
            );
            error.statusCode = 409;
            throw error;
          }

          const expiresAt = new Date(
            Date.now() + 2 * 60 * 1000
          );

          const reservation =  tx.reservation.create({
            data: {
              userId,
              showId,
              seatNumber,
              status: "HELD",
              expiresAt,
            },
            select: {
              id: true,
              userId: true,
              showId: true,
              seatNumber: true,
              status: true,
              expiresAt: true,
              createdAt: true,
            },
          });

          await tx.outboxEvent.create({
            data: {
          eventType: "reservation-created",
          aggregateId: reservation.id,
          payload: reservation,
          status: "PENDING",
        },
          })

            return reservation;
        });
      }
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
      return res.status(error.statusCode).json({
        message: error.message,
      });
    }

   
    if (error.code === "P2002") {
      return res.status(409).json({
        message: "This seat is already reserved",
      });
    }

    console.error("Reserve seat error:", error);

    return res.status(500).json({
      message: "Failed to reserve seat",
    });
  }
};


const getUserReservations = async (req, res) => {
  try {
    const { user_id } = req.params;
    const requester = req.user;

    if (!requester?.id) {
      return res.status(401).json({
        message: "Authentication required",
      });
    }

    if (typeof user_id !== "string" || !user_id.trim()) {
      return res.status(400).json({
        message: "user_id is required",
      });
    }

    const userId = user_id.trim();

    // Users can only access their own reservations.
    // Admin access should be added only if your authentication
    // middleware securely verifies the admin role.
    if (requester.id !== userId) {
      return res.status(403).json({
        message: "You can only view your own reservations",
      });
    }

    const reservations = await prisma.reservation.findMany({
      where: {
        userId,
      },
      include: {
        show: {
          include: {
            movie: true,
          },
        },
        payment: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return res.status(200).json({
      count: reservations.length,
      reservations,
    });
  } catch (error) {
    console.error("Get user reservations error:", error);

    return res.status(500).json({
      message: "Failed to fetch reservations",
    });
  }
};

const cancelReservation = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { reservation_id } = req.body;

    if (!userId) {
      return res.status(401).json({
        message: "Authentication required",
      });
    }

    if (
      typeof reservation_id !== "string" ||
      !reservation_id.trim()
    ) {
      return res.status(400).json({
        message: "reservation_id is required",
      });
    }

    const reservationId = reservation_id.trim();

    const outcome = await commandPrisma.$transaction(async (tx) => {
      const reservation = await tx.reservation.findUnique({
        where: {
          id: reservationId,
        },
        include: {
          payment: true,
        },
      });

      // 4. Check reservation exists
      if (!reservation) {
        return {
          error: "Reservation not found",
          statusCode: 404,
        };
      }

      // 5. Check ownership
      if (reservation.userId !== userId) {
        return {
          error: "You cannot cancel another user's reservation",
          statusCode: 403,
        };
      }

      // 6. Only HELD reservations can be cancelled for now
      if (reservation.status !== "HELD") {
        return {
          error:
            `Cannot cancel a reservation with status ${reservation.status}. ` +
            "Only held reservations can be cancelled through this endpoint.",
          statusCode: 409,
        };
      }

      // 7. Mark the reservation as cancelled only if it is
      // still HELD. This guards against a concurrent update.
      const cancelled = await tx.reservation.updateMany({
        where: {
          id: reservationId,
          userId,
          status: "HELD",
        },
        data: {
          status: "CANCELLED",
        },
      });

      if (cancelled.count !== 1) {
        return {
          error: "Reservation could not be cancelled",
          statusCode: 409,
        };
      }

      // 8. If a pending payment exists, mark it as failed
      // because the hold has been cancelled.
      if (reservation.payment?.status === "PENDING") {
        await tx.payment.updateMany({
          where: {
            id: reservation.payment.id,
            status: "PENDING",
          },
          data: {
            status: "FAILED",
          },
        });
      }

      // 9. Return the updated reservation
      const updatedReservation = await tx.reservation.findUnique({
        where: {
          id: reservationId,
        },
        select: {
          id: true,
          userId: true,
          showId: true,
          seatNumber: true,
          status: true,
          expiresAt: true,
          updatedAt: true,
        },
      });

      await tx.outboxEvent.create({
        data: {
          eventType: "reservation-canceled",
          aggregateId: updatedReservation.id,
          payload: updatedReservation,
          status: "PENDING",
        },
      })

      return {
        reservation: updatedReservation,
      };
    });

    if (outcome.error) {
      return res.status(outcome.statusCode).json({
        message: outcome.error,
      });
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
    console.error("Cancel reservation error:", error);

    return res.status(500).json({
      message: "Failed to cancel reservation",
    });
  }
};


module.exports = {
  checkSeatAvailability,
  reserveSeat,
  getUserReservations,
  cancelReservation
};