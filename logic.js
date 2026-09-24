// ECHO REEF の決まりごと。画面（DOM）に触らない部分をここに集める。
// main.js（ブラウザ）と test.mjs（node）の両方から読む。
//
// 盤は一辺 size の正方形。マスは左上から右へ 0, 1, 2 …（列 x・行 y なら y * size + x）。
// 局（game）は { size, k, rocks, soundings: [{ cell, d }], marks, misses }。保存もこの形。

export const DEPTH_IDS = ['shallow', 'offing', 'deep', 'abyss'];
export const DEPTHS = {
  shallow: { name: '浅瀬', size: 6, k: 3, par: 6 },
  offing: { name: '沖', size: 7, k: 4, par: 8 },
  deep: { name: '深海', size: 8, k: 5, par: 11 },
  abyss: { name: '海淵', size: 9, k: 6, par: 13 },
};
export const DAILY_DEPTH = 'offing';
export const MISS_PENALTY = 5;
export const DAILY_KEEP = 400;          // 今日の海の記録を残す日数
export const DEFAULT_SETTINGS = { v: 1, sound: true, assist: true, tutorialDone: false };

// ---- 乱数と日替わり ----

// xorshift32。below(n) は剰余の偏りが出る上の端を捨てて取り直す
export function rng(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  const next = () => {
    s = (s ^ (s << 13)) >>> 0;
    s = (s ^ (s >>> 17)) >>> 0;
    s = (s ^ (s << 5)) >>> 0;
    return s;
  };
  const below = (n) => {
    const limit = 2 ** 32 - (2 ** 32 % n);
    let x;
    do x = next(); while (x >= limit);
    return x % n;
  };
  return { next, below };
}

// 文字列の FNV-1a（32bit）
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

// 0〜size²−1 の袋から k 個を引いて抜く。並べ直して返す
export function makeRocks(size, k, r) {
  const bag = Array.from({ length: size * size }, (_, i) => i);
  const rocks = [];
  for (let i = 0; i < k; i++) rocks.push(bag.splice(r.below(bag.length), 1)[0]);
  return rocks.sort((a, b) => a - b);
}

// 今日の海の岩。種の文字列は試作のまま（id が変わっても変えない）
export function dailyRocks(date) {
  const { size, k } = DEPTHS[DAILY_DEPTH];
  return makeRocks(size, k, rng(fnv1a(`minasoko/${date}`)));
}

