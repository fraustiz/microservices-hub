type Level = "info" | "warn" | "error";

/** Journal JSON sur une ligne, lisible par `docker compose logs`. Ne jamais y mettre de jeton ni de mot de passe. */
export function log(level: Level, msg: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ time: new Date().toISOString(), level, service: process.env.APP, msg, ...fields });
  if (level === "error") console.error(line);
  else console.log(line);
}
