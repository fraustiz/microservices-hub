import bcrypt from "bcryptjs";
import { z } from "zod";
import { ApiError, log, parseBody, route } from "@hub/shared";
import { sessionResponse } from "@/lib/session";
import { findUserByEmail } from "@/lib/users";

export const dynamic = "force-dynamic";

const body = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(200),
});

/** Empreinte bcrypt (coût 12) d'un mot de passe aléatoire : un email inconnu coûte le même temps qu'un email connu. */
const DUMMY_HASH = "$2b$12$fMVTWY.MDlmtbIuPJORZvuzzKIv7gR2z/O9jAt0xiK7F53nh649U2";

export const POST = route(async (req, { requestId }) => {
  const { email, password } = await parseBody(req, body);
  const user = await findUserByEmail(email.toLowerCase());
  const valid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !valid) {
    log("warn", "échec de connexion", { requestId, ip: req.headers.get("x-forwarded-for") });
    // Même message que l'email existe ou non : pas d'énumération des comptes.
    throw new ApiError("UNAUTHORIZED", "Identifiants invalides");
  }
  const { passwordHash: _, ...publicUser } = user;
  return sessionResponse(publicUser);
});
