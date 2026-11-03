/**
 * Test values shared by scripts/e2e-server.ts and the specs. None of these is
 * a real credential: they exist only on the throwaway server that script
 * starts, which never sees the database or secrets in .env.local.
 */
export const E2E_PORT = Number(process.env.E2E_PORT ?? 3100);
export const E2E_DB_PORT = Number(process.env.E2E_DB_PORT ?? 55441);
export const E2E_KITCHEN_PASSWORD = "e2e-kitchen-password";
export const E2E_BYPASS = "e2e-gate-bypass";
