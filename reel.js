// ── Hi-Res Living Room Reel Game ────────────────────────────────────

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

let W, H;

function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W;
    canvas.height = H;
}
resize();
window.addEventListener('resize', resize);
document.body.addEventListener('touchmove', e => {
    if (!document.querySelector('.overlay:not(.hidden)')) e.preventDefault();
}, { passive: false });

// ── Input ───────────────────────────────────────────────────────────

const keys = {};
window.addEventListener('keydown', e => { keys[e.key] = true; });
window.addEventListener('keyup', e => { keys[e.key] = false; });

const isTouchDevice = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
const joystick = { active: false, dx: 0, dy: 0, magnitude: 0 };

if (isTouchDevice) {
    const base = document.getElementById('joystick-base');
    const knob = document.getElementById('joystick-knob');
    const maxDist = 38;
    function handleMove(cx, cy) {
        const rect = base.getBoundingClientRect();
        let dx = cx - (rect.left + rect.width / 2);
        let dy = cy - (rect.top + rect.height / 2);
        const dist = Math.sqrt(dx * dx + dy * dy);
        const c = Math.min(dist, maxDist);
        if (dist > 0) { dx = (dx / dist) * c; dy = (dy / dist) * c; }
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
        joystick.dx = dx / maxDist; joystick.dy = dy / maxDist;
        joystick.magnitude = c / maxDist; joystick.active = true;
    }
    function reset() {
        knob.style.transform = 'translate(0,0)';
        joystick.dx = joystick.dy = joystick.magnitude = 0; joystick.active = false;
    }
    base.addEventListener('touchstart', e => { e.preventDefault(); handleMove(e.touches[0].clientX, e.touches[0].clientY); }, { passive: false });
    base.addEventListener('touchmove', e => { e.preventDefault(); handleMove(e.touches[0].clientX, e.touches[0].clientY); }, { passive: false });
    base.addEventListener('touchend', e => { e.preventDefault(); reset(); }, { passive: false });
    base.addEventListener('touchcancel', reset);
}

// ── Room Layout (native pixel coords) ──────────────────────────────
// Everything rendered at 1:1 pixels for crisp hi-res look.
// Room is 540x420 pixels, centered on screen.

const ROOM_W = 540;
const ROOM_H = 420;

const furniture = {
    couch:   { x: 240, y: 190, w: 150, h: 54 },
    tv:      { x: 270, y: 28, w: 90, h: 28 },
    table:   { x: 279, y: 145, w: 72, h: 36 },
    counter: { x: 30, y: 45, w: 105, h: 42 },
    door:    { x: 240, y: 378, w: 60, h: 42 },
    rug:     { x: 210, y: 120, w: 210, h: 170 },
    lamp1:   { x: 220, y: 180, w: 16, h: 50 },   // floor lamp left of couch
    plant:   { x: 460, y: 330, w: 40, h: 60 },    // potted plant bottom-right
    shelf:   { x: 30, y: 280, w: 80, h: 20 },     // bookshelf
    poster:  { x: 420, y: 16, w: 90, h: 110 }      // hire me poster on wall
};

const items = {
    popcorn: { x: 66, y: 52, w: 24, h: 24, collected: false },
    remote:  { x: 303, y: 151, w: 18, h: 12, collected: false }
};

// ── Player ──────────────────────────────────────────────────────────

const player = {
    x: 270,
    y: 354,
    speed: 2.4,
    dir: 0,       // 0=down, 1=left, 2=up, 3=right
    frame: 0,
    frameTimer: 0,
    sitting: false
};

// ── Game State ──────────────────────────────────────────────────────

let step = 0;
// 0 = go get popcorn
// 1 = go sit on couch
// 2 = grab the remote (auto) → transition to POV
// 3 = POV view — press the red button
// 4 = reel category selection menu
// 5 = playing video

let running = true;
let spawnTimer = 300; // ~5 seconds before door/poster interactions activate
let povTransition = 0; // 0-1 fade into POV
let menuTransition = 0; // 0-1 fade into menu
let menuSelection = 0;
let menuCooldown = 0; // prevent rapid scrolling
let autoCycleTimer = 0;
let autoCycleActive = true; // auto-cycle until user interacts
const reelCategories = [
    { label: 'Short Films', icon: '🎬' },
    { label: 'Commercials', icon: '📺' },
    { label: 'TV', icon: '📡' },
    { label: 'Feature Films', icon: '🎥' },
    { label: 'Advertisements', icon: '📢' }
];
const prompts = [
    'Grab some Popcorn!',
    'Go sit on the couch',
    '',
    '',
    '',
    ''
];

// ── Collision ───────────────────────────────────────────────────────

function canMove(nx, ny) {
    const pw = 10, ph = 10;
    if (nx - pw < 12 || nx + pw > ROOM_W - 12) return false;
    if (ny - ph < 12 || ny + ph > ROOM_H - 12) return false;

    const blockers = ['couch', 'tv', 'counter', 'table', 'lamp1', 'shelf'];
    const activeBlockers = step >= 1 ? blockers.filter(b => b !== 'couch') : blockers;

    for (const key of activeBlockers) {
        const f = furniture[key];
        if (nx + pw > f.x && nx - pw < f.x + f.w &&
            ny + ph > f.y && ny - ph < f.y + f.h) {
            return false;
        }
    }
    return true;
}

// ── Update ──────────────────────────────────────────────────────────

