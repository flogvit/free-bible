import * as fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
import {embedTexts} from './llm.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EMBED_BASE = path.join(__dirname, 'embeddings');

function paths(corpus) {
    const dir = path.join(EMBED_BASE, corpus);
    return {
        dir,
        bin: path.join(dir, 'embeddings.bin'),
        index: path.join(dir, 'index.json')
    };
}

function l2norm(v) {
    let s = 0;
    for (let i = 0; i < v.length; i++) s += v[i] * v[i];
    return Math.sqrt(s);
}

/**
 * Whether a complete, ready-to-use embedding set exists for a corpus.
 */
export function hasEmbeddings(corpus) {
    const p = paths(corpus);
    if (!fs.existsSync(p.bin) || !fs.existsSync(p.index)) return false;
    try {
        const idx = JSON.parse(fs.readFileSync(p.index, 'utf-8'));
        return !!idx.complete;
    } catch {
        return false;
    }
}

/**
 * Build embeddings for a corpus.
 *
 * @param {object}   args
 * @param {string}   args.corpus     Storage namespace (e.g. "osnb", "songs/main"). Becomes a path under embeddings/.
 * @param {Array}    args.items      Array of arbitrary metadata objects, one per text.
 * @param {string}   args.model      Ollama embed model (e.g. "bge-m3").
 * @param {Function} args.getText    (item) => string  — text to embed for each item.
 * @param {number}   [args.batchSize=32]
 * @param {boolean}  [args.force=false]  Rebuild even if existing complete.
 *
 * Resumes automatically from a partial run if model + items.length match.
 * Writes embeddings/<corpus>/embeddings.bin (Float32Array, normalized) and index.json.
 */
export async function buildEmbeddings({corpus, items, model, getText, batchSize = 32, force = false}) {
    const p = paths(corpus);
    if (!fs.existsSync(p.dir)) fs.mkdirSync(p.dir, {recursive: true});

    let startIdx = 0;
    let dim = null;
    let buf = null;

    if (!force && fs.existsSync(p.index) && fs.existsSync(p.bin)) {
        try {
            const idx = JSON.parse(fs.readFileSync(p.index, 'utf-8'));
            if (idx.model === model && Array.isArray(idx.items) && idx.items.length === items.length) {
                if (idx.complete) {
                    console.log(`Embeddings already built for "${corpus}" (${items.length} items, dim ${idx.dim}, model ${model})`);
                    return;
                }
                startIdx = idx.completedCount || 0;
                dim = idx.dim;
                const fileBuf = fs.readFileSync(p.bin);
                buf = new Float32Array(items.length * dim);
                const existing = new Float32Array(fileBuf.buffer, fileBuf.byteOffset, fileBuf.byteLength / 4);
                buf.set(existing.subarray(0, startIdx * dim));
                console.log(`Resuming "${corpus}" from item ${startIdx}/${items.length}`);
            }
        } catch (e) {
            console.warn(`Could not resume (${e.message}); starting fresh`);
        }
    }

    if (!buf) {
        const probe = await embedTexts([getText(items[0])], model);
        dim = probe[0].length;
        buf = new Float32Array(items.length * dim);
        const norm = l2norm(probe[0]);
        for (let k = 0; k < dim; k++) buf[k] = probe[0][k] / norm;
        startIdx = 1;
    }

    const total = items.length;
    let lastSaved = startIdx;
    const SAVE_EVERY = 1000;

    const writeCheckpoint = (count, complete) => {
        fs.writeFileSync(p.bin, Buffer.from(buf.buffer));
        fs.writeFileSync(p.index, JSON.stringify({
            model, dim, normalized: true,
            complete,
            completedCount: count,
            items: items.map((it, k) => ({idx: k, ...it}))
        }, null, 2));
    };

    if (startIdx > 0 && startIdx === total) {
        writeCheckpoint(total, true);
        return;
    }

    for (let i = startIdx; i < total; i += batchSize) {
        const end = Math.min(i + batchSize, total);
        const texts = items.slice(i, end).map(getText);
        const embs = await embedTexts(texts, model);
        if (embs.length !== texts.length) {
            throw new Error(`Embed batch returned ${embs.length} vectors, expected ${texts.length}`);
        }
        for (let j = 0; j < embs.length; j++) {
            const norm = l2norm(embs[j]);
            for (let k = 0; k < dim; k++) {
                buf[(i + j) * dim + k] = embs[j][k] / norm;
            }
        }
        process.stdout.write(`\r  Embedded ${end}/${total} for "${corpus}"`);
        if ((end - lastSaved) >= SAVE_EVERY || end === total) {
            writeCheckpoint(end, end === total);
            lastSaved = end;
        }
    }
    process.stdout.write('\n');
}

