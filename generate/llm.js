import Anthropic from '@anthropic-ai/sdk';
import {anthropicModel, maxTokens, ollamaBaseUrl, getOllamaConfig, getTaskModel, localModelRank} from "./constants.js";

const MAX_RETRIES = 3;

// ── Modellvalg: to jobber skal ikke kaste hverandres modell ut av minnet ─────────
//
// Ollama holder én runner. Kjører translate (qwen3.5:122b, 81 GB) samtidig som
// f.eks. important_words (qwen3.5:27b, 17 GB), går de ikke inn ved siden av
// hverandre på 128 GB, og Ollama laster modellen om for HVERT kall. Målt
// 2026-07-30 i ~/.ollama/logs/server.log: 17–19 s for å starte 122b-runneren,
// ~6 s for 27b, og `task 0` hver gang — altså kald prompt-cache også. Det var
// det som gjorde translate til 179 s per fil.
//
// Derfor: spør Ollama hva som allerede ligger i minnet, og bruk den hvis den er
// minst like stor som den tasken foretrekker. Da havner begge jobbene på samme
// runner og forespørslene køes i stedet for å bytte modell.
//
// Regelen kan bare oppgradere, aldri nedgradere. Det er poenget med å sammenlikne
// mot rangeringen framfor bare å ta det som ligger der: en tag-jobb som startet
// først skal ikke kunne dra translate ned på 27b.
//
// OLLAMA_MODEL pinner modellen og slår av adopsjon. OLLAMA_NO_ADOPT=1 slår av
// bare adopsjonen.

// Kort nok til å oppdage at en annen jobb har startet, lang nok til at en serie
// kall ikke spør for hvert vers. OLLAMA_PS_CACHE_MS=0 slår cachen av.
const PS_CACHE_MS = Number(process.env.OLLAMA_PS_CACHE_MS ?? 10000);
let psCache = {at: 0, models: []};
let announcedAdoption = null;

/** Modellene Ollama har lastet nå. Cachet kort, siden hvert kall spør. */
async function residentModels() {
    const now = Date.now();
    if (now - psCache.at < PS_CACHE_MS) return psCache.models;
    let models = [];
    try {
        const response = await fetch(`${ollamaBaseUrl}/api/ps`, {signal: AbortSignal.timeout(5000)});
        const data = await response.json();
        models = (data.models || []).map(entry => entry.model).filter(Boolean);
    } catch {
        // Ollama nede eller treg: fall tilbake på tasken sin egen modell. Selve
        // generate-kallet gir en tydeligere feilmelding enn vi kan gi herfra.
    }
    psCache = {at: now, models};
    return models;
}

/**
 * Er skjemaet LUKKET — altså er hvert felt begrenset til et lite, oppregnet rom?
 *
 * Dette er skillet som avgjør om en modell uten `openSchema` kan brukes. Et
 * lukket skjema lar tvungen dekoding gjøre jobben: modellen velger mellom fire
 * enum-verdier, den skriver ikke fritt. Et åpent skjema — ubegrensede arrays,
 * fritekstfelter — krever at modellen selv holder styr på strukturen mens den
 * genererer innhold, og det er dét gemma4 ble målt til å degradere på.
 *
 * `verdict: enum[4]` er lukket. `issues: array<{explanation: string}>` er åpent.
 * Er skjemaet ukjent i formen, regnes det som åpent.
 */
export function isClosedSchema(schema) {
    if (!schema || typeof schema !== 'object') return false;

    // enum/const binder verdien uansett hvilken type som står oppgitt
    if (Array.isArray(schema.enum) || 'const' in schema) return true;

    for (const branch of ['anyOf', 'oneOf', 'allOf']) {
        if (Array.isArray(schema[branch])) return schema[branch].every(isClosedSchema);
    }

    switch (schema.type) {
        case 'boolean':
        case 'integer':
        case 'number':
        case 'null':
            return true;
        case 'string':
            return false;                     // fritekst med mindre enum/const fanget den over
        case 'array':
            return Number.isFinite(schema.maxItems) && isClosedSchema(schema.items);
        case 'object': {
            if (schema.additionalProperties === true) return false;
            const properties = Object.values(schema.properties || {});
            if (!properties.length) return false;
            return properties.every(isClosedSchema)
                && (schema.additionalProperties === undefined
                    || schema.additionalProperties === false
                    || isClosedSchema(schema.additionalProperties));
        }
        default:
            return false;
    }
}

/**
 * Modellen et lokalt kall faktisk skal bruke.
 *
 * @param {string} [task] - Task-navn, se taskModels i constants.js. Uten task blir
 *                          det ollamaModel, som før.
 * @param {object} [options]
 * @param {string} [options.model] - Eksplisitt modell. Pinnes: ingen adopsjon.
 * @param {object} [options.schema] - Skjemaet kallet skal dekode mot. Er det ÅPENT,
 *                          kan en modell med openSchema:false ikke adopteres.
 * @param {boolean} [options.needsSchema] - Eldre form: «kallet bruker et skjema, jeg
 *                          vet ikke hvilket». Behandles som et åpent skjema.
 * @returns {Promise<string>}
 */
