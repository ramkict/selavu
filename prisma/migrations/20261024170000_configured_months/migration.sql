CREATE TABLE "ConfiguredMonth" (
  "month" TEXT NOT NULL PRIMARY KEY,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConfiguredMonth_month_format" CHECK (
    length("month") = 7
    AND substr("month", 1, 4) GLOB '[0-9][0-9][0-9][0-9]'
    AND substr("month", 5, 1) = '-'
    AND substr("month", 6, 2) BETWEEN '01' AND '12'
  )
);

INSERT INTO "ConfiguredMonth" ("month") VALUES
  ('2026-01'), ('2026-02'), ('2026-03'), ('2026-04'),
  ('2026-05'), ('2026-06'), ('2026-07'), ('2026-08'),
  ('2026-09'), ('2026-10'), ('2026-11'), ('2026-12');