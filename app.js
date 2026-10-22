// Browser UI and speech-recognition controls for Speak2Learn.
// Rubric data and evaluation logic live in evaluator.js so they can be tested in Node.js.

const evaluator = window.Speak2LearnEvaluator;
const referenceEvaluator = window.Speak2LearnReferenceEvaluator;

if (!evaluator || !referenceEvaluator) {
    throw new Error("Speak2Learn evaluation helpers could not be loaded.");
}

const { questions, evaluateAnswer, MINIMUM_WORDS } = evaluator;

const select = document.querySelector("#question-select");
const practiceModeSelect = document.querySelector("#practice-mode");
const builtInQuestionControl = document.querySelector("#built-in-question-control");
const referenceWorkspace = document.querySelector("#reference-workspace");
const referenceQuestion = document.querySelector("#reference-question");
const referenceRubric = document.querySelector("#reference-rubric");
const referenceRubricStatus = document.querySelector("#reference-rubric-status");
const referenceExcerptsList = document.querySelector("#reference-excerpts-list");
const referenceExcerptsEmpty = document.querySelector("#reference-excerpts-empty");
const sampleButton = document.querySelector("#sample-button");
const transcript = document.querySelector("#transcript");
const record = document.querySelector("#record-button");
const recordLabel = document.querySelector("#record-label");
const status = document.querySelector("#transcription-status");
const validation = document.querySelector("#answer-validation");
const evaluationSection = document.querySelector("#evaluation");
const evaluationTitle = document.querySelector("#evaluation-title");
const scopeNote = document.querySelector(".scope-note");

let recognition;
let recordingState = "idle";
let sessionId = 0;
let activeSessionId = null;
let finalText = "";
let pendingStopMessage = "";
let pendingStopTone = "ready";
let recognitionError = "";
let practiceMode = "built-in";

Object.entries(questions).forEach(([key, question]) => {
    select.add(new Option(question.label, key));
});

const current = () => questions[select.value];

function isReferenceMode() {
    return practiceMode === "reference";
}

function getReferenceState() {
    return window.Speak2LearnPdfReference?.getState() || {
        phase: "idle",
        text: "",
        message: "PDF reference tools are still loading."
    };
}

function setStatus(message, tone = "ready") {
    status.textContent = message;
    status.classList.remove("recording", "error", "unavailable");

    if (tone !== "ready") {
        status.classList.add(tone);
    }
}

function updateRecordUi() {
    const isRecording = recordingState === "starting" || recordingState === "listening";
    const isStopping = recordingState === "stopping";

    record.classList.toggle("recording", isRecording);
    record.setAttribute("aria-pressed", String(isRecording));
    record.disabled = !recognition || isStopping;

    if (isStopping) {
        recordLabel.textContent = "Stopping recording…";
    } else if (isRecording) {
        recordLabel.textContent = "Recording… tap to stop";
    } else {
        recordLabel.textContent = "Start recording";
    }
}

function updateFlow(step) {
    const steps = ["choose", "answer", "review"];
    const activeIndex = steps.indexOf(step);

    document.querySelectorAll("[data-flow-step]").forEach(element => {
        const index = steps.indexOf(element.dataset.flowStep);
        element.classList.toggle("active", index <= activeIndex);
    });
}

function renderRubric(question) {
    const list = document.querySelector("#rubric-list");
    list.replaceChildren();

    question.concepts.forEach(concept => {
        const item = document.createElement("li");
        item.textContent = concept.label;
        list.append(item);
    });
}

function renderReferenceRubricGuidance() {
    const list = document.querySelector("#rubric-list");
    const guidance = [
        "A specific question linked to the PDF",
        "Reference excerpts selected by local term overlap",
        "An explicit, reviewable phrase rubric",
        "Coverage only — not semantic correctness"
    ];

    list.replaceChildren();
    guidance.forEach(text => {
        const item = document.createElement("li");
        item.textContent = text;
        list.append(item);
    });
}

function renderReferenceQuestion() {
    const questionText = referenceQuestion.value.trim();
    document.querySelector("#question-number").textContent = "PDF";
    document.querySelector("#question-text").textContent = questionText || "Ask a question about your reference PDF";
    document.querySelector("#question-context").textContent = questionText
        ? "The evaluator will only use locally selected excerpts that share meaningful terms with this question."
        : "Upload a text-based PDF, then ask a specific question. Review its extracted text and phrase rubric before evaluation.";
    renderReferenceRubricGuidance();
}

