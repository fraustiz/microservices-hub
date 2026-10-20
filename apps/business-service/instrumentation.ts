/** Exécuté une fois au démarrage du serveur : migrations et données de démonstration. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { log } = await import("@hub/shared");
  const { migrate, seed } = await import("./lib/db");
  await migrate();
  const seeded = await seed();
  log("info", "business-service prêt", { seededDocuments: seeded });
}
