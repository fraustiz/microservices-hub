import postgres from "postgres";

let client: postgres.Sql | undefined;

/** Connexion à agent_db, ouverte au premier usage : le build Next.js importe ce module sans base disponible. */
export function db(): postgres.Sql {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL n'est pas défini");
  client ??= postgres(url, { max: 10, connect_timeout: 3, idle_timeout: 30, onnotice: () => {} });
  return client;
}

/** Schéma d'agent_db. On ajoute une migration à la fin, on ne modifie jamais une migration déjà appliquée. */
const MIGRATIONS = [
  `create table exchanges (
     id uuid primary key default gen_random_uuid(),
     user_id text not null,
     kind text not null check (kind in ('ask', 'summarize')),
     input text not null,
     output text not null,
     sources jsonb not null default '[]',
     prompt_id text not null,
     prompt_version text not null,
     model text,
     prompt_tokens int,
     completion_tokens int,
     latency_ms int not null,
     created_at timestamptz not null default now()
   );
   create index exchanges_user_created on exchanges (user_id, created_at desc)`,
];

/** Applique les migrations manquantes. Le verrou évite que deux instances migrent en même temps. */
export async function migrate(): Promise<void> {
  await db().begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext('schema_migrations'))`;
    await tx`create table if not exists schema_migrations (version int primary key, applied_at timestamptz not null default now())`;
    const [row] = await tx<{ version: number }[]>`select coalesce(max(version), 0)::int as version from schema_migrations`;
    for (const [i, ddl] of MIGRATIONS.entries()) {
      if (i + 1 <= (row?.version ?? 0)) continue;
      await tx.unsafe(ddl);
      await tx`insert into schema_migrations (version) values (${i + 1})`;
    }
  });
}
