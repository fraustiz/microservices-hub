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

## D12 — Rate limiting à la gateway, par IP pour le login et par utilisateur pour l'agent (2026-10-20)

- **Décision** : middlewares `rateLimit` de Traefik. Login : 5 requêtes/min par adresse IP. Agent : 10 requêtes/min par utilisateur, compté sur l'en-tête `X-User-Id` posé par ForwardAuth (le middleware est placé après `jwt-auth`). Les 429 prennent le format d'erreur commun grâce au middleware `errors`, qui sert le corps depuis le front.
- **Raison** : une requête refusée n'atteint aucun service (même pas le calcul bcrypt du login). Compter par utilisateur pour l'agent évite de bloquer tous les salariés derrière la même IP d'entreprise, et `X-User-Id` ne peut pas être forgé (`strip-identity`, puis valeur issue du jeton vérifié). Détails dans [gateway.md](gateway.md).
- **Écarté** : un limiteur en mémoire dans chaque service (faux dès qu'il y a plusieurs instances, et contraire à des services sans état) ; un quota stocké en base (un aller-retour SQL de plus par requête) ; Redis (infrastructure supplémentaire pour deux limites, à reconsidérer avec plusieurs gateways).

## D13 — CORS en liste blanche à la gateway (2026-10-20)

- **Décision** : un middleware `cors` unique, sur toutes les routes d'API, avec une liste d'origines explicite (`http://localhost:3000`, le front en `pnpm dev`), cookies autorisés, jamais `*`.
- **Raison** : le front de production est sur la même origine que l'API et n'a pas besoin de CORS ; la liste ne contient que ce qui en a réellement besoin. Traefik répond lui-même aux requêtes préliminaires, avant `jwt-auth`.
- **Écarté** : `*` (interdit avec les cookies, et ouvre l'API à tout site) ; refléter n'importe quelle origine (équivaut à `*`) ; gérer CORS dans chaque service (quatre configurations à garder identiques).

## D14 — Refresh token opaque à usage unique, cookie limité à `/auth` (2026-10-20)

- **Décision** : jeton aléatoire de 32 octets, empreinte SHA-256 en base, valable 7 jours, révoqué à chaque usage et remplacé. Un jeton rejoué révoque toutes les sessions de l'utilisateur. Cookie `Path=/auth`. `/auth/refresh` et `/auth/logout` sont routées sans `jwt-auth`.
- **Raison** : un jeton d'accès de 15 minutes sans reconnexion toutes les 15 minutes. `Path=/auth` garde le refresh token hors de business-service et de l'agent, tout en permettant à `/auth/logout` de le lire pour le révoquer. Logout et refresh doivent marcher quand le jeton d'accès a expiré : c'est leur raison d'être.
- **Écarté** : `Path=/auth/refresh`, prévu en semaine 1 (le logout ne recevrait jamais le cookie et ne pourrait pas le révoquer) ; un refresh token JWT (non révocable sans liste noire) ; un jeton d'accès longue durée (vol plus grave).

## D15 — Mistral `mistral-small-latest`, sortie JSON et références vérifiées (2026-10-20)

- **Statut** : fournisseur et mode JSON remplacés par [D20](#d20--modèle-mistral-servi-par-nvidia-nim-sans-mode-json-imposé-2026-10-20). Les références `Dn` vérifiées et l'absence d'appel sans document restent en vigueur.
- **Décision** : modèle `mistral-small-latest` (configurable par `MISTRAL_MODEL`), température 0,1, mode JSON. Les documents sont numérotés `D1`…`Dn` dans le prompt ; le code fait la correspondance avec les vrais documents et écarte toute référence inconnue. Sans document autorisé correspondant, aucun appel au LLM. Détails dans [prompt-book.md](prompt-book.md).
- **Raison** : un petit modèle suffit pour reformuler quelques documents courts, avec une latence et un coût faibles. Les sources affichées à l'utilisateur ne dépendent jamais de la seule parole du modèle.
- **Écarté** : demander au modèle de recopier les UUID (erreurs de recopie) ; laisser le LLM filtrer les documents selon le rôle (le filtrage reste dans business-service, avant le LLM) ; OpenAI (le sujet laisse le choix, et Mistral, fournisseur européen, était déjà retenu dans l'architecture de la semaine 1).

## D16 — postgres.js et migrations au démarrage (2026-10-20)

- **Décision** : accès SQL avec postgres.js (requêtes en gabarits, paramètres liés). Migrations SQL dans `lib/db.ts` de chaque service, appliquées par `instrumentation.ts` au démarrage, sous verrou consultatif PostgreSQL.
- **Raison** : quelques tables par service, des requêtes simples mais une règle de visibilité qui s'écrit naturellement en SQL. Pas de génération de code ni de moteur binaire dans l'image. Chaque service reste propriétaire de son schéma.
- **Écarté** : Prisma (client généré, moteur binaire, image plus lourde) ; un outil de migration séparé lancé à la main (oubli possible au déploiement) ; un module de migration dans `@hub/shared` (couplerait les services par leur accès à la base).

## D17 — Recherche plein texte PostgreSQL pour la V1 de l'agent (2026-10-20)

- **Décision** : `to_tsvector('french', unaccent(...))`, titre pondéré plus fort que le contenu, termes de la question reliés par OU, classement `ts_rank`, 5 documents au plus.
- **Raison** : aucun service ni modèle supplémentaire, et la recherche reste dans business-service, donc soumise au même filtre de droits que la liste des documents.
- **Écarté pour la V1** : recherche sémantique (embeddings Mistral et pgvector), plus pertinente sur les synonymes mais qui demande de calculer et stocker un vecteur par document. Piste d'évolution notée dans le Prompt Book.

## D18 — Intégration du LLM validée par un faux serveur Mistral (2026-10-20)

- **Statut** : toujours en vigueur ; depuis [D20](#d20--modèle-mistral-servi-par-nvidia-nim-sans-mode-json-imposé-2026-10-20), le faux serveur imite NVIDIA NIM (`tests/e2e/fake-nim.mjs`).
- **Décision** : les tests de bout en bout remplacent l'API Mistral par un faux serveur (`tests/e2e/fake-mistral.mjs`) qui répond au même format et garde les requêtes reçues. La qualité des réponses du vrai modèle se juge à part, avec une vraie clé, sur la grille du Prompt Book.
- **Raison** : on vérifie de façon reproductible, sans clé ni coût, tout ce qui relève du code : données envoyées (documents autorisés seulement, aucun jeton), paramètres, traduction des pannes. Le faux serveur passe par le même chemin réseau (`egress`) et le même client HTTP que Mistral.
- **Écarté** : un mode « mock » dans le code de l'agent (chemin de code qui n'existe qu'en test, risque de l'activer en production) ; des tests automatiques contre le vrai Mistral (réponses non déterministes, coût, clé nécessaire en CI).

## D19 — Nouvelles dépendances épinglées, publiées depuis au moins deux semaines (2026-10-20)

- **Décision** : `jose`, `zod`, `postgres`, `bcryptjs` et `vitest` sont épinglés à une version exacte, publiée depuis au moins deux semaines.
- **Raison** : une version compromise d'un paquet npm est en général détectée et retirée en quelques jours. Pour des bibliothèques de sécurité (JWT, hachage), on ne prend pas une version sortie la veille.
- **Écarté** : les plages `^` sur ces paquets (une version publiée ce matin peut entrer au prochain `pnpm install` sans relecture). `bcryptjs` (JavaScript pur) plutôt que `bcrypt` (module natif à compiler dans l'image Alpine).

## D20 — Modèle Mistral servi par NVIDIA NIM, sans mode JSON imposé (2026-10-20)

- **Statut** : en vigueur ; le modèle `mistralai/mistral-nemotron` est en fin de vie (410 depuis le 2026-09-28), son remplaçant est en cours de vérification ([prompt-book.md](prompt-book.md), section 2).
- **Décision** : ai-agent-service appelle l'API NVIDIA NIM (`https://integrate.api.nvidia.com/v1/chat/completions`, format OpenAI) avec le modèle `mistralai/mistral-nemotron`. Variables `NIM_API_KEY`, `NIM_MODEL`, `NIM_BASE_URL` à la place de `MISTRAL_*`. Aucun mode JSON n'est envoyé à l'API : le format est demandé par le prompt et le code extrait l'objet JSON de la réponse. Prompts passés en version `1.1.0` ([prompt-book.md](prompt-book.md)).
- **Raison** : le plan gratuit de la console Mistral n'active plus les clés API (seules les formules payantes y donnent accès, constaté le 2026-10-20), alors que l'API NIM est gratuite pour le développement avec un compte NVIDIA Developer. Le modèle reste un modèle Mistral, ce qui garde l'esprit du sujet (« OpenAI ou Mistral »). Le format OpenAI permet de changer de modèle, ou de revenir à un fournisseur compatible, par simple configuration. Le mode JSON de NIM (`response_format`, `guided_json`) varie selon les modèles et les versions : ne pas en dépendre évite des erreurs 400 au premier changement de modèle.
- **Contreparties** : offre gratuite réservée au développement et aux tests (une production demande une licence NVIDIA AI Enterprise ou un autre fournisseur), limite d'environ 40 requêtes par minute par clé, partagée par tous les utilisateurs de la plateforme. L'identifiant du modèle peut changer avec le catalogue : le vérifier sur build.nvidia.com en cas d'erreur 404.
- **Écarté** : l'API Mistral en paiement à l'usage (payante, alors qu'une offre gratuite suffit pour le projet) ; un modèle non Mistral du catalogue (`meta/llama-…`), qui s'éloignerait du sujet ; `guided_json` (syntaxe instable d'une version de NIM à l'autre).
