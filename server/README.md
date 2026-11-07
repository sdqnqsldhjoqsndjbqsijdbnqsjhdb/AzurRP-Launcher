# Serveur d'authentification et de contenu AzurRP

API Node.js/Express + MySQL (ou MariaDB) utilisée par le launcher AzurRP.

## Fonctions

- Inscription et connexion par pseudo **ou** email, mot de passe haché en bcrypt.
- Jetons de session signés HMAC-SHA256 (format JWT compact), sans dépendance externe.
- Actualités, liens communautaires et annonce affichés dans le launcher.
- API d'administration pour publier les actualités et gérer les comptes.
- Limitation de débit sur la connexion et l'inscription.
- Schéma créé automatiquement au premier démarrage.

## Prérequis

- Node.js ≥ 20.11
- MySQL 8 ou MariaDB 10.6+
- Un utilisateur MySQL avec le droit `CREATE DATABASE` (au premier lancement)

## Installation

```bash
cd server
npm install
cp .env.example .env
```

Édite `.env` :

```dotenv
NODE_ENV=production
JWT_SECRET=<openssl rand -hex 48>
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=azurrp
DB_PASSWORD=un-mot-de-passe-solide
DB_NAME=azurrp
```

Puis :

```bash
npm start
```

Le serveur écoute par défaut sur `http://0.0.0.0:3000` et crée la base, les
tables et le contenu de démonstration si `AUTO_MIGRATE` / `AUTO_SEED` sont
activés.

## Base de données

```sql
CREATE USER 'azurrp'@'%' IDENTIFIED BY 'un-mot-de-passe-solide';
GRANT ALL PRIVILEGES ON azurrp.* TO 'azurrp'@'%';
-- Nécessaire uniquement si la base n'existe pas encore :
GRANT CREATE ON *.* TO 'azurrp'@'%';
FLUSH PRIVILEGES;
```

### Migrations et données de démonstration

```bash
npm run migrate                 # crée/met à jour le schéma, insère les données
npm run migrate -- --force      # réécrit les actualités et liens par défaut
npm run seed                    # données de démonstration uniquement
```

## Créer un compte administrateur

```bash
npm run create-user -- \
  --username Fondateur \
  --email fondateur@azurrp.fr \
  --password "un-mot-de-passe-solide" \
  --role admin
```

Ajoute `--force` pour réinitialiser le mot de passe et le rôle d'un compte
existant.

## Endpoints

Toutes les réponses suivent le format :

```json
{ "ok": true, "data": { } }
{ "ok": false, "error": { "code": "INVALID_CREDENTIALS", "message": "…" } }
```

| Méthode | Route | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/api/v1/health` | — | État du service |
| `POST` | `/api/v1/auth/register` | — | `{ username, email, password }` |
| `POST` | `/api/v1/auth/login` | — | `{ identifier, password }` |
| `GET` | `/api/v1/auth/me` | Bearer | Profil du joueur |
| `POST` | `/api/v1/auth/logout` | Bearer | Déconnexion logique |
| `GET` | `/api/v1/content` | — | Actualités, liens, annonce |
| `GET` | `/api/v1/admin/users` | staff/admin | Liste des comptes |
| `GET` | `/api/v1/admin/news` | staff/admin | Liste complète des actualités |
| `POST` | `/api/v1/admin/news` | staff/admin | Créer une actualité |
| `PUT` | `/api/v1/admin/news/:id` | staff/admin | Modifier une actualité |
| `DELETE` | `/api/v1/admin/news/:id` | staff/admin | Supprimer une actualité |
| `PUT` | `/api/v1/admin/announcement` | admin | Définir l'annonce du launcher |
| `PUT` | `/api/v1/admin/links` | admin | Mettre à jour les liens |

## Reverse proxy (nginx)

```nginx
server {
  listen 443 ssl http2;
  server_name api.azur-rp.eu;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Active `TRUST_PROXY=true` dans `.env` pour que la limitation de débit utilise
l'IP réelle des clients.

## Sécurité

- `JWT_SECRET` est obligatoire en production (≥ 32 caractères).
- Les mots de passe ne sont jamais stockés en clair (bcrypt, 12 rounds).
- `JWT_SECRET` compromis = toutes les sessions doivent être considérées comme
  compromises : change le secret et redéploie.
- Les routes d'administration vérifient le rôle en base à chaque requête.
- Limiteur de débit en mémoire : pour plusieurs instances, utilise Redis ou un
  service partagé.
- Réponds toujours en HTTPS derrière un reverse proxy.

## Docker (optionnel)

Depuis la racine du dépôt :

```bash
docker compose up -d --build
```

Le fichier `docker-compose.yml` démarre MariaDB et l'API, puis applique le
schéma automatiquement. Pense à changer les mots de passe dans
`docker-compose.yml` et à définir `JWT_SECRET` dans l'environnement.
