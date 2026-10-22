const test = require("node:test");
const assert = require("node:assert/strict");

const {
    MINIMUM_WORDS,
    questions,
    countWords,
    evaluateAnswer
} = require("../evaluator.js");

test("all built-in sample answers cover their full rubrics", () => {
    for (const [key, question] of Object.entries(questions)) {
        const result = evaluateAnswer(key, question.sample);

        assert.equal(result.isValid, true, `${key} sample should be valid`);
        assert.equal(result.covered.length, question.concepts.length, `${key} sample should cover every criterion`);
        assert.equal(result.score, 100, `${key} sample should score 100`);
        assert.deepEqual(result.issues, [], `${key} sample should not contain a predefined misconception`);
    }
});

test("empty and whitespace-only answers are invalid", () => {
    for (const answer of ["", " \n\t "]) {
        const result = evaluateAnswer("dbms", answer);
        assert.equal(result.isValid, false);
        assert.equal(result.wordCount, 0);
        assert.equal(result.score, 0);
    }
});

test("answers below the minimum word count are invalid", () => {
    const answer = "An index helps a database locate rows without scanning table row";
    assert.equal(countWords(answer), MINIMUM_WORDS - 1);

    const result = evaluateAnswer("dbms", answer);
    assert.equal(result.isValid, false);
    assert.equal(result.score, 0);
});

test("a partial answer reports missing concepts", () => {
    const answer = "Binary search compares a target with the middle element in a sorted array before choosing a direction.";
    const result = evaluateAnswer("dsa", answer);

    assert.equal(result.isValid, true);
    assert.equal(result.covered.length, 2);
    assert.equal(result.missing.length, 3);
    assert.equal(result.score, 40);
});

test("an irrelevant long answer earns no rubric coverage and no automatic bonus", () => {
    const answer = "I enjoy planning team meetings, writing notes, sharing ideas, and organising study schedules with classmates every week.";
    const result = evaluateAnswer("os", answer);

    assert.equal(result.isValid, true);
    assert.equal(result.covered.length, 0);
    assert.equal(result.score, 0);
    assert.deepEqual(result.issues, []);
});

test("generic words no longer trigger broad rubric matches", () => {
    const dbms = evaluateAnswer("dbms", "The index, memory, where clause, and find command are generic words used in this unrelated sentence for testing only.");
    const os = evaluateAnswer("os", "A process can hold a resource while another process follows an order and mentions a condition in this unrelated discussion.");
    const dsa = evaluateAnswer("dsa", "An array has a middle target and can move left or right during an unrelated classroom game with many steps today.");

    assert.equal(dbms.score, 0);
    assert.equal(os.score, 0);
    assert.equal(dsa.score, 0);
});

test("generic checklist language needs an explicit question topic before earning credit", () => {
    const answer = "Sorted data compares a target with the middle value, halves the search range, has O(log n), and uses random access in arrays.";
    const result = evaluateAnswer("dsa", answer);

    assert.equal(result.isValid, true);
    assert.equal(result.score, 0);
    assert.equal(result.covered.length, 0);
});

test("normalisation handles punctuation, capitalisation, and spacing variants", () => {
    const answer = "BINARY SEARCH uses a SORTED array. It COMPARES the TARGET with the MID element, then eliminates HALF the SEARCH SPACE. Its complexity is O(LOG N), and RANDOM   ACCESS is useful.";
    const result = evaluateAnswer("dsa", answer);

    assert.equal(result.isValid, true);
    assert.equal(result.score, 100);
});

test("direct misconception claims are flagged", () => {
    const answer = "Binary search works on any unsorted data and its time complexity is O(n) for every case in ordinary programs.";
    const result = evaluateAnswer("dsa", answer);

    assert.equal(result.isValid, true);
    assert.equal(result.issues.length, 1);
    assert.match(result.issues[0], /requires ordered data/i);
});

test("common linear-time wording is flagged as a possible binary-search misconception", () => {
    const answer = "Binary search requires sorted values, but binary search takes linear time for every lookup in this incorrect explanation.";
    const result = evaluateAnswer("dsa", answer);

    assert.equal(result.isValid, true);
    assert.equal(result.issues.length, 1);
    assert.match(result.issues[0], /o\(log n\)/i);
});

test("obvious corrective phrasing is not flagged as a misconception", () => {
    const answer = "It is wrong to say binary search works on unsorted data. Binary search requires sorted data and has O(log n) time.";
    const result = evaluateAnswer("dsa", answer);

    assert.equal(result.isValid, true);
    assert.deepEqual(result.issues, []);
});

test("scores stay within range and depend only on covered rubric criteria", () => {
    const partial = evaluateAnswer("dbms", "An index is a B-tree search structure that helps find rows quickly without scanning the full table during queries today.");
    const full = evaluateAnswer("dbms", questions.dbms.sample);

    assert.equal(partial.isValid, true);
    assert.equal(partial.issues.length, 0);
    assert.equal(partial.score, Math.round((partial.covered.length / questions.dbms.concepts.length) * 100));

    for (const result of [partial, full]) {
        assert.ok(result.score >= 0 && result.score <= 100);
    }
});
