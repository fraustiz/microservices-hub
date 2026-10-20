import type { Role } from "@hub/shared";
import { db } from "./db";

/** Utilisateur tel qu'il est renvoyé aux clients : jamais l'empreinte du mot de passe. */
export interface User {
  id: string;
  email: string;
  role: Role;
  dept: string;
}

export async function findUserByEmail(email: string): Promise<(User & { passwordHash: string }) | undefined> {
  const [user] = await db()<(User & { passwordHash: string })[]>`
    select id, email, role, dept, password_hash as "passwordHash" from users where email = ${email}`;
  return user;
}

export async function findUserById(id: string): Promise<User | undefined> {
  const [user] = await db()<User[]>`select id, email, role, dept from users where id = ${id}`;
  return user;
}
