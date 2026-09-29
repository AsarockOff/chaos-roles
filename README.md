# Chaos Roles 3D — V1.1

Jeu 3D multijoueur à rôles secrets centré sur les pouvoirs qui perturbent le déplacement.

## Nouveautés V1.1

- Correction des champs texte : taper `S`, `Q`, `W`, etc. dans le pseudo ou le code ne déclenche plus les contrôles du jeu.
- Contrôles compatibles AZERTY et QWERTY : `ZQSD`, `WASD` ou flèches.
- Le pouvoir est maintenant sur `F` pour libérer `Q` sur AZERTY.
- Catalogue des rôles visible dans le lobby.
- Écran de révélation du rôle au début de la partie.
- Resynchronisation du rôle au lancement pour éviter un rôle manquant côté client.
- 9 rôles : Saboteur, Pot de colle, Geôlier, Gardien, Sprinteur, Téléporteur, Bousculeur, Fantôme et Aimanteur.
- Refonte visuelle : éclairage néon, décor spatial, personnages plus détaillés, noms au-dessus des joueurs, ciblage et HUD améliorés.

## Lancer sur ton PC

Prérequis : Node.js 20+.

```bash
npm install
npm start
```

Puis ouvre `http://localhost:3000`.

Pour tester seul, ouvre plusieurs navigateurs ou appareils et rejoins le même code de salon.

## Contrôles

- `ZQSD`, `WASD` ou flèches : déplacement
- `E` : ramasser, poser ou livrer une batterie
- `F` : pouvoir du rôle
- `Tab` : revoir sa carte de rôle

## Objectif

L'équipe tente de livrer les 3 batteries au réacteur avant la fin des 5 minutes. Le Saboteur tente de faire perdre assez de temps. Le Pot de colle est neutre et accomplit son objectif personnel en engluant 3 joueurs différents.

## Déploiement Render

Le serveur écoute `process.env.PORT` et `0.0.0.0`. Le point de contrôle `/health` renvoie également la version du jeu.

Si ce dossier est lui-même dans un sous-dossier GitHub, renseigne ce sous-dossier dans **Render → Settings → Root Directory**. Sinon, place directement `package.json`, `server.js`, `public/`, etc. à la racine du dépôt.
