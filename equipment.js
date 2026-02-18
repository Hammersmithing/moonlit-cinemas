// ── 16-Bit Equipment Road Game ──────────────────────────────────────

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// Pixel scale — render at low res, scale up for 16-bit look
const PIXEL = 3;
let W, H, GW, GH; // canvas size and game (logical) size

function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W;
    canvas.height = H;
    GW = Math.floor(W / PIXEL);
    GH = Math.floor(H / PIXEL);
}
resize();
window.addEventListener('resize', resize);

// Prevent mobile scroll
document.body.addEventListener('touchmove', e => e.preventDefault(), { passive: false });

// ── Input ───────────────────────────────────────────────────────────

const keys = {};
window.addEventListener('keydown', e => { keys[e.key] = true; });
window.addEventListener('keyup', e => { keys[e.key] = false; });

// Touch joystick
const isTouchDevice = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
const joystick = { active: false, dx: 0, dy: 0, magnitude: 0 };

if (isTouchDevice) {
    const base = document.getElementById('joystick-base');
    const knob = document.getElementById('joystick-knob');
    const maxDist = 38;

    function handleMove(cx2, cy2) {
        const rect = base.getBoundingClientRect();
        const cxB = rect.left + rect.width / 2;
        const cyB = rect.top + rect.height / 2;
        let dx = cx2 - cxB, dy = cy2 - cyB;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const c = Math.min(dist, maxDist);
        if (dist > 0) { dx = (dx / dist) * c; dy = (dy / dist) * c; }
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
        joystick.dx = dx / maxDist;
        joystick.dy = dy / maxDist;
        joystick.magnitude = c / maxDist;
        joystick.active = true;
    }
    function reset() {
        knob.style.transform = 'translate(0,0)';
        joystick.dx = joystick.dy = joystick.magnitude = 0;
        joystick.active = false;
    }
    base.addEventListener('touchstart', e => { e.preventDefault(); handleMove(e.touches[0].clientX, e.touches[0].clientY); }, { passive: false });
    base.addEventListener('touchmove', e => { e.preventDefault(); handleMove(e.touches[0].clientX, e.touches[0].clientY); }, { passive: false });
    base.addEventListener('touchend', e => { e.preventDefault(); reset(); }, { passive: false });
    base.addEventListener('touchcancel', reset);
}

// ── Colors (16-bit palette) ─────────────────────────────────────────

const C = {
    road: '#555566',
    roadLine: '#dddd77',
    grass1: '#2d6a2d',
    grass2: '#347a34',
    dirt: '#8b7355',
    car: '#cc3333',
    carDark: '#991111',
    carWindow: '#446688',
    carWheel: '#222',
    sign: '#8b6914',
    signText: '#fff',
    signBoard: '#335522',
    building: '#665544',
    buildingDoor: '#aa8833',
    buildingRoof: '#443322',
    sky: '#1a1a2e',
    tree: '#1d5a1d',
    treeTrunk: '#6b4226',
    white: '#ffffff',
    arrow: '#ffff44'
};

// ── World Layout ────────────────────────────────────────────────────
// Coordinate system: game pixels. Car starts at bottom, drives up.
// Crossroads at center of world.

const ROAD_W = 28;       // road width in game pixels
const CROSS_Y = 0;       // crossroads Y center
const CROSS_X = 0;       // crossroads X center
const START_Y = 180;     // car start offset below crossroads
const ZONE_DIST = 120;   // distance from crossroads to trigger zone

// ── Car ─────────────────────────────────────────────────────────────

const car = {
    x: CROSS_X,
    y: CROSS_Y + START_Y,
    angle: -Math.PI / 2, // facing up
    speed: 0,
    maxSpeed: 1.2,
    accel: 0.04,
    brake: 0.06,
    friction: 0.97,
    turnSpeed: 0.04
};

// ── Camera ──────────────────────────────────────────────────────────

const cam = { x: 0, y: 0 };

// ── State ───────────────────────────────────────────────────────────

let running = true;
let arrived = null; // which zone the car reached

// ── Scenery (trees, rocks placed around the roads) ──────────────────

const scenery = [];

// Trees along the main road (vertical)
for (let y = -250; y <= 300; y += 18 + Math.floor(Math.random() * 12)) {
    if (Math.abs(y - CROSS_Y) < 40) continue; // gap at crossroads
    scenery.push({ type: 'tree', x: CROSS_X - ROAD_W / 2 - 8 - Math.random() * 15, y });
    scenery.push({ type: 'tree', x: CROSS_X + ROAD_W / 2 + 8 + Math.random() * 15, y });
}

