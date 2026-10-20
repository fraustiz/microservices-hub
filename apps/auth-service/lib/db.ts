import bcrypt from "bcryptjs";
import postgres from "postgres";
import type { Role } from "@hub/shared";

let client: postgres.Sql | undefined;

/** Connexion à auth_db, ouverte au premier usage : le build Next.js importe ce module sans base disponible. */
export function db(): postgres.Sql {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL n'est pas défini");
  client ??= postgres(url, { max: 10, connect_timeout: 3, idle_timeout: 30, onnotice: () => {} });
  return client;
}

/** Schéma d'auth_db. On ajoute une migration à la fin, on ne modifie jamais une migration déjà appliquée. */
const MIGRATIONS = [
  `create table users (
     id uuid primary key default gen_random_uuid(),
     email text not null unique,
     password_hash text not null,
     role text not null check (role in ('employee', 'manager', 'admin')),
     dept text not null,
     created_at timestamptz not null default now()
   )`,
  `create table refresh_tokens (
     id uuid primary key default gen_random_uuid(),
     user_id uuid not null references users (id) on delete cascade,
     token_hash text not null unique,
     expires_at timestamptz not null,
     revoked_at timestamptz,
     created_at timestamptz not null default now()
   );
   create index refresh_tokens_user_id on refresh_tokens (user_id)`,
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

/** Comptes de démonstration (un par rôle). Créés seulement si SEED_PASSWORD est défini et la table vide. */
const SEED_USERS: { email: string; role: Role; dept: string }[] = [
  { email: "alice@hub.local", role: "admin", dept: "direction" },
  { email: "bruno@hub.local", role: "manager", dept: "rh" },
  { email: "chloe@hub.local", role: "employee", dept: "rh" },
  { email: "david@hub.local", role: "employee", dept: "tech" },
];

export async function seed(): Promise<number> {
  const password = process.env.SEED_PASSWORD;
  if (!password) return 0;
  const [row] = await db()<{ count: number }[]>`select count(*)::int as count from users`;
  if (row?.count) return 0;
  for (const user of SEED_USERS) {
    const passwordHash = await bcrypt.hash(password, 12);
    await db()`insert into users (email, password_hash, role, dept)
               values (${user.email}, ${passwordHash}, ${user.role}, ${user.dept})
               on conflict (email) do nothing`;
  }
  return SEED_USERS.length;
}
