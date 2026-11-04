// Seedling Garden — SillyTavern extension
// Растение в горшке + питомец, которые растут с каждым сообщением. Магазин, очки, редкий пришелец.

const MODULE = 'seedling_garden';
const BASE = new URL('.', import.meta.url).href;

// ───────────────────────── Данные ─────────────────────────

const SEEDS = {
    pink:    { name: 'Розовый цветок',  price: 5,  col: '#f58fb0', edge: '#c2587e' },
    yellow:  { name: 'Жёлтый цветок',   price: 10, col: '#ffd84a', edge: '#c9a100' },
    white:   { name: 'Белый цветок',    price: 12, col: '#ffffff', edge: '#a9b0bd' },
    blue:    { name: 'Голубой цветок',  price: 15, col: '#6db5ff', edge: '#3b78c4' },
    red:     { name: 'Красный цветок',  price: 15, col: '#ef5350', edge: '#a82a28' },
    purple:  { name: 'Фиолетовый цветок', price: 25, col: '#a77bf0', edge: '#6d46bb' },
    rainbow: { name: 'Радужный цветок', price: 70, col: '#ffffff', edge: '#8a8f99', rare: true },
};

const PETS = {
    chick: { name: 'Цыплёнок',  price: 20,  egg: '#fff3b0' },
    bunny: { name: 'Зайчик',    price: 25,  egg: '#ffe0ea' },
    frog:  { name: 'Лягушонок', price: 25,  egg: '#d6f5d0' },
    cat:   { name: 'Котёнок',   price: 30,  egg: '#ffe9d0' },
    alien: { name: 'Пришелец',  price: 120, egg: '#c9f7e1', rare: true },
};

const CARE = {
    water: { name: 'Вода',        price: 4,  target: 'plant', icon: 'drop' },
    sun:   { name: 'Лампа',       price: 6,  target: 'plant', icon: 'sun' },
    fert:  { name: 'Удобрение',   price: 12, target: 'plant', icon: 'fert' },
    food:  { name: 'Корм',        price: 4,  target: 'pet',   icon: 'food' },
    toy:   { name: 'Игрушка',     price: 6,  target: 'pet',   icon: 'toy' },
    treat: { name: 'Лакомство',   price: 14, target: 'pet',   icon: 'treat' },
};

const MYSTERY_PRICE = 40;
const MYSTERY_ALIEN_CHANCE = 0.04;

const PLANT_XP = [0, 3, 8, 15, 25];     // порог для стадий 0..4
const PET_XP = [0, 4, 12, 24];          // порог для стадий 0..3
const PLANT_STAGES = ['Семя', 'Росток', 'Побег', 'Бутон', 'Цветок'];
const PET_STAGES = ['Яйцо', 'Малыш', 'Подросток', 'Взрослый'];

const DEFAULTS = {
    enabled: true,
    aiComments: false,
    pointsUser: 3,
    pointsChar: 2,
    coins: 30,
    messages: 0,
    bloomed: 0,
    alienUntil: 0,
    minimized: false,
    collapsed: false,
    pos: null,
    inv: { water: 2, sun: 1, fert: 0, food: 0, toy: 0, treat: 0 },
    plant: { seed: 'pink', xp: 0, water: 60, sun: 60, bloomedPaid: false },
    pet: null, // { type, xp, hunger, fun }
};

// ───────────────────────── Состояние ─────────────────────────

const ctx = () => SillyTavern.getContext();

function S() {
    const c = ctx();
    if (!c.extensionSettings[MODULE]) c.extensionSettings[MODULE] = structuredClone(DEFAULTS);
    const s = c.extensionSettings[MODULE];
    for (const k of Object.keys(DEFAULTS)) if (!(k in s)) s[k] = structuredClone(DEFAULTS[k]);
    for (const k of Object.keys(DEFAULTS.inv)) if (!(k in s.inv)) s.inv[k] = 0;
    return s;
}
const save = () => ctx().saveSettingsDebounced();

let tab = 'plant';       // что выбрано для кнопок: plant | pet
let shopTab = 'seeds';
let frame = 0;
let fx = null;           // { kind, who, start }
let bounce = { who: null, until: 0 };
let bubbleTimer = null;
let aiBusy = false;
let lastAi = 0;
const seen = new Set();

const plantStage = (p) => { let st = 0; PLANT_XP.forEach((t, i) => { if (p.xp >= t) st = i; }); return st; };
const petStage = (p) => { let st = 0; PET_XP.forEach((t, i) => { if (p.xp >= t) st = i; }); return st; };
const plantWilted = (p) => p.water <= 0 || p.sun <= 0;
const petSad = (p) => p.hunger <= 0 || p.fun <= 0;
const alienVisible = () => S().messages < S().alienUntil;
const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, v));
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// ───────────────────────── Пиксельная графика ─────────────────────────

const R = (g, x, y, w, h, c) => { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), w, h); };
function E(g, cx, cy, rx, ry, col) {
    for (let y = -ry; y <= ry; y++) {
        const w = Math.round(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry + 0.001))));
        R(g, cx - w, cy + y, w * 2 + 1, 1, col);
    }
}
const EO = (g, cx, cy, rx, ry, fill, out) => { E(g, cx, cy, rx + 1, ry + 1, out); E(g, cx, cy, rx, ry, fill); };

function drawMap(g, map, legend, x, y) {
    map.forEach((row, j) => [...row].forEach((ch, i) => { if (legend[ch]) R(g, x + i, y + j, 1, 1, legend[ch]); }));
}