/**
 * Load a complete embedding corpus into memory.
 * Returns { model, dim, items, embeddings (Float32Array, normalized, items.length × dim) }.
 */
export function loadEmbeddings(corpus) {
    const p = paths(corpus);
    if (!fs.existsSync(p.bin) || !fs.existsSync(p.index)) {
        throw new Error(`No embeddings found for "${corpus}" — build them first`);
    }
    const idx = JSON.parse(fs.readFileSync(p.index, 'utf-8'));
    if (!idx.complete) {
        throw new Error(`Embeddings for "${corpus}" are incomplete (${idx.completedCount}/${idx.items.length}) — re-run build`);
    }
    const fileBuf = fs.readFileSync(p.bin);
    const embeddings = new Float32Array(fileBuf.buffer, fileBuf.byteOffset, fileBuf.byteLength / 4);
    if (embeddings.length !== idx.items.length * idx.dim) {
        throw new Error(`Embedding file size mismatch: expected ${idx.items.length * idx.dim} floats, got ${embeddings.length}`);
    }
    return {model: idx.model, dim: idx.dim, items: idx.items, embeddings};
}

/**
 * Embed a single query string against the same model used to build `state`.
 * Returns a normalized Float32Array of length state.dim.
 */
export async function embedQuery(state, text) {
    const result = await embedTexts([text], state.model);
    const v = result[0];
    const norm = l2norm(v);
    const out = new Float32Array(state.dim);
    for (let i = 0; i < state.dim; i++) out[i] = v[i] / norm;
    return out;
}

/**
 * Top-K nearest neighbours by cosine similarity (assumes normalized vectors).
 *
 * @param {object}   state             From loadEmbeddings()
 * @param {Float32Array} queryEmbedding Normalized query vector of length state.dim
 * @param {object}   [options]
 * @param {number}   [options.k=20]
 * @param {number}   [options.threshold=0]  Skip results below this similarity.
 * @param {Function} [options.filter]       (item) => bool  — exclude items where filter returns false.
 * @returns {Array<{idx:number, score:number}>} sorted by score desc.
 */
export function topK(state, queryEmbedding, {k = 20, threshold = 0, filter = null} = {}) {
    const {dim, embeddings, items} = state;
    const heap = [];
    for (let i = 0; i < items.length; i++) {
        if (filter && !filter(items[i])) continue;
        let sim = 0;
        const off = i * dim;
        for (let d = 0; d < dim; d++) {
            sim += queryEmbedding[d] * embeddings[off + d];
        }
        if (sim < threshold) continue;
        if (heap.length < k) {
            heap.push({idx: i, score: sim});
            if (heap.length === k) heap.sort((a, b) => a.score - b.score);
        } else if (sim > heap[0].score) {
            heap[0] = {idx: i, score: sim};
            heap.sort((a, b) => a.score - b.score);
        }
    }
    return heap.sort((a, b) => b.score - a.score);
}

/**
 * Top-K similar items to an existing index in the same corpus (always excludes self).
 */
export function topKByIndex(state, idx, options = {}) {
    const {dim, embeddings} = state;
    const queryEmbedding = embeddings.subarray(idx * dim, (idx + 1) * dim);
    const baseFilter = options.filter;
    return topK(state, queryEmbedding, {
        ...options,
        filter: (item) => item.idx !== idx && (!baseFilter || baseFilter(item))
    });
}
