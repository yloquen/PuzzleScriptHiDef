'use strict';

// Optional animated sprites, drawn over the 5x5 fallback.
//
// Prelude, one line per clip:
//   sprite Player assets/player.png
//   sprite Player assets/player.png frame=16 frames=4 anim=walk
//   sprite Player assets/player_idle.png anim=idle frames=3 scale=2
//   sprite SWizard assets/wizard_idle.png anim=idle frames=1 bright=0.5
//
//   sprite Chest assets/chest.png anim=idle frames=4 loop=false
//
//   sprite Box assets/box.png anim=still
//
// frame is the cell size in the file (16, or 16x32). frames limits how many
// columns count as the clip; 0 means "the whole row". scale multiplies how
// long each frame stays up. 1 is 50ms, 2 holds each frame twice as long, and
// 0.5 changes frames twice as fast. bright multiplies the red, green, and
// blue of the loaded sheet. 1 leaves them alone, and 0.5 draws the clip at
// half strength. Alpha is unchanged. A walk slide lasts long enough to show
// every frame at that pace. anim names a clip. walk plays during a one-cell
// slide and cycles frames. idle plays while standing, when that clip has
// been loaded; otherwise the first walk frame is used. loop=false plays
// that idle clip once from the moment the object appears, then holds the
// last frame. Each copy keeps its own clock. still is one picture:
// it slides, and it does not cycle or flip.
// An animated sheet is one row of right-facing frames, 16 pixels tall.
// Moving left mirrors that row. Moving up or down keeps the last side.

const SPRITE_LAYER_DEFAULT_FRAME = 16;
const SPRITE_LAYER_ENGINE_DIRECTIONS = ['up', 'left', 'down', 'right'];
// How long each sheet frame stays up. The slide lasts this long times the
// frame count, so a 4-frame walk is 200ms.
const SPRITE_LAYER_FRAME_MS = 50;
const SPRITE_LAYER_WALK = 'walk';
const SPRITE_LAYER_IDLE = 'idle';
const SPRITE_LAYER_STILL = 'still';

let spriteLayerById = [];
let spriteLayerGeneration = 0;
let spriteSlide = null;
let spriteQueuedDir = -1;
let spriteLayerProbe = null;
let spriteStationaryHooked = false;
// Successful one-cell moves from this turn, recorded before the engine clears them.
let spriteMoveNotes = [];
let spriteMoveNoteSuspendDepth = 0;

function spriteLayerBind() {
    spriteLayerSnap();
    spriteLayerGeneration++;
    spriteLayerById = [];
    if (!state || !state.spriteLinks || state.spriteLinks.length === 0) {
        return;
    }
    const generation = spriteLayerGeneration;
    for (let i = 0; i < state.spriteLinks.length; i++) {
        const link = state.spriteLinks[i];
        const obj = state.objects[link.name];
        if (!obj || obj.id === undefined) {
            logWarning('There is no object named "' + link.name + '" for this sprite.', link.lineNumber, true);
            continue;
        }
        let entry = spriteLayerById[obj.id];
        if (!entry) {
            entry = {
                name: link.name,
                layer: obj.layer,
                facing: 3,
                sliding: false,
                animations: {}
            };
            spriteLayerById[obj.id] = entry;
        }
        const anim = {
            ready: false,
            url: link.url,
            frameWidth: link.frameWidth > 0 ? link.frameWidth : SPRITE_LAYER_DEFAULT_FRAME,
            frameHeight: link.frameHeight > 0 ? link.frameHeight : SPRITE_LAYER_DEFAULT_FRAME,
            frameLimit: link.frames > 0 ? link.frames : 0,
            scale: link.scale > 0 ? link.scale : 1,
            bright: link.bright >= 0 ? link.bright : 1,
            loop: link.loop !== false,
            playTime: 0,
            directionRows: (link.directionRows && link.directionRows.length > 0) ? link.directionRows : null,
            static: link.animation === SPRITE_LAYER_STILL,
            image: null,
            columns: 0,
            rows: 0,
            directionToRow: [0, 0, 0, 0]
        };
        entry.animations[link.animation] = anim;
        loadSpriteAnimation(obj.id, link, anim, generation);
    }
}

