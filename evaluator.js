(function (root, factory) {
    const api = factory();

    if (typeof module === "object" && module.exports) {
        module.exports = api;
    }

    root.Speak2LearnEvaluator = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";

    const MINIMUM_WORDS = 12;

    const questions = {
        dbms: {
            number: "01",
            label: "DBMS · Indexing",
            question: "What is database indexing, and how does it improve query performance?",
            context: "Answer as you would in a backend or database interview. Explain the trade-off as well as the benefit.",
            sample: "An index is a data structure that helps a database find rows without scanning the whole table. It works like a book index and is often implemented using a B-tree. Indexes speed up reads and WHERE queries, but they use extra storage and can slow INSERT, UPDATE, and DELETE operations because the index also needs to be maintained.",
            topicPhrases: ["index", "indexes", "indexing"],
            concepts: [
                {
                    label: "An index supports lookup without scanning every table row",
                    rule: { all: [["index", "indexes"], ["find rows", "lookup", "without scanning", "full table scan"]] }
                },
                {
                    label: "A search structure such as a B-tree can implement an index",
                    rule: { all: [["b tree", "b plus tree", "search tree"]] }
                },
                {
                    label: "Indexes improve read or query performance",
                    rule: {
                        anyOf: [
                            { all: [["speed up", "faster", "improve"], ["reads", "read", "queries", "query performance"]] },
                            { all: [["where queries", "where query"], ["faster", "speed up", "improve"]] }
                        ]
                    }
                },
                {
                    label: "Indexes require additional storage space",
                    rule: { all: [["extra storage", "additional storage", "uses storage", "takes space", "storage space"]] }
                },
                {
                    label: "Writes have an index-maintenance cost",
                    rule: {
                        anyOf: [
                            { all: [["insert", "update", "delete", "write operations"], ["maintain", "maintained", "maintenance", "overhead", "cost"]] },
                            { all: [["writes are slower", "slows writes", "slower writes"]] }
                        ]
                    }
                }
            ],
            misconceptions: [
                {
                    pattern: /\bindex(?:es)?\s+(?:stores?|contains?)\s+(?:duplicate\s+)?data\b/,
                    message: "An index is an auxiliary lookup structure; it does not replace the table itself."
                },
                {
                    pattern: /\bindex(?:es)?\s+(?:replace|replaces)\s+(?:the\s+)?table\b/,
                    message: "An index is an auxiliary lookup structure; it does not replace the table itself."
                }
            ]
        },
        os: {
            number: "02",
            label: "Operating Systems · Deadlock",
            question: "What is deadlock in an operating system, and how can it be prevented?",
            context: "Structure your response around resources, processes, and the conditions that create a deadlock.",
            sample: "Deadlock happens when two or more processes are permanently waiting for resources held by each other. The four Coffman conditions are mutual exclusion, hold and wait, no preemption, and circular wait. Prevention works by breaking at least one condition, for example by imposing a fixed order for requesting resources.",
            topicPhrases: ["deadlock"],
            concepts: [
                {
                    label: "Processes wait indefinitely for resources",
                    rule: { all: [["process", "processes"], ["wait", "waiting"], ["resource", "resources"], ["indefinitely", "permanently"]] }
                },
                {
                    label: "The resources are held by other processes",
                    rule: { all: [["resource", "resources"], ["held", "holding"], ["other process", "each other"]] }
                },
                {
                    label: "All four Coffman conditions are identified",
                    rule: { all: [["mutual exclusion"], ["hold and wait"], ["no preemption"], ["circular wait"]] }
                },
                {
                    label: "Prevention breaks at least one deadlock condition",
                    rule: { all: [["prevent", "prevention"], ["break", "breaking"], ["condition", "conditions"]] }
                },
                {
                    label: "A fixed resource-request order is a prevention method",
                    rule: { all: [["fixed order", "resource order", "resource ordering", "ordering resources"]] }
                }
            ],
            misconceptions: [
                {
                    pattern: /\bdeadlock\s+(?:is|means)\s+(?:when\s+)?(?:the\s+)?cpu\s+(?:is\s+)?slow\b/,
                    message: "Deadlock is a resource-waiting state, not simply slow execution or a crash."
                },
                {
                    pattern: /\bdeadlock\s+(?:means|is)\s+(?:that\s+)?(?:a\s+)?program\s+crashes?\b/,
                    message: "Deadlock is a resource-waiting state, not simply slow execution or a crash."
                },
                {
                    pattern: /\bdeadlock\s+(?:is|means)\s+(?:a\s+)?crash\b/,
                    message: "Deadlock is a resource-waiting state, not simply slow execution or a crash."
                }
            ]
        },
        dsa: {
            number: "03",
            label: "DSA · Binary Search",
            question: "Explain binary search and its time complexity. When should you use it?",
            context: "Make the precondition clear, then walk through how the search space changes.",
            sample: "Binary search finds a target in a sorted array by comparing it with the middle element. If the target is smaller, it searches the left half; otherwise it searches the right half. Each comparison halves the search space, so its time complexity is O(log n). It should be used when the data is sorted and random access is available.",
            topicPhrases: ["binary search"],
            concepts: [
                {
                    label: "The input data must be sorted",
                    rule: { all: [["sorted", "ordered"]] }
                },
                {
                    label: "The target is compared with the middle element",
                    rule: { all: [["target"], ["middle", "mid"], ["compare", "compares", "comparing", "comparison"]] }
                },
                {
                    label: "Each step eliminates half of the search space",
                    rule: {
                        anyOf: [
                            { all: [["half", "halves"], ["search space", "range", "interval"]] },
                            { all: [["left half"], ["right half"]] }
                        ]
                    }
                },
                {
                    label: "The time complexity is O(log n)",
                    rule: { all: [["o log n", "log n", "logarithmic time"]] }
                },
                {
                    label: "Random access is useful for binary search",
                    rule: { all: [["random access"]] }
                }
            ],
            misconceptions: [
                {
                    pattern: /\bbinary\s+search\s+(?:works?|can\s+work)\s+(?:on\s+)?(?:any\s+)?unsorted\b/,
                    message: "Binary search requires ordered data and has O(log n) time complexity, not O(n)."
                },
                {
                    pattern: /\b(?:binary\s+search\s+(?:is|has|takes)\s+(?:o\s+n|linear\s+time)|(?:binary\s+search\s+)?(?:time\s+)?complexity\s+(?:is|of)?\s*o\s+n|o\s+n\s+(?:time|complexity))\b/,
                    message: "Binary search requires ordered data and has O(log n) time complexity, not O(n)."
                }
            ]
        }
    };

    function normalizeText(value) {
        return String(value || "")
            .normalize("NFKC")
            .toLowerCase()
            .replace(/[’']/g, "")
            .replace(/[^\p{L}\p{N}]+/gu, " ")
            .trim()
            .replace(/\s+/g, " ");
    }

    function countWords(value) {
        const normalized = normalizeText(value);
        return normalized ? normalized.split(" ").length : 0;
    }

    function hasPhrase(normalizedText, phrase) {
        const normalizedPhrase = normalizeText(phrase);
        return normalizedPhrase && (` ${normalizedText} `).includes(` ${normalizedPhrase} `);
    }

    function matchesAll(normalizedText, rule) {
        return rule.all.every(group => group.some(phrase => hasPhrase(normalizedText, phrase)));
    }

    function matchesRule(normalizedText, rule) {
        if (rule.anyOf) {
            return rule.anyOf.some(option => matchesAll(normalizedText, option));
        }

        return matchesAll(normalizedText, rule);
    }

    function hasCorrectiveContext(normalizedText, index) {
        const precedingWords = normalizedText
            .slice(Math.max(0, index - 90), index)
            .split(" ")
            .slice(-10)
            .join(" ");

        return /\b(?:not|no|never|incorrect|wrong|myth|false|doesnt|dont|cannot|cant)\b/.test(precedingWords);
    }

    function findMisconceptions(normalizedText, rules) {
        return [...new Set(rules
            .filter(rule => {
                const match = rule.pattern.exec(normalizedText);
                return match && !hasCorrectiveContext(normalizedText, match.index);
            })
            .map(rule => rule.message))];
    }

    function hasTopicAnchor(normalizedText, question) {
        return question.topicPhrases.some(phrase => hasPhrase(normalizedText, phrase));
    }

    function evaluateAnswer(questionKey, answer) {
        const question = questions[questionKey];

        if (!question) {
            throw new Error("Unknown interview question.");
        }

        const normalizedText = normalizeText(answer);
        const wordCount = countWords(answer);

        if (wordCount < MINIMUM_WORDS) {
            return {
                isValid: false,
                wordCount,
                covered: [],
                missing: question.concepts.map(concept => concept.label),
                issues: [],
                score: 0
            };
        }

        // A long answer can contain generic technical terms such as "process",
        // "sorted", or "storage" without answering this particular question.
        // Require an explicit topic anchor before any criterion receives credit.
        const coveredConcepts = hasTopicAnchor(normalizedText, question)
            ? question.concepts.filter(concept => matchesRule(normalizedText, concept.rule))
            : [];
        const covered = coveredConcepts.map(concept => concept.label);
        const missing = question.concepts
            .filter(concept => !coveredConcepts.includes(concept))
            .map(concept => concept.label);
        const issues = findMisconceptions(normalizedText, question.misconceptions);
        const score = Math.max(0, Math.min(100, Math.round((covered.length / question.concepts.length) * 100)));

        return { isValid: true, wordCount, covered, missing, issues, score };
    }

    return { MINIMUM_WORDS, questions, normalizeText, countWords, evaluateAnswer };
}));
