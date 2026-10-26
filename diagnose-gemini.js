"use strict";

const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const { runConnectivityCheck, ProviderError } = require("./gemini-provider.js");
const { RequestError } = require("./pdf-ai-core.js");

async function main() {
    try {
        const result = await runConnectivityCheck();
        console.log(`Gemini connectivity OK. Model: ${result.model}. Structured JSON response parsed.`);
    } catch (error) {
        const diagnostic = error instanceof ProviderError ? error.diagnostic : {};
        const safeMessage = error instanceof ProviderError || error instanceof RequestError
            ? error.message
            : "Gemini connectivity check failed; raw error details are suppressed.";
        console.error(safeMessage);
        if (diagnostic.category) {
            console.error(JSON.stringify({
                category: diagnostic.category,
                model: diagnostic.model,
                httpStatus: diagnostic.httpStatus ?? null,
                providerCode: diagnostic.providerCode || "UNKNOWN"
            }));
        }
        process.exitCode = 1;
    }
}

main();
