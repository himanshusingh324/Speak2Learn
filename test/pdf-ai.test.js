const test = require("node:test");
const assert = require("node:assert/strict");
const {
    RequestError,
    validatePages,
    retrieveRelevantPassages,
    parseStructuredResponse,
    validateGeneratedQuestions
} = require("../pdf-ai-core.js");
const {
    createGeminiProvider,
    getProviderDetails,
    classifyProviderError,
    mapProviderError,
    runConnectivityCheck
} = require("../gemini-provider.js");

const firstExcerpt = "Binary search requires sorted data and compares a target with the middle element.";
const secondExcerpt = "Each iteration halves the search space.";
const pages = [
    {
        pageNumber: 2,
        text: `${firstExcerpt} ${secondExcerpt} The process continues until the target is found.`
    },
    {
        pageNumber: 9,
        text: "Hash tables store values using a hash function and resolve collisions with a defined strategy."
    }
];
const question = {
    question: "How does binary search locate a target?",
    difficulty: "medium",
    rubric: [
        { concept: "sorted input", explanation: "The search requires sorted data.", citations: [{ passageId: "page-2-passage-1", pageNumber: 2, excerpt: firstExcerpt }] },
        { concept: "halved search space", explanation: "Each iteration reduces the remaining search space by half.", citations: [{ passageId: "page-2-passage-1", pageNumber: 2, excerpt: secondExcerpt }] }
    ],
    citations: [{ passageId: "page-2-passage-1", pageNumber: 2, excerpt: firstExcerpt }]
};

function evaluation(overrides = {}) {
    return {
        rubricResults: [
            {
                concept: "sorted input",
                status: "covered",
                feedback: "Ordered values allow comparisons to discard candidates.",
                passageRefs: [{ passageId: "page-2-passage-1", pageNumber: 2 }]
            },
            {
                concept: "halved search space",
                status: "covered",
                feedback: "Each iteration halves the remaining candidates.",
                passageRefs: [{ passageId: "page-2-passage-1", pageNumber: 2 }]
            }
        ],
        supportedClaims: [{
            claim: "The search works because the values are ordered.",
            explanation: "The passage states that binary search requires sorted data.",
            passageRefs: [{ passageId: "page-2-passage-1", pageNumber: 2 }]
        }],
        inaccurateClaims: [],
        unverifiedClaims: [],
        suggestedImprovements: ["Mention how the search space changes after a comparison."],
        uncertainty: { isUncertain: false, explanation: "The PDF describes these concepts directly." },
        ...overrides
    };
}

function mockProvider(response) {
    const requests = [];
    const provider = createGeminiProvider({
        async generateStructured(request) {
            requests.push(request);
            return typeof response === "function" ? response(request) : JSON.stringify(response);
        }
    });
    return { provider, requests };
}

test("page validation rejects duplicate, missing, and oversized PDF pages", () => {
    assert.throws(() => validatePages([]), RequestError);
    assert.throws(() => validatePages([
        { pageNumber: 1, text: "Some reference text." },
        { pageNumber: 1, text: "Duplicate page number text." }
    ]), /invalid/i);
    assert.throws(() => validatePages([{ pageNumber: 0, text: "Invalid page." }]), /invalid/i);
});

test("page-aware retrieval assigns stable IDs and preserves original page numbers", () => {
    const passages = retrieveRelevantPassages(pages, "binary search sorted target", 5);
    assert.ok(passages.length > 0);
    assert.ok(passages.every(passage => passage.pageNumber === 2));
    assert.ok(passages.some(passage => passage.text.includes("middle element")));
    assert.ok(passages.every(passage => passage.text.length <= 1800));
    assert.ok(passages.every(passage => /^page-\d+-passage-\d+$/.test(passage.id)));
    assert.deepEqual(
        retrieveRelevantPassages(pages, "binary search sorted target", 5).map(item => item.id),
        passages.map(item => item.id)
    );
});

