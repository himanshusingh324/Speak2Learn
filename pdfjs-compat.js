// PDF.js 6 uses Promise.withResolvers, which is not available in some
// otherwise capable browsers. Define the standard-compatible helper before
// loading PDF.js so local PDF extraction can still run there.
(function installPromiseWithResolvers() {
    if (typeof Promise.withResolvers === "function") {
        return;
    }

    Promise.withResolvers = function withResolvers() {
        let resolve;
        let reject;
        const promise = new Promise((resolvePromise, rejectPromise) => {
            resolve = resolvePromise;
            reject = rejectPromise;
        });

        return { promise, resolve, reject };
    };
}());

// PDF.js also uses Uint8Array#toHex for document identifiers. This recently
// standardised method is absent in some current browsers.
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
