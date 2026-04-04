import Anthropic from '@anthropic-ai/sdk';
import {anthropicModel, maxTokens, ollamaModel, ollamaBaseUrl} from "./constants.js";

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

async function callOllama(content, schema) {
    const body = {
        model: ollamaModel,
        prompt: content,
        stream: false,
        think: false,
        options: {temperature: 0, num_predict: 16384}
    };
    if (schema) {
        body.format = schema;
    }
    const response = await fetch(`${ollamaBaseUrl}/api/generate`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body)
    });
    const data = await response.json();
    return data.response;
}

/**
 * Call LLM with optional JSON schema.
 * @param {string} content - The prompt
 * @param {object} [options]
 * @param {object} [options.schema] - JSON schema for structured output
 * @param {boolean} [options.local] - Use Ollama instead of Anthropic
 * @returns {string} Raw text response
 */
export async function call(content, {schema, local} = {}) {
    if (local) {
        return callOllama(content, schema);
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
export async function callWithRetry(content, {schema, local, context = ''} = {}) {
    let lastError;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const text = await call(content, {schema, local});
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

/**
 * Call Ollama directly for lightweight tasks (number extraction, classification).
 * Always uses local model, no retries, no schema parsing.
 */
export async function callOllamaRaw(prompt, {numPredict = 50} = {}) {
    const response = await fetch(`${ollamaBaseUrl}/api/generate`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            model: ollamaModel,
            prompt,
            stream: false,
            think: false,
            options: {temperature: 0, num_predict: numPredict}
        })
    });
    const data = await response.json();
    return (data.response || '').trim();
}