const ICONS = {
    drop: { m: ['....##....', '...#bb#...', '..#bbbb#..', '..#bwbb#..', '.#bwbbbb#.', '.#bbbbbb#.', '.#bbbbbb#.', '..#bbbb#..', '...####...', '..........'], l: { '#': '#4a90b8', b: '#8fd3f0', w: '#fff' } },
    sun: { m: ['....oo....', '.o.oyyo.o.', '..oyyyyo..', '.oyyyyyyo.', 'ooyyyyyyoo', 'ooyyyyyyoo', '.oyyyyyyo.', '..oyyyyo..', '.o.oyyo.o.', '....oo....'], l: { o: '#e6a817', y: '#ffe45c' } },
    fert: { m: ['..######..', '..#gggg#..', '...####...', '.########.', '#bbbbbbbb#', '#bbwwwwbb#', '#bbwwwwbb#', '#bbbbbbbb#', '#bbbbbbbb#', '.########.'], l: { '#': '#7a5a3a', b: '#c9a272', w: '#fff4dc', g: '#7fd321' } },
    food: { m: ['..........', '...r.r....', '..rrrrr...', '.rrrrrrr..', '..........', '.########.', '#pppppppp#', '#pppppppp#', '.#pppppp#.', '..######..'], l: { '#': '#c04f6e', p: '#f48fb1', r: '#a0663a' } },
    toy: { m: ['...####...', '..#rrrr#..', '.#rwwrrr#.', '#rrwrrrrr#', '#rrrrrrrr#', '#rrrrrrrb#', '#rrrrrrbb#', '.#rrrbbb#.', '..#bbbb#..', '...####...'], l: { '#': '#7a4a8a', r: '#f48fb1', w: '#fff', b: '#b39ddb' } },
    treat: { m: ['....##....', '....yy....', '...#yy#...', '##yyyyyy##', '.#yyyyyy#.', '..#yyyy#..', '..#yyyy#..', '.#yy##yy#.', '.#y#..#y#.', '..#....#..'], l: { '#': '#c98a00', y: '#ffd84a' } },
    packet: { m: ['.########.', '#wwwwwwww#', '#wccccccw#', '#wccccccw#', '#wcwwwwcw#', '#wccccccw#', '#wwwwwwww#', '#wbbbbbbw#', '#wwwwwwww#', '.########.'], l: { '#': '#8a8f99', w: '#fff', b: '#e4e7ec' } },
    heart: { m: ['.##.##.', '#rr#rr#', '#rrrrr#', '.#rrr#.', '..#r#..', '...#...'], l: { '#': '#c2587e', r: '#ff8fb1' } },
    can: { m: ['....##....', '....##....', '...####...', '..######..', '.########.', '.#wwwwww#.', '..######..'], l: { '#': '#7aa6b8', w: '#e8f4f8' } },
    star: { m: ['..y..', '.yyy.', 'yyyyy', '.yyy.', '..y..'], l: { y: '#ffe45c' } },
};
const drawIcon = (g, name, x, y, color) => {
    const ic = ICONS[name];
    const l = { ...ic.l };
    if (color) l.c = color;
    drawMap(g, ic.m, l, x, y);
};

function drawEgg(g, cx, cy, rx, ry, type, t = 0) {
    const col = PETS[type]?.egg || '#e4d8ff';
    const wob = Math.round(Math.sin(t / 2) * 1);
    EO(g, cx + wob, cy, rx, ry, col, '#7b7f88');
    const sp = type === 'alien' ? '#6fe0a0' : type === 'mystery' ? '#a77bf0' : '#ffffff';
    R(g, cx - 2 + wob, cy - 3, 2, 2, sp); R(g, cx + 2 + wob, cy + 1, 2, 2, sp); R(g, cx - 3 + wob, cy + 3, 2, 1, sp);
    if (type === 'mystery') {
        drawMap(g, ['.##.', '#..#', '..#.', '.#..', '....', '.#..'], { '#': '#6d46bb' }, cx - 2 + wob, cy - 4);
    }
}

function drawPlant(g, p, t) {
    const cx = 22, gy = 50;
    const st = plantStage(p);
    const wilt = plantWilted(p);
    const seed = SEEDS[p.seed] || SEEDS.pink;
    const bob = (tabBounce('plant')) ? -2 : 0;

    E(g, cx, gy, 17, 4, '#b6e51d'); E(g, cx - 5, gy - 1, 9, 2, '#cdf43f');
    // горшок
    const sy = gy - 13 + 0;
    EO(g, cx, gy - 5, 6, 4, '#f2a9bd', '#a85d74');
    R(g, cx - 7, gy - 11, 15, 4, '#a85d74'); R(g, cx - 6, gy - 10, 13, 2, '#f7c6d3');
    R(g, cx - 5, gy - 12, 11, 2, '#7d5a44');
    R(g, cx - 5, gy - 6, 2, 4, '#e08fa6');

    const heights = [0, 4, 9, 14, 18];
    const h = heights[st];
    const top = sy - h + bob;
    const stem = wilt ? '#8f9a3a' : '#3f9a2b';
    const leaf = wilt ? '#b5a642' : '#7fd321';
    const leafEdge = wilt ? '#7c722a' : '#4fa21f';
    const sway = Math.round(Math.sin(t / 3));

    if (st === 0) {
        R(g, cx - 1, sy - 1, 3, 2, '#6b4a2f'); R(g, cx, sy - 2, 1, 1, '#8a6a52');
        return;
    }
    R(g, cx - 1, top, 2, h, stem); R(g, cx, top, 1, h, wilt ? '#a8b04a' : '#5fc03e');

    const leafAt = (y, w, droop) => {
        const d = wilt ? 2 : droop;
        R(g, cx - w - 1, y + d - 1, w, 3, leafEdge); R(g, cx - w, y + d - 1, w - 1, 2, leaf);
        R(g, cx + 2, y + d - 1, w, 3, leafEdge); R(g, cx + 2, y + d - 1, w - 1, 2, leaf);
    };
    if (st === 1) leafAt(top + 1, 3, 0);
    if (st >= 2) leafAt(top + (st === 2 ? 1 : 5), 6, 0);
    if (st >= 3) leafAt(top + 9, 5, 1);

    if (st === 3) {
        const hx = cx + sway * 0, hy = top - 1;
        E(g, hx, hy - 2, 3, 4, seed.edge); E(g, hx, hy - 2, 2, 3, p.seed === 'rainbow' ? '#ff8fb1' : seed.col);
        R(g, hx - 2, hy + 1, 5, 2, '#4fa21f');
    }
    if (st === 4) {
        const hx = cx, hy = top - 4;
        const cols = p.seed === 'rainbow'
            ? ['#ef5350', '#ff9f43', '#ffd84a', '#7ed957', '#6db5ff', '#a77bf0', '#f58fb0', '#ffffff']
            : Array(8).fill(seed.col);
        const edge = p.seed === 'rainbow' ? '#8a8f99' : seed.edge;
        const sh = wilt ? 1 : 0;
        const pet = [[-2, -6, 4, 4], [-2, 2, 4, 4], [-6, -2, 4, 4], [2, -2, 4, 4], [-5, -5, 3, 3], [2, -5, 3, 3], [-5, 2, 3, 3], [2, 2, 3, 3]];
        pet.forEach(([dx, dy, w, hh]) => R(g, hx + dx - 1, hy + dy - 1 + sh, w + 2, hh + 2, edge));
        pet.forEach(([dx, dy, w, hh], i) => R(g, hx + dx, hy + dy + sh, w, hh, cols[i]));
        R(g, hx - 2, hy - 2 + sh, 4, 4, '#c58d00'); R(g, hx - 1, hy - 1 + sh, 2, 2, '#ffe45c');
    }
    if (wilt && Math.floor(t / 2) % 2 === 0) drawIcon(g, 'drop', cx + 8, top - 4);
}

