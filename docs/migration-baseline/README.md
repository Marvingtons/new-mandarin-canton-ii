# Migration baseline

`verify:station-migrations` was deleted on 2026-11-27: it only proved the one-time 011-016 rollout against a pre-011 `main` (seeding the retired `printer_status` table), and 011-016 are now folded into `schema.sql`, so it could only fail.
