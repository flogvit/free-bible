import Anthropic from '@anthropic-ai/sdk';
import {anthropicModel, maxTokens, ollamaModel, ollamaBaseUrl, getOllamaConfig} from "./constants.js";

const MAX_RETRIES = 3;

let anthropic = null;

function getAnthropic() {
    if (!anthropic) {
        anthropic = new Anthropic({apiKey: process.env.ANTHROPIC_API_KEY});
    }
    return anthropic;
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
    const completion = await getAnthropic().messages.create(options);
    if (completion.stop_reason === 'max_tokens') {
        throw new Error('Response truncated due to max_tokens limit');
    }
    return completion.content[0].text;
}

async function callOllama(content, schema, {think = false, ollamaOptions = {}, model} = {}) {
    const activeModel = model || ollamaModel;
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
 * @param {string} [options.model] - Override the local model (see getTaskModel in constants.js)
 * @returns {string} Raw text response
 */
export async function call(content, {schema, local, think, ollamaOptions, model} = {}) {
    if (local) {
        return callOllama(content, schema, {think, ollamaOptions, model});
    }
    return callAnthropic(content, schema);
}

/**
 * Call LLM with retries. Returns parsed JSON if schema is provided, raw text otherwise.
 * @param {string} content - The prompt
 * @param {object} [options]
 * @param {object} [options.schema] - JSON schema for structured output
 * @param {boolean} [options.local] - Use Ollama instead of Anthropic
 * @param {string} [options.context] - Context string for error messages
 * @returns {object|string} Parsed JSON if schema, raw text otherwise
 */
export async function callWithRetry(content, {schema, local, think, ollamaOptions, model, context = ''} = {}) {
    let lastError;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const text = await call(content, {schema, local, think, ollamaOptions, model});
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
        const completion = await getAnthropic().messages.create({
            model: anthropicModel,
            max_tokens: maxTokens,
            tools: [tool],
            messages
        });

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
export async function callOllamaRaw(prompt, {numPredict = 50} = {}) {
    const config = getOllamaConfig(ollamaModel);
    const body = {
        model: ollamaModel,
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
