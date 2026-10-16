'use strict';

const fs = require('fs');
const path = require('path');
const { loadEngine } = require('./load-engine');

const DIRS = [
    { id: 0, dx: 0, dy: -1 },
    { id: 1, dx: -1, dy: 0 },
    { id: 2, dx: 0, dy: 1 },
    { id: 3, dx: 1, dy: 0 }
];
const OPPOSITE = { 0: 2, 1: 3, 2: 0, 3: 1 };

const L2 = new Set(['goal', 'yellowswitch', 'purpleswitch', 'yellowopen', 'purpleopen', 'shadowdoor']);
const L3 = new Set(['wall', 'fighter', 'wizard', 'thief', 'sfighter', 'swizard', 'sthief', 'crate', 'yellowdoor', 'purpledoor']);
const ACTIVE = new Set(['fighter', 'wizard', 'thief']);
const STATUES = new Set(['sfighter', 'swizard', 'sthief']);
const MOVABLE = new Set(['crate', 'sfighter', 'swizard', 'sthief']);
const HERO = new Set(['fighter', 'wizard', 'thief', 'sfighter', 'swizard', 'sthief']);

const BASE_GLYPH = {
    wall: '#',
    fighter: 'F',
    wizard: 'W',
    thief: 'T',
    sfighter: '1',
    sthief: '2',
    swizard: '3',
    crate: '*',
    goal: 'G',
    yellowdoor: '[',
    purpledoor: ']',
    yellowswitch: '{',
    purpleswitch: '}'
};

const CANON = {
    background: 'Background',
    goal: 'Goal',
    wall: 'Wall',
    fighter: 'Fighter',
    wizard: 'Wizard',
    thief: 'Thief',
    sfighter: 'SFighter',
    swizard: 'SWizard',
    sthief: 'SThief',
    crate: 'Crate',
    yellowswitch: 'YellowSwitch',
    yellowopen: 'YellowOpen',
    yellowdoor: 'YellowDoor',
    purpleswitch: 'PurpleSwitch',
    purpleopen: 'PurpleOpen',
    purpledoor: 'PurpleDoor'
};

const ACTION_INVERSE = {
    'thief|sfighter': ['fighter', 'sthief'],
    'wizard|sthief': ['thief', 'swizard'],
    'fighter|swizard': ['wizard', 'sfighter'],
    'wizard|sfighter': ['fighter', 'swizard'],
    'fighter|sthief': ['thief', 'sfighter'],
    'thief|swizard': ['wizard', 'sthief']
};

const GLYPH_POOL = 'abcdehijklmnopqrsuvxyz0456789'.split('');

function argValue(name, fallback) {
    const index = process.argv.indexOf(name);
    if (index === -1 || index + 1 >= process.argv.length) {
        return fallback;
    }
    return process.argv[index + 1];
}

function mulberry32(seed) {
    let value = seed >>> 0;
    return function rng() {
        value |= 0;
        value = value + 0x6D2B79F5 | 0;
        let t = Math.imul(value ^ value >>> 15, 1 | value);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

function pick(rng, list) {
    return list[Math.floor(rng() * list.length)];
}

function shuffle(rng, list) {
    const copy = list.slice();
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = copy[i];
        copy[i] = copy[j];
        copy[j] = tmp;
    }
    return copy;
}

function makeGrid(w, h) {
    const l2 = [];
    const l3 = [];
    for (let x = 0; x < w; x++) {
        l2.push(new Array(h).fill(null));
        l3.push(new Array(h).fill(null));
    }
    return { w: w, h: h, l2: l2, l3: l3 };
}

function cloneGrid(grid) {
    const next = makeGrid(grid.w, grid.h);
    for (let x = 0; x < grid.w; x++) {
        for (let y = 0; y < grid.h; y++) {
            next.l2[x][y] = grid.l2[x][y];
            next.l3[x][y] = grid.l3[x][y];
        }
    }
    return next;
}

function inside(grid, x, y) {
    return x >= 0 && y >= 0 && x < grid.w && y < grid.h;
}

function paintBit(objects, cellIndex, id) {
    const stride = ps.STRIDE_OBJ;
    const word = id >> 5;
    const bit = id & 31;
    objects[cellIndex * stride + word] |= (1 << bit);
}

function namesAt(objects, cellIndex) {
    const stride = ps.STRIDE_OBJ;
    const base = cellIndex * stride;
    const names = [];
    for (let word = 0; word < stride; word++) {
        let bits = objects[base + word] >>> 0;
        let bit = 0;
        while (bits) {
            if (bits & 1) {
                const name = ps.state.idDict[word * 32 + bit];
                if (name) {
                    names.push(name);
                }
            }
            bits >>>= 1;
            bit++;
        }
    }
    return names;
}

function hashObjects(objects) {
    let out = '';
    for (let i = 0; i < objects.length; i++) {
        out += objects[i].toString(36);
        out += '.';
    }
    return out;
}

function sameObjects(a, b) {
    if (a.length !== b.length) {
        return false;
    }
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            return false;
        }
    }
    return true;
}

function ensureLevel(w, h) {
    const level = ps.level;
    const cells = w * h * ps.STRIDE_OBJ;
    if (level && level.width === w && level.height === h && level.objects && level.objects.length === cells) {
        return;
    }
    const next = new ps.Level(0, w, h, ps.state.collisionLayers.length, null);
    next.objects = new Int32Array(cells);
    ps.level = next;
    ps.RebuildLevelArrays();
}

function runInput(dir) {
    const level = ps.level;
    const w = level.width;
    const h = level.height;
    if (level.movements) {
        level.movements.fill(0);
    }
    let changed = false;
    try {
        changed = ps.processInput(dir, true) ? true : false;
    } catch (err) {
        return null;
    }
    if (!ps.level || ps.level.width !== w || ps.level.height !== h || !ps.level.objects) {
        return null;
    }
    const objects = new Int32Array(ps.level.objects);
    ps.resetFlags();
    return { changed: changed, objects: objects, w: w, h: h };
}

