import { z } from "zod";
import { ApiError, ROLES } from "@hub/shared";
import { db } from "./db";

export interface Rule {
  id: string;
  dept: string;
  minRole: string;
  description: string;
  updatedAt: Date;
}

/** Règle d'accès : « les utilisateurs de rôle ≥ minRole, de tout département, lisent les documents de `dept` ». */
export const ruleInput = z.object({
  dept: z.string().regex(/^[a-z][a-z0-9-]{1,31}$/, "département attendu en minuscules, ex. finance"),
  minRole: z.enum(ROLES),
  description: z.string().trim().max(500).default(""),
});
export type RuleInput = z.infer<typeof ruleInput>;

const COLUMNS = `id, dept, min_role as "minRole", description, updated_at as "updatedAt"`;

export async function listRules(): Promise<Rule[]> {
  const sql = db();
  return sql<Rule[]>`select ${sql.unsafe(COLUMNS)} from access_rules order by dept, min_role`;
}

const UNIQUE_VIOLATION = "23505";

function conflict(err: unknown): never {
  if (err instanceof Error && "code" in err && err.code === UNIQUE_VIOLATION) {
    throw new ApiError("CONFLICT", "Une règle existe déjà pour ce département et ce rôle");
  }
  throw err;
}

export async function createRule(input: RuleInput): Promise<Rule> {
  const sql = db();
  const [rule] = await sql<Rule[]>`
    insert into access_rules (dept, min_role, description) values (${input.dept}, ${input.minRole}, ${input.description})
    returning ${sql.unsafe(COLUMNS)}`.catch(conflict);
  return rule!;
}

export async function updateRule(id: string, input: RuleInput): Promise<Rule> {
  const sql = db();
  const [rule] = await sql<Rule[]>`
    update access_rules set dept = ${input.dept}, min_role = ${input.minRole}, description = ${input.description},
                            updated_at = now()
    where id = ${id}
    returning ${sql.unsafe(COLUMNS)}`.catch(conflict);
  if (!rule) throw new ApiError("NOT_FOUND", "Règle introuvable");
  return rule;
}

export async function deleteRule(id: string): Promise<void> {
  const rows = await db()`delete from access_rules where id = ${id}`;
  if (rows.count === 0) throw new ApiError("NOT_FOUND", "Règle introuvable");
}
