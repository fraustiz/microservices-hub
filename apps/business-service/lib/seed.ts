import type { Role } from "@hub/shared";

/**
 * Jeu de démonstration. `dept: "general"` : documents ouverts à tous les départements.
 * Visibilité attendue (voir docs/interconnexion.md) : alice (admin) 10, bruno (manager rh) 7, chloe (employee rh) 5,
 * david (employee tech) 5.
 */
export const SEED_DOCUMENTS: { title: string; content: string; dept: string; minRole: Role }[] = [
  {
    title: "Politique de congés payés",
    dept: "general",
    minRole: "employee",
    content:
      "Chaque salarié à temps plein acquiert 25 jours ouvrés de congés payés par an (2,08 jours par mois travaillé), auxquels s'ajoutent 10 jours de RTT. Les demandes se font dans l'outil RH au moins deux semaines à l'avance pour une absence de plus de trois jours, et sont validées par le manager direct. Les congés non pris au 31 mai peuvent être reportés jusqu'au 31 décembre de la même année, dans la limite de 5 jours. Pendant la fermeture estivale (deux premières semaines d'août), 10 jours de congés sont posés d'office.",
  },
  {
    title: "Charte de télétravail",
    dept: "general",
    minRole: "employee",
    content:
      "Le télétravail est ouvert à tous les salariés après leur période d'essai, dans la limite de 2 jours par semaine. Les jours sont fixés avec le manager et ne se reportent pas d'une semaine à l'autre. Le salarié reste joignable de 9 h 30 à 12 h et de 14 h à 17 h. L'entreprise fournit un ordinateur portable, un écran et une indemnité forfaitaire de 30 euros par mois. Le mardi est un jour de présence obligatoire pour toutes les équipes.",
  },
  {
    title: "Remboursement des notes de frais",
    dept: "general",
    minRole: "employee",
    content:
      "Les notes de frais sont saisies dans l'outil de gestion des dépenses dans les 30 jours suivant la dépense, avec le justificatif scanné. Plafonds : repas 25 euros, nuit d'hôtel 120 euros à Paris et 90 euros en région. Les trajets en train se font en seconde classe, sauf pour un trajet de plus de 3 heures. Le manager valide la note sous 7 jours et le remboursement est versé avec la paie du mois suivant.",
  },
  {
    title: "Règles de sécurité informatique",
    dept: "general",
    minRole: "employee",
    content:
      "Les mots de passe comptent au moins 12 caractères et sont rangés dans le gestionnaire de mots de passe de l'entreprise. L'authentification à deux facteurs est obligatoire pour la messagerie et le VPN. Ne jamais transmettre un mot de passe, même au support informatique. Tout courriel suspect est signalé avec le bouton « Signaler un hameçonnage » ou à securite@hub.local. Un poste perdu ou volé est déclaré au support dans l'heure.",
  },
  {
    title: "Procédure de recrutement",
    dept: "rh",
    minRole: "employee",
    content:
      "Tout recrutement part d'une demande validée par le manager et par la direction des ressources humaines. Le service RH publie l'offre sous 5 jours ouvrés. Le processus comprend un entretien RH, un entretien métier avec le manager, puis un entretien final avec le directeur du département. Chaque candidat reçoit une réponse au plus tard 10 jours après son dernier entretien. Les grilles d'évaluation sont conservées 2 ans.",
  },
  {
    title: "Grille salariale 2026",
    dept: "rh",
    minRole: "manager",
    content:
      "Confidentiel, réservé aux managers RH. Fourchettes annuelles brutes : employé débutant de 32 000 à 38 000 euros ; employé confirmé de 38 000 à 48 000 euros ; manager de 52 000 à 68 000 euros ; directeur de 75 000 à 95 000 euros. L'enveloppe d'augmentation 2026 représente 3,2 % de la masse salariale, dont 1 % d'augmentation générale.",
  },
  {
    title: "Guide d'astreinte",
    dept: "tech",
    minRole: "employee",
    content:
      "L'astreinte technique tourne chaque semaine entre les membres de l'équipe tech, du lundi 9 h au lundi suivant 9 h. La personne d'astreinte intervient sous 30 minutes sur une alerte critique. Chaque semaine d'astreinte donne droit à une prime de 150 euros, et les interventions de nuit sont récupérées. Le planning et les procédures de redémarrage sont dans le wiki technique.",
  },
  {
    title: "Budget 2026 par département",
    dept: "finance",
    minRole: "manager",
    content:
      "Budget de fonctionnement 2026 voté en conseil : direction 1,2 million d'euros ; ressources humaines 0,8 million ; tech 3,4 millions, dont 1,1 million pour l'infrastructure cloud ; finance 0,6 million. Toute dépense imprévue de plus de 10 000 euros nécessite l'accord du directeur financier. Un point d'étape budgétaire a lieu chaque trimestre.",
  },
  {
    title: "Plan stratégique 2026-2028",
    dept: "direction",
    minRole: "manager",
    content:
      "Trois priorités : ouvrir deux agences en région d'ici 2027, faire passer la part du chiffre d'affaires récurrent de 40 % à 60 %, et déployer un assistant IA interne pour tous les salariés. Les indicateurs de suivi sont présentés chaque mois en comité de direction.",
  },
  {
    title: "Projet de réorganisation",
    dept: "direction",
    minRole: "admin",
    content:
      "Strictement confidentiel. Projet de regroupement des équipes finance et ressources humaines en une direction administrative unique au 1er juillet 2027. Aucune communication avant l'information-consultation du comité social et économique, prévue en mars 2027.",
  },
];

/** Règles d'accès inter-départements (gérées ensuite par un admin via /api/rules). */
export const SEED_RULES: { dept: string; minRole: Role; description: string }[] = [
  {
    dept: "finance",
    minRole: "manager",
    description: "Les managers de tous les départements consultent les documents finance (suivi budgétaire).",
  },
];
