(function (root, factory) {
    const evaluator = typeof module === "object" && module.exports
        ? require("./evaluator.js")
        : root.Speak2LearnEvaluator;
    const api = factory(evaluator);

    if (typeof module === "object" && module.exports) {
        module.exports = api;
    }

    root.Speak2LearnReferenceEvaluator = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function (evaluator) {
    "use strict";

    const { normalizeText, countWords, MINIMUM_WORDS } = evaluator;
    const STOP_WORDS = new Set([
        "about", "after", "again", "also", "among", "answer", "because", "before", "being", "between", "could", "does", "each", "from", "have", "into", "more", "most", "only", "other", "please", "should", "than", "that", "the", "their", "there", "these", "they", "this", "those", "through", "what", "when", "where", "which", "while", "with", "would", "your", "about", "explain", "describe", "reference", "document"
    ]);

    function meaningfulTokens(value) {
        return [...new Set(normalizeText(value)
            .split(" ")
            .filter(token => token.length >= 3 && !STOP_WORDS.has(token)))];
    }

    function splitReferenceBlocks(referenceText) {
        return String(referenceText || "")
            .split(/\n{2,}/)
            .map((text, index) => ({
                pageNumber: index + 1,
                text: text.replace(/\s+/g, " ").trim()
            }))
            .filter(block => block.text);
    }

    function containsToken(normalizedText, token) {
        return (` ${normalizedText} `).includes(` ${token} `);
    }

    function findRelevantPassages(referenceText, question) {
        const questionTokens = meaningfulTokens(question);

        if (!questionTokens.length) {
            return [];
        }

        const requiredMatches = questionTokens.length === 1 ? 1 : 2;

        return splitReferenceBlocks(referenceText)
            .map(block => {
                const normalizedBlock = normalizeText(block.text);
                const matchedTerms = questionTokens.filter(token => containsToken(normalizedBlock, token));
                return { ...block, matchedTerms, score: matchedTerms.length };
            })
            .filter(block => block.score >= requiredMatches)
            .sort((first, second) => second.score - first.score)
            .slice(0, 4);
    }

    function collectCandidatePhrases(passages, question) {
        const questionTokens = new Set(meaningfulTokens(question));
        const counts = new Map();

        passages.forEach(passage => {
            String(passage.text).split(/[.!?;:]+/).forEach(sentence => {
                const tokens = normalizeText(sentence).split(" ");

                for (let index = 0; index < tokens.length - 1; index += 1) {
                    const first = tokens[index];
                    const second = tokens[index + 1];

                    if (first.length < 3 || second.length < 3 || STOP_WORDS.has(first) || STOP_WORDS.has(second)) {
                        continue;
                    }

                    if (questionTokens.has(first) && questionTokens.has(second)) {
                        continue;
                    }

                    const phrase = `${first} ${second}`;
                    counts.set(phrase, (counts.get(phrase) || 0) + 1);
                }
            });
        });

        return [...counts.entries()]
            .sort((first, second) => second[1] - first[1] || first[0].localeCompare(second[0]))
            .slice(0, 5)
            .map(([phrase]) => phrase);
    }

    function parseRubric(conceptText) {
        return [...new Set(String(conceptText || "")
            .split(/\r?\n/)
            .map(line => normalizeText(line))
            .filter(line => line.split(" ").length >= 2))];
    }

    function phraseIsInPassages(phrase, passages) {
        return passages.some(passage => (` ${normalizeText(passage.text)} `).includes(` ${phrase} `));
    }

    function splitAnswerSentences(answer) {
        return String(answer || "")
            .split(/[.!?]+/)
            .map(sentence => sentence.trim())
            .filter(Boolean);
    }

    function evaluateReferenceAnswer({ question, answer, referenceText, rubricText }) {
        const wordCount = countWords(answer);
        const passages = findRelevantPassages(referenceText, question);
        const rubric = parseRubric(rubricText);

        if (!String(question || "").trim()) {
            return { isValid: false, reason: "Add a specific question about the reference PDF before evaluating." };
        }

        if (!passages.length) {
            return {
                isValid: false,
                reason: "No passages could be linked to this question by local term rules. Use a more specific question or review the extracted text.",
                passages
            };
        }

        const unsupportedRubric = rubric.filter(phrase => !phraseIsInPassages(phrase, passages));

        if (!rubric.length || unsupportedRubric.length) {
            return {
                isValid: false,
                reason: "Generate or edit a rubric using two-or-more-word phrases that appear in the selected reference excerpts.",
                passages,
                unsupportedRubric
            };
        }

        if (wordCount < MINIMUM_WORDS) {
            return {
                isValid: false,
                reason: `Provide at least ${MINIMUM_WORDS} words before evaluating. You currently have ${wordCount}.`,
                passages
            };
        }

        const normalizedAnswer = normalizeText(answer);
        const covered = rubric.filter(phrase => (` ${normalizedAnswer} `).includes(` ${phrase} `));
        const missing = rubric.filter(phrase => !covered.includes(phrase));
        const referenceTerms = new Set(passages.flatMap(passage => meaningfulTokens(passage.text)));
        const verificationNeeded = splitAnswerSentences(answer).filter(sentence => {
            const terms = meaningfulTokens(sentence);
            return terms.length >= 4 && !terms.some(term => referenceTerms.has(term));
        });
        const score = Math.max(0, Math.min(100, Math.round((covered.length / rubric.length) * 100)));

        return {
            isValid: true,
            wordCount,
            passages,
            rubric,
            covered,
            missing,
            verificationNeeded,
            score
        };
    }

    function buildReferenceRubric(referenceText, question) {
        const passages = findRelevantPassages(referenceText, question);
        return { passages, concepts: collectCandidatePhrases(passages, question) };
    }

    return {
        meaningfulTokens,
        findRelevantPassages,
        buildReferenceRubric,
        parseRubric,
        evaluateReferenceAnswer
    };
}));
