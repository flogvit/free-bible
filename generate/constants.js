export const bibles = {
    "osnb": "Norwegian bokmål",
    "osnn": "Norwegian nynorsk",
    "osen": "English",
    "oses": "Spanish",
}

/**
 * Oversettelsesstil per bibel. Stilen hører til oversettelsen, ikke til kommandolinjen:
 * glemmer man --style på en kjøring blir teksten stille produsert etter feil brief, og
 * stilen lagres ikke i versdataene, så feilen kan ikke oppdages i ettertid.
 * --style på kommandolinjen overstyrer fortsatt, for eksperimenter.
 *
 * Navnekonvensjon: grunnformen er språkkoden (osnb, osnn, osen). Varianter får suffiks,
 * f.eks. osnb-child.
 */
export const bibleStyles = {
    osnb: "oral",
    osnn: "oral",
    osen: "oral",
    oses: "oral",
};

export function getBibleStyle(bible) {
    return bibleStyles[bible] || "standard";
}

export const anthropicModel = process.env.ANTHROPIC_MODEL || "claude-opus-5";
// Opus 5 tenker som standard, og max_tokens dekker tenkning + svar under ett.
// Doblet fra 16384 for å gi plass til begge deler.
export const maxTokens = 32000;

// Local Ollama models for lightweight tasks
export const ollamaModel = "qwen3.5:122b";
export const ollamaBaseUrl = "http://localhost:11434";

// Default local model per task. Heavy jobs that get the whole machine (typically
// overnight) use the large model; per-verse jobs that just need a yes/no verdict use
// a smaller one so they stay usable while the machine is doing something else.
// Note: gemma4:31b is deliberately not used for anything needing structured output —
// see ollamaModelConfig, it degrades badly with format:"json".
export const taskModels = {
    triage: "qwen3.5:27b",
    tags: "qwen3.5:27b",
    // Nøkkelordekstraksjon per kapittel (#5). 27b og ikke 122b med vilje: dette
    // er samme klasse arbeid som tags, og den store modellen er opptatt med
    // nattjobber — to modeller residente samtidig halverer gjennomstrømningen.
    words: "qwen3.5:27b",
    references: "qwen3.5:122b",
    translate: "qwen3.5:122b",
    embeddings: "bge-m3"
};

/**
 * Local model for a task. OLLAMA_MODEL overrides everything (useful when the machine
 * is busy); otherwise the task default, falling back to ollamaModel.
 */
export function getTaskModel(task) {
    return process.env.OLLAMA_MODEL || taskModels[task] || ollamaModel;
}

// Model-specific configuration
export const ollamaModelConfig = {
  'gemma4:31b': {
    options: { temperature: 1.0, top_p: 0.95, top_k: 64 },
    noThinkPrefix: '<|think|>\n',  // prepend to prompt to disable thinking
    thinkParam: false,              // don't use think: false in API
    jsonFormat: false,              // gemma4 degrades badly with format:"json"
  },
  'qwen3.5:122b': {
    options: { temperature: 0 },
    noThinkPrefix: '/no_think\n',
    thinkParam: true,               // uses think: false in API
    jsonFormat: true,
  },
  'qwen3.5:27b': {
    options: { temperature: 0 },
    noThinkPrefix: '/no_think\n',
    thinkParam: true,
    jsonFormat: true,
  },
  'qwen3.5:9b': {
    options: { temperature: 0 },
    noThinkPrefix: '/no_think\n',
    thinkParam: true,
    jsonFormat: true,
  },
  'gpt-oss:120b': {
    options: { temperature: 0.1 },
    noThinkPrefix: '',
    thinkParam: false,
    jsonFormat: true,
  },
};

// Familiestandarder for modeller som ikke står eksplisitt over. Uten dette faller en
// nyhentet qwen til fallback-configen, som verken sender think:false eller /no_think —
// og da bruker den hele output-budsjettet på resonnering og blir kuttet.
const ollamaFamilyConfig = [
  [/^qwen/, { options: { temperature: 0 }, noThinkPrefix: '/no_think\n', thinkParam: true, jsonFormat: true }],
  [/^gemma/, { options: { temperature: 1.0, top_p: 0.95, top_k: 64 }, noThinkPrefix: '<|think|>\n', thinkParam: false, jsonFormat: false }],
  [/^gpt-oss/, { options: { temperature: 0.1 }, noThinkPrefix: '', thinkParam: false, jsonFormat: true }],
];

