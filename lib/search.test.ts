import { describe, expect, it } from 'vitest';
import { likeEscape, looksLikeAccession } from './search';

describe('search helpers', () => {
  it('escapes LIKE wildcards', () => {
    expect(likeEscape('50%_off\\')).toBe('50\\%\\_off\\\\');
    expect(likeEscape('plain')).toBe('plain');
  });

  it('recognises accession numbers and prefixes', () => {
    for (const ok of ['0001628280-26-012345', '0001628280-26', '0001628280-', '0001628280', '000162']) expect(looksLikeAccession(ok)).toBe(true);
    for (const no of ['apple', '12345', '0001628280-26-0123456', 'AAPL']) expect(looksLikeAccession(no)).toBe(false);
  });
});