function gridToSnap(grid) {
    ensureLevel(grid.w, grid.h);
    const objects = ps.level.objects;
    objects.fill(0);
    for (let x = 0; x < grid.w; x++) {
        for (let y = 0; y < grid.h; y++) {
            const cell = x * grid.h + y;
            paintBit(objects, cell, ids.background);
            const floor = grid.l2[x][y];
            const piece = grid.l3[x][y];
            if (floor) {
                paintBit(objects, cell, ids[floor]);
            }
            if (piece) {
                paintBit(objects, cell, ids[piece]);
            }
        }
    }
    const settled = runInput(-1);
    if (!settled) {
        return null;
    }
    return { w: settled.w, h: settled.h, objects: settled.objects };
}

function restore(snap) {
    ensureLevel(snap.w, snap.h);
    ps.level.objects.set(snap.objects);
    if (ps.level.movements) {
        ps.level.movements.fill(0);
    }
    ps.resetFlags();
}

function readGrid(snap) {
    const grid = makeGrid(snap.w, snap.h);
    for (let x = 0; x < snap.w; x++) {
        for (let y = 0; y < snap.h; y++) {
            const names = namesAt(snap.objects, x * snap.h + y);
            for (let i = 0; i < names.length; i++) {
                const name = names[i];
                if (L2.has(name)) {
                    grid.l2[x][y] = name;
                } else if (L3.has(name)) {
                    grid.l3[x][y] = name;
                }
            }
        }
    }
    return grid;
}

function isWinGrid(grid) {
    let heroes = 0;
    let goals = 0;
    let both = 0;
    for (let x = 0; x < grid.w; x++) {
        for (let y = 0; y < grid.h; y++) {
            const hero = HERO.has(grid.l3[x][y]);
            const goal = grid.l2[x][y] === 'goal';
            if (hero) {
                heroes++;
            }
            if (goal) {
                goals++;
            }
            if (hero && goal) {
                both++;
            }
        }
    }
    return heroes > 0 && heroes === both && goals === both;
}

function isWinSnap(snap) {
    return isWinGrid(readGrid(snap));
}

function findActive(grid) {
    const found = [];
    for (let x = 0; x < grid.w; x++) {
        for (let y = 0; y < grid.h; y++) {
            if (ACTIVE.has(grid.l3[x][y])) {
                found.push({ x: x, y: y, name: grid.l3[x][y] });
            }
        }
    }
    if (found.length !== 1) {
        return null;
    }
    return found[0];
}

function findStatues(grid) {
    const found = [];
    for (let x = 0; x < grid.w; x++) {
        for (let y = 0; y < grid.h; y++) {
            if (STATUES.has(grid.l3[x][y])) {
                found.push({ x: x, y: y, name: grid.l3[x][y] });
            }
        }
    }
    return found;
}

function movableSig(snap) {
    const grid = readGrid(snap);
    const parts = [];
    for (let x = 0; x < grid.w; x++) {
        for (let y = 0; y < grid.h; y++) {
            if (MOVABLE.has(grid.l3[x][y])) {
                parts.push(grid.l3[x][y] + '@' + x + ',' + y);
            }
        }
    }
    parts.sort();
    return parts.join('|');
}

function dumpGrid(grid) {
    const lines = [];
    for (let y = 0; y < grid.h; y++) {
        let row = '';
        for (let x = 0; x < grid.w; x++) {
            const piece = grid.l3[x][y];
            const floor = grid.l2[x][y];
            if (piece && floor) {
                row += (piece[0] + floor[0]).slice(0, 2);
            } else if (piece) {
                row += piece.slice(0, 2).padEnd(2, ' ');
            } else if (floor) {
                row += floor.slice(0, 2).padEnd(2, ' ');
            } else {
                row += '. ';
            }
        }
        lines.push(row);
    }
    return lines.join('\n');
}

function emptyL3(grid, x, y) {
    return inside(grid, x, y) && grid.l3[x][y] === null;
}

function predecessorCandidates(grid) {
    const hero = findActive(grid);
    if (!hero) {
        return [];
    }
    const out = [];

    for (let d = 0; d < DIRS.length; d++) {
        const dir = DIRS[d];
        const ox = hero.x - dir.dx;
        const oy = hero.y - dir.dy;
        if (emptyL3(grid, ox, oy)) {
            const walked = cloneGrid(grid);
            walked.l3[hero.x][hero.y] = null;
            walked.l3[ox][oy] = hero.name;
            out.push({ grid: walked, input: dir.id, kind: 'walk' });
        }

        if (hero.name === 'fighter') {
            for (let length = 1; length <= 2; length++) {
                const pushed = undoPush(grid, hero, dir, length);
                if (pushed) {
                    out.push({ grid: pushed, input: dir.id, kind: 'push' });
                }
            }
        }

        if (hero.name === 'thief') {
            const pulled = undoPull(grid, hero, dir);
            if (pulled) {
                out.push({ grid: pulled, input: dir.id, kind: 'pull' });
            }
        }

        if (hero.name === 'wizard') {
            const swapped = undoSwap(grid, hero, dir);
            if (swapped) {
                out.push({ grid: swapped, input: OPPOSITE[dir.id], kind: 'swap' });
            }
        }
    }

    const action = undoAction(grid, hero);
    if (action) {
        out.push({ grid: action, input: 4, kind: 'action' });
    }
    return out;
}

function undoPush(grid, hero, dir, length) {
    const ox = hero.x - dir.dx;
    const oy = hero.y - dir.dy;
    if (!emptyL3(grid, ox, oy)) {
        return null;
    }
    const spots = [];
    for (let i = 1; i <= length; i++) {
        const x = hero.x + dir.dx * i;
        const y = hero.y + dir.dy * i;
        if (!inside(grid, x, y) || !MOVABLE.has(grid.l3[x][y])) {
            return null;
        }
        spots.push({ x: x, y: y, name: grid.l3[x][y] });
    }
    const next = cloneGrid(grid);
    next.l3[hero.x][hero.y] = null;
    next.l3[ox][oy] = hero.name;
    for (let i = 0; i < spots.length; i++) {
        const from = spots[i];
        const tx = hero.x + dir.dx * i;
        const ty = hero.y + dir.dy * i;
        next.l3[tx][ty] = from.name;
    }
    const last = spots[spots.length - 1];
    if (last.x !== hero.x || last.y !== hero.y) {
        next.l3[last.x][last.y] = null;
    }
    return next;
}

