const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
require("dotenv").config();
const { RequestError } = require("./pdf-ai-core.js");
const { createGeminiProvider, ProviderError } = require("./gemini-provider.js");

const rootDirectory = __dirname;
const configuredPort = Number.parseInt(process.env.PORT || "3000", 10);
const port = Number.isInteger(configuredPort) && configuredPort > 0 ? configuredPort : 3000;
const MAX_REQUEST_BYTES = 4 * 1024 * 1024;

const staticFiles = new Map([
    ["/", ["index.html", "text/html; charset=utf-8"]],
    ["/index.html", ["index.html", "text/html; charset=utf-8"]],
    ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
    ["/evaluator.js", ["evaluator.js", "text/javascript; charset=utf-8"]],
    ["/pdf-reference-core.js", ["pdf-reference-core.js", "text/javascript; charset=utf-8"]],
    ["/reference-evaluator.js", ["reference-evaluator.js", "text/javascript; charset=utf-8"]],
    ["/pdf-reference.js", ["pdf-reference.js", "text/javascript; charset=utf-8"]],
    ["/pdfjs-compat.js", ["pdfjs-compat.js", "text/javascript; charset=utf-8"]],
    ["/pdf-worker.js", ["pdf-worker.js", "text/javascript; charset=utf-8"]],
    ["/vendor/pdf.mjs", ["node_modules/pdfjs-dist/build/pdf.mjs", "text/javascript; charset=utf-8"]],
    ["/vendor/pdf.worker-source.mjs", ["node_modules/pdfjs-dist/build/pdf.worker.mjs", "text/javascript; charset=utf-8"]],
    ["/app.js", ["app.js", "text/javascript; charset=utf-8"]]
]);

const securityHeaders = {
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    "Permissions-Policy": "microphone=(self)",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY"
};

function sendJson(response, statusCode, body) {
    response.writeHead(statusCode, {
        ...securityHeaders,
        "Content-Type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify(body));
}

function providerDiagnostic(error) {
    if (!(error instanceof ProviderError)) {
        return undefined;
    }
    return {
        category: error.diagnostic.category || "provider_error",
        model: error.diagnostic.model || process.env.GEMINI_MODEL || "unset",
        httpStatus: error.diagnostic.httpStatus ?? null,
        responseStatus: error.statusCode,
        providerCode: error.diagnostic.providerCode || "UNKNOWN"
    };
}

function hasSameOrigin(request) {
    try {
        return Boolean(request.headers.origin) &&
            new URL(request.headers.origin).origin === `http://${request.headers.host}`;
    } catch {
        return false;
    }
}

async function readJsonBody(request) {
    const chunks = [];
    let byteLength = 0;

    for await (const chunk of request) {
        byteLength += chunk.length;
        if (byteLength > MAX_REQUEST_BYTES) {
            throw new RequestError(413, "This request is too large. Try a shorter PDF.");
        }
        chunks.push(chunk);
    }

    try {
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
        throw new RequestError(400, "The request data is invalid. Refresh the page and try again.");
    }
}

async function serveStaticFile(request, response) {
    const pathname = new URL(request.url, "http://localhost").pathname;
    const file = staticFiles.get(pathname);

    if (!file) {
        sendJson(response, 404, { error: "Not found" });
        return;
    }

    const [fileName, contentType] = file;
    const content = await fs.readFile(path.join(rootDirectory, fileName));

    response.writeHead(200, {
        ...securityHeaders,
        "Content-Type": contentType,
    });

    if (request.method === "HEAD") {
        response.end();
        return;
    }

    response.end(content);
}

function createServer({ provider = createGeminiProvider() } = {}) {
    return http.createServer(async (request, response) => {
        try {
            const pathname = new URL(request.url, "http://localhost").pathname;

            if (request.method === "POST" &&
                (pathname === "/api/questions" || pathname === "/api/evaluate")) {
                if (!hasSameOrigin(request)) {
                    sendJson(response, 403, { error: "Cross-origin AI requests are not allowed." });
                    return;
                }
                const body = await readJsonBody(request);
                if (pathname === "/api/questions") {
                    sendJson(response, 200, { questions: await provider.generateQuestions(body) });
                    return;
                }
                if (pathname === "/api/evaluate") {
                    sendJson(response, 200, { evaluation: await provider.evaluateAnswer(body) });
                    return;
                }
            } else if (request.method === "GET" || request.method === "HEAD") {
                await serveStaticFile(request, response);
                return;
            } else {
                sendJson(response, 405, { error: "Method not allowed" });
                return;
            }
        } catch (error) {
            if (response.headersSent) {
                response.destroy();
                return;
            }
            if (error instanceof RequestError || error instanceof ProviderError) {
                const diagnostic = providerDiagnostic(error);
                sendJson(response, error.statusCode, diagnostic
                    ? { error: error.message, diagnostic }
                    : { error: error.message });
                return;
            }
            sendJson(response, 500, { error: "The server could not process this request." });
        }
    });
}

if (require.main === module) {
    createServer().listen(port, "127.0.0.1", () => {
        console.log(`Speak2Learn is running at http://localhost:${port}`);
    });
}

module.exports = { createServer, readJsonBody, hasSameOrigin, providerDiagnostic, MAX_REQUEST_BYTES };
