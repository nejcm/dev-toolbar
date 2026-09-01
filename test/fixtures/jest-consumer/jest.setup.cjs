/**
 * Silences one known-cosmetic warning, and nothing else.
 *
 * Jest 29 pins an older jsdom whose CSS parser does not understand `@layer`, so
 * core's injected stylesheet makes it log a multi-kilobyte "Could not parse CSS
 * stylesheet" error on every render. It is pre-existing, harmless, and drowns
 * out the output of a fixture whose whole value is being readable when it fails.
 *
 * Anything that is not that warning still reaches the console.
 */
const original = console.error;

console.error = (...args) => {
  const first = args[0];
  const text =
    typeof first === "string"
      ? first
      : first && typeof first.message === "string"
        ? first.message
        : "";
  if (text.includes("Could not parse CSS stylesheet")) return;
  original(...args);
};
