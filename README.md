# Twang Perfect

Entraîneur de twang vocal dans le navigateur. L'outil mesure la brillance de la voix en temps réel, la situe entre deux repères pris sur votre propre voix, et propose un exercice de tenue avec score.

- **Site et mode d'emploi** : `index.html`
- **Outil** : `app.html`
- **Version en ligne** (une fois GitHub Pages activé) : `https://brunombo.github.io/twang_perfect/`

Aucune dépendance, aucune étape de construction, aucun serveur applicatif. Le son est analysé sur l'appareil et n'est jamais envoyé.

## Ce que fait l'outil

| Fonction | Principe | Statut |
|---|---|---|
| Brillance du twang | Part de la puissance entre 2 500 et 4 000 Hz, en dB, normalisée entre la voix neutre (0 %) et le twang de référence (100 %) | Mesure directe ; la bande est une hypothèse réglable |
| Exercice « tenir la cible » | Zone cible, durée, décompte ; score = temps dans la cible / durée de l'essai | Calcul exact |
| Retour masqué | Jauge et courbe cachées pendant l'essai, score à la fin | Option |
| Test du nez pincé | Écart de spectre entre deux prises (nez libre, nez pincé), comparé à la variation interne des prises | Comparaison mesurée, seuils empiriques |
| Indice de nasalité | Position du spectre entre la référence orale et une référence nasale donnée par l'utilisateur | Estimation |
| Suivi | Courbe des 15 dernières secondes, courbe de séance, historique des essais (localStorage), export JSON | — |

## Utilisation

### En ligne

Ouvrir l'adresse `https://` du site, puis « Ouvrir l'outil ». Le mode d'emploi complet est sur la page d'accueil.

### En local

Le micro exige un contexte sécurisé : `https://` ou `http://localhost`. Ouvrir le fichier directement (`file://`, ou `content://` sur Android) ne suffit pas sur tous les navigateurs.

```bash
git clone https://github.com/brunombo/twang_perfect.git
cd twang_perfect
python3 -m http.server 8000
```

Puis ouvrir `http://localhost:8000/` dans le navigateur de la même machine.

### Publier avec GitHub Pages

Dans le dépôt : **Settings → Pages → Build and deployment → Source : « Deploy from a branch »**, branche `main`, dossier `/ (root)`. Le fichier `.nojekyll` fait servir les fichiers tels quels.

## Tests

```bash
node --test
```

Node 20 ou plus récent. Les 31 tests couvrent les modules de calcul (`js/dsp.js`, `js/nasality.js`, `js/exercise.js`). Ils ne couvrent pas l'interface ni l'accès au micro.

## Organisation du code

```
index.html          site : présentation, mode d'emploi, limites, sources
app.html            l'outil
css/style.css       styles communs
js/dsp.js           traitement du signal (fonctions pures)
js/nasality.js      indice de nasalité et test du nez pincé (fonctions pures)
js/exercise.js      phases et score d'un essai (fonctions pures)
js/audio.js         micro et chaîne Web Audio
js/storage.js       persistance localStorage, export JSON
js/charts.js        tracés canvas
js/app.js           orchestration et affichage
tests/              tests unitaires (node:test)
docs/ARCHITECTURE.md
```

L'architecture, la chaîne de mesure et les décisions de conception sont décrites dans [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Changements par rapport au prototype `twang_trainer.html`

| Prototype | Twang Perfect |
|---|---|
| Message « accès micro refusé » quelle que soit la cause | Détection du contexte non sécurisé, message propre à chaque erreur |
| Seuil de voix fixe à −60 dB | Seuil mesuré sur le bruit ambiant, plus un critère de périodicité |
| Brillance en rapport linéaire, bornée à 100 % | Brillance en dB, affichée jusqu'à 120 % |
| Calibration perdue au rechargement, prise twang jamais contrôlée | Calibration conservée ; prise refusée si elle n'est pas plus brillante que la voix neutre ; alerte si les notes diffèrent |
| Indice nasal fondé sur un creux fixe vers 1 kHz, « confiance » calculée à partir de la même valeur | Indice relatif à une référence nasale personnelle, avec dispersion mesurée et état « hors modèle » ; test du nez pincé chiffré |
| Score = part du temps voisé dans la cible | Score = temps dans la cible / durée de l'essai (un silence ne rapporte rien) |
| Retour visuel permanent | Option de retour masqué pendant l'essai |
| Tampon fondé sur 60 images par seconde | Tampons horodatés, lissage indépendant de la cadence d'affichage |
| Un fichier, aucun test | Modules séparés, 31 tests unitaires |

L'indice nasal du prototype est retiré, pas seulement remplacé : son hypothèse (un creux spectral fixe vers 1 kHz signerait la nasalité) n'est soutenue par aucune source que j'aie pu lire.

## Limites

- L'outil mesure un résultat acoustique, pas le geste laryngé. Une voyelle plus ouverte ou un son poussé augmentent aussi la brillance.
- La brillance dépend de la voyelle, de la note, du micro et de sa distance. Les mesures ne valent que par rapport à la calibration du moment.
- La bande 2 500–4 000 Hz et les seuils du test du nez pincé sont empiriques et non validés.
- Un seul micro ne mesure pas la nasalance. L'indice de nasalité est une tendance.
- Sur certains téléphones, le navigateur garde une réduction de bruit ou un gain automatique. L'outil l'affiche quand le navigateur le déclare.
- Validation effectuée : tests unitaires, et parcours complet dans Chrome 153 avec une voix de synthèse. Non testé sur voix réelle, ni sur Firefox, Safari ou Samsung Internet.

## Sources

- Damien Silvert, Dalida Institute — « Qu'est-ce que le twang ? » (2025-07-04, modifié le 2025-09-04) — https://www.dalidainstitute.com/qu-est-ce-que-le-twang/ — vérifiée le 2026-11-12. Source secondaire ; donne la bande 2 500–4 000 Hz et le test du nez pincé sans citer d'étude.
- W. Styler, R. Scarborough — « Surveying the nasal peak: A1 and P0 in nasal and nasalized vowels » (2014 d'après l'adresse) — https://wstyler.ucsd.edu/files/stylerASA2014.pdf — vérifiée le 2026-11-12.
- MDN Web Docs — « MediaDevices: getUserMedia() method » — https://developer.mozilla.org/docs/Web/API/MediaDevices/getUserMedia — vérifiée le 2026-11-12.
- J. Sundberg, M. Thalén — « What is "Twang"? », Journal of Voice (2010) — https://pubmed.ncbi.nlm.nih.gov/20083379/ — extrait (titre confirmé par un résultat de recherche, contenu non lu).
- M. Y. Chen — « Acoustic correlates of English and French nasalized vowels » (1997) — https://pubmed.ncbi.nlm.nih.gov/9348695/ — extrait (titre confirmé par un résultat de recherche, contenu non lu).

## Licence

Aucune licence n'est encore déclarée : en l'état, le code est publié sans droit de réutilisation accordé. Le choix d'une licence revient à l'auteur du dépôt.