export function getOllamaConfig(model) {
  if (ollamaModelConfig[model]) return ollamaModelConfig[model];

  for (const [pattern, config] of ollamaFamilyConfig) {
    if (pattern.test(model)) return config;
  }

  return {
    options: { temperature: 0 },
    noThinkPrefix: '',
    thinkParam: false,
    jsonFormat: true,
  };
}

// Language name to code mapping
export const languageCodes = {
    'Norwegian bokmål': 'nb',
    'Norwegian nynorsk': 'nn',
    'English': 'en',
    'German': 'de',
    'Spanish': 'es',
    'French': 'fr',
    'Swedish': 'sv',
    'Danish': 'da',
};

// Reverse mapping: code to full name
export const languageNames = {
    'nb': 'Norwegian bokmål',
    'nn': 'Norwegian nynorsk',
    'en': 'English',
    'de': 'German',
    'es': 'Spanish',
    'fr': 'French',
    'sv': 'Swedish',
    'da': 'Danish',
};

// Normalize language input - accepts both codes (nb) and full names (Norwegian bokmål)
export function normalizeLanguage(input) {
    if (languageNames[input.toLowerCase()]) {
        return languageNames[input.toLowerCase()];
    }
    return input;
}

// Get language code from language name
export function getLanguageCode(language) {
    return languageCodes[language] || language.toLowerCase().substring(0, 2);
}