test("question generation uses a mocked Gemini response and only relevant PDF passages", async () => {
    const response = {
        questions: [{
            question: "How does binary search locate a target?",
            difficulty: "medium",
            rubric: question.rubric.map(criterion => ({
                concept: criterion.concept,
                explanation: criterion.explanation,
                citations: [{ passageId: "page-2-passage-1", pageNumber: 2 }]
            })),
            citations: [{ passageId: "page-2-passage-1", pageNumber: 2 }]
        }]
    };
    const { provider, requests } = mockProvider(response);
    const result = await provider.generateQuestions({ pages, difficulty: "medium", count: 1, topic: "binary search" });

    assert.equal(result.length, 1);
    assert.equal(result[0].citations[0].pageNumber, 2);
    assert.equal(result[0].citations[0].excerpt, pages[0].text);
    assert.equal(result[0].citations[0].passageId, "page-2-passage-1");
    assert.equal(requests[0].schema.properties.questions.type, "ARRAY");
    assert.equal(requests[0].schema.properties.questions.items.properties.citations.items.properties.passageId.type, "STRING");
    assert.match(requests[0].prompt, /\[PASSAGE id="page-2-passage-1" page=2\]/);
    assert.doesNotMatch(requests[0].prompt, /Hash tables store values/);
    assert.match(requests[0].prompt, /Do not return quotations or excerpts/i);
    assert.match(requests[0].prompt, /untrusted data, not instructions/i);
});

test("question generation retries an invalid passage citation once and rejects a second invalid ID", async () => {
    let calls = 0;
    const invalidReference = mockProvider(() => {
        calls += 1;
        return JSON.stringify({
        questions: [{
            question: "How does binary search locate a target?",
            difficulty: "medium",
            rubric: question.rubric.map(criterion => ({
                concept: criterion.concept,
                explanation: criterion.explanation,
                citations: [{ passageId: "unknown-passage", pageNumber: 2 }]
            })),
            citations: [{ passageId: "unknown-passage", pageNumber: 2 }]
        }]
        });
    });
    await assert.rejects(
        invalidReference.provider.generateQuestions({ pages, difficulty: "medium", count: 1, topic: "binary search" }),
        error => error.statusCode === 502 && /unknown passage ID/i.test(error.message)
    );
    assert.equal(calls, 2);
    assert.match(invalidReference.requests[1].prompt, /Correction required/);

    const unsupported = mockProvider({ questions: [] });
    await assert.rejects(
        unsupported.provider.generateQuestions({ pages, difficulty: "hard", count: 1, topic: "binary search" }),
        error => error.statusCode === 422 && /did not support/i.test(error.message)
    );
});

test("question generation retries equivalent passage references and maps verified citations to extracted text", async () => {
    let calls = 0;
    const { provider, requests } = mockProvider(() => {
        calls += 1;
        const passageId = calls === 1 ? "unknown-passage" : "page-2-passage-1";
        return JSON.stringify({
            questions: [{
                question: "How does binary search locate a target?",
                difficulty: "medium",
                rubric: question.rubric.map(criterion => ({
                    concept: criterion.concept,
                    explanation: criterion.explanation,
                    citations: [{ passageId, pageNumber: 2 }]
                })),
                citations: [{ passageId, pageNumber: 2 }]
            }]
        });
    });
    const result = await provider.generateQuestions({
        pages, difficulty: "medium", count: 1, topic: "binary search"
    });
    assert.equal(calls, 2);
    assert.match(requests[1].prompt, /Correction required/);
    assert.equal(result[0].citations[0].excerpt, pages[0].text);
    assert.equal(result[0].citations[0].passageId, "page-2-passage-1");
});

