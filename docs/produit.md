# Produit : fonctionnalités du produit final

Liste de fonctionnalités qui définit l'application à livrer, indépendamment du découpage en semaines. Le sujet ING1 ne demande **aucune nouvelle fonctionnalité métier en S3-S4** (ces semaines portent sur la résilience, la sécurité et le déploiement, voir [decisions.md](decisions.md) et le tableau « Semaine » de [README.md](README.md)) : ce périmètre est donc déjà figé par ce qui est construit depuis S2, sous réserve du pivot S3 — annoncé par le tuteur en cours de route, contenu inconnu à ce jour, qui pourrait ajouter des contraintes sans changer ce périmètre fonctionnel.

## 1. Fonctionnalités utilisateur (employé)

| # | Fonctionnalité | Où (code) | État |
| --- | --- | --- | --- |
| 1 | Se connecter / se déconnecter, session renouvelée automatiquement | `auth-service` (`/auth/login`, `/auth/logout`, `/auth/refresh`), `apps/web/app/hub.tsx` | Fait |
| 2 | Consulter les documents internes selon son rôle et son département — jamais ceux non autorisés, ni leur existence | `business-service` (`/api/documents`) | Fait |
| 3 | Rechercher dans ces documents (plein texte, français, sans accents) | `business-service/lib/documents.ts` | Fait |
| 4 | Poser une question en langage naturel à un agent IA, réponse appuyée uniquement sur les documents autorisés, sources citées (`[D1]`…) | `ai-agent-service` (`/agent/ask`) | Fait |
| 5 | Obtenir le résumé d'un document accessible | `ai-agent-service` (`/agent/summarize`) | Fait |
| 6 | Consulter l'historique de ses échanges avec l'agent | `ai-agent-service` (`/agent/history`) | Fait |
| 7 | Voir si une affirmation de l'agent a été écartée par manque d'appui documentaire (transparence) | Chaîne de vérification, [prompt-book.md](prompt-book.md) | Fait |

## 2. Fonctionnalités d'administration

| # | Fonctionnalité | Où (code) | État |
| --- | --- | --- | --- |
| 8 | Gérer les règles d'accès inter-départements (créer / modifier / supprimer), réservé au rôle admin | `business-service` (`/api/rules`) | Fait |

## 3. Fonctionnalités transverses (invisibles pour l'utilisateur final, mais font partie du produit livré)

| # | Fonctionnalité | Où (code) | État |
| --- | --- | --- | --- |
| 9 | Isolation stricte des données : une base par service, aucune fuite possible entre services (voir [modele-donnees.md](modele-donnees.md)) | `architecture.md`, réseaux Docker | Fait |
| 10 | Protection contre les abus : limitation de débit sur la connexion et sur l'agent | Gateway Traefik, [gateway.md](gateway.md#rate-limiting) | Fait |
| 11 | Traçabilité : chaque réponse de l'agent historisée avec la version du prompt utilisée | `agent_db.exchanges`, [prompt-book.md](prompt-book.md) | Fait |
| 12 | Accès programmatique documenté (API Swagger), pour qu'un autre système ou développeur puisse intégrer le produit | — | **À livrer (S4)** |
| 13 | Disponibilité en dehors du poste de développement (déploiement) | — aujourd'hui local via `docker compose` uniquement | **À livrer (S4)** |

## Ce qui reste pour que ce périmètre soit un produit livrable

Seuls les points 12 et 13 manquent pour que ce périmètre fonctionnel soit complet et livrable comme produit — le reste est implémenté et testé (voir [developpement.md](developpement.md#tests)). Le pivot S3 pourrait ajouter des contraintes (sécurité, charge) sans changer cette liste, mais ça reste à confirmer une fois l'incident annoncé par le tuteur.