export async function resolveLocalModel(task, {model, schema, needsSchema = false} = {}) {
    if (model) return model;

    const preferred = getTaskModel(task);
    if (process.env.OLLAMA_MODEL || process.env.OLLAMA_NO_ADOPT) return preferred;

    const preferredRank = localModelRank(preferred);
    if (preferredRank === null) return preferred;

    // Et lukket skjema stenger ingen ute. Bare åpen generering gjør det.
    const openGeneration = schema ? !isClosedSchema(schema) : Boolean(needsSchema);

    let best = preferred;
    let bestRank = preferredRank;
    for (const resident of await residentModels()) {
        const rank = localModelRank(resident);
        if (rank === null || rank < bestRank) continue;
        if (openGeneration && !getOllamaConfig(resident).openSchema) continue;
        best = resident;
        bestRank = rank;
    }

    if (best !== preferred && announcedAdoption !== best) {
        console.log(`  bruker ${best} — den ligger allerede i minnet (foretrukket: ${preferred})`);
        announcedAdoption = best;
    }
    return best;
}

let anthropic = null;

function getAnthropic() {
    if (!anthropic) {
        anthropic = new Anthropic({apiKey: process.env.ANTHROPIC_API_KEY});
    }
    return anthropic;
}

// Med tenkning på ligger tenkeblokker først i content — teksten må hentes ut,
// ikke leses fra content[0]. Samme funksjon som i bible.mjs.
function extractText(completion) {
    const block = completion.content.find(b => b.type === 'text');
    if (!block) {
        throw new Error(`No text block in response (stop_reason: ${completion.stop_reason})`);
    }
    return block.text;
}

async function callAnthropic(content, schema) {
    const options = {
        model: anthropicModel,
        max_tokens: maxTokens,
        messages: [{role: "user", content}]
    };
    if (schema) {
        options.output_config = {format: {type: "json_schema", schema}};
    }
    // Strømming, ikke messages.create: SDK-en regner ut en forventet varighet fra
    // max_tokens og nekter å kjøre non-streaming når den overstiger 10 minutter
    // (calculateNonstreamingTimeout). Taket er 128000 × 10/60 ≈ 21 333 tokens, og
    // maxTokens er 32000 — så HVERT non-streaming-kall kastet, uansett hvor kort
    // svaret faktisk ble. bible.mjs har strømmet av samme grunn siden februar.
    const completion = await getAnthropic().messages.stream(options).finalMessage();
    if (completion.stop_reason === 'max_tokens') {
        throw new Error('Response truncated due to max_tokens limit');
    }
    if (completion.stop_reason === 'refusal') {
        throw new Error(`Refused (${completion.stop_details?.category || 'unknown'})`);
    }
    return extractText(completion);
}

async function callOllama(content, schema, {think = false, ollamaOptions = {}, model, task} = {}) {
    const activeModel = await resolveLocalModel(task, {model, schema});
    const config = getOllamaConfig(activeModel);
    const body = {
        model: activeModel,
        prompt: think ? content : (config.noThinkPrefix + content),
        stream: false,
        options: {...config.options, num_predict: 32768, ...ollamaOptions}
    };
    if (config.thinkParam) body.think = think;
    if (schema) body.format = schema;
    // Uten timeout henger et stanset ollama-kall i det uendelige og tar hele kjøringen
    // med seg. callWithRetry prøver på nytt, så en avbrutt forespørsel er gjenopprettbar.
    const timeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS) || 300000;
    let response;
    try {
        response = await fetch(`${ollamaBaseUrl}/api/generate`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(timeoutMs)
        });
    } catch (error) {
        if (error.name === 'TimeoutError' || error.name === 'AbortError') {
            throw new Error(`Ollama did not respond within ${timeoutMs / 1000}s (model: ${activeModel})`);
        }
        throw error;
    }
    const data = await response.json();
    if (data.done_reason && data.done_reason !== 'stop') {
        throw new Error(`Ollama stopped early (done_reason: ${data.done_reason}) - response truncated`);
    }
    return data.response;
}

/**
 * Call LLM with optional JSON schema.
 * @param {string} content - The prompt
 * @param {object} [options]
 * @param {object} [options.schema] - JSON schema for structured output
 * @param {boolean} [options.local] - Use Ollama instead of Anthropic
 * @param {string} [options.task] - Task name for local model choice (see taskModels)
 * @param {string} [options.model] - Pin the local model, skipping adoption
 * @returns {string} Raw text response
 */
export async function call(content, {schema, local, think, ollamaOptions, model, task} = {}) {
    if (local) {
        return callOllama(content, schema, {think, ollamaOptions, model, task});
    }
    return callAnthropic(content, schema);
}

