# Développement

## Organisation du dépôt

Monorepo **pnpm** (espaces de travail) orchestré par **Turborepo**. Chaque dossier de `apps/` et `packages/` est un paquet indépendant avec son `package.json`.

```
.
├── apps/
│   ├── web/                  Front Next.js
│   ├── auth-service/         API : identifiants, JWT, refresh token
│   ├── business-service/     API : documents et règles d'accès
│   └── ai-agent-service/     API : prompts, appel LLM, historique
├── packages/
│   └── shared/               Code partagé (@hub/shared)
├── infra/traefik/dynamic.yml Configuration de la gateway
├── scripts/init-env.mjs      Création et mise à jour des .env, clé JWT (pnpm env:init)
├── tests/e2e/                Tests de bout en bout et faux serveur NVIDIA NIM
├── docs/                     Documentation (ce dossier)
├── docker-compose.yml        Toute la plateforme en local
├── Dockerfile                Image commune aux 4 apps
├── .gitattributes            Fins de ligne LF pour le hook Git
└── .githooks/commit-msg      Hook Git
```

### Fichiers de configuration à la racine

| Fichier | Rôle |
| --- | --- |
| `package.json` | Scripts globaux (`build`, `typecheck`, `test`, `test:e2e`, `env:init`, `dev`, `hooks`), version de pnpm imposée |
| `pnpm-workspace.yaml` | Déclare `apps/*` et `packages/*` comme paquets |
| `pnpm-lock.yaml` | Versions exactes des dépendances (builds reproductibles) |
| `turbo.json` | Tâches : `build` construit d'abord les dépendances (`^build`), `dev` n'est jamais mis en cache |
| `tsconfig.base.json` | Options TypeScript communes : `strict`, `noUncheckedIndexedAccess` |
| `.npmrc` | Installe automatiquement les peer dependencies |
| `.gitignore` / `.dockerignore` | Excluent `node_modules`, builds, `.env`, `keys/` |

## Les applications

Les quatre apps sont des projets Next.js 16 (React 19). Les trois services n'ont **aucune page** : uniquement des route handlers (`app/<chemin>/route.ts`), c'est-à-dire des API.

Configuration commune (`next.config.ts`) :

- `output: "standalone"` : le build produit un serveur autonome minimal, copié seul dans l'image Docker ;
- `outputFileTracingRoot` pointe vers la racine du monorepo, pour que le build inclue `packages/shared` ;
- `transpilePackages: ["@hub/shared"]` : le paquet partagé est livré en TypeScript source, Next.js le compile ;
- `poweredByHeader: false` : n'annonce pas la technologie du serveur.

Chaque app expose `GET /health`, utilisé par le healthcheck Docker.

### Organisation d'un service

```
apps/<service>/
├── app/<chemin>/route.ts   Route handler : requireAuth, validation zod, appel à lib/
├── lib/                    Logique du service (accès à la base, appels sortants), testée par vitest
│   └── db.ts               Connexion à sa base et migrations
└── instrumentation.ts      Exécuté une fois au démarrage du serveur : migrations, données de démonstration
```