function loadSpriteAnimation(objectId, link, anim, generation) {
    const img = new Image();
    if (/^https?:\/\//i.test(anim.url)) {
        img.crossOrigin = 'anonymous';
    }
    img.onload = function () {
        if (generation !== spriteLayerGeneration) {
            return;
        }
        const current = spriteLayerById[objectId];
        if (!current || current.animations[link.animation] !== anim) {
            return;
        }
        if (img.width % anim.frameWidth !== 0 || img.height % anim.frameHeight !== 0 || img.width === 0 || img.height === 0) {
            reportSpriteProblem(link, 'is ' + img.width + 'x' + img.height + ', which does not divide into ' + anim.frameWidth + 'x' + anim.frameHeight + ' frames.');
            return;
        }
        anim.image = spriteBakeBrightness(img, anim.bright);
        anim.columns = img.width / anim.frameWidth;
        anim.rows = img.height / anim.frameHeight;
        if (anim.static) {
            anim.columns = 1;
            anim.rows = 1;
        } else if (anim.frameLimit > 0 && anim.frameLimit < anim.columns) {
            anim.columns = anim.frameLimit;
        }
        anim.directionToRow = directionRowsToIndex(anim.directionRows, anim.rows);
        anim.playTime = 0;
        anim.ready = true;
        if (typeof redraw === 'function' && !textMode) {
            redraw();
        }
    };
    img.onerror = function () {
        if (generation !== spriteLayerGeneration) {
            return;
        }
        reportSpriteProblem(link, 'could not be loaded from ' + anim.url + '.');
    };
    img.src = anim.url;
}

function spriteBakeBrightness(img, bright) {
    if (!(bright >= 0) || bright === 1) {
        return img;
    }
    const baked = document.createElement('canvas');
    baked.width = img.width;
    baked.height = img.height;
    const bakedCtx = baked.getContext('2d');
    bakedCtx.drawImage(img, 0, 0);
    let pixels;
    try {
        pixels = bakedCtx.getImageData(0, 0, baked.width, baked.height);
    } catch (err) {
        return img;
    }
    const data = pixels.data;
    for (let i = 0; i < data.length; i += 4) {
        data[i] = Math.min(255, Math.round(data[i] * bright));
        data[i + 1] = Math.min(255, Math.round(data[i + 1] * bright));
        data[i + 2] = Math.min(255, Math.round(data[i + 2] * bright));
    }
    bakedCtx.putImageData(pixels, 0, 0);
    return baked;
}

function reportSpriteProblem(link, detail) {
    const message = 'Sprite "' + link.animation + '" for "' + link.name + '" ' + detail + ' Using the built-in graphic.';
    if (typeof console !== 'undefined' && console.warn) {
        console.warn(message);
    }
    if (typeof consolePrint === 'function') {
        consolePrint(message, true);
    }
}

function spriteFrameHoldMs(anim) {
    const scale = (anim && anim.scale > 0) ? anim.scale : 1;
    return SPRITE_LAYER_FRAME_MS * scale;
}

function directionRowsToIndex(rowOrder, rowCount) {
    const map = [0, 0, 0, 0];
    if (!rowOrder || rowCount <= 1) {
        return map;
    }
    for (let dir = 0; dir < SPRITE_LAYER_ENGINE_DIRECTIONS.length; dir++) {
        const row = rowOrder.indexOf(SPRITE_LAYER_ENGINE_DIRECTIONS[dir]);
        map[dir] = (row >= 0 && row < rowCount) ? row : 0;
    }
    return map;
}

function spriteLayerClearMoveNotes() {
    if (spriteMoveNoteSuspendDepth > 0) {
        return;
    }
    spriteMoveNotes = [];
}

function spriteLayerSuspendMoveNotes(suspend) {
    spriteMoveNoteSuspendDepth += suspend ? 1 : -1;
    if (spriteMoveNoteSuspendDepth < 0) {
        spriteMoveNoteSuspendDepth = 0;
    }
}

function spriteLayerNoteMove(x, y, dx, dy, layer) {
    if (spriteMoveNoteSuspendDepth > 0 || (!dx && !dy)) {
        return;
    }
    spriteMoveNotes.push({ x: x, y: y, dx: dx, dy: dy, layer: layer });
}

