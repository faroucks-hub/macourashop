# MacouraShop — boutique et centre de gestion

Application e-commerce orientée France et Afrique avec boutique cliente et espace gérant séparé.

## Architecture actuelle

- **Vercel** : hébergement de l'application et des routes API.
- **Supabase PostgreSQL** : produits, variantes, commandes, lignes, favoris et réglages.
- **Supabase Auth** : authentification clientes et gérante.
- **Supabase Storage privé** : justificatifs et documents sensibles liés aux commandes.
- **Cloudinary** : photos produits publiques, servies via CDN avec redimensionnement et optimisation de format/qualité à la livraison.

Les secrets Supabase et Cloudinary restent exclusivement côté serveur. Ne jamais les placer dans le navigateur ou dans le dépôt.

## Parcours disponible

1. Ouvrir `/admin` avec le compte gérant autorisé.
2. Ajouter un produit, ses prix EUR/XOF, ses variantes, stocks et photos.
3. Configurer les zones, tarifs de livraison et moyens de paiement disponibles.
4. Commander depuis la boutique avec ou sans compte selon le parcours proposé.
5. Retrouver une commande depuis le compte ou avec téléphone + code confidentiel/QR.
6. Traiter la commande dans l'administration : validation, préparation, expédition, livraison et encaissement.
7. Gérer annulations et retours ; le stock est restitué uniquement au moment prévu par le workflow.
8. Enregistrer manuellement les ventes provenant de WhatsApp/réseaux sociaux afin qu'elles utilisent le même suivi que les commandes web.

## Règles de sécurité et de gestion

- L'autorisation gérant est contrôlée côté serveur ; le navigateur ne peut pas s'attribuer un rôle administrateur.
- Les prix et frais sont recalculés côté serveur au moment de la commande.
- Le panier côté navigateur n'est pas une source de vérité : stock, prix et disponibilité sont revalidés.
- L'historique d'une commande conserve les montants de la transaction même si le produit change ensuite.
- Les justificatifs de commande restent privés ; les photos catalogue sont séparées et publiques via Cloudinary.
- Une rupture de stock ne doit pas entraîner la suppression d'un produit. Le cycle cible est : en vente → rupture/réapprovisionnement → hors vente → archivé. La suppression définitive doit rester exceptionnelle et interdite lorsqu'un historique transactionnel doit être conservé.

## Images produits

Les originaux sont stockés dans Cloudinary. La livraison utilise des transformations CDN (`c_limit,w_1800/f_auto/q_auto`) afin d'éviter d'envoyer inutilement les fichiers originaux lourds aux clientes. Les miniatures responsives et tailles dédiées catalogue/fiche produit restent une optimisation à poursuivre.

## Vérification

- `npm test` : tests automatisés de logique métier et routes API.
- `npm run build` : vérification de construction du projet.

Les tests automatisés **ne remplacent pas** une recette visuelle et fonctionnelle sur l'environnement Vercel avec Chrome/Safari et des appareils mobiles réels.

## Éléments bloquants avant lancement commercial

Ces éléments nécessitent une décision, des informations ou des comptes externes du gérant et ne doivent pas être simulés dans le code :

1. Compléter l'identité légale du vendeur, adresse, e-mail, téléphone, immatriculation et adresse de retour.
2. Configurer les vrais produits, prix, stocks, zones et tarifs de livraison.
3. Connecter et tester les moyens de paiement réels retenus pour la France et la Côte d'Ivoire (carte, Mobile Money et/ou paiement à la livraison selon décision commerciale).
4. Vérifier les textes juridiques et politiques de retour applicables avant publication.
5. Effectuer une recette réelle mobile et desktop : inscription, connexion, mot de passe oublié, commande invitée, commande connectée, paiement, suivi, annulation, retour, administration et upload photo.

## Améliorations prioritaires restantes

- Cycle produit complet avec archivage et suppression contrôlée.
- Seuil de stock faible configurable et alertes gérant.
- Demande cliente « Prévenez-moi au réassort ».
- Notifications transactionnelles de commande.
- Partage social/SEO dynamique par produit.
- Séparation explicite de l'installation PWA Boutique et de l'installation PWA Gestion.
- Distinction toujours visible entre commandé, encaissé, à encaisser, remboursé et marge réalisée.

## Limites connues

- Aucun fournisseur de paiement en ligne ne doit être considéré comme opérationnel tant que son compte marchand, ses webhooks et ses tests réels ne sont pas validés.
- Les notifications externes ne sont pas encore un canal transactionnel garanti.
- Les informations légales ne doivent pas être inventées par l'application : elles sont à renseigner par le gérant.
