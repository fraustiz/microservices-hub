import postgres from "postgres";
import { SEED_DOCUMENTS, SEED_RULES } from "./seed";

let client: postgres.Sql | undefined;

/** Connexion à business_db, ouverte au premier usage : le build Next.js importe ce module sans base disponible. */
export function db(): postgres.Sql {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL n'est pas défini");
  client ??= postgres(url, { max: 10, connect_timeout: 3, idle_timeout: 30, onnotice: () => {} });
  return client;
}

/** Schéma de business_db. On ajoute une migration à la fin, on ne modifie jamais une migration déjà appliquée. */
const MIGRATIONS = [
  `create extension if not exists unaccent;
   create function role_rank(role text) returns int language sql immutable as $$
     select case role when 'employee' then 1 when 'manager' then 2 when 'admin' then 3 else 0 end
   $$;
   -- Titre pondéré plus fort que le contenu ; accents ignorés (« conges » trouve « congés »).
   create function document_tsv(title text, content text) returns tsvector language sql stable as $$
     select setweight(to_tsvector('french', unaccent(title)), 'A') || setweight(to_tsvector('french', unaccent(content)), 'B')
   $$;
   create table documents (
     id uuid primary key default gen_random_uuid(),
     title text not null,
     content text not null,
     dept text not null,
     min_role text not null default 'employee' check (min_role in ('employee', 'manager', 'admin')),
     updated_at timestamptz not null default now()
   );
   create table access_rules (
     id uuid primary key default gen_random_uuid(),
     dept text not null,
     min_role text not null check (min_role in ('employee', 'manager', 'admin')),
     description text not null default '',
     updated_at timestamptz not null default now(),
     unique (dept, min_role)
   )`,
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

/** Documents et règles de démonstration, insérés seulement si la base est vide. */
export async function seed(): Promise<number> {
  const [row] = await db()<{ count: number }[]>`select count(*)::int as count from documents`;
  if (row?.count) return 0;
  await db().begin(async (tx) => {
    for (const doc of SEED_DOCUMENTS) {
      await tx`insert into documents (title, content, dept, min_role) values (${doc.title}, ${doc.content}, ${doc.dept}, ${doc.minRole})`;
    }
    for (const rule of SEED_RULES) {
      await tx`insert into access_rules (dept, min_role, description) values (${rule.dept}, ${rule.minRole}, ${rule.description})
               on conflict (dept, min_role) do nothing`;
    }
  });
  return SEED_DOCUMENTS.length;
}