function spriteLayerSnap() {
    spriteSlide = null;
    spriteQueuedDir = -1;
    spriteMoveNotes = [];
    for (let id = 0; id < spriteLayerById.length; id++) {
        if (spriteLayerById[id]) {
            spriteLayerById[id].sliding = false;
        }
    }
}

function spriteLayerIsSliding() {
    return spriteSlide !== null;
}

function spriteLayerQueueDir(dir) {
    if (spriteQueuedDir < 0) {
        spriteQueuedDir = dir;
    }
}

function spriteLayerClearQueuedDir(dir) {
    if (dir === undefined || spriteQueuedDir === dir) {
        spriteQueuedDir = -1;
    }
}

function spriteLayerTakeQueuedDir() {
    const dir = spriteQueuedDir;
    spriteQueuedDir = -1;
    return dir;
}

function spriteLayerCovers(objectId) {
    if (textMode || levelEditorOpened || diffToVisualize !== null) {
        return false;
    }
    const entry = spriteLayerById[objectId];
    if (!entry) {
        return false;
    }
    const walk = entry.animations[SPRITE_LAYER_WALK];
    const idle = entry.animations[SPRITE_LAYER_IDLE];
    const still = entry.animations[SPRITE_LAYER_STILL];
    return (walk && walk.ready) || (idle && idle.ready) || (still && still.ready);
}

function animationFor(entry, moving) {
    const walk = entry.animations[SPRITE_LAYER_WALK];
    const idle = entry.animations[SPRITE_LAYER_IDLE];
    const still = entry.animations[SPRITE_LAYER_STILL];
    if (moving && walk && walk.ready) {
        return walk;
    }
    if (!moving && idle && idle.ready) {
        return idle;
    }
    if (walk && walk.ready) {
        return walk;
    }
    if (idle && idle.ready) {
        return idle;
    }
    if (still && still.ready) {
        return still;
    }
    return null;
}

function spriteLayerCapture() {
    const snapshot = [];
    if (typeof level === 'undefined' || !level || textMode || levelEditorOpened) {
        return snapshot;
    }
    for (let id = 0; id < spriteLayerById.length; id++) {
        if (!spriteLayerCovers(id)) {
            continue;
        }
        snapshot.push({ id: id, cells: cellsWithObject(id) });
    }
    return snapshot;
}

function spriteLayerCommit(snapshot) {
    spriteSlide = null;
    clearSlidingFlags();
    if (!snapshot || textMode || levelEditorOpened || diffToVisualize !== null) {
        return;
    }
    const moves = [];
    let duration = SPRITE_LAYER_FRAME_MS;
    let hitchCap = SPRITE_LAYER_FRAME_MS;
    for (let s = 0; s < snapshot.length; s++) {
        const id = snapshot[s].id;
        const entry = spriteLayerById[id];
        if (!entry) {
            continue;
        }
        const beforeCells = snapshot[s].cells;
        const afterCells = cellsWithObject(id);
        const notes = notesForLayer(entry.layer);
        let pairs = pairNeighborMoves(beforeCells, afterCells, notes);
        if (!pairs) {
            pairs = [];
        }
        const jumped = unpairedTeleport(beforeCells, afterCells, pairs);
        if (jumped) {
            updateFacing(entry, jumped[0], jumped[1], true);
        }
        if (pairs.length === 0) {
            continue;
        }
        const walk = entry.animations[SPRITE_LAYER_WALK];
        if (walk && walk.ready && !walk.static && walk.columns > 0) {
            const hold = spriteFrameHoldMs(walk);
            const clipDuration = walk.columns * hold;
            if (clipDuration > duration) {
                duration = clipDuration;
            }
            if (hold < hitchCap) {
                hitchCap = hold;
            }
        }
        for (let p = 0; p < pairs.length; p++) {
            const dir = dirFromDelta(pairs[p][0], pairs[p][1]);
            updateFacing(entry, pairs[p][0], pairs[p][1], !notedMove(notes, pairs[p][0], pairs[p][1]));
            entry.sliding = true;
            moves.push({
                id: id,
                fromX: pairs[p][0].x,
                fromY: pairs[p][0].y,
                toX: pairs[p][1].x,
                toY: pairs[p][1].y,
                dir: dir
            });
        }
    }
    if (moves.length === 0) {
        return;
    }
    spriteSlide = {
        elapsed: 0,
        duration: duration,
        hitchCap: hitchCap,
        moves: moves
    };
}

