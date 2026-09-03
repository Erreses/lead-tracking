/**
 * Runs once when the server process starts.
 *
 * Next calls `register` in every runtime, so the actual work lives in
 * `instrumentation-node.ts` behind a positive runtime check. Written this way
 * on purpose: with an early `return` for non-Node runtimes the bundler still
 * has to pull the Node-only module into the Edge bundle, and complains about
 * every `process.exit` and `fs` call it finds there.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
