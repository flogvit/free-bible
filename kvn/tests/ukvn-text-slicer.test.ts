import { describe, it, expect } from 'bun:test';
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

  // bible.flogvit.com#216: the split only knew Latin capitals and full stops, so
  // a Chinese, Japanese or Vietnamese verse stayed whole in the first part and
  // the next osnb verse was left empty.
  it('splits at Chinese full-width stops (1 Sam 20:42, Chinese Union)', () => {
    const text = '约 拿 单 对 大 卫 说 ： 我 们 二 人 曾 指 着 耶 和 华 的 名 起 誓 。 如 今 你 平 平 安 安 地 去 罢 ！ 大 卫 就 起 身 走 了 ； 约 拿 单 也 回 城 里 去 了 。';
    expect(sliceVersePart(text, 2, 2)).toBe('大 卫 就 起 身 走 了 ； 约 拿 单 也 回 城 里 去 了 。');
  });

  it('takes a bracketed psalm title as the leading part (Ps 3:1, Chinese Union)', () => {
    const text = '（ 大 卫 逃 避 他 儿 子 押 沙 龙 的 时 候 作 的 诗 。 ） 耶 和 华 啊 ， 我 的 敌 人 何 其 加 增 。 有 许 多 人 起 来 攻 击 我 。';
    expect(sliceVersePart(text, 1, 2)).toBe('（ 大 卫 逃 避 他 儿 子 押 沙 龙 的 时 候 作 的 诗 。 ）');
    expect(sliceVersePart(text, 2, 2)).toBe('耶 和 华 啊 ， 我 的 敌 人 何 其 加 增 。 有 许 多 人 起 来 攻 击 我 。');
  });

  it('gives a bracketed title every part but the last (Ps 51:1-2, three parts)', () => {
    const text = '（ 大 卫 与 拔 示 巴 同 室 以 後 。 先 知 拿 单 来 见 他 。 ） 神 啊 ， 求 你 怜 恤 我 。';
    expect(sliceVersePart(text, 1, 3)).toBe('（ 大 卫 与 拔 示 巴 同 室 以 後 。');
    expect(sliceVersePart(text, 2, 3)).toBe('先 知 拿 单 来 见 他 。 ）');
    expect(sliceVersePart(text, 3, 3)).toBe('神 啊 ， 求 你 怜 恤 我 。');
  });

  it('splits before a capital outside A-Z (Vietnamese Ð)', () => {
    expect(sliceVersePart('Anh hãy đi bình an. Ðức Giê-hô-va sẽ làm chứng.', 2, 2)).toBe('Ðức Giê-hô-va sẽ làm chứng.');
  });

  it('keeps a Spanish psalm title apart from the first question (Ps 22:1, Reina-Valera)', () => {
    const text = 'Al Músico principal, sobre Ajeleth-sahar Salmo de David. DIOS mío, Dios mío, ¿por qué me has dejado? ¿Por qué estás lejos de mi salud?';
    expect(sliceVersePart(text, 2, 2)).toBe('DIOS mío, Dios mío, ¿por qué me has dejado? ¿Por qué estás lejos de mi salud?');
  });

  it('does not take brackets in the middle of a verse as a title', () => {
    const text = 'Paul, an apostle, (not of men, neither by man,) unto the churches. Grace be to you.';
    expect(sliceVersePart(text, 1, 2)).toBe('Paul, an apostle, (not of men, neither by man,) unto the churches.');
  });

  it('returns empty string if part exceeds total parts', () => {
    const text = 'Hello world.';
    expect(sliceVersePart(text, 5, 2)).toBe('');
  });
});