// Book names in different languages (keyed by language code)
export const bookNames = {
    nb: {
        1: "1. Mosebok", 2: "2. Mosebok", 3: "3. Mosebok", 4: "4. Mosebok", 5: "5. Mosebok",
        6: "Josva", 7: "Dommerne", 8: "Rut", 9: "1. Samuel", 10: "2. Samuel",
        11: "1. Kongebok", 12: "2. Kongebok", 13: "1. Krønikebok", 14: "2. Krønikebok",
        15: "Esra", 16: "Nehemja", 17: "Ester", 18: "Job", 19: "Salmene", 20: "Ordspråkene",
        21: "Forkynneren", 22: "Høysangen", 23: "Jesaja", 24: "Jeremia", 25: "Klagesangene",
        26: "Esekiel", 27: "Daniel", 28: "Hosea", 29: "Joel", 30: "Amos", 31: "Obadja",
        32: "Jona", 33: "Mika", 34: "Nahum", 35: "Habakkuk", 36: "Sefanja", 37: "Haggai",
        38: "Sakarja", 39: "Malaki", 40: "Matteus", 41: "Markus", 42: "Lukas", 43: "Johannes",
        44: "Apostlenes gjerninger", 45: "Romerne", 46: "1. Korinterne", 47: "2. Korinterne",
        48: "Galaterne", 49: "Efeserne", 50: "Filipperne", 51: "Kolosserne",
        52: "1. Tessalonikerne", 53: "2. Tessalonikerne", 54: "1. Timoteus", 55: "2. Timoteus",
        56: "Titus", 57: "Filemon", 58: "Hebreerne", 59: "Jakob", 60: "1. Peter", 61: "2. Peter",
        62: "1. Johannes", 63: "2. Johannes", 64: "3. Johannes", 65: "Judas", 66: "Åpenbaringen"
    },
    nn: {
        1: "1. Mosebok", 2: "2. Mosebok", 3: "3. Mosebok", 4: "4. Mosebok", 5: "5. Mosebok",
        6: "Josva", 7: "Domarane", 8: "Rut", 9: "1. Samuel", 10: "2. Samuel",
        11: "1. Kongebok", 12: "2. Kongebok", 13: "1. Krønikebok", 14: "2. Krønikebok",
        15: "Esra", 16: "Nehemja", 17: "Ester", 18: "Job", 19: "Salmane", 20: "Ordtøka",
        21: "Forkynnaren", 22: "Høgsongen", 23: "Jesaja", 24: "Jeremia", 25: "Klagesongane",
        26: "Esekiel", 27: "Daniel", 28: "Hosea", 29: "Joel", 30: "Amos", 31: "Obadja",
        32: "Jona", 33: "Mika", 34: "Nahum", 35: "Habakkuk", 36: "Sefanja", 37: "Haggai",
        38: "Sakarja", 39: "Malaki", 40: "Matteus", 41: "Markus", 42: "Lukas", 43: "Johannes",
        44: "Apostelgjerningane", 45: "Romarane", 46: "1. Korintarane", 47: "2. Korintarane",
        48: "Galatarane", 49: "Efesarane", 50: "Filipparane", 51: "Kolossarane",
        52: "1. Tessalonikarane", 53: "2. Tessalonikarane", 54: "1. Timoteus", 55: "2. Timoteus",
        56: "Titus", 57: "Filemon", 58: "Hebrearane", 59: "Jakob", 60: "1. Peter", 61: "2. Peter",
        62: "1. Johannes", 63: "2. Johannes", 64: "3. Johannes", 65: "Judas", 66: "Openberringa"
    },
    es: {
        1: "Génesis", 2: "Éxodo", 3: "Levítico", 4: "Números", 5: "Deuteronomio",
        6: "Josué", 7: "Jueces", 8: "Rut", 9: "1 Samuel", 10: "2 Samuel",
        11: "1 Reyes", 12: "2 Reyes", 13: "1 Crónicas", 14: "2 Crónicas",
        15: "Esdras", 16: "Nehemías", 17: "Ester", 18: "Job", 19: "Salmos", 20: "Proverbios",
        21: "Eclesiastés", 22: "Cantares", 23: "Isaías", 24: "Jeremías", 25: "Lamentaciones",
        26: "Ezequiel", 27: "Daniel", 28: "Oseas", 29: "Joel", 30: "Amós", 31: "Abdías",
        32: "Jonás", 33: "Miqueas", 34: "Nahúm", 35: "Habacuc", 36: "Sofonías", 37: "Hageo",
        38: "Zacarías", 39: "Malaquías", 40: "Mateo", 41: "Marcos", 42: "Lucas", 43: "Juan",
        44: "Hechos", 45: "Romanos", 46: "1 Corintios", 47: "2 Corintios",
        48: "Gálatas", 49: "Efesios", 50: "Filipenses", 51: "Colosenses",
        52: "1 Tesalonicenses", 53: "2 Tesalonicenses", 54: "1 Timoteo", 55: "2 Timoteo",
        56: "Tito", 57: "Filemón", 58: "Hebreos", 59: "Santiago", 60: "1 Pedro", 61: "2 Pedro",
        62: "1 Juan", 63: "2 Juan", 64: "3 Juan", 65: "Judas", 66: "Apocalipsis"
    }
};

// Get book name for a language (falls back to English from books array)
export function getBookName(bookId, language) {
    const langCode = getLanguageCode(language);
    if (bookNames[langCode] && bookNames[langCode][bookId]) {
        return bookNames[langCode][bookId];
    }
    // Fallback to English name from books array
    const book = books.find(b => b.id === bookId);
    return book ? book.name : `Book ${bookId}`;
}

