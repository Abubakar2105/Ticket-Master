-- CreateTable
CREATE TABLE "Show" (
    "id" TEXT NOT NULL,
    "movieId" TEXT NOT NULL,
    "theater" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Show_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Show_movieId_startTime_idx" ON "Show"("movieId", "startTime");

-- AddForeignKey
ALTER TABLE "Show" ADD CONSTRAINT "Show_movieId_fkey" FOREIGN KEY ("movieId") REFERENCES "Movie"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
