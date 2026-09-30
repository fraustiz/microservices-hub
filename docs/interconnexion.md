# Spécifications d'interconnexion

Tous les échanges : REST/JSON sur HTTP, synchrones. Le front n'appelle que la gateway. Contrôle d'accès détaillé : [securite.md](securite.md).

Ce document est le contrat entre les services. Le routage correspondant est configuré dans la gateway dès la semaine 1 ; le code des routes est écrit en semaine 2.

## Routes exposées par la gateway

| Service | Route | Accès | Implémentation |
| --- | --- | --- | --- |
| auth | `POST /auth/login` | Public (5 req/min) | S2 |
| auth | `POST /auth/logout` | Connecté | S2 |
| auth | `GET /auth/me` | Connecté | S2 |
| auth | `POST /auth/refresh` | Refresh token | S2 |
| business | `GET /api/documents` | Connecté, filtré par rôle et département | S2 |
| business | `GET/POST/PUT /api/rules` | admin | S2 |
| agent | `POST /agent/ask` | Connecté (10 req/min) | S2 |
| agent | `POST /agent/summarize` | Connecté | S2 |

Toutes les routes `/api/**` et `/agent/**` passent par ForwardAuth : sans jeton valide, la gateway refuse la requête avant même d'atteindre le service.

La gateway transmet le chemin **sans le modifier** : `/api/documents` arrive à business-service sous la forme `/api/documents`. Les routes des services sont donc écrites avec leur préfixe (`app/api/documents/route.ts`). Seul `/health`, sans préfixe, n'est pas routé par la gateway : il ne sert qu'au healthcheck Docker, en interne.

### `POST /auth/login`

Requête :

```json
{ "email": "alice@hub.local", "password": "..." }
```

Réponse 200, avec l'en-tête `Set-Cookie: access_token=<JWT>; HttpOnly; SameSite=Strict; Path=/; Max-Age=900` :

```json
{ "user": { "id": "uuid", "email": "alice@hub.local", "role": "admin", "dept": "direction" } }
```

Erreurs : 400 `BAD_REQUEST` (corps invalide), 401 `UNAUTHORIZED` (« Identifiants invalides », même message que l'email existe ou non).

### `GET /auth/me`

Réponse 200 : `{ "user": { "id", "email", "role", "dept" } }`. 401 si le jeton est absent, invalide ou expiré.

### `POST /auth/logout`

Réponse 204, avec un `Set-Cookie` qui vide `access_token` (`Max-Age=0`).

## Routes internes (non routées par la gateway)

| Appelant | Route | Rôle |
| --- | --- | --- |
| Traefik | `GET auth-service:3000/auth/verify` | ForwardAuth : 200 + `X-User-Id`, `X-User-Role`, `X-User-Dept`, ou 401 |
| Tous les services | `GET auth-service:3000/.well-known/jwks.json` | Clé publique RS256 : `{ "keys": [{ "kty": "RSA", "n", "e", "kid", "alg": "RS256", "use": "sig" }] }` |
| ai-agent-service | `GET business-service:3000/api/documents` + `Authorization: Bearer <JWT utilisateur>` | Données autorisées |
| Docker | `GET <service>:3000/health` | Healthcheck (implémenté en S1) |

## Format d'erreur

```json
{ "error": { "code": "FORBIDDEN", "message": "Rôle insuffisant", "requestId": "..." } }
```

Codes : `UNAUTHORIZED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `BAD_REQUEST` 400, `RATE_LIMITED` 429, `UPSTREAM_ERROR` 502, `INTERNAL` 500.

`requestId` reprend l'en-tête `X-Request-Id` s'il est présent, sinon un UUID est généré. Les erreurs inattendues (500) renvoient un message générique : le détail n'apparaît que dans les journaux du service, avec le même `requestId`.
