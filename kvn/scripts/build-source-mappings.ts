import * as fs from 'fs';
import * as path from 'path';
import {fileURLToPath} from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MAPPINGS_DIR = path.join(__dirname, '..', 'mappings');
const SOURCE_FILE = path.join(MAPPINGS_DIR, 'osnb2.ukvn.json');

interface MapEntry {
    kvnFrom: number;
    kvnTo: number;
    kvnRef: string;
    tkvnFrom: number;
    tkvnTo: number;
    tkvnRef: string;
    order: number;
}

interface Mapping {
    version: number;
    system: string;
    name: string;
    encoding: {partSize: number; maxVerse: number; maxChapter: number};
    bookNames: Record<string, number>;
    stats?: Record<string, number>;
    map: MapEntry[];
}

function bookFromKvn(kvn: number, encoding: Mapping['encoding']): number {
    const mCh = encoding.maxChapter * encoding.maxVerse * encoding.partSize;
    return Math.floor(kvn / mCh);
}

function buildFiltered(
    source: Mapping,
    targetName: string,
    bookIds: Set<number>
): Mapping {
    const map = source.map.filter(e => bookIds.has(bookFromKvn(e.kvnFrom, source.encoding)));

    const bookNames: Record<string, number> = {};
    for (const [name, id] of Object.entries(source.bookNames)) {
        if (bookIds.has(id)) bookNames[name] = id;
    }

    const chapterSet = new Set<string>();
    for (const e of map) {
        const book = bookFromKvn(e.kvnFrom, source.encoding);
        const mV = source.encoding.maxVerse * source.encoding.partSize;
        const mCh = source.encoding.maxChapter * mV;
        const chapter = Math.floor((e.kvnFrom - book * mCh) / mV);
        chapterSet.add(`${book}:${chapter}`);
    }

    return {
        version: source.version,
        system: targetName,
        name: targetName,
        encoding: source.encoding,
        bookNames,
        stats: {
            mappedChapters: chapterSet.size,
            totalMappingEntries: map.length,
            derivedFrom: 0
        },
        map
    };
}

function main() {
    const source: Mapping = JSON.parse(fs.readFileSync(SOURCE_FILE, 'utf8'));
    console.log(`Source: ${source.name}, ${source.map.length} entries`);

    const otBooks = new Set<number>();
    for (let i = 1; i <= 39; i++) otBooks.add(i);
    const ntBooks = new Set<number>();
    for (let i = 40; i <= 66; i++) ntBooks.add(i);

    const tanach = buildFiltered(source, 'tanach', otBooks);
    const sblgnt = buildFiltered(source, 'sblgnt', ntBooks);

    const tanachPath = path.join(MAPPINGS_DIR, 'tanach.ukvn.json');
    const sblgntPath = path.join(MAPPINGS_DIR, 'sblgnt.ukvn.json');

    fs.writeFileSync(tanachPath, JSON.stringify(tanach, null, 2));
    fs.writeFileSync(sblgntPath, JSON.stringify(sblgnt, null, 2));

    console.log(`tanach.ukvn.json: ${tanach.map.length} entries, ${Object.keys(tanach.bookNames).length} book names`);
    console.log(`sblgnt.ukvn.json: ${sblgnt.map.length} entries, ${Object.keys(sblgnt.bookNames).length} book names`);
    console.log(`Total: ${tanach.map.length + sblgnt.map.length} vs source ${source.map.length}`);
}

main();
