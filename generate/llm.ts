import Anthropic from '@anthropic-ai/sdk';
import {anthropicModel, maxTokens, ollamaBaseUrl, getOllamaConfig, getTaskModel, localModelRank} from "./constants.js";

const MAX_RETRIES = 3;

/**
 * JSON-skjemaet et kall dekoder mot, slik det sendes videre — ubehandlet — til
 * Anthropic (`output_config.format`) eller Ollama (`format`).
 *
 * Vidt med vilje: dette laget tolker ikke skjemaet, det spør bare isClosedSchema
 * om formen, og de 30+ skriptene skriver skjemaene sine på hver sin måte — noen
 * som objektliteraler, build-translations-meta.ts med den presise
 * `ObjectJsonSchema` fra translations-schema.ts. En strammere type her ville
 * stengt noen av dem ute uten å fange en eneste feil.
 */
export type OutputSchema = object;

/** Svaret fra Ollamas /api/ps: modellene som ligger i minnet nå. */
interface OllamaPsResponse {
    models?: Array<{model?: string}>;
}

/** Kroppen vi sender til Ollamas /api/generate. */
interface OllamaGenerateBody {
    model: string;
    prompt: string;
    stream: boolean;
    options: Record<string, unknown>;
    think?: boolean;
    format?: OutputSchema;
}

/** Svaret fra Ollamas /api/generate. */
interface OllamaGenerateResponse {
    response?: string;
    done_reason?: string;
}

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
let psCache: {at: number, models: string[]} = {at: 0, models: []};
let announcedAdoption: string | null = null;

