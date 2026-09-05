// Test-only stand-in for the "server-only" package.
//
// The real package throws unconditionally unless resolved under Next.js's
// "react-server" bundler condition, which Vitest does not set. Tests run in
// a plain Node environment (never a browser), so the server-only boundary
// this marks is not meaningful there — this file intentionally does nothing.
export {};