function clearReferenceExcerpts(message = "No excerpts selected yet.") {
    referenceExcerptsList.replaceChildren();
    referenceExcerptsEmpty.hidden = false;
    referenceExcerptsEmpty.textContent = message;
}

function invalidateReferenceRubric(message) {
    referenceRubric.value = "";
    referenceRubricStatus.textContent = message;
    clearReferenceExcerpts("Refresh the local rubric to select excerpts for the current question and text.");
}

function renderReferenceExcerpts(passages) {
    referenceExcerptsList.replaceChildren();
    referenceExcerptsEmpty.hidden = Boolean(passages.length);

    passages.forEach((passage, index) => {
        const item = document.createElement("li");
        const excerpt = passage.text.length > 520
            ? `${passage.text.slice(0, 520)}…`
            : passage.text;
        item.textContent = `Excerpt ${index + 1} (matched: ${passage.matchedTerms.join(", ")}): ${excerpt}`;
        referenceExcerptsList.append(item);
    });
}

function generateReferenceRubric() {
    const state = getReferenceState();

    if (!state.text.trim()) {
        referenceRubricStatus.textContent = "Upload a text-based PDF or add extracted reference text before creating a rubric.";
        clearReferenceExcerpts("No reference text is available.");
        return;
    }

    const result = referenceEvaluator.buildReferenceRubric(state.text, referenceQuestion.value);
    renderReferenceExcerpts(result.passages);
    referenceRubric.value = result.concepts.join("\n");

    if (!result.passages.length) {
        referenceRubricStatus.textContent = "No relevant excerpts were found by local term rules. Use a more specific question or review the extracted text.";
        return;
    }

    if (!result.concepts.length) {
        referenceRubricStatus.textContent = "Relevant excerpts were found, but no useful two-word phrases could be suggested. Add phrases from the excerpts manually.";
        return;
    }

    referenceRubricStatus.textContent = `Selected ${result.passages.length} relevant excerpt${result.passages.length === 1 ? "" : "s"}. Review or edit the suggested phrases before evaluating.`;
}

function showReferenceEvaluation(result) {
    document.querySelector("#readiness-score").textContent = result.score;
    evaluationTitle.textContent = "Reference phrase coverage";
    document.querySelector("#evaluation-summary").textContent =
        `Your answer matched ${result.covered.length} of ${result.rubric.length} explicit phrase rubric criteria from ${result.passages.length} selected reference excerpt${result.passages.length === 1 ? "" : "s"}.`;

    fill("#covered-list", result.covered, "No rubric phrase was matched. Different wording is not treated as incorrect.");
    fill("#missing-list", result.missing.map(phrase => `${phrase} — not matched by this local phrase rule`), "All explicit rubric phrases were matched.");
    fill(
        "#misconception-list",
        result.verificationNeeded.map(sentence => `${sentence} — could not be linked to the selected excerpts; verify it manually.`),
        "No answer sentences required further verification by the local term check."
    );

    scopeNote.textContent = "This score uses only the explicit phrase rubric shown above. It cannot understand paraphrases, establish semantic correctness, or prove that a claim is wrong.";
    evaluationSection.classList.remove("hidden");
    updateFlow("review");
    evaluationTitle.focus({ preventScroll: true });
    evaluationSection.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start"
    });
}

function evaluateReferenceAnswer() {
    const state = getReferenceState();
    const result = referenceEvaluator.evaluateReferenceAnswer({
        question: referenceQuestion.value,
        answer: transcript.value,
        referenceText: state.text,
        rubricText: referenceRubric.value
    });

    if (!result.isValid) {
        validation.textContent = result.reason;
        referenceRubricStatus.textContent = result.reason;
        return;
    }

    validation.textContent = "";
    showReferenceEvaluation(result);
}