const tabBounce = (who) => bounce.who === who && Date.now() < bounce.until;

function eyes(g, bx, by, gap, blink) {
    if (blink) { R(g, bx - gap - 1, by + 1, 3, 1, '#2b2b33'); R(g, bx + gap - 1, by + 1, 3, 1, '#2b2b33'); return; }
    R(g, bx - gap - 1, by - 1, 2, 3, '#2b2b33'); R(g, bx + gap - 1, by - 1, 2, 3, '#2b2b33');
    R(g, bx - gap - 1, by - 1, 1, 1, '#fff'); R(g, bx + gap - 1, by - 1, 1, 1, '#fff');
}

function drawPet(g, pet, t) {
    const cx = 58, gy = 50;
    E(g, cx, gy, 17, 4, '#b6e51d'); E(g, cx + 4, gy - 1, 8, 2, '#cdf43f');
    if (!pet) {
        // пустое гнёздышко
        E(g, cx, gy - 3, 9, 3, '#c9a272'); E(g, cx, gy - 4, 7, 2, '#e4c79a');
        drawMap(g, ['.##.', '#..#', '..#.', '.#..', '....', '.#..'], { '#': '#b8bcc6' }, cx - 2, gy - 18);
        return;
    }
    const st = petStage(pet);
    const sad = petSad(pet);
    const up = tabBounce('pet') ? 2 : 0;
    if (st === 0) { drawEgg(g, cx, gy - 9 - up, 6, 8, pet.type, t); return; }

    const dims = [null, [6, 5], [8, 7], [10, 8]][st];
    const [rx, ry] = dims;
    const hover = pet.type === 'alien' ? 2 + Math.round(Math.sin(t / 2) * 2) : (t % 2 ? 1 : 0);
    const bx = cx, by = gy - ry - 2 - hover - up;
    const blink = t % 11 === 0;
    const outline = sad ? '#7b7f88' : null;

    if (pet.type === 'alien') {
        E(g, cx, gy - 1, Math.max(4, 8 - hover), 2, '#98c86a');
        EO(g, bx, by + 3, 3, 3, '#7fd9a0', '#2f8f58');
        EO(g, bx, by - 1, rx + 1, ry + 1, '#8fe8a8', '#2f8f58');
        [[-1, 1], [1, 1]].forEach(([s]) => {
            const ex = bx + s * Math.round(rx / 2);
            R(g, ex - 2, by - 2, 4, 4, '#1b1b2f'); R(g, ex - 1 + (s > 0 ? 1 : 0), by - 2, 1, 1, '#fff');
        });
        R(g, bx - 1, by + ry - 1, 3, 1, '#2f8f58');
        R(g, bx - 4, by - ry - 5, 1, 5, '#2f8f58'); R(g, bx + 4, by - ry - 5, 1, 5, '#2f8f58');
        R(g, bx - 5, by - ry - 7, 3, 3, '#ffe45c'); R(g, bx + 3, by - ry - 7, 3, 3, '#ffe45c');
        if (t % 4 < 2) drawIcon(g, 'star', bx + rx + 3, by - ry - 2);
        if (t % 4 >= 2) drawIcon(g, 'star', bx - rx - 8, by - 2);
        return;
    }

    const T = {
        chick: { col: '#ffe45c', edge: '#c9a100' },
        bunny: { col: '#ffffff', edge: '#8e95a3' },
        cat:   { col: '#ffb86b', edge: '#b86a1f' },
        frog:  { col: '#7ed957', edge: '#3c8a2a' },
    }[pet.type];

    if (pet.type === 'bunny') {
        EO(g, bx - 3, by - ry - 5, 2, 5, '#fff', '#8e95a3'); E(g, bx - 3, by - ry - 4, 1, 3, '#f6b8c8');
        EO(g, bx + 3, by - ry - 5, 2, 5, '#fff', '#8e95a3'); E(g, bx + 3, by - ry - 4, 1, 3, '#f6b8c8');
    }
    if (pet.type === 'cat') {
        [[-1], [1]].forEach(([s]) => {
            const ex = bx + s * (rx - 2);
            R(g, ex - 2, by - ry - 3, 5, 4, T.edge); R(g, ex - 1, by - ry - 2, 3, 3, T.col); R(g, ex, by - ry - 1, 1, 1, '#f6b8c8');
        });
        R(g, bx + rx, by + 2, 3, 2, T.edge); R(g, bx + rx + 2, by - 2, 2, 6, T.edge); R(g, bx + rx + 1, by + 2, 2, 1, T.col);
    }
    EO(g, bx, by, rx, ry, T.col, sad ? '#7b7f88' : T.edge);
    if (pet.type === 'chick') {
        R(g, bx, by - ry - 3, 1, 3, T.edge); R(g, bx - 2, by - ry - 2, 1, 2, T.edge);
        E(g, bx - rx + 2, by + 2, 2, 3, '#ffd23a');
        R(g, bx - 1, by + 1, 3, 2, '#ff9f1c');
        R(g, bx - 3, gy - 2, 2, 2, '#ff9f1c'); R(g, bx + 2, gy - 2, 2, 2, '#ff9f1c');
    }
    if (pet.type === 'bunny') {
        R(g, bx - 1, by + 2, 3, 2, '#f6b8c8'); R(g, bx + rx - 1, by + 3, 3, 3, '#fff');
    }
    if (pet.type === 'cat') {
        R(g, bx - 1, by + 2, 3, 1, '#d9687e');
        R(g, bx - rx - 2, by + 2, 3, 1, '#fff'); R(g, bx + rx, by + 2, 3, 1, '#fff');
        R(g, bx - 2, by - ry + 1, 1, 2, '#b86a1f'); R(g, bx + 2, by - ry + 1, 1, 2, '#b86a1f');
    }
    if (pet.type === 'frog') {
        EO(g, bx - Math.round(rx / 2), by - ry, 3, 3, T.col, T.edge); EO(g, bx + Math.round(rx / 2), by - ry, 3, 3, T.col, T.edge);
        R(g, bx - Math.round(rx / 2) - 1, by - ry - 1, 3, 3, '#fff'); R(g, bx + Math.round(rx / 2) - 1, by - ry - 1, 3, 3, '#fff');
        R(g, bx - Math.round(rx / 2), by - ry, 1, 2, '#2b2b33'); R(g, bx + Math.round(rx / 2), by - ry, 1, 2, '#2b2b33');
        R(g, bx - 3, by + 3, 7, 1, '#2f6f22');
        R(g, bx - rx + 1, by + 1, 2, 2, '#f6b8c8'); R(g, bx + rx - 2, by + 1, 2, 2, '#f6b8c8');
    }
    if (pet.type !== 'frog') eyes(g, bx, by - 1, Math.max(2, Math.round(rx / 2.2)), blink);
    if (sad) { R(g, bx + rx - 1, by - ry, 1, 2, '#8fd3f0'); }
    if (st === 3 && t % 6 < 2) drawIcon(g, 'star', bx + rx + 2, by - ry - 3);
}

