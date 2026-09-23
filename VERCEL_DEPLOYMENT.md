# Mise en ligne sur Vercel

## Architecture retenue

Vercel sert la boutique et exécute l’API dans une fonction Node.js. Supabase fournit l’authentification, PostgreSQL et le stockage privé. Les secrets serveur ne sont jamais envoyés au navigateur.

## Prérequis obligatoires

1. Un projet Supabase avec confirmation des adresses e-mail activée.
2. Le schéma `supabase/schema.sql` exécuté dans le SQL Editor Supabase.
3. Une URL PostgreSQL **Transaction pooler** Supabase.
4. La clé serveur `service_role` Supabase, réservée à Vercel.
5. L’adresse e-mail du compte gérant, identique au compte Supabase utilisé pour administrer le site.
6. Le domaine Vercel définitif pour `SITE_ORIGIN`.

## Variables Vercel

Copier les noms de `.env.vercel.example` dans **Vercel → Project Settings → Environment Variables**. Les jetons et clés doivent être marqués secrets. Définir les variables pour Production et Preview si les aperçus doivent fonctionner.

`SITE_ORIGIN` doit correspondre exactement à l’URL affichée dans le navigateur. Après ajout d’un domaine personnalisé, remplacer l’ancienne valeur puis redéployer.

## Déploiement

1. Importer ce dépôt dans Vercel.
2. Framework preset : **Other**.
3. Build command : `npm run vercel-build`.
4. Output directory : `public`.
5. Exécuter `supabase/schema.sql` dans Supabase SQL Editor.
6. Ajouter toutes les variables avant le premier test fonctionnel.
7. Déployer, créer le compte gérant Supabase avec l’adresse `ADMIN_EMAIL`, confirmer l’e-mail puis se connecter depuis `/admin`.

## Contrôle avant ouverture

- `/api/bootstrap` répond sans erreur ;
- connexion gérante disponible sur `/admin` ;
- création et modification d’un produit test privé ;
- import puis affichage d’une photo ;
- commande complète, suivi, QR, livraison, paiement, annulation et retour ;
- vérification du stock et des finances après chaque opération ;
- suppression des données de recette avant ouverture publique.

Ne pas rendre le projet public tant que PostgreSQL et Storage Supabase ne sont pas configurés. Sans eux, les opérations commerciales ne fonctionneront pas.