function spriteLayerNeedsIdleRedraw() {
    if (textMode || levelEditorOpened || diffToVisualize !== null) {
        return false;
    }
    for (let id = 0; id < spriteLayerById.length; id++) {
        const entry = spriteLayerById[id];
        if (!entry || !spriteLayerCovers(id)) {
            continue;
        }
        const idle = entry.animations[SPRITE_LAYER_IDLE];
        if (!idle || !idle.ready || !(idle.columns > 1)) {
            continue;
        }
        if (idle.loop !== false) {
            return true;
        }
        const cells = cellsWithObject(id);
        for (let c = 0; c < cells.length; c++) {
            if (!spriteIdleFinished(idle, spriteIdleCellTime(idle, cells[c]))) {
                return true;
            }
        }
    }
    return false;
}

function spriteLayerAdvanceIdle(dt, includeLooping) {
    if (!(dt > 0)) {
        return;
    }
    for (let id = 0; id < spriteLayerById.length; id++) {
        const entry = spriteLayerById[id];
        if (!entry) {
            continue;
        }
        const idle = entry.animations[SPRITE_LAYER_IDLE];
        if (!idle || !idle.ready || !(idle.columns > 1)) {
            continue;
        }
        if (idle.loop === false) {
            spriteNoteIdleCells(idle, cellsWithObject(id), dt);
            continue;
        }
        if (includeLooping !== false) {
            idle.playTime += dt;
        }
    }
}

function spriteIdleCellTime(anim, cell) {
    if (!anim.cellPlay || !cell) {
        return 0;
    }
    const time = anim.cellPlay[cell.x + ',' + cell.y];
    return time === undefined ? 0 : time;
}

function spriteNoteIdleCells(anim, cells, dt) {
    const next = {};
    let step = dt > 0 ? dt : 0;
    const hold = spriteFrameHoldMs(anim);
    if (step > hold) {
        step = hold;
    }
    for (let i = 0; i < cells.length; i++) {
        const cell = cells[i];
        const key = cell.x + ',' + cell.y;
        let time = spriteIdleCellTime(anim, cell);
        if (step > 0 && !spriteIdleFinished(anim, time)) {
            time += step;
        }
        next[key] = time;
    }
    anim.cellPlay = next;
}

function spriteIdleFrame(anim, playTime) {
    const time = playTime === undefined ? anim.playTime : playTime;
    const hold = spriteFrameHoldMs(anim);
    let index = Math.floor(time / hold);
    if (!(index >= 0)) {
        index = 0;
    }
    if (anim.loop === false) {
        return index >= anim.columns ? anim.columns - 1 : index;
    }
    return index % anim.columns;
}

function spriteIdleFinished(anim, playTime) {
    if (!anim || anim.loop !== false || !(anim.columns > 1)) {
        return false;
    }
    const time = playTime === undefined ? anim.playTime : playTime;
    return time >= anim.columns * spriteFrameHoldMs(anim);
}

function spriteLayerAdvance(dt) {
    if (!spriteSlide) {
        return false;
    }
    let step = dt;
    if (!(step > 0)) {
        step = 0;
    }
    const cap = spriteSlide.hitchCap > 0 ? spriteSlide.hitchCap : SPRITE_LAYER_FRAME_MS;
    if (step > cap) {
        step = cap;
    }
    spriteSlide.elapsed += step;
    if (spriteSlide.elapsed >= spriteSlide.duration) {
        spriteSlide = null;
        clearSlidingFlags();
        return true;
    }
    return false;
}

function spriteLayerIsMovingTo(objectId, x, y) {
    const moves = movesFor(objectId);
    for (let m = 0; m < moves.length; m++) {
        if (moves[m].toX === x && moves[m].toY === y) {
            return true;
        }
    }
    return false;
}

