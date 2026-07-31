// «Korpuset mangler» og «kapittelet finnes ikke» er to forskjellige svar (#120).
//
// `load-bible.ts` returnerte 0 for begge. En vendret kopi av kvn i et annet repo
// peker `../../generate/bibles_raw/osnb` ut i intet, og da ga `getMaxVerse(1,1)`
// 0 i stedet for 31 — uten en eneste feilmelding. Det viste seg 36 steder unna
// som «1 Mos 1:1 should exist = false», og kildekoden var bit for bit identisk
// med den som virket. Bare plasseringen skilte (bible.flogvit.com#62).
//
// De to halvdelene må derfor testes hver for seg: den ene skal fortsatt være
// stille, den andre skal rope.

import { describe, expect, test } from 'bun:test';
import { getChapterCount, getMaxVerse, verifyCorpus, verseExists } from '../src/load-bible.js';

describe('manglende korpus er en konfigurasjonsfeil', () => {
  test('verifyCorpus kaster når roten ikke finnes', () => {
    expect(() => verifyCorpus('/finnes/helt/sikkert/ikke/osnb')).toThrow(/Finner ikke råkorpuset/);
  });

  test('feilmeldingen navngir stien og forklarer vendring', () => {
    // En feilmelding som bare sier «not found» sender leseren til dataene.
    // Årsaken var pakking, og det er det meldingen må si.
    let message = '';
    try {
      verifyCorpus('/finnes/helt/sikkert/ikke/osnb');
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('/finnes/helt/sikkert/ikke/osnb');
    expect(message).toContain('VENDRET');
  });

  test('verifyCorpus er stille når korpuset finnes', () => {
    expect(() => verifyCorpus()).not.toThrow();
  });
});

describe('manglende ENKELTKAPITTEL er fortsatt et gyldig 0', () => {
  // Kallere løper over kapittelnumre og stopper på 0. Ble dette til et kast,
  // ville hver slik løkke dødd.
  test('et kapittel som ikke finnes gir 0, ikke et kast', () => {
    expect(getMaxVerse(1, 999)).toBe(0);
  });

  test('en bok som ikke finnes gir 0, ikke et kast', () => {
    expect(getChapterCount(999)).toBe(0);
  });

  test('et vers som ikke finnes gir false, ikke et kast', () => {
    expect(verseExists(1, 999, 1)).toBe(false);
  });

  test('og ekte oppslag svarer fortsatt riktig', () => {
    // Selve verdien som var 0 i den vendrede kopien.
    expect(getMaxVerse(1, 1)).toBe(31);
    expect(verseExists(1, 1, 1)).toBe(true);
  });
});
