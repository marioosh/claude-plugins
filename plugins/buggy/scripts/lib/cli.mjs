// CLI contract shared by every buggy script.
//
// - Output is always one JSON object on stdout.
// - Success: {"status":"ok", ...data}, exit code 0.
// - Failure: {"status":"error","code":"...","message":"..."}, exit code 1
//   (or 0 when the script runs with `alwaysZero`, e.g. state.mjs, whose
//   failure must never abort a skill). `alwaysZero` may also be a list of
//   subcommands (the first argument) – those a skill injects with !`…`:
//   Claude Code aborts the whole skill when an injected command exits non-zero,
//   so the skill could not explain the error (e.g. "not set up – /buggy:start").

import { parseArgs } from 'node:util';

export class BuggyError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export function fail(code, message, details) {
  throw new BuggyError(code, message, details);
}

function write(obj) {
  process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`);
}

export async function run(main, { alwaysZero = false } = {}) {
  if (Array.isArray(alwaysZero)) alwaysZero = alwaysZero.includes(process.argv[2]);
  try {
    const data = (await main()) ?? {};
    write({ status: 'ok', ...data });
    process.exitCode = 0;
  } catch (err) {
    const known = err instanceof BuggyError;
    const out = {
      status: 'error',
      code: known ? err.code : 'internal',
      message: err?.message ?? String(err),
    };
    if (known && err.details !== undefined) out.details = err.details;
    write(out);
    process.exitCode = alwaysZero ? 0 : 1;
  }
}

// Strict argument parsing: unknown flags are an error, never ignored.
export function parse(options = {}, argv = process.argv.slice(2)) {
  try {
    return parseArgs({ args: argv, options, allowPositionals: true, strict: true });
  } catch (err) {
    fail('bad-arguments', err.message);
  }
}
