const commandPrisma = require("../config/command-prisma");
const queryPrisma = require("../config/query-prisma");
const cache = require("../utils/cache");

async function projectUserCreated(event) {
  const user = await commandPrisma.user.findUnique({
    where: { id: event.aggregateId },
    select: { id: true, username: true, email: true, is_admin: true, createdAt: true },
  });
  if (!user) {
    return;
  }
  await queryPrisma.user.upsert({ where: { id: user.id }, create: user, update: user });
  await cache.del("users:all");
  await cache.del(`user:${user.id}`);
}

async function projectShowCreated(event) {
  const show = await commandPrisma.show.findUnique({
    where: { id: event.aggregateId },
    include: { movie: true },
  });
  if (!show) {
    return;
  }
  const data = {
    id: show.id,
    movieId: show.movieId,
    movieName: show.movie.name,
    genre: show.movie.genre,
    theater: show.theater,
    startTime: show.startTime,
    endTime: show.endTime,
    createdAt: show.createdAt,
  };
  await queryPrisma.show.upsert({ where: { id: show.id }, create: data, update: data });
  await cache.del("shows:all");
}

async function projectReservationState(reservationId) {
  const userId = await queryPrisma.$transaction(async (tx) => {
    // Serialize snapshots so delayed or duplicate events cannot restore an earlier booking state.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`reservation:${reservationId}`}, 0))::text`;
    const reservation = await commandPrisma.reservation.findUnique({
      where: { id: reservationId },
      include: { show: { include: { movie: true } }, payment: true },
    });
    if (!reservation) {
      return null;
    }
    const data = {
      id: reservation.id,
      userId: reservation.userId,
      showId: reservation.showId,
      movieName: reservation.show.movie.name,
      theater: reservation.show.theater,
      startTime: reservation.show.startTime,
      seatNumber: reservation.seatNumber,
      status: reservation.status,
      expiresAt: reservation.expiresAt,
      createdAt: reservation.createdAt,
      updatedAt: reservation.updatedAt,
    };
    await tx.reservation.upsert({ where: { id: data.id }, create: data, update: data });
    if (reservation.payment) {
      const payment = reservation.payment;
      const paymentData = {
        id: payment.id,
        reservationId: payment.reservationId,
        userId: payment.userId,
        amount: payment.amount.toString(),
        status: payment.status,
        provider: payment.provider,
        transactionId: payment.transactionId,
        createdAt: payment.createdAt,
      };
      await tx.payment.upsert({ where: { id: payment.id }, create: paymentData, update: paymentData });
    }
    return reservation.userId;
  });
  if (userId) {
    await cache.del(`reservations:user:${userId}`);
  }
}

async function projectReservationChanged(event) {
  await projectReservationState(event.aggregateId);
}

async function projectPaymentChanged(event) {
  const payment = await commandPrisma.payment.findUnique({
    where: { id: event.aggregateId },
    select: { reservationId: true },
  });
  if (payment) {
    await projectReservationState(payment.reservationId);
  }
}

async function projectNotificationCreated(event) {
  const notification = await commandPrisma.notification.findUnique({ where: { id: event.aggregateId } });
  if (!notification) {
    return;
  }
  await queryPrisma.notification.upsert({
    where: { id: notification.id },
    create: notification,
    update: notification,
  });
  await cache.del(`notifications:user:${notification.userId}`);
}

module.exports = {
  projectUserCreated,
  projectShowCreated,
  projectReservationChanged,
  projectPaymentChanged,
  projectNotificationCreated,
};
