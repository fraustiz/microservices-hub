# API Gateway (Traefik)

La gateway est le seul point d'entrée de la plateforme. Elle est définie dans `docker-compose.yml` (service `gateway`) et configurée entièrement par `infra/traefik/dynamic.yml`.

## Rôle

- **Routage** : envoie chaque requête au bon service selon le préfixe du chemin.
- **Contrôle d'accès en première ligne** : ForwardAuth vers auth-service (voir [securite.md](securite.md)).
- **CORS** : liste blanche d'origines, avec cookies.
- **Rate limiting** : login limité par adresse IP, agent IA limité par utilisateur.
- **En-têtes de sécurité** : anti-clickjacking, anti-sniffing MIME, politique de referrer.
- **Journal d'accès** au format JSON (`--accesslog.format=json`).

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
| `auth-login` | `Path(/auth/login)` | `http://auth-service:3000` | strip-identity, security-headers, cors, rate-limit-json, rate-login |
| `auth-session` | `Path(/auth/refresh) \|\| Path(/auth/logout)` | `http://auth-service:3000` | strip-identity, security-headers, cors |
| `auth-private` | `Path(/auth/me)` | `http://auth-service:3000` | strip-identity, security-headers, cors, jwt-auth |
| `business` | `PathPrefix(/api)` | `http://business-service:3000` | strip-identity, security-headers, cors, jwt-auth |
| `agent` | `PathPrefix(/agent)` | `http://ai-agent-service:3000` | strip-identity, security-headers, cors, rate-limit-json, jwt-auth, rate-agent |

Par défaut, Traefik donne la priorité à la règle la plus longue. Le routeur `web` a la priorité 1 (la plus basse) pour ne capter que ce qu'aucun autre routeur ne prend.

Pour auth-service, les routes exposées sont listées une par une (liste blanche) plutôt que tout `/auth/**`. Ainsi, les routes internes `/auth/verify` et `/.well-known/jwks.json` n'ont aucun routeur : depuis l'extérieur, elles tombent sur le front, qui répond 404. Une nouvelle route d'auth-service n'est donc jamais exposée par accident.

`/auth/refresh` et `/auth/logout` n'ont pas `jwt-auth` : elles servent justement quand le jeton d'accès a expiré. auth-service y vérifie lui-même le refresh token ([D14](decisions.md)).

La gateway transmet le chemin sans le modifier : `/api/documents` arrive à business-service sous la forme `/api/documents`.

### Ordre des middlewares

1. **strip-identity** en premier : aucun en-tête `X-User-*` venant du client n'atteint la suite de la chaîne.
2. **security-headers** : s'applique aussi aux réponses d'erreur (401, 429).
3. **cors** avant `jwt-auth` : Traefik répond lui-même aux requêtes préliminaires CORS (`OPTIONS`), qui n'ont jamais de cookie et seraient sinon refusées.
4. **rate-limit-json** avant les limiteurs : il remplace le corps de leurs réponses 429 par le format d'erreur commun.
5. **rate-login** avant tout traitement : une tentative refusée ne coûte même pas un calcul bcrypt.
6. **jwt-auth** : refuse toute requête sans jeton valide.
7. **rate-agent** après `jwt-auth` : il compte par utilisateur, grâce à l'en-tête `X-User-Id` que ForwardAuth vient de poser.

Les noms `web`, `auth-service`, etc. sont résolus par le DNS interne de Docker : la gateway partage les réseaux `public` (avec web) et `internal` (avec les services).

## Middlewares