function drawFx(g, t) {
    if (!fx) return;
    const age = Date.now() - fx.start;
    if (age > 1400) { fx = null; return; }
    const plantX = 22, petX = 58;
    const x = fx.who === 'plant' ? plantX : petX;
    if (fx.kind === 'water') {
        drawIcon(g, 'can', x - 5, 4);
        for (let i = 0; i < 5; i++) { const yy = 11 + ((age / 35 + i * 7) % 24); R(g, x - 5 + i * 2, yy, 1, 2, '#8fd3f0'); }
    } else if (fx.kind === 'sun') {
        drawIcon(g, 'sun', x - 5, 2 + Math.round(Math.sin(age / 120) * 2));
    } else if (fx.kind === 'food') {
        drawIcon(g, 'food', x - 5, 34);
    } else if (fx.kind === 'toy') {
        drawIcon(g, 'toy', x + 6, 30 - Math.abs(Math.round(Math.sin(age / 110) * 12)));
    } else if (fx.kind === 'grow' || fx.kind === 'love') {
        const n = fx.kind === 'grow' ? 4 : 3;
        for (let i = 0; i < n; i++) {
            const yy = 30 - age / 50 - i * 5, xx = x - 8 + i * 6 + Math.round(Math.sin(age / 90 + i) * 2);
            drawIcon(g, fx.kind === 'grow' ? 'star' : 'heart', xx, yy);
        }
    }
}

function drawScene() {
    const c = document.getElementById('sg-scene');
    if (!c) return;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, c.width, c.height);
    const s = S();
    frame++;
    drawPlant(g, s.plant, frame);
    drawPet(g, s.pet, frame);
    drawFx(g, frame);
}

// ───────────────────────── Комментарии ─────────────────────────

const PLANT_LINES = [
    'Я цветок, а вы тут страсти кипят. Мне даже воды не нужно, я уже сыт сплетнями.',
    '{char} опять смотрит на {user}, будто выбирает, кого из нас полить.',
    'Я слышу всё. Каждое «{word}». У горшка отличная акустика.',
    'Если сюжет станет совсем жарким, прошу пересадить меня к окну.',
    'Фотосинтез — это когда я делаю вид, что не подслушиваю.',
    'Мои корни глубоко, но сюжетные повороты ещё глубже.',
    'Я не говорю, что {char} подозрителен. Я просто листиком показываю в его сторону.',
    'Растите меня быстрее, хочу увидеть финал арки. Спойлеры не нужны.',
    'Вы заметили, что я расту, пока вы решаете судьбу мира? Вот это многозадачность.',
    'Пчёлы мне рассказывали сюжеты и получше. Но этот пока держится.',
];
const PLANT_THIRSTY = [
    'Я... увядаю... но сюжет... продолжайте...',
    'Полей меня, и я расскажу, кто тут виноват.',
    'Даже у драматичных сцен есть предел. У меня — вода на нуле.',
];
const PET_LINES = {
    chick: ['Пи! Я всё записал: {char} слишком часто говорит «{word}».', 'Я маленький, но клюнуть за сюжетную дыру могу.', 'Пи-пи! Это был вердикт по последней сцене.', '{user}, ты бы зёрнышко мне дал, чем драму разводить.'],
    bunny: ['Я прыгнул в сюжет, а там «{word}». Обратно прыгать?', 'Морковь или поцелуй? {char}, определитесь уже.', 'Мои уши слышали больше, чем хотел бы {user}.', 'Если станет страшно, я первым убегу. Сюжет не обсуждается.'],
    frog: ['Ква. Это было про «{word}», и я против.', 'Я болотный эксперт: в этой сцене пахнет интригой.', '{char}, не нервничай, я съем любую муху сюжета.', 'Ква-ква. Перевожу: «Налей воды, герой».'],
    cat: ['Мяу. Я бы опрокинул чашку на «{word}», но это вмешательство в сюжет.', '{char} врёт. Я чувствую. У меня усы.', 'Все роли в этой истории — мои, просто я пока лежу.', 'Если {user} не погладит меня сейчас, зачту это как предательство.'],
    alien: ['Ваша цивилизация говорит «{word}» и называет это общением. Занятно.', 'Я отправил отчёт на родную планету: сюжет оценён в 7 космических слизней из 10.', '{char}, ваш вид странный. Мне нравится. Не делайте резких движений.', 'Я здесь инкогнито. Вы ничего не видели. Это просто светящийся кот.', 'Земляне любят драму и кофе. Предлагаю совместить.'],
};
const PET_HUNGRY = ['Я голоден. Накорми меня или я вмешаюсь в сюжет.', 'Желудок урчит громче, чем {char} на допросе.'];
const REACTIONS = [
    { re: /поцел|люблю|обним|kiss|love|hug|нежн/i, lines: ['Ой-ой, я отвернусь. Но краем глаза посмотрю.', 'Любовная линия пошла. Где мои попкорн и поливалка?', 'Я не краснею. Это лепестки так отсвечивают.'] },
    { re: /удар|драк|кров|кинжал|меч|выстрел|пистолет|fight|blood|sword|gun|knife/i, lines: ['Только не в горшок! Я нейтральная сторона!', 'Тут драка, а я просто тихо сижу и притворяюсь декором.', 'Прошу не использовать меня как оружие. Я ценный экспонат.'] },
    { re: /еда|ужин|обед|завтрак|вино|кофе|чай|food|dinner|wine|coffee|tea/i, lines: ['Кто-то сказал «еда»? Я не голоден, я просто интересуюсь.', 'Если там есть вино, мне капельку для корней.', 'Ужин в сюжете — это всегда к драме. Проверено.'] },
    { re: /ночь|ночи|спальн|кроват|night|bed/i, lines: ['Ночь пошла. Я делаю вид, что сплю, но слушаю.', 'Спальня, да? Я вообще-то на подоконнике, я ничего не видел.'] },
    { re: /деньг|золот|контракт|сделк|money|gold|contract|deal/i, lines: ['Деньги — это бумага. А вот я — настоящий цветок.', 'Любая сделка лучше, когда её слышит растение. Ничего не подпишу.'] },
];