/**
 * Call LLM with retries. Returns parsed JSON if schema is provided, raw text otherwise.
 * @param {string} content - The prompt
 * @param {object} [options]
 * @param {object} [options.schema] - JSON schema for structured output
 * @param {boolean} [options.local] - Use Ollama instead of Anthropic
 * @param {string} [options.task] - Task name for local model choice (see taskModels)
 * @param {string} [options.model] - Pin the local model, skipping adoption
 * @param {string} [options.context] - Context string for error messages
 * @returns {object|string} Parsed JSON if schema, raw text otherwise
 */
export async function callWithRetry(content, {schema, local, think, ollamaOptions, model, task, context = ''} = {}) {
    let lastError;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const text = await call(content, {schema, local, think, ollamaOptions, model, task});
            return schema ? JSON.parse(text) : text;
        } catch (error) {
            lastError = error;
            if (attempt < MAX_RETRIES) {
                console.log(`  Attempt ${attempt} failed (${error.message}), retrying...`);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    }

    console.error(`Failed after ${MAX_RETRIES} attempts for ${context}`);
    throw lastError;
}

const WEB_SEARCH_TOOL = {type: 'web_search_20260209', name: 'web_search'};
const MAX_PAUSE_TURNS = 5;

/**
 * Call Anthropic with the server-side web_search tool so the model can look
 * facts up instead of answering from memory.
 *
 * Node can't browse on its own, so verification has to happen on Anthropic's
 * side. Returns the answer text plus the URLs actually retrieved — a caller can
 * therefore record real sources rather than URLs the model made up.
 *
 * @param {string} content - The prompt
 * @param {object} [options]
 * @param {number} [options.maxUses] - Cap on searches per call
 * @param {string[]} [options.allowedDomains] - Restrict search to these domains
 * @param {string} [options.context] - Context string for error messages
 * @returns {Promise<{text: string, sources: {url: string, title?: string}[]}>}
 */
export async function callWithWebSearch(content, {maxUses = 6, allowedDomains, context = ''} = {}) {
    const tool = {...WEB_SEARCH_TOOL, max_uses: maxUses};
    if (allowedDomains) tool.allowed_domains = allowedDomains;

    const messages = [{role: 'user', content}];
    const sources = [];
    const text = [];

    for (let turn = 0; turn <= MAX_PAUSE_TURNS; turn++) {
        // Strømming av samme grunn som i callAnthropic: maxTokens er over SDK-ens
        // non-streaming-tak, så messages.create kaster før forespørselen sendes.
        const completion = await getAnthropic().messages.stream({
            model: anthropicModel,
            max_tokens: maxTokens,
            tools: [tool],
            messages
        }).finalMessage();

        for (const block of completion.content) {
            if (block.type === 'text') {
                text.push(block.text);
            } else if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
                // A non-array content means the search errored (e.g. max_uses_exceeded).
                for (const result of block.content) {
                    if (result.url) sources.push({url: result.url, title: result.title});
                }
            }
        }

        if (completion.stop_reason === 'max_tokens') {
            throw new Error(`Response truncated due to max_tokens limit${context ? ` for ${context}` : ''}`);
        }
        if (completion.stop_reason !== 'pause_turn') {
            return {text: text.join('\n'), sources};
        }
        // The server-side search loop hit its iteration cap; re-send to resume.
        messages.push({role: 'assistant', content: completion.content});
    }

    throw new Error(`Web search did not finish within ${MAX_PAUSE_TURNS} resumes${context ? ` for ${context}` : ''}`);
}

/**
 * Embed an array of texts via Ollama. Returns array of embedding vectors.
 * Throws if the model isn't available or returns no embeddings.
 */
export async function embedTexts(texts, model) {
    const response = await fetch(`${ollamaBaseUrl}/api/embed`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({model, input: texts})
    });
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Embed failed (${response.status}): ${body}`);
    }
    const data = await response.json();
    if (!data.embeddings || !Array.isArray(data.embeddings)) {
        throw new Error(`Embed returned no embeddings: ${JSON.stringify(data).slice(0, 200)}`);
    }
    return data.embeddings;
}

/**
 * Call Ollama directly for lightweight tasks (number extraction, classification).
 * Always uses local model, no retries, no schema parsing.
 */
export async function callOllamaRaw(prompt, {numPredict = 50, model, task} = {}) {
    const activeModel = await resolveLocalModel(task, {model});
    const config = getOllamaConfig(activeModel);
    const body = {
        model: activeModel,
        prompt: config.noThinkPrefix + prompt,
        stream: false,
        options: {...config.options, num_predict: numPredict}
    };
    if (config.thinkParam) body.think = false;
    const response = await fetch(`${ollamaBaseUrl}/api/generate`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body)
    });
    const data = await response.json();
    return (data.response || '').trim();
}
