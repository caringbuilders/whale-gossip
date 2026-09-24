import { registerHooks } from "node:module";

const emptyModuleUrl = new URL("./server-only-empty.mjs", import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { shortCircuit: true, url: emptyModuleUrl };
    return nextResolve(specifier, context);
  },
});
