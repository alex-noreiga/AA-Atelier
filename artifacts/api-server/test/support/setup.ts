// Runs before the test module graph is imported. Silence the logger and avoid
// the pino-pretty worker-thread transport (dev-only) so tests stay quiet and
// don't leave a worker hanging.
process.env.NODE_ENV = "production";
process.env.LOG_LEVEL = "silent";