function undoPull(grid, hero, dir) {
    const bx = hero.x - dir.dx;
    const by = hero.y - dir.dy;
    const fx = hero.x - dir.dx * 2;
    const fy = hero.y - dir.dy * 2;
    if (!inside(grid, bx, by) || !MOVABLE.has(grid.l3[bx][by])) {
        return null;
    }
    if (!emptyL3(grid, fx, fy)) {
        return null;
    }
    const next = cloneGrid(grid);
    const moved = grid.l3[bx][by];
    next.l3[hero.x][hero.y] = null;
    next.l3[bx][by] = hero.name;
    next.l3[fx][fy] = moved;
    return next;
}

function undoSwap(grid, hero, dir) {
    let x = hero.x + dir.dx;
    let y = hero.y + dir.dy;
    while (inside(grid, x, y) && grid.l3[x][y] === null) {
        x += dir.dx;
        y += dir.dy;
    }
    if (!inside(grid, x, y) || !MOVABLE.has(grid.l3[x][y])) {
        return null;
    }
    const next = cloneGrid(grid);
    const moved = grid.l3[x][y];
    next.l3[x][y] = hero.name;
    next.l3[hero.x][hero.y] = moved;
    return next;
}

function undoAction(grid, hero) {
    const statues = findStatues(grid);
    if (statues.length !== 1) {
        return null;
    }
    const statue = statues[0];
    const inverse = ACTION_INVERSE[hero.name + '|' + statue.name];
    if (!inverse) {
        return null;
    }
    const next = cloneGrid(grid);
    next.l3[hero.x][hero.y] = inverse[1];
    next.l3[statue.x][statue.y] = inverse[0];
    return next;
}

function verifiedPredecessors(snap) {
    const grid = readGrid(snap);
    const targetHash = hashObjects(snap.objects);
    const guesses = predecessorCandidates(grid);
    const unique = [];
    const seen = new Set();
    for (let i = 0; i < guesses.length; i++) {
        const guess = guesses[i];
        const key = guess.kind + ':' + guess.input + ':' + gridKey(guess.grid);
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        unique.push(guess);
    }

    const accepted = [];
    for (let i = 0; i < unique.length; i++) {
        const guess = unique[i];
        const pre = gridToSnap(guess.grid);
        if (!pre) {
            continue;
        }
        restore(pre);
        const after = runInput(guess.input);
        if (!after || !after.changed) {
            continue;
        }
        if (!sameObjects(after.objects, snap.objects) || after.w !== snap.w || after.h !== snap.h) {
            continue;
        }
        const preHash = hashObjects(pre.objects);
        if (preHash === targetHash) {
            continue;
        }
        accepted.push({
            snap: pre,
            hash: preHash,
            input: guess.input,
            kind: guess.kind,
            win: isWinSnap(pre)
        });
    }
    return accepted;
}

function gridKey(grid) {
    let out = '';
    for (let y = 0; y < grid.h; y++) {
        for (let x = 0; x < grid.w; x++) {
            out += (grid.l2[x][y] || '-') + '/' + (grid.l3[x][y] || '-') + ';';
        }
    }
    return out;
}

function findPuzzle(seedSnap) {
    const queue = [{ snap: seedSnap, depth: 0 }];
    const seen = new Set([hashObjects(seedSnap.objects)]);
    const candidates = [];
    let index = 0;
    let expanded = 0;
    while (index < queue.length && expanded < 700) {
        const current = queue[index++];
        if (current.depth >= 8) {
            continue;
        }
        const options = verifiedPredecessors(current.snap);
        for (let i = 0; i < options.length; i++) {
            const option = options[i];
            if (seen.has(option.hash) || option.win) {
                continue;
            }
            seen.add(option.hash);
            const depth = current.depth + 1;
            const next = { snap: option.snap, depth: depth };
            if (depth >= 4 && !walkSolvable(option.snap)) {
                candidates.push(next);
            }
            if (depth < 8) {
                queue.push(next);
            }
            expanded++;
            if (expanded >= 700) {
                break;
            }
        }
    }
    candidates.sort(function (a, b) {
        return b.depth - a.depth;
    });
    const limit = Math.min(candidates.length, 8);
    for (let i = 0; i < limit; i++) {
        const solution = solve(candidates[i].snap);
        if (!solution || solution.length < 4 || solution.length > 8) {
            continue;
        }
        if (!confirmPath(candidates[i].snap, solution)) {
            continue;
        }
        return { snap: candidates[i].snap, solution: solution };
    }
    return null;
}

function walkSolvable(snap) {
    const grid = readGrid(snap);
    const hero = findActive(grid);
    if (!hero) {
        return false;
    }
    const statues = findStatues(grid);
    for (let i = 0; i < statues.length; i++) {
        if (grid.l2[statues[i].x][statues[i].y] !== 'goal') {
            return false;
        }
    }
    const blocked = [];
    for (let x = 0; x < grid.w; x++) {
        blocked.push(new Array(grid.h).fill(false));
    }
    const goals = [];
    for (let x = 0; x < grid.w; x++) {
        for (let y = 0; y < grid.h; y++) {
            const piece = grid.l3[x][y];
            if (piece === 'wall' || piece === 'yellowdoor' || piece === 'purpledoor' || MOVABLE.has(piece)) {
                blocked[x][y] = true;
            }
            if (grid.l2[x][y] === 'goal' && !HERO.has(piece)) {
                goals.push({ x: x, y: y });
            }
        }
    }
    if (goals.length === 0) {
        return false;
    }
    for (let i = 0; i < goals.length; i++) {
        if (blocked[goals[i].x][goals[i].y]) {
            return false;
        }
    }
    const seen = [];
    for (let x = 0; x < grid.w; x++) {
        seen.push(new Array(grid.h).fill(false));
    }
    const stack = [{ x: hero.x, y: hero.y }];
    seen[hero.x][hero.y] = true;
    while (stack.length) {
        const cell = stack.pop();
        for (let d = 0; d < DIRS.length; d++) {
            const nx = cell.x + DIRS[d].dx;
            const ny = cell.y + DIRS[d].dy;
            if (!inside(grid, nx, ny) || seen[nx][ny] || blocked[nx][ny]) {
                continue;
            }
            seen[nx][ny] = true;
            stack.push({ x: nx, y: ny });
        }
    }
    for (let i = 0; i < goals.length; i++) {
        if (!seen[goals[i].x][goals[i].y]) {
            return false;
        }
    }
    return true;
}

