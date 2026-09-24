# Mise en ligne sur Vercel

## Architecture retenue

Vercel sert la boutique et exécute l’API. Supabase fournit l’authentification, PostgreSQL et le stockage **privé** des justificatifs/documents de commande. Cloudinary stocke et distribue les photos **publiques** du catalogue. Les secrets serveur ne sont jamais envoyés au navigateur.

## Prérequis obligatoires

1. Un projet Supabase avec confirmation des adresses e-mail activée.
2. Le schéma `supabase/schema.sql` exécuté dans le SQL Editor Supabase.
3. Une URL PostgreSQL **Transaction pooler** Supabase.
4. La clé serveur `service_role` Supabase, réservée à Vercel.
5. L’adresse e-mail du compte gérant, identique au compte Supabase utilisé pour administrer le site.
6. Un compte Cloudinary et ses identifiants serveur.
7. Le domaine Vercel définitif pour `SITE_ORIGIN`.

## Variables Vercel

Copier les noms de `.env.vercel.example` dans **Vercel → Project Settings → Environment Variables**. Les jetons et clés doivent être marqués secrets. Définir les variables pour Production et Preview si les aperçus doivent fonctionner.

Variables Cloudinary obligatoires :

- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`

Ne jamais placer `CLOUDINARY_API_SECRET` dans `app.js`, `index.html`, une variable `PUBLIC_*` ou un dépôt Git.

`SITE_ORIGIN` doit correspondre exactement à l’URL affichée dans le navigateur. Après ajout d’un domaine personnalisé, remplacer l’ancienne valeur puis redéployer.

## Déploiement

1. Importer ce dépôt dans Vercel.
2. Framework preset : **Other**.
3. Build command : `npm run vercel-build`.
4. Output directory : `public`.
5. Exécuter `supabase/schema.sql` dans Supabase SQL Editor.
6. Ajouter toutes les variables Supabase et Cloudinary avant le test fonctionnel.
7. Déployer, créer le compte gérant Supabase avec l’adresse `ADMIN_EMAIL`, confirmer l’e-mail puis se connecter depuis `/admin`.

## Contrôle avant ouverture

- `/api/bootstrap` répond sans erreur ;
- inscription/confirmation cliente testée ;
- connexion gérante disponible sur `/admin` ;
- mot de passe oublié et retour vers le domaine final testés ;
- création et modification d’un produit test privé ;
- import d’au moins deux photos puis affichage catalogue/fiche produit vérifié sur mobile et desktop ;
- vérification que les photos produits sont présentes dans Cloudinary ;
- vérification que les justificatifs de commande restent privés dans Supabase Storage ;
- commande invitée et commande connectée testées ;
- suivi, QR, livraison, paiement, annulation et retour testés ;
- vérification du stock et des finances après chaque opération ;
- suppression des données de recette avant ouverture publique.

## Contrôles Cloudinary

Les images catalogue sont délivrées avec une largeur maximale et les transformations `f_auto` et `q_auto` au niveau CDN. Ces paramètres doivent rester des composants de transformation séparés dans l’URL de livraison (`.../c_limit,w_1800/f_auto/q_auto/...`). Les originaux restent disponibles dans Cloudinary et ne doivent pas être envoyés directement à chaque affichage de catalogue.

Ne pas ouvrir commercialement le projet tant que PostgreSQL, Auth, Storage privé Supabase, Cloudinary et les parcours de paiement retenus n’ont pas été testés sur l’environnement de production.
