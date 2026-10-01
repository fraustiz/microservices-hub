# Journal des décisions

Chaque choix d'architecture ou de sécurité, avec les options écartées. Les nouvelles décisions s'ajoutent en bas.

## D1 — Trois microservices + un front

- **Décision** : découpage en auth, métier et agent IA, plus un front séparé.
- **Raison** : chaque service a une responsabilité et une base de données qui lui sont propres. Une faille dans l'agent IA (surface la plus exposée : données envoyées à un tiers, injection de prompt) ne donne pas accès aux identifiants.
- **Écarté** : un monolithe modulaire (pas d'isolation réelle des données) ; un service par entité métier (trop fin pour 4 semaines).

## D2 — Monorepo pnpm + Turborepo

- **Décision** : un seul dépôt Git multi-modules.
- **Raison** : le code partagé est typé et versionné avec les services, un seul `pnpm build` vérifie tout, et la revue de code se fait sur un seul dépôt.
- **Écarté** : un dépôt par service (duplication du code partagé, versions désynchronisées).

## D3 — Next.js pour tous les modules, en API seule pour les services

- **Décision** : les services sont des apps Next.js sans pages, uniquement des route handlers.
- **Raison** : une seule stack pour toute l'équipe, image Docker légère grâce à `output: standalone`.
- **Écarté** : Express/Fastify (seconde stack à maîtriser). Le middleware Next.js n'est pas utilisé pour la sécurité (CVE-2025-29927).

## D4 — Une base PostgreSQL par service, sur un réseau dédié

- **Décision** : trois instances PostgreSQL, chacune joignable par son seul service.
- **Raison** : l'isolation est garantie par le réseau, pas par la discipline des développeurs.
- **Écarté** : une instance avec trois schémas (un identifiant compromis ou une erreur de configuration suffit pour tout lire).

## D5 — JWT RS256 avec JWKS

- **Décision** : signature asymétrique, clé privée uniquement dans auth-service, clé publique publiée en JWKS.
- **Raison** : les services vérifient les jetons sans pouvoir en créer. Un service compromis ne peut pas forger d'identité.
- **Écarté** : HS256 (le secret partagé permettrait à chaque service de signer) ; des sessions en base (état partagé, appel à auth-service à chaque requête).

## D6 — Double vérification : gateway puis service

- **Décision** : ForwardAuth à la gateway, et `requireAuth` dans chaque route handler.
- **Raison** : la gateway rejette tôt les requêtes non authentifiées, mais les appels internes (agent → métier) ne passent pas par elle. Le service reste le seul juge de l'accès à ses données.

## D7 — Jeton dans un cookie HttpOnly

- **Décision** : cookie `HttpOnly`, `SameSite=Strict`, durée de vie de 15 minutes.
- **Raison** : illisible par un script injecté (XSS). `SameSite=Strict`, associé à la même origine pour le front et l'API, bloque le CSRF.
- **Écarté** : `localStorage` (lisible par tout script de la page).

## D8 — L'agent IA utilise le JWT de l'utilisateur

- **Décision** : ai-agent-service récupère les données auprès de business-service en transmettant le JWT de l'utilisateur.
- **Raison** : le LLM ne peut recevoir que ce que l'utilisateur a le droit de lire. L'agent n'a aucun privilège propre à détourner.
- **Écarté** : un compte technique de l'agent avec accès complet (une injection de prompt pourrait faire fuiter les données de tous les utilisateurs).

## D9 — Gateway configurée par fichier, sans socket Docker (2026-09-29)

- **Décision** : toute la configuration Traefik est dans `infra/traefik/dynamic.yml`. Plus de labels `traefik.*` sur les services, plus de montage de `/var/run/docker.sock`.
- **Raison** : le socket Docker expose tout l'hôte (liste des conteneurs, variables d'environnement). Si l'hôte a déjà un autre Traefik, les labels seraient lus par les deux. Un seul fichier versionné décrit toute la gateway. Détails dans [gateway.md](gateway.md).
- **Écarté** : `providers.docker.constraints` (ne règle que la moitié du problème : l'autre Traefik voit toujours nos labels).

## D10 — Gateway fermée par défaut (2026-09-30)

- **Décision** : `jwt-auth` (ForwardAuth) est configuré dès la semaine 1 sur toutes les routes protégées, avant que `/auth/verify` soit implémenté (semaine 2).
- **Raison** : tant qu'auth-service ne sait pas valider un jeton, toute route protégée est refusée. Un service ne peut donc jamais être exposé sans contrôle, même pendant le développement.
- **Écarté** : ouvrir les routes le temps du développement et ajouter la sécurité ensuite (risque d'oubli).

## D11 — Communication synchrone REST/JSON, sans relance automatique (2026-10-01)

- **Décision** : les services communiquent en HTTP REST/JSON, de façon synchrone, en s'adressant par leur nom Docker. Chaque appel a un délai maximal (3 s entre services, 30 s vers le LLM) et n'est jamais relancé automatiquement. Détails dans [interconnexion.md](interconnexion.md).
- **Raison** : chaque échange a besoin de sa réponse pour continuer (vérifier un jeton, lire les documents avant d'interroger le LLM). Le synchrone est le plus simple à suivre et à déboguer, surtout avec un `X-Request-Id` commun. Sans relance, un service surchargé ne reçoit pas en plus une vague de nouvelles tentatives.
- **Écarté** : un bus de messages (RabbitMQ, Kafka), utile pour des traitements différés qui n'existent pas ici ; gRPC (contrats binaires plus stricts, mais moins lisibles et sans intérêt à ce volume) ; des relances automatiques (risque d'amplifier une panne).
