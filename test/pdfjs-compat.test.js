const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("PDF.js compatibility helpers provide promise and byte-array methods", () => {
    const source = fs.readFileSync(path.join(__dirname, "..", "pdfjs-compat.js"), "utf8");
    const context = vm.createContext({});

    vm.runInContext(source, context);

    assert.equal(vm.runInContext("typeof Promise.withResolvers", context), "function");
    assert.equal(vm.runInContext("typeof Uint8Array.prototype.toHex", context), "function");
    assert.equal(vm.runInContext("new Uint8Array([0, 15, 255]).toHex()", context), "000fff");
});
