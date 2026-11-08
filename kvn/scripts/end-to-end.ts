// End-to-end check of what bibel's import does with a translation (edition-import.ts toOsnbNumbering):
// native verse -> osmain (the translation's mapping, reversed) -> osnb (osnb's mapping). Each native
// verse is compared with the osnb verse it lands on, and, when weak, with the osnb verses either side.
// osnb is our own edition, aligned verse by verse, so this does not depend on osmain's text.
import { readFileSync, existsSync, readdirSync, writeFileSync } from 'fs';
const W = process.env.FB ?? '/Users/vhanssen/WebstormProjects/flogvit/free-bible/.claude/worktrees/kvn-status';
const { ukvnDecode, ukvnEncode, UKVN_PART_SIZE } = await import(W + '/kvn/src/ukvn-types.ts');
const [tr, thrS = '0.72'] = process.argv.slice(2); const thr = +thrS;
const RAW = `${W}/generate/bibles_raw`;
const map = (n: string) => JSON.parse(readFileSync(`${W}/kvn/mappings/${n}.ukvn.json`, 'utf8'));
const src = map(tr), osnb = map('osnb');
const toKvn = new Map<number, number>(); for (const e of src.map) if (!toKvn.has(e.tkvnFrom)) toKvn.set(e.tkvnFrom, e.kvnFrom);
const kvnToOsnb = new Map<number, number>(); for (const e of osnb.map) kvnToOsnb.set(e.kvnFrom, e.tkvnFrom);
const look = (m: Map<number, number>, k: number) => { const x = m.get(k); if (x !== undefined) return x; const p = k % UKVN_PART_SIZE; const b = p > 0 ? m.get(k - p) : undefined; return b !== undefined ? b + p : k; };
const parts = (k: number) => { const o: number[] = []; for (let p = 1; p < UKVN_PART_SIZE; p++) { const t = kvnToOsnb.get(k + p); if (t === undefined) break; o.push(t); } return o; };
const load = (n: string, b: number, c: number) => { const f = `${RAW}/${n}/${b}/${c}.json`; return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) as any[] : []; };
const osnbText = (b: number, c: number, v: number) => load('osnb', b, c).find(x => x.verseId === v)?.text as string | undefined;
async function embed(texts: string[]): Promise<number[][]> {
  for (let i = 0; i < 5; i++) {
    try { const r = await fetch('http://localhost:11434/api/embed', { method: 'POST', body: JSON.stringify({ model: 'bge-m3', input: texts, keep_alive: '10m' }) }); return (await r.json()).embeddings; }
    catch { await Bun.sleep(5000); }
  }
  throw new Error('embed failed');
}
const cos = (a: number[], b: number[]) => { let s = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { s += a[i] * b[i]; x += a[i] ** 2; y += b[i] ** 2; } return s / Math.sqrt(x * y); };
const out: any[] = []; let n = 0, sum = 0;
const books = readdirSync(`${RAW}/${tr}`).filter(d => /^\d+$/.test(d)).map(Number).sort((a, b) => a - b);
for (const b of books) {
  for (const c of readdirSync(`${RAW}/${tr}/${b}`).filter(f => f.endsWith('.json')).map(f => +f.slice(0, -5)).sort((x, y) => x - y)) {
    const vs = load(tr, b, c).filter(v => v.text?.trim());
    const rows = vs.map(v => {
      const kvn = look(toKvn, ukvnEncode(b, c, v.verseId));
      const ps = kvn % UKVN_PART_SIZE === 0 ? parts(kvn) : [];
      const t = ukvnDecode(ps.length > 1 ? ps[0] : look(kvnToOsnb, kvn));
      return { v: v.verseId, text: v.text as string, t, split: ps.length > 1 };
    });
    const targets = rows.map(r => osnbText(r.t.book, r.t.chapter, r.t.verse) ?? '');
    const e = await embed([...rows.map(r => r.text), ...targets.map(x => x || '-')]);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]; const s = targets[i] ? cos(e[i], e[rows.length + i]) : 0;
      n++; sum += s;
      if (s >= thr || r.split) continue;
      // neighbours in osnb, crossing the chapter edge
      const cand: [string, string][] = [];
      for (const o of [-2, -1, 1, 2]) {
        let cc = r.t.chapter, vv = r.t.verse + o;
        let txt = osnbText(r.t.book, cc, vv);
        if (!txt && o > 0) { cc++; vv = o; txt = osnbText(r.t.book, cc, vv); }
        if (!txt && o < 0) { cc--; const l = load('osnb', r.t.book, cc); if (l.length) { vv = l.at(o)!.verseId; txt = l.at(o)!.text; } }
        if (txt) cand.push([`${cc}:${vv}`, txt]);
      }
      const en = cand.length ? await embed(cand.map(x => x[1])) : [];
      let best = -1, bk = '';
      en.forEach((x, j) => { const ss = cos(e[i], x); if (ss > best) { best = ss; bk = cand[j][0]; } });
      out.push({ ref: `${b} ${c}:${r.v}`, osnb: `${r.t.chapter}:${r.t.verse}`, sim: +s.toFixed(3), best: bk, bestSim: +best.toFixed(3), shifted: best > s + 0.08 });
    }
  }
  process.stderr.write(`book ${b} done\n`);
}
writeFileSync(`${process.env.OUT ?? '.'}/e2e-${tr}.json`, JSON.stringify(out, null, 1));
console.log(`${tr}: ${n} verses, mean sim ${(sum / n).toFixed(3)}, ${out.length} weak, ${out.filter(o => o.shifted).length} fit a neighbour better`);
for (const o of out.filter(o => o.shifted)) console.log(`  ${o.ref} -> osnb ${o.osnb} (${o.sim}); osnb ${o.best} fits ${o.bestSim}`);
