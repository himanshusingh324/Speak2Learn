"use strict";

const { GoogleGenAI } = require("@google/genai");
const {
    MAX_QUESTIONS,
    RequestError,
    validatePages,
    retrieveRelevantPassages,
    questionSchema,
    evaluationSchema,
    parseStructuredResponse,
    validateGeneratedQuestions,
    validateAnswerEvaluation,
    validateQuestionForEvaluation,
    buildGenerationPrompt,
    buildEvaluationPrompt
} = require("./pdf-ai-core.js");

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ANSWER_CHARS = 12_000;
const DIAGNOSTIC_SCHEMA = {
    type: "OBJECT",
    properties: { ok: { type: "BOOLEAN" } },
    required: ["ok"],
    propertyOrdering: ["ok"]
};

class ProviderError extends Error {
    constructor(statusCode, message, diagnostic = {}) {
        super(message);
        this.name = "ProviderError";
        this.statusCode = statusCode;
        this.diagnostic = diagnostic;
    }
}

function safeModelName() {
    const model = String(process.env.GEMINI_MODEL || "").trim();
    return /^[a-zA-Z0-9._-]{1,100}$/.test(model) ? model : "unset-or-invalid";
}

function parseSdkErrorBody(error) {
    if (error?.error && typeof error.error === "object") {
        return error.error;
    }
    if (typeof error?.message === "string") {
        try {
            const parsed = JSON.parse(error.message);
            if (parsed?.error && typeof parsed.error === "object") {
                return parsed.error;
            }
        } catch {
            return {};
        }
    }
    return {};
}

function getProviderDetails(error) {
    const body = parseSdkErrorBody(error);
    const numericStatus = [
        error?.status,
        error?.statusCode,
        body?.code
    ].find(value => Number.isInteger(Number(value)) && Number(value) >= 100 && Number(value) <= 599);
    const providerCode = [body?.status, error?.code, error?.status]
        .find(value => typeof value === "string" && /^[A-Z][A-Z0-9_]{1,60}$/.test(value));
    const providerMessage = [body?.message, error?.message]
        .find(value => typeof value === "string") || "";

    return {
        httpStatus: numericStatus === undefined ? null : Number(numericStatus),
        providerCode: providerCode || "UNKNOWN",
        providerMessage,
        model: safeModelName(),
        keyConfigured: Boolean(process.env.GEMINI_API_KEY?.trim())
    };
}

function classifyProviderError(error, details = getProviderDetails(error)) {
    const message = details.providerMessage.toLowerCase();
    const code = details.providerCode;
    const status = details.httpStatus;

    if (!details.keyConfigured) {
        return {
            category: "missing_key",
            statusCode: 503,
            message: "Gemini is not configured. Add GEMINI_API_KEY to the local .env file."
        };
    }
    if (code === "API_KEY_INVALID" || /api.?key.{0,30}(invalid|not valid)|invalid api key/.test(message)) {
        return {
            category: "invalid_key",
            statusCode: 503,
            message: "Gemini rejected the API key. Replace GEMINI_API_KEY in the local .env file with a valid key from Google AI Studio."
        };
    }
    if (status === 429 || code === "RESOURCE_EXHAUSTED") {
        return {
            category: "quota_exhausted",
            statusCode: 429,
            message: "Gemini's free-tier request or token quota is exhausted. Check AI Studio rate limits and try again after reset."
        };
    }
    if (status === 404 || code === "NOT_FOUND" || /model.{0,50}(not found|unsupported|does not exist)/.test(message)) {
        return {
            category: "model_unavailable",
            statusCode: 503,
            message: "The configured Gemini model is unavailable to this API. Check GEMINI_MODEL and the model's current API availability."
        };
    }
    if (status === 401 || status === 403 || code === "PERMISSION_DENIED" || code === "UNAUTHENTICATED") {
        return {
            category: "permission_denied",
            statusCode: 503,
            message: "Gemini denied access. Verify the API key, project access, model eligibility, and Google AI Studio project."
        };
    }
    if (status === 400 || code === "INVALID_ARGUMENT" || code === "FAILED_PRECONDITION") {
        return {
            category: "invalid_request",
            statusCode: 502,
            message: "Gemini rejected the request format. Check the structured-output schema and model support."
        };
    }
    if (error?.name === "TimeoutError" || error?.name === "AbortError" ||
        /timed?\s*out|timeout/.test(message)) {
        return {
            category: "timeout",
            statusCode: 504,
            message: "Gemini did not respond before the 30-second timeout. Check the connection and try again."
        };
    }
    if (status === 500 || status === 502 || status === 503 || status === 504) {
        return {
            category: "provider_unavailable",
            statusCode: 502,
            message: "Google's Gemini API is temporarily unavailable. Check the provider status and try again later."
        };
    }
    return {
        category: "network_or_provider_error",
        statusCode: 502,
        message: "Gemini could not complete the request because of a network or provider error. Check the connection and Google API status."
    };
}

