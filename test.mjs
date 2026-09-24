// node test.mjs — 画面を使わない部分のテスト（距離・鳴らす・沈める・確定・成績・日替わり・保存・記録・手引き）
import assert from 'node:assert/strict';
import * as L from './logic.js';

let n = 0;
const test = (name, fn) => { fn(); n++; console.log(`ok ${name}`); };
const cell = (x, y, size) => y * size + x;

// 与えた音と合う岩の並びを数える（limit まで）。岩は「どの音の距離より近くにも無い」マスからだけ選ぶ
function countLayouts(size, k, given, limit = Infinity) {
  const g = L.newGame(size, k, [0]);
  g.soundings = given;
  const free = L.sunk(g).map((s, c) => (s ? -1 : c)).filter((c) => c >= 0);
  let count = 0;
  const pick = [];
  const walk = (from) => {
    if (count >= limit) return;
    if (pick.length === k) {
      if (given.every((s) => L.nearest(pick, s.cell, size) === s.d)) count++;
      return;
    }
    for (let i = from; i < free.length; i++) { pick.push(free[i]); walk(i + 1); pick.pop(); }
  };
  walk(0);
  return count;
}

test('距離: 仕様の確かめ用の値', () => {
  assert.equal(L.dist(cell(0, 0, 7), cell(3, 4, 7), 7), 7);
  assert.equal(L.nearest([cell(3, 4, 7)], 0, 7), 7);
  assert.equal(L.nearest([5, 40], 5, 7), 0);
  // 距離 0 は岩の上だけ
  const rocks = [3, 17, 30];
  for (let c = 0; c < 36; c++) assert.equal(L.nearest(rocks, c, 6) === 0, rocks.includes(c));
});

test('鳴らす: 距離を返し、同じマスは回数が増えない', () => {
  const g = L.newGame(7, 1, [cell(3, 4, 7)]);
  assert.deepEqual(L.sound(g, 0), { d: 7, repeat: false });
  assert.deepEqual(L.sound(g, 0), { d: 7, repeat: true });
  assert.equal(L.score(g), 1);
});

test('距離 0: 自動で見つけた岩の印が付き、外せず、そのまま確定できる（試作の不具合）', () => {
  const g = L.newGame(5, 2, [6, 18]);
  assert.deepEqual(L.sound(g, 6), { d: 0, repeat: false });
  assert.deepEqual(g.marks, [6]);
  assert.equal(L.toggleMark(g, 6), 'found');
  assert.deepEqual(g.marks, [6]);
  assert.equal(L.toggleMark(g, 18), 'on');
  assert.equal(L.confirm(g), true);
});

test('印: 岩の数まで。鳴らしたマスには置けない。印のあるマスは鳴らせない', () => {
  const g = L.newGame(6, 2, [0, 35]);
  L.sound(g, 14);
  assert.equal(L.toggleMark(g, 14), 'sounded');
  assert.equal(L.toggleMark(g, 1), 'on');
  assert.equal(L.sound(g, 1), null);
  assert.equal(L.toggleMark(g, 2), 'on');
  assert.equal(L.toggleMark(g, 3), 'full');
  assert.equal(L.toggleMark(g, 1), 'off');
  assert.deepEqual(g.marks, [2]);
});

test('確定: 数がそろうまで押せない。外れは +5、印は残る。成績 = 鳴らした数 + 外れ × 5', () => {
  const g = L.newGame(6, 2, [0, 35]);
  L.sound(g, 14);
  L.toggleMark(g, 1);
  assert.equal(L.confirm(g), null);
  L.toggleMark(g, 35);
  assert.equal(L.confirm(g), false);
  assert.equal(g.misses, 1);
  assert.deepEqual(g.marks, [1, 35]);
  assert.equal(L.score(g), 6);
  L.toggleMark(g, 1);
  L.toggleMark(g, 0);
  assert.equal(L.confirm(g), true);
  assert.equal(L.score(g), 6);
});

test('沈める: d より近いマスだけが沈み、岩は沈まない', () => {
  const size = 7, rocks = [cell(3, 4, size), cell(6, 0, size)];
  const g = L.newGame(size, 2, rocks);
  L.sound(g, 0);
  L.sound(g, cell(3, 1, size));
  const s = L.sunk(g);
  for (let c = 0; c < size * size; c++) {
    const expect = g.soundings.some((t) => L.dist(t.cell, c, size) < t.d);
    assert.equal(s[c], expect);
    if (rocks.includes(c)) assert.equal(s[c], false);
  }
  assert.equal(s[0], true);           // 鳴らしたマス自体も岩が無い
});

