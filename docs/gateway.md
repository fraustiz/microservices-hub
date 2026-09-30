# API Gateway (Traefik)

La gateway est le seul point d'entrée de la plateforme. Elle est définie dans `docker-compose.yml` (service `gateway`) et configurée entièrement par `infra/traefik/dynamic.yml`.

## Rôle

- **Routage** : envoie chaque requête au bon service selon le préfixe du chemin.
- **Contrôle d'accès en première ligne** : ForwardAuth vers auth-service (voir [securite.md](securite.md)).
- **En-têtes de sécurité** : anti-clickjacking, anti-sniffing MIME, politique de referrer.
- **Journal d'accès** au format JSON (`--accesslog.format=json`).
- **CORS et rate limiting** : semaine 2.

## Deux niveaux de configuration

Traefik distingue deux configurations :

| Niveau | Où | Contenu |
| --- | --- | --- |
| Statique (au démarrage) | arguments `command:` du service `gateway` dans `docker-compose.yml` | Point d'entrée `web` sur le port 80, provider fichier, journal d'accès |
| Dynamique (rechargée à chaud) | `infra/traefik/dynamic.yml`, monté en lecture seule | Routeurs, services, middlewares |

## Routage

| Routeur | Règle | Service cible | Middlewares (dans l'ordre) |
| --- | --- | --- | --- |
| `web` | `PathPrefix(/)`, priorité 1 | `http://web:3000` | strip-identity, security-headers |
| `auth-public` | `Path(/auth/login)` | `http://auth-service:3000` | strip-identity, security-headers |
| `auth-private` | `Path(/auth/me) \|\| Path(/auth/logout)` | `http://auth-service:3000` | strip-identity, security-headers, jwt-auth |
| `business` | `PathPrefix(/api)` | `http://business-service:3000` | strip-identity, security-headers, jwt-auth |
| `agent` | `PathPrefix(/agent)` | `http://ai-agent-service:3000` | strip-identity, security-headers, jwt-auth |

Par défaut, Traefik donne la priorité à la règle la plus longue. Le routeur `web` a la priorité 1 (la plus basse) pour ne capter que ce qu'aucun autre routeur ne prend.

Pour auth-service, les routes exposées sont listées une par une (liste blanche) plutôt que tout `/auth/**`. Ainsi, les routes internes `/auth/verify` et `/.well-known/jwks.json` n'ont aucun routeur : depuis l'extérieur, elles tombent sur le front, qui répond 404. Une nouvelle route d'auth-service n'est donc jamais exposée par accident.

La gateway transmet le chemin sans le modifier : `/api/documents` arrive à business-service sous la forme `/api/documents`.

### Ordre des middlewares

1. **strip-identity** en premier : aucun en-tête `X-User-*` venant du client n'atteint la suite de la chaîne.
2. **security-headers** : s'applique aussi aux réponses d'erreur (401).
3. **jwt-auth** en dernier : refuse toute requête sans jeton valide.

En semaine 2, `cors` s'insérera avant `jwt-auth` : Traefik répond lui-même aux requêtes préliminaires CORS (`OPTIONS`), qui n'ont jamais de cookie et seraient sinon refusées.

Les noms `web`, `auth-service`, etc. sont résolus par le DNS interne de Docker : la gateway partage les réseaux `public` (avec web) et `internal` (avec les services).

## Middlewares

| Middleware | État | Effet |
| --- | --- | --- |
| `security-headers` | Configuré (S1) | `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` |
| `strip-identity` | Configuré (S1) | Vide `X-User-Id`, `X-User-Role`, `X-User-Dept` dans la requête du client (une valeur vide retire l'en-tête) |
| `jwt-auth` | Configuré (S1) | ForwardAuth : appelle `GET http://auth-service:3000/auth/verify` en ne transmettant que `Cookie` et `Authorization`. Réponse 2xx : la requête continue avec les en-têtes `X-User-*` renvoyés par auth-service. Sinon, la réponse d'auth-service est renvoyée au client. |
| `cors` | S2 | Liste blanche d'origines, avec cookies. Jamais `*`, incompatible avec les cookies. |
| rate limiting | S2 | Login : 5 req/min, agent : 10 req/min |

`/auth/verify` est implémenté en semaine 2. D'ici là, auth-service répond 404 à ForwardAuth, et **toutes les routes protégées sont refusées** : la gateway est fermée par défaut.

## Pourquoi un provider fichier et pas les labels Docker

Traefik peut lire sa configuration dans les labels des conteneurs (provider Docker) ou dans un fichier (provider fichier). Le projet utilise **uniquement le fichier** :

- **Pas d'accès au socket Docker** : le provider Docker exige de monter `/var/run/docker.sock` dans la gateway. Même en lecture seule, ce socket donne la liste de tous les conteneurs de l'hôte et leurs variables d'environnement (donc des secrets). Une gateway exposée à Internet ne doit pas y avoir accès.
- **Pas de collision avec un autre Traefik** : si l'hôte a déjà son propre Traefik (reverse proxy qui gère les domaines et le HTTPS), des labels `traefik.*` seraient lus par les deux. Le préfixe `traefik.` ne peut pas être changé.
- **Une seule source de vérité** : toute la configuration de la gateway se trouve dans un seul fichier versionné.

Contrepartie : ajouter un service demande d'éditer `dynamic.yml`, au lieu d'ajouter des labels dans `docker-compose.yml`.

## Ajouter une route

1. Déclarer un routeur et un service dans `infra/traefik/dynamic.yml`. Pour auth-service, ajouter le chemin à `auth-public` ou `auth-private`.
2. Choisir ses middlewares dans l'ordre décrit plus haut : `strip-identity, security-headers, jwt-auth` pour une route protégée, sans `jwt-auth` pour une route publique.
3. Mettre à jour le tableau de routage ci-dessus et [interconnexion.md](interconnexion.md).
4. Traefik recharge le fichier à chaud, sans redémarrage.