| Service | `lib/` |
| --- | --- |
| auth-service | `keys.ts` (clé privée, JWKS, rotation), `session.ts` (jeton d'accès, refresh token, cookies), `users.ts` |
| business-service | `documents.ts` (recherche et règle de visibilité en SQL), `rules.ts` (règles d'accès), `seed.ts` (jeu de démonstration) |
| ai-agent-service | `prompts.ts` (prompts versionnés, voir [prompt-book.md](prompt-book.md)), `nim.ts` (API NVIDIA NIM), `business.ts` (appels à business-service), `agent.ts` (enchaînement), `history.ts` |

Chaque route handler est enveloppé par `route()` de `@hub/shared`, qui pose `X-Request-Id` sur la réponse et traduit les erreurs au format commun ([interconnexion.md](interconnexion.md), section 6).

### Base de données et migrations

- Accès SQL avec **postgres.js** : requêtes en gabarits SQL, paramètres toujours liés (pas de concaténation, donc pas d'injection SQL).
- Les migrations sont une liste de scripts SQL dans `lib/db.ts`, appliqués au démarrage dans l'ordre, sous un verrou PostgreSQL (deux instances qui démarrent ensemble ne migrent pas deux fois). La table `schema_migrations` retient la dernière version appliquée.
- On **ajoute** une migration à la fin de la liste ; on ne modifie jamais une migration déjà appliquée.
- Données de démonstration : 4 comptes (si `SEED_PASSWORD` est défini), 10 documents et 1 règle d'accès, insérés seulement si les tables sont vides.

## Le paquet partagé `@hub/shared`

Contient uniquement du **code** réutilisé par les services. Jamais de données ni de connexion à une base : sinon les services seraient couplés par le paquet.

| Fichier | Contenu |
| --- | --- |
| `src/config.ts` | Services, rôles et leur rang, `iss`/`aud` des JWT, nom du cookie, délais (3 s, 30 s). Aucun secret. |
| `src/auth.ts` | `requireAuth(req, roles?)` : vérification RS256 avec le JWKS d'auth-service (cache, 30 s entre deux rechargements), contrôle du rôle |
| `src/errors.ts` | Codes d'erreur, `ApiError`, `errorResponse()` (format commun) |
| `src/route.ts` | `route()` : enveloppe des route handlers |
| `src/request.ts` | `X-Request-Id`, lecture des cookies, `parseBody` / `parseQuery` (zod, messages en français) |
| `src/log.ts` | Journal JSON sur une ligne |
| `src/health.ts` | `healthResponse(service)` : réponse standard de `/health` |
| `src/index.ts` | Point d'entrée, réexporte le reste |

## Image Docker

Un seul `Dockerfile` pour les quatre apps, paramétré par `--build-arg APP=<nom>` :

1. **build** : installe tout le monorepo et construit uniquement l'app demandée (`pnpm --filter`) ;
2. **run** : image `node:22-alpine` qui ne contient que la sortie `standalone` et les fichiers statiques.

Le conteneur tourne avec l'utilisateur `node`, pas `root`. Le `HEALTHCHECK` appelle `/health` toutes les 15 s. Docker marque le conteneur comme défaillant après 3 échecs.

## Lancer le projet

Prérequis : Node 22, pnpm (`corepack enable`), Docker Desktop démarré.

```bash
pnpm install
pnpm hooks        # active .githooks (voir plus bas)
pnpm env:init     # crée ou complète les .env depuis les .env.example, génère la clé JWT
docker compose up --build
```

`pnpm env:init` fonctionne à l'identique sous Linux, macOS et Windows, et peut être relancé à tout moment :

- `.env` absent : il est créé depuis `.env.example` ;
- `.env` existant : les variables ajoutées depuis à `.env.example` y sont ajoutées, avec leurs commentaires. Une valeur déjà présente n'est **jamais** modifiée ;
- variables du `.env` que `.env.example` ne connaît plus (par exemple `MISTRAL_*` depuis [D20](decisions.md)) : elles sont signalées, à supprimer à la main ;
- `JWT_PRIVATE_KEY` vide : la clé est générée ; présente mais illisible (chemin de fichier, PEM tronqué…) : elle est signalée, jamais remplacée.

À relancer après chaque mise à jour du dépôt qui touche un `.env.example`. Pour interroger le vrai LLM, créer une clé gratuite sur https://build.nvidia.com (compte NVIDIA Developer) et la renseigner dans `NIM_API_KEY` de `apps/ai-agent-service/.env`.

Ouvrir http://localhost et se connecter avec un compte de démonstration (`alice@hub.local`, `bruno@hub.local`, `chloe@hub.local`, `david@hub.local`, mot de passe `SEED_PASSWORD` de `apps/auth-service/.env`).

### Front en mode développement

Pour modifier le front avec rechargement à chaud, la plateforme tournant dans Docker :

```bash
NEXT_PUBLIC_GATEWAY_URL=http://localhost pnpm --filter @hub/web dev    # http://localhost:3000
```

Le front (port 3000) appelle alors la gateway (port 80) : c'est une autre origine, autorisée par la règle CORS de la gateway ([gateway.md](gateway.md)).

### Vérifier

| Vérification | Attendu |
| --- | --- |
| `docker compose ps` | 8 conteneurs : gateway, web, 3 services (`healthy`), 3 bases (`healthy`) |
| http://localhost | Page de connexion du front |
| http://localhost/api/documents sans être connecté | 401, format d'erreur commun : `jwt-auth` bloque |
| http://localhost/auth/verify | 404 du front : la route interne n'est pas exposée |
| Connexion avec `chloe@hub.local` | 5 documents accessibles, l'agent répond en citant ses sources |

### En cas de problème

- `failed to connect to the docker API` : Docker Desktop n'est pas démarré.
- `env file ... not found` : lancer `pnpm env:init`.
- auth-service redémarre en boucle avec `JWT_PRIVATE_KEY n'est pas défini` : lancer `pnpm env:init`.
- auth-service s'arrête sur `JWT_PRIVATE_KEY illisible` (ou, avant cette vérification, `ERR_OSSL_UNSUPPORTED` / `DECODER routines::unsupported`) : la variable ne contient pas une clé PEM (chemin de fichier, secret partagé, PEM sur plusieurs lignes sans guillemets…). Formats acceptés : PEM sur une ligne avec des `\n` (celui de `pnpm env:init`), PEM sur plusieurs lignes entre guillemets, ou PEM entier en base64. Le plus simple : effacer la valeur pour garder `JWT_PRIVATE_KEY=` (avec ses éventuelles lignes suivantes), puis `pnpm env:init` et `docker compose up`.
- L'agent répond « Service d'IA indisponible » : `NIM_API_KEY` absente ou invalide (401), modèle introuvable ou non servi pour ce compte (404) ou en fin de vie (410) : choisir un modèle qui répond au test ci-dessous et le mettre dans `NIM_MODEL` ou limite de la clé atteinte (429) ; `docker compose logs ai-agent-service` donne le statut renvoyé par NIM.
- Trouver les modèles **réellement** servis pour ta clé : `GET /v1/models` liste aussi des modèles qui répondent 404 ou 410, donc ce script envoie une requête de 5 jetons à chaque modèle de chat Mistral, NVIDIA et OpenAI, avec une pause pour rester sous la limite de la clé (PowerShell ; la clé est lue dans le `.env` sans être affichée). Dernier relevé : [prompt-book.md](prompt-book.md), section 2.

  ```powershell
  $key = ((Select-String -Path apps/ai-agent-service/.env -Pattern '^NIM_API_KEY=(.*)$').Matches[0].Groups[1].Value).Trim().Trim('"')
  $h = @{ Authorization = "Bearer $key" }
  $models = @((Invoke-RestMethod https://integrate.api.nvidia.com/v1/models -Headers $h).data.id |
    Where-Object { $_ -match '^(mistralai|nvidia|openai)/' -and $_ -notmatch 'embed|rerank|retriever|guard|safety|reward|parse|ocr|vila|vlm|clip|cosmos|vision' } | Sort-Object -Unique)
  foreach ($m in $models) {
    $body = @{ model = $m; messages = @(@{ role = "user"; content = "Say OK" }); max_tokens = 5 } | ConvertTo-Json -Depth 4
    try { Invoke-RestMethod -Method Post https://integrate.api.nvidia.com/v1/chat/completions -Headers $h -ContentType "application/json" -Body $body -TimeoutSec 60 | Out-Null; "OK    $m" }
    catch { "ERR   $m   $($_.Exception.Response.StatusCode.value__)" }
    Start-Sleep -Milliseconds 1600
  }
  ```

- `.env` créé avant une mise à jour (par exemple encore en `MISTRAL_*` dans ai-agent-service) : relancer `pnpm env:init`, qui ajoute les variables manquantes (`NIM_*`) et liste celles à supprimer.
- `docker compose logs gateway` : requêtes reçues par Traefik.
- Repartir de zéro : `docker compose down -v` (supprime conteneurs et données des bases), puis `docker compose up --build`.

## Tests

| Commande | Contenu | Prérequis |
| --- | --- | --- |
| `pnpm typecheck` | Types de tous les paquets | — |
| `pnpm test` | Tests unitaires (vitest) : vérification des JWT (`alg: none`, HS256, `iss`, `aud`, expiration), format d'erreur, clés et rotation, recherche, prompts (échappement, analyse de la sortie), client NIM (erreurs, délai, raisonnement `<think>`), cohérence Prompt Book / code | — |
| `TEST_DATABASE_URL=... pnpm --filter @hub/business-service test` | Règle de visibilité et recherche sur une vraie base PostgreSQL | Une base **jetable** : le test vide son schéma |
| `pnpm test:e2e` | 26 vérifications à travers la gateway : routes internes, jeton forgé, en-têtes forgés, filtrage par rôle, CRUD des règles, agent (données envoyées au LLM, panne du LLM, historique), CORS, rate limiting, refresh token et déconnexion | La pile lancée avec le faux NIM (ci-dessous) |

Tests de bout en bout :

```bash
pnpm env:init
docker compose -f docker-compose.yml -f tests/e2e/docker-compose.e2e.yml up -d --build
pnpm test:e2e
docker compose -f docker-compose.yml -f tests/e2e/docker-compose.e2e.yml down -v
```

`tests/e2e/docker-compose.e2e.yml` remplace l'API NVIDIA NIM par un faux serveur (`tests/e2e/fake-nim.mjs`) qui répond au même format et garde les requêtes reçues : les tests vérifient ainsi ce qui partirait chez NVIDIA (documents autorisés uniquement, aucun jeton). Il renvoie volontairement le JSON dans un bloc de code, comme le font certains modèles, pour vérifier que l'agent l'extrait. La qualité des réponses du vrai modèle se vérifie à part, avec une vraie clé ([prompt-book.md](prompt-book.md), section 7).

Base jetable pour le test SQL :

```bash
docker run -d --name pg-test -e POSTGRES_USER=business -e POSTGRES_PASSWORD=business -e POSTGRES_DB=business_db -p 55432:5432 postgres:17-alpine
TEST_DATABASE_URL=postgresql://business:business@localhost:55432/business_db pnpm --filter @hub/business-service test
docker rm -f pg-test
```

## Variables d'environnement

Chaque service lit ses variables dans `apps/<service>/.env`, créé et tenu à jour depuis `.env.example` par `pnpm env:init`. Les `.env` ne sont jamais commités. Tout ajout de variable doit être reporté dans le `.env.example` correspondant.

| Service | Variable | Rôle |
| --- | --- | --- |
| auth-service | `DATABASE_URL` | Connexion à `auth_db` (surchargée par `docker-compose.yml`) |
| auth-service | `JWT_PRIVATE_KEY` | **Secret.** Clé privée RSA (PEM) qui signe les JWT, générée par `pnpm env:init` |
| auth-service | `JWT_PREVIOUS_PUBLIC_KEY` | Clé publique de l'ancienne paire pendant une rotation ([securite.md](securite.md)) |
| auth-service | `SEED_PASSWORD` | Mot de passe des comptes de démonstration ; vide = aucun compte créé (production) |
| auth-service | `COOKIE_SECURE` | `true` derrière HTTPS : cookies `Secure` |
| business-service | `DATABASE_URL` | Connexion à `business_db` |
| business-service | `AUTH_JWKS_URL` | Clé publique d'auth-service (surchargée par `docker-compose.yml`) |
| ai-agent-service | `DATABASE_URL` | Connexion à `agent_db` |
| ai-agent-service | `AUTH_JWKS_URL`, `BUSINESS_SERVICE_URL` | Adresses d'auth-service et de business-service (surchargées par `docker-compose.yml`) |
| ai-agent-service | `NIM_API_KEY` | **Secret.** Clé de l'API NVIDIA NIM (`nvapi-…`) |
| ai-agent-service | `NIM_MODEL` | Modèle du catalogue, `nvidia/nemotron-3.5-super-vl-120b-a12b` par défaut (retenu le 2026-10-20 ; `nvidia/nemotron-3.5-lightning-30b-a3b` est plus rapide mais ne cite pas ses sources ; en changer avec le script de test des modèles) |
| ai-agent-service | `NIM_BASE_URL` | URL de l'API, `https://integrate.api.nvidia.com/v1` par défaut (faux serveur dans les tests e2e) |
| web | `NEXT_PUBLIC_GATEWAY_URL` | Seulement en `pnpm dev` : adresse de la gateway (vide en production, même origine) |

## Conventions

- **Commits** : Conventional Commits, avec le service en portée : `feat(auth): ...`, `fix(gateway): ...`, `docs: ...`.
- **Hook `commit-msg`** : activé par `pnpm hooks`. Il retire des messages de commit les lignes d'attribution automatique ajoutées par les outils d'IA.
- **Entrées** : toute entrée est validée par un schéma zod (`parseBody`, `parseQuery`).
- **Erreurs** : lever une `ApiError` ; `route()` la traduit au format commun décrit dans [interconnexion.md](interconnexion.md).
- **Appels sortants** : toujours avec timeout (3 s entre services, 30 s vers le LLM), jamais relancés.
- **Prompts** : toute modification suit la procédure du [Prompt Book](prompt-book.md) (version, document, tests).
- **Dépendances** : versions exactes, publiées depuis au moins deux semaines ([D19](decisions.md)).
- **Documentation** : tout changement met à jour le document concerné dans `docs/`, et [decisions.md](decisions.md) si c'est un choix d'architecture.
