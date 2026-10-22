const test = require("node:test");
const assert = require("node:assert/strict");

const {
    MAX_PDF_BYTES,
    validatePdfFile,
    extractTextFromPdfDocument,
    describePdfError
} = require("../pdf-reference-core.js");
const {
    findRelevantPassages,
    buildReferenceRubric,
    evaluateReferenceAnswer
} = require("../reference-evaluator.js");

const referenceText = [
    "Binary search requires sorted data and compares a target with the middle element. Each iteration halves the search space.",
    "A hash table stores values using a hash function and handles collisions with a defined strategy."
].join("\n\n");
const referenceQuestion = "How does binary search compare a target?";
const referenceRubric = "sorted data\nmiddle element\nsearch space";

test("PDF selection validation accepts PDFs and rejects invalid or oversized files", () => {
    assert.equal(validatePdfFile({ name: "notes.pdf", type: "application/pdf", size: 1200 }).valid, true);
    assert.equal(validatePdfFile({ name: "notes.txt", type: "text/plain", size: 1200 }).valid, false);
    assert.equal(validatePdfFile({ name: "empty.pdf", type: "application/pdf", size: 0 }).valid, false);
    assert.equal(validatePdfFile({ name: "large.pdf", type: "application/pdf", size: MAX_PDF_BYTES + 1 }).valid, false);
});

test("text extraction returns only extractable text from a PDF document", async () => {
    const document = {
        numPages: 2,
        async getPage(pageNumber) {
            return {
                async getTextContent() {
                    return pageNumber === 1
                        ? { items: [{ str: "Local PDF text" }, { str: "is extracted safely." }] }
                        : { items: [] };
                }
            };
        }
    };

    const result = await extractTextFromPdfDocument(document);
    assert.equal(result.status, "success");
    assert.equal(result.pages.length, 1);
    assert.equal(result.text, "Local PDF text is extracted safely.");
});

test("image-only or empty PDF documents report an empty extraction state", async () => {
    const document = {
        numPages: 1,
        async getPage() {
            return { async getTextContent() { return { items: [] }; } };
        }
    };

    const result = await extractTextFromPdfDocument(document);
    assert.equal(result.status, "empty");
    assert.match(result.message, /OCR is not included/i);
});

test("PDF extraction errors explain encrypted and corrupted cases", () => {
    assert.match(describePdfError({ name: "PasswordException" }), /password-protected/i);
    assert.match(describePdfError({ name: "InvalidPDFException" }), /corrupted|valid/i);
    assert.match(describePdfError(new Error("Promise.withResolvers is not a function")), /update your browser/i);
    assert.match(describePdfError(new Error("hashOriginal.toHex is not a function")), /update your browser/i);
    assert.match(describePdfError(new Error("PDF worker failed to initialise")), /reader could not start/i);
    assert.match(describePdfError(new Error("unexpected parser failure")), /could not be read/i);
});

test("reference selection excludes unrelated blocks", () => {
    const passages = findRelevantPassages(referenceText, referenceQuestion);
    assert.equal(passages.length, 1);
    assert.match(passages[0].text, /Binary search/i);
    assert.doesNotMatch(passages[0].text, /hash table/i);
});

test("reference-rubric suggestions come from selected passages", () => {
    const result = buildReferenceRubric(referenceText, referenceQuestion);
    assert.equal(result.passages.length, 1);
    assert.ok(result.concepts.length > 0);
    assert.ok(result.concepts.every(concept => result.passages[0].text.toLowerCase().includes(concept)));
});

test("reference evaluation reports complete explicit-rubric coverage", () => {
    const answer = "Binary search needs sorted data and compares the target with the middle element. Every iteration halves the search space before searching again.";
    const result = evaluateReferenceAnswer({
        question: referenceQuestion,
        answer,
        referenceText,
        rubricText: referenceRubric
    });

    assert.equal(result.isValid, true);
    assert.equal(result.covered.length, 3);
    assert.equal(result.score, 100);
});

test("reference evaluation reports partial and absent coverage without calling answers incorrect", () => {
    const partial = evaluateReferenceAnswer({
        question: referenceQuestion,
        answer: "Binary search needs sorted data and compares the target with the middle element before choosing another direction in an array.",
        referenceText,
        rubricText: referenceRubric
    });
    const none = evaluateReferenceAnswer({
        question: referenceQuestion,
        answer: "Students organise weekly notes, discuss creative ideas, plan club meetings, and prepare presentations for classmates every semester.",
        referenceText,
        rubricText: referenceRubric
    });

    assert.equal(partial.isValid, true);
    assert.equal(partial.score, 67);
    assert.equal(partial.missing.length, 1);
    assert.equal(none.isValid, true);
    assert.equal(none.score, 0);
    assert.equal(none.covered.length, 0);
});

test("reference evaluation refuses a score without a question, linked passage, or explicit source phrase rubric", () => {
    const noQuestion = evaluateReferenceAnswer({ answer: "This answer has more than enough words to reach the minimum length required by the application today.", referenceText, rubricText: referenceRubric });
    const unrelatedQuestion = evaluateReferenceAnswer({ question: "How are planets formed?", answer: "This answer has more than enough words to reach the minimum length required by the application today.", referenceText, rubricText: referenceRubric });
    const unsupportedRubric = evaluateReferenceAnswer({ question: referenceQuestion, answer: "This answer has more than enough words to reach the minimum length required by the application today.", referenceText, rubricText: "semantic intelligence" });

    assert.equal(noQuestion.isValid, false);
    assert.equal(unrelatedQuestion.isValid, false);
    assert.equal(unsupportedRubric.isValid, false);
});