function diagnosticLog(operation, details, category, safeMessage) {
    console.error(JSON.stringify({
        event: "gemini_request_failed",
        operation,
        model: details.model,
        apiKeyConfigured: details.keyConfigured,
        httpStatus: details.httpStatus,
        providerCode: details.providerCode,
        category,
        message: safeMessage
    }));
}

function mapProviderError(error, operation = "unknown") {
    if (error instanceof RequestError) {
        if (error.statusCode >= 502) {
            const details = getProviderDetails({});
            diagnosticLog(operation, details, "malformed_or_invalid_output", error.message);
        }
        return error;
    }

    if (error instanceof ProviderError) {
        if (error.diagnostic.category && !error.diagnostic.logged) {
            const details = {
                model: error.diagnostic.model || safeModelName(),
                keyConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
                httpStatus: error.diagnostic.httpStatus ?? null,
                providerCode: error.diagnostic.providerCode || "CONFIGURATION_ERROR"
            };
            diagnosticLog(operation, details, error.diagnostic.category, error.message);
            error.diagnostic.logged = true;
        }
        return error;
    }

    const details = getProviderDetails(error);
    const classification = classifyProviderError(error, details);
    diagnosticLog(operation, details, classification.category, classification.message);
    return new ProviderError(classification.statusCode, classification.message, {
        category: classification.category,
        httpStatus: details.httpStatus,
        providerCode: details.providerCode,
        model: details.model
    });
}

function getClient() {
    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL;

    if (!apiKey || !apiKey.trim()) {
        throw new ProviderError(
            503,
            "Gemini is not configured. Add GEMINI_API_KEY to the server's local .env file.",
            { category: "missing_key", model: safeModelName(), httpStatus: null, providerCode: "MISSING_API_KEY" }
        );
    }
    if (!model || !model.trim()) {
        throw new ProviderError(
            503,
            "Gemini is not configured. Set GEMINI_MODEL in the server's local .env file.",
            { category: "missing_model", model: "unset-or-invalid", httpStatus: null, providerCode: "MISSING_MODEL" }
        );
    }

    return { client: new GoogleGenAI({ apiKey, httpOptions: { timeout: REQUEST_TIMEOUT_MS } }), model };
}

async function generateStructured({ prompt, schema, operation = "generate_content" }) {
    try {
        const { client, model } = getClient();
        const response = await client.models.generateContent({
            model,
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: schema,
                temperature: 0.2
            }
        });
        if (typeof response.text !== "string" || !response.text.trim()) {
            throw new RequestError(502, "Gemini returned an empty structured response. Try again.");
        }
        return response.text;
    } catch (error) {
        throw mapProviderError(error, operation);
    }
}

