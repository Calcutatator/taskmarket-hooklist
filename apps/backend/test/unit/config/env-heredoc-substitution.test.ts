/**
 * `scripts/cloud-env-setup.sh` generates the sandbox's `.env` from an UNQUOTED heredoc
 * (`cat > .env << EOF`), so every backtick and every `$(...)` inside it is command substitution
 * that runs while the file is written, splicing its stdout into `.env`.
 *
 * The script says so, in a comment immediately above the block. That comment was not enough: a
 * later edit put `` `make smoke rate-limit` `` inside the block, in prose, purely as markdown
 * emphasis. The sandbox runs the script from the repo root, where that is a real make target, so
 * env generation would have run a smoke test and written its output into the environment file --
 * silently, with the script still exiting 0. It reached the branch and would have broken every
 * fresh sandbox.
 *
 * A comment cannot fail a build, so this does. It is deliberately narrow: it checks the one
 * region where the hazard exists, and it permits `\`` because escaping is the documented way to
 * write a literal backtick there.
 */
import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const SCRIPT = path.join(__dirname, '../../../../../scripts/cloud-env-setup.sh');
const OPENER = 'cat > .env << EOF';

/** The heredoc body, as the shell would evaluate it. */
function envHeredocBody(): { line: number; text: string }[] {
  const source = readFileSync(SCRIPT, 'utf8');
  const start = source.indexOf(OPENER);
  expect(
    start,
    `${OPENER} not found -- if the generator changed, this guard must follow it rather than be deleted`
  ).toBeGreaterThan(-1);

  const after = source.slice(start);
  const end = after.indexOf('\nEOF\n');
  expect(end, 'unterminated heredoc in cloud-env-setup.sh').toBeGreaterThan(-1);

  const offsetLine = source.slice(0, start).split('\n').length;
  return after
    .slice(0, end)
    .split('\n')
    .map((text, i) => ({ line: offsetLine + i, text }));
}

describe('the generated .env heredoc contains no accidental command substitution', () => {
  it('has no unescaped backtick', () => {
    const offenders = envHeredocBody().filter(({ text }) =>
      [...text].some((char, i) => char === '`' && (i === 0 || text[i - 1] !== '\\'))
    );

    expect(
      offenders.map(({ line, text }) => `${line}: ${text}`),
      'An unescaped backtick here RUNS as a command while .env is generated and splices its output into the file. Escape it as \\` or drop it -- markdown emphasis is not worth a shell execution.'
    ).toEqual([]);
  });

  it('has no unescaped $(...) substitution', () => {
    // The same hazard in its other spelling. `$VAR` interpolation is intended and everywhere
    // here, so only the command form is rejected.
    const offenders = envHeredocBody().filter(({ text }) => /(^|[^\\])\$\(/.test(text));

    expect(
      offenders.map(({ line, text }) => `${line}: ${text}`),
      'An unescaped $(...) here runs as a command while .env is generated.'
    ).toEqual([]);
  });
});