/** Modellene Ollama har lastet nå. Cachet kort, siden hvert kall spør. */
async function residentModels(): Promise<string[]> {
    const now = Date.now();
    if (now - psCache.at < PS_CACHE_MS) return psCache.models;
    let models: string[] = [];
    try {
        const response = await fetch(`${ollamaBaseUrl}/api/ps`, {signal: AbortSignal.timeout(5000)});
        const data = await response.json() as OllamaPsResponse;
        models = (data.models || []).map(entry => entry.model).filter(Boolean) as string[];
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
 *
 * Signaturen utad tar `unknown` — kallerne sender skjemaer dette laget ikke har
 * sett, og funksjonen kaller seg selv på felter den ikke vet formen på. Innsiden
 * gransker en vilkårlig JSON-verdi felt for felt, og er derfor `any`.
 */
export function isClosedSchema(schema: unknown): boolean;
export function isClosedSchema(schema: any): boolean {
    if (!schema || typeof schema !== 'object') return false;

    // enum/const binder verdien uansett hvilken type som står oppgitt
    if (Array.isArray(schema.enum) || 'const' in schema) return true;

    for (const branch of ['anyOf', 'oneOf', 'allOf'] as const) {
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

/** Valgene resolveLocalModel tar imot. `model` pinner og slår av adopsjonen. */
export interface ResolveLocalModelOptions {
    /** Eksplisitt modell. Pinnes: ingen adopsjon. */
    model?: string;
    /**
     * Skjemaet kallet skal dekode mot. Er det ÅPENT, kan en modell med
     * openSchema:false ikke adopteres.
     */
    schema?: OutputSchema;
    /**
     * Eldre form: «kallet bruker et skjema, jeg vet ikke hvilket». Behandles som
     * et åpent skjema.
     */
    needsSchema?: boolean;
}

/**
 * Modellen et lokalt kall faktisk skal bruke.
 *
 * @param task - Task-navn, se taskModels i constants.js. Uten task blir det
 *               ollamaModel, som før.
 */
export async function resolveLocalModel(
    task?: string,
    {model, schema, needsSchema = false}: ResolveLocalModelOptions = {}
): Promise<string> {
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

let anthropic: Anthropic | null = null;

function getAnthropic(): Anthropic {
    if (!anthropic) {
        anthropic = new Anthropic({apiKey: process.env.ANTHROPIC_API_KEY});
    }
    return anthropic;
}

// Med tenkning på ligger tenkeblokker først i content — teksten må hentes ut,
// ikke leses fra content[0]. Samme funksjon som i bible.mjs.
function extractText(completion: Anthropic.Message): string {
    const block = completion.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
    if (!block) {
        throw new Error(`No text block in response (stop_reason: ${completion.stop_reason})`);
    }
    return block.text;
}

async function callAnthropic(content: string, schema?: OutputSchema): Promise<string> {
    const options: Anthropic.MessageStreamParams = {
        model: anthropicModel,
        max_tokens: maxTokens,
        messages: [{role: "user", content}]
    };
    if (schema) {
        options.output_config = {format: {type: "json_schema", schema: schema as Record<string, unknown>}};
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

/** Valgene som bare gjelder det lokale (Ollama-)sporet. */
export interface CallOllamaOptions {
    /** La modellen tenke. Av som standard, se noThinkPrefix/thinkParam. */
    think?: boolean;
    /** Samplingparametre som overstyrer modellens egne. */
    ollamaOptions?: Record<string, unknown>;
    /** Pinn den lokale modellen: ingen adopsjon. */
    model?: string;
    /** Task-navn for modellvalget, se taskModels. Adopsjon kan slå inn. */
    task?: string;
}

async function callOllama(
    content: string,
    schema?: OutputSchema,
    {think = false, ollamaOptions = {}, model, task}: CallOllamaOptions = {}
): Promise<string> {
    const activeModel = await resolveLocalModel(task, {model, schema});
    const config = getOllamaConfig(activeModel);
    const body: OllamaGenerateBody = {
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
        if ((error as Error).name === 'TimeoutError' || (error as Error).name === 'AbortError') {
            throw new Error(`Ollama did not respond within ${timeoutMs / 1000}s (model: ${activeModel})`);
        }
        throw error;
    }
    const data = await response.json() as OllamaGenerateResponse;
    if (data.done_reason && data.done_reason !== 'stop') {
        throw new Error(`Ollama stopped early (done_reason: ${data.done_reason}) - response truncated`);
    }
    return data.response as string;
}

/** Valgene `call` tar imot: sporvalget pluss det lokale sporets egne. */
export interface CallOptions extends CallOllamaOptions {
    /** JSON schema for structured output */
    schema?: OutputSchema;
    /** Use Ollama instead of Anthropic */
    local?: boolean;
}

/**
 * Call LLM with optional JSON schema.
 * @param content - The prompt
 * @returns Raw text response
 */
export async function call(
    content: string,
    {schema, local, think, ollamaOptions, model, task}: CallOptions = {}
): Promise<string> {
    if (local) {
        return callOllama(content, schema, {think, ollamaOptions, model, task});
    }
    return callAnthropic(content, schema);
}

/** Valgene `callWithRetry` tar imot. */
export interface CallWithRetryOptions extends CallOptions {
    /** Context string for error messages */
    context?: string;
}

/**
 * Call LLM with retries. Returns parsed JSON if schema is provided, raw text otherwise.
 *
 * Returtypen er kallerens å oppgi: med skjema er den skjemaets form, uten skjema
 * er den `string`. Uten et typeargument står den som `any`, slik den var i JS.
 *
 * @param content - The prompt
 * @returns Parsed JSON if schema, raw text otherwise
 */
export async function callWithRetry<T = any>(
    content: string,
    {schema, local, think, ollamaOptions, model, task, context = ''}: CallWithRetryOptions = {}
): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const text = await call(content, {schema, local, think, ollamaOptions, model, task});
            return (schema ? JSON.parse(text) : text) as T;
        } catch (error) {
            lastError = error;
            if (attempt < MAX_RETRIES) {
                console.log(`  Attempt ${attempt} failed (${(error as Error).message}), retrying...`);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    }

    console.error(`Failed after ${MAX_RETRIES} attempts for ${context}`);
    throw lastError;
}

const WEB_SEARCH_TOOL: Anthropic.WebSearchTool20260209 = {type: 'web_search_20260209', name: 'web_search'};
const MAX_PAUSE_TURNS = 5;

/** En kilde søket faktisk hentet — ikke en URL modellen fant på. */
export interface WebSearchSource {
    url: string;
    title?: string;
}

/** Valgene `callWithWebSearch` tar imot. */
export interface CallWithWebSearchOptions {
    /** Cap on searches per call */
    maxUses?: number;
    /** Restrict search to these domains */
    allowedDomains?: string[];
    /** Context string for error messages */
    context?: string;
}

/**
 * Call Anthropic with the server-side web_search tool so the model can look
 * facts up instead of answering from memory.
 *
 * Node can't browse on its own, so verification has to happen on Anthropic's
 * side. Returns the answer text plus the URLs actually retrieved — a caller can
 * therefore record real sources rather than URLs the model made up.
 *
 * @param content - The prompt
 */
export async function callWithWebSearch(
    content: string,
    {maxUses = 6, allowedDomains, context = ''}: CallWithWebSearchOptions = {}
): Promise<{text: string, sources: WebSearchSource[]}> {
    const tool: Anthropic.WebSearchTool20260209 = {...WEB_SEARCH_TOOL, max_uses: maxUses};
    if (allowedDomains) tool.allowed_domains = allowedDomains;

    const messages: Anthropic.MessageParam[] = [{role: 'user', content}];
    const sources: WebSearchSource[] = [];
    const text: string[] = [];

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
        messages.push({role: 'assistant', content: completion.content as Anthropic.ContentBlockParam[]});
    }

    throw new Error(`Web search did not finish within ${MAX_PAUSE_TURNS} resumes${context ? ` for ${context}` : ''}`);
}

/**
 * Embed an array of texts via Ollama. Returns array of embedding vectors.
 * Throws if the model isn't available or returns no embeddings.
 */
export async function embedTexts(texts: string[], model: string): Promise<number[][]> {
    const response = await fetch(`${ollamaBaseUrl}/api/embed`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({model, input: texts})
    });
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Embed failed (${response.status}): ${body}`);
    }
    const data = await response.json() as {embeddings?: number[][]};
    if (!data.embeddings || !Array.isArray(data.embeddings)) {
        throw new Error(`Embed returned no embeddings: ${JSON.stringify(data).slice(0, 200)}`);
    }
    return data.embeddings;
}

/** Valgene `callOllamaRaw` tar imot. `model` pinner, `task` tillater adopsjon. */
export interface CallOllamaRawOptions {
    numPredict?: number;
    /** Pinn den lokale modellen: ingen adopsjon. */
    model?: string;
    /** Task-navn for modellvalget, se taskModels. */
    task?: string;
}

/**
 * Call Ollama directly for lightweight tasks (number extraction, classification).
 * Always uses local model, no retries, no schema parsing.
 */
export async function callOllamaRaw(
    prompt: string,
    {numPredict = 50, model, task}: CallOllamaRawOptions = {}
): Promise<string> {
    const activeModel = await resolveLocalModel(task, {model});
    const config = getOllamaConfig(activeModel);
    const body: OllamaGenerateBody = {
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
    const data = await response.json() as OllamaGenerateResponse;
    return (data.response || '').trim();
}