// Trees along the horizontal road
for (let x = -250; x <= 250; x += 18 + Math.floor(Math.random() * 12)) {
    if (Math.abs(x - CROSS_X) < 40) continue;
    scenery.push({ type: 'tree', x, y: CROSS_Y - ROAD_W / 2 - 8 - Math.random() * 15 });
    scenery.push({ type: 'tree', x, y: CROSS_Y + ROAD_W / 2 + 8 + Math.random() * 15 });
}

// Destination buildings
const destinations = [
    { label: 'EQUIPMENT', x: CROSS_X, y: CROSS_Y - ZONE_DIST - 20, dir: 'straight' },
    { label: 'LIGHTS', x: CROSS_X - ZONE_DIST - 20, y: CROSS_Y, dir: 'left' },
    { label: 'GRIP', x: CROSS_X + ZONE_DIST + 20, y: CROSS_Y, dir: 'right' }
];

// ── Inventory Data ──────────────────────────────────────────────────

const inventoryData = {
    straight: {
        title: '2 TON GAFF & GRIP PACKAGE',
        subtitle: '7.3 Diesel Ford E350 16\' Box Truck',
        sections: [
            {
                name: 'Point Source COB Lights — 16 Fixtures',
                items: [
                    { name: 'Aputure 1200X', qty: 2, desc: '1200W White Tunable' },
                    { name: 'Aputure 1200D Pro', qty: 1, desc: '1200W Daylight' },
                    { name: 'Nanlite Forza 720D', qty: 1, desc: '720W Daylight' },
                    { name: 'Amaran 660C', qty: 4, desc: '660W Full Color' },
                    { name: 'Amaran 300C', qty: 2, desc: '300W Full Color' },
                    { name: 'Amaran 120C', qty: 2, desc: '120W Full Color' },
                    { name: 'Aputure 80C', qty: 3, desc: '80W Full Color' },
                    { name: 'Amaran 60D', qty: 1, desc: '60W Daylight' }
                ]
            },
            {
                name: 'Panel Lights — 7 Fixtures',
                items: [
                    { name: 'Aputure Nova P600C', qty: 2, desc: '600W 2x1 Full Color' },
                    { name: 'Godox F600bi', qty: 1, desc: '600W 4x4 Bi-Color' },
                    { name: 'Amaran F22C', qty: 2, desc: '200W 2x2 Full Color' },
                    { name: 'Amaran F21C', qty: 2, desc: '100W 2x1 Full Color' }
                ]
            },
            {
                name: 'Tube Lights — 6 Fixtures',
                items: [
                    { name: 'Amaran PT4C', qty: 2, desc: '200W 4\' Full Color' },
                    { name: 'Amaran PT2C', qty: 4, desc: '100W 2\' Full Color' }
                ]
            },
            {
                name: 'Practical Bulbs — 12 Fixtures',
                items: [
                    { name: 'Nanlite Pavo Bulb 10C', qty: 12, desc: '10W Full Color' }
                ]
            },
            {
                name: 'Misc. Lights',
                items: [
                    { name: 'Aputure MC', qty: 4, desc: '10W Full Color' },
                    { name: 'Sirui E30B', qty: 1, desc: '30W White Tunable' },
                    { name: '120\' Edison Bulb String', qty: 8, desc: '3200K Outdoor' },
                    { name: 'Christmas Lights (300ct)', qty: 10, desc: 'Traditional' }
                ]
            },
            {
                name: 'Diffusion / Modifiers / Rags',
                items: [
                    { name: '4x4 Floppy', qty: 4 },
                    { name: '2x1 Cutter', qty: 2 },
                    { name: 'Duvatene 8x8', qty: 1 },
                    { name: 'Duvatene 12x12', qty: 1 },
                    { name: 'Double Net 8x8', qty: 1 },
                    { name: 'Double Net 12x12', qty: 1 },
                    { name: 'Unbleached Muslin 8x8', qty: 1 },
                    { name: 'Unbleached Muslin 12x12', qty: 1 },
                    { name: 'Bleached Muslin 8x8', qty: 1 },
                    { name: 'Bleached Muslin 12x12', qty: 1 },
                    { name: 'Magic Cloth 8x8', qty: 1 },
                    { name: 'Magic Cloth 12x12', qty: 1 },
                    { name: 'Full Grid 8x8', qty: 1 },
                    { name: 'Full Grid 12x12', qty: 1 },
                    { name: 'Half Grid 8x8', qty: 1 },
                    { name: 'Half Grid 12x12', qty: 1 },
                    { name: 'Half Soft Frost 12x12', qty: 1 },
                    { name: 'Ultrabounce 8x8', qty: 1 },
                    { name: 'Ultrabounce 20x20', qty: 1 },
                    { name: 'Opal 4x4 Frame', qty: 2 },
                    { name: '216 4x4 Frame', qty: 2 },
                    { name: '251 4x4 Frame', qty: 2 },
                    { name: 'Half CTO Roll (25\')', qty: 1 },
                    { name: 'Full CTO Roll (25\')', qty: 1 }
                ]
            },
            {
                name: 'Softboxes / Lanterns',
                items: [
                    { name: 'Aputure 120 Lantern (4\')', qty: 2 },
                    { name: 'Aputure 90 Lantern (3\')', qty: 1 },
                    { name: 'Aputure Lightdome 150 (5\')', qty: 1 },
                    { name: 'Softbox 5x4 Rectangle', qty: 1 },
                    { name: 'Amaran 1x4 Softbox', qty: 1 },
                    { name: 'Aputure 60 Softbox (2\')', qty: 1 },
                    { name: 'Pancake Lantern (4x4)', qty: 1 },
                    { name: 'Chimera Softbox w/ Grid', qty: 1 },
                    { name: '5-in-1 Reflector', qty: 1 },
                    { name: '5-in-1 Reflector Large', qty: 1 }
                ]
            },
            {
                name: 'Grip Gear',
                items: [
                    { name: 'C-Stand', qty: 16 },
                    { name: 'Triple Riser Combo', qty: 6 },
                    { name: 'Beefy Baby', qty: 4 },
                    { name: 'Goal Post', qty: 1 },
                    { name: 'Menace Arm', qty: 2 },
                    { name: 'Duck Clamp', qty: 1 },
                    { name: 'Cartellini Large', qty: 1 },
                    { name: 'Cartellini Medium', qty: 1 },
                    { name: 'Cartellini Small', qty: 4 },
                    { name: 'Wood Clamp Large (3\')', qty: 2 },
                    { name: 'Wood Clamp (2\')', qty: 2 },
                    { name: 'Trombone', qty: 1 },
                    { name: 'Lollipop', qty: 4 },
                    { name: 'Butterfly Frame Square', qty: 2 },
                    { name: 'Butterfly Frame Round', qty: 2 },
                    { name: 'Square Stock Frame 8x8', qty: 3 },
                    { name: 'Round Stock 12x12', qty: 1 },
                    { name: 'Round Stock 20x20', qty: 1 },
                    { name: 'Sandbags 10 lbs', qty: 15 },
                    { name: 'Shotbags 25 lbs', qty: 6 },
                    { name: 'Dana Dolly Kit', qty: 1 },
                    { name: 'Grip Cart', qty: 6 },
                    { name: 'Full Apple Box Kit', qty: 4 }
                ]
            },
            {
                name: 'Electrics',
                items: [
                    { name: 'Delta Pro Power Station', qty: 3, desc: '11 kW Combined' },
                    { name: '98W V-Mount D-Tap', qty: 6 },
                    { name: 'NPF Battery (Large)', qty: 8 },
                    { name: 'Dimmer (AC Plug)', qty: 6 },
                    { name: 'Haze Machine', qty: 1, desc: 'Water base' }
                ]
            },
            {
                name: 'Accessories',
                items: [
                    { name: 'iPad Pro M2', qty: 2, desc: 'Light Control' },
                    { name: 'Sekonic L-858D-U', qty: 1, desc: 'Light Meter' },
                    { name: 'Sekonic C800U', qty: 1, desc: 'Color Meter' },
                    { name: 'Spotlight SE', qty: 2, desc: 'For 300C / 120C' }
                ]
            }
        ]
    },
    left: {
        title: 'LIGHTS',
        subtitle: 'Lighting Fixtures & Modifiers',
        sections: [
            {
                name: 'Point Source COB — 16 Fixtures',
                items: [
                    { name: 'Aputure 1200X', qty: 2, desc: '1200W White Tunable' },
                    { name: 'Aputure 1200D Pro', qty: 1, desc: '1200W Daylight' },
                    { name: 'Nanlite Forza 720D', qty: 1, desc: '720W Daylight' },
                    { name: 'Amaran 660C', qty: 4, desc: '660W Full Color' },
                    { name: 'Amaran 300C', qty: 2, desc: '300W Full Color' },
                    { name: 'Amaran 120C', qty: 2, desc: '120W Full Color' },
                    { name: 'Aputure 80C', qty: 3, desc: '80W Full Color' },
                    { name: 'Amaran 60D', qty: 1, desc: '60W Daylight' }
                ]
            },
            {
                name: 'Panels — 7 Fixtures',
                items: [
                    { name: 'Aputure Nova P600C', qty: 2, desc: '600W 2x1' },
                    { name: 'Godox F600bi', qty: 1, desc: '600W 4x4' },
                    { name: 'Amaran F22C', qty: 2, desc: '200W 2x2' },
                    { name: 'Amaran F21C', qty: 2, desc: '100W 2x1' }
                ]
            },
            {
                name: 'Tubes — 6 Fixtures',
                items: [
                    { name: 'Amaran PT4C', qty: 2, desc: '200W 4\'' },
                    { name: 'Amaran PT2C', qty: 4, desc: '100W 2\'' }
                ]
            },
            {
                name: 'Practicals & Misc — 25+ Fixtures',
                items: [
                    { name: 'Nanlite Pavo Bulb 10C', qty: 12, desc: '10W Full Color' },
                    { name: 'Aputure MC', qty: 4, desc: '10W Full Color' },
                    { name: 'Sirui E30B', qty: 1, desc: '30W White Tunable' },
                    { name: '120\' Edison String', qty: 8, desc: '3200K Outdoor' },
                    { name: 'Christmas Lights', qty: 10, desc: '300 count' }
                ]
            },
            {
                name: 'Softboxes / Lanterns',
                items: [
                    { name: 'Aputure 120 Lantern (4\')', qty: 2 },
                    { name: 'Aputure 90 Lantern (3\')', qty: 1 },
                    { name: 'Lightdome 150 (5\' Round)', qty: 1 },
                    { name: 'Softbox 5x4 Rectangle', qty: 1 },
                    { name: 'Amaran 1x4 Softbox', qty: 1 },
                    { name: 'Aputure 60 Softbox (2\')', qty: 1 },
                    { name: 'Pancake Lantern', qty: 1 },
                    { name: 'Chimera w/ Grid', qty: 1 }
                ]
            },
            {
                name: 'Diffusion / Rags / Gels',
                items: [
                    { name: '4x4 Floppy', qty: 4 },
                    { name: '2x1 Cutter', qty: 2 },
                    { name: 'Opal 4x4', qty: 2 },
                    { name: '216 4x4', qty: 2 },
                    { name: '251 4x4', qty: 2 },
                    { name: 'Half CTO Roll', qty: 1 },
                    { name: 'Full CTO Roll', qty: 1 },
                    { name: '5-in-1 Reflector', qty: 1 },
                    { name: '5-in-1 Reflector Lrg', qty: 1 }
                ]
            }
        ]
    },
    right: {
        title: 'GRIP GEAR',
        subtitle: 'Stands, Frames & Rigging',
        sections: [
            {
                name: 'Stands',
                items: [
                    { name: 'C-Stand', qty: 16 },
                    { name: 'Triple Riser Combo', qty: 6 },
                    { name: 'Beefy Baby', qty: 4 },
                    { name: 'Goal Post', qty: 1, desc: 'Fits 3 fixtures' }
                ]
            },
            {
                name: 'Clamps & Arms',
                items: [
                    { name: 'Menace Arm', qty: 2 },
                    { name: 'Duck Clamp', qty: 1 },
                    { name: 'Cartellini Large', qty: 1 },
                    { name: 'Cartellini Medium', qty: 1 },
                    { name: 'Cartellini Small', qty: 4 },
                    { name: 'Wood Clamp 3\'', qty: 2 },
                    { name: 'Wood Clamp 2\'', qty: 2 },
                    { name: 'Trombone', qty: 1 },
                    { name: 'Lollipop', qty: 4 }
                ]
            },
            {
                name: 'Frames',
                items: [
                    { name: 'Butterfly Frame Square', qty: 2 },
                    { name: 'Butterfly Frame Round', qty: 2 },
                    { name: 'Square Stock 8x8', qty: 3 },
                    { name: 'Round Stock 12x12', qty: 1 },
                    { name: 'Round Stock 20x20', qty: 1 }
                ]
            },
            {
                name: 'Rags (8x8 — 20x20)',
                items: [
                    { name: 'Duvatene 8x8', qty: 1 },
                    { name: 'Duvatene 12x12', qty: 1 },
                    { name: 'Double Net 8x8', qty: 1 },
                    { name: 'Double Net 12x12', qty: 1 },
                    { name: 'Unbl. Muslin 8x8', qty: 1 },
                    { name: 'Unbl. Muslin 12x12', qty: 1 },
                    { name: 'Bl. Muslin 8x8', qty: 1 },
                    { name: 'Bl. Muslin 12x12', qty: 1 },
                    { name: 'Magic Cloth 8x8', qty: 1 },
                    { name: 'Magic Cloth 12x12', qty: 1 },
                    { name: 'Full Grid 8x8', qty: 1 },
                    { name: 'Full Grid 12x12', qty: 1 },
                    { name: 'Half Grid 8x8', qty: 1 },
                    { name: 'Half Grid 12x12', qty: 1 },
                    { name: 'Half Soft Frost 12x12', qty: 1 },
                    { name: 'Ultrabounce 8x8', qty: 1 },
                    { name: 'Ultrabounce 20x20', qty: 1 }
                ]
            },
            {
                name: 'Weight & Misc',
                items: [
                    { name: 'Sandbags 10 lbs', qty: 15 },
                    { name: 'Shotbags 25 lbs', qty: 6 },
                    { name: 'Dana Dolly Kit', qty: 1 },
                    { name: 'Grip Cart', qty: 6 },
                    { name: 'Full Apple Box Kit', qty: 4 }
                ]
            }
        ]
    }
};

