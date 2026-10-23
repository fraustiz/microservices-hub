# Documentation

Point d'entrée de la documentation. Lire dans cet ordre pour comprendre le projet de bout en bout.

| # | Document | Contenu |
| --- | --- | --- |
| 1 | [architecture.md](architecture.md) | Schéma d'architecture distribuée, rôle de chaque service, isolation réseau |
| 2 | [interconnexion.md](interconnexion.md) | Spécifications d'interconnexion : comment les services communiquent (principes, échanges autorisés et interdits, contenu de chaque appel, contrats d'API, pannes) |
| 3 | [securite.md](securite.md) | Schéma de sécurité JWT, flux d'authentification, menaces traitées |
| 4 | [gateway.md](gateway.md) | Configuration de l'API Gateway Traefik |
| 5 | [developpement.md](developpement.md) | Organisation du monorepo, image Docker, lancement, conventions |
| 6 | [prompt-book.md](prompt-book.md) | **Prompt Book** : prompts envoyés au LLM, paramètres, garde-fous, cas de test, versions |
| 7 | [decisions.md](decisions.md) | Journal des décisions et des options écartées |
| 8 | [modele-donnees.md](modele-donnees.md) | Modèle de données (MCD / MLD) des trois bases, non demandé explicitement par le sujet mais documenté pour la soutenance |
| 9 | [produit.md](produit.md) | Liste de fonctionnalités qui définit le produit final, et ce qui manque pour qu'il soit livrable |

## Semaine 1 : ce qui est rendu

| Attendu du sujet | Où |
| --- | --- |
| Découper l'application en microservices (Auth, Métier, Agent IA) | [architecture.md](architecture.md), modules `apps/*` |
| Configurer l'API Gateway | `infra/traefik/dynamic.yml`, décrite dans [gateway.md](gateway.md) |
| Définir le schéma de sécurité (JWT) | [securite.md](securite.md) |
| **Livrable** : schéma d'architecture distribuée | [architecture.md](architecture.md) |
| **Livrable** : spécifications d'interconnexion | [interconnexion.md](interconnexion.md) |
| **Livrable** : dépôt Git multi-modules | Le dépôt lui-même, décrit dans [developpement.md](developpement.md) |

## Semaine 2 : ce qui est rendu

| Attendu du sujet | Où |
| --- | --- |
| Développer indépendamment les briques applicatives | `apps/auth-service`, `apps/business-service`, `apps/ai-agent-service` (chacun sa base, ses migrations, ses tests), `apps/web` ; contrats dans [interconnexion.md](interconnexion.md) |
| Raccorder l'API OpenAI ou Mistral via des prompts backend | Chaîne de trois prompts backend (recherche, réponse, vérification) ; modèle NVIDIA Nemotron 3.5 Super servi par l'API NVIDIA NIM, au format OpenAI : aucun modèle OpenAI ou Mistral n'est servi sur le compte du projet ([D20](decisions.md) à [D22](decisions.md)) : `apps/ai-agent-service/lib` (`prompts.ts`, `nim.ts`, `agent.ts`), échange F6 de [interconnexion.md](interconnexion.md) |
| Gérer le rate limiting | Middlewares `rate-login` et `rate-agent` de `infra/traefik/dynamic.yml`, [gateway.md](gateway.md#rate-limiting) |
| Mettre en place les règles CORS | Middleware `cors` de `infra/traefik/dynamic.yml`, [gateway.md](gateway.md#cors) |
| **Livrable** : microservices opérationnels | `docker compose up --build`, puis http://localhost ; vérifiés par `pnpm test` et `pnpm test:e2e` ([developpement.md](developpement.md#tests)) |
| **Livrable** : intégration du LLM validée | Tests unitaires du client NIM et des prompts, tests de bout en bout avec un faux serveur NIM ([D18](decisions.md)), grille d'évaluation avec le vrai modèle ([prompt-book.md](prompt-book.md#7-évaluation-avec-le-vrai-modèle)) |
| **Livrable** : Prompt Book V1 | [prompt-book.md](prompt-book.md) |

## État du dépôt

| Élément | État |
| --- | --- |
| Monorepo, 4 modules + paquet partagé, image Docker, `/health` | Fait (S1) |
| Réseaux Docker isolés, une base par service | Fait (S1) |
| Gateway : routage, en-têtes de sécurité, `strip-identity`, `jwt-auth` (ForwardAuth) | Fait (S1) |
| auth-service : login, JWT RS256, JWKS, `/auth/verify`, refresh token, logout | Fait (S2) |
| business-service : documents filtrés par rôle et département, recherche, règles d'accès | Fait (S2) |
| ai-agent-service : questions et résumés via NVIDIA NIM (Nemotron 3.5 Super), historique | Fait (S2) |
| Front : connexion, questions à l'agent, documents, résumés | Fait (S2) |
| CORS, rate limiting, Prompt Book V1 | Fait (S2) |
| Tests unitaires et de bout en bout | Fait (S2) |

Les diagrammes sont en Mermaid, affichés directement par GitHub.