| Middleware | Effet |
| --- | --- |
| `security-headers` | `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` |
| `strip-identity` | Vide `X-User-Id`, `X-User-Role`, `X-User-Dept` dans la requête du client (une valeur vide retire l'en-tête) |
| `jwt-auth` | ForwardAuth : appelle `GET http://auth-service:3000/auth/verify` en ne transmettant que `Cookie` et `Authorization`. Réponse 2xx : la requête continue avec les en-têtes `X-User-*` renvoyés par auth-service. Sinon, la réponse d'auth-service (401) est renvoyée au client. |
| `cors` | Liste blanche d'origines, avec cookies (détail ci-dessous) |
| `rate-login` | 5 requêtes par minute et par adresse IP |
| `rate-agent` | 10 requêtes par minute et par utilisateur |
| `rate-limit-json` | Remplace le corps texte des 429 de Traefik par le format d'erreur commun |

## CORS

Le front de production est servi par la gateway : il est sur la même origine que l'API et n'a pas besoin de CORS. Les règles CORS ne concernent donc que les pages servies **ailleurs** qui appellent l'API avec les cookies de l'utilisateur.

| Réglage | Valeur | Raison |
| --- | --- | --- |
| Origines autorisées | `http://localhost:3000` | Le front lancé en `pnpm dev` (port 3000) appelle la gateway (port 80) : c'est une autre origine. En production, ajouter ici l'origine d'une éventuelle autre application cliente. |
| `*` | Jamais | Interdit par les navigateurs avec les cookies, et ouvrirait l'API à n'importe quel site |
| Cookies (`Allow-Credentials`) | Oui | L'identité voyage dans le cookie `access_token` |
| Méthodes | `GET`, `POST`, `PUT`, `DELETE` | Celles des contrats d'API |
| En-têtes autorisés | `Content-Type`, `X-Request-Id` | Corps JSON, corrélation |
| En-têtes exposés | `X-Request-Id`, `Retry-After` | Lisibles par le script du front |
| Cache des requêtes préliminaires | 600 s | Une requête `OPTIONS` toutes les 10 minutes au plus par route |
| `Vary: Origin` | Oui | Un cache ne sert pas à une origine la réponse calculée pour une autre |

Une origine absente de la liste ne reçoit **aucun** en-tête `Access-Control-*` : le navigateur bloque la lecture de la réponse. CORS protège la lecture ; l'écriture depuis un site tiers est bloquée par `SameSite=Strict` (le cookie n'est pas envoyé).

## Rate limiting

Traefik applique un seau à jetons : `burst` requêtes d'un coup, puis `average` requêtes par `period`.

| Limiteur | Routes | Limite | Compté par | Menace |
| --- | --- | --- | --- | --- |
| `rate-login` | `POST /auth/login` | 5/min, rafale de 5 | Adresse IP du client | Force brute sur les mots de passe |
| `rate-agent` | `/agent/**` | 10/min, rafale de 10 | Utilisateur (`X-User-Id`) | Coût et quota de l'API Mistral, abus d'un compte |

- L'agent est limité **par utilisateur**, pas par IP : dans une entreprise, des centaines de salariés partagent la même IP publique. `X-User-Id` ne peut pas être forgé : `strip-identity` retire celui du client, puis `jwt-auth` pose celui du jeton vérifié.
- Au-delà de la limite, la gateway répond `429` au format d'erreur commun, avec `Retry-After: 60` : `{ "error": { "code": "RATE_LIMITED", "message": "Trop de requêtes : réessayez dans une minute", "requestId": "..." } }`. Le corps est servi par le front (`apps/web/app/errors/429/route.ts`) via le middleware `errors` de Traefik.
- Les compteurs sont en mémoire dans la gateway : ils repartent de zéro à son redémarrage. Suffisant avec une seule gateway ; avec plusieurs, Traefik peut partager les compteurs dans Redis.
- **En production derrière un autre reverse proxy**, toutes les requêtes arrivent avec l'IP du proxy. Il faut alors déclarer ce proxy dans `forwardedHeaders.trustedIPs` de l'entrypoint et ajouter `sourceCriterion.ipStrategy.depth: 1` à `rate-login`, pour compter l'IP réelle du client.

## Pourquoi un provider fichier et pas les labels Docker

Traefik peut lire sa configuration dans les labels des conteneurs (provider Docker) ou dans un fichier (provider fichier). Le projet utilise **uniquement le fichier** :

- **Pas d'accès au socket Docker** : le provider Docker exige de monter `/var/run/docker.sock` dans la gateway. Même en lecture seule, ce socket donne la liste de tous les conteneurs de l'hôte et leurs variables d'environnement (donc des secrets). Une gateway exposée à Internet ne doit pas y avoir accès.
- **Pas de collision avec un autre Traefik** : si l'hôte a déjà son propre Traefik (reverse proxy qui gère les domaines et le HTTPS), des labels `traefik.*` seraient lus par les deux. Le préfixe `traefik.` ne peut pas être changé.
- **Une seule source de vérité** : toute la configuration de la gateway se trouve dans un seul fichier versionné.

Contrepartie : ajouter un service demande d'éditer `dynamic.yml`, au lieu d'ajouter des labels dans `docker-compose.yml`.

## Ajouter une route

1. Déclarer un routeur et un service dans `infra/traefik/dynamic.yml`. Pour auth-service, ajouter le chemin au routeur qui convient (`auth-login`, `auth-session` ou `auth-private`).
2. Choisir ses middlewares dans l'ordre décrit plus haut : `strip-identity, security-headers, cors, jwt-auth` pour une route d'API protégée, sans `jwt-auth` pour une route publique, avec un limiteur si la route est coûteuse.
3. Mettre à jour le tableau de routage ci-dessus et [interconnexion.md](interconnexion.md).
4. Traefik recharge le fichier à chaud, sans redémarrage.
