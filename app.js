// Browser UI and speech-recognition controls for Speak2Learn.
// Rubric data and evaluation logic live in evaluator.js so they can be tested in Node.js.

const evaluator = window.Speak2LearnEvaluator;

if (!evaluator) {
    throw new Error("Speak2Learn evaluation helpers could not be loaded.");
}

const { questions, evaluateAnswer, MINIMUM_WORDS } = evaluator;

const select = document.querySelector("#question-select");
const practiceModeSelect = document.querySelector("#practice-mode");
const builtInQuestionControl = document.querySelector("#built-in-question-control");
const referenceWorkspace = document.querySelector("#reference-workspace");
const referenceQuestion = document.querySelector("#reference-question");
const referenceRubricStatus = document.querySelector("#reference-rubric-status");
const referenceExcerptsList = document.querySelector("#reference-excerpts-list");
const referenceExcerptsEmpty = document.querySelector("#reference-excerpts-empty");
const generateAiQuestionsButton = document.querySelector("#generate-ai-questions-button");
const generatedQuestionControl = document.querySelector("#generated-question-control");
const generatedQuestionSelect = document.querySelector("#generated-question-select");
const generatedQuestionRubric = document.querySelector("#generated-question-rubric");
const generatedRubricList = document.querySelector("#generated-rubric-list");
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
let generatedQuestions = [];
let selectedGeneratedQuestion = null;
let questionRequestId = 0;
let evaluationRequestId = 0;

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

function renderReferenceQuestion() {
    const questionText = selectedGeneratedQuestion?.question || "";
    document.querySelector("#question-number").textContent = "PDF";
    document.querySelector("#question-text").textContent = questionText || "Generate a question from your reference PDF";
    document.querySelector("#question-context").textContent = questionText
        ? `AI-generated ${selectedGeneratedQuestion.difficulty} question. Answer in your own words; its source citations are checked against the PDF.`
        : "Upload a text-based PDF, choose a difficulty and question count, then generate source-grounded questions.";

    const list = document.querySelector("#rubric-list");
    list.replaceChildren();
    (selectedGeneratedQuestion?.rubric || []).forEach(criterion => {
        const item = document.createElement("li");
        item.textContent = criterion.concept;
        list.append(item);
    });

    generatedRubricList.replaceChildren();
    (selectedGeneratedQuestion?.rubric || []).forEach(criterion => {
        const item = document.createElement("li");
        item.textContent = `${criterion.concept}: ${criterion.explanation}`;
        generatedRubricList.append(item);
    });
    generatedQuestionRubric.classList.toggle("hidden", !selectedGeneratedQuestion);
}

function clearReferenceExcerpts(message = "No excerpts selected yet.") {
    referenceExcerptsList.replaceChildren();
    referenceExcerptsEmpty.hidden = false;
    referenceExcerptsEmpty.textContent = message;
}

function invalidateReferenceRubric(message) {
    questionRequestId += 1;
    evaluationRequestId += 1;
    generateAiQuestionsButton.disabled = false;
    document.querySelector("#evaluate-button").disabled = false;
    generatedQuestions = [];
    selectedGeneratedQuestion = null;
    generatedQuestionSelect.replaceChildren();
    generatedQuestionControl.classList.add("hidden");
    generatedQuestionRubric.classList.add("hidden");
    referenceRubricStatus.textContent = message;
    clearReferenceExcerpts("Generate questions to see excerpts from the PDF.");
    if (isReferenceMode()) {
        renderReferenceQuestion();
        evaluationSection.classList.add("hidden");
    }
}

function renderReferenceExcerpts(passages) {
    referenceExcerptsList.replaceChildren();
    referenceExcerptsEmpty.hidden = Boolean(passages.length);

    passages.forEach(passage => {
        const item = document.createElement("li");
        const text = passage.excerpt || passage.text || "";
        const excerpt = text.length > 520 ? `${text.slice(0, 520)}…` : text;
        item.textContent = `Page ${passage.pageNumber}: ${excerpt}`;
        referenceExcerptsList.append(item);
    });
}

async function generateAiQuestions() {
    const state = getReferenceState();

    if (!state.pages.length) {
        referenceRubricStatus.textContent = "Upload a text-based PDF before generating questions.";
        clearReferenceExcerpts("No reference text is available.");
        return;
    }

    generateAiQuestionsButton.disabled = true;
    const thisRequestId = ++questionRequestId;
    referenceRubricStatus.textContent = "Finding relevant PDF passages and generating questions with Gemini…";
    clearReferenceExcerpts("Waiting for generated questions.");
    try {
        const response = await fetch("/api/questions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                pages: state.pages,
                difficulty: document.querySelector("#question-difficulty").value,
                count: Number(document.querySelector("#question-count").value),
                topic: referenceQuestion.value.trim()
            })
        });
        const result = await response.json();
        if (!response.ok) {
            const diagnostic = result.diagnostic
                ? ` [${result.diagnostic.category}; ${result.diagnostic.model}; provider HTTP ${result.diagnostic.httpStatus ?? "not reached"}; app HTTP ${result.diagnostic.responseStatus}; ${result.diagnostic.providerCode}]`
                : "";
            throw new Error(`${result.error || "Question generation failed. Please try again."}${diagnostic}`);
        }
        if (thisRequestId !== questionRequestId || !isReferenceMode()) {
            return;
        }

        generatedQuestions = result.questions;
        generatedQuestionSelect.replaceChildren();
        generatedQuestions.forEach((question, index) => {
            generatedQuestionSelect.add(new Option(`${index + 1}. ${question.question}`, String(index)));
        });
        generatedQuestionControl.classList.remove("hidden");
        selectedGeneratedQuestion = generatedQuestions[0] || null;
        renderReferenceQuestion();
        renderReferenceExcerpts(selectedGeneratedQuestion?.citations || []);
        referenceRubricStatus.textContent = `Generated ${generatedQuestions.length} question${generatedQuestions.length === 1 ? "" : "s"} grounded in the PDF. Review their cited excerpts and rubric before answering.`;
        evaluationSection.classList.add("hidden");
        transcript.value = "";
        updateFlow("choose");
    } catch (error) {
        if (thisRequestId === questionRequestId) {
            referenceRubricStatus.textContent = error.message || "Question generation failed. Check your connection and try again.";
            clearReferenceExcerpts("No verified excerpts are available.");
        }
    } finally {
        if (thisRequestId === questionRequestId) {
            generateAiQuestionsButton.disabled = false;
        }
    }
}

function showReferenceEvaluation(result) {
    document.querySelector("#readiness-score").textContent = result.score;
    evaluationTitle.textContent = "AI answer evaluation";
    document.querySelector("#evaluation-summary").textContent =
        `Gemini assessed your response against ${selectedGeneratedQuestion.rubric.length} PDF-derived rubric concepts. Review the supporting citations and uncertainty below.`;

    fill(
        "#covered-list",
        result.rubricResults.filter(item => item.status === "covered")
            .map(item => `${item.concept} — ${item.feedback}`),
        "No rubric concepts were fully covered."
    );
    fill(
        "#partial-list",
        result.rubricResults.filter(item => item.status === "partial")
            .map(item => `${item.concept} — ${item.feedback}`),
        "No rubric concepts were marked partially covered."
    );
    fill(
        "#missing-list",
        result.rubricResults.filter(item => item.status === "missing")
            .map(item => `${item.concept} — ${item.feedback}`),
        "All rubric concepts were addressed."
    );
    fill(
        "#supported-list",
        result.supportedClaims.map(item => `${item.claim} — ${item.explanation}`),
        "No separate answer claims were verified against the supplied passages."
    );
    fill(
        "#misconception-list",
        result.inaccurateClaims.map(item => `${item.claim} — ${item.explanation}`),
        "No claims were identified as contradicted by the supplied PDF passages."
    );
    fill(
        "#unverified-list",
        result.unverifiedClaims.map(item => `${item.claim} — ${item.explanation}`),
        "No answer claims were identified as unverified."
    );
    document.querySelector("#improvements-panel").classList.toggle("hidden", !result.suggestedImprovements.length);
    fill("#improvements-list", result.suggestedImprovements, "No additional improvement was suggested.");
    document.querySelector("#evaluation-uncertainty").textContent = result.uncertainty.isUncertain
        ? `Uncertainty: ${result.uncertainty.explanation}`
        : result.uncertainty.explanation || "No specific uncertainty was reported; this does not guarantee correctness.";

    const uniqueCitations = [...new Map(result.citations.map(citation =>
        [citation.passageId, citation]
    )).values()];
    const citationsSection = document.querySelector("#evaluation-citations");
    citationsSection.classList.toggle("hidden", uniqueCitations.length === 0);
    const citationsList = document.querySelector("#evaluation-citations-list");
    citationsList.replaceChildren();
    uniqueCitations.forEach(citation => {
        const item = document.createElement("li");
        item.textContent = `Page ${citation.pageNumber}: ${citation.excerpt}`;
        citationsList.append(item);
    });

    scopeNote.textContent = "AI feedback is an estimate, not a validated grade. It may miss errors or misread context; inspect the cited PDF excerpts. Accurate paraphrases are intended to count.";
    evaluationSection.classList.remove("hidden");
    updateFlow("review");
    evaluationTitle.focus({ preventScroll: true });
    evaluationSection.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start"
    });
}

async function evaluateReferenceAnswer() {
    const state = getReferenceState();
    if (!selectedGeneratedQuestion) {
        validation.textContent = "Generate and select a question from the PDF before evaluating.";
        return;
    }
    if (!state.pages.length) {
        validation.textContent = "Upload a readable PDF before evaluating this answer.";
        return;
    }

    const evaluateButton = document.querySelector("#evaluate-button");
    evaluateButton.disabled = true;
    const thisRequestId = ++evaluationRequestId;
    const evaluatedQuestion = selectedGeneratedQuestion;
    validation.textContent = "Evaluating your answer against the PDF…";
    try {
        const response = await fetch("/api/evaluate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                pages: state.pages,
                question: selectedGeneratedQuestion,
                answer: transcript.value
            })
        });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || "Answer evaluation failed. Please try again.");
        }
        if (thisRequestId !== evaluationRequestId || selectedGeneratedQuestion !== evaluatedQuestion || !isReferenceMode()) {
            return;
        }
        validation.textContent = "";
        showReferenceEvaluation(result.evaluation);
    } catch (error) {
        if (thisRequestId === evaluationRequestId) {
            validation.textContent = error.message || "Answer evaluation failed. Check your connection and try again.";
        }
    } finally {
        if (thisRequestId === evaluationRequestId) {
            evaluateButton.disabled = false;
        }
    }
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
        invalidateReferenceRubric("Upload a PDF and generate questions to begin PDF practice.");
        updateFlow("choose");
        setStatus("PDF AI practice is ready. Type your answer or use browser speech recognition.");
        return;
    }

    document.querySelector("#improvements-panel").classList.add("hidden");
    document.querySelector("#evaluation-uncertainty").textContent = "";
    document.querySelector("#evaluation-citations").classList.add("hidden");
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

async function evaluate() {
    stopRecording("Recording stopped. Your answer has been evaluated below.");

    if (isReferenceMode()) {
        await evaluateReferenceAnswer();
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
    fill("#partial-list", [], "Partial coverage is only available in PDF rubric evaluation.");
    fill("#missing-list", result.missing, "All predefined rubric criteria were addressed.");
    fill("#supported-list", [], "Claim verification is only available in PDF practice.");
    fill("#misconception-list", result.issues, "No predefined misconception phrase was detected.");
    fill("#unverified-list", [], "Claim verification is only available in PDF practice.");

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
    invalidateReferenceRubric("Topic focus changed. Generate questions again to use the updated topic.");
});

generateAiQuestionsButton.addEventListener("click", generateAiQuestions);

generatedQuestionSelect.addEventListener("change", () => {
    selectedGeneratedQuestion = generatedQuestions[Number(generatedQuestionSelect.value)] || null;
    renderReferenceQuestion();
    renderReferenceExcerpts(selectedGeneratedQuestion?.citations || []);
    evaluationSection.classList.add("hidden");
    validation.textContent = "";
    transcript.value = "";
});

window.addEventListener("speak2learn:pdf-change", event => {
    if (isReferenceMode()) {
        invalidateReferenceRubric(event.detail.message || "PDF changed. Generate new questions before evaluating.");
    }
});

window.addEventListener("speak2learn:pdf-ready", event => {
    if (isReferenceMode()) {
        invalidateReferenceRubric(event.detail.message || "PDF tools are ready.");
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