// Still sprites draw with the 5x5 tiles, in object-id order, so a background
// stays behind walls and other unsprited objects in the same cell.
function spriteLayerDrawStationary(objectId, x, y, mini, minj) {
    spriteStationaryHooked = true;
    const entry = spriteLayerById[objectId];
    if (!entry || spriteLayerIsMovingTo(objectId, x, y)) {
        return;
    }
    const previousSmoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    drawStillSprite(entry, x, y, mini, minj);
    ctx.imageSmoothingEnabled = previousSmoothing;
}

function drawStationarySprites(mini, minj) {
    for (let id = 0; id < spriteLayerById.length; id++) {
        const entry = spriteLayerById[id];
        if (!entry || !spriteLayerCovers(id)) {
            continue;
        }
        const cells = cellsWithObject(id);
        for (let c = 0; c < cells.length; c++) {
            if (spriteLayerIsMovingTo(id, cells[c].x, cells[c].y)) {
                continue;
            }
            drawStillSprite(entry, cells[c].x, cells[c].y, mini, minj);
        }
    }
}

function spriteLayerDraw(mini, minj) {
    if (!level || textMode || levelEditorOpened || diffToVisualize !== null) {
        return;
    }
    const previousSmoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    // The board loop draws still sprites in layer order. If that loop is an
    // older graphics.js, it skips them, so draw them here instead.
    const hooked = spriteStationaryHooked;
    spriteStationaryHooked = false;
    if (!hooked) {
        drawStationarySprites(mini, minj);
    }
    if (spriteSlide) {
        for (let m = 0; m < spriteSlide.moves.length; m++) {
            const move = spriteSlide.moves[m];
            const entry = spriteLayerById[move.id];
            if (entry && spriteLayerCovers(move.id)) {
                drawMovingSprite(entry, move, mini, minj);
            }
        }
    }
    ctx.imageSmoothingEnabled = previousSmoothing;
}

function movesFor(objectId) {
    if (!spriteSlide) {
        return [];
    }
    const found = [];
    for (let i = 0; i < spriteSlide.moves.length; i++) {
        if (spriteSlide.moves[i].id === objectId) {
            found.push(spriteSlide.moves[i]);
        }
    }
    return found;
}

function drawMovingSprite(entry, move, mini, minj) {
    const anim = animationFor(entry, true);
    if (!anim) {
        return;
    }
    const t = spriteSlide.elapsed / spriteSlide.duration;
    const x = move.fromX + (move.toX - move.fromX) * t;
    const y = move.fromY + (move.toY - move.fromY) * t;
    let frame = 0;
    if (!anim.static) {
        frame = Math.floor(spriteSlide.elapsed / spriteFrameHoldMs(anim));
        if (frame >= anim.columns) {
            frame = anim.columns - 1;
        }
    }
    blitSpriteFrame(anim, entry.facing, frame, x, y, mini, minj);
}

function drawStillSprite(entry, x, y, mini, minj) {
    const anim = animationFor(entry, false);
    if (!anim) {
        return;
    }
    let frame = 0;
    if (anim === entry.animations[SPRITE_LAYER_IDLE] && anim.columns > 1) {
        const time = anim.loop === false ? spriteIdleCellTime(anim, { x: x, y: y }) : anim.playTime;
        frame = spriteIdleFrame(anim, time);
    }
    blitSpriteFrame(anim, entry.facing, frame, x, y, mini, minj);
}

function blitSpriteFrame(anim, facing, frame, gridX, gridY, mini, minj) {
    // The sheet faces right. Left mirrors it. Up and down keep that side.
    // rows= on the prelude line selects a direction row instead of mirroring.
    let row = 0;
    let flip = false;
    if (!anim.static && anim.directionRows && anim.rows > 1 && anim.directionToRow) {
        row = anim.directionToRow[facing];
        if (row === undefined || row >= anim.rows) {
            row = 0;
        }
    } else if (!anim.static && facing === 1) {
        flip = true;
    }
    if (frame < 0) {
        frame = 0;
    }
    const px = xoffset + (gridX - mini) * cellwidth;
    const py = yoffset + (gridY - minj) * cellheight;
    if (flip) {
        ctx.save();
        ctx.translate(px + cellwidth, py);
        ctx.scale(-1, 1);
        ctx.drawImage(
            anim.image,
            frame * anim.frameWidth, row * anim.frameHeight, anim.frameWidth, anim.frameHeight,
            0, 0, cellwidth, cellheight
        );
        ctx.restore();
        return;
    }
    ctx.drawImage(
        anim.image,
        frame * anim.frameWidth, row * anim.frameHeight, anim.frameWidth, anim.frameHeight,
        px, py, cellwidth, cellheight
    );
}

