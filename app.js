
// ============================================================
// INTERVIEW PRACTICE APPLICATION - script.js
// Contains questions, answer evaluation, and speech recognition
// ============================================================

// 1. QUESTION DATABASE
const questions = {
    dbms: {
        number: "01",
        label: "DBMS · Indexing",
        question:
            "What is database indexing, and how does it improve query performance?",
        context:
            "Answer as you would in a backend or database interview. Explain the trade-off as well as the benefit.",
        sample:
            "An index is a data structure that helps a database find rows without scanning the whole table. It works like a book index and is often implemented using a B-tree. Indexes speed up reads and WHERE queries, but they use extra storage and can slow INSERT, UPDATE, and DELETE operations because the index also needs to be maintained.",
        concepts: [
            ["Index avoids a full table scan",
                ["index", "find", "without scanning", "full table scan"]],
            ["Uses a search structure such as a B-tree",
                ["b-tree", "btree", "data structure", "tree"]],
            ["Improves read and query performance",
                ["query performance", "faster", "speed", "reads", "where"]],
            ["Consumes extra storage",
                ["storage", "space", "memory"]],
            ["Write operations have a maintenance cost",
                ["insert", "update", "delete", "maintain", "write"]]
        ],
        mis: [
            [
                "index stores duplicate data",
                "An index is an auxiliary lookup structure; it does not replace the table itself."
            ],
            [
                "index replaces table",
                "An index is an auxiliary lookup structure; it does not replace the table itself."
            ]
        ]
    },

    os: {
        number: "02",
        label: "Operating Systems · Deadlock",
        question:
            "What is deadlock in an operating system, and how can it be prevented?",
        context:
            "Structure your response around resources, processes, and the conditions that create a deadlock.",
        sample:
            "Deadlock happens when two or more processes are permanently waiting for resources held by each other. The four Coffman conditions are mutual exclusion, hold and wait, no preemption, and circular wait. Prevention works by breaking at least one condition, for example by imposing a fixed order for requesting resources.",
        concepts: [
            ["Processes wait indefinitely for resources",
                ["process", "waiting", "resources", "indefinitely"]],
            ["Resources are held by other processes",
                ["held", "each other", "hold"]],
            ["Four Coffman conditions",
                ["coffman", "mutual exclusion", "hold and wait",
                    "no preemption", "circular wait"]],
            ["Prevention breaks at least one condition",
                ["prevent", "break", "condition"]],
            ["Resource ordering is one prevention method",
                ["order", "ordering", "fixed order"]]
        ],
        mis: [
            [
                "deadlock is when cpu is slow",
                "Deadlock is a resource-waiting state, not simply slow execution or a crash."
            ],
            [
                "deadlock means a program crashes",
                "Deadlock is a resource-waiting state, not simply slow execution or a crash."
            ]
        ]
    },

    dsa: {
        number: "03",
        label: "DSA · Binary Search",
        question:
            "Explain binary search and its time complexity. When should you use it?",
        context:
            "Make the precondition clear, then walk through how the search space changes.",
        sample:
            "Binary search finds a target in a sorted array by comparing it with the middle element. If the target is smaller, it searches the left half; otherwise it searches the right half. Each comparison halves the search space, so its time complexity is O(log n). It should be used when the data is sorted and random access is available.",
        concepts: [
            ["Input data must be sorted", ["sorted", "sort"]],
            ["Compares the target with the middle element",
                ["middle", "mid", "compare", "target"]],
            ["Eliminates half the search space each step",
                ["half", "left", "right", "search space"]],
            ["Time complexity is O(log n)",
                ["o log n", "log n", "logarithmic"]],
            ["Works best with random access",
                ["random access", "array"]]
        ],
        mis: [
            [
                "binary search works on any unsorted",
                "Binary search requires ordered data and has O(log n) time complexity, not O(n)."
            ],
            [
                "o n",
                "Binary search requires ordered data and has O(log n) time complexity, not O(n)."
            ]
        ]
    }
};


// 2. GET HTML ELEMENTS
const select = document.querySelector("#question-select");
const transcript = document.querySelector("#transcript");
const record = document.querySelector("#record-button");
const status = document.querySelector("#transcription-status");

let recognition;
let listening = false;
let finalText = "";
let recognitionError = "";


// 3. INITIALIZE QUESTION DROPDOWN
Object.entries(questions).forEach(([key, question]) => {
    select.add(new Option(question.label, key));
});

// Return the currently selected question
const current = () => questions[select.value];


// 4. DISPLAY SELECTED QUESTION
function showQuestion() {
    const q = current();

    document.querySelector("#question-number").textContent = q.number;
    document.querySelector("#question-text").textContent = q.question;
    document.querySelector("#question-context").textContent = q.context;

    // Display the rubric concepts
    document.querySelector("#rubric-list").innerHTML =
        q.concepts.map(c => `<li>${c[0]}</li>`).join("");

    // Hide old evaluation results
    document.querySelector("#evaluation").classList.add("hidden");

    // Clear the answer box
    transcript.value = "";
}


