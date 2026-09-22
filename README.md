# Macourashop — version de travail privée

Boutique et administration reliées à D1 ; photos stockées dans R2. Le design éditorial existant est conservé. Aucun fournisseur de paiement en ligne n'est connecté.

## Déploiement Vercel

La préparation Vercel conserve D1 et R2 comme services de données distants et utilise Supabase pour l’identité de la gérante et des clientes. Les variables et la procédure sont détaillées dans `VERCEL_DEPLOYMENT.md`. Un déploiement sans ces variables n’est pas fonctionnel.

## Vérification

- `npm test` : contrôles métier, sécurité, stocks, commandes, retours et calculs.
- `npm run vercel-build` : génération de la sortie statique Vercel dans `public`.
- `npm run db:generate` : génération des migrations Drizzle.

## Avant lancement commercial

Renseigner les vrais produits, photos, tarifs, moyens de paiement réellement connectés, informations légales et adresse de retour. La boutique ne doit pas être rendue publique avant une recette complète avec les données réelles.