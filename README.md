# Speak2Learn

Speak2Learn is a vanilla HTML, CSS, and JavaScript practice tool for technical placement interviews. Choose a DBMS, Operating Systems, or DSA question, answer aloud or by typing, and compare the answer with a predefined rubric.

It is a rule-based practice tool. It does not use AI, machine learning, an API key, a database, or a paid transcription service.

## Features

- Three placement-oriented questions: DBMS indexing, OS deadlock, and binary search
- Browser-provided speech recognition in browsers that support `SpeechRecognition` or `webkitSpeechRecognition`
- Editable transcript and complete typed-answer fallback
- Predefined rubric coverage, missing concepts, and conservative possible-misconception flags
- PDF-reference mode: local text extraction, editable reference text, selected excerpts, and an explicit reviewable phrase rubric
- Sample answers for repeatable demonstrations
- Accessible recording status, inline short-answer feedback, and keyboard-focusable evaluation results

## Run locally

Requirements: a current Node.js installation.

Install the single browser PDF dependency once:

```bash
npm install
```

```bash
npm start
```

Then open [http://localhost:3000](http://localhost:3000) in a supported browser. The local server only serves the application files; it does not send audio to a server or require an environment file.

## PDF reference mode

Choose **PDF reference mode**, upload a text-based PDF up to 10 MB, add a specific question, then choose **Find relevant excerpts and suggest rubric phrases**. PDF.js reads the file entirely in the browser. The Node server receives no PDF bytes, extracted text, question, or answer.

- The upload status shows the selected filename, loading, success, empty-text, and error states. **Remove PDF and text** clears the browser-side reference.
- Extracted text is displayed in an editable textarea so the student can correct extraction errors before making a rubric.
- Scanned, image-only, blank, encrypted/password-protected, and corrupted PDFs are not treated as readable. Speak2Learn has no OCR, password entry, or image-understanding feature.
- Relevant excerpts are selected only when they overlap with meaningful terms from the student's question. The app does not score an answer when no excerpt can be linked by those rules.

### Reference scoring limitation

PDF mode does not claim semantic comparison. It first shows an explicit phrase rubric from the selected excerpts; the student can review or edit it, but every phrase must occur in those excerpts. Coverage is calculated only from those explicit phrases:

```text
round((matched explicit phrases / total explicit phrases) × 100)
```

Different wording is shown as “not matched by this local phrase rule,” never as automatically incorrect. Statements with no local term link to the selected excerpts are marked for manual verification, not declared false. The feature cannot understand paraphrases, establish technical correctness, or evaluate scanned PDF images.

### Dependency and licensing

PDF extraction uses [`pdfjs-dist`](https://www.npmjs.com/package/pdfjs-dist) `6.4.299`, the distribution of Mozilla PDF.js. Its package metadata declares the Apache-2.0 license; the project is documented by [Mozilla PDF.js](https://mozilla.github.io/pdf.js/getting_started/?lang=en), and its source license is available in the [PDF.js repository](https://github.com/mozilla/pdf.js/blob/master/LICENSE). PDF.js is served from the local `node_modules` installation rather than a CDN.

## Speech-recognition limitations

Speech recognition is a browser feature, not a Speak2Learn service. Support, language coverage, privacy behaviour, and network requirements depend on the browser and its configured speech service.

- Use a current Chrome or Edge browser for the best chance of support.
- Allow microphone access when prompted.
- If permission is denied, no microphone is available, the speech service is unavailable, or the browser is unsupported, type directly in the transcript box and evaluate that answer.
- Recording can end automatically. The status message explains what happened and the transcript remains editable.

## How scoring works

The evaluator normalises text and checks for predefined, question-specific phrase groups. A criterion is covered only when its required evidence is present; broad standalone words such as `where`, `memory`, or `process` do not earn unrelated credit.

The score is:

```text
round((covered rubric criteria / total rubric criteria) × 100)
```

It is always bounded from 0 to 100. Possible-misconception flags do not add or subtract score. A result is a heuristic **rubric-coverage score**, not a validated measure of technical correctness, semantic understanding, or interview readiness.

## Test

Run the automated evaluator tests with:

```bash
npm test
```

The latest repository verification ran this command with Node.js `v24.21.0`: 24 tests passed and 0 failed. The suite covers all sample answers, empty and short answers, missing criteria, irrelevant answers, generic checklist language without a topic anchor, text-normalisation variants, direct and linear-time misconception wording, corrective phrasing, score bounds, PDF file validation, PDF.js browser-compatibility helpers, mocked text extraction, empty documents, PDF error messages, relevant-passage selection, full/partial/no reference coverage, score refusal without a linked explicit rubric, and local-server behavior (including confirmation that the transcription endpoint is absent).

## Current limitations

- The evaluator cannot understand full meaning, judge nuanced explanations, or prove that an answer is technically correct.
- Speech recognition must be tested in the target browser with the target microphone and network conditions before a demonstration.
- PDF.js browser extraction must be tested with representative text PDFs, encrypted PDFs, corrupted files, and target browsers before a demonstration. The automated extraction test uses a mocked PDF document; it is not a real-browser PDF.js test.
- PDF-reference scores are only local phrase coverage, not plagiarism detection, semantic similarity, OCR, or AI/ML evaluation.
- Progress tracking, user accounts, persistent storage, and generated follow-up questions are intentionally not included.

## Team

- Himanshu (24BCE0955)
- Nagendra (24BCE2185)
- Atharv (24BCE2002)
