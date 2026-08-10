/**
 * Stands in for the `server-only` package under vitest, which doesn't resolve
 * React's `react-server` export condition. The real package exists to fail a
 * client build; there is nothing to enforce in a Node test process.
 */
export {};
