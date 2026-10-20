/** Exécuté une fois au démarrage du serveur : clés, migrations et comptes de démonstration. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { log } = await import("@hub/shared");
  const { getKeys } = await import("./lib/keys");
  const { migrate, seed } = await import("./lib/db");
  await getKeys();
  await migrate();
  const seeded = await seed();
  log("info", "auth-service prêt", { seededUsers: seeded });
}