// ── Update ──────────────────────────────────────────────────────────

function update() {
    const up = keys['w'] || keys['W'] || keys['ArrowUp'];
    const down = keys['s'] || keys['S'] || keys['ArrowDown'];
    const left = keys['a'] || keys['A'] || keys['ArrowLeft'];
    const right = keys['d'] || keys['D'] || keys['ArrowRight'];

    let inputX = 0, inputY = 0, inputThrust = false;

    if (joystick.active && joystick.magnitude > 0.15) {
        inputX = joystick.dx;
        inputY = joystick.dy;
        inputThrust = true;
    } else {
        if (up) { inputY = -1; inputThrust = true; }
        if (down) inputY = 1;
        if (left) inputX = -1;
        if (right) inputX = 1;
    }

    // Turning
    if (inputX !== 0 && Math.abs(car.speed) > 0.1) {
        car.angle += car.turnSpeed * (inputX > 0 ? 1 : -1) * Math.sign(car.speed);
    }

    // Joystick angle steering (when moving)
    if (joystick.active && joystick.magnitude > 0.3 && Math.abs(car.speed) > 0.05) {
        const targetAngle = Math.atan2(inputY, inputX);
        let diff = targetAngle - car.angle;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        car.angle += diff * 0.08;
    }

    // Acceleration
    if (inputThrust) {
        car.speed += car.accel;
    } else if (inputY > 0 && !joystick.active) {
        car.speed -= car.brake;
    }

    car.speed *= car.friction;
    if (Math.abs(car.speed) < 0.01) car.speed = 0;
    car.speed = Math.max(-car.maxSpeed * 0.4, Math.min(car.maxSpeed, car.speed));

    car.x += Math.cos(car.angle) * car.speed;
    car.y += Math.sin(car.angle) * car.speed;

    // Camera smoothly follows car
    cam.x += (car.x - GW / 2 - cam.x) * 0.08;
    cam.y += (car.y - GH / 2 - cam.y) * 0.08;

    // Check destination zones
    for (const dest of destinations) {
        const dx = car.x - dest.x;
        const dy = car.y - dest.y;
        if (Math.sqrt(dx * dx + dy * dy) < 18) {
            arrived = dest.dir;
            running = false;
            showInventory(dest.dir);
            break;
        }
    }
}

