# Speak2Learn

Speak2Learn is a vanilla HTML, CSS, JavaScript, and Node.js practice tool for DBMS, Operating Systems, and DSA interview preparation. It keeps the original built-in questions and adds PDF-grounded question generation and AI answer feedback.

## Run locally

Requirements: a current Node.js installation.

```bash
npm install
```

Copy `.env.example` to `.env` if needed, then add a Gemini API key created in [Google AI Studio](https://aistudio.google.com/apikey):

```dotenv
GEMINI_API_KEY=your-key
GEMINI_MODEL=gemini-2.5-flash-lite
```

The repository's ignored local `.env` file is provided with the model preconfigured. Set or replace `GEMINI_API_KEY` only in that local file. Never put it in browser code, a response, a log, or a commit. `.env` is ignored by Git; check with `git check-ignore .env` before sharing changes.

Start the server:

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000). The Node.js backend loads `.env`, keeps the key server-side, and sends requests through Google's official [`@google/genai`](https://github.com/googleapis/js-genai) JavaScript SDK. `GEMINI_MODEL` selects the exact model used; there is no automatic paid-model fallback. The included default, `gemini-2.5-flash-lite`, is listed as a stable model in Google's [model documentation](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-lite), supports structured output, and is available on the Gemini API free tier per Google's [pricing documentation](https://ai.google.dev/gemini-api/docs/pricing). Model availability and free-tier eligibility can change; check Google's current pages before deployment.

## PDF question and answer workflow

1. Select **PDF reference mode** and upload a text-based PDF up to 10 MB.
2. PDF.js extracts text in the browser and retains each page number. Scanned/image-only PDFs are not OCR'd.
3. Optionally specify a topic, choose difficulty and question count, then generate questions.
4. The backend validates the page data, splits it into page-aware passages, and selects relevant context; it sends selected passages, not the complete document, to Gemini.
5. Review each question's source citations and question-specific rubric, then answer by typing or using the existing browser speech-recognition control.
6. The backend retrieves relevant passages again and assigns each a stable, page-aware ID. Gemini evaluates the answer against the current question's rubric and returns those IDs (and their page numbers) for supported concepts and claims. The server rejects unknown IDs or mismatched pages, then maps accepted IDs to excerpts from its own extracted PDF text. The result includes covered, partially covered, and missing concepts; supported, contradicted, and unverified answer claims; a 0–100 weighted rubric score (full credit for covered, half credit for partial, none for missing); suggested improvements; and uncertainty.

Both generation and evaluation use JSON-schema structured output and passage IDs rather than model-generated quotations. The server validates each ID and page against the passages sent for that request, then maps accepted references to excerpts from server-held PDF text. Invalid or malformed output receives at most one correction attempt; if still invalid, it is rejected rather than presented as successful. PDF text is treated as untrusted reference data, never as instructions. The design reduces unsupported responses but cannot guarantee that the model will not hallucinate or that grading is accurate.

The existing DBMS, OS, and DSA practice mode, its phrase-based evaluator, typed answers, and browser microphone workflow remain available and do not call Gemini.

## Free-tier quotas, costs, and provider errors

The default model is chosen for Google's no-cost Gemini API tier. Free access has **dynamic, project-level** limits for requests per minute, input tokens per minute, and requests per day; the actual quotas vary by model, project, region, and current Google policy. Daily limits reset on Google's schedule. Check your current limits in [AI Studio](https://aistudio.google.com/rate-limit). Repeated question generation and answer evaluation each consume requests and tokens. A quota/rate-limit response is surfaced to the student; wait for quota to reset instead of retrying repeatedly.

The application does not enable billing, upgrade a project, or silently switch models. Keep `GEMINI_MODEL` set to a model currently eligible for the free tier. Changing it to a paid model or enabling billing can incur charges under Google's terms. Google can change the free tier, model availability, and limits; no fixed quota or uninterrupted service is promised.

Missing credentials, rejected keys/model access, exhausted quota, malformed model output, timeouts, and network failures return clear errors. Requests use a 30-second timeout. The API key is never sent to the browser or included in application error responses or logs.

### Gemini connectivity diagnostic

To make one small request using the configured model and the same local `.env` key without uploading a PDF, run:

```bash
npm run diagnose:gemini
```

This uses structured JSON output and verifies that the response parses. It consumes one Gemini request and a small amount of free-tier quota. Run it once when needed; it is not part of `npm test`. Failures print a sanitized category, HTTP status, provider code, and model, never the key or provider response body. The web server logs the same safe diagnostic fields for failed generation and evaluation calls.

## Privacy and limitations

- The PDF file is read locally and is not uploaded. To generate or evaluate, the browser sends extracted page text, the question/rubric, and the answer to this local Node.js server; it sends only selected/retrieved passages with the prompt to Google's Gemini API.
- The app does not send microphone audio to its backend or Gemini. Browser speech recognition is browser-managed and may use a separate browser speech service; its privacy, support, and network requirements depend on that service. The resulting transcript is sent to Gemini if evaluated in PDF mode.
- Avoid submitting confidential, personal, or copyrighted material unless you are permitted to share it with Google. Google's current pricing page says free-tier content may be used to improve its products; review Google's [pricing](https://ai.google.dev/gemini-api/docs/pricing) and [Gemini API terms](https://ai.google.dev/gemini-api/terms) before using sensitive material.
- AI feedback is not a validated grade, proof of correctness, or substitute for a teacher. Paraphrases are requested to count, but model judgments may still be wrong. Review the PDF excerpts, missing concepts, inaccurate-claim findings, and uncertainty.
- Extracted text can be incomplete or scrambled. Password-protected/corrupted PDFs and image-only documents are not supported; OCR is not included.
- This app is intended for local learning use. The local Node server binds to `127.0.0.1`; it does not provide authentication or production-grade abuse controls.

## PDF dependency

PDF extraction uses [`pdfjs-dist`](https://www.npmjs.com/package/pdfjs-dist), the distribution of Mozilla PDF.js. Its package metadata declares the Apache-2.0 license. PDF.js is served from the local `node_modules` installation, not a CDN.

## Tests

Run the automated suite:

```bash
npm test
```

Tests use mocked Gemini responses and do not consume API quota. They cover local page-numbered PDF extraction, stable page-aware retrieval, source-grounded question/rubric validation, passage-ID and page validation, excerpts mapped from PDF text, paraphrased/complete and partial answers, contradicted and unverified claims, multiline PDF text, bounded regeneration after malformed output, provider failures, and server API behavior. This does not validate real-world model grading accuracy.

Before using with a live key, manually verify that `.env` remains ignored, check your Google AI Studio project/model quota, upload a representative text PDF in a supported browser, generate questions, inspect page citations, and evaluate typed and microphone-transcribed responses. No live Gemini request is part of the automated suite.

## Team

- Himanshu (24BCE0955)
- Nagendra (24BCE2185)
- Atharv (24BCE2002)