// 5. REUSABLE LIST DISPLAY FUNCTION
function fill(id, items, fallback) {
    document.querySelector(id).innerHTML =
        (items.length ? items : [fallback])
            .map(item => `<li>${item}</li>`)
            .join("");
}


// 6. EVALUATE THE USER'S ANSWER
function evaluate() {
    // Normalize the answer to lowercase
    const text = transcript.value.toLowerCase();

    // Require at least 12 words
    if (text.trim().split(/\s+/).length < 12) {
        alert("Please provide a fuller interview answer before evaluating it.");
        return;
    }

    const q = current();

    // Identify concepts with matching keywords
    const covered = q.concepts.filter(concept =>
        concept[1].some(keyword => text.includes(keyword))
    );

    // Identify concepts that were not mentioned
    const missing = q.concepts.filter(
        concept => !covered.includes(concept)
    );

    // Detect common misconceptions
    const issues = [
        ...new Set(
            q.mis
                .filter(item => text.includes(item[0]))
                .map(item => item[1])
        )
    ];

    // Calculate score: up to 85 for concepts and 15 for no detected misconception
    const score = Math.max(
        0,
        Math.round(
            (covered.length / q.concepts.length) * 85 +
            (issues.length ? 0 : 15)
        )
    );

    // Update the score display
    document.querySelector("#readiness-score").textContent = score;

    // Select a result heading
    document.querySelector("#evaluation-title").textContent =
        score >= 85
            ? "Interview-ready explanation"
            : score >= 55
                ? "Good foundation - add depth"
                : "Build the core explanation";

    // Show the evaluation summary
    document.querySelector("#evaluation-summary").textContent =
        `You addressed ${covered.length} of ${q.concepts.length} rubric concepts. ` +
        (issues.length
            ? "Review the flagged statement before your next attempt."
            : "No common misconception was detected.");

    // Populate feedback lists
    fill(
        "#covered-list",
        covered.map(c => c[0]),
        "Start with a concise definition of the concept."
    );

    fill(
        "#missing-list",
        missing.map(c => c[0]),
        "All rubric concepts were addressed."
    );

    fill(
        "#misconception-list",
        issues,
        "No common misconception detected in this answer."
    );

    // Reveal and scroll to the evaluation section
    document.querySelector("#evaluation").classList.remove("hidden");

    document.querySelector("#evaluation").scrollIntoView({
        behavior: "smooth",
        block: "start"
    });
}


// 7. TRANSCRIBE WITH THE BROWSER'S BUILT-IN SPEECH RECOGNITION
function setupSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
        status.textContent = "Speech recognition is unavailable. Use Chrome or Edge.";
        record.disabled = true;
        return;
    }

    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-IN";

    recognition.onstart = () => {
        listening = true;
        recognitionError = "";
        finalText = transcript.value.trim();
        finalText = finalText ? `${finalText} ` : "";

        record.classList.add("recording");
        status.classList.add("recording");
        document.querySelector("#record-label").textContent = "Recording… tap to stop";
        status.textContent = "Listening… speak now";
    };

    recognition.onresult = event => {
        let interimText = "";

        for (let index = event.resultIndex; index < event.results.length; index += 1) {
            const speech = event.results[index][0].transcript;

            if (event.results[index].isFinal) {
                finalText += `${speech} `;
            } else {
                interimText += speech;
            }
        }

        transcript.value = `${finalText}${interimText}`.trimStart();
        transcript.scrollTop = transcript.scrollHeight;
    };

    recognition.onend = () => {
        listening = false;
        record.classList.remove("recording");
        status.classList.remove("recording");
        document.querySelector("#record-label").textContent = "Start recording";
        status.textContent = recognitionError || "Speech recognition ready";
    };

    recognition.onerror = event => {
        const messages = {
            "not-allowed": "Microphone access is blocked. Allow it in the browser, then try again.",
            "service-not-allowed": "Speech recognition is blocked by this browser.",
            "audio-capture": "No microphone was found. Connect or enable one, then try again.",
            "network": "Speech recognition needs an internet connection.",
            "no-speech": "No speech was detected. Try speaking closer to the microphone.",
            "aborted": "Recording stopped."
        };

        recognitionError = messages[event.error] ||
            `Speech recognition error: ${event.error}`;
        status.textContent = recognitionError;
    };
}


// 8. EVENT LISTENERS

// Update the question when the dropdown changes
select.addEventListener("change", showQuestion);

// Insert the sample answer
document.querySelector("#sample-button")
    .addEventListener("click", () => {
        transcript.value = current().sample;
    });

// Evaluate the answer
document.querySelector("#evaluate-button")
    .addEventListener("click", evaluate);

// Start or stop browser speech recognition
record.addEventListener("click", () => {
    if (!recognition) {
        return;
    }

    if (listening) {
        recognition.stop();
    } else {
        try {
            recognition.start();
        } catch {
            status.textContent = "Unable to start recording. Please try again.";
        }
    }
});


// 9. START THE APPLICATION
showQuestion();
setupSpeechRecognition();
