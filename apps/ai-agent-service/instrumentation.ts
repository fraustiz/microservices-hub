/** Exécuté une fois au démarrage du serveur : migrations d'agent_db. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { log } = await import("@hub/shared");
  const { migrate } = await import("./lib/db");
  await migrate();
  log("info", "ai-agent-service prêt", {
    model: process.env.NIM_MODEL || "nvidia/nemotron-3.5-super-vl-120b-a12b",
    nimKey: Boolean(process.env.NIM_API_KEY),
  });
}