test('日替わり: 同じ日は同じ盤、違う日は（たいてい）違う盤。形は 7×7・岩 4', () => {
  const a = L.dailyRocks('2026-09-25');
  assert.deepEqual(a, L.dailyRocks('2026-09-25'));
  assert.equal(a.length, 4);
  assert.equal(new Set(a).size, 4);
  assert.ok(a.every((c) => c >= 0 && c < 49));
  assert.deepEqual(a, [...a].sort((x, y) => x - y));
  const seen = new Set();
  for (let d = 1; d <= 28; d++) seen.add(L.dailyRocks(`2026-02-${String(d).padStart(2, '0')}`).join());
  assert.ok(seen.size >= 27);
  // 並べ方を変えると全員の今日の海が変わるので、値を固定しておく
  assert.deepEqual(a, [3, 21, 36, 43]);
});

test('乱数: 種 0 でも止まらず、below は範囲内', () => {
  const r = L.rng(0);
  for (let i = 0; i < 1000; i++) { const v = r.below(49); assert.ok(v >= 0 && v < 49); }
  assert.equal(L.fnv1a(''), 0x811c9dc5);
  assert.equal(L.fnv1a('a'), 0xe40c292c);
});

test('日付: 手元の暦で前の日を出す（月・年またぎ）', () => {
  assert.equal(L.dateKey(new Date(2026, 8, 5)), '2026-09-05');
  assert.equal(L.prevDay('2026-03-01'), '2026-02-28');
  assert.equal(L.prevDay('2027-01-01'), '2026-12-31');
});

test('記録: 今日の海は最初に当てた回数だけ。連続日数は続けば +1、飛べば 1', () => {
  const rec = L.emptyRecords();
  assert.equal(L.recordDaily(rec, '2026-09-24', 7, false), false);
  assert.deepEqual(rec.daily['2026-09-24'], { score: 7, cleared: false });
  assert.equal(L.recordDaily(rec, '2026-09-24', 9, true), true);
  assert.equal(L.recordDaily(rec, '2026-09-24', 5, true), false);
  assert.deepEqual(rec.daily['2026-09-24'], { score: 9, cleared: true });
  assert.equal(L.recordDaily(rec, '2026-09-25', 8, true), true);
  assert.deepEqual(rec.streak, { last: '2026-09-25', count: 2 });
  assert.equal(L.streakNow(rec, '2026-09-26'), 2);
  assert.equal(L.streakNow(rec, '2026-09-27'), 0);
  L.recordDaily(rec, '2026-09-27', 8, true);
  assert.deepEqual(rec.streak, { last: '2026-09-27', count: 1 });
  assert.equal(L.recordClear(rec, 'deep', 12), true);
  assert.equal(L.recordClear(rec, 'deep', 12), false);
  assert.equal(L.recordClear(rec, 'deep', 11), true);
  assert.deepEqual([rec.best.deep, rec.clears.deep], [11, 3]);
});

test('記録: 今日の海は新しい方から 400 日だけ残す', () => {
  const rec = L.emptyRecords();
  const start = new Date(2025, 0, 1);
  for (let i = 0; i < 410; i++) L.recordDaily(rec, L.dateKey(new Date(2025, 0, 1 + i)), 8, true);
  const keys = Object.keys(rec.daily).sort();
  assert.equal(keys.length, 400);
  assert.equal(keys[0], L.dateKey(new Date(start.getFullYear(), 0, 11)));
});

test('保存: 壊れた値を読んでも落ちず、はじめの値になる', () => {
  const broken = [undefined, null, 0, 1, 'x', [], {}, { v: 2 }, { v: 1, best: 'x' }, { v: '1' }, [1, 2]];
  for (const b of broken) {
    assert.deepEqual(L.readSettings(b), L.DEFAULT_SETTINGS);
    assert.deepEqual(L.readResume(b), { v: 1, games: {} });
  }
  for (const b of broken) {
    const r = L.readRecords(b);
    assert.deepEqual(Object.keys(r).sort(), ['best', 'clears', 'daily', 'streak', 'v']);
  }
  const rec = L.readRecords({ v: 1, best: { shallow: 6, offing: -1, x: 3, deep: 1.5 }, clears: { offing: 3, abyss: 'a' },
    daily: { '2026-09-25': { score: 9, cleared: true }, bad: { score: 1, cleared: true }, '2026-09-24': { score: 'x', cleared: true } },
    streak: { last: '2026-09-25', count: 2 } });
  assert.deepEqual(rec, { v: 1, best: { shallow: 6 }, clears: { offing: 3 }, daily: { '2026-09-25': { score: 9, cleared: true } }, streak: { last: '2026-09-25', count: 2 } });
  assert.deepEqual(L.readSettings({ v: 1, sound: false, assist: 0, tutorialDone: 'yes' }), { v: 1, sound: false, assist: true, tutorialDone: false });
});

