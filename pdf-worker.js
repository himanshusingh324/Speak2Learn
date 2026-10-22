// Workers have their own global scope, so they need the same compatibility
// helper as the main page before PDF.js initialises.
if (typeof Promise.withResolvers !== "function") {
    Promise.withResolvers = function withResolvers() {
        let resolve;
        let reject;
        const promise = new Promise((resolvePromise, rejectPromise) => {
            resolve = resolvePromise;
            reject = rejectPromise;
        });

        return { promise, resolve, reject };
    };
}

if (typeof Uint8Array.prototype.toHex !== "function") {
    Object.defineProperty(Uint8Array.prototype, "toHex", {
        configurable: true,
        writable: true,
        value: function toHex() {
            let result = "";

            for (const byte of this) {
                result += byte.toString(16).padStart(2, "0");
            }

            return result;
        }
    });
}

import "/vendor/pdf.worker-source.mjs";