function solve(startSnap) {
    const queue = [{ snap: startSnap, path: [] }];
    const seen = new Set([hashObjects(startSnap.objects)]);
    let index = 0;
    let expanded = 0;
    while (index < queue.length && expanded < 4000) {
        const current = queue[index++];
        if (current.path.length >= 8) {
            continue;
        }
        for (let dir = 0; dir < 5; dir++) {
            restore(current.snap);
            const after = runInput(dir);
            if (!after || !after.changed) {
                continue;
            }
            const snap = { w: after.w, h: after.h, objects: after.objects };
            const key = hashObjects(snap.objects);
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            const path = current.path.concat(dir);
            if (isWinSnap(snap)) {
                return path;
            }
            queue.push({ snap: snap, path: path });
            expanded++;
        }
    }
    return null;
}

function confirmPath(startSnap, path) {
    let snap = startSnap;
    if (isWinSnap(snap)) {
        return null;
    }
    let mechanic = false;
    for (let i = 0; i < path.length; i++) {
        const before = movableSig(snap);
        restore(snap);
        const after = runInput(path[i]);
        if (!after || !after.changed) {
            return null;
        }
        snap = { w: after.w, h: after.h, objects: after.objects };
        if (path[i] === 4 || movableSig(snap) !== before) {
            mechanic = true;
        }
        const won = isWinSnap(snap);
        if (won !== (i === path.length - 1)) {
            return null;
        }
    }
    if (!mechanic) {
        return null;
    }
    return snap;
}

function selfCheck() {
    function expect(condition, message, snap) {
        if (!condition) {
            const extra = snap ? '\n' + dumpGrid(readGrid(snap)) : '';
            throw new Error(message + extra);
        }
    }

    const walk = makeGrid(5, 3);
    for (let x = 0; x < 5; x++) {
        walk.l3[x][0] = 'wall';
        walk.l3[x][2] = 'wall';
    }
    walk.l3[0][1] = 'wall';
    walk.l3[4][1] = 'wall';
    walk.l3[1][1] = 'fighter';
    walk.l2[3][1] = 'goal';
    let snap = gridToSnap(walk);
    expect(snap && !isWinSnap(snap), 'self-check walk setup', snap);
    restore(snap);
    let step = runInput(3);
    expect(step && step.changed, 'self-check first step');
    step = runInput(3);
    snap = { w: step.w, h: step.h, objects: step.objects };
    expect(step && isWinSnap(snap), 'self-check walk win', snap);

    const push = makeGrid(7, 3);
    for (let x = 0; x < 7; x++) {
        push.l3[x][0] = 'wall';
        push.l3[x][2] = 'wall';
    }
    push.l3[0][1] = 'wall';
    push.l3[6][1] = 'wall';
    push.l3[1][1] = 'fighter';
    push.l3[2][1] = 'crate';
    push.l2[4][1] = 'goal';
    snap = gridToSnap(push);
    restore(snap);
    for (let i = 0; i < 3; i++) {
        step = runInput(3);
        expect(step && step.changed, 'self-check push ' + i);
    }
    snap = { w: step.w, h: step.h, objects: step.objects };
    expect(isWinSnap(snap), 'self-check push win', snap);

    const pull = makeGrid(7, 3);
    for (let x = 0; x < 7; x++) {
        pull.l3[x][0] = 'wall';
        pull.l3[x][2] = 'wall';
    }
    pull.l3[0][1] = 'wall';
    pull.l3[6][1] = 'wall';
    pull.l3[2][1] = 'crate';
    pull.l3[3][1] = 'thief';
    pull.l2[4][1] = 'goal';
    snap = gridToSnap(pull);
    restore(snap);
    step = runInput(3);
    snap = { w: step.w, h: step.h, objects: step.objects };
    expect(step && isWinSnap(snap), 'self-check pull win', snap);

    const teleport = makeGrid(7, 3);
    for (let x = 0; x < 7; x++) {
        teleport.l3[x][0] = 'wall';
        teleport.l3[x][2] = 'wall';
    }
    teleport.l3[0][1] = 'wall';
    teleport.l3[6][1] = 'wall';
    teleport.l3[1][1] = 'wizard';
    teleport.l3[4][1] = 'crate';
    teleport.l2[4][1] = 'goal';
    snap = gridToSnap(teleport);
    restore(snap);
    step = runInput(3);
    snap = { w: step.w, h: step.h, objects: step.objects };
    expect(step && isWinSnap(snap), 'self-check wizard swap', snap);

    const action = makeGrid(5, 3);
    for (let x = 0; x < 5; x++) {
        action.l3[x][0] = 'wall';
        action.l3[x][2] = 'wall';
    }
    action.l3[0][1] = 'wall';
    action.l3[4][1] = 'wall';
    action.l3[1][1] = 'fighter';
    action.l3[3][1] = 'sthief';
    snap = gridToSnap(action);
    restore(snap);
    step = runInput(4);
    snap = { w: step.w, h: step.h, objects: step.objects };
    const afterAction = readGrid(snap);
    expect(afterAction.l3[1][1] === 'sfighter' && afterAction.l3[3][1] === 'thief', 'self-check action', snap);

    const door = makeGrid(5, 3);
    for (let x = 0; x < 5; x++) {
        door.l3[x][0] = 'wall';
        door.l3[x][2] = 'wall';
    }
    door.l3[0][1] = 'wall';
    door.l3[4][1] = 'wall';
    door.l2[1][1] = 'yellowswitch';
    door.l3[1][1] = 'crate';
    door.l3[3][1] = 'yellowdoor';
    snap = gridToSnap(door);
    const opened = readGrid(snap);
    expect(opened.l2[3][1] === 'yellowopen' && opened.l3[3][1] === null, 'self-check door opens', snap);

    const pushWin = gridToSnap(push);
    restore(pushWin);
    for (let i = 0; i < 3; i++) {
        step = runInput(3);
    }
    const pushSolved = { w: step.w, h: step.h, objects: step.objects };
    const pushUndos = verifiedPredecessors(pushSolved);
    expect(pushUndos.some(function (option) { return option.kind === 'push'; }), 'self-check push undo', pushSolved);

    const swapWin = gridToSnap(teleport);
    restore(swapWin);
    step = runInput(3);
    const swapSolved = { w: step.w, h: step.h, objects: step.objects };
    const swapUndos = verifiedPredecessors(swapSolved);
    expect(swapUndos.some(function (option) { return option.kind === 'swap'; }), 'self-check swap undo', swapSolved);
}

