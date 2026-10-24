CREATE TABLE "user_views" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "is_admin" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "user_views_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "show_views"
    DROP COLUMN "totalSeats",
    DROP COLUMN "availableSeats",
    ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "reservation_views"
    ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE "payment_views" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "status" TEXT NOT NULL,
    "provider" TEXT,
    "transactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "payment_views_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payment_views_reservationId_key" ON "payment_views"("reservationId");
CREATE INDEX "payment_views_userId_idx" ON "payment_views"("userId");

CREATE TABLE "notification_views" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT,
    "message" TEXT,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "notification_views_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "notification_views_userId_idx" ON "notification_views"("userId");
