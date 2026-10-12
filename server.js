const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const rootDirectory = __dirname;
const port = Number.parseInt(process.env.PORT || "3000", 10);
const maxAudioBytes = 25 * 1024 * 1024;

const staticFiles = new Map([
    ["/", ["index.html", "text/html; charset=utf-8"]],
    ["/index.html", ["index.html", "text/html; charset=utf-8"]],
    ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
    ["/app.js", ["app.js", "text/javascript; charset=utf-8"]]
]);

const audioExtensions = {
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/mp4": "mp4",
    "audio/mpeg": "mp3",
    "audio/wav": "wav"
};

function loadEnvironmentFile() {
    const envPath = path.join(rootDirectory, ".env");

    if (!fs.existsSync(envPath)) {
        return;
    }

    for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);

        if (!match || process.env[match[1]]) {
            continue;
        }

        const value = match[2].replace(/^(["'])(.*)\1$/, "$2");
        process.env[match[1]] = value;
    }
}

function sendJson(response, statusCode, body) {
    response.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
    });
    response.end(JSON.stringify(body));
}

function readRequestBody(request) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        let tooLarge = false;

        request.on("data", chunk => {
            size += chunk.length;

            if (size > maxAudioBytes) {
                tooLarge = true;
                return;
            }

            chunks.push(chunk);
        });

        request.on("end", () => {
            if (tooLarge) {
                const error = new Error("The recording is too large. Keep it under 25 MB.");
                error.statusCode = 413;
                reject(error);
                return;
            }

            resolve(Buffer.concat(chunks));
        });

        request.on("error", reject);
    });
}

function transcriptionError(body) {
    return body?.error?.message || body?.error || "OpenAI could not transcribe this recording.";
}

async function handleTranscription(request, response) {
    if (!process.env.OPENAI_API_KEY) {
        sendJson(response, 500, {
            error: "Server is missing OPENAI_API_KEY. Add it to .env and restart the server."
        });
        return;
    }

    const contentType = (request.headers["content-type"] || "")
        .split(";", 1)[0]
        .trim()
        .toLowerCase();
    const extension = audioExtensions[contentType];

    if (!extension) {
        sendJson(response, 415, {
            error: "Unsupported audio format. Use a current Chrome, Edge, or Safari browser."
        });
        return;
    }

    const audio = await readRequestBody(request);

    if (!audio.length) {
        sendJson(response, 400, { error: "No audio was received." });
        return;
    }

    const form = new FormData();
    form.append("file", new Blob([audio], { type: contentType }), `recording.${extension}`);
    form.append("model", "whisper-1");

    const language = (request.headers["x-transcript-language"] || "").toLowerCase();
    if (/^[a-z]{2}$/.test(language)) {
        form.append("language", language);
    }

    const upstream = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: form,
        signal: AbortSignal.timeout(90_000)
    });
    const body = await upstream.json().catch(() => ({}));

    if (!upstream.ok) {
        console.error("OpenAI transcription failed:", upstream.status, transcriptionError(body));
        sendJson(response, 502, { error: transcriptionError(body) });
        return;
    }

    sendJson(response, 200, { text: body.text || "" });
}

async function serveStaticFile(request, response) {
    const file = staticFiles.get(new URL(request.url, "http://localhost").pathname);

    if (!file) {
        sendJson(response, 404, { error: "Not found" });
        return;
    }

    const [fileName, contentType] = file;
    const content = await fsp.readFile(path.join(rootDirectory, fileName));

    response.writeHead(200, {
        "Content-Type": contentType,
        "X-Content-Type-Options": "nosniff"
    });
    response.end(content);
}

loadEnvironmentFile();

const server = http.createServer(async (request, response) => {
    try {
        if (request.method === "POST" && request.url === "/api/transcribe") {
            await handleTranscription(request, response);
            return;
        }

        if (request.method === "GET") {
            await serveStaticFile(request, response);
            return;
        }

        sendJson(response, 405, { error: "Method not allowed" });
    } catch (error) {
        console.error("Request failed:", error);
        sendJson(response, error.statusCode || 500, {
            error: error.statusCode ? error.message : "The server could not process this request."
        });
    }
});

server.listen(port, "127.0.0.1", () => {
    console.log(`Speak2Learn is running at http://localhost:${port}`);
});
