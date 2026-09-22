# Activation des comptes clients Macourashop

État : intégration préparée ; activation et tests réels bloqués tant que le service d’authentification et l’envoi des e-mails ne sont pas configurés. L’accès Sites est toujours privé : les clientes externes ne pourront pas entrer avant une ouverture explicitement autorisée.

Utiliser un projet Supabase dédié à Macourashop. Ne pas utiliser les utilisateurs du CRM ou d’un autre projet.

## Configuration nécessaire

- Activer Email/Password et la confirmation d’adresse e-mail. Minimum 12 caractères ; configurer aussi ce minimum chez le prestataire.
- Configurer un SMTP de production avec un domaine expéditeur vérifié. Le service SMTP par défaut Supabase n’est pas adapté à une ouverture commerciale.
- Site URL : https://macourashop.faroucks.chatgpt.site
- Modèle de confirmation : lien `https://macourashop.faroucks.chatgpt.site/#compte?token_hash={{ .TokenHash }}&type=signup`
- Modèle de récupération : lien `https://macourashop.faroucks.chatgpt.site/#compte?token_hash={{ .TokenHash }}&type=recovery`
- Durée de session : une heure maximum dans cette première intégration, puis reconnexion. Pas de stockage du mot de passe dans le site.
- Variables serveur Sites : CUSTOMER_AUTH_URL (https://<projet>.supabase.co) et CUSTOMER_AUTH_PUBLIC_KEY (clé publique/anon, jamais service_role). Aucun secret SMTP dans le navigateur.

## Architecture

Le serveur vérifie les jetons auprès de Supabase avant d’accéder aux commandes. Cookie __Host-, Secure, HttpOnly, SameSite=Lax. Les écritures exigent l’origine Macourashop. Limitation des tentatives par IP et adresse. Les utilisateurs clients portent le préfixe customer: ; aucun rapprochement automatique par adresse e-mail avec les anciens comptes ou les commandes invitées. Les droits gérant restent fondés exclusivement sur les en-têtes d’identité de la plateforme.

## Validation indispensable avant activation

Créer deux comptes de test autorisés, recevoir les confirmations, vérifier les liens à usage unique et leur expiration, tester connexion/déconnexion, commandes et favoris distincts, réinitialisation du mot de passe et réception des e-mails, refus d’accès à l’administration. Tester le parcours sur téléphone. Aucune modification du contrôle d’accès public n’est incluse dans ce lot.

Références : https://supabase.com/docs/guides/auth/passwords et https://supabase.com/docs/guides/auth/auth-email-templates
