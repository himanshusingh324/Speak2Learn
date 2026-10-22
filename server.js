const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const rootDirectory = __dirname;
const configuredPort = Number.parseInt(process.env.PORT || "3000", 10);
const port = Number.isInteger(configuredPort) && configuredPort > 0 ? configuredPort : 3000;

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

function createServer() {
    return http.createServer(async (request, response) => {
        try {
            if (request.method === "GET" || request.method === "HEAD") {
                await serveStaticFile(request, response);
                return;
            }

            sendJson(response, 405, { error: "Method not allowed" });
        } catch (error) {
            console.error("Request failed:", error);
            sendJson(response, 500, { error: "The server could not process this request." });
        }
    });
}

if (require.main === module) {
    createServer().listen(port, "127.0.0.1", () => {
        console.log(`Speak2Learn is running at http://localhost:${port}`);
    });
}

module.exports = { createServer };
