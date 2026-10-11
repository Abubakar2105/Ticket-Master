-- This is an empty migration.

CREATE UNIQUE INDEX "reservations_one_active_seat_per_show"
ON "reservations" ("show_id", "seat_number")
WHERE "status" IN ('HELD', 'CONFIRMED');