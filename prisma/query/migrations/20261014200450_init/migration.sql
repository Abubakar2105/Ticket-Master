-- CreateTable
CREATE TABLE "movie_views" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "genre" TEXT NOT NULL,
    "duration" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "movie_views_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "show_views" (
    "id" TEXT NOT NULL,
    "movieId" TEXT NOT NULL,
    "movieName" TEXT NOT NULL,
    "genre" TEXT NOT NULL,
    "theater" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "totalSeats" INTEGER NOT NULL,
    "availableSeats" INTEGER NOT NULL,

    CONSTRAINT "show_views_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservation_views" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "showId" TEXT NOT NULL,
    "movieName" TEXT NOT NULL,
    "theater" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "seatNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reservation_views_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "show_views_movieId_idx" ON "show_views"("movieId");

-- CreateIndex
CREATE INDEX "show_views_startTime_idx" ON "show_views"("startTime");

-- CreateIndex
CREATE INDEX "reservation_views_userId_idx" ON "reservation_views"("userId");

-- CreateIndex
CREATE INDEX "reservation_views_showId_idx" ON "reservation_views"("showId");
