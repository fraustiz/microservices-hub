import type { AuthUser } from "@hub/shared";
import { db } from "./db";

export interface Document {
  id: string;
  title: string;
  content: string;
  dept: string;
  minRole: string;
  updatedAt: Date;
}

/**
 * Requête plein texte à partir de la saisie : les termes sont reliés par OU et classés par pertinence.
 * Seuls des lettres et des chiffres sont gardés, donc aucune syntaxe tsquery ne peut être injectée.
 */
export function toTsQuery(q: string): string | undefined {
  const terms = [...new Set(q.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [])].slice(0, 20);
  return terms.length ? terms.join(" | ") : undefined;
}

/**
 * Règle de visibilité, appliquée dans la requête SQL (un document non autorisé ne sort jamais de la base) :
 * - admin : tous les documents ;
 * - sinon, rôle ≥ `min_role` du document, et document de son département, de `general`,
 *   ou d'un département ouvert à son rôle par une règle d'accès (`access_rules`).
 */
function visibleTo(user: AuthUser) {
  const sql = db();
  return sql`(
    ${user.role} = 'admin'
    or (role_rank(${user.role}) >= role_rank(d.min_role)
        and (d.dept in ('general', ${user.dept})
             or exists (select 1 from access_rules r
                        where r.dept = d.dept and role_rank(${user.role}) >= role_rank(r.min_role))))
  )`;
}

const COLUMNS = `d.id, d.title, d.content, d.dept, d.min_role as "minRole", d.updated_at as "updatedAt"`;

export async function searchDocuments(user: AuthUser, q: string | undefined, limit: number): Promise<Document[]> {
  const sql = db();
  const tsquery = q ? toTsQuery(q) : undefined;
  if (!tsquery) {
    return sql<Document[]>`
      select ${sql.unsafe(COLUMNS)} from documents d
      where ${visibleTo(user)}
      order by d.updated_at desc, d.title
      limit ${limit}`;
  }
  return sql<Document[]>`
    select ${sql.unsafe(COLUMNS)} from documents d, to_tsquery('french', unaccent(${tsquery})) query
    where ${visibleTo(user)} and document_tsv(d.title, d.content) @@ query
    order by ts_rank(document_tsv(d.title, d.content), query) desc, d.title
    limit ${limit}`;
}

/** Document non autorisé ou inexistant : même réponse, pour ne pas révéler son existence. */
export async function getDocument(user: AuthUser, id: string): Promise<Document | undefined> {
  const sql = db();
  const [doc] = await sql<Document[]>`
    select ${sql.unsafe(COLUMNS)} from documents d where d.id = ${id} and ${visibleTo(user)}`;
  return doc;
}
