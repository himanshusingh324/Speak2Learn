(function (root, factory) {
    const api = factory();

    if (typeof module === "object" && module.exports) {
        module.exports = api;
    }

    root.Speak2LearnPdfCore = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";

    const MAX_PDF_BYTES = 10 * 1024 * 1024;

    function validatePdfFile(file) {
        if (!file) {
            return { valid: false, message: "Choose a PDF file first." };
        }

        const hasPdfType = file.type === "application/pdf";
        const hasPdfExtension = /\.pdf$/i.test(file.name || "");

        if (!hasPdfType && !hasPdfExtension) {
            return { valid: false, message: "Choose a PDF file (.pdf)." };
        }

        if (!Number.isFinite(file.size) || file.size === 0) {
            return { valid: false, message: "This PDF is empty." };
        }

        if (file.size > MAX_PDF_BYTES) {
            return { valid: false, message: "Choose a PDF smaller than 10 MB." };
        }

        return { valid: true };
    }

    function normalisePageText(items) {
        return items
            .map(item => String(item.str || "").trim())
            .filter(Boolean)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
    }

    async function extractTextFromPdfDocument(pdfDocument) {
        const pages = [];

        for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
            const page = await pdfDocument.getPage(pageNumber);
            const content = await page.getTextContent();
            const text = normalisePageText(content.items || []);

            if (text) {
                pages.push({ pageNumber, text });
            }
        }

        const text = pages.map(page => page.text).join("\n\n");

        if (!text) {
            return {
                status: "empty",
                pages,
                text: "",
                message: "No extractable text was found. This may be a scanned, image-only, or blank PDF. OCR is not included."
            };
        }

        return {
            status: "success",
            pages,
            text,
            message: `Extracted text from ${pages.length} text-containing page${pages.length === 1 ? "" : "s"}.`
        };
    }

    function describePdfError(error) {
        const name = String(error?.name || "");
        const message = String(error?.message || "").toLowerCase();

        if (name === "PasswordException" || message.includes("password")) {
            return "This PDF is encrypted or password-protected. Remove the protection and try again.";
        }

        if (name === "InvalidPDFException" || message.includes("invalid pdf") || message.includes("xref")) {
            return "This PDF appears corrupted or is not a valid PDF.";
        }

        if (message.includes("promise.withresolvers") || message.includes("promise withresolvers")) {
            return "Your browser is missing a PDF-reader feature. Refresh this page; if the problem remains, update your browser and try again.";
        }

        if (message.includes("tohex is not a function")) {
            return "Your browser is missing a PDF-reader feature. Refresh this page; if the problem remains, update your browser and try again.";
        }

        if (message.includes("worker")) {
            return "The local PDF reader could not start. Refresh the page, then try the PDF again.";
        }

        return "The PDF could not be read. It may be corrupted or use unsupported PDF features.";
    }

    return { MAX_PDF_BYTES, validatePdfFile, extractTextFromPdfDocument, describePdfError };
}));
