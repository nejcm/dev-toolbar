/**
 * Deliberately minimal: `transform: {}` runs tests as plain CommonJS with no
 * Babel, so Jest loads `dist/testing.cjs` exactly as a real consumer would.
 */
module.exports = {
  testEnvironment: "jsdom",
  transform: {},
  // Pick the "require" condition from the exports map, as a CJS consumer would.
  testEnvironmentOptions: { customExportConditions: ["require", "default"] },
};