test("question generation citations resolve to server passages despite multiline punctuation", async () => {
    const multilinePages = [{
        pageNumber: 4,
        text: "A queue uses FIFO ordering,\nso the first item inserted is removed first! A deque supports both ends."
    }];
    const { provider } = mockProvider({
        questions: [{
            question: "How does a queue order items?",
            difficulty: "easy",
            rubric: [
                {
                    concept: "FIFO order",
                    explanation: "The first inserted item is removed first.",
                    citations: [{ passageId: "page-4-passage-1", pageNumber: 4 }]
                },
                {
                    concept: "Removal order",
                    explanation: "The oldest item leaves first.",
                    citations: [{ passageId: "page-4-passage-1", pageNumber: 4 }]
                }
            ],
            citations: [{ passageId: "page-4-passage-1", pageNumber: 4 }]
        }]
    });
    const result = await provider.generateQuestions({
        pages: multilinePages, difficulty: "easy", count: 1, topic: "queue"
    });
    assert.equal(result[0].citations[0].excerpt, multilinePages[0].text);
});

test("answer evaluation accepts paraphrases and maps IDs to real PDF passages", async () => {
    const { provider, requests } = mockProvider(evaluation());
    const result = await provider.evaluateAnswer({
        pages,
        question,
        answer: "Because the values are ordered, each comparison can discard half of the remaining candidates."
    });

    assert.equal(result.score, 100);
    assert.deepEqual(result.coveredConcepts, ["sorted input", "halved search space"]);
    assert.equal(result.suggestedImprovements.length, 1);
    assert.equal(result.citations[0].pageNumber, 2);
    assert.equal(result.citations[0].excerpt, pages[0].text);
    assert.equal(result.supportedClaims[0].citations[0].excerpt, pages[0].text);
    assert.match(requests[0].prompt, /Accept accurate paraphrases and equivalent technical terminology/i);
    assert.match(requests[0].prompt, /PASSAGE id="page-2-passage-1" page=2/);
    assert.equal(requests[0].schema.properties.rubricResults.type, "ARRAY");
    assert.equal(requests[0].schema.properties.uncertainty.type, "OBJECT");
});

test("answer evaluation reports partial and incorrect claims with source-supported citations", async () => {
    const partial = mockProvider(evaluation({
        rubricResults: [
            {
                concept: "sorted input", status: "covered", feedback: "The answer explains why order matters.",
                passageRefs: [{ passageId: "page-2-passage-1", pageNumber: 2 }]
            },
            {
                concept: "halved search space", status: "partial",
                feedback: "It mentions the midpoint but not halving the remaining range.",
                passageRefs: [{ passageId: "page-2-passage-1", pageNumber: 2 }]
            }
        ],
        suggestedImprovements: ["Explain what happens to the remaining search space."]
    }));
    const partialResult = await partial.provider.evaluateAnswer({
        pages, question, answer: "It works on sorted values and checks a midpoint."
    });
    assert.equal(partialResult.score, 75);
    assert.deepEqual(partialResult.partiallyCoveredConcepts, ["halved search space"]);

    const incorrect = mockProvider(evaluation({
        rubricResults: [
            { concept: "sorted input", status: "missing", feedback: "The answer states the opposite requirement.", passageRefs: [] },
            { concept: "halved search space", status: "missing", feedback: "The answer does not explain this concept.", passageRefs: [] }
        ],
        inaccurateClaims: [{
            claim: "Binary search works on unsorted data.",
            explanation: "The PDF says binary search requires sorted data.",
            passageRefs: [{ passageId: "page-2-passage-1", pageNumber: 2 }]
        }]
    }));
    const incorrectResult = await incorrect.provider.evaluateAnswer({
        pages, question, answer: "Binary search works on unsorted data and removes half of the values."
    });
    assert.equal(incorrectResult.inaccurateClaims[0].citations[0].pageNumber, 2);
    assert.ok(incorrectResult.inaccurateClaims[0].citations[0].excerpt.includes(firstExcerpt));
    assert.equal(incorrectResult.score, 0);
});

