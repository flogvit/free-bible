import { describe, it, expect } from 'vitest';
import { sliceVersePart } from '../src/ukvn-text-slicer.js';

describe('sliceVersePart', () => {
  it('returns full text for part=0', () => {
    const text = 'En salme. Det er godt å takke Herren.';
    expect(sliceVersePart(text, 0, 2)).toBe(text);
  });

  it('splits Sal 92:1 into superscription (a) and content (b)', () => {
    const text = 'En salme, en sang for sabbatsdagen. Det er godt å takke Herren og lovsynge ditt navn, du Høyeste,';
    const partA = sliceVersePart(text, 1, 2);
    const partB = sliceVersePart(text, 2, 2);
    expect(partA).toBe('En salme, en sang for sabbatsdagen.');
    expect(partB).toBe('Det er godt å takke Herren og lovsynge ditt navn, du Høyeste,');
  });

  it('splits 3-way (Sal 52:1)', () => {
    const text = 'Til korlederen. En læresalme av David. Da edomitten Doeg kom og fortalte Saul og sa til ham: «David har kommet til Ahimeleks hus.» Hvorfor skryter du av ondskap, du mektige? Guds trofasthet varer hele dagen.';
    const a = sliceVersePart(text, 1, 3);
    const b = sliceVersePart(text, 2, 3);
    const c = sliceVersePart(text, 3, 3);
    expect(a).toContain('Til korlederen');
    expect(b).toContain('Doeg');
    expect(c).toContain('Hvorfor skryter');
  });

  it('handles text with reference texts for better splitting', () => {
    const osmainText = 'En salme, en sang for sabbatsdagen. Det er godt å takke Herren og lovsynge ditt navn, du Høyeste,';
    const refTexts = [
      'En salme, en sang for sabbatsdagen.',
      'Det er godt å takke Herren og lovsynge ditt navn, du Høyeste,'
    ];
    const partA = sliceVersePart(osmainText, 1, 2, refTexts);
    expect(partA).toBe('En salme, en sang for sabbatsdagen.');
  });

  it('returns empty string if part exceeds total parts', () => {
    const text = 'Hello world.';
    expect(sliceVersePart(text, 5, 2)).toBe('');
  });
});