function parseRows(rows) {
    const height = rows.length;
    const width = rows[0].length;
    const grid = makeGrid(width, height);
    let choke = null;
    const floors = [];
    for (let y = 0; y < height; y++) {
        if (rows[y].length !== width) {
            throw new Error('jagged template row');
        }
        for (let x = 0; x < width; x++) {
            const ch = rows[y][x];
            if (ch === '#') {
                grid.l3[x][y] = 'wall';
            } else if (ch === 'D') {
                choke = { x: x, y: y };
                floors.push({ x: x, y: y, choke: true });
            } else {
                floors.push({ x: x, y: y, choke: false });
            }
        }
    }
    return { grid: grid, choke: choke, floors: floors };
}

function mirrorRows(rows, rng) {
    let next = rows.slice();
    if (rng() < 0.5) {
        next = next.map(function (row) {
            return row.split('').reverse().join('');
        });
    }
    if (rng() < 0.5) {
        next = next.slice().reverse();
    }
    return next;
}

function regionsAround(grid, choke) {
    const seen = [];
    for (let x = 0; x < grid.w; x++) {
        seen.push(new Array(grid.h).fill(false));
    }
    const regions = [];
    for (let x = 0; x < grid.w; x++) {
        for (let y = 0; y < grid.h; y++) {
            if (seen[x][y] || grid.l3[x][y] === 'wall') {
                continue;
            }
            if (choke && x === choke.x && y === choke.y) {
                continue;
            }
            const region = [];
            const stack = [{ x: x, y: y }];
            seen[x][y] = true;
            while (stack.length) {
                const cell = stack.pop();
                region.push(cell);
                for (let d = 0; d < DIRS.length; d++) {
                    const nx = cell.x + DIRS[d].dx;
                    const ny = cell.y + DIRS[d].dy;
                    if (!inside(grid, nx, ny) || seen[nx][ny] || grid.l3[nx][ny] === 'wall') {
                        continue;
                    }
                    if (choke && nx === choke.x && ny === choke.y) {
                        continue;
                    }
                    seen[nx][ny] = true;
                    stack.push({ x: nx, y: ny });
                }
            }
            regions.push(region);
        }
    }
    return regions;
}

function buildSeed(template, rng) {
    const parsed = parseRows(mirrorRows(template.rows, rng));
    const grid = parsed.grid;
    const floors = parsed.floors.filter(function (cell) {
        return !cell.choke;
    });
    const crateCount = Array.isArray(template.crates) ? pick(rng, template.crates) : template.crates;
    const statueName = template.statue ? pick(rng, template.statue) : null;
    const placements = 1 + (statueName ? 1 : 0) + crateCount;

    if (template.mode === 'open') {
        if (floors.length < placements) {
            return null;
        }
        const heroCell = pick(rng, floors);
        grid.l2[heroCell.x][heroCell.y] = 'goal';
        grid.l3[heroCell.x][heroCell.y] = template.hero;
        let cursor = shuffle(rng, floors.filter(function (cell) {
            return cell.x !== heroCell.x || cell.y !== heroCell.y;
        }));
        if (statueName) {
            const statueCell = cursor.shift();
            if (!statueCell) {
                return null;
            }
            grid.l2[statueCell.x][statueCell.y] = 'goal';
            grid.l3[statueCell.x][statueCell.y] = statueName;
        }
        for (let i = 0; i < crateCount; i++) {
            let crateCell = null;
            if (i === 0) {
                const near = cursor.filter(function (cell) {
                    return Math.abs(cell.x - heroCell.x) + Math.abs(cell.y - heroCell.y) === 1;
                });
                if (near.length) {
                    crateCell = pick(rng, near);
                    cursor = cursor.filter(function (cell) {
                        return cell.x !== crateCell.x || cell.y !== crateCell.y;
                    });
                }
            }
            if (!crateCell) {
                crateCell = cursor.shift();
            }
            if (!crateCell) {
                return null;
            }
            grid.l3[crateCell.x][crateCell.y] = 'crate';
        }
        return grid;
    }

    if (!parsed.choke) {
        return null;
    }
    const sides = regionsAround(grid, parsed.choke);
    if (sides.length !== 2) {
        return null;
    }
    const order = rng() < 0.5 ? [0, 1] : [1, 0];
    const goalSide = shuffle(rng, sides[order[0]]);
    const otherSide = shuffle(rng, sides[order[1]]);
    if (goalSide.length < 1 + (statueName ? 1 : 0) || otherSide.length < 1) {
        return null;
    }

    const heroCell = goalSide[0];
    grid.l2[heroCell.x][heroCell.y] = 'goal';
    grid.l3[heroCell.x][heroCell.y] = template.hero;
    if (statueName) {
        if (goalSide.length + otherSide.length < placements) {
            return null;
        }
        const statueCell = goalSide.length > 1 ? goalSide[1] : otherSide[0];
        grid.l2[statueCell.x][statueCell.y] = 'goal';
        grid.l3[statueCell.x][statueCell.y] = statueName;
    }

    if (template.mode === 'door') {
        const distant = otherSide.filter(function (cell) {
            return Math.abs(cell.x - parsed.choke.x) + Math.abs(cell.y - parsed.choke.y) >= 2;
        });
        if (distant.length === 0) {
            return null;
        }
        const switchCell = distant[0];
        grid.l2[switchCell.x][switchCell.y] = template.color + 'switch';
        grid.l3[switchCell.x][switchCell.y] = 'crate';
        grid.l3[parsed.choke.x][parsed.choke.y] = template.color + 'door';
        let extras = crateCount - 1;
        const spare = otherSide.concat(goalSide).filter(function (cell) {
            return grid.l3[cell.x][cell.y] === null && !(cell.x === switchCell.x && cell.y === switchCell.y);
        });
        const extraCells = shuffle(rng, spare);
        for (let i = 0; i < extras && i < extraCells.length; i++) {
            grid.l3[extraCells[i].x][extraCells[i].y] = 'crate';
        }
        return grid;
    }

    const aligned = otherSide.filter(function (cell) {
        return cell.x === heroCell.x || cell.y === heroCell.y;
    });
    const crateCell = aligned.length ? aligned[0] : otherSide[0];
    grid.l3[crateCell.x][crateCell.y] = 'crate';
    if (crateCount > 1) {
        const spare = otherSide.slice(1).concat(goalSide.slice(statueName ? 2 : 1)).filter(function (cell) {
            return grid.l3[cell.x][cell.y] === null;
        });
        if (spare.length === 0) {
            return null;
        }
        const extra = pick(rng, spare);
        grid.l3[extra.x][extra.y] = 'crate';
    }
    return grid;
}