function update() {
    // Step 2 triggers even while sitting
    if (step === 2) {
        items.remote.collected = true;
        povTransition = 0;
        step = 3;
        const jz = document.getElementById('joystick-zone');
        if (jz) jz.style.display = 'none';
        return;
    }

    if (player.sitting) return;

    let dx = 0, dy = 0;
    if (joystick.active && joystick.magnitude > 0.2) {
        dx = joystick.dx;
        dy = joystick.dy;
    } else {
        if (keys['w'] || keys['W'] || keys['ArrowUp']) dy = -1;
        if (keys['s'] || keys['S'] || keys['ArrowDown']) dy = 1;
        if (keys['a'] || keys['A'] || keys['ArrowLeft']) dx = -1;
        if (keys['d'] || keys['D'] || keys['ArrowRight']) dx = 1;
    }

    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > 0) {
        dx = (dx / len) * player.speed;
        dy = (dy / len) * player.speed;

        if (Math.abs(dx) > Math.abs(dy)) {
            player.dir = dx > 0 ? 3 : 1;
        } else {
            player.dir = dy > 0 ? 0 : 2;
        }

        const nx = player.x + dx;
        const ny = player.y + dy;
        if (canMove(nx, ny)) { player.x = nx; player.y = ny; }
        else if (canMove(nx, player.y)) { player.x = nx; }
        else if (canMove(player.x, ny)) { player.y = ny; }

        player.frameTimer++;
        if (player.frameTimer > 6) {
            player.frame = (player.frame + 1) % 4;
            player.frameTimer = 0;
        }
    } else {
        player.frame = 0;
    }

    // Countdown before door/poster activate
    if (spawnTimer > 0) spawnTimer--;

    // Door → back to main page
    const door = furniture.door;
    if (spawnTimer === 0 && Math.abs(player.x - (door.x + door.w / 2)) < 35 && Math.abs(player.y - (door.y + door.h / 2)) < 30) {
        window.location.href = 'index.html';
        return;
    }

    // Poster → hire me page
    const poster = furniture.poster;
    if (spawnTimer === 0 && Math.abs(player.x - (poster.x + poster.w / 2)) < 50 && Math.abs(player.y - (poster.y + poster.h)) < 30) {
        window.location.href = 'index.html#hire';
        return;
    }

    // Item pickups
    if (step === 0) {
        const p = items.popcorn;
        if (!p.collected && Math.abs(player.x - (p.x + p.w / 2)) < 50 && Math.abs(player.y - (p.y + p.h / 2)) < 50) {
            p.collected = true;
            step = 1;
        }
    } else if (step === 1) {
        const c = furniture.couch;
        if (Math.abs(player.x - (c.x + c.w / 2)) < 50 && Math.abs(player.y - (c.y + c.h / 2)) < 40) {
            player.sitting = true;
            player.x = c.x + c.w / 2;
            player.y = c.y + c.h / 2;
            player.dir = 2; // face up toward TV
            step = 2;
        }
    }
}

// ── Draw Helpers ────────────────────────────────────────────────────

let roomOX, roomOY;

function rect(x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(Math.floor(roomOX + x), Math.floor(roomOY + y), Math.ceil(w), Math.ceil(h));
}

function roundRect(x, y, w, h, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(Math.floor(roomOX + x), Math.floor(roomOY + y), w, h, r);
    ctx.fill();
}

// ── Draw ────────────────────────────────────────────────────────────

