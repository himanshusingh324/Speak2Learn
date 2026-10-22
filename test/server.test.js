const test = require("node:test");
const assert = require("node:assert/strict");
const { createServer } = require("../server.js");

async function withServer(callback) {
    const server = createServer();

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