function trimSnap(snap, path) {
    const grid = readGrid(snap);
    let minX = grid.w;
    let minY = grid.h;
    let maxX = -1;
    let maxY = -1;
    for (let x = 0; x < grid.w; x++) {
        for (let y = 0; y < grid.h; y++) {
            if (grid.l3[x][y] !== 'wall' || grid.l2[x][y]) {
                if (x < minX) minX = x;
                if (y < minY) minY = y;
                if (x > maxX) maxX = x;
                if (y > maxY) maxY = y;
            }
        }
    }
    if (maxX < 0) {
        return null;
    }
    minX = Math.max(0, minX - 1);
    minY = Math.max(0, minY - 1);
    maxX = Math.min(grid.w - 1, maxX + 1);
    maxY = Math.min(grid.h - 1, maxY + 1);
    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    if (width === grid.w && height === grid.h) {
        return snap;
    }
    const cropped = makeGrid(width, height);
    for (let x = minX; x <= maxX; x++) {
        for (let y = minY; y <= maxY; y++) {
            cropped.l2[x - minX][y - minY] = grid.l2[x][y];
            cropped.l3[x - minX][y - minY] = grid.l3[x][y];
        }
    }
    const settled = gridToSnap(cropped);
    if (!settled || !confirmPath(settled, path)) {
        return snap;
    }
    return settled;
}

function cellCombo(grid, x, y) {
    const names = [];
    if (grid.l2[x][y]) {
        names.push(grid.l2[x][y]);
    }
    if (grid.l3[x][y]) {
        names.push(grid.l3[x][y]);
    }
    return names;
}

function assignGlyphs(levels) {
    const combos = new Map();
    const reserved = new Set(Object.values(BASE_GLYPH).map(function (ch) {
        return ch.toLowerCase();
    }));
    function glyphFor(names) {
        const key = names.slice().sort().join('+');
        if (combos.has(key)) {
            return combos.get(key).glyph;
        }
        let glyph = null;
        if (names.length === 1 && BASE_GLYPH[names[0]]) {
            glyph = BASE_GLYPH[names[0]];
        } else {
            glyph = GLYPH_POOL.find(function (ch) {
                return !reserved.has(ch);
            });
            if (!glyph) {
                throw new Error('ran out of glyph characters');
            }
            reserved.add(glyph);
        }
        combos.set(key, { glyph: glyph, names: names.slice() });
        return glyph;
    }

    const rendered = levels.map(function (level) {
        const grid = readGrid(level.snap);
        const rows = [];
        for (let y = 0; y < grid.h; y++) {
            let row = '';
            for (let x = 0; x < grid.w; x++) {
                const names = cellCombo(grid, x, y);
                row += names.length === 0 ? '.' : glyphFor(names);
            }
            rows.push(row);
        }
        return rows;
    });

    const legend = [];
    combos.forEach(function (entry) {
        if (entry.names.length === 1 && BASE_GLYPH[entry.names[0]] === entry.glyph) {
            return;
        }
        const parts = entry.names.map(function (name) {
            return CANON[name];
        });
        const joiner = parts.length === 1 ? ' = ' : ' = ';
        const rhs = parts.length === 1 ? parts[0] : parts.join(' and ');
        legend.push(entry.glyph + joiner + rhs);
    });
    return { rendered: rendered, legend: legend };
}

function canonicalKey(snap) {
    const grid = readGrid(snap);
    function rowsFrom(transform) {
        const lines = [];
        for (let y = 0; y < grid.h; y++) {
            let row = '';
            for (let x = 0; x < grid.w; x++) {
                const point = transform(x, y);
                row += (grid.l2[point.x][point.y] || '-') + (grid.l3[point.x][point.y] || '-');
            }
            lines.push(row);
        }
        return lines.join('/');
    }
    const keys = [
        rowsFrom(function (x, y) { return { x: x, y: y }; }),
        rowsFrom(function (x, y) { return { x: grid.w - 1 - x, y: y }; }),
        rowsFrom(function (x, y) { return { x: x, y: grid.h - 1 - y }; }),
        rowsFrom(function (x, y) { return { x: grid.w - 1 - x, y: grid.h - 1 - y }; })
    ];
    keys.sort();
    return keys[0];
}

