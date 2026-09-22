# Macourashop — version de travail privée

Boutique et administration reliées à D1 ; photos stockées dans R2. Le design éditorial existant est conservé. Aucun fournisseur de paiement en ligne n'est connecté.

## Parcours disponible

1. Ouvrir `/admin` avec le compte propriétaire autorisé.
2. Ajouter un produit, ses prix EUR (centimes côté serveur) et XOF (unités), ses variantes et sa photo.
3. Configurer les zones, tarifs et activation du paiement à la livraison.
4. Commander depuis la boutique et consulter la commande dans l'administration.
5. Passer la commande en préparation, expédiée puis livrée ; indiquer manuellement l'encaissement. L'annulation avant expédition restitue le stock une seule fois.
6. Après livraison, la cliente peut demander un retour depuis son compte ou avec son téléphone et son code reçu. Le gérant autorise, réceptionne puis confirme le remboursement ; le stock n'est restitué qu'à la réception.

L'article de démonstration est ajouté uniquement sur action du gérant. Les commandes de démonstration sont distinguées et exclues des encaissements du tableau de bord. Aucun produit ni tarif fictif n'est ajouté automatiquement en production.

## Sécurité et données

- Identité issue des en-têtes authentifiés de Sites ; autorisation administrateur par l'adresse du propriétaire dans `ADMIN_EMAIL`, configurée côté serveur. Le code ne fait pas confiance à un rôle envoyé par le navigateur.
- Site conservé en accès privé propriétaire. Cette version n'est pas un lancement public et utilise la connexion ChatGPT existante.
- D1 : produits, variantes, commandes, lignes, favoris et réglages. R2 : photos JPEG/PNG/WebP importées par le gérant.
- Chaque commande recalcule les prix et les frais côté serveur. Les écritures sont groupées en transaction ; contraintes et révisions empêchent stock négatif et écrasement concurrent.
- L'historique d'une commande conserve les montants au moment de la vente.
- Les détails d'une commande ne sont accessibles qu'à son compte ou au gérant.
- Le panier est un brouillon local non autoritatif, revalidé côté serveur à la commande.

## Vérification

`npm test` : tests des routes avec SQLite local et un adaptateur D1 transactionnel. Ils ne remplacent pas un test visuel ni une recette sur l'environnement hébergé.

`npm run build` : Worker ESM autonome, ressources visuelles incluses ; `npm run db:generate` : migrations Drizzle.

## Déploiement Vercel

La préparation Vercel conserve D1 et R2 comme services de données distants et utilise Supabase pour l’identité de la gérante et des clientes. Les variables et la procédure sont détaillées dans `VERCEL_DEPLOYMENT.md`. Un déploiement sans ces variables n’est pas fonctionnel.

## Avant lancement commercial

- Renseigner les vrais produits, photos, tarifs de livraison et liens sociaux.
- Prévoir un parcours de connexion/commande adapté aux clientes externes et valider sa compatibilité avec l'hébergement choisi.
- Connecter carte bancaire et Mobile Money avec comptes marchands et traitement vérifié des notifications de paiement.
- Compléter l'identité légale du vendeur, ses coordonnées, l'adresse de retour et la politique de confidentialité. Les conditions de commande et de retour sont déjà intégrées au site, avec 14 jours calendaires pour la France et 10 jours ouvrables pour la Côte d'Ivoire.
- Tester sur navigateurs et appareils réels avant d'ouvrir au public.

Limites de cette tranche : photo principale unique par produit ; tableau de bord calculé sur les 500 dernières commandes chargées, aucune comptabilité automatisée ni notification externe.
