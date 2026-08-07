import { describe, expect, it } from 'vitest';
import {
  escapeMarkdown,
  firstLine,
  formatReward,
  safeText,
  truncateText,
} from '../src/presentation/discord';

describe('Discord-safe presentation', () => {
  it('neutralizes mentions and inline code while enforcing Discord length limits', () => {
    const value = `@everyone \`unsafe\` ${'x'.repeat(300)}`;

    expect(safeText(value, 40)).toHaveLength(40);
    expect(safeText(value, 40)).not.toContain('@everyone');
    expect(safeText(value, 40)).not.toContain('`');
    expect(firstLine('First line\nSecond line', 'Fallback')).toBe('First line');
  });

  it('formats USDC exactly without floating-point conversion', () => {
    expect(formatReward('1234567890123')).toBe('$1,234,567.89 USDC');
  });

  it('keeps compact list titles from changing Discord markdown structure', () => {
    expect(truncateText('A deliberately long title', 12)).toBe('A deliberat…');
    expect(truncateText('12345678😀XY', 10)).toBe('12345678😀…');
    expect(escapeMarkdown('*bold* [link](target) <https://evil.example>')).toBe(
      '\\*bold\\* \\[link\\]\\(target\\) ‹https://evil.example›'
    );
  });
});