function buildSource(original, legendLines, maps, labels) {
    let text = original.replace(/\r\n/g, '\n').replace(/^title .*$/m, 'title Generated Heroes');
    const soundsAt = text.indexOf('=======\nSOUNDS\n=======');
    if (soundsAt < 0) {
        throw new Error('SOUNDS section not found');
    }
    const legendBlock = legendLines.length ? legendLines.join('\n') + '\n' : '';
    text = text.slice(0, soundsAt) + legendBlock + text.slice(soundsAt);
    const levelsAt = text.indexOf('=======\nLEVELS\n=======');
    if (levelsAt < 0) {
        throw new Error('LEVELS section not found');
    }
    let body = '';
    for (let i = 0; i < maps.length; i++) {
        body += 'Message ' + labels[i] + '\n\n';
        body += maps[i].join('\n') + '\n\n';
    }
    return text.slice(0, levelsAt) + '=======\nLEVELS\n=======\n\n' + body;
}

function verifyCompiled(solutions) {
    const levels = ps.state.levels;
    const maps = [];
    for (let i = 0; i < levels.length; i++) {
        if (levels[i].message === undefined) {
            maps.push(i);
        }
    }
    if (maps.length !== solutions.length) {
        throw new Error('compiled map count ' + maps.length + ' != solutions ' + solutions.length);
    }
    const failures = [];
    for (let i = 0; i < maps.length; i++) {
        const level = levels[maps[i]];
        if (level.width > 9 || level.height > 7) {
            failures.push(i);
            continue;
        }
        ps.loadLevelFromState(ps.state, maps[i], 'verify');
        ps.resetFlags();
        if (!confirmPath(takeCurrent(), solutions[i])) {
            failures.push(i);
        }
    }
    return failures;
}

function takeCurrent() {
    return {
        w: ps.level.width,
        h: ps.level.height,
        objects: new Int32Array(ps.level.objects)
    };
}

const TEMPLATES = [
    {
        family: 'fighter',
        label: 'Red warrior.',
        hero: 'fighter',
        crates: [1, 2],
        mode: 'open',
        rows: [
            '#######',
            '#.....#',
            '#.....#',
            '#.....#',
            '#.....#',
            '#######'
        ]
    },
    {
        family: 'fighter',
        label: 'Red warrior.',
        hero: 'fighter',
        crates: 1,
        mode: 'open',
        rows: [
            '#########',
            '#.......#',
            '#########'
        ]
    },
    {
        family: 'fighter',
        label: 'Red warrior.',
        hero: 'fighter',
        crates: [1, 2],
        mode: 'open',
        rows: [
            '########',
            '#......#',
            '#......#',
            '########'
        ]
    },
    {
        family: 'thief',
        label: 'Green thief.',
        hero: 'thief',
        crates: 1,
        mode: 'open',
        rows: [
            '########',
            '#......#',
            '#......#',
            '#......#',
            '########'
        ]
    },
    {
        family: 'thief',
        label: 'Green thief.',
        hero: 'thief',
        crates: [1, 2],
        mode: 'open',
        rows: [
            '#######',
            '#.....#',
            '#.....#',
            '#.....#',
            '#.....#',
            '#######'
        ]
    },
    {
        family: 'wizard',
        label: 'Blue wizard.',
        hero: 'wizard',
        crates: 1,
        mode: 'gap',
        rows: [
            '#########',
            '#.......#',
            '####D####',
            '#.......#',
            '#########'
        ]
    },
    {
        family: 'wizard',
        label: 'Blue wizard.',
        hero: 'wizard',
        crates: 1,
        mode: 'gap',
        rows: [
            '#######',
            '#.....#',
            '###D###',
            '#.....#',
            '#.....#',
            '#######'
        ]
    },
    {
        family: 'door',
        label: 'A locked door.',
        hero: 'fighter',
        crates: 1,
        mode: 'door',
        color: 'yellow',
        rows: [
            '#######',
            '#.....#',
            '###D###',
            '#.....#',
            '#.....#',
            '#######'
        ]
    },
    {
        family: 'door',
        label: 'A locked door.',
        hero: 'thief',
        crates: 1,
        mode: 'door',
        color: 'purple',
        rows: [
            '#########',
            '#.......#',
            '####D####',
            '#.......#',
            '#.......#',
            '#########'
        ]
    },
    {
        family: 'door',
        label: 'A locked door.',
        hero: 'wizard',
        crates: 1,
        mode: 'door',
        color: 'yellow',
        rows: [
            '#######',
            '#.....#',
            '#.....#',
            '###D###',
            '#.....#',
            '#.....#',
            '#######'
        ]
    },
    {
        family: 'action',
        label: 'Switch heroes.',
        hero: 'fighter',
        statue: ['sthief', 'swizard'],
        crates: 0,
        mode: 'open',
        rows: [
            '#######',
            '#.....#',
            '#.....#',
            '#.....#',
            '#.....#',
            '#######'
        ]
    },
    {
        family: 'action',
        label: 'Switch heroes.',
        hero: 'fighter',
        statue: ['sthief'],
        crates: 1,
        mode: 'open',
        rows: [
            '########',
            '#......#',
            '#......#',
            '#......#',
            '########'
        ]
    }
];

const MIX = { fighter: 6, thief: 4, wizard: 4, door: 6, action: 4 };

function quotasFor(count) {
    const base = 24;
    const names = Object.keys(MIX);
    const quotas = {};
    let assigned = 0;
    for (let i = 0; i < names.length; i++) {
        const scaled = Math.round(MIX[names[i]] * count / base);
        quotas[names[i]] = scaled;
        assigned += scaled;
    }
    quotas.fighter += count - assigned;
    if (quotas.fighter < 0) {
        quotas.fighter = 0;
    }
    return quotas;
}