async function generateQuestions({ pages: rawPages, difficulty, count, topic = "" }, callModel = generateStructured) {
    try {
        const pages = validatePages(rawPages);
        if (!["easy", "medium", "hard"].includes(difficulty)) {
            throw new RequestError(400, "Choose an available question difficulty.");
        }
        if (!Number.isInteger(count) || count < 1 || count > MAX_QUESTIONS) {
            throw new RequestError(400, `Choose between 1 and ${MAX_QUESTIONS} questions.`);
        }
        if (typeof topic !== "string" || topic.length > 300) {
            throw new RequestError(400, "The optional topic focus is too long.");
        }

        const passages = retrieveRelevantPassages(pages, topic, 10);
        if (!passages.length) {
            throw new RequestError(422, "No relevant text passages were found in this PDF. Try a different topic or upload a text-based PDF.");
        }

        let retryFeedback = "";
        for (let attempt = 0; attempt < 2; attempt += 1) {
            const output = await callModel({
                prompt: buildGenerationPrompt(
                    passages,
                    { difficulty, count, topic: topic.trim() },
                    retryFeedback
                ),
                schema: questionSchema,
                operation: "generate_questions"
            });
            try {
                const parsed = parseStructuredResponse(output, "question");
                return validateGeneratedQuestions(parsed, passages, count, difficulty);
            } catch (error) {
                if (!(error instanceof RequestError) || error.statusCode !== 502 || attempt === 1) {
                    throw error;
                }
                retryFeedback = error.message;
            }
        }
        throw new RequestError(502, "The AI could not return verifiable questions after one correction attempt. Please try again.");
    } catch (error) {
        throw mapProviderError(error, "generate_questions");
    }
}

async function evaluateAnswer({ pages: rawPages, question: rawQuestion, answer }, callModel = generateStructured) {
    try {
        const pages = validatePages(rawPages);
        const question = validateQuestionForEvaluation(rawQuestion, pages);
        if (typeof answer !== "string" || !answer.trim() || answer.length > MAX_ANSWER_CHARS) {
            throw new RequestError(400, "Enter an answer of up to 12,000 characters before evaluating.");
        }

        const rubricText = question.rubric.map(item => item.concept).join(" ");
        const passages = retrieveRelevantPassages(
            pages,
            `${question.question} ${rubricText} ${answer.trim()}`,
            8
        );
        if (!passages.length) {
            throw new RequestError(422, "The PDF does not contain enough relevant text to evaluate this answer reliably.");
        }

        let retryFeedback = "";
        for (let attempt = 0; attempt < 2; attempt += 1) {
            const output = await callModel({
                prompt: buildEvaluationPrompt(passages, question, answer.trim(), retryFeedback),
                schema: evaluationSchema,
                operation: "evaluate_answer"
            });
            try {
                const parsed = parseStructuredResponse(output, "evaluation");
                return validateAnswerEvaluation(parsed, question, passages);
            } catch (error) {
                if (!(error instanceof RequestError) || error.statusCode !== 502 || attempt === 1) {
                    throw error;
                }
                retryFeedback = error.message;
            }
        }
        throw new RequestError(502, "The AI could not return a verifiable evaluation after one correction attempt. Please try again.");
    } catch (error) {
        throw mapProviderError(error, "evaluate_answer");
    }
}

async function runConnectivityCheck(callModel = generateStructured) {
    const output = await callModel({
        prompt: 'Return {"ok":true}. This is a connectivity test.',
        schema: DIAGNOSTIC_SCHEMA,
        operation: "connectivity_check"
    });
    let parsed;
    try {
        parsed = JSON.parse(output);
    } catch {
        throw mapProviderError(
            new RequestError(502, "Gemini returned malformed JSON during the connectivity check."),
            "connectivity_check"
        );
    }
    if (parsed?.ok !== true) {
        throw mapProviderError(
            new RequestError(502, "Gemini returned an unexpected response during the connectivity check."),
            "connectivity_check"
        );
    }
    return { model: safeModelName(), ok: true };
}

function createGeminiProvider({ generateStructured: callModel = generateStructured } = {}) {
    return {
        generateQuestions: input => generateQuestions(input, callModel),
        evaluateAnswer: input => evaluateAnswer(input, callModel)
    };
}

module.exports = {
    REQUEST_TIMEOUT_MS,
    ProviderError,
    getProviderDetails,
    classifyProviderError,
    mapProviderError,
    runConnectivityCheck,
    createGeminiProvider
};