function draw() {
    // Reel selection menu
    if (step === 4) {
        menuTransition = Math.min(1, menuTransition + 0.03);
        updateMenu();
        drawMenu();
        return;
    }

    // POV mode — TV + remote view
    if (step === 3) {
        povTransition = Math.min(1, povTransition + 0.02);
        drawPOV();
        return;
    }

    // Camera follows player — keep player centered on screen
    roomOX = Math.floor(W / 2 - player.x);
    roomOY = Math.floor(H / 2 - player.y);

    // Background
    ctx.fillStyle = '#0a0a12';
    ctx.fillRect(0, 0, W, H);

    // Floor - hardwood
    rect(0, 0, ROOM_W, ROOM_H, '#5a3e28');
    for (let fy = 0; fy < ROOM_H; fy += 36) {
        rect(0, fy, ROOM_W, 1, '#4a3018');
        for (let fx = (fy % 72 === 0 ? 0 : 60); fx < ROOM_W; fx += 120) {
            rect(fx, fy, 1, 36, '#4a3018');
        }
        // Wood grain
        for (let fx = 10; fx < ROOM_W; fx += 45) {
            rect(fx, fy + 8, 30, 1, 'rgba(80,50,20,0.3)');
            rect(fx + 5, fy + 20, 25, 1, 'rgba(80,50,20,0.2)');
        }
    }

    // ── Rug ──
    const rug = furniture.rug;
    roundRect(rug.x, rug.y, rug.w, rug.h, 6, '#442233');
    roundRect(rug.x + 4, rug.y + 4, rug.w - 8, rug.h - 8, 4, '#553344');
    roundRect(rug.x + 8, rug.y + 8, rug.w - 16, rug.h - 16, 3, '#442233');
    // Rug pattern
    for (let i = 0; i < 5; i++) {
        rect(rug.x + 20 + i * 36, rug.y + 20, 2, rug.h - 40, 'rgba(200,150,100,0.1)');
    }

    // ── Walls ──
    // Wall fill (upper portion = wallpaper color)
    rect(0, 0, ROOM_W, 14, '#3a3a4e');
    // Baseboard
    rect(0, ROOM_H - 14, ROOM_W, 14, '#3a3a4e');
    rect(12, ROOM_H - 12, ROOM_W - 24, 2, '#555566');
    // Side walls
    rect(0, 0, 12, ROOM_H, '#3a3a4e');
    rect(ROOM_W - 12, 0, 12, ROOM_H, '#3a3a4e');
    // Wall trim
    rect(12, 12, ROOM_W - 24, 2, '#555566');
    rect(10, 0, 2, ROOM_H, '#555566');
    rect(ROOM_W - 12, 0, 2, ROOM_H, '#555566');

    // ── Hire Me poster ──
    const poster = furniture.poster;
    // Frame
    rect(poster.x - 2, poster.y - 2, poster.w + 4, poster.h + 4, '#aa8844');
    rect(poster.x, poster.y, poster.w, poster.h, '#0a0a1e');
    // Night sky gradient
    const skyGrad = ctx.createLinearGradient(0, roomOY + poster.y, 0, roomOY + poster.y + poster.h);
    skyGrad.addColorStop(0, '#0a0a2a');
    skyGrad.addColorStop(1, '#1a1a3a');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(roomOX + poster.x + 3, roomOY + poster.y + 3, poster.w - 6, poster.h - 6);
    // Moon (full)
    ctx.fillStyle = '#dde';
    ctx.beginPath();
    ctx.arc(roomOX + poster.x + poster.w / 2, roomOY + poster.y + 30, 16, 0, Math.PI * 2);
    ctx.fill();
    // Stars
    ctx.fillStyle = '#aab';
    for (const [sx, sy] of [[15,12],[70,18],[10,55],[78,50],[45,10],[25,70],[65,65],[50,85]]) {
        ctx.fillRect(roomOX + poster.x + sx, roomOY + poster.y + sy, 2, 2);
    }
    // "HIRE ME" text with glow
    const hireGlow = 0.6 + 0.3 * Math.sin(Date.now() * 0.003);
    const pcX = roomOX + poster.x + poster.w / 2;
    const pcY = roomOY + poster.y;
    ctx.fillStyle = `rgba(255,220,100,${hireGlow})`;
    ctx.font = 'bold 16px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('HIRE ME', pcX, pcY + 60);
    // Subtitle with background
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.roundRect(pcX - 42, pcY + 72, 84, 30, 3);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 8px "Courier New", monospace';
    ctx.fillText('Moonlit Cinemas', pcX, pcY + 80);
    ctx.fillText('Gaffing Services', pcX, pcY + 92);

    // ── Door opening ──
    const door = furniture.door;
    rect(door.x, door.y, door.w, door.h, '#2a1a0a');
    roundRect(door.x + 4, door.y, door.w - 8, 4, 2, '#776655');
    // Door handle
    ctx.fillStyle = '#aa8844';
    ctx.beginPath();
    ctx.arc(roomOX + door.x + door.w - 12, roomOY + door.y + door.h / 2, 3, 0, Math.PI * 2);
    ctx.fill();
    // Welcome mat with text
    roundRect(door.x - 8, door.y + door.h - 12, door.w + 16, 14, 2, '#556644');
    // "Back to Main" label
    const doorGlow = 0.5 + 0.3 * Math.sin(Date.now() * 0.003);
    ctx.fillStyle = `rgba(255,255,255,${doorGlow})`;
    ctx.font = 'bold 14px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('EXIT', roomOX + door.x + door.w / 2, roomOY + door.y + door.h / 2);
    // Background pill behind "Back to Main"
    const bmX = roomOX + door.x + door.w / 2;
    const bmY = roomOY + door.y + door.h + 12;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath();
    ctx.roundRect(bmX - 50, bmY - 9, 100, 18, 4);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px "Courier New", monospace';
    ctx.fillText('Back to Main', bmX, bmY);

    // ── Bookshelf ──
    const shelf = furniture.shelf;
    rect(shelf.x, shelf.y, shelf.w, shelf.h, '#5c4430');
    rect(shelf.x, shelf.y, shelf.w, 2, '#7a5a40');
    // Books
    const bookColors = ['#aa3333','#3355aa','#33aa55','#aa8833','#7733aa','#33aaaa','#aa5533'];
    for (let i = 0; i < 7; i++) {
        const bw = 8 + Math.floor(Math.random() * 0.1); // consistent
        rect(shelf.x + 4 + i * 11, shelf.y + 3, 9, shelf.h - 5, bookColors[i]);
    }

    // ── Kitchen counter ──
    const counter = furniture.counter;
    roundRect(counter.x, counter.y, counter.w, counter.h, 3, '#887766');
    rect(counter.x, counter.y, counter.w, 3, '#aa9988');
    // Counter edge highlight
    rect(counter.x, counter.y + counter.h - 2, counter.w, 2, '#665544');
    // Sink
    roundRect(counter.x + 70, counter.y + 8, 26, 20, 4, '#667788');
    roundRect(counter.x + 73, counter.y + 11, 20, 14, 3, '#556677');
    // Faucet
    rect(counter.x + 82, counter.y + 5, 4, 6, '#aaa');
    rect(counter.x + 80, counter.y + 4, 8, 3, '#bbb');

    // ── Popcorn on counter ──
    if (!items.popcorn.collected) {
        const pop = items.popcorn;
        if (step === 0) {
            // Glow ring
            const glow = 0.3 + 0.3 * Math.sin(Date.now() * 0.004);
            ctx.fillStyle = `rgba(255,220,80,${glow})`;
            ctx.beginPath();
            ctx.arc(roomOX + pop.x + pop.w / 2, roomOY + pop.y + pop.h / 2, 22, 0, Math.PI * 2);
            ctx.fill();
        }
        // Bucket
        roundRect(pop.x, pop.y + 6, pop.w, pop.h - 6, 3, '#cc2222');
        // White stripe
        rect(pop.x + 2, pop.y + 12, pop.w - 4, 3, '#dd4444');
        // Popcorn kernels on top
        ctx.fillStyle = '#ffee88';
        const kernelPositions = [[4,2],[10,0],[16,3],[7,4],[14,1],[20,2]];
        for (const [kx, ky] of kernelPositions) {
            ctx.beginPath();
            ctx.arc(roomOX + pop.x + kx, roomOY + pop.y + ky + 4, 3, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // ── TV ──
    const tv = furniture.tv;
    roundRect(tv.x, tv.y, tv.w, tv.h, 4, '#1a1a1a');
    roundRect(tv.x + 3, tv.y + 3, tv.w - 6, tv.h - 8, 2, '#111122');
    // TV stand / legs
    rect(tv.x + 15, tv.y + tv.h, 4, 8, '#333');
    rect(tv.x + tv.w - 19, tv.y + tv.h, 4, 8, '#333');
    rect(tv.x + 10, tv.y + tv.h + 6, tv.w - 20, 3, '#2a2a2a');
    // Screen content
    if (step >= 3) {
        const flicker = 0.5 + 0.2 * Math.sin(Date.now() * 0.003);
        roundRect(tv.x + 4, tv.y + 4, tv.w - 8, tv.h - 10, 2, `rgba(80,120,200,${flicker})`);
        // Play icon
        ctx.fillStyle = `rgba(255,255,255,${0.5 + 0.3 * Math.sin(Date.now() * 0.005)})`;
        ctx.beginPath();
        const cx = roomOX + tv.x + tv.w / 2 - 5;
        const cy = roomOY + tv.y + tv.h / 2 - 3;
        ctx.moveTo(cx, cy - 6);
        ctx.lineTo(cx + 12, cy);
        ctx.lineTo(cx, cy + 6);
        ctx.closePath();
        ctx.fill();
    } else {
        // Dark/off screen with subtle reflection
        roundRect(tv.x + 4, tv.y + 4, tv.w - 8, tv.h - 10, 2, '#0a0a15');
        ctx.fillStyle = 'rgba(255,255,255,0.03)';
        ctx.beginPath();
        ctx.ellipse(roomOX + tv.x + tv.w / 2, roomOY + tv.y + tv.h / 2 - 3, 30, 8, -0.3, 0, Math.PI * 2);
        ctx.fill();
    }

    // ── Coffee table ──
    const table = furniture.table;
    roundRect(table.x, table.y, table.w, table.h, 4, '#776644');
    rect(table.x, table.y, table.w, 2, '#998866');
    // Table legs (visible at bottom)
    rect(table.x + 4, table.y + table.h - 4, 4, 4, '#665533');
    rect(table.x + table.w - 8, table.y + table.h - 4, 4, 4, '#665533');

    // ── Remote on table ──
    if (!items.remote.collected) {
        const rem = items.remote;
        roundRect(rem.x, rem.y, rem.w, rem.h, 2, '#2a2a2a');
        // Buttons
        ctx.fillStyle = '#ff3333';
        ctx.beginPath();
        ctx.arc(roomOX + rem.x + 5, roomOY + rem.y + 3, 2, 0, Math.PI * 2);
        ctx.fill();
        rect(rem.x + 10, rem.y + 3, 4, 2, '#555');
        rect(rem.x + 10, rem.y + 7, 4, 2, '#555');
    }

    // ── Floor lamp ──
    const lamp = furniture.lamp1;
    // Pole
    rect(lamp.x + 6, lamp.y + 16, 4, lamp.h - 16, '#888');
    // Base
    ctx.fillStyle = '#777';
    ctx.beginPath();
    ctx.ellipse(roomOX + lamp.x + 8, roomOY + lamp.y + lamp.h, 8, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    // Shade
    ctx.fillStyle = '#ddcc99';
    ctx.beginPath();
    ctx.moveTo(roomOX + lamp.x, roomOY + lamp.y + 16);
    ctx.lineTo(roomOX + lamp.x + 3, roomOY + lamp.y);
    ctx.lineTo(roomOX + lamp.x + 13, roomOY + lamp.y);
    ctx.lineTo(roomOX + lamp.x + 16, roomOY + lamp.y + 16);
    ctx.closePath();
    ctx.fill();
    // Light glow drawn after couch (see below)

    // ── Potted plant ──
    const plant = furniture.plant;
    // Pot
    roundRect(plant.x + 8, plant.y + 30, 24, 28, 3, '#885544');
    rect(plant.x + 6, plant.y + 30, 28, 4, '#996655');
    // Leaves
    ctx.fillStyle = '#337733';
    const leafCx = roomOX + plant.x + 20;
    const leafCy = roomOY + plant.y + 20;
    for (let a = 0; a < 6; a++) {
        const angle = (a / 6) * Math.PI * 2 + Math.sin(Date.now() * 0.001 + a) * 0.05;
        ctx.beginPath();
        ctx.ellipse(leafCx + Math.cos(angle) * 12, leafCy + Math.sin(angle) * 10, 10, 5, angle, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.fillStyle = '#2a662a';
    ctx.beginPath();
    ctx.arc(leafCx, leafCy, 8, 0, Math.PI * 2);
    ctx.fill();

    // ── Couch (facing TV — back at bottom) ──
    const couch = furniture.couch;
    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.beginPath();
    ctx.ellipse(roomOX + couch.x + couch.w / 2, roomOY + couch.y + couch.h + 4, couch.w / 2 + 6, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    // Seat cushions (top, facing TV)
    roundRect(couch.x, couch.y, couch.w, couch.h - 16, 4, '#3a5580');
    // Back (bottom, away from TV)
    roundRect(couch.x, couch.y + couch.h - 18, couch.w, 18, 4, '#2a3d5c');
    // Armrests
    roundRect(couch.x - 8, couch.y, 10, couch.h, 4, '#2a3d5c');
    roundRect(couch.x + couch.w - 2, couch.y, 10, couch.h, 4, '#2a3d5c');
    // Cushion dividers
    rect(couch.x + 50, couch.y + 2, 1, couch.h - 20, '#2e4a70');
    rect(couch.x + 100, couch.y + 2, 1, couch.h - 20, '#2e4a70');
    // Pillows (on back, bottom portion)
    roundRect(couch.x + 6, couch.y + couch.h - 22, 20, 14, 3, '#4a6590');
    roundRect(couch.x + couch.w - 26, couch.y + couch.h - 22, 20, 14, 3, '#4a6590');

    // Lamp light glow (drawn on top of couch)
    ctx.fillStyle = 'rgba(255,240,180,0.08)';
    ctx.beginPath();
    ctx.arc(roomOX + lamp.x + 8, roomOY + lamp.y + 10, 51, 0, Math.PI * 2);
    ctx.fill();

    // Couch glow when target
    if (step === 1) {
        const glow = 0.15 + 0.15 * Math.sin(Date.now() * 0.004);
        ctx.strokeStyle = `rgba(255,220,80,${glow + 0.3})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.roundRect(roomOX + couch.x - 12, roomOY + couch.y - 4, couch.w + 24, couch.h + 8, 6);
        ctx.stroke();
    }

    // ── Player ──
    drawPlayer();

    // ── Target Arrow ──
    drawTargetArrow();

    // ── HUD / Prompt ──
    drawHUD();
}

function drawPlayer() {
    const px = player.x;
    const py = player.y;

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath();
    ctx.ellipse(roomOX + px, roomOY + py + 12, 10, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    if (player.sitting) {
        // Sitting on couch
        // Head
        roundRect(px - 8, py - 26, 16, 16, 4, '#ffcc88');
        // Hair
        roundRect(px - 8, py - 28, 16, 7, 3, '#553322');
        // Eyes
        rect(px - 4, py - 19, 3, 3, '#222');
        rect(px + 2, py - 19, 3, 3, '#222');
        // Body
        roundRect(px - 9, py - 10, 18, 14, 3, '#4477aa');
        // Arms
        rect(px - 12, py - 8, 4, 10, '#4477aa');
        rect(px + 9, py - 8, 4, 10, '#4477aa');
        // Popcorn in hand
        if (items.popcorn.collected) {
            roundRect(px + 12, py - 12, 12, 16, 2, '#cc2222');
            ctx.fillStyle = '#ffee88';
            ctx.beginPath();
            ctx.arc(roomOX + px + 18, roomOY + py - 13, 4, 0, Math.PI * 2);
            ctx.fill();
        }
        // Remote in other hand
        if (items.remote.collected) {
            roundRect(px - 18, py - 6, 8, 5, 1, '#2a2a2a');
            ctx.fillStyle = '#ff3333';
            ctx.beginPath();
            ctx.arc(roomOX + px - 15, roomOY + py - 4, 1.5, 0, Math.PI * 2);
            ctx.fill();
        }
    } else {
        // Walking sprite
        const bob = (player.frame % 2 === 0) ? 0 : -2;

        // Head
        roundRect(px - 8, py - 30 + bob, 16, 16, 5, '#ffcc88');
        // Hair
        roundRect(px - 8, py - 32 + bob, 16, 7, 4, '#553322');
        // Eyes
        if (player.dir === 0) { // down
            rect(px - 4, py - 22 + bob, 3, 3, '#222');
            rect(px + 2, py - 22 + bob, 3, 3, '#222');
            // Mouth
            rect(px - 1, py - 17 + bob, 3, 1, '#bb9977');
        } else if (player.dir === 2) { // up
            // Back of head
        } else {
            const ex = player.dir === 3 ? 3 : -4;
            rect(px + ex, py - 22 + bob, 3, 3, '#222');
        }

        // Body
        roundRect(px - 9, py - 14 + bob, 18, 18, 3, '#4477aa');
        // Arms
        const armSwing = player.frame < 2 ? 2 : -2;
        rect(px - 12, py - 12 + bob + armSwing, 4, 14, '#4477aa');
        rect(px + 9, py - 12 + bob - armSwing, 4, 14, '#4477aa');
        // Hands
        ctx.fillStyle = '#ffcc88';
        ctx.beginPath();
        ctx.arc(roomOX + px - 10, roomOY + py + 3 + bob + armSwing, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(roomOX + px + 11, roomOY + py + 3 + bob - armSwing, 3, 0, Math.PI * 2);
        ctx.fill();

        // Legs
        const legOff = player.frame < 2 ? 3 : -3;
        roundRect(px - 6, py + 4 + bob, 5, 12, 2, '#335');
        roundRect(px + 2, py + 4 + bob + legOff, 5, 12, 2, '#335');
        // Shoes
        roundRect(px - 7, py + 14 + bob, 7, 4, 2, '#222');
        roundRect(px + 1, py + 14 + bob + legOff, 7, 4, 2, '#222');

        // Popcorn in hand
        if (items.popcorn.collected) {
            roundRect(px + 12, py - 12 + bob - armSwing, 12, 16, 2, '#cc2222');
            ctx.fillStyle = '#ffee88';
            ctx.beginPath();
            ctx.arc(roomOX + px + 18, roomOY + py - 14 + bob - armSwing, 4, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

function drawTargetArrow() {
    if (step >= 3) return;

    let targetX, targetY;
    if (step === 0) {
        const p = items.popcorn;
        targetX = p.x + p.w / 2;
        targetY = p.y - 14;
    } else if (step === 1) {
        const c = furniture.couch;
        targetX = c.x + c.w / 2;
        targetY = c.y - 14;
    } else {
        return;
    }

    // Bouncing arrow pointing down
    const bounce = Math.sin(Date.now() * 0.006) * 6;
    const ax = roomOX + targetX;
    const ay = roomOY + targetY + bounce;

    ctx.fillStyle = '#ffdd44';
    ctx.beginPath();
    ctx.moveTo(ax, ay + 10);
    ctx.lineTo(ax - 8, ay);
    ctx.lineTo(ax - 3, ay);
    ctx.lineTo(ax - 3, ay - 10);
    ctx.lineTo(ax + 3, ay - 10);
    ctx.lineTo(ax + 3, ay);
    ctx.lineTo(ax + 8, ay);
    ctx.closePath();
    ctx.fill();

    // Arrow outline
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();
}

function drawHUD() {
    if (step < 4 && prompts[step]) {
        const text = prompts[step];
        const metrics = ctx.measureText(text);
        const tw = 280;

        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        roundRectPath(W / 2 - tw / 2, 18, tw, 36, 8);
        ctx.fill();

        ctx.fillStyle = '#fff';
        ctx.font = 'bold 15px "Courier New", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, W / 2, 36);
    }

    // "Tap to play" pulsing prompt
    if (step === 3) {
        const alpha = 0.6 + 0.4 * Math.sin(Date.now() * 0.004);
        ctx.fillStyle = `rgba(255,255,255,${alpha})`;
        ctx.font = 'bold 20px "Courier New", monospace';
        ctx.textAlign = 'center';
        ctx.fillText('Tap anywhere to play', W / 2, H / 2 + 120);
    }

    // Controls hint
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.font = '12px "Courier New", monospace';
    ctx.textAlign = 'center';
    const hint = isTouchDevice ? 'Use joystick to move' : 'WASD / Arrow keys to move';
    ctx.fillText(hint, W / 2, H - 18);
}

function roundRectPath(x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
}

// ── POV View (couch perspective) ────────────────────────────────────

// Red button hit area (calculated in drawPOV, checked in click handler)
let btnHit = { x: 0, y: 0, w: 0, h: 0 };

function drawPOV() {
    const alpha = povTransition;

    // Dark room background
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, W, H);

    // Ceiling
    ctx.fillStyle = '#1a1a25';
    ctx.fillRect(0, 0, W, H * 0.15);

    // Wall
    ctx.fillStyle = '#222235';
    ctx.fillRect(0, H * 0.15, W, H * 0.55);

    // Floor (far perspective)
    ctx.fillStyle = '#3a2a1a';
    ctx.fillRect(0, H * 0.7, W, H * 0.3);

    // ── TV ──
    const tvW = Math.min(W * 0.5, 400);
    const tvH = tvW * 0.6;
    const tvX = W / 2 - tvW / 2;
    const tvY = H * 0.18;

    // TV shadow on wall
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.roundRect(tvX - 8, tvY - 6, tvW + 16, tvH + 12, 8);
    ctx.fill();

    // TV body
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.roundRect(tvX, tvY, tvW, tvH, 6);
    ctx.fill();

    // Screen
    const scrX = tvX + 6;
    const scrY = tvY + 6;
    const scrW = tvW - 12;
    const scrH = tvH - 16;

    // Screen glow
    const flicker = 0.6 + 0.2 * Math.sin(Date.now() * 0.003);
    ctx.fillStyle = `rgba(30,40,80,${flicker})`;
    ctx.beginPath();
    ctx.roundRect(scrX, scrY, scrW, scrH, 3);
    ctx.fill();

    // "PLAY" text on screen
    ctx.fillStyle = `rgba(255,255,255,${0.3 + 0.2 * Math.sin(Date.now() * 0.002)})`;
    ctx.font = `bold ${Math.floor(scrH * 0.13)}px "Courier New", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Reel by', scrX + scrW / 2, scrY + scrH / 2 - scrH * 0.15);
    ctx.fillText('Moonlit Cinemas', scrX + scrW / 2, scrY + scrH / 2);
    ctx.fillText('Enjoy!', scrX + scrW / 2, scrY + scrH / 2 + scrH * 0.15);

    // TV stand
    const standW = tvW * 0.5;
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(W / 2 - standW / 2, tvY + tvH, standW, 6);
    ctx.fillRect(W / 2 - 4, tvY + tvH + 6, 8, 12);
    ctx.fillRect(W / 2 - standW * 0.3, tvY + tvH + 16, standW * 0.6, 4);

    // ── Remote in foreground (large, close-up) ──
    const remW = Math.min(W * 0.22, 140);
    const remH = remW * 2.8;
    const remX = W / 2 - remW / 2 + W * 0.15;
    const remY = H - remH * 0.55;

    // Remote shadow
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.roundRect(remX + 4, remY + 6, remW, remH, 12);
    ctx.fill();

    // Remote body
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath();
    ctx.roundRect(remX, remY, remW, remH, 10);
    ctx.fill();

    // Remote edge highlight
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(remX, remY, remW, remH, 10);
    ctx.stroke();

    // ── Big red POWER button ──
    const btnR = remW * 0.22;
    const btnCX = remX + remW / 2;
    const btnCY = remY + remH * 0.18;

    // Button glow
    const glowPulse = 0.4 + 0.3 * Math.sin(Date.now() * 0.004);
    ctx.fillStyle = `rgba(255,50,50,${glowPulse * 0.3})`;
    ctx.beginPath();
    ctx.arc(btnCX, btnCY, btnR + 10, 0, Math.PI * 2);
    ctx.fill();

    // Button
    const grad = ctx.createRadialGradient(btnCX - 3, btnCY - 3, 0, btnCX, btnCY, btnR);
    grad.addColorStop(0, '#ff4444');
    grad.addColorStop(0.7, '#cc1111');
    grad.addColorStop(1, '#991111');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(btnCX, btnCY, btnR, 0, Math.PI * 2);
    ctx.fill();

    // Button highlight
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.beginPath();
    ctx.arc(btnCX - btnR * 0.2, btnCY - btnR * 0.2, btnR * 0.4, 0, Math.PI * 2);
    ctx.fill();

    // Power symbol on button
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(btnCX, btnCY + 1, btnR * 0.4, -Math.PI * 0.8, Math.PI * 0.8, false);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(btnCX, btnCY - btnR * 0.5);
    ctx.lineTo(btnCX, btnCY - btnR * 0.1);
    ctx.stroke();

    // Save button hit area
    btnHit.x = btnCX - btnR - 15;
    btnHit.y = btnCY - btnR - 15;
    btnHit.w = (btnR + 15) * 2;
    btnHit.h = (btnR + 15) * 2;

    // ── Other remote buttons (decorative) ──
    // D-pad
    const dpY = remY + remH * 0.42;
    const dpSize = remW * 0.12;
    ctx.fillStyle = '#333';
    ctx.fillRect(btnCX - dpSize / 2, dpY - dpSize * 1.5, dpSize, dpSize * 3);
    ctx.fillRect(btnCX - dpSize * 1.5, dpY - dpSize / 2, dpSize * 3, dpSize);

    // Small buttons
    ctx.fillStyle = '#2a2a2a';
    for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) {
            const bx = btnCX - remW * 0.25 + col * remW * 0.25;
            const by = remY + remH * 0.6 + row * remW * 0.2;
            ctx.beginPath();
            ctx.arc(bx, by, remW * 0.06, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // ── Bouncing arrow pointing at the red button ──
    const arrowBounce = Math.sin(Date.now() * 0.006) * 8;
    const arrowX = btnCX;
    const arrowY = btnCY - btnR - 30 + arrowBounce;

    ctx.fillStyle = '#ffdd44';
    ctx.beginPath();
    ctx.moveTo(arrowX, arrowY + 14);
    ctx.lineTo(arrowX - 10, arrowY + 2);
    ctx.lineTo(arrowX - 4, arrowY + 2);
    ctx.lineTo(arrowX - 4, arrowY - 10);
    ctx.lineTo(arrowX + 4, arrowY - 10);
    ctx.lineTo(arrowX + 4, arrowY + 2);
    ctx.lineTo(arrowX + 10, arrowY + 2);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // ── Popcorn in left hand ──
    const pcX = W * 0.15;
    const pcY = H - 120;
    // Bucket
    ctx.fillStyle = '#cc2222';
    ctx.beginPath();
    ctx.roundRect(pcX, pcY, 50, 70, 6);
    ctx.fill();
    // Stripe
    ctx.fillStyle = '#dd4444';
    ctx.fillRect(pcX + 4, pcY + 25, 42, 6);
    // Popcorn kernels
    ctx.fillStyle = '#ffee88';
    for (const [kx, ky] of [[8,-4],[20,-8],[32,-3],[14,-10],[26,-6],[40,-5]]) {
        ctx.beginPath();
        ctx.arc(pcX + kx, pcY + ky + 4, 6, 0, Math.PI * 2);
        ctx.fill();
    }

    // Hand holding popcorn
    ctx.fillStyle = '#ffcc88';
    ctx.beginPath();
    ctx.roundRect(pcX - 5, pcY + 50, 25, 16, 5);
    ctx.fill();

    // Hand holding remote
    ctx.fillStyle = '#ffcc88';
    ctx.beginPath();
    ctx.roundRect(remX - 5, remY + remH * 0.6, remW + 10, 20, 6);
    ctx.fill();

    // Fade in
    if (alpha < 1) {
        ctx.fillStyle = `rgba(0,0,0,${1 - alpha})`;
        ctx.fillRect(0, 0, W, H);
    }
}

// ── Reel Selection Menu ─────────────────────────────────────────────

const videoOverlay = document.getElementById('video-overlay');
const videoContainer = document.getElementById('video-container');
const videoBackBtn = document.getElementById('video-back-btn');
const joystickZone = document.getElementById('joystick-zone');

// Menu item hit areas (filled during drawMenu)
let menuHitAreas = [];
let menuBackHit = { x: 0, y: 0, w: 0, h: 0 };

function openMenu() {
    if (step !== 3 || povTransition < 0.8) return;
    step = 4;
    menuTransition = 0;
    menuSelection = 0;
    autoCycleActive = true;
    autoCycleTimer = 0;
}

function backToRoom() {
    // Reset everything back to room state
    step = 0;
    player.x = 270;
    player.y = 354;
    player.sitting = false;
    player.dir = 0;
    items.popcorn.collected = false;
    items.remote.collected = false;
    povTransition = 0;
    menuTransition = 0;
    spawnTimer = 300;
    const jz = document.getElementById('joystick-zone');
    if (jz) jz.style.display = '';
    running = true;
    loop();
}

function updateMenu() {
    if (menuCooldown > 0) menuCooldown--;

    // Auto-cycle through categories every 60 frames (~1 second)
    if (autoCycleActive) {
        autoCycleTimer++;
        if (autoCycleTimer >= 60) {
            autoCycleTimer = 0;
            menuSelection = (menuSelection + 1) % reelCategories.length;
        }
    }

    let dy = 0;
    if (joystick.active && joystick.magnitude > 0.4) {
        dy = joystick.dy;
    } else {
        if (keys['w'] || keys['W'] || keys['ArrowUp']) dy = -1;
        if (keys['s'] || keys['S'] || keys['ArrowDown']) dy = 1;
    }

    if (Math.abs(dy) > 0.3 && menuCooldown === 0) {
        autoCycleActive = false; // stop auto-cycle on user input
        if (dy < 0) menuSelection = (menuSelection - 1 + reelCategories.length) % reelCategories.length;
        if (dy > 0) menuSelection = (menuSelection + 1) % reelCategories.length;
        menuCooldown = 12;
    }

    // Enter/space to select on keyboard
    if (keys['Enter'] || keys[' ']) {
        keys['Enter'] = false;
        keys[' '] = false;
        selectCategory(menuSelection);
    }
}

function drawMenu() {
    const alpha = menuTransition;

    // Background — dark cinema
    ctx.fillStyle = '#08080f';
    ctx.fillRect(0, 0, W, H);

    // Subtle vignette
    const vgrad = ctx.createRadialGradient(W / 2, H / 2, W * 0.2, W / 2, H / 2, W * 0.7);
    vgrad.addColorStop(0, 'rgba(0,0,0,0)');
    vgrad.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = vgrad;
    ctx.fillRect(0, 0, W, H);

    // Title
    ctx.fillStyle = `rgba(255,255,255,${0.8 * alpha})`;
    ctx.font = `bold ${Math.min(28, W * 0.05)}px "Courier New", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('What do you want to watch?', W / 2, H * 0.12);

    // Subtitle
    ctx.fillStyle = `rgba(255,255,255,${0.3 * alpha})`;
    ctx.font = `${Math.min(14, W * 0.03)}px "Courier New", monospace`;
    const navHint = isTouchDevice ? 'Tap to select' : 'Arrow keys + Enter to select';
    ctx.fillText(navHint, W / 2, H * 0.18);

    // Menu items
    const itemH = Math.min(70, H * 0.1);
    const itemW = Math.min(400, W * 0.8);
    const startY = H * 0.28;
    const gap = itemH + 12;

    menuHitAreas = [];

    for (let i = 0; i < reelCategories.length; i++) {
        const cat = reelCategories[i];
        const ix = W / 2 - itemW / 2;
        const iy = startY + i * gap;
        const selected = i === menuSelection;

        menuHitAreas.push({ x: ix, y: iy, w: itemW, h: itemH, index: i });

        // Selection highlight
        if (selected) {
            const pulse = 0.6 + 0.2 * Math.sin(Date.now() * 0.004);
            ctx.fillStyle = `rgba(80,120,200,${pulse * alpha})`;
            ctx.beginPath();
            ctx.roundRect(ix - 4, iy - 4, itemW + 8, itemH + 8, 12);
            ctx.fill();
        }

        // Card background
        ctx.fillStyle = selected ? `rgba(30,40,70,${0.9 * alpha})` : `rgba(20,20,35,${0.7 * alpha})`;
        ctx.beginPath();
        ctx.roundRect(ix, iy, itemW, itemH, 8);
        ctx.fill();

        // Border
        ctx.strokeStyle = selected ? `rgba(120,160,255,${0.6 * alpha})` : `rgba(60,60,80,${0.3 * alpha})`;
        ctx.lineWidth = selected ? 2 : 1;
        ctx.beginPath();
        ctx.roundRect(ix, iy, itemW, itemH, 8);
        ctx.stroke();

        // Icon
        ctx.font = `${Math.floor(itemH * 0.45)}px sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(cat.icon, ix + 18, iy + itemH / 2);

        // Label
        ctx.fillStyle = selected ? `rgba(255,255,255,${0.95 * alpha})` : `rgba(200,200,220,${0.6 * alpha})`;
        ctx.font = `bold ${Math.min(20, itemH * 0.35)}px "Courier New", monospace`;
        ctx.textAlign = 'left';
        ctx.fillText(cat.label, ix + 18 + itemH * 0.55, iy + itemH / 2);

        // Arrow indicator for selected
        if (selected) {
            ctx.fillStyle = `rgba(255,255,255,${0.7 * alpha})`;
            ctx.font = `${Math.floor(itemH * 0.35)}px sans-serif`;
            ctx.textAlign = 'right';
            ctx.fillText('›', ix + itemW - 16, iy + itemH / 2);
        }
    }

    // Back button (top-left)
    const backW = 140;
    const backH = 36;
    const backX = 20;
    const backY = 20;
    const backPulse = 0.5 + 0.2 * Math.sin(Date.now() * 0.003);
    ctx.fillStyle = `rgba(30,30,50,${0.8 * alpha})`;
    ctx.beginPath();
    ctx.roundRect(backX, backY, backW, backH, 6);
    ctx.fill();
    ctx.strokeStyle = `rgba(100,120,180,${backPulse * alpha})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(backX, backY, backW, backH, 6);
    ctx.stroke();
    ctx.fillStyle = `rgba(255,255,255,${0.7 * alpha})`;
    ctx.font = '13px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('\u2190 Back to room', backX + backW / 2, backY + backH / 2);

    // Save back button hit area
    menuBackHit = { x: backX, y: backY, w: backW, h: backH };

    // Fade in
    if (alpha < 1) {
        ctx.fillStyle = `rgba(0,0,0,${1 - alpha})`;
        ctx.fillRect(0, 0, W, H);
    }
}

function selectCategory(index) {
    const cat = reelCategories[index];
    step = 5;
    running = false;
    // For now use placeholder — each category can link to its own content
    videoContainer.innerHTML = `<div style="color:#fff;text-align:center;padding:40px;font-family:Courier New,monospace;">
        <h2 style="margin-bottom:12px;">${cat.icon} ${cat.label}</h2>
        <p style="color:#aaa;">Coming soon...</p>
    </div>`;
    videoOverlay.classList.remove('hidden');
}

// ── Click/Touch Handlers ────────────────────────────────────────────

function handleClick(cx, cy) {
    // POV mode — check red button
    if (step === 3 && povTransition >= 0.8) {
        if (cx >= btnHit.x && cx <= btnHit.x + btnHit.w &&
            cy >= btnHit.y && cy <= btnHit.y + btnHit.h) {
            openMenu();
        }
        return;
    }

    // Menu mode — check back button and menu items
    if (step === 4 && menuTransition >= 0.5) {
        // Back button
        if (cx >= menuBackHit.x && cx <= menuBackHit.x + menuBackHit.w &&
            cy >= menuBackHit.y && cy <= menuBackHit.y + menuBackHit.h) {
            backToRoom();
            return;
        }
        // Menu items
        for (const hit of menuHitAreas) {
            if (cx >= hit.x && cx <= hit.x + hit.w &&
                cy >= hit.y && cy <= hit.y + hit.h) {
                autoCycleActive = false;
                menuSelection = hit.index;
                selectCategory(hit.index);
                return;
            }
        }
    }
}

canvas.addEventListener('click', e => {
    handleClick(e.clientX, e.clientY);
});
canvas.addEventListener('touchend', e => {
    if (e.target.closest('#joystick-zone')) return;
    if (e.changedTouches.length > 0) {
        handleClick(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
    }
});

// ESC to go back
window.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        if (step === 4) {
            backToRoom();
        } else {
            window.location.href = 'index.html';
        }
    }
});

videoBackBtn.addEventListener('click', () => {
    videoContainer.innerHTML = '';
    videoOverlay.classList.add('hidden');
    // Go back to menu
    step = 4;
    menuTransition = 0;
    autoCycleActive = true;
    autoCycleTimer = 0;
    running = true;
    loop();
});

// ── Game Loop ───────────────────────────────────────────────────────

function loop() {
    if (!running) return;
    update();
    draw();
    requestAnimationFrame(loop);
}

running = true;
loop();
