import * as L from './logic.js';

// localStorage はほかのアプリと共有される（同じ t-of.github.io のため）。
// キーは必ず 'echo-reef.' で始める。
const STORE = 'echo-reef.';

function load(key, fallback) {
  try {
    const v = localStorage.getItem(STORE + key);
    return v == null ? fallback : JSON.parse(v);
  } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(STORE + key, JSON.stringify(value)); } catch { /* 保存できなくても遊べる */ }
}

WebAppKit.init({ title: 'ECHO REEF', text: '海の底に沈んだ岩を、マスを鳴らして探す推理パズル。返ってくるのはいちばん近い岩までの距離だけなので、いくつもの音を重ねて、少ない回数で岩の場所を全部当てる。' });

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js');
}

// ---- 設定・記録・続き ----

const settings = L.readSettings(load('settings', null));
const records = L.readRecords(load('records', null));
const resume = L.readResume(load('resume', null));
const saveSettings = () => save('settings', settings);
const saveRecords = () => save('records', records);
const saveResume = () => save('resume', resume);

// 前の日の今日の海の局は消す
function dropOldDaily(today) {
  let changed = false;
  for (const key of Object.keys(resume.games)) {
    if (key.startsWith('daily/') && key !== `daily/${today}`) { delete resume.games[key]; changed = true; }
  }
  if (changed) saveResume();
}

// ---- 音（Web Audio で作る。ファイルは使わない） ----

// iPhone のマナーモードでも鳴らす（Safari 16.4 以降）。
// 'playback' にすると音楽アプリの曲が止まるので、アプリの音がオンのときだけにする。
function setAudioSession(soundOn) {
  try { if (navigator.audioSession) navigator.audioSession.type = soundOn ? 'playback' : 'auto'; } catch { /* 対応していない */ }
}
setAudioSession(settings.sound);

