/**
 * Configuration for all reading plans
 *
 * Plan types:
 * - sequential: Read books in order, X chapters per day
 * - distributed: Distribute all chapters evenly over X days
 * - parallel: Read multiple book ranges in parallel (e.g., GT + NT)
 * - custom: Manually defined daily readings
 *
 * bookRanges are defined in lib.js
 */

// All plan definitions
export const planDefinitions = [
  // ============================================
  // KORTE PLANER (under 35 dager)
  // ============================================

  {
    id: "paske",
    name: "Påskeplan",
    description: "Les lidelseshistorien fra alle fire evangelier i påskeuka.",
    category: "kort",
    type: "custom",
    readings: [
      // Matteus' beretning
      { chapters: [{ bookId: 40, chapter: 26 }] },
      { chapters: [{ bookId: 40, chapter: 27 }] },
      { chapters: [{ bookId: 40, chapter: 28 }] },
      // Markus' beretning
      { chapters: [{ bookId: 41, chapter: 14 }] },
      { chapters: [{ bookId: 41, chapter: 15 }] },
      { chapters: [{ bookId: 41, chapter: 16 }] },
      // Lukas' beretning
      { chapters: [{ bookId: 42, chapter: 22 }] },
      { chapters: [{ bookId: 42, chapter: 23 }] },
      { chapters: [{ bookId: 42, chapter: 24 }] },
      // Johannes' beretning (mer detaljert)
      { chapters: [{ bookId: 43, chapter: 13 }] },
      { chapters: [{ bookId: 43, chapter: 14 }, { bookId: 43, chapter: 15 }] },
      { chapters: [{ bookId: 43, chapter: 16 }, { bookId: 43, chapter: 17 }] },
      { chapters: [{ bookId: 43, chapter: 18 }, { bookId: 43, chapter: 19 }] },
      { chapters: [{ bookId: 43, chapter: 20 }, { bookId: 43, chapter: 21 }] },
    ]
  },

  {
    id: "romerbrevet",
    name: "Romerbrevet",
    description: "Les Paulus' mesterverk på 16 dager - ett kapittel per dag.",
    category: "kort",
    type: "sequential",
    bookRange: "romerbrevet",
    chaptersPerDay: 1
  },

  {
    id: "bergprekenen",
    name: "Bergprekenen",
    description: "Jesu mest kjente tale fra Matteus 5-7. Les grundig over 3 uker.",
    category: "kort",
    type: "repeat",
    chapters: [
      { bookId: 40, chapter: 5 },
      { bookId: 40, chapter: 6 },
      { bookId: 40, chapter: 7 }
    ],
    daysPerChapter: 7
  },

  {
    id: "advent",
    name: "Adventsplan",
    description: "Les juleevangeliet og profetier om Messias gjennom adventstiden.",
    category: "kort",
    type: "custom",
    readings: [
      // Uke 1: Profetier om Messias
      { chapters: [{ bookId: 23, chapter: 7 }] },   // Jesaja 7
      { chapters: [{ bookId: 23, chapter: 9 }] },   // Jesaja 9
      { chapters: [{ bookId: 23, chapter: 11 }] },  // Jesaja 11
      { chapters: [{ bookId: 33, chapter: 5 }] },   // Mika 5
      { chapters: [{ bookId: 23, chapter: 40 }] },  // Jesaja 40
      { chapters: [{ bookId: 39, chapter: 3 }] },   // Malaki 3
      { chapters: [{ bookId: 23, chapter: 53 }] },  // Jesaja 53
      // Uke 2: Forberedelsen
      { chapters: [{ bookId: 42, chapter: 1 }] },   // Lukas 1:1-38
      { chapters: [{ bookId: 42, chapter: 1 }] },   // Lukas 1:39-80
      { chapters: [{ bookId: 40, chapter: 1 }] },   // Matteus 1
      { chapters: [{ bookId: 43, chapter: 1 }] },   // Johannes 1:1-18
      { chapters: [{ bookId: 48, chapter: 4 }] },   // Galaterne 4
      { chapters: [{ bookId: 50, chapter: 2 }] },   // Filipperne 2
      { chapters: [{ bookId: 58, chapter: 1 }] },   // Hebreerne 1
      // Uke 3: Jesu fødsel
      { chapters: [{ bookId: 42, chapter: 2 }] },   // Lukas 2:1-20
      { chapters: [{ bookId: 42, chapter: 2 }] },   // Lukas 2 (meditasjon)
      { chapters: [{ bookId: 40, chapter: 2 }] },   // Matteus 2:1-12
      { chapters: [{ bookId: 40, chapter: 2 }] },   // Matteus 2:13-23
      { chapters: [{ bookId: 42, chapter: 2 }] },   // Lukas 2:21-40
      { chapters: [{ bookId: 42, chapter: 2 }] },   // Lukas 2:41-52
      { chapters: [{ bookId: 19, chapter: 2 }] },   // Salme 2
      // Julaften og juledagene
      { chapters: [{ bookId: 19, chapter: 98 }] },  // Salme 98
      { chapters: [{ bookId: 23, chapter: 52 }] },  // Jesaja 52
      { chapters: [{ bookId: 62, chapter: 4 }] },   // 1. Johannes 4
    ]
  },

  {
    id: "johannes-skrifter",
    name: "Johannes' skrifter",
    description: "Les Johannesevangeliet, Johannes' brev og Åpenbaringen.",
    category: "kort",
    type: "sequential",
    books: [43, 62, 63, 64, 66],  // Joh, 1-3 Joh, Åp
    chaptersPerDay: 2
  },

  {
    id: "apostlenes-gjerninger",
    name: "Apostlenes gjerninger",
    description: "Følg den første kirkens historie på 28 dager.",
    category: "kort",
    type: "sequential",
    bookRange: "apostelgjerninger",
    chaptersPerDay: 1
  },

  {
    id: "salmene-30",
    name: "Salmene på én måned",
    description: "Les 5 salmer hver dag og fullfør Salmenes bok på 30 dager.",
    category: "kort",
    type: "distributed",
    bookRange: "salmene",
    days: 30
  },

  {
    id: "evangeliene-30",
    name: "Evangeliene på én måned",
    description: "Les alle fire evangelier på 30 dager med ~3 kapitler per dag.",
    category: "kort",
    type: "distributed",
    bookRange: "evangelier",
    days: 30
  },

  {
    id: "paulus-brev-30",
    name: "Paulus' brev på én måned",
    description: "Les alle Paulus' brev på 30 dager med ~3 kapitler per dag.",
    category: "kort",
    type: "distributed",
    bookRange: "paulusBrev",
    days: 30
  },

  {
    id: "ordsprakene-31",
    name: "Ordspråkene på én måned",
    description: "Les ett kapittel fra Ordspråkene hver dag. Perfekt å gjenta hver måned!",
    category: "kort",
    type: "sequential",
    bookRange: "ordsprakene",
    chaptersPerDay: 1
  },

  {
    id: "visdomslitteratur",
    name: "Visdomslitteraturen",
    description: "Les Job, Ordspråkene, Forkynneren og Høysangen på én måned.",
    category: "kort",
    type: "sequential",
    books: [18, 20, 21, 22],  // Job, Ordsp, Fork, Høys
    chaptersPerDay: 3
  },

  {
    id: "allmenne-brev",
    name: "Hebreerbrevet og de allmenne brevene",
    description: "Les Hebreerbrevet, Jakob, Peters brev, Johannes' brev og Judas.",
    category: "kort",
    type: "sequential",
    bookRange: "allmenneBrev",
    chaptersPerDay: 1
  },

  {
    id: "sma-profetene",
    name: "De små profetene",
    description: "Les de tolv små profetene fra Hosea til Malaki.",
    category: "kort",
    type: "sequential",
    bookRange: "smaProfeter",
    chaptersPerDay: 2
  },

  {
    id: "apenbaringen",
    name: "Åpenbaringen",
    description: "Les Johannes' åpenbaring på 22 dager - ett kapittel per dag.",
    category: "kort",
    type: "sequential",
    bookRange: "apenbaringen",
    chaptersPerDay: 1
  },

  {
    id: "korinterbrevene",
    name: "Korinterbrevene",
    description: "Les Paulus' to brev til menigheten i Korint.",
    category: "kort",
    type: "sequential",
    books: [46, 47],  // 1 Kor (16) + 2 Kor (13) = 29 kapitler
    chaptersPerDay: 1
  },

  {
    id: "peters-brev",
    name: "Peters brev",
    description: "Les Peters to brev på 8 dager.",
    category: "kort",
    type: "sequential",
    books: [60, 61],  // 1 Pet (5) + 2 Pet (3) = 8 kapitler
    chaptersPerDay: 1
  },

  {
    id: "nt-30",
    name: "Det nye testamentet på 30 dager",
    description: "Les hele NT på én måned - intensiv lesing med ~9 kapitler per dag.",
    category: "kort",
    type: "distributed",
    bookRange: "nt",
    days: 30
  },

  // ============================================
  // MIDDELS PLANER (35-100 dager)
  // ============================================

  {
    id: "job",
    name: "Jobs bok",
    description: "Les Jobs bok om lidelse og tro på 42 dager.",
    category: "middels",
    type: "sequential",
    bookRange: "job",
    chaptersPerDay: 1
  },

  {
    id: "jesaja",
    name: "Jesaja",
    description: "Les profeten Jesaja på 66 dager - ett kapittel per dag.",
    category: "middels",
    type: "sequential",
    books: [23],
    chaptersPerDay: 1
  },

  {
    id: "fasteplan",
    name: "Fasteplan (40 dager)",
    description: "En 40-dagers leseplan for fastetiden - fra ørkenvandring til oppstandelse.",
    category: "middels",
    type: "custom",
    readings: [
      // Uke 1: Ørkenen og fristelse
      { chapters: [{ bookId: 40, chapter: 4 }] },   // Jesus fristes i ørkenen
      { chapters: [{ bookId: 2, chapter: 16 }] },   // Manna i ørkenen
      { chapters: [{ bookId: 2, chapter: 17 }] },   // Vann fra klippen
      { chapters: [{ bookId: 4, chapter: 21 }] },   // Kobberslangen
      { chapters: [{ bookId: 5, chapter: 8 }] },    // Mennesket lever ikke av brød alene
      { chapters: [{ bookId: 19, chapter: 91 }] },  // Under Den Høyestes skjul
      { chapters: [{ bookId: 19, chapter: 63 }] },  // Min sjel tørster
      // Uke 2: Omvendelse og tilgivelse
      { chapters: [{ bookId: 19, chapter: 51 }] },  // Davids botssalme
      { chapters: [{ bookId: 23, chapter: 55 }] },  // Søk Herren
      { chapters: [{ bookId: 29, chapter: 2 }] },   // Joel - vend om
      { chapters: [{ bookId: 32, chapter: 3 }] },   // Jona - Ninive omvender seg
      { chapters: [{ bookId: 42, chapter: 15 }] },  // Den bortkomne sønn
      { chapters: [{ bookId: 19, chapter: 32 }] },  // Salig er den som får sin synd tilgitt
      { chapters: [{ bookId: 19, chapter: 103 }] }, // Pris Herren, min sjel
      // Uke 3: Tjeneste og ydmykhet
      { chapters: [{ bookId: 23, chapter: 58 }] },  // Sann faste
      { chapters: [{ bookId: 33, chapter: 6 }] },   // Hva krever Herren?
      { chapters: [{ bookId: 40, chapter: 6 }] },   // Faste, bønn, almisser
      { chapters: [{ bookId: 40, chapter: 25 }] },  // De minste
      { chapters: [{ bookId: 50, chapter: 2 }] },   // Kristi sinnelag
      { chapters: [{ bookId: 43, chapter: 13 }] },  // Jesus vasker disiplenes føtter
      { chapters: [{ bookId: 41, chapter: 10 }] },  // Menneskesønnen kom for å tjene
      // Uke 4: Lidelse og offer
      { chapters: [{ bookId: 23, chapter: 52 }] },  // Herrens tjener
      { chapters: [{ bookId: 23, chapter: 53 }] },  // Han ble såret for våre overtredelser
      { chapters: [{ bookId: 19, chapter: 22 }] },  // Min Gud, hvorfor har du forlatt meg?
      { chapters: [{ bookId: 58, chapter: 9 }] },   // Kristus som yppersteprest
      { chapters: [{ bookId: 58, chapter: 10 }] },  // Én gang for alle
      { chapters: [{ bookId: 45, chapter: 5 }] },   // Rettferdiggjort ved tro
      { chapters: [{ bookId: 45, chapter: 6 }] },   // Døde med Kristus
      // Uke 5: Korset
      { chapters: [{ bookId: 40, chapter: 26 }] },  // Getsemane
      { chapters: [{ bookId: 40, chapter: 27 }] },  // Korsfestelsen
      { chapters: [{ bookId: 41, chapter: 15 }] },  // Korsfestelsen (Markus)
      { chapters: [{ bookId: 42, chapter: 23 }] },  // Korsfestelsen (Lukas)
      { chapters: [{ bookId: 43, chapter: 18 }] },  // Arrestasjon og forhør
      { chapters: [{ bookId: 43, chapter: 19 }] },  // Korsfestelsen (Johannes)
      { chapters: [{ bookId: 19, chapter: 88 }] },  // Fra dypet roper jeg
      // Uke 6: Seier og oppstandelse
      { chapters: [{ bookId: 28, chapter: 6 }] },   // Han gjør oss levende
      { chapters: [{ bookId: 26, chapter: 37 }] },  // De tørre ben
      { chapters: [{ bookId: 40, chapter: 28 }] },  // Oppstandelsen (Matteus)
      { chapters: [{ bookId: 43, chapter: 20 }] },  // Oppstandelsen (Johannes)
      { chapters: [{ bookId: 46, chapter: 15 }] },  // Oppstandelseskapitlet
    ]
  },

  {
    id: "pinseplan",
    name: "Pinseplan (40 dager)",
    description: "Fra Kristi himmelfart til pinse - fokus på Ånden og menigheten.",
    category: "middels",
    type: "custom",
    readings: [
      // Uke 1: Løftet om Ånden
      { chapters: [{ bookId: 43, chapter: 14 }] },  // Jeg vil sende dere en annen talsmann
      { chapters: [{ bookId: 43, chapter: 15 }] },  // Bli i meg
      { chapters: [{ bookId: 43, chapter: 16 }] },  // Ånden skal veilede dere
      { chapters: [{ bookId: 42, chapter: 24 }] },  // Himmelfarten
      { chapters: [{ bookId: 44, chapter: 1 }] },   // Løftet om Ånden
      { chapters: [{ bookId: 29, chapter: 2 }] },   // Jeg vil utøse min Ånd (Joel)
      { chapters: [{ bookId: 26, chapter: 36 }] },  // Nytt hjerte, ny ånd
      // Uke 2: Åndens komme
      { chapters: [{ bookId: 44, chapter: 2 }] },   // Pinsedag
      { chapters: [{ bookId: 44, chapter: 4 }] },   // Fylt av Ånden
      { chapters: [{ bookId: 44, chapter: 8 }] },   // Ånden i Samaria
      { chapters: [{ bookId: 44, chapter: 10 }] },  // Kornelius mottar Ånden
      { chapters: [{ bookId: 44, chapter: 19 }] },  // Ånden i Efesos
      { chapters: [{ bookId: 45, chapter: 8 }] },   // Åndens lov
      { chapters: [{ bookId: 48, chapter: 5 }] },   // Åndens frukt
      // Uke 3: Åndens gaver
      { chapters: [{ bookId: 46, chapter: 12 }] },  // Nådegaver
      { chapters: [{ bookId: 46, chapter: 13 }] },  // Kjærlighetens vei
      { chapters: [{ bookId: 46, chapter: 14 }] },  // Tungetale og profeti
      { chapters: [{ bookId: 45, chapter: 12 }] },  // Bruk gavene
      { chapters: [{ bookId: 49, chapter: 4 }] },   // Utrustning til tjeneste
      { chapters: [{ bookId: 60, chapter: 4 }] },   // Forvaltere av Guds nåde
      { chapters: [{ bookId: 58, chapter: 2 }] },   // Tegn og under
      // Uke 4: Liv i Ånden
      { chapters: [{ bookId: 45, chapter: 5 }] },   // Fred med Gud
      { chapters: [{ bookId: 48, chapter: 3 }] },   // Begynte i Ånden
      { chapters: [{ bookId: 49, chapter: 1 }] },   // Beseglet med Ånden
      { chapters: [{ bookId: 49, chapter: 3 }] },   // Styrket ved Ånden
      { chapters: [{ bookId: 49, chapter: 5 }] },   // Bli fylt av Ånden
      { chapters: [{ bookId: 49, chapter: 6 }] },   // Åndens sverd
      { chapters: [{ bookId: 52, chapter: 5 }] },   // Slukk ikke Ånden
      // Uke 5: Ånden og bønn
      { chapters: [{ bookId: 45, chapter: 8 }] },   // Ånden ber for oss
      { chapters: [{ bookId: 65, chapter: 1 }] },   // Be i Den Hellige Ånd (Judas)
      { chapters: [{ bookId: 19, chapter: 139 }] }, // Ransak meg, Gud
      { chapters: [{ bookId: 19, chapter: 51 }] },  // Ta ikke din Hellige Ånd fra meg
      { chapters: [{ bookId: 23, chapter: 11 }] },  // Herrens Ånd skal hvile på ham
      { chapters: [{ bookId: 23, chapter: 61 }] },  // Herrens Ånd er over meg
      { chapters: [{ bookId: 42, chapter: 4 }] },   // Jesus fylt av Ånden
      // Siste dager: Ånden og fremtiden
      { chapters: [{ bookId: 66, chapter: 2 }] },   // Hør hva Ånden sier (Efesos, Smyrna, Pergamon, Tyatira)
      { chapters: [{ bookId: 66, chapter: 3 }] },   // Hør hva Ånden sier (Sardes, Filadelfia, Laodikea)
      { chapters: [{ bookId: 47, chapter: 3 }] },   // Åndens tjeneste
      { chapters: [{ bookId: 44, chapter: 2 }] },   // Pinsedag - Ånden utøses
      { chapters: [{ bookId: 66, chapter: 22 }] },  // Ånden og bruden sier: Kom!
    ]
  },

  {
    id: "mosebokene",
    name: "Mosebøkene",
    description: "Les de fem Mosebøkene (Toraen) på ca. 2 måneder.",
    category: "middels",
    type: "sequential",
    bookRange: "mosebokene",
    chaptersPerDay: 3
  },

  {
    id: "nt-9-uker",
    name: "Det nye testamentet på 9 uker",
    description: "Les hele NT på 65 dager med ca. 4 kapitler per dag.",
    category: "middels",
    type: "distributed",
    bookRange: "nt",
    days: 65
  },

  {
    id: "historiske-boker",
    name: "De historiske bøkene",
    description: "Les Israels historie fra Josva til Ester.",
    category: "middels",
    type: "sequential",
    bookRange: "historiske",
    chaptersPerDay: 3
  },

  {
    id: "profetene",
    name: "Profetene",
    description: "Les alle profetbøkene fra Jesaja til Malaki.",
    category: "middels",
    type: "sequential",
    bookRange: "profeter",
    chaptersPerDay: 3
  },

  {
    id: "paulus-brev",
    name: "Paulus' brev",
    description: "Les alle Paulus' 13 brev på 87 dager.",
    category: "middels",
    type: "sequential",
    bookRange: "paulusBrev",
    chaptersPerDay: 1
  },

  {
    id: "evangeliene",
    name: "De fire evangeliene",
    description: "Les alle fire evangelier og bli kjent med Jesu liv og lære.",
    category: "middels",
    type: "sequential",
    bookRange: "evangelier",
    chaptersPerDay: 1
  },

  {
    id: "davidssalmene",
    name: "Davidssalmene",
    description: "Les salmene som tradisjonelt tilskrives kong David.",
    category: "middels",
    type: "custom",
    readings: [
      // Davidssalmer: 3-9, 11-32, 34-41, 51-65, 68-70, 86, 101, 103, 108-110, 122, 124, 131, 133, 138-145
      { chapters: [{ bookId: 19, chapter: 3 }] },
      { chapters: [{ bookId: 19, chapter: 4 }] },
      { chapters: [{ bookId: 19, chapter: 5 }] },
      { chapters: [{ bookId: 19, chapter: 6 }] },
      { chapters: [{ bookId: 19, chapter: 7 }] },
      { chapters: [{ bookId: 19, chapter: 8 }] },
      { chapters: [{ bookId: 19, chapter: 9 }] },
      { chapters: [{ bookId: 19, chapter: 11 }] },
      { chapters: [{ bookId: 19, chapter: 12 }] },
      { chapters: [{ bookId: 19, chapter: 13 }] },
      { chapters: [{ bookId: 19, chapter: 14 }] },
      { chapters: [{ bookId: 19, chapter: 15 }] },
      { chapters: [{ bookId: 19, chapter: 16 }] },
      { chapters: [{ bookId: 19, chapter: 17 }] },
      { chapters: [{ bookId: 19, chapter: 18 }] },
      { chapters: [{ bookId: 19, chapter: 19 }] },
      { chapters: [{ bookId: 19, chapter: 20 }] },
      { chapters: [{ bookId: 19, chapter: 21 }] },
      { chapters: [{ bookId: 19, chapter: 22 }] },
      { chapters: [{ bookId: 19, chapter: 23 }] },
      { chapters: [{ bookId: 19, chapter: 24 }] },
      { chapters: [{ bookId: 19, chapter: 25 }] },
      { chapters: [{ bookId: 19, chapter: 26 }] },
      { chapters: [{ bookId: 19, chapter: 27 }] },
      { chapters: [{ bookId: 19, chapter: 28 }] },
      { chapters: [{ bookId: 19, chapter: 29 }] },
      { chapters: [{ bookId: 19, chapter: 30 }] },
      { chapters: [{ bookId: 19, chapter: 31 }] },
      { chapters: [{ bookId: 19, chapter: 32 }] },
      { chapters: [{ bookId: 19, chapter: 34 }] },
      { chapters: [{ bookId: 19, chapter: 35 }] },
      { chapters: [{ bookId: 19, chapter: 36 }] },
      { chapters: [{ bookId: 19, chapter: 37 }] },
      { chapters: [{ bookId: 19, chapter: 38 }] },
      { chapters: [{ bookId: 19, chapter: 39 }] },
      { chapters: [{ bookId: 19, chapter: 40 }] },
      { chapters: [{ bookId: 19, chapter: 41 }] },
      { chapters: [{ bookId: 19, chapter: 51 }] },
      { chapters: [{ bookId: 19, chapter: 52 }] },
      { chapters: [{ bookId: 19, chapter: 53 }] },
      { chapters: [{ bookId: 19, chapter: 54 }] },
      { chapters: [{ bookId: 19, chapter: 55 }] },
      { chapters: [{ bookId: 19, chapter: 56 }] },
      { chapters: [{ bookId: 19, chapter: 57 }] },
      { chapters: [{ bookId: 19, chapter: 58 }] },
      { chapters: [{ bookId: 19, chapter: 59 }] },
      { chapters: [{ bookId: 19, chapter: 60 }] },
      { chapters: [{ bookId: 19, chapter: 61 }] },
      { chapters: [{ bookId: 19, chapter: 62 }] },
      { chapters: [{ bookId: 19, chapter: 63 }] },
      { chapters: [{ bookId: 19, chapter: 64 }] },
      { chapters: [{ bookId: 19, chapter: 65 }] },
      { chapters: [{ bookId: 19, chapter: 68 }] },
      { chapters: [{ bookId: 19, chapter: 69 }] },
      { chapters: [{ bookId: 19, chapter: 70 }] },
      { chapters: [{ bookId: 19, chapter: 86 }] },
      { chapters: [{ bookId: 19, chapter: 101 }] },
      { chapters: [{ bookId: 19, chapter: 103 }] },
      { chapters: [{ bookId: 19, chapter: 108 }] },
      { chapters: [{ bookId: 19, chapter: 109 }] },
      { chapters: [{ bookId: 19, chapter: 110 }] },
      { chapters: [{ bookId: 19, chapter: 122 }] },
      { chapters: [{ bookId: 19, chapter: 124 }] },
      { chapters: [{ bookId: 19, chapter: 131 }] },
      { chapters: [{ bookId: 19, chapter: 133 }] },
      { chapters: [{ bookId: 19, chapter: 138 }] },
      { chapters: [{ bookId: 19, chapter: 139 }] },
      { chapters: [{ bookId: 19, chapter: 140 }] },
      { chapters: [{ bookId: 19, chapter: 141 }] },
      { chapters: [{ bookId: 19, chapter: 142 }] },
      { chapters: [{ bookId: 19, chapter: 143 }] },
      { chapters: [{ bookId: 19, chapter: 144 }] },
      { chapters: [{ bookId: 19, chapter: 145 }] },
    ]
  },

  // ============================================
  // TEMATISKE PLANER
  // ============================================

  {
    id: "messianske-profetier",
    name: "Messianske profetier",
    description: "Les GT-profetier om Messias og deres oppfyllelse i NT.",
    category: "tematisk",
    type: "custom",
    readings: [
      // Løftet og slekten
      { chapters: [{ bookId: 1, chapter: 3 }] },    // Kvinnens ætt
      { chapters: [{ bookId: 1, chapter: 12 }] },   // Abrahams velsignelse
      { chapters: [{ bookId: 1, chapter: 49 }] },   // Juda-løven
      { chapters: [{ bookId: 4, chapter: 24 }] },   // Stjernen fra Jakob
      { chapters: [{ bookId: 5, chapter: 18 }] },   // En profet som Moses
      { chapters: [{ bookId: 10, chapter: 7 }] },   // Davids evige trone
      // Fødsel og barndom
      { chapters: [{ bookId: 23, chapter: 7 }] },   // Jomfrutegnet
      { chapters: [{ bookId: 23, chapter: 9 }] },   // Et barn er oss født
      { chapters: [{ bookId: 33, chapter: 5 }] },   // Betlehem
      { chapters: [{ bookId: 28, chapter: 11 }] },  // Ut av Egypt kalte jeg min sønn
      { chapters: [{ bookId: 40, chapter: 1 }] },   // NT: Oppfyllelse - Jesu fødsel
      { chapters: [{ bookId: 40, chapter: 2 }] },   // NT: Vismennene, flukten
      // Tjenesten
      { chapters: [{ bookId: 23, chapter: 11 }] },  // Isais rotskudd
      { chapters: [{ bookId: 23, chapter: 42 }] },  // Herrens tjener
      { chapters: [{ bookId: 23, chapter: 61 }] },  // Herrens Ånd over meg
      { chapters: [{ bookId: 39, chapter: 3 }] },   // Budbæreren
      { chapters: [{ bookId: 38, chapter: 9 }] },   // Kongen på eselet
      { chapters: [{ bookId: 42, chapter: 4 }] },   // NT: Jesus i Nasaret
      // Lidelsen
      { chapters: [{ bookId: 19, chapter: 22 }] },  // Min Gud, hvorfor?
      { chapters: [{ bookId: 19, chapter: 69 }] },  // De ga meg eddik
      { chapters: [{ bookId: 23, chapter: 50 }] },  // Jeg ga min rygg til dem
      { chapters: [{ bookId: 23, chapter: 52 }] },  // Herrens tjener
      { chapters: [{ bookId: 23, chapter: 53 }] },  // Såret for våre overtredelser
      { chapters: [{ bookId: 38, chapter: 11 }] },  // 30 sølvpenger
      { chapters: [{ bookId: 38, chapter: 12 }] },  // De skal se på ham de har gjennomboret
      // Korsfestelse og oppstandelse
      { chapters: [{ bookId: 19, chapter: 16 }] },  // Du overgir ikke min sjel
      { chapters: [{ bookId: 19, chapter: 118 }] }, // Steinen bygningsmennene vraket
      { chapters: [{ bookId: 32, chapter: 1 }] },   // Jona - tegnet
      { chapters: [{ bookId: 32, chapter: 2 }] },   // Jona - oppstandelsen
      { chapters: [{ bookId: 43, chapter: 19 }] },  // NT: Korsfestelsen
      { chapters: [{ bookId: 43, chapter: 20 }] },  // NT: Oppstandelsen
      // Himmelfart og gjenkomst
      { chapters: [{ bookId: 19, chapter: 110 }] }, // Sett deg ved min høyre hånd
      { chapters: [{ bookId: 27, chapter: 7 }] },   // Menneskesønnen
      { chapters: [{ bookId: 38, chapter: 14 }] },  // Herrens dag
      { chapters: [{ bookId: 44, chapter: 1 }] },   // NT: Himmelfarten
    ]
  },

  {
    id: "bonner-i-bibelen",
    name: "Bønner i Bibelen",
    description: "Les de store bønnene i Bibelen - fra Abraham til Paulus.",
    category: "tematisk",
    type: "custom",
    readings: [
      // GT-bønner
      { chapters: [{ bookId: 1, chapter: 18 }] },   // Abraham ber for Sodoma
      { chapters: [{ bookId: 1, chapter: 32 }] },   // Jakob kjemper med Gud
      { chapters: [{ bookId: 2, chapter: 32 }] },   // Moses' forbønn
      { chapters: [{ bookId: 2, chapter: 33 }] },   // Moses: Vis meg din herlighet
      { chapters: [{ bookId: 4, chapter: 6 }] },    // Den aronittiske velsignelsen
      { chapters: [{ bookId: 5, chapter: 9 }] },    // Moses ber for folket
      { chapters: [{ bookId: 6, chapter: 7 }] },    // Josvas bønn
      { chapters: [{ bookId: 9, chapter: 1 }] },    // Hannas bønn
      { chapters: [{ bookId: 9, chapter: 2 }] },    // Hannas lovsang
      { chapters: [{ bookId: 11, chapter: 8 }] },   // Salomos tempelinnvielsesbønn
      { chapters: [{ bookId: 11, chapter: 19 }] },  // Elias bønn på Karmel
      { chapters: [{ bookId: 14, chapter: 20 }] },  // Josjafats bønn
      { chapters: [{ bookId: 15, chapter: 9 }] },   // Esras syndsbekjennelse
      { chapters: [{ bookId: 16, chapter: 1 }] },   // Nehemjas bønn
      { chapters: [{ bookId: 16, chapter: 9 }] },   // Folkets syndsbekjennelse
      { chapters: [{ bookId: 23, chapter: 6 }] },   // Jesaja i tempelet
      { chapters: [{ bookId: 24, chapter: 32 }] },  // Jeremias bønn
      { chapters: [{ bookId: 27, chapter: 9 }] },   // Daniels bønn
      { chapters: [{ bookId: 32, chapter: 2 }] },   // Jonas bønn
      { chapters: [{ bookId: 35, chapter: 3 }] },   // Habakkuks bønn
      // Salmebønner
      { chapters: [{ bookId: 19, chapter: 51 }] },  // Botssalmen
      { chapters: [{ bookId: 19, chapter: 23 }] },  // Herren er min hyrde
      { chapters: [{ bookId: 19, chapter: 27 }] },  // Herren er mitt lys
      { chapters: [{ bookId: 19, chapter: 91 }] },  // Under Den Høyestes skjul
      { chapters: [{ bookId: 19, chapter: 139 }] }, // Du ransaker meg
      // NT-bønner
      { chapters: [{ bookId: 40, chapter: 6 }] },   // Fader vår
      { chapters: [{ bookId: 42, chapter: 1 }] },   // Marias lovsang
      { chapters: [{ bookId: 42, chapter: 2 }] },   // Simeons lovsang
      { chapters: [{ bookId: 43, chapter: 17 }] },  // Jesu yppersteprestlige bønn
      { chapters: [{ bookId: 44, chapter: 4 }] },   // Menighetens bønn
      { chapters: [{ bookId: 49, chapter: 1 }] },   // Paulus' bønn for efeserne
      { chapters: [{ bookId: 49, chapter: 3 }] },   // Paulus' andre bønn
      { chapters: [{ bookId: 50, chapter: 1 }] },   // Paulus' bønn for filipperne
      { chapters: [{ bookId: 51, chapter: 1 }] },   // Paulus' bønn for kolosserne
    ]
  },

  {
    id: "jesu-lignelser",
    name: "Jesu lignelser",
    description: "Les alle Jesu lignelser samlet fra de fire evangeliene.",
    category: "tematisk",
    type: "custom",
    readings: [
      // Lignelser om Guds rike
      { chapters: [{ bookId: 40, chapter: 13 }] },  // Såmannen, ugresset, sennepsfrøet, surdeigen, skatten, perlen, fiskenoten
      { chapters: [{ bookId: 41, chapter: 4 }] },   // Såmannen (Markus), frøet som vokser
      // Lignelser om nåde og tilgivelse
      { chapters: [{ bookId: 40, chapter: 18 }] },  // Den ubarmhjertige tjener
      { chapters: [{ bookId: 42, chapter: 7 }] },   // De to skyldnere
      { chapters: [{ bookId: 42, chapter: 15 }] },  // Det tapte får, den tapte mynten, den bortkomne sønn
      { chapters: [{ bookId: 42, chapter: 18 }] },  // Fariseeren og tolleren
      // Lignelser om bønn
      { chapters: [{ bookId: 42, chapter: 11 }] },  // Vennen ved midnatt
      { chapters: [{ bookId: 42, chapter: 18 }] },  // Enken og dommeren
      // Lignelser om rikdom og forvaltning
      { chapters: [{ bookId: 42, chapter: 12 }] },  // Den rike bonden, den tro forvalter
      { chapters: [{ bookId: 42, chapter: 16 }] },  // Den uærlige forvalteren, den rike mann og Lasarus
      { chapters: [{ bookId: 40, chapter: 25 }] },  // Talentene
      { chapters: [{ bookId: 42, chapter: 19 }] },  // De ti minene
      // Lignelser om beredskap
      { chapters: [{ bookId: 40, chapter: 24 }] },  // Tjeneren, den tro og utro tjener
      { chapters: [{ bookId: 40, chapter: 25 }] },  // De ti brudepiker, talentene, sauene og geitene
      { chapters: [{ bookId: 42, chapter: 12 }] },  // Vær beredt
      // Lignelser om Israel og frelsen
      { chapters: [{ bookId: 40, chapter: 20 }] },  // Arbeiderne i vingården
      { chapters: [{ bookId: 40, chapter: 21 }] },  // De to sønnene, de onde vingårdsmennene
      { chapters: [{ bookId: 40, chapter: 22 }] },  // Kongesønnens bryllup
      { chapters: [{ bookId: 42, chapter: 13 }] },  // Fikentreet, den trange dør
      { chapters: [{ bookId: 42, chapter: 14 }] },  // Det store gjestebud, tårnet, kongen i krig
      // Lignelser fra Johannes
      { chapters: [{ bookId: 43, chapter: 10 }] },  // Den gode hyrde
      { chapters: [{ bookId: 43, chapter: 15 }] },  // Vintreet og grenene
    ]
  },

  {
    id: "jesu-liv-kronologisk",
    name: "Jesu liv kronologisk",
    description: "Les om Jesu liv i kronologisk rekkefølge fra alle fire evangelier.",
    category: "tematisk",
    type: "custom",
    readings: [
      // Forhistorie og fødsel
      { chapters: [{ bookId: 43, chapter: 1 }] },   // I begynnelsen var Ordet
      { chapters: [{ bookId: 42, chapter: 1 }] },   // Engelen til Maria, besøket hos Elisabeth
      { chapters: [{ bookId: 40, chapter: 1 }] },   // Josefs drøm
      { chapters: [{ bookId: 42, chapter: 2 }] },   // Fødselen, hyrdene, Simeon og Anna
      { chapters: [{ bookId: 40, chapter: 2 }] },   // Vismennene, flukten til Egypt
      // Dåp og fristelse
      { chapters: [{ bookId: 41, chapter: 1 }] },   // Johannes døperen, Jesu dåp, fristelsen
      { chapters: [{ bookId: 40, chapter: 3 }] },   // Jesu dåp
      { chapters: [{ bookId: 40, chapter: 4 }] },   // Fristelsen, tjenesten begynner
      { chapters: [{ bookId: 43, chapter: 2 }] },   // Bryllupet i Kana
      { chapters: [{ bookId: 43, chapter: 3 }] },   // Nikodemus
      { chapters: [{ bookId: 43, chapter: 4 }] },   // Kvinnen ved brønnen
      // Tjenesten i Galilea
      { chapters: [{ bookId: 42, chapter: 4 }] },   // I Nasaret, de første disiplene
      { chapters: [{ bookId: 42, chapter: 5 }] },   // Fiskefangsten, helbredelser
      { chapters: [{ bookId: 40, chapter: 5 }] },   // Bergprekenen
      { chapters: [{ bookId: 40, chapter: 6 }] },   // Bergprekenen fortsetter
      { chapters: [{ bookId: 40, chapter: 7 }] },   // Bergprekenen avsluttes
      { chapters: [{ bookId: 41, chapter: 2 }] },   // Den lamme, Levi, faste
      { chapters: [{ bookId: 41, chapter: 3 }] },   // Sabbaten, de tolv utvelges
      { chapters: [{ bookId: 41, chapter: 5 }] },   // Legion, Jairus' datter
      { chapters: [{ bookId: 41, chapter: 6 }] },   // I Nasaret, de tolv sendes ut, døperen halshugges
      { chapters: [{ bookId: 43, chapter: 6 }] },   // Brødunderet, Jesus går på vannet
      { chapters: [{ bookId: 40, chapter: 16 }] },  // Peters bekjennelse
      { chapters: [{ bookId: 41, chapter: 9 }] },   // Forklarelsen på fjellet
      // Reisen mot Jerusalem
      { chapters: [{ bookId: 42, chapter: 9 }] },   // Forklarelsen, hvem er størst
      { chapters: [{ bookId: 42, chapter: 10 }] },  // De sytti sendes ut
      { chapters: [{ bookId: 43, chapter: 9 }] },   // Den blindfødte
      { chapters: [{ bookId: 43, chapter: 11 }] },  // Lasarus oppvekkes
      { chapters: [{ bookId: 42, chapter: 17 }] },  // De ti spedalske
      { chapters: [{ bookId: 42, chapter: 19 }] },  // Sakkeus
      // Den siste uken
      { chapters: [{ bookId: 40, chapter: 21 }] },  // Inntoget i Jerusalem
      { chapters: [{ bookId: 43, chapter: 12 }] },  // Salvingen, inntoget
      { chapters: [{ bookId: 41, chapter: 11 }] },  // Tempelrenselsen
      { chapters: [{ bookId: 41, chapter: 12 }] },  // Spørsmål til Jesus
      { chapters: [{ bookId: 41, chapter: 13 }] },  // Endetidstalen
      { chapters: [{ bookId: 43, chapter: 13 }] },  // Fotvaskingen
      { chapters: [{ bookId: 43, chapter: 14 }] },  // Avskjedstalen
      { chapters: [{ bookId: 43, chapter: 15 }] },  // Vintreet
      { chapters: [{ bookId: 43, chapter: 16 }] },  // Talsmannen
      { chapters: [{ bookId: 43, chapter: 17 }] },  // Yppersteprestlig bønn
      // Lidelse og død
      { chapters: [{ bookId: 40, chapter: 26 }] },  // Getsemane, arrestasjonen
      { chapters: [{ bookId: 40, chapter: 27 }] },  // Forhøret, korsfestelsen
      { chapters: [{ bookId: 43, chapter: 18 }] },  // Forhøret (Johannes)
      { chapters: [{ bookId: 43, chapter: 19 }] },  // Korsfestelsen (Johannes)
      // Oppstandelse og himmelfart
      { chapters: [{ bookId: 40, chapter: 28 }] },  // Oppstandelsen, misjonsbefalingen
      { chapters: [{ bookId: 42, chapter: 24 }] },  // Emmaus, himmelfarten
      { chapters: [{ bookId: 43, chapter: 20 }] },  // Maria, Tomas
      { chapters: [{ bookId: 43, chapter: 21 }] },  // Ved Gennesaretsjøen
    ]
  },

  // ============================================
  // LANGE PLANER (over 100 dager)
  // ============================================

  {
    id: "salmene-150",
    name: "Salmene på 150 dager",
    description: "Les én salme hver dag. En reise gjennom bønn, lovsang og klage.",
    category: "lang",
    type: "sequential",
    bookRange: "salmene",
    chaptersPerDay: 1
  },

  {
    id: "arlig",
    name: "Hele Bibelen på ett år",
    description: "Les hele Bibelen på 365 dager med både GT og NT hver dag.",
    category: "lang",
    type: "parallel",
    tracks: [
      { bookRange: "gt", label: "GT" },
      { bookRange: "nt", label: "NT" }
    ],
    days: 365
  },

  {
    id: "gt-arlig",
    name: "Det gamle testamentet på ett år",
    description: "Les hele GT på 365 dager med ~2.5 kapitler per dag.",
    category: "lang",
    type: "distributed",
    bookRange: "gt",
    days: 365
  },

  // ============================================
  // INTENSIVE PLANER
  // ============================================

  {
    id: "bibelen-30",
    name: "Hele Bibelen på 30 dager",
    description: "Les hele Bibelen på én måned med både GT og NT hver dag. Fokus på det store bildet.",
    category: "intensiv",
    type: "parallel",
    tracks: [
      { bookRange: "gt", label: "GT" },
      { bookRange: "nt", label: "NT" }
    ],
    days: 30,
    labels: [
      "Skapelsen og Jesu fødsel",
      "Jakob og Josef / Jesu undervisning",
      "Utferden fra Egypt / Jesu siste dager",
      "Ofringene / Markus",
      "Ørkenvandringen begynner / Lukas 1-12",
      "Ørkenvandringen fortsetter / Lukas 13-24",
      "Moses' taler / Johannes 1-11",
      "Josva og landnåmet / Johannes 12-21",
      "Dommertiden / Apostlenes gjerninger 1-14",
      "Rut og Samuel / Apostlenes gjerninger 15-28",
      "Saul og David / Romerne",
      "Davids rike / 1. og 2. Korinterbrev",
      "Salomo og rikets deling / Galaterne-Kolosserne",
      "De delte rikene / Tessalonikerne-Filemon",
      "Krønikebøkene / Hebreerne",
      "Esra og Nehemja / Jakob og Peters brev",
      "Ester og Job / Johannes' brev og Judas",
      "Salmene 1-50 / Åpenbaringen 1-11",
      "Salmene 51-100 / Åpenbaringen 12-22",
      "Salmene 101-150",
      "Ordspråkene",
      "Forkynneren og Høysangen",
      "Jesaja 1-33",
      "Jesaja 34-66",
      "Jeremia 1-26",
      "Jeremia 27-52 og Klagesangene",
      "Esekiel 1-24",
      "Esekiel 25-48",
      "Daniel og Hosea-Amos",
      "Obadja-Malaki"
    ]
  }
];

// Category sort order
export const categoryOrder = {
  kort: 1,
  middels: 2,
  tematisk: 3,
  lang: 4,
  intensiv: 5
};