function setPracticeMode(mode) {
    practiceMode = mode;
    const usingReference = isReferenceMode();

    stopRecording("Recording stopped because the practice mode changed.");
    referenceWorkspace.classList.toggle("hidden", !usingReference);
    builtInQuestionControl.hidden = usingReference;
    select.disabled = usingReference;
    sampleButton.disabled = usingReference;
    evaluationSection.classList.add("hidden");
    validation.textContent = "";

    if (usingReference) {
        renderReferenceQuestion();
        updateFlow("choose");
        setStatus("PDF reference mode is ready. You can still type an answer or use browser speech recognition.");
        return;
    }

    scopeNote.textContent = "This is a heuristic rubric-coverage score based on predefined phrase rules. It does not validate technical correctness or measure interview readiness.";
    showQuestion();
}

function stopRecording(message = "Recording stopped. You can edit the transcript or start again.", tone = "ready") {
    if (!recognition || !["starting", "listening"].includes(recordingState)) {
        return false;
    }

    // Invalidate results from this session before asking the browser to stop.
    // This prevents a late callback from changing a newer transcript.
    sessionId += 1;
    activeSessionId = null;
    recordingState = "stopping";
    pendingStopMessage = message;
    pendingStopTone = tone;
    updateRecordUi();
    setStatus("Stopping recording…", "recording");

    try {
        recognition.stop();
    } catch {
        finishStoppedRecording();
    }

    return true;
}

function finishStoppedRecording() {
    recordingState = "idle";
    activeSessionId = null;
    updateRecordUi();
    setStatus(pendingStopMessage || "Recording stopped. You can edit the transcript or start again.", pendingStopTone);
    pendingStopMessage = "";
    pendingStopTone = "ready";
}

function prepareAnswerChange(message) {
    const wasRecording = stopRecording(message);

    if (!wasRecording) {
        setStatus(message);
    }
}

function showQuestion({ announce = false } = {}) {
    const question = current();

    if (announce) {
        prepareAnswerChange("Question changed. Record a new answer or type one below.");
    }

    document.querySelector("#question-number").textContent = question.number;
    document.querySelector("#question-text").textContent = question.question;
    document.querySelector("#question-context").textContent = question.context;
    renderRubric(question);

    evaluationSection.classList.add("hidden");
    validation.textContent = "";
    transcript.value = "";
    updateFlow("choose");
}

function fill(id, items, fallback) {
    const list = document.querySelector(id);
    list.replaceChildren();

    (items.length ? items : [fallback]).forEach(text => {
        const item = document.createElement("li");
        item.textContent = text;
        list.append(item);
    });
}

function evaluate() {
    stopRecording("Recording stopped. Your answer has been evaluated below.");

    if (isReferenceMode()) {
        evaluateReferenceAnswer();
        return;
    }

    const result = evaluateAnswer(select.value, transcript.value);

    if (!result.isValid) {
        validation.textContent = `Please provide at least ${MINIMUM_WORDS} words before evaluating. You currently have ${result.wordCount}.`;
        transcript.focus();
        return;
    }

    validation.textContent = "";
    document.querySelector("#readiness-score").textContent = result.score;

    evaluationTitle.textContent =
        result.score >= 80
            ? "Strong rubric coverage"
            : result.score >= 50
                ? "Partial rubric coverage — add detail"
                : "Build the core explanation";

    document.querySelector("#evaluation-summary").textContent =
        `You addressed ${result.covered.length} of ${current().concepts.length} predefined rubric criteria. ` +
        (result.issues.length
            ? "Review the possible misconception below before your next attempt."
            : "No predefined misconception phrase was detected.");

    fill("#covered-list", result.covered, "Start with a concise definition of the concept.");
    fill("#missing-list", result.missing, "All predefined rubric criteria were addressed.");
    fill("#misconception-list", result.issues, "No predefined misconception phrase was detected.");

    evaluationSection.classList.remove("hidden");
    updateFlow("review");

    evaluationTitle.focus({ preventScroll: true });
    evaluationSection.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start"
    });
}