let actx = null;
function tone(freq, { dur = 0.12, type = 'sine', gain = 0.06, delay = 0, to = 0 } = {}) {
  if (!settings.sound) return;
  try {
    setAudioSession(true);
    actx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    const t = actx.currentTime + delay;
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(actx.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  } catch { /* 音が出せなくても遊べる */ }
}
const sfx = {
  tap: () => tone(700, { dur: 0.03, type: 'triangle', gain: 0.03 }),
  // こだまは距離 × 40ms 遅れて返る。距離 0 は岩をたたく低い音
  echo: (d, gain = 0.025) => (d
    ? tone(1180, { dur: 0.12, gain, delay: 0.06 + d * 0.04 })
    : tone(170, { dur: 0.08, type: 'triangle', gain: 0.1, delay: 0.05 })),
  ping: (d) => { tone(1320, { dur: 0.14, gain: 0.06, to: 1250 }); sfx.echo(d); },
  markOn: () => tone(1500, { dur: 0.03, type: 'triangle', gain: 0.04 }),
  markOff: () => tone(900, { dur: 0.03, type: 'triangle', gain: 0.04 }),
  nope: () => tone(110, { dur: 0.03, gain: 0.03 }),
  win: () => [523, 659, 784].forEach((f, i) => tone(f, { dur: 0.16, type: 'triangle', gain: 0.07, delay: i * 0.1 })),
  miss: () => [392, 294].forEach((f, i) => tone(f, { dur: 0.14, type: 'triangle', gain: 0.06, delay: i * 0.12 })),
  lesson: () => [659, 880].forEach((f, i) => tone(f, { dur: 0.12, type: 'triangle', gain: 0.06, delay: i * 0.1 })),
};

const $ = (id) => document.getElementById(id);
const titleEl = $('title'), playEl = $('play'), clearEl = $('clear');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

function show(screen) {
  titleEl.hidden = screen !== titleEl;
  playEl.hidden = screen !== playEl;
}

// ---- タイトル ----

const shortDate = (key) => key.slice(5).replace('-', '/').replace(/^0/, '').replace('/0', '/');
const depthSpec = (d) => `${d.size}×${d.size}・岩 ${d.k}`;

$('depths').innerHTML = L.DEPTH_IDS.map((id) => `
  <button class="depth" data-depth="${id}">
    <span class="depth__name">${L.DEPTHS[id].name}</span>
    <span class="depth__spec">${depthSpec(L.DEPTHS[id])}・目安 ${L.DEPTHS[id].par} 回</span>
    <span class="depth__rec"></span>
  </button>`).join('');

function renderTitle() {
  const today = L.dateKey();
  dropOldDaily(today);
  $('daily-date').textContent = shortDate(today);
  const rec = records.daily[today];
  const going = resume.games[`daily/${today}`];
  $('daily-state').textContent = rec?.cleared ? `当てた ${rec.score} 回` : going ? `途中（${L.score(going)} 回）` : 'まだ';
  $('daily-btn').textContent = rec?.cleared ? 'もう一度見る' : going ? '続きから' : '潜る';
  const streak = L.streakNow(records, today);
  $('streak').hidden = streak < 2;
  $('streak').textContent = `${streak} 日つづけて潜っている`;
  for (const b of $('depths').children) {
    const id = b.dataset.depth;
    const g = resume.games[`free/${id}`];
    const best = records.best[id];
    b.querySelector('.depth__rec').textContent = [g && `途中 ${L.score(g)} 回`, best != null && `ベスト ${best} 回`].filter(Boolean).join('・');
  }
  $('tutorial-btn').classList.toggle('new', !settings.tutorialDone);
  const snd = $('sound-btn');
  snd.textContent = settings.sound ? '音 オン' : '音 オフ';
  snd.setAttribute('aria-pressed', String(settings.sound));
  const as = $('assist-btn');
  as.textContent = settings.assist ? '沈める 入' : '沈める 切';
  as.setAttribute('aria-pressed', String(settings.assist));
}

$('daily-btn').addEventListener('click', () => { sfx.tap(); startDaily(); });
$('depths').addEventListener('click', (e) => {
  const b = e.target.closest('[data-depth]');
  if (b) { sfx.tap(); startFree(b.dataset.depth, false); }
});
$('tutorial-btn').addEventListener('click', () => { sfx.tap(); startTutorial(0); });
$('sound-btn').addEventListener('click', () => {
  settings.sound = !settings.sound;
  setAudioSession(settings.sound);
  saveSettings();
  sfx.tap();
  renderTitle();
});
$('assist-btn').addEventListener('click', () => {
  settings.assist = !settings.assist;
  saveSettings();
  sfx.tap();
  renderTitle();
});

// ---- 遊ぶ ----

// play = { kind: 'daily' | 'replay' | 'free' | 'tutorial', date, depth, step, game, mode: 'sound' | 'mark', last, done }
let play = null;
let clearLockUntil = 0;
const boardEl = $('board'), ringsEl = $('rings'), stageEl = $('stage');

const resumeKey = () => (play.kind === 'daily' ? `daily/${play.date}` : play.kind === 'free' ? `free/${play.depth}` : null);

function begin(p, message) {
  const last = p.game.soundings.at(-1);
  play = { mode: 'sound', last: last ? last.cell : null, done: false, ...p };
  const { game, kind } = play;
  const t = kind === 'tutorial' ? L.TUTORIAL[play.step] : null;
  $('sea-name').textContent = t ? `手引き ${play.step + 1} / ${L.TUTORIAL.length}`
    : kind === 'free' ? `${L.DEPTHS[play.depth].name} ${depthSpec(L.DEPTHS[play.depth])}`
    : `今日の海 ${shortDate(play.date)}${kind === 'replay' ? '（もう一度）' : ''}`;
  $('count').textContent = t ? t.title : L.score(game);
  $('count').classList.toggle('hud__title', !!t);
  $('par').textContent = t ? `岩 ${game.k}` : `目安 ${L.DEPTHS[play.depth].par}・岩 ${game.k}`;
  $('lesson').hidden = !t;
  if (t) $('lesson').textContent = t.body;
  $('another-btn').hidden = kind !== 'free';
  clearEl.hidden = true;
  msg(message);
  show(playEl);
  boardEl.style.setProperty('--n', game.size);
  fit();
  render(true);
}

function startDaily() {
  const date = L.dateKey();
  const rocks = L.dailyRocks(date);
  const { size, k } = L.DEPTHS[L.DAILY_DEPTH];
  // 当てたあとは同じ盤をもう一度（記録は変えない・続きも残さない）
  if (records.daily[date]?.cleared) {
    begin({ kind: 'replay', date, depth: L.DAILY_DEPTH, game: L.newGame(size, k, rocks) }, 'もう一度。記録は最初に当てた回数のまま');
    return;
  }
  const had = resume.games[`daily/${date}`];
  begin({ kind: 'daily', date, depth: L.DAILY_DEPTH, game: had || L.newGame(size, k, rocks) }, had ? '続きから' : 'マスを押して鳴らす');
}

function startFree(depth, fresh) {
  const { size, k } = L.DEPTHS[depth];
  const had = !fresh && resume.games[`free/${depth}`];
  const seed = (Date.now() ^ Math.floor(Math.random() * 2 ** 32)) >>> 0;
  begin({ kind: 'free', depth, game: had || L.newGame(size, k, L.makeRocks(size, k, L.rng(seed))) }, had ? '続きから' : 'マスを押して鳴らす');
  if (!had) persist();
}

function startTutorial(step) {
  begin({ kind: 'tutorial', step, game: L.tutorialGame(step) }, 'マスを押すと、その音の輪が見える');
}

// 続きと、今日の海の「まだ当てていない」記録を残す
function persist() {
  const key = resumeKey();
  if (!key) return;
  if (play.done) delete resume.games[key];
  else resume.games[key] = play.game;
  saveResume();
  if (play.kind === 'daily' && !play.done && play.game.soundings.length) {
    L.recordDaily(records, play.date, L.score(play.game), false);
    saveRecords();
  }
}

function msg(text) { $('msg').textContent = text; }

// マスの大きさ: 幅（最大 480px）と、上下の表示を除いた高さの両方に収まる正方形
function fit() {
  if (!play || playEl.hidden) return;
  const n = play.game.size;
  const g = 2;
  const side = Math.min(stageEl.clientWidth, 480, stageEl.clientHeight);
  const c = Math.max(20, Math.floor((side - g * (n + 1)) / n));
  boardEl.style.setProperty('--c', `${c}px`);
  boardEl.style.setProperty('--g', `${g}px`);
  drawRing(false);
}
new ResizeObserver(fit).observe(stageEl);

function render(animate) {
  const { game, done } = play;
  const n = game.size;
  const sk = settings.assist ? L.sunk(game) : null;
  let html = '';
  for (let c = 0; c < n * n; c++) {
    const s = L.soundingAt(game, c);
    const cls = ['cell'];
    let inner = '', state = '';
    if (done && game.rocks.includes(c)) { cls.push('rock'); inner = '<svg><use href="#rock"/></svg>'; state = '岩'; }
    else if (s?.d === 0) { cls.push('found'); inner = '<svg><use href="#buoy-found"/></svg>'; state = '見つけた岩'; }
    else if (game.marks.includes(c)) { cls.push('mark'); inner = '<svg><use href="#buoy"/></svg>'; state = '印'; }
    else if (s) { inner = `<span class="ping">${s.d}</span>`; state = `距離 ${s.d}`; }
    if (s?.d > 0 || sk?.[c]) cls.push('sunk');
    if (c === play.last) cls.push('last');
    html += `<button class="${cls.join(' ')}" data-c="${c}" aria-label="${Math.floor(c / n) + 1} 行 ${c % n + 1} 列${state && ` ${state}`}">${inner}</button>`;
  }
  boardEl.innerHTML = html;
  const left = game.k - game.marks.length;
  $('left').textContent = Math.max(0, left);
  $('mode-sound').setAttribute('aria-pressed', String(play.mode === 'sound'));
  $('mode-mark').setAttribute('aria-pressed', String(play.mode === 'mark'));
  $('confirm-btn').disabled = done || !L.canConfirm(game);
  $('hint').textContent = done ? '' : left > 0 ? `印を ${game.k} つ置くと押せる（あと ${left}）` : left < 0 ? `印が ${-left} つ多い。外してから確定する` : '';
  if (play.kind !== 'tutorial') $('count').textContent = L.score(game);
  drawRing(animate);
}

// 波の輪: 最後に鳴らした（押し直した）マスから距離 d のマスの中心を結ぶ菱形
function drawRing(animate) {
  const s = play && play.last != null && L.soundingAt(play.game, play.last);
  const w = boardEl.offsetWidth, h = boardEl.offsetHeight;
  ringsEl.setAttribute('viewBox', `0 0 ${w} ${h}`);
  if (!s || !s.d || play.done) { ringsEl.innerHTML = ''; return; }
  const n = play.game.size;
  const c = parseFloat(boardEl.style.getPropertyValue('--c')) || 40, g = 2;
  const step = c + g;
  const cx = g + (s.cell % n) * step + c / 2, cy = g + Math.floor(s.cell / n) * step + c / 2;
  const r = s.d * step;
  const grow = animate && !reduceMotion.matches ? ' grow' : '';
  ringsEl.innerHTML = `<polygon class="ring${grow}" style="transform-origin:${cx}px ${cy}px" points="${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy} ${cx},${cy - r}"/>`;
}

// 押して離したとき（click）に動かす。指をずらせば取り消せる
boardEl.addEventListener('click', (e) => {
  const el = e.target.closest('.cell');
  if (!el || !play || play.done) return;
  const cell = +el.dataset.c;
  const { game } = play;
  if (play.mode === 'sound') {
    const r = L.sound(game, cell);
    if (!r) { sfx.nope(); msg('印のあるマスは鳴らせない。先に印を外す'); return; }
    play.last = cell;
    if (r.repeat) sfx.echo(r.d, 0.02); else sfx.ping(r.d);
    msg(r.d ? `距離 ${r.d}。これより近くに岩は無い` : '距離 0。ここに岩がある');
    render(true);
  } else {
    const r = L.toggleMark(game, cell);
    if (r === 'on') { sfx.markOn(); msg(`印を置いた（あと ${Math.max(0, game.k - game.marks.length)}）`); }
    else if (r === 'off') { sfx.markOff(); msg('印を外した'); }
    else {
      sfx.nope();
      msg(r === 'found' ? '見つけた岩の印は外せない' : r === 'sounded' ? '鳴らしたマスに岩は無い' : `印は岩の数（${game.k} つ）まで`);
      if (r === 'sounded' || r === 'found') play.last = cell;
    }
    render(r === 'sounded');
  }
  persist();
});

function setMode(mode) {
  if (!play || play.done || play.mode === mode) return;
  play.mode = mode;
  sfx.tap();
  render(false);
}
$('mode-sound').addEventListener('click', () => setMode('sound'));
$('mode-mark').addEventListener('click', () => setMode('mark'));

$('confirm-btn').addEventListener('click', () => {
  if (!play || play.done) return;
  const ok = L.confirm(play.game);
  if (ok === null) return;
  if (ok) { finish(); return; }
  sfx.miss();
  if (play.kind === 'tutorial') {
    play.game.misses = 0;          // 手引きには回数を付けない
    msg('ちがう。輪の重なりを見直して');
  } else {
    msg(`外れ。どれが違うかは分からない。+${L.MISS_PENALTY} 回`);
  }
  render(false);
  persist();
});

$('another-btn').addEventListener('click', () => {
  if (!play || play.kind !== 'free') return;
  if (!play.done && play.game.soundings.length && !window.confirm('この海をやめて、べつの海に潜る？')) return;
  sfx.tap();
  startFree(play.depth, true);
});

function finish() {
  play.done = true;
  const { game, kind } = play;
  const value = L.score(game);
  let best = false, sub = '', mainText = null, share = kind === 'daily' || kind === 'free';
  if (kind === 'tutorial') {
    sfx.lesson();
    sub = L.TUTORIAL[play.step].after;
    const last = play.step === L.TUTORIAL.length - 1;
    if (last) { settings.tutorialDone = true; saveSettings(); }
    mainText = last ? '手引きを終えた' : '次へ';
    msg('当たり');
  } else {
    sfx.win();
    const par = L.DEPTHS[play.depth].par;
    sub = `目安 ${par} 回${game.misses ? `・外れ ${game.misses} 回` : ''}`;
    if (kind === 'daily') {
      if (L.recordDaily(records, play.date, value, true)) best = L.recordClear(records, play.depth, value);
      saveRecords();
    } else if (kind === 'free') {
      best = L.recordClear(records, play.depth, value);
      saveRecords();
      mainText = 'べつの海';
    } else {
      sub += `。記録は最初に当てた ${records.daily[play.date]?.score} 回のまま`;
    }
    msg('岩をすべて当てた');
  }
  persist();
  render(false);
  $('clear-title').textContent = kind === 'tutorial' ? '当たり' : '岩をすべて当てた';
  $('clear-score-line').hidden = kind === 'tutorial';
  $('clear-score').textContent = value;
  $('clear-sub').textContent = sub;
  $('clear-badge').hidden = !best;
  $('clear-main').hidden = !mainText;
  $('clear-main').textContent = mainText || '';
  $('clear-share').hidden = !share;
  $('clear-row').hidden = kind === 'tutorial';
  clearEl.hidden = false;
  // 出た直後の 0.4 秒は押せない（確定を押した勢いで次を押さないように）
  clearLockUntil = performance.now() + 400;
  clearEl.classList.add('locked');
  setTimeout(() => clearEl.classList.remove('locked'), 400);
}

const unlocked = () => performance.now() >= clearLockUntil;

function toTitle() {
  sfx.tap();
  play = null;
  show(titleEl);
  renderTitle();
  scrollTo(0, 0);
}

$('back-btn').addEventListener('click', toTitle);
$('clear-home').addEventListener('click', () => { if (unlocked()) toTitle(); });
$('clear-main').addEventListener('click', () => {
  if (!unlocked()) return;
  sfx.tap();
  if (play.kind === 'free') startFree(play.depth, true);
  else if (play.step < L.TUTORIAL.length - 1) startTutorial(play.step + 1);
  else toTitle();
});
$('clear-share').addEventListener('click', () => {
  if (!unlocked()) return;
  const d = L.DEPTHS[play.depth];
  const value = L.score(play.game);
  WebAppKit.share({
    text: play.kind === 'daily'
      ? `ECHO REEF 今日の海 ${play.date}（${d.name} ${depthSpec(d)}）を ${value} 回で当てた（目安 ${d.par}）`
      : `ECHO REEF ${d.name} ${depthSpec(d)} を ${value} 回で当てた（目安 ${d.par}）`,
  });
});

renderTitle();
