# Développement

## Organisation du dépôt

Monorepo **pnpm** (espaces de travail) orchestré par **Turborepo**. Chaque dossier de `apps/` et `packages/` est un paquet indépendant avec son `package.json`.

```
.
├── apps/
│   ├── web/                  Front Next.js
│   ├── auth-service/         API : identifiants, JWT
│   ├── business-service/     API : données et règles métier
│   └── ai-agent-service/     API : prompts, appel LLM
├── packages/
│   └── shared/               Code partagé (@hub/shared)
├── infra/traefik/dynamic.yml Configuration de la gateway
├── docs/                     Documentation (ce dossier)
├── docker-compose.yml        Toute la plateforme en local
├── Dockerfile                Image commune aux 4 apps
├── .gitattributes            Fins de ligne LF pour le hook Git
└── .githooks/commit-msg      Hook Git
```

En semaine 1, chaque module est un squelette qui compile, se construit en image Docker et répond sur `/health`. Le code métier de chaque module est écrit en semaine 2.

### Fichiers de configuration à la racine

| Fichier | Rôle |
| --- | --- |
| `package.json` | Scripts globaux (`build`, `typecheck`, `dev`, `hooks`), version de pnpm imposée |
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

## Le paquet partagé `@hub/shared`

Contient uniquement du **code** réutilisé par les services. Jamais de données ni de connexion à une base : sinon les services seraient couplés par le paquet.

| Fichier | Contenu |
| --- | --- |
| `src/config.ts` | Liste des services (constantes, aucun secret) |
| `src/health.ts` | `healthResponse(service)` : réponse standard de `/health` |
| `src/index.ts` | Point d'entrée, réexporte le reste |

Prévu en semaine 2 : `requireAuth(req, roles?)` et le format d'erreur commun (voir [securite.md](securite.md)).

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
for s in auth-service business-service ai-agent-service; do cp apps/$s/.env.example apps/$s/.env; done
docker compose up --build
```

Sous PowerShell, seule la copie des `.env` change :

```powershell
foreach ($s in "auth-service", "business-service", "ai-agent-service") { Copy-Item "apps/$s/.env.example" "apps/$s/.env" }
```

Autres commandes : `pnpm typecheck` (types de tous les paquets), `pnpm build`.

### Vérifier

| Vérification | Attendu |
| --- | --- |
| `docker compose ps` | 8 conteneurs : gateway, web, 3 services (`healthy`), 3 bases (`healthy`) |
| http://localhost | Page d'accueil du front : la gateway route vers `web` |
| http://localhost/api/test | Refusé : `jwt-auth` bloque, car `/auth/verify` n'existe pas encore (fermé par défaut) |
| http://localhost/auth/verify | 404 du front : la route interne n'est pas exposée |

### En cas de problème

- `failed to connect to the docker API` : Docker Desktop n'est pas démarré.
- `env file ... not found` : les `.env` n'ont pas été copiés (voir plus haut).
- `docker compose logs gateway` : requêtes reçues par Traefik.
- Repartir de zéro : `docker compose down -v` (supprime conteneurs et données des bases), puis `docker compose up --build`.

## Variables d'environnement

Chaque service lit ses variables dans `apps/<service>/.env`, créé depuis `.env.example`. Les `.env` ne sont jamais commités. Tout ajout de variable doit être reporté dans le `.env.example` correspondant.

| Service | Variable | Rôle |
| --- | --- | --- |
| auth-service | `DATABASE_URL` | Connexion à `auth_db` (surchargée par `docker-compose.yml`) |
| business-service | `DATABASE_URL` | Connexion à `business_db` |
| ai-agent-service | `DATABASE_URL` | Connexion à `agent_db` |

Les secrets arrivent en semaine 2 : clé privée JWT (auth-service uniquement), clé API Mistral (ai-agent-service uniquement).

## Conventions

- **Commits** : Conventional Commits, avec le service en portée : `feat(auth): ...`, `fix(gateway): ...`, `docs: ...`.
- **Hook `commit-msg`** : activé par `pnpm hooks`. Il retire des messages de commit les lignes d'attribution automatique ajoutées par les outils d'IA.
- **Entrées** : toute entrée est validée par un schéma zod.
- **Erreurs** : format commun décrit dans [interconnexion.md](interconnexion.md).
- **Appels sortants** : toujours avec timeout (3 s entre services, 30 s vers le LLM).
- **Documentation** : tout changement met à jour le document concerné dans `docs/`, et [decisions.md](decisions.md) si c'est un choix d'architecture.