// ── Draw Helpers (pixel-scale aware) ────────────────────────────────

function px(x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(
        Math.floor((x - cam.x) * PIXEL),
        Math.floor((y - cam.y) * PIXEL),
        Math.ceil(w * PIXEL),
        Math.ceil(h * PIXEL)
    );
}

function pxText(text, x, y, color, size) {
    ctx.fillStyle = color;
    ctx.font = `${size || 10}px "Courier New", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, (x - cam.x) * PIXEL, (y - cam.y) * PIXEL);
}

// ── Draw ────────────────────────────────────────────────────────────

function draw() {
    // Clear with grass
    ctx.fillStyle = C.grass1;
    ctx.fillRect(0, 0, W, H);

    // Grass variation patches
    for (let gx = Math.floor(cam.x / 20) * 20 - 20; gx < cam.x + GW + 20; gx += 20) {
        for (let gy = Math.floor(cam.y / 20) * 20 - 20; gy < cam.y + GH + 20; gy += 20) {
            if ((Math.floor(gx / 20) + Math.floor(gy / 20)) % 3 === 0) {
                px(gx, gy, 20, 20, C.grass2);
            }
        }
    }

    // Draw roads
    drawRoads();

    // Draw scenery (trees)
    const sorted = [...scenery].sort((a, b) => a.y - b.y);
    for (const s of sorted) {
        if (s.y < car.y) drawTree(s.x, s.y);
    }

    // Draw destination buildings
    for (const dest of destinations) {
        drawBuilding(dest.x, dest.y, dest.label);
    }

    // Draw crossroads signs
    drawCrossroadsSigns();

    // Draw car
    drawCar();

    // Draw scenery in front of car
    for (const s of sorted) {
        if (s.y >= car.y) drawTree(s.x, s.y);
    }

    // HUD
    drawHUD();
}

function drawRoads() {
    // Vertical road (main road going up from start to Equipment)
    px(CROSS_X - ROAD_W / 2, CROSS_Y - 200, ROAD_W, 400, C.road);

    // Horizontal road (left to Lights, right to Grip)
    px(CROSS_X - 200, CROSS_Y - ROAD_W / 2, 400, ROAD_W, C.road);

    // Center line dashes — vertical
    for (let y = CROSS_Y - 200; y < CROSS_Y + 200; y += 8) {
        if (Math.abs(y - CROSS_Y) < ROAD_W / 2) continue; // skip crossroads center
        px(CROSS_X - 0.5, y, 1, 4, C.roadLine);
    }

    // Center line dashes — horizontal
    for (let x = CROSS_X - 200; x < CROSS_X + 200; x += 8) {
        if (Math.abs(x - CROSS_X) < ROAD_W / 2) continue;
        px(x, CROSS_Y - 0.5, 4, 1, C.roadLine);
    }
}

function drawTree(x, y) {
    // Trunk
    px(x - 1, y - 2, 3, 5, C.treeTrunk);
    // Canopy
    px(x - 4, y - 7, 9, 5, C.tree);
    px(x - 3, y - 9, 7, 3, C.tree);
}

function drawBuilding(x, y, label) {
    // Building body
    px(x - 14, y - 10, 28, 18, C.building);
    // Roof
    px(x - 16, y - 12, 32, 4, C.buildingRoof);
    // Door
    px(x - 2, y + 2, 5, 6, C.buildingDoor);
    // Label
    pxText(label, x, y - 5, C.white, 9);
}

function drawCrossroadsSigns() {
    const signY = CROSS_Y - ROAD_W / 2 - 6;

    // Left sign
    px(CROSS_X - 18, signY - 6, 14, 8, C.signBoard);
    pxText('LIGHTS', CROSS_X - 11, signY - 2, C.signText, 7);
    // Arrow left
    pxText('<', CROSS_X - 20, signY - 2, C.arrow, 9);

    // Straight sign
    px(CROSS_X - 5, signY - 14, 11, 8, C.signBoard);
    pxText('EQUIP', CROSS_X, signY - 10, C.signText, 7);
    // Arrow up
    pxText('^', CROSS_X, signY - 17, C.arrow, 9);

    // Right sign
    px(CROSS_X + 5, signY - 6, 14, 8, C.signBoard);
    pxText('GRIP', CROSS_X + 12, signY - 2, C.signText, 7);
    // Arrow right
    pxText('>', CROSS_X + 21, signY - 2, C.arrow, 9);
}

function drawCar() {
    ctx.save();
    const sx = (car.x - cam.x) * PIXEL;
    const sy = (car.y - cam.y) * PIXEL;
    ctx.translate(sx, sy);
    ctx.rotate(car.angle + Math.PI / 2); // car sprite faces up at angle 0

    const s = PIXEL;

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(-4 * s, -1 * s, 8 * s, 12 * s);

    // Body
    ctx.fillStyle = C.car;
    ctx.fillRect(-3 * s, -5 * s, 6 * s, 10 * s);

    // Hood (front darker)
    ctx.fillStyle = C.carDark;
    ctx.fillRect(-3 * s, -5 * s, 6 * s, 3 * s);

    // Windshield
    ctx.fillStyle = C.carWindow;
    ctx.fillRect(-2 * s, -2 * s, 4 * s, 2 * s);

    // Rear window
    ctx.fillStyle = C.carWindow;
    ctx.fillRect(-2 * s, 3 * s, 4 * s, 1.5 * s);

    // Wheels
    ctx.fillStyle = C.carWheel;
    ctx.fillRect(-4 * s, -4 * s, 1.5 * s, 3 * s);
    ctx.fillRect(2.5 * s, -4 * s, 1.5 * s, 3 * s);
    ctx.fillRect(-4 * s, 2 * s, 1.5 * s, 3 * s);
    ctx.fillRect(2.5 * s, 2 * s, 1.5 * s, 3 * s);

    // Headlights
    if (car.speed > 0.05) {
        ctx.fillStyle = '#ffee88';
        ctx.fillRect(-2 * s, -5.5 * s, 1.5 * s, 1 * s);
        ctx.fillRect(0.5 * s, -5.5 * s, 1.5 * s, 1 * s);
    }

    // Brake lights
    if (car.speed < -0.01 || (keys['s'] || keys['S'] || keys['ArrowDown'])) {
        ctx.fillStyle = '#ff3333';
        ctx.fillRect(-2.5 * s, 4.5 * s, 1.5 * s, 0.8 * s);
        ctx.fillRect(1 * s, 4.5 * s, 1.5 * s, 0.8 * s);
    }

    ctx.restore();
}

function drawHUD() {
    // Subtle instruction text at bottom
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '12px "Courier New", monospace';
    ctx.textAlign = 'center';

    const hint = isTouchDevice ? 'Use the joystick to drive' : 'WASD or Arrow Keys to drive';
    ctx.fillText(hint, W / 2, H - 20);

    // "Back to space" link top-left
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '11px "Courier New", monospace';
    ctx.textAlign = 'left';
    ctx.fillText('< BACK TO SPACE', 16, 24);
}

// ── Back to space (click top-left) ──────────────────────────────────

canvas.addEventListener('click', e => {
    if (e.clientX < 160 && e.clientY < 40) {
        window.location.href = 'index.html';
    }
});

canvas.addEventListener('touchend', e => {
    const t = e.changedTouches[0];
    if (t.clientX < 160 && t.clientY < 40) {
        window.location.href = 'index.html';
    }
});

// ── Inventory Overlay ───────────────────────────────────────────────

const invOverlay = document.getElementById('inventory-overlay');
const invContent = document.getElementById('inventory-content');
const invBackBtn = document.getElementById('inv-back-btn');
const joystickZone = document.getElementById('joystick-zone');

function showInventory(dir) {
    const data = inventoryData[dir];
    let html = `
        <div class="receipt-header">
            <h2>MOONLIT CINEMAS</h2>
            <p>Alden Hammersmith — Gaffer</p>
            <p style="margin-top:6px;font-weight:bold;">${data.title}</p>
            ${data.subtitle ? `<p style="font-size:0.7rem;">${data.subtitle}</p>` : ''}
        </div>
    `;

    for (const section of data.sections) {
        html += `<div class="receipt-section"><h3>${section.name}</h3>`;
        for (const item of section.items) {
            const desc = item.desc ? `<span class="desc">${item.desc}</span>` : '';
            html += `<div class="receipt-item"><span class="name">${item.name}${desc}</span><span class="qty">x${item.qty}</span></div>`;
        }
        html += `</div>`;
    }

    html += `<div class="receipt-footer">james440alden@gmail.com<br>Equipment subject to availability</div>`;

    invContent.innerHTML = html;
    invOverlay.classList.remove('hidden');
    if (joystickZone) joystickZone.style.display = 'none';
}

invBackBtn.addEventListener('click', () => {
    invOverlay.classList.add('hidden');
    if (joystickZone && isTouchDevice) joystickZone.style.display = 'block';

    // Reset car position away from destination
    car.x = CROSS_X;
    car.y = CROSS_Y + 20;
    car.speed = 0;
    car.angle = -Math.PI / 2;
    arrived = null;
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