// 端末の暦での日付 'YYYY-MM-DD'
export function dateKey(d = new Date()) {
  const p = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function prevDay(key) {
  const [y, m, d] = key.split('-').map(Number);
  return dateKey(new Date(y, m - 1, d - 1));
}
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---- 盤 ----

// マンハッタン距離（斜めの近道は無い）
export const dist = (a, b, size) => Math.abs(a % size - b % size) + Math.abs(Math.floor(a / size) - Math.floor(b / size));

// マスからいちばん近い岩までの距離
export const nearest = (rocks, cell, size) => Math.min(...rocks.map((r) => dist(r, cell, size)));

export const newGame = (size, k, rocks) => ({ size, k, rocks, soundings: [], marks: [], misses: 0 });

export const soundingAt = (game, cell) => game.soundings.find((s) => s.cell === cell);
export const isFound = (game, cell) => soundingAt(game, cell)?.d === 0;

// 鳴らす。{ d, repeat } を返す。印のあるマスは鳴らせない（null）
// 距離 0 は岩の上なので、そのまま「見つけた岩」の印を付ける（外せない）。
export function sound(game, cell) {
  const had = soundingAt(game, cell);
  if (had) return { d: had.d, repeat: true };
  if (game.marks.includes(cell)) return null;
  const d = nearest(game.rocks, cell, game.size);
  game.soundings.push({ cell, d });
  if (d === 0) game.marks.push(cell);
  return { d, repeat: false };
}

// 印を置く・外す。'on' / 'off'、置けないときは理由（'found' / 'sounded' / 'full'）
export function toggleMark(game, cell) {
  const s = soundingAt(game, cell);
  if (s) return s.d === 0 ? 'found' : 'sounded';
  const i = game.marks.indexOf(cell);
  if (i >= 0) { game.marks.splice(i, 1); return 'off'; }
  if (game.marks.length >= game.k) return 'full';
  game.marks.push(cell);
  return 'on';
}

export const canConfirm = (game) => game.marks.length === game.k;

// 確定する。全部合っていれば true。外れなら外れの数を増やす（どれが違うかは返さない）
export function confirm(game) {
  if (!canConfirm(game)) return null;
  const ok = game.marks.every((c) => game.rocks.includes(c));
  if (!ok) game.misses++;
  return ok;
}

// 回数（成績）: 鳴らした回数 + 外れ × 5
export const score = (game) => game.soundings.length + game.misses * MISS_PENALTY;

// 沈める: どの音についても「d より近いマスに岩は無い」。岩が無いと決まったマスを true に
export function sunk(game) {
  const out = new Array(game.size * game.size).fill(false);
  for (const { cell, d } of game.soundings) {
    for (let c = 0; c < out.length; c++) if (dist(cell, c, game.size) < d) out[c] = true;
  }
  return out;
}

// ---- 手引き（与えた音だけで岩が 1 通りに決まる盤。test.mjs で確かめる） ----

export const TUTORIAL = [
  {
    title: '距離だけが返る', size: 4, rocks: [2], given: [{ cell: 0, d: 2 }, { cell: 8, d: 4 }],
    body: '2 つの音が鳴らしてある。数字はそこからいちばん近い岩までの距離。方角は分からない。岩は 1 つ。どこか。',
    after: '距離 2 の輪と距離 4 の輪。二つが重なるマスは 1 つしかない。',
  },
  {
    title: '近いほうしか答えない', size: 5, rocks: [13, 24], given: [{ cell: 0, d: 5 }, { cell: 17, d: 2 }, { cell: 20, d: 4 }],
    body: '岩は 2 つ。数字はいつも近いほうまでの距離で、遠いほうの岩は数字に出てこない。',
    after: '遠い岩は音に隠れる。だから、離れた場所からも鳴らす必要がある。',
  },
  {
    title: '沈んだマスを使う', size: 6, rocks: [0, 31, 32], given: [{ cell: 24, d: 2 }, { cell: 35, d: 3 }, { cell: 14, d: 3 }, { cell: 11, d: 6 }],
    body: '薄いマスは岩が無いと分かったところ。距離より近いマスは全部そうなる。残りだけを見ればいい。',
    after: '消していく作業は盤がやる。人がやるのは、輪のどこに岩を置くかを決めることだけ。',
  },
  {
    title: '本番と同じ広さで', size: 7, rocks: [4, 42, 43, 45], given: [{ cell: 22, d: 3 }, { cell: 23, d: 4 }, { cell: 34, d: 5 }, { cell: 14, d: 4 }, { cell: 27, d: 5 }],
    body: '7×7 に岩が 4 つ。今日の海と同じ。この 5 つの音だけで、4 つとも決まる。',
    after: '足りなければ鳴らせばいい。ただし回数は増える。どこを鳴らすかが、この遊びの中身。',
  },
];

export function tutorialGame(i) {
  const t = TUTORIAL[i];
  const g = newGame(t.size, t.rocks.length, t.rocks.slice());
  g.soundings = t.given.map((s) => ({ ...s }));
  return g;
}

// ---- 保存する値（読めない・形が違うものは捨てて、はじめの値にする） ----

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isCount = (v) => Number.isInteger(v) && v >= 0;

export function readSettings(raw) {
  const d = { ...DEFAULT_SETTINGS };
  if (!isObj(raw) || raw.v !== 1) return d;
  return { v: 1, sound: raw.sound !== false, assist: raw.assist !== false, tutorialDone: raw.tutorialDone === true };
}

export const emptyRecords = () => ({ v: 1, best: {}, clears: {}, daily: {}, streak: { last: null, count: 0 } });

export function readRecords(raw) {
  const rec = emptyRecords();
  if (!isObj(raw) || raw.v !== 1) return rec;
  for (const id of DEPTH_IDS) {
    if (isObj(raw.best) && Number.isInteger(raw.best[id]) && raw.best[id] > 0) rec.best[id] = raw.best[id];
    if (isObj(raw.clears) && isCount(raw.clears[id])) rec.clears[id] = raw.clears[id];
  }
  if (isObj(raw.daily)) {
    for (const [k, v] of Object.entries(raw.daily)) {
      if (DATE_RE.test(k) && isObj(v) && isCount(v.score) && typeof v.cleared === 'boolean') rec.daily[k] = { score: v.score, cleared: v.cleared };
    }
  }
  const s = raw.streak;
  if (isObj(s) && DATE_RE.test(s.last) && isCount(s.count)) rec.streak = { last: s.last, count: s.count };
  return rec;
}

// 局を読む。盤の外のマス・数が合わない・音の距離が岩と合わないものは null
export function readGame(raw, size, k) {
  if (!isObj(raw) || raw.size !== size || raw.k !== k) return null;
  const n = size * size;
  const isCell = (c) => Number.isInteger(c) && c >= 0 && c < n;
  const { rocks, soundings, marks, misses } = raw;
  if (!Array.isArray(rocks) || rocks.length !== k || !rocks.every(isCell) || new Set(rocks).size !== k) return null;
  if (!Array.isArray(soundings) || !Array.isArray(marks) || !isCount(misses)) return null;
  const g = newGame(size, k, rocks.slice().sort((a, b) => a - b));
  g.misses = misses;
  for (const s of soundings) {
    if (!isObj(s) || !isCell(s.cell) || soundingAt(g, s.cell) || s.d !== nearest(g.rocks, s.cell, size)) return null;
    g.soundings.push({ cell: s.cell, d: s.d });
  }
  if (!marks.every(isCell) || new Set(marks).size !== marks.length) return null;
  if (marks.some((c) => soundingAt(g, c)?.d > 0)) return null;
  const found = g.soundings.filter((s) => s.d === 0).map((s) => s.cell);
  if (!found.every((c) => marks.includes(c)) || marks.length - found.length > k) return null;
  g.marks = marks.slice();
  return g;
}

export function readResume(raw) {
  const out = { v: 1, games: {} };
  if (!isObj(raw) || raw.v !== 1 || !isObj(raw.games)) return out;
  for (const [key, g] of Object.entries(raw.games)) {
    let m, game = null;
    if ((m = /^daily\/(\d{4}-\d{2}-\d{2})$/.exec(key))) {
      const { size, k } = DEPTHS[DAILY_DEPTH];
      game = readGame(g, size, k);
      if (game && game.rocks.join() !== dailyRocks(m[1]).join()) game = null;
    } else if ((m = /^free\/(\w+)$/.exec(key)) && DEPTHS[m[1]]) {
      game = readGame(g, DEPTHS[m[1]].size, DEPTHS[m[1]].k);
    }
    if (game) out.games[key] = game;
  }
  return out;
}

// ---- 記録 ----

// 当てた回数を深さの記録に入れる。自己ベストを更新したら true
export function recordClear(rec, depth, value) {
  rec.clears[depth] = (rec.clears[depth] || 0) + 1;
  if (rec.best[depth] != null && rec.best[depth] <= value) return false;
  rec.best[depth] = value;
  return true;
}

// 今日の海の記録。最初に当てたときの回数だけ残す（当てたあとは書き換えない）。
// 当てた日が前の日から続いていれば連続日数 +1、飛んでいたら 1 に戻す。初めて当てたら true
export function recordDaily(rec, date, value, cleared) {
  if (rec.daily[date]?.cleared) return false;
  rec.daily[date] = { score: value, cleared };
  const keep = Object.keys(rec.daily).sort().reverse().slice(DAILY_KEEP);
  for (const k of keep) delete rec.daily[k];
  if (!cleared) return false;
  const { last, count } = rec.streak;
  rec.streak = { last: date, count: last === prevDay(date) ? count + 1 : last === date ? count : 1 };
  return true;
}

// 今の連続日数（今日か昨日に当てていなければ 0）
export function streakNow(rec, today) {
  const { last, count } = rec.streak;
  return last === today || last === prevDay(today) ? count : 0;
}
