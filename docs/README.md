# Documentation

Point d'entrée de la documentation. Lire dans cet ordre pour comprendre le projet de bout en bout.

| # | Document | Contenu |
| --- | --- | --- |
| 1 | [architecture.md](architecture.md) | Schéma d'architecture distribuée, rôle de chaque service, isolation réseau |
| 2 | [interconnexion.md](interconnexion.md) | Spécifications d'interconnexion : routes, appels entre services, format d'erreur |
| 3 | [securite.md](securite.md) | Schéma de sécurité JWT, flux d'authentification, menaces traitées |
| 4 | [gateway.md](gateway.md) | Configuration de l'API Gateway Traefik |
| 5 | [developpement.md](developpement.md) | Organisation du monorepo, image Docker, lancement, conventions |
| 6 | [decisions.md](decisions.md) | Journal des décisions et des options écartées |

## Semaine 1 : ce qui est rendu

| Attendu du sujet | Où |
| --- | --- |
| Découper l'application en microservices (Auth, Métier, Agent IA) | [architecture.md](architecture.md), modules `apps/*` |
| Configurer l'API Gateway | `infra/traefik/dynamic.yml`, décrite dans [gateway.md](gateway.md) |
| Définir le schéma de sécurité (JWT) | [securite.md](securite.md) |
| **Livrable** : schéma d'architecture distribuée | [architecture.md](architecture.md) |
| **Livrable** : spécifications d'interconnexion | [interconnexion.md](interconnexion.md) |
| **Livrable** : dépôt Git multi-modules | Le dépôt lui-même, décrit dans [developpement.md](developpement.md) |

## État du dépôt

| Élément | État |
| --- | --- |
| Monorepo, 4 modules + paquet partagé, image Docker, `/health` | Fait (S1) |
| Réseaux Docker isolés, une base par service | Fait (S1) |
| Gateway : routage, en-têtes de sécurité, `strip-identity`, `jwt-auth` (ForwardAuth) | Configuré (S1) |
| Code des services : auth (login, JWT, JWKS, `/auth/verify`), métier, agent IA | Semaine 2 |
| CORS, rate limiting, intégration Mistral, Prompt Book | Semaine 2 |

Les diagrammes sont en Mermaid, affichés directement par GitHub.