function lastMessageText() {
    const chat = ctx().chat || [];
    for (let i = chat.length - 1; i >= 0; i--) {
        const m = chat[i];
        if (m && !m.is_system && m.mes) return String(m.mes).replace(/<[^>]*>|[*_`~#>]/g, ' ');
    }
    return '';
}
function randomWord(text) {
    const words = (text.match(/[A-Za-zА-Яа-яЁё]{5,}/g) || []);
    return words.length ? pick(words).toLowerCase() : 'драма';
}
function fill(line) {
    const c = ctx();
    return line.replace(/\{char\}/g, c.name2 || 'герой').replace(/\{user\}/g, c.name1 || 'ты').replace(/\{word\}/g, randomWord(lastMessageText()));
}

function localComment(who) {
    const s = S();
    const text = lastMessageText();
    if (who === 'plant') {
        if (plantWilted(s.plant)) return fill(pick(PLANT_THIRSTY));
    } else if (s.pet && petSad(s.pet) && Math.random() < 0.6) {
        return fill(pick(PET_HUNGRY));
    }
    if (text && Math.random() < 0.45) {
        const r = REACTIONS.find((x) => x.re.test(text));
        if (r) return fill(pick(r.lines));
    }
    if (who === 'plant') return fill(pick(PLANT_LINES));
    return fill(pick(PET_LINES[s.pet.type] || PET_LINES.chick));
}

async function aiComment(who) {
    const c = ctx();
    const fn = c.generateQuietPrompt;
    if (!fn) return null;
    const s = S();
    const me = who === 'plant' ? 'цветок в горшке' : `питомец (${PETS[s.pet.type].name.toLowerCase()})`;
    const prompt = `[OOC: Ты — ${me}, живёшь в уголке экрана чата и наблюдаешь за ролевой игрой. Отреагируй на текущую сцену одной короткой смешной репликой (до 20 слов), в характере своего существа. Без кавычек, без описания действий, без пояснений.]`;
    const res = fn.length <= 1 ? await fn({ quietPrompt: prompt }) : await fn(prompt, false, false);
    const out = String(res || '').replace(/^["«»\s]+|["«»\s]+$/g, '').split('\n')[0];
    return out && out.length < 220 ? out : null;
}

function say(who, text, ms = 5200) {
    const b = document.getElementById('sg-bubble');
    if (!b) return;
    b.textContent = text;
    b.style.left = who === 'plant' ? '4px' : 'auto';
    b.style.right = who === 'plant' ? 'auto' : '4px';
    b.style.top = '4px';
    b.classList.add('sg-on');
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => b.classList.remove('sg-on'), ms);
}

async function talk(who) {
    const s = S();
    if (who === 'pet' && !s.pet) {
        say('pet', 'Тут пока пусто... В магазине продают яйца!');
        return;
    }
    bounce = { who, until: Date.now() + 350 };
    fx = { kind: 'love', who, start: Date.now() };
    const useAi = s.aiComments && !aiBusy && Date.now() - lastAi > 20000;
    if (useAi) {
        aiBusy = true; lastAi = Date.now();
        say(who, '...', 12000);
        try {
            const r = await aiComment(who);
            say(who, r || localComment(who));
        } catch (e) {
            console.warn('[Seedling Garden] AI comment failed', e);
            say(who, localComment(who));
        } finally { aiBusy = false; }
    } else {
        say(who, localComment(who));
    }
}

// ───────────────────────── Игровая логика ─────────────────────────

function tick(isUser) {
    const s = S();
    if (!s.enabled) return;
    s.coins += isUser ? s.pointsUser : s.pointsChar;
    s.messages++;

    const p = s.plant;
    p.water = clamp(p.water - 4); p.sun = clamp(p.sun - 3);
    const before = plantStage(p);
    p.xp += plantWilted(p) ? 0.25 : 1;
    if (plantStage(p) === 4 && before < 4 && !p.bloomedPaid) {
        p.bloomedPaid = true; s.bloomed++; s.coins += 15;
        say('plant', 'Я расцвёл! +15 очков. Теперь можно красоваться на весь чат.');
    }

    if (s.pet) {
        s.pet.hunger = clamp(s.pet.hunger - 4); s.pet.fun = clamp(s.pet.fun - 3);
        const pb = petStage(s.pet);
        s.pet.xp += petSad(s.pet) ? 0.25 : 1;
        if (petStage(s.pet) > pb) say('pet', pb === 0 ? 'Крак! Я вылупился!' : 'Я вырос! Смотрите, какой я большой.');
    }

    if (s.messages % 10 === 0 && !alienVisible() && Math.random() < 0.12) {
        s.alienUntil = s.messages + 40;
        const sb = document.getElementById('sg-store-btn');
        sb?.classList.add('sg-ping');
        say('plant', 'В магазине что-то мерцает... Похоже, там редкий гость!', 7000);
    } else if (s.messages % 12 === 0) {
        talk(Math.random() < 0.5 || !s.pet ? 'plant' : 'pet');
    }
    save();
    renderUI();
}

function useItem(kind) {
    const s = S();
    const p = s.plant;
    const need = { water: 'water', sun: 'sun', grow: tab === 'plant' ? 'fert' : 'treat', feed: 'food', play: 'toy' }[kind];
    if (tab === 'pet' && !s.pet) { say('pet', 'Сначала нужен питомец. Загляни в магазин!'); return; }
    if (!s.inv[need]) {
        say(tab, `Нет предмета «${CARE[need].name}». Купи его в магазине!`);
        document.getElementById('sg-store-btn')?.classList.add('sg-ping');
        return;
    }
    s.inv[need]--;
    if (kind === 'water') { p.water = clamp(p.water + 45); fx = { kind: 'water', who: 'plant', start: Date.now() }; say('plant', 'Буль-буль! Как приятно.', 2500); }
    if (kind === 'sun') { p.sun = clamp(p.sun + 45); fx = { kind: 'sun', who: 'plant', start: Date.now() }; say('plant', 'Загораю! Не мешайте фотосинтезу.', 2500); }
    if (kind === 'feed') { s.pet.hunger = clamp(s.pet.hunger + 45); fx = { kind: 'food', who: 'pet', start: Date.now() }; say('pet', 'Ням-ням!', 2500); }
    if (kind === 'play') { s.pet.fun = clamp(s.pet.fun + 45); fx = { kind: 'toy', who: 'pet', start: Date.now() }; say('pet', 'Ещё! Ещё!', 2500); }
    if (kind === 'grow') {
        if (tab === 'plant') { p.xp += 3; fx = { kind: 'grow', who: 'plant', start: Date.now() }; say('plant', 'Расту-расту-расту!', 2500); }
        else { s.pet.xp += 3; fx = { kind: 'grow', who: 'pet', start: Date.now() }; say('pet', 'Чувствую, как расту!', 2500); }
        const sp = plantStage(p);
        if (sp === 4 && !p.bloomedPaid) { p.bloomedPaid = true; s.bloomed++; s.coins += 15; say('plant', 'Я расцвёл! +15 очков.'); }
    }
    save(); renderUI();
}

function buy(kind, id) {
    const s = S();
    const toast = (m) => (window.toastr ? window.toastr.info(m) : say('plant', m));
    let price = 0;
    if (kind === 'seed') price = SEEDS[id].price;
    if (kind === 'pet') price = PETS[id].price;
    if (kind === 'mystery') price = MYSTERY_PRICE;
    if (kind === 'care') price = CARE[id].price;
    if (s.coins < price) { toast('Не хватает очков. Пиши сообщения в чате!'); return; }

    if (kind === 'seed') {
        if (s.plant.seed === id && plantStage(s.plant) < 4) { toast('Это семечко уже растёт у тебя.'); return; }
        if (plantStage(s.plant) > 0 && plantStage(s.plant) < 4 && !confirm('Заменить растущее растение новым семечком? Прогресс сбросится.')) return;
        s.plant = { seed: id, xp: 0, water: 60, sun: 60, bloomedPaid: false };
    } else if (kind === 'pet' || kind === 'mystery') {
        if (s.pet && petStage(s.pet) > 0 && !confirm('Заменить текущего питомца новым яйцом? Прогресс сбросится.')) return;
        let type = id;
        if (kind === 'mystery') type = Math.random() < MYSTERY_ALIEN_CHANCE ? 'alien' : pick(['chick', 'bunny', 'frog', 'cat']);
        s.pet = { type, xp: 0, hunger: 60, fun: 60 };
        if (type === 'alien') toast('Из яйца-загадки что-то светится... Это пришелец!');
    } else {
        s.inv[id]++;
    }
    s.coins -= price;
    save(); renderUI(); renderShop();
}

// ───────────────────────── Интерфейс ─────────────────────────

function html() {
    return `
<div id="sg-launcher" title="Seedling Garden"><canvas id="sg-launch-cv" width="16" height="16"></canvas></div>
<div id="sg-root" class="sg-window">
  <div class="sg-title" id="sg-drag">
    <span>SEEDLING</span>
    <div class="sg-title-btns">
      <div class="sg-tbtn" id="sg-collapse" title="Свернуть окно">_</div>
      <div class="sg-tbtn" id="sg-reset" title="Вернуть на место">&#9633;</div>
      <div class="sg-tbtn" id="sg-close" title="Скрыть в значок">&times;</div>
    </div>
  </div>
  <div class="sg-body" id="sg-body">
    <div class="sg-hud"><span class="sg-coins" id="sg-coins"></span><span class="sg-stage" id="sg-stage"></span></div>
    <div class="sg-scene-wrap">
      <canvas id="sg-scene" width="80" height="56"></canvas>
      <div class="sg-bubble" id="sg-bubble"></div>
    </div>
    <div class="sg-tabs">
      <div class="sg-tab sg-active" data-tab="plant">PLANT</div>
      <div class="sg-tab" data-tab="pet">PET</div>
    </div>
    <div class="sg-meters" id="sg-meters"></div>
    <div class="sg-actions" id="sg-actions"></div>
    <div class="sg-bottom">
      <div id="sg-store-btn" title="Магазин"><img src="${BASE}assets/store.png" alt="STORE"></div>
      <div class="sg-hint" id="sg-hint"></div>
    </div>
    <div id="sg-shop">
      <div class="sg-shop-head"><span>STORE</span><div class="sg-tbtn" id="sg-shop-close">&times;</div></div>
      <div class="sg-shop-tabs">
        <div class="sg-tab sg-active" data-shop="seeds">SEEDS</div>
        <div class="sg-tab" data-shop="pets">PETS</div>
        <div class="sg-tab" data-shop="care">CARE</div>
      </div>
      <div class="sg-shop-list" id="sg-shop-list"></div>
      <div class="sg-shop-foot" id="sg-shop-coins"></div>
    </div>
  </div>
</div>`;
}

function buttonsFor(t) {
    const s = S();
    if (t === 'plant') return [['water', 'WATER', 'water'], ['sun', 'SUN', 'sun'], ['grow', 'GROW!', 'fert']];
    return [['feed', 'FEED', 'food'], ['play', 'PLAY', 'toy'], ['grow', 'GROW!', 'treat']];
}

function meter(label, v, cls) {
    return `<div class="sg-meter ${cls} ${v < 20 ? 'sg-low' : ''}">${label}<div class="sg-meter-bar"><div class="sg-meter-fill" style="width:${Math.round(v)}%"></div></div></div>`;
}

function renderUI() {
    const s = S();
    const root = document.getElementById('sg-root');
    if (!root) return;
    document.getElementById('sg-coins').textContent = `★ ${s.coins}`;
    const stName = tab === 'plant' ? PLANT_STAGES[plantStage(s.plant)] : (s.pet ? PET_STAGES[petStage(s.pet)] : '—');
    document.getElementById('sg-stage').textContent = stName;

    document.querySelectorAll('#sg-root .sg-tabs .sg-tab').forEach((el) => el.classList.toggle('sg-active', el.dataset.tab === tab));

    const m = document.getElementById('sg-meters');
    if (tab === 'plant') m.innerHTML = meter('Вода', s.plant.water, 'sg-water') + meter('Свет', s.plant.sun, 'sg-sun');
    else if (s.pet) m.innerHTML = meter('Сытость', s.pet.hunger, 'sg-hunger') + meter('Радость', s.pet.fun, 'sg-fun');
    else m.innerHTML = '';

    const a = document.getElementById('sg-actions');
    a.innerHTML = buttonsFor(tab).map(([id, label, item], i) => {
        const n = s.inv[item] || 0;
        return `<div class="sg-btn ${i === 0 ? 'sg-primary' : ''} ${n ? '' : 'sg-empty'}" data-act="${id}">${label}<span class="sg-count">${n}</span></div>`;
    }).join('');

    const hint = document.getElementById('sg-hint');
    hint.textContent = s.pet ? 'Нажми на цветок или питомца — они что-нибудь скажут.' : 'Купи яйцо в магазине, чтобы завести питомца. Нажми на цветок — он болтлив.';
    document.getElementById('sg-body').style.display = s.collapsed ? 'none' : '';
    renderShopCoins();
}

function renderShopCoins() {
    const el = document.getElementById('sg-shop-coins');
    if (el) el.textContent = `★ ${S().coins} очков   ·   всего сообщений: ${S().messages}`;
}

function iconCanvas(w, h, fn) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
    fn(g);
    return c;
}

function renderShop() {
    const s = S();
    const list = document.getElementById('sg-shop-list');
    if (!list) return;
    list.innerHTML = '';
    document.querySelectorAll('#sg-shop .sg-shop-tabs .sg-tab').forEach((el) => el.classList.toggle('sg-active', el.dataset.shop === shopTab));
    const add = (icon, name, price, extra, rare, onBuy) => {
        const d = document.createElement('div');
        d.className = `sg-item ${rare ? 'sg-rare' : ''} ${s.coins < price ? 'sg-cant' : ''}`;
        d.appendChild(icon);
        d.insertAdjacentHTML('beforeend', `<div>${name}</div><div class="sg-price">★ ${price}</div>${extra ? `<div class="sg-own">${extra}</div>` : ''}`);
        d.addEventListener('click', onBuy);
        list.appendChild(d);
    };
    if (shopTab === 'seeds') {
        Object.entries(SEEDS).forEach(([id, d]) => {
            const cv = iconCanvas(10, 10, (g) => drawMap(g, ICONS.packet.m, { ...ICONS.packet.l, c: id === 'rainbow' ? '#f58fb0' : d.col }, 0, 0));
            add(cv, d.name, d.price, '', d.rare, () => buy('seed', id));
        });
    }
    if (shopTab === 'pets') {
        Object.entries(PETS).forEach(([id, d]) => {
            if (id === 'alien' && !alienVisible()) return;
            const cv = iconCanvas(24, 24, (g) => drawEgg(g, 12, 13, 7, 9, id, 0));
            add(cv, `Яйцо: ${d.name}`, d.price, '', d.rare, () => buy('pet', id));
        });
        const cv = iconCanvas(24, 24, (g) => drawEgg(g, 12, 13, 7, 9, 'mystery', 0));
        add(cv, 'Яйцо-загадка', MYSTERY_PRICE, 'шанс на редкого', false, () => buy('mystery'));
        if (!alienVisible()) {
            const hint = document.createElement('div');
            hint.className = 'sg-own'; hint.style.gridColumn = '1 / -1'; hint.style.fontSize = '9px';
            hint.textContent = 'Иногда в магазине появляется редкий гость. Заглядывай почаще.';
            list.appendChild(hint);
        }
    }
    if (shopTab === 'care') {
        Object.entries(CARE).forEach(([id, d]) => {
            const cv = iconCanvas(10, 10, (g) => drawIcon(g, d.icon, 0, 0));
            add(cv, d.name, d.price, `есть: ${s.inv[id] || 0}`, false, () => buy('care', id));
        });
    }
    renderShopCoins();
}

function drawLauncher() {
    const c = document.getElementById('sg-launch-cv');
    if (!c) return;
    const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, 16, 16);
    E(g, 8, 14, 6, 2, '#b6e51d');
    R(g, 7, 7, 2, 7, '#3f9a2b');
    R(g, 3, 6, 4, 2, '#7fd321'); R(g, 9, 6, 4, 2, '#7fd321');
}

function applyVisibility() {
    const s = S();
    const root = document.getElementById('sg-root');
    const launcher = document.getElementById('sg-launcher');
    if (!root) return;
    const show = s.enabled && !s.minimized;
    root.classList.toggle('sg-hidden', !show);
    launcher.classList.toggle('sg-show', s.enabled && s.minimized);
}

function applyPos() {
    const s = S();
    const root = document.getElementById('sg-root');
    if (!s.pos) { root.style.left = ''; root.style.top = ''; root.style.right = ''; root.style.bottom = ''; return; }
    const x = Math.min(Math.max(0, s.pos.x), window.innerWidth - 80);
    const y = Math.min(Math.max(0, s.pos.y), window.innerHeight - 40);
    root.style.left = x + 'px'; root.style.top = y + 'px'; root.style.right = 'auto'; root.style.bottom = 'auto';
}

function makeDraggable() {
    const root = document.getElementById('sg-root');
    const handle = document.getElementById('sg-drag');
    let drag = null;
    handle.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.sg-tbtn')) return;
        const r = root.getBoundingClientRect();
        drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
        handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener('pointermove', (e) => {
        if (!drag) return;
        S().pos = { x: e.clientX - drag.dx, y: e.clientY - drag.dy };
        applyPos();
    });
    const end = () => { if (drag) { drag = null; save(); } };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
}

function bindUI() {
    const s = () => S();
    document.getElementById('sg-scene').addEventListener('click', (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const who = (e.clientX - r.left) / r.width < 0.5 ? 'plant' : 'pet';
        talk(who);
    });
    document.querySelectorAll('#sg-root .sg-tabs .sg-tab').forEach((el) => el.addEventListener('click', () => { tab = el.dataset.tab; renderUI(); }));
    document.querySelectorAll('#sg-shop .sg-shop-tabs .sg-tab').forEach((el) => el.addEventListener('click', () => { shopTab = el.dataset.shop; renderShop(); }));
    document.getElementById('sg-actions').addEventListener('click', (e) => {
        const b = e.target.closest('.sg-btn'); if (b) useItem(b.dataset.act);
    });
    document.getElementById('sg-store-btn').addEventListener('click', () => {
        document.getElementById('sg-store-btn').classList.remove('sg-ping');
        renderShop();
        document.getElementById('sg-shop').classList.add('sg-open');
    });
    document.getElementById('sg-shop-close').addEventListener('click', () => document.getElementById('sg-shop').classList.remove('sg-open'));
    document.getElementById('sg-close').addEventListener('click', () => { s().minimized = true; save(); applyVisibility(); });
    document.getElementById('sg-launcher').addEventListener('click', () => { s().minimized = false; save(); applyVisibility(); });
    document.getElementById('sg-collapse').addEventListener('click', () => { s().collapsed = !s().collapsed; save(); renderUI(); });
    document.getElementById('sg-reset').addEventListener('click', () => { s().pos = null; save(); applyPos(); });
    const img = document.querySelector('#sg-store-btn img');
    img.addEventListener('error', () => { img.replaceWith(Object.assign(document.createElement('span'), { textContent: 'STORE', style: 'font-size:11px;font-weight:700' })); });
    makeDraggable();
}

function settingsHtml() {
    const s = S();
    return `
<div class="inline-drawer sg-settings">
  <div class="inline-drawer-toggle inline-drawer-header"><b>Seedling Garden</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>
  <div class="inline-drawer-content">
    <label><input type="checkbox" id="sg-opt-enabled" ${s.enabled ? 'checked' : ''}> Включить расширение</label>
    <label><input type="checkbox" id="sg-opt-ai" ${s.aiComments ? 'checked' : ''}> ИИ-комментарии (используют текущее подключение к API)</label>
    <label>Очки за моё сообщение <input type="number" id="sg-opt-pu" min="0" max="50" value="${s.pointsUser}" class="text_pole"></label>
    <label>Очки за сообщение персонажа <input type="number" id="sg-opt-pc" min="0" max="50" value="${s.pointsChar}" class="text_pole"></label>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
      <div class="menu_button" id="sg-opt-alien">Показать пришельца в магазине (тест)</div>
      <div class="menu_button" id="sg-opt-reset">Сбросить прогресс</div>
    </div>
  </div>
</div>`;
}

function bindSettings() {
    const s = () => S();
    document.getElementById('sg-opt-enabled').addEventListener('change', (e) => { s().enabled = e.target.checked; save(); applyVisibility(); });
    document.getElementById('sg-opt-ai').addEventListener('change', (e) => { s().aiComments = e.target.checked; save(); });
    document.getElementById('sg-opt-pu').addEventListener('change', (e) => { s().pointsUser = Math.max(0, +e.target.value || 0); save(); });
    document.getElementById('sg-opt-pc').addEventListener('change', (e) => { s().pointsChar = Math.max(0, +e.target.value || 0); save(); });
    document.getElementById('sg-opt-alien').addEventListener('click', () => { s().alienUntil = s().messages + 40; save(); renderShop(); });
    document.getElementById('sg-opt-reset').addEventListener('click', () => {
        if (!confirm('Сбросить весь прогресс Seedling Garden?')) return;
        ctx().extensionSettings[MODULE] = structuredClone(DEFAULTS); save(); renderUI(); renderShop(); applyVisibility(); applyPos();
    });
}

function onMessage(isUser, id) {
    const key = `${ctx().chatId}:${id}:${isUser ? 'u' : 'c'}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (seen.size > 400) seen.delete(seen.values().next().value);
    tick(isUser);
}

jQuery(async () => {
    const c = ctx();
    S();
    document.body.insertAdjacentHTML('beforeend', html());
    (document.getElementById('extensions_settings2') || document.getElementById('extensions_settings'))?.insertAdjacentHTML('beforeend', settingsHtml());
    bindUI();
    bindSettings();
    applyPos();
    applyVisibility();
    drawLauncher();
    renderUI();

    c.eventSource.on(c.eventTypes.MESSAGE_SENT, (id) => onMessage(true, id));
    c.eventSource.on(c.eventTypes.MESSAGE_RECEIVED, (id) => onMessage(false, id));
    c.eventSource.on(c.eventTypes.CHAT_CHANGED, () => { renderUI(); });
    window.addEventListener('resize', applyPos);

    setInterval(() => { if (document.getElementById('sg-root') && !document.getElementById('sg-root').classList.contains('sg-hidden')) drawScene(); }, 260);
});