export const books = [
    {"id": 1, "file": "external/bibles/tanach/Genesis.txt", "name": "Genesis", "chapters": 50},
    {"id": 2, "file": "external/bibles/tanach/Exodus.txt", "name": "Exodus", "chapters": 40},
    {"id": 3, "file": "external/bibles/tanach/Leviticus.txt", "name": "Leviticus", "chapters": 27},
    {"id": 4, "file": "external/bibles/tanach/Numbers.txt", "name": "Numbers", "chapters": 36},
    {"id": 5, "file": "external/bibles/tanach/Deuteronomy.txt", "name": "Deuteronomy", "chapters": 34},
    {"id": 6, "file": "external/bibles/tanach/Joshua.txt", "name": "Joshua", "chapters": 24},
    {"id": 7, "file": "external/bibles/tanach/Judges.txt", "name": "Judges", "chapters": 21},
    {"id": 8, "file": "external/bibles/tanach/Ruth.txt", "name": "Ruth", "chapters": 4},
    {"id": 9, "file": "external/bibles/tanach/Samuel_1.txt", "name": "1 Samuel", "chapters": 31},
    {"id": 10, "file": "external/bibles/tanach/Samuel_2.txt", "name": "2 Samuel", "chapters": 24},
    {"id": 11, "file": "external/bibles/tanach/Kings_1.txt", "name": "1 Kings", "chapters": 22},
    {"id": 12, "file": "external/bibles/tanach/Kings_2.txt", "name": "2 Kings", "chapters": 25},
    {"id": 13, "file": "external/bibles/tanach/Chronicles_1.txt", "name": "1 Chronicles", "chapters": 29},
    {"id": 14, "file": "external/bibles/tanach/Chronicles_2.txt", "name": "2 Chronicles", "chapters": 36},
    {"id": 15, "file": "external/bibles/tanach/Ezra.txt", "name": "Ezra", "chapters": 10},
    {"id": 16, "file": "external/bibles/tanach/Nehemiah.txt", "name": "Nehemiah", "chapters": 13},
    {"id": 17, "file": "external/bibles/tanach/Esther.txt", "name": "Esther", "chapters": 10},
    {"id": 18, "file": "external/bibles/tanach/Job.txt", "name": "Job", "chapters": 42},
    {"id": 19, "file": "external/bibles/tanach/Psalms.txt", "name": "Psalms", "chapters": 150},
    {"id": 20, "file": "external/bibles/tanach/Proverbs.txt", "name": "Proverbs", "chapters": 31},
    {"id": 21, "file": "external/bibles/tanach/Ecclesiastes.txt", "name": "Ecclesiastes", "chapters": 12},
    {"id": 22, "file": "external/bibles/tanach/Song_of_songs.txt", "name": "Song of Solomon", "chapters": 8},
    {"id": 23, "file": "external/bibles/tanach/Isaiah.txt", "name": "Isaiah", "chapters": 66},
    {"id": 24, "file": "external/bibles/tanach/Jeremiah.txt", "name": "Jeremiah", "chapters": 52},
    {"id": 25, "file": "external/bibles/tanach/Lamentations.txt", "name": "Lamentations", "chapters": 5},
    {"id": 26, "file": "external/bibles/tanach/Ezekiel.txt", "name": "Ezekiel", "chapters": 48},
    {"id": 27, "file": "external/bibles/tanach/Daniel.txt", "name": "Daniel", "chapters": 12},
    {"id": 28, "file": "external/bibles/tanach/Hosea.txt", "name": "Hosea", "chapters": 14},
    {"id": 29, "file": "external/bibles/tanach/Joel.txt", "name": "Joel", "chapters": 4},
    {"id": 30, "file": "external/bibles/tanach/Amos.txt", "name": "Amos", "chapters": 9},
    {"id": 31, "file": "external/bibles/tanach/Obadiah.txt", "name": "Obadiah", "chapters": 1},
    {"id": 32, "file": "external/bibles/tanach/Jonah.txt", "name": "Jonah", "chapters": 4},
    {"id": 33, "file": "external/bibles/tanach/Micah.txt", "name": "Micah", "chapters": 7},
    {"id": 34, "file": "external/bibles/tanach/Nahum.txt", "name": "Nahum", "chapters": 3},
    {"id": 35, "file": "external/bibles/tanach/Habakkuk.txt", "name": "Habakkuk", "chapters": 3},
    {"id": 36, "file": "external/bibles/tanach/Zephaniah.txt", "name": "Zephaniah", "chapters": 3},
    {"id": 37, "file": "external/bibles/tanach/Haggai.txt", "name": "Haggai", "chapters": 2},
    {"id": 38, "file": "external/bibles/tanach/Zechariah.txt", "name": "Zechariah", "chapters": 14},
    {"id": 39, "file": "external/bibles/tanach/Malachi.txt", "name": "Malachi", "chapters": 3},
    {"id": 40, "file": "external/bibles/SBLGNT/data/sblgnt/text/Matt.txt", "name": "Matthew", "chapters": 28},
    {"id": 41, "file": "external/bibles/SBLGNT/data/sblgnt/text/Mark.txt", "name": "Mark", "chapters": 16},
    {"id": 42, "file": "external/bibles/SBLGNT/data/sblgnt/text/Luke.txt", "name": "Luke", "chapters": 24},
    {"id": 43, "file": "external/bibles/SBLGNT/data/sblgnt/text/John.txt", "name": "John", "chapters": 21},
    {"id": 44, "file": "external/bibles/SBLGNT/data/sblgnt/text/Acts.txt", "name": "Acts", "chapters": 28},
    {"id": 45, "file": "external/bibles/SBLGNT/data/sblgnt/text/Rom.txt", "name": "Romans", "chapters": 16},
    {"id": 46, "file": "external/bibles/SBLGNT/data/sblgnt/text/1Cor.txt", "name": "1 Corinthians", "chapters": 16},
    {"id": 47, "file": "external/bibles/SBLGNT/data/sblgnt/text/2Cor.txt", "name": "2 Corinthians", "chapters": 13},
    {"id": 48, "file": "external/bibles/SBLGNT/data/sblgnt/text/Gal.txt", "name": "Galatians", "chapters": 6},
    {"id": 49, "file": "external/bibles/SBLGNT/data/sblgnt/text/Eph.txt", "name": "Ephesians", "chapters": 6},
    {"id": 50, "file": "external/bibles/SBLGNT/data/sblgnt/text/Phil.txt", "name": "Philippians", "chapters": 4},
    {"id": 51, "file": "external/bibles/SBLGNT/data/sblgnt/text/Col.txt", "name": "Colossians", "chapters": 4},
    {"id": 52, "file": "external/bibles/SBLGNT/data/sblgnt/text/1Thess.txt", "name": "1 Thessalonians", "chapters": 5},
    {"id": 53, "file": "external/bibles/SBLGNT/data/sblgnt/text/2Thess.txt", "name": "2 Thessalonians", "chapters": 3},
    {"id": 54, "file": "external/bibles/SBLGNT/data/sblgnt/text/1Tim.txt", "name": "1 Timothy", "chapters": 6},
    {"id": 55, "file": "external/bibles/SBLGNT/data/sblgnt/text/2Tim.txt", "name": "2 Timothy", "chapters": 4},
    {"id": 56, "file": "external/bibles/SBLGNT/data/sblgnt/text/Titus.txt", "name": "Titus", "chapters": 3},
    {"id": 57, "file": "external/bibles/SBLGNT/data/sblgnt/text/Phlm.txt", "name": "Philemon", "chapters": 1},
    {"id": 58, "file": "external/bibles/SBLGNT/data/sblgnt/text/Heb.txt", "name": "Hebrews", "chapters": 13},
    {"id": 59, "file": "external/bibles/SBLGNT/data/sblgnt/text/Jas.txt", "name": "James", "chapters": 5},
    {"id": 60, "file": "external/bibles/SBLGNT/data/sblgnt/text/1Pet.txt", "name": "1 Peter", "chapters": 5},
    {"id": 61, "file": "external/bibles/SBLGNT/data/sblgnt/text/2Pet.txt", "name": "2 Peter", "chapters": 3},
    {"id": 62, "file": "external/bibles/SBLGNT/data/sblgnt/text/1John.txt", "name": "1 John", "chapters": 5},
    {"id": 63, "file": "external/bibles/SBLGNT/data/sblgnt/text/2John.txt", "name": "2 John", "chapters": 1},
    {"id": 64, "file": "external/bibles/SBLGNT/data/sblgnt/text/3John.txt", "name": "3 John", "chapters": 1},
    {"id": 65, "file": "external/bibles/SBLGNT/data/sblgnt/text/Jude.txt", "name": "Jude", "chapters": 1},
    {"id": 66, "file": "external/bibles/SBLGNT/data/sblgnt/text/Rev.txt", "name": "Revelation", "chapters": 22}
]