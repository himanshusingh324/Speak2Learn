import * as pdfjsLib from "/vendor/pdf.mjs";

const core = window.Speak2LearnPdfCore;

if (!core) {
    throw new Error("Speak2Learn PDF helpers could not be loaded.");
}

pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf-worker.js";

const fileInput = document.querySelector("#reference-pdf");
const fileDetails = document.querySelector("#pdf-file-details");
const fileName = document.querySelector("#pdf-file-name");
const status = document.querySelector("#pdf-status");
const removeButton = document.querySelector("#remove-pdf-button");
const textArea = document.querySelector("#reference-text");

let requestId = 0;
let state = {
    phase: "idle",
    fileName: "",
    text: "",
    pages: [],
    message: "Choose a text-based PDF to create a local reference.",
    error: ""
};

function render() {
    status.textContent = state.message;
    status.className = `pdf-status ${state.phase}`;
    fileDetails.hidden = !state.fileName;
    fileName.textContent = state.fileName;
    removeButton.hidden = !state.fileName && !state.text;

    if (textArea.value !== state.text) {
        textArea.value = state.text;
    }
}

function publish(nextState) {
    state = { ...state, ...nextState };
    render();
    window.dispatchEvent(new CustomEvent("speak2learn:pdf-change", { detail: getState() }));
}

function getState() {
    return {
        ...state,
        pages: state.pages.map(page => ({ ...page }))
    };
}

function clearPdf() {
    requestId += 1;
    fileInput.value = "";
    publish({
        phase: "idle",
        fileName: "",
        text: "",
        pages: [],
        message: "Reference PDF removed. Choose another PDF or return to built-in practice.",
        error: ""
    });
}

async function loadPdf(file) {
    const validation = core.validatePdfFile(file);

    if (!validation.valid) {
        fileInput.value = "";
        publish({
            phase: "error",
            fileName: "",
            text: "",
            pages: [],
            message: validation.message,
            error: validation.message
        });
        return;
    }

    const thisRequest = ++requestId;
    publish({
        phase: "loading",
        fileName: file.name,
        text: "",
        pages: [],
        message: "Reading PDF locally in your browser…",
        error: ""
    });

    let loadingTask;
    let passwordPrompted = false;

    try {
        const data = new Uint8Array(await file.arrayBuffer());

        if (thisRequest !== requestId) {
            return;
        }

        loadingTask = pdfjsLib.getDocument({
            data,
            useWorkerFetch: false,
            isEvalSupported: false
        });
        loadingTask.onPassword = () => {
            passwordPrompted = true;
            loadingTask.destroy();
        };

        const documentProxy = await loadingTask.promise;

        if (thisRequest !== requestId) {
            return;
        }

        const result = await core.extractTextFromPdfDocument(documentProxy);

        if (thisRequest !== requestId) {
            return;
        }

        publish({
            phase: result.status,
            fileName: file.name,
            text: result.text,
            pages: result.pages,
            message: result.message,
            error: ""
        });
    } catch (error) {
        if (thisRequest !== requestId) {
            return;
        }

        const message = passwordPrompted
            ? "This PDF is encrypted or password-protected. Remove the protection and try again."
            : core.describePdfError(error);

        publish({
            phase: "error",
            fileName: file.name,
            text: "",
            pages: [],
            message,
            error: message
        });
    } finally {
        if (loadingTask) {
            await loadingTask.destroy();
        }
    }
}

fileInput.addEventListener("change", event => {
    loadPdf(event.target.files?.[0]);
});

removeButton.addEventListener("click", clearPdf);

textArea.addEventListener("input", () => {
    publish({
        text: textArea.value,
        phase: textArea.value.trim() ? "success" : "empty",
        message: textArea.value.trim()
            ? "Reference text updated locally. Refresh the local rubric before evaluating."
            : "Reference text is empty. Add text or upload a text-based PDF."
    });
});

window.Speak2LearnPdfReference = { getState, clearPdf, setReferenceText: text => publish({ text }) };
render();
window.dispatchEvent(new CustomEvent("speak2learn:pdf-ready", { detail: getState() }));