function neededFamily(kept, quotas, rng, attempts, maxAttempts) {
    const names = Object.keys(quotas);
    const open = names.filter(function (name) {
        const have = kept.filter(function (level) { return level.family === name; }).length;
        return have < quotas[name];
    });
    if (open.length === 0 || attempts > maxAttempts * 0.75) {
        return pick(rng, names);
    }
    return pick(rng, open);
}

let ps;
let ids;

function boot(source) {
    if (!ps) {
        ps = loadEngine();
    }
    ps.setLazy(false);
    ps.compile(['restart'], source, 'heroes');
    ps.resetFlags();
    if (ps.errorCount > 0) {
        throw new Error('compilation failed\n' + ps.errorStrings.join('\n'));
    }
    if (!ids) {
        ids = {};
        Object.keys(CANON).forEach(function (name) {
            const obj = ps.state.objects[name];
            if (!obj) {
                throw new Error('missing object ' + name);
            }
            ids[name] = obj.id;
        });
        ids.temp = ps.state.objects.temp.id;
        ids.shadowdoor = ps.state.objects.shadowdoor.id;
    }
}

function main() {
    const count = Math.max(1, parseInt(argValue('--count', '24'), 10) || 24);
    const maxAttempts = Math.max(count, parseInt(argValue('--attempts', '400'), 10) || 400);
    const seedText = argValue('--seed', String(Date.now()));
    const seed = parseInt(seedText, 10);
    const rng = mulberry32(Number.isFinite(seed) ? seed : 1);
    const rulesPath = path.join(__dirname, '..', 'src', 'demo', 'heroes_of_sokoban.txt');
    const original = fs.readFileSync(rulesPath, 'utf8');

    const started = Date.now();
    boot(original);
    selfCheck();

    const quotas = quotasFor(count);
    const kept = [];
    const seen = new Set();
    const rejected = { seed: 0, settle: 0, scramble: 0, walk: 0, short: 0, unsolved: 0, duplicate: 0, size: 0 };
    let attempts = 0;

    while (kept.length < count && attempts < maxAttempts) {
        attempts++;
        if (attempts % 25 === 0) {
            process.stdout.write('attempts ' + attempts + ', kept ' + kept.length + '\n');
        }
        const family = neededFamily(kept, quotas, rng, attempts, maxAttempts);
        const choices = TEMPLATES.filter(function (template) { return template.family === family; });
        const template = pick(rng, choices);
        const seeded = buildSeed(template, rng);
        if (!seeded) {
            rejected.seed++;
            continue;
        }
        const solved = gridToSnap(seeded);
        if (!solved || !isWinSnap(solved)) {
            rejected.settle++;
            continue;
        }
        const found = findPuzzle(solved);
        if (!found) {
            rejected.scramble++;
            continue;
        }
        const start = found.snap;
        const solution = found.solution;
        const key = canonicalKey(start);
        if (seen.has(key)) {
            rejected.duplicate++;
            continue;
        }
        const trimmed = trimSnap(start, solution);
        const finalSnap = trimmed || start;
        if (finalSnap.w > 9 || finalSnap.h > 7) {
            rejected.size++;
            continue;
        }
        if (!confirmPath(finalSnap, solution)) {
            rejected.unsolved++;
            continue;
        }
        const finalKey = canonicalKey(finalSnap);
        if (seen.has(finalKey)) {
            rejected.duplicate++;
            continue;
        }
        seen.add(finalKey);
        kept.push({
            snap: finalSnap,
            solution: solution,
            family: template.family,
            label: template.label
        });
    }

    if (kept.length === 0) {
        console.log(JSON.stringify({ attempts: attempts, rejected: rejected }));
        throw new Error('no levels passed the filters');
    }

    const glyphs = assignGlyphs(kept);
    const labels = kept.map(function (level) { return level.label; });
    let source = buildSource(original, glyphs.legend, glyphs.rendered, labels);
    const demoPath = path.join(__dirname, '..', 'src', 'demo', 'generated_heroes.txt');
    const solutionPath = path.join(__dirname, '..', 'src', 'demo', 'generated_heroes.solutions.txt');

    fs.writeFileSync(demoPath, source);
    boot(source);
    let failures = verifyCompiled(kept.map(function (level) { return level.solution; }));
    if (failures.length) {
        const survivors = [];
        for (let i = 0; i < kept.length; i++) {
            if (failures.indexOf(i) === -1) {
                survivors.push(kept[i]);
            }
        }
        if (survivors.length === 0) {
            throw new Error('fresh replay rejected every level');
        }
        const again = assignGlyphs(survivors);
        source = buildSource(original, again.legend, again.rendered, survivors.map(function (level) { return level.label; }));
        fs.writeFileSync(demoPath, source);
        boot(source);
        failures = verifyCompiled(survivors.map(function (level) { return level.solution; }));
        if (failures.length) {
            throw new Error('replay still failing after a second compile: ' + failures.join(','));
        }
        kept.length = 0;
        survivors.forEach(function (level) { kept.push(level); });
    }

    const lines = [
        'Move codes: 0 up, 1 left, 2 down, 3 right, 4 action.',
        'Each block is one map, in the order they appear after their message card.',
        ''
    ];
    const lengths = {};
    for (let i = 0; i < kept.length; i++) {
        const length = kept[i].solution.length;
        lengths[length] = (lengths[length] || 0) + 1;
        lines.push('# ' + (i + 1) + ' ' + kept[i].family + ' length ' + length);
        lines.push(kept[i].solution.join(' '));
        lines.push('');
    }
    fs.writeFileSync(solutionPath, lines.join('\n'));

    const families = {};
    kept.forEach(function (level) {
        families[level.family] = (families[level.family] || 0) + 1;
    });
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    console.log('Kept ' + kept.length + ' levels from ' + attempts + ' attempts in ' + seconds + 's (seed ' + seedText + ')');
    console.log('Families ' + JSON.stringify(families));
    console.log('Lengths ' + JSON.stringify(lengths));
    console.log('Rejected ' + JSON.stringify(rejected));
    console.log(demoPath);
    console.log(solutionPath);
}

main();