function clearSlidingFlags() {
    for (let id = 0; id < spriteLayerById.length; id++) {
        if (spriteLayerById[id]) {
            spriteLayerById[id].sliding = false;
        }
    }
}

function cellsWithObject(objectId) {
    const found = [];
    if (!level || typeof STRIDE_OBJ === 'undefined') {
        return found;
    }
    if (spriteLayerProbe === null || spriteLayerProbe.data.length !== STRIDE_OBJ) {
        spriteLayerProbe = new BitVec(STRIDE_OBJ);
    }
    for (let n = 0; n < level.n_tiles; n++) {
        level.getCellInto(n, spriteLayerProbe);
        if (spriteLayerProbe.get(objectId)) {
            found.push({ x: (n / level.height) | 0, y: n % level.height });
        }
    }
    return found;
}

function notesForLayer(layer) {
    if (typeof layer !== 'number') {
        return null;
    }
    const notes = [];
    for (let i = 0; i < spriteMoveNotes.length; i++) {
        if (spriteMoveNotes[i].layer === layer) {
            notes.push(spriteMoveNotes[i]);
        }
    }
    return notes;
}

function pairNeighborMoves(before, after, notes) {
    // Identical objects have no ids. Cells the engine actually stepped are
    // slides. Anything else may only slide as a one-cell swap; a packed group
    // is not rotated to explain a teleport.
    if (!notes) {
        return pairMinCostMoves(before, after);
    }
    return pairMovesWithNotes(before, after, notes);
}

function pairMovesWithNotes(before, after, notes) {
    const beforeAt = cellMap(before);
    const afterAt = cellMap(after);
    const takenFrom = {};
    const takenTo = {};
    const pairs = [];
    for (let i = 0; i < notes.length; i++) {
        const note = notes[i];
        const fromKey = note.x + ',' + note.y;
        const toKey = (note.x + note.dx) + ',' + (note.y + note.dy);
        if (!beforeAt[fromKey] || !afterAt[toKey] || fromKey === toKey || takenFrom[fromKey] || takenTo[toKey]) {
            continue;
        }
        takenFrom[fromKey] = true;
        takenTo[toKey] = true;
        pairs.push([beforeAt[fromKey], afterAt[toKey]]);
    }
    const looseBefore = [];
    const looseAfter = [];
    for (let i = 0; i < before.length; i++) {
        const key = before[i].x + ',' + before[i].y;
        if (!takenFrom[key] && !afterAt[key]) {
            looseBefore.push(before[i]);
        }
    }
    for (let j = 0; j < after.length; j++) {
        const key = after[j].x + ',' + after[j].y;
        if (!takenTo[key] && !beforeAt[key]) {
            looseAfter.push(after[j]);
        }
    }
    const loosePairs = pairMinCostMoves(looseBefore, looseAfter);
    if (loosePairs) {
        for (let i = 0; i < loosePairs.length; i++) {
            pairs.push(loosePairs[i]);
        }
    }
    return pairs;
}

function pairMinCostMoves(before, after) {
    if (before.length !== after.length) {
        return null;
    }
    if (before.length === 0) {
        return [];
    }
    const far = 1000000;
    const n = before.length;
    const cost = [];
    for (let i = 0; i < n; i++) {
        const row = [];
        for (let j = 0; j < n; j++) {
            const dist = Math.abs(before[i].x - after[j].x) + Math.abs(before[i].y - after[j].y);
            row.push(dist === 0 ? 0 : (dist === 1 ? 1 : far));
        }
        cost.push(row);
    }
    const assigned = hungarianAssign(cost);
    const pairs = [];
    for (let i = 0; i < n; i++) {
        const j = assigned[i];
        if (j === undefined || cost[i][j] >= far) {
            return null;
        }
        if (cost[i][j] !== 0) {
            pairs.push([before[i], after[j]]);
        }
    }
    return pairs;
}