function startRecording() {
    if (!recognition || recordingState === "stopping") {
        return;
    }

    if (["starting", "listening"].includes(recordingState)) {
        stopRecording();
        return;
    }

    validation.textContent = "";
    sessionId += 1;
    activeSessionId = sessionId;
    finalText = transcript.value.trim();
    finalText = finalText ? `${finalText} ` : "";
    recognitionError = "";
    recordingState = "starting";
    updateRecordUi();
    setStatus("Starting microphone…", "recording");

    try {
        recognition.start();
    } catch {
        if (activeSessionId === sessionId) {
            recordingState = "idle";
            activeSessionId = null;
            updateRecordUi();
            setStatus("Unable to start recording. Wait a moment and try again, or type your answer.", "error");
        }
    }
}

function setupSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
        setStatus("Speech recognition is unavailable in this browser. You can type your answer instead.", "unavailable");
        updateRecordUi();
        return;
    }

    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-IN";

    recognition.onstart = () => {
        if (recordingState !== "starting" || activeSessionId !== sessionId) {
            try {
                recognition.stop();
            } catch {
                // The session has already ended.
            }
            return;
        }

        recordingState = "listening";
        updateRecordUi();
        setStatus("Listening… speak now. You can tap the button to stop.", "recording");
        updateFlow("answer");
    };

    recognition.onresult = event => {
        if (recordingState !== "listening" || activeSessionId !== sessionId) {
            return;
        }

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
        if (recordingState === "stopping") {
            finishStoppedRecording();
            return;
        }

        if (activeSessionId !== sessionId) {
            return;
        }

        recordingState = "idle";
        activeSessionId = null;
        updateRecordUi();

        if (recognitionError) {
            setStatus(recognitionError, "error");
        } else {
            setStatus("Recording ended. You can start again or edit the transcript.");
        }
    };

    recognition.onerror = event => {
        if (recordingState === "stopping" || activeSessionId !== sessionId) {
            return;
        }

        const messages = {
            "not-allowed": "Microphone access is blocked. Allow it in your browser settings, then try again. You can also type your answer.",
            "service-not-allowed": "Speech recognition is blocked by this browser. You can type your answer instead.",
            "audio-capture": "No usable microphone was found. Connect or enable one, then try again. You can also type your answer.",
            "network": "Speech recognition lost its network service. Check your connection, then try again or type your answer.",
            "no-speech": "No speech was detected. Try speaking closer to the microphone, then start again.",
            "aborted": "Recording was interrupted. You can start again or edit the transcript."
        };

        recognitionError = messages[event.error] ||
            "Speech recognition could not continue. Try again or type your answer.";
        setStatus(recognitionError, "error");
    };

    setStatus("Speech recognition is available. Start recording or type your answer.");
    updateRecordUi();
}

practiceModeSelect.addEventListener("change", () => setPracticeMode(practiceModeSelect.value));
select.addEventListener("change", () => showQuestion({ announce: true }));

referenceQuestion.addEventListener("input", () => {
    renderReferenceQuestion();
    invalidateReferenceRubric("Question changed. Refresh the local rubric before evaluating.");
});

document.querySelector("#generate-reference-button").addEventListener("click", generateReferenceRubric);

window.addEventListener("speak2learn:pdf-change", event => {
    if (isReferenceMode()) {
        invalidateReferenceRubric(event.detail.message || "Reference text changed. Refresh the local rubric before evaluating.");
    }
});

window.addEventListener("speak2learn:pdf-ready", event => {
    if (isReferenceMode()) {
        invalidateReferenceRubric(event.detail.message || "PDF reference tools are ready.");
    }
});

sampleButton.addEventListener("click", () => {
    if (isReferenceMode()) {
        return;
    }

    prepareAnswerChange("Sample answer loaded. You can edit it or record again.");
    transcript.value = current().sample;
    validation.textContent = "";
    updateFlow("answer");
});

document.querySelector("#evaluate-button").addEventListener("click", evaluate);
record.addEventListener("click", startRecording);

transcript.addEventListener("input", () => {
    if (["starting", "listening"].includes(recordingState)) {
        stopRecording("Recording stopped because the transcript was edited. You can continue typing.");
    }

    if (transcript.value.trim()) {
        updateFlow("answer");
    }
});

window.addEventListener("pagehide", () => {
    if (recognition && ["starting", "listening"].includes(recordingState)) {
        sessionId += 1;
        activeSessionId = null;
        try {
            recognition.abort();
        } catch {
            // The browser is already closing the page.
        }
    }
});

showQuestion();
setupSpeechRecognition();
