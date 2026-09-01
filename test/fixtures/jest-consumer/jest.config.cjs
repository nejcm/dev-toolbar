/**
 * Deliberately minimal. `transform: {}` means the tests run as plain CommonJS
 * with no Babel in the way, so what Jest loads is exactly `dist/testing.cjs` as
 * a real consumer's Jest would load it.
 */
module.exports = {
  testEnvironment: "jsdom",
  transform: {},
  // Pick the "require" condition from the package's exports map, which is what
  // a CommonJS consumer gets.
  testEnvironmentOptions: { customExportConditions: ["require", "default"] },
};