function hungarianAssign(cost) {
    const n = cost.length;
    const u = [];
    const v = [];
    const p = [];
    const way = [];
    for (let i = 0; i <= n; i++) {
        u.push(0);
        v.push(0);
        p.push(0);
        way.push(0);
    }
    for (let i = 1; i <= n; i++) {
        p[0] = i;
        let j0 = 0;
        const minv = [];
        const used = [];
        for (let j = 0; j <= n; j++) {
            minv.push(Infinity);
            used.push(false);
        }
        do {
            used[j0] = true;
            const i0 = p[j0];
            let delta = Infinity;
            let j1 = 0;
            for (let j = 1; j <= n; j++) {
                if (used[j]) {
                    continue;
                }
                const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
                if (cur < minv[j]) {
                    minv[j] = cur;
                    way[j] = j0;
                }
                if (minv[j] < delta) {
                    delta = minv[j];
                    j1 = j;
                }
            }
            for (let j = 0; j <= n; j++) {
                if (used[j]) {
                    u[p[j]] += delta;
                    v[j] -= delta;
                } else {
                    minv[j] -= delta;
                }
            }
            j0 = j1;
        } while (p[j0] !== 0);
        do {
            const j1 = way[j0];
            p[j0] = p[j1];
            j0 = j1;
        } while (j0 !== 0);
    }
    const assignment = [];
    for (let j = 1; j <= n; j++) {
        if (p[j] !== 0) {
            assignment[p[j] - 1] = j - 1;
        }
    }
    return assignment;
}

function cellMap(list) {
    const map = {};
    for (let i = 0; i < list.length; i++) {
        map[list[i].x + ',' + list[i].y] = list[i];
    }
    return map;
}

function cellListHas(list, cell) {
    for (let i = 0; i < list.length; i++) {
        if (list[i].x === cell.x && list[i].y === cell.y) {
            return true;
        }
    }
    return false;
}

function isOrthogonalNeighbor(a, b) {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
}

function updateFacing(entry, from, to, teleport) {
    const shown = animationFor(entry, true);
    if (!shown || shown.static) {
        return;
    }
    const dir = dirFromDelta(from, to);
    const usesRows = shown.directionRows && shown.rows > 1;
    if (usesRows && teleport) {
        entry.facing = dir;
        return;
    }
    if (dir === 1 || dir === 3) {
        entry.facing = dir;
    }
}

function notedMove(notes, from, to) {
    if (!notes) {
        return false;
    }
    for (let i = 0; i < notes.length; i++) {
        const note = notes[i];
        if (note.x === from.x && note.y === from.y && note.x + note.dx === to.x && note.y + note.dy === to.y) {
            return true;
        }
    }
    return false;
}

function unpairedTeleport(before, after, pairs) {
    const pairedFrom = {};
    const pairedTo = {};
    for (let i = 0; i < pairs.length; i++) {
        pairedFrom[pairs[i][0].x + ',' + pairs[i][0].y] = true;
        pairedTo[pairs[i][1].x + ',' + pairs[i][1].y] = true;
    }
    const beforeAt = cellMap(before);
    const afterAt = cellMap(after);
    const looseFrom = [];
    const looseTo = [];
    for (let i = 0; i < before.length; i++) {
        const key = before[i].x + ',' + before[i].y;
        if (!pairedFrom[key] && !afterAt[key]) {
            looseFrom.push(before[i]);
        }
    }
    for (let j = 0; j < after.length; j++) {
        const key = after[j].x + ',' + after[j].y;
        if (!pairedTo[key] && !beforeAt[key]) {
            looseTo.push(after[j]);
        }
    }
    if (looseFrom.length === 1 && looseTo.length === 1) {
        return [looseFrom[0], looseTo[0]];
    }
    return null;
}

function dirFromDelta(from, to) {
    if (to.y < from.y) {
        return 0;
    }
    if (to.x < from.x) {
        return 1;
    }
    if (to.y > from.y) {
        return 2;
    }
    return 3;
}
