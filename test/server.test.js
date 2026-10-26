const test = require("node:test");
const assert = require("node:assert/strict");
const { createServer } = require("../server.js");
const { ProviderError } = require("../gemini-provider.js");

async function withServer(callback, options) {
    const server = createServer(options);

    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });

    try {
        const { port } = server.address();
        await callback(`http://127.0.0.1:${port}`);
    } finally {
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
}

test("local server serves the app with response-security headers", async () => {
    await withServer(async origin => {
        const response = await fetch(`${origin}/`);

        assert.equal(response.status, 200);
        assert.match(response.headers.get("content-type"), /^text\/html/);
        assert.equal(response.headers.get("x-content-type-options"), "nosniff");
        assert.equal(response.headers.get("x-frame-options"), "DENY");
        assert.match(response.headers.get("content-security-policy"), /default-src 'self'/);
        assert.match(await response.text(), /Speak2Learn/);
    });
});

test("local server supports HEAD and has no transcription endpoint", async () => {
    await withServer(async origin => {
        const head = await fetch(`${origin}/app.js`, { method: "HEAD" });
        const worker = await fetch(`${origin}/pdf-worker.js`);
        const missingEndpoint = await fetch(`${origin}/api/transcribe`);
        const rejectedPost = await fetch(`${origin}/api/transcribe`, { method: "POST" });

        assert.equal(head.status, 200);
        assert.equal(await head.text(), "");
        assert.equal(worker.status, 200);
        assert.match(await worker.text(), /pdf\.worker-source\.mjs/);
        assert.equal(missingEndpoint.status, 404);
        assert.equal(rejectedPost.status, 405);
    });
});

test("question and evaluation API routes call the injected Gemini service", async () => {
    const calls = [];
    await withServer(async origin => {
        const questionResponse = await fetch(`${origin}/api/questions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Origin: origin },
            body: JSON.stringify({ pages: [{ pageNumber: 5, text: "Source text." }], count: 1 })
        });
        const evaluationResponse = await fetch(`${origin}/api/evaluate`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Origin: origin },
            body: JSON.stringify({ answer: "A student answer." })
        });
        const questionBody = await questionResponse.json();
        const evaluationBody = await evaluationResponse.json();

        assert.equal(questionResponse.status, 200);
        assert.equal(questionBody.questions[0].question, "A source-grounded question?");
        assert.equal(evaluationResponse.status, 200);
        assert.equal(evaluationBody.evaluation.score, 75);
        assert.equal(calls.length, 2);
        assert.equal(calls[0][1].pages[0].pageNumber, 5);
    }, {
        provider: {
            async generateQuestions(input) {
                calls.push(["questions", input]);
                return [{ question: "A source-grounded question?" }];
            },
            async evaluateAnswer(input) {
                calls.push(["evaluate", input]);
                return { score: 75 };
            }
        }
    });
});

test("provider configuration and free-tier failures are returned without key details", async () => {
    await withServer(async origin => {
        const configResponse = await fetch(`${origin}/api/questions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Origin: origin },
            body: JSON.stringify({})
        });
        const quotaResponse = await fetch(`${origin}/api/evaluate`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Origin: origin },
            body: JSON.stringify({})
        });
        const configBody = await configResponse.json();
        const quotaBody = await quotaResponse.json();

        assert.equal(configResponse.status, 503);
        assert.match(configBody.error, /GEMINI_API_KEY/);
        assert.equal(quotaResponse.status, 429);
        assert.match(quotaBody.error, /free-tier/i);
        assert.doesNotMatch(JSON.stringify({ configBody, quotaBody }), /AIza|secret-key/i);
    }, {
        provider: {
            async generateQuestions() {
                throw new ProviderError(503, "Gemini is not configured. Add GEMINI_API_KEY to the server's local .env file.");
            },
            async evaluateAnswer() {
                throw new ProviderError(429, "Gemini's free-tier request or token limit has been reached. Try again after the quota resets.");
            }
        }
    });
});

test("server rejects malformed and oversized AI request bodies", async () => {
    await withServer(async origin => {
        const malformed = await fetch(`${origin}/api/questions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Origin: origin },
            body: "{"
        });
        const oversized = await fetch(`${origin}/api/questions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Origin: origin },
            body: JSON.stringify({ padding: "x".repeat(4 * 1024 * 1024) })
        });

        assert.equal(malformed.status, 400);
        assert.equal(oversized.status, 413);
    });
});

test("AI endpoints reject requests without a same-origin browser header", async () => {
    await withServer(async origin => {
        const response = await fetch(`${origin}/api/questions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Origin: "https://attacker.example" },
            body: JSON.stringify({})
        });
        const body = await response.json();

        assert.equal(response.status, 403);
        assert.match(body.error, /Cross-origin/i);
    });
});