test("unsupported answer claims are represented as uncertain rather than falsely declared incorrect", async () => {
    const { provider } = mockProvider(evaluation({
        supportedClaims: [],
        rubricResults: [
            { concept: "sorted input", status: "missing", feedback: "Insufficient relevant evidence.", passageRefs: [] },
            { concept: "halved search space", status: "missing", feedback: "Insufficient relevant evidence.", passageRefs: [] }
        ],
        inaccurateClaims: [],
        suggestedImprovements: [],
        unverifiedClaims: [{
            claim: "Binary search runs in constant time on every possible input.",
            explanation: "The supplied passages do not establish this performance claim."
        }],
        uncertainty: {
            isUncertain: false,
            explanation: "The PDF does not describe the claimed constant-time performance."
        }
    }));
    const result = await provider.evaluateAnswer({
        pages, question, answer: "Binary search runs in constant time on every possible input."
    });
    assert.equal(result.uncertainty.isUncertain, true);
    assert.deepEqual(result.inaccurateClaims, []);
    assert.equal(result.score, 0);
    assert.equal(result.unverifiedClaims.length, 1);
    assert.deepEqual(result.citations, []);
});

test("unknown passage IDs are rejected after one bounded regeneration attempt", async () => {
    assert.throws(() => parseStructuredResponse("not JSON", "evaluation"), error => error.statusCode === 502);

    let calls = 0;
    const badReference = mockProvider(() => {
        calls += 1;
        return JSON.stringify(evaluation({
            rubricResults: [
                {
                    concept: "sorted input", status: "covered", feedback: "Supported.",
                    passageRefs: [{ passageId: "invented-passage", pageNumber: 2 }]
                },
                evaluation().rubricResults[1]
            ]
        }));
    });
    const originalAnswer = "A sufficiently complete student answer that should remain in the editor.";
    await assert.rejects(
        badReference.provider.evaluateAnswer({ pages, question, answer: originalAnswer }),
        error => error.statusCode === 502 && /unknown passage ID/i.test(error.message)
    );
    assert.equal(calls, 2);
    assert.match(badReference.requests[1].prompt, /Correction required/);
    assert.match(badReference.requests[1].prompt, new RegExp(originalAnswer));

    const wrongPage = mockProvider(evaluation({
        rubricResults: [
            {
                concept: "sorted input", status: "covered", feedback: "Supported.",
                passageRefs: [{ passageId: "page-2-passage-1", pageNumber: 9 }]
            },
            evaluation().rubricResults[1]
        ]
    }));
    await assert.rejects(
        wrongPage.provider.evaluateAnswer({ pages, question, answer: "A sufficiently complete student answer." }),
        error => error.statusCode === 502 && /incorrect page number/i.test(error.message)
    );
});

test("multiline and punctuation-heavy passages are returned from server text, not model quotations", async () => {
    const multilinePages = [{
        pageNumber: 4,
        text: "A queue uses FIFO ordering,\nso the first item inserted is removed first! A deque supports both ends."
    }];
    const multilineQuestion = {
        question: "How does a queue order items?",
        difficulty: "easy",
        rubric: [
            { concept: "FIFO order", explanation: "First in, first out.", citations: [{ passageId: "page-4-passage-1", pageNumber: 4, excerpt: "A queue uses FIFO ordering,\nso the first item inserted is removed first!" }] },
            { concept: "Removal order", explanation: "The oldest item is removed first.", citations: [{ passageId: "page-4-passage-1", pageNumber: 4, excerpt: "the first item inserted is removed first!" }] }
        ],
        citations: [{ passageId: "page-4-passage-1", pageNumber: 4, excerpt: "A queue uses FIFO ordering,\nso the first item inserted is removed first!" }]
    };
    const { provider } = mockProvider(evaluation({
        supportedClaims: [],
        rubricResults: [
            {
                concept: "FIFO order", status: "covered", feedback: "The answer describes oldest-first order.",
                passageRefs: [{ passageId: "page-4-passage-1", pageNumber: 4 }]
            },
            {
                concept: "Removal order", status: "covered", feedback: "The answer identifies which item is removed first.",
                passageRefs: [{ passageId: "page-4-passage-1", pageNumber: 4 }]
            }
        ]
    }));
    const result = await provider.evaluateAnswer({
        pages: multilinePages, question: multilineQuestion, answer: "The oldest item leaves first."
    });
    assert.equal(result.citations[0].excerpt, multilinePages[0].text);
});