test('保存: 局は形・盤の外・数・距離・印が合わないと捨てる', () => {
  const date = '2026-09-25';
  const rocks = L.dailyRocks(date);
  const g = L.newGame(7, 4, rocks.slice());
  L.sound(g, 0);
  L.sound(g, rocks[0]);             // 見つけた岩
  L.toggleMark(g, 10 === rocks[1] ? 11 : 10);
  const good = JSON.parse(JSON.stringify(g));
  const ok = L.readResume({ v: 1, games: { [`daily/${date}`]: good, 'free/deep': null } });
  assert.deepEqual(Object.keys(ok.games), [`daily/${date}`]);
  assert.deepEqual(ok.games[`daily/${date}`], g);
  const bad = [
    { ...good, size: 8 },
    { ...good, k: 3 },
    { ...good, rocks: rocks.slice(0, 3) },
    { ...good, rocks: [rocks[0], rocks[0], rocks[1], rocks[2]] },
    { ...good, rocks: [...rocks.slice(0, 3), 49] },
    { ...good, rocks: 'x' },
    { ...good, soundings: [{ cell: 0, d: 99 }] },
    { ...good, soundings: [{ cell: -1, d: 1 }] },
    { ...good, soundings: [{ cell: 0, d: good.soundings[0].d }, { cell: 0, d: good.soundings[0].d }] },
    { ...good, soundings: [null] },
    { ...good, marks: [] },                                   // 見つけた岩の印が無い
    { ...good, marks: [...good.marks, 0] },                   // 鳴らしたマスに印
    { ...good, marks: [...good.marks, good.marks[1]] },
    { ...good, marks: [rocks[0], 1, 2, 3, 4, 5] },
    { ...good, marks: [rocks[0], 1.5] },
    { ...good, misses: -1 },
    { ...good, misses: '0' },
  ];
  for (const b of bad) assert.deepEqual(L.readResume({ v: 1, games: { [`daily/${date}`]: b } }).games, {}, JSON.stringify(b));
  // 今日の海の局で、岩がその日の盤と違うもの
  const other = L.newGame(7, 4, [0, 1, 2, 3].filter((c) => !rocks.includes(c)).concat(rocks).slice(0, 4).sort((a, b) => a - b));
  assert.deepEqual(L.readResume({ v: 1, games: { [`daily/${date}`]: other } }).games, {});
  // 深さの局と、知らない深さ
  const free = L.newGame(9, 6, [0, 10, 20, 30, 40, 80]);
  L.sound(free, 44);
  const r = L.readResume({ v: 1, games: { 'free/abyss': free, 'free/moon': free, 'free/deep': free, junk: free } });
  assert.deepEqual(Object.keys(r.games), ['free/abyss']);
});

test('手引き: 与えた音は本当の距離で、その音だけで岩が 1 通りに決まり、どれか欠けると決まらない', () => {
  for (const [i, t] of L.TUTORIAL.entries()) {
    const k = t.rocks.length;
    for (const s of t.given) assert.equal(L.nearest(t.rocks, s.cell, t.size), s.d, `${i + 1} 問目 マス ${s.cell}`);
    assert.equal(countLayouts(t.size, k, t.given, 2), 1, `${i + 1} 問目が決まらない`);
    for (let j = 0; j < t.given.length; j++) {
      const less = t.given.filter((_, x) => x !== j);
      assert.ok(countLayouts(t.size, k, less, 2) > 1, `${i + 1} 問目は ${j + 1} 番目の音が無くても決まる`);
    }
    const g = L.tutorialGame(i);
    t.rocks.forEach((c) => L.toggleMark(g, c));
    assert.equal(L.confirm(g), true);
    assert.equal(L.TUTORIAL[i].given.length, t.given.length);   // 遊んでも元のデータは変わらない
  }
});

test('深さ: 4 段の大きさ・岩・目安', () => {
  assert.deepEqual(L.DEPTH_IDS.map((id) => [L.DEPTHS[id].size, L.DEPTHS[id].k, L.DEPTHS[id].par]),
    [[6, 3, 6], [7, 4, 8], [8, 5, 11], [9, 6, 13]]);
});

console.log(`\n${n} 件すべて合格`);
