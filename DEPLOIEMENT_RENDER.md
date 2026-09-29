# Déployer Chaos Roles 3D V1.1 sur Render

## Option recommandée : fichiers à la racine du dépôt

Ton dépôt GitHub doit ressembler à ceci :

```text
Chaos_roles/
├── package.json
├── server.js
├── render.yaml
├── Dockerfile
└── public/
    ├── index.html
    ├── main.js
    └── style.css
```

Dans Render :

- Runtime : Node
- Build Command : `npm install`
- Start Command : `npm start`
- Health Check Path : `/health`
- Root Directory : laisser vide

## Si tu gardes le projet dans un sous-dossier

Exemple :

```text
Chaos_roles/
└── chaos_roles_3d_v1_1/
    ├── package.json
    ├── server.js
    └── public/
```

Alors mets dans Render :

```text
Root Directory = chaos_roles_3d_v1_1
```

Puis redéploie avec **Manual Deploy → Deploy latest commit**.