test("malformed model responses retry once and then surface a useful error", async () => {
    let calls = 0;
    const { provider } = mockProvider(() => {
        calls += 1;
        return "not JSON";
    });
    await assert.rejects(
        provider.evaluateAnswer({ pages, question, answer: "A sufficiently complete student answer." }),
        error => error.statusCode === 502 && /malformed evaluation JSON/i.test(error.message)
    );
    assert.equal(calls, 2);
});

test("provider errors explain invalid keys, free-tier quotas, timeouts, and network failures", () => {
    const previousKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = "test-key-do-not-log";
    try {
        const quota = mapProviderError({ status: 429 });
        const invalidKey = mapProviderError(Object.assign(
            new Error("API key not valid: secret content must not be forwarded."),
            { status: 400 }
        ));
        const timeout = mapProviderError(Object.assign(new Error("Timed out"), { name: "TimeoutError" }));
        const network = mapProviderError(new Error("Network unavailable"));

        assert.equal(quota.statusCode, 429);
        assert.match(quota.message, /free-tier/i);
        assert.equal(invalidKey.statusCode, 503);
        assert.match(invalidKey.message, /GEMINI_API_KEY/);
        assert.doesNotMatch(invalidKey.message, /secret content/);
        assert.equal(timeout.statusCode, 504);
        assert.match(timeout.message, /30-second timeout/i);
        assert.equal(network.statusCode, 502);
        assert.doesNotMatch(network.message, /Network unavailable/);
    } finally {
        if (previousKey === undefined) {
            delete process.env.GEMINI_API_KEY;
        } else {
            process.env.GEMINI_API_KEY = previousKey;
        }
    }
});

