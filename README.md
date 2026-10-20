# MicroServices-Hub

Plateforme d'entreprise en microservices : authentification, règles métier et agent d'IA générative, derrière une API Gateway Traefik.

```
navigateur → Traefik (gateway, seul port exposé)
               ├─ /auth/**  → auth-service      → auth_db
               ├─ /api/**   → business-service  → business_db
               ├─ /agent/** → ai-agent-service  → agent_db, API NVIDIA NIM
               └─ /         → web (Next.js)
```

**Documentation complète : [docs/README.md](docs/README.md)** (architecture, interconnexion, sécurité, gateway, développement, [Prompt Book](docs/prompt-book.md), décisions).

## Démarrage

Prérequis : Node 22, pnpm (`corepack enable`), Docker.

```bash
pnpm install
pnpm hooks                                    # active le hook Git de .githooks
pnpm env:init                                 # crée ou complète les .env, génère la clé de signature JWT et le mot de passe de démonstration
docker compose up --build                     # puis http://localhost
```

Pour que l'agent IA réponde, créer une clé gratuite sur [build.nvidia.com](https://build.nvidia.com) et la renseigner dans `NIM_API_KEY` de `apps/ai-agent-service/.env` (sans clé, il répond « Service d'IA indisponible »).

`docker compose ps` doit montrer les 8 conteneurs démarrés, et http://localhost afficher la page de connexion. Comptes de démonstration : `alice@hub.local` (admin), `bruno@hub.local` (manager RH), `chloe@hub.local` (employée RH), `david@hub.local` (employé tech), mot de passe affiché par `pnpm env:init` (`SEED_PASSWORD` de `apps/auth-service/.env`).

## Tests

```bash
pnpm typecheck && pnpm test                   # types et tests unitaires
docker compose -f docker-compose.yml -f tests/e2e/docker-compose.e2e.yml up -d --build
pnpm test:e2e                                 # bout en bout via la gateway, avec un faux serveur NIM
```

## Structure

| Dossier | Contenu |
| --- | --- |
| `apps/web` | Front Next.js |
| `apps/auth-service` | Next.js API seul (auth, JWT, refresh token) |
| `apps/business-service` | Next.js API seul (documents, règles d'accès) |
| `apps/ai-agent-service` | Next.js API seul (prompts, LLM via NVIDIA NIM, historique) |
| `packages/shared` | Code partagé (jamais de données) : `requireAuth`, format d'erreur |
| `infra/traefik` | Configuration de la gateway (routage, ForwardAuth, CORS, rate limiting) |
| `tests/e2e` | Tests de bout en bout et faux serveur NIM |
| `docs` | Documentation, dont le Prompt Book |