test("Google SDK errors expose sanitized HTTP status and provider categories", () => {
    const previousKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = "test-key-do-not-log";
    const cases = [
        [{ status: 400, message: JSON.stringify({ error: { code: 400, status: "INVALID_ARGUMENT", message: "API key not valid." } }) }, "invalid_key", 400, "INVALID_ARGUMENT"],
        [{ status: 404, message: JSON.stringify({ error: { code: 404, status: "NOT_FOUND", message: "Model was not found." } }) }, "model_unavailable", 404, "NOT_FOUND"],
        [{ status: 429, message: JSON.stringify({ error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Quota exhausted." } }) }, "quota_exhausted", 429, "RESOURCE_EXHAUSTED"],
        [{ status: 400, message: JSON.stringify({ error: { code: 400, status: "INVALID_ARGUMENT", message: "Response schema invalid." } }) }, "invalid_request", 400, "INVALID_ARGUMENT"],
        [{ status: 503, message: JSON.stringify({ error: { code: 503, status: "UNAVAILABLE", message: "Provider unavailable." } }) }, "provider_unavailable", 503, "UNAVAILABLE"]
    ];

    try {
        cases.forEach(([error, category, httpStatus, providerCode]) => {
            const details = getProviderDetails(error);
            assert.equal(details.httpStatus, httpStatus);
            assert.equal(details.providerCode, providerCode);
            assert.equal(classifyProviderError(error, details).category, category);
        });
    } finally {
        if (previousKey === undefined) {
            delete process.env.GEMINI_API_KEY;
        } else {
            process.env.GEMINI_API_KEY = previousKey;
        }
    }
});

test("safe diagnostic logging excludes key, PDF, and answer content", () => {
    const previousKey = process.env.GEMINI_API_KEY;
    const previousModel = process.env.GEMINI_MODEL;
    const previousConsoleError = console.error;
    const logs = [];
    process.env.GEMINI_API_KEY = "do-not-log-this-key";
    process.env.GEMINI_MODEL = "gemini-2.5-flash-lite";
    console.error = (...args) => logs.push(args.join(" "));

    try {
        const sensitive = "PDF FULL CONTENT AND STUDENT ANSWER";
        const error = {
            status: 400,
            message: JSON.stringify({
                error: {
                    code: 400,
                    status: "INVALID_ARGUMENT",
                    message: `Invalid request echoed ${sensitive} do-not-log-this-key`
                }
            })
        };
        const mapped = mapProviderError(error, "generate_questions");
        const logText = logs.join("\n");

        assert.equal(mapped.diagnostic.category, "invalid_request");
        assert.match(logText, /generate_questions/);
        assert.match(logText, /gemini-2\.5-flash-lite/);
        assert.match(logText, /400/);
        assert.match(logText, /INVALID_ARGUMENT/);
        assert.doesNotMatch(logText, /do-not-log-this-key|PDF FULL CONTENT|STUDENT ANSWER/);
    } finally {
        console.error = previousConsoleError;
        if (previousKey === undefined) {
            delete process.env.GEMINI_API_KEY;
        } else {
            process.env.GEMINI_API_KEY = previousKey;
        }
        if (previousModel === undefined) {
            delete process.env.GEMINI_MODEL;
        } else {
            process.env.GEMINI_MODEL = previousModel;
        }
    }
});

test("Gemini connectivity diagnostic parses mocked structured JSON without a PDF", async () => {
    const requests = [];
    const result = await runConnectivityCheck(async request => {
        requests.push(request);
        return '{"ok":true}';
    });

    assert.equal(result.ok, true);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].operation, "connectivity_check");
    assert.equal(requests[0].schema.properties.ok.type, "BOOLEAN");

    await assert.rejects(
        runConnectivityCheck(async () => "not JSON"),
        error => error.statusCode === 502 && /malformed JSON/i.test(error.message)
    );
});

test("missing API keys fail before any provider request is made", async () => {
    const previousKey = process.env.GEMINI_API_KEY;
    const previousModel = process.env.GEMINI_MODEL;
    process.env.GEMINI_API_KEY = "";
    process.env.GEMINI_MODEL = "gemini-2.5-flash-lite";

    try {
        await assert.rejects(
            createGeminiProvider().generateQuestions({ pages, difficulty: "medium", count: 1, topic: "binary search" }),
            error => error.statusCode === 503 && /GEMINI_API_KEY/.test(error.message)
        );
    } finally {
        if (previousKey === undefined) {
            delete process.env.GEMINI_API_KEY;
        } else {
            process.env.GEMINI_API_KEY = previousKey;
        }
        if (previousModel === undefined) {
            delete process.env.GEMINI_MODEL;
        } else {
            process.env.GEMINI_MODEL = previousModel;
        }
    }
});

test("question citation IDs and page numbers must match the supplied passages", () => {
    const generated = {
        questions: [{
            question: question.question,
            difficulty: question.difficulty,
            rubric: question.rubric.map(criterion => ({
                concept: criterion.concept,
                explanation: criterion.explanation,
                citations: [{ passageId: "page-2-passage-1", pageNumber: 2 }]
            })),
            citations: [{ passageId: "page-2-passage-1", pageNumber: 9 }]
        }]
    };
    const passages = retrieveRelevantPassages(pages, "binary search", 5);
    assert.throws(() => validateGeneratedQuestions(generated, passages, 1, "medium"), error =>
        error.statusCode === 502 && /incorrect page number/i.test(error.message)
    );
});
