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

// Prevent mobile scroll (only when game is active, not on overlays)
document.body.addEventListener('touchmove', e => {
    if (!document.querySelector('.overlay:not(.hidden)')) {
        e.preventDefault();
    }
}, { passive: false });

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
const START_Y = 400;     // car start offset below crossroads (longer approach)
const ZONE_DIST = 120;   // distance from crossroads to trigger zone

// ── Rocket (back to space) ───────────────────────────────────────────

const rocket = {
    x: CROSS_X,
    y: CROSS_Y + START_Y + 60,
    radius: 18
};

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

// Trees along the main road (vertical) — extended for longer approach
for (let y = -250; y <= START_Y + 50; y += 18 + Math.floor(Math.random() * 12)) {
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

// ── Billboards along the approach road ──────────────────────────────

const BB_OFFSET = ROAD_W / 2 + 34;
const billboards = [
    { label: 'GRIP GEAR', sublabel: 'Stands & Rigging', direction: 'Turn Right', arrow: '\u2192', x: CROSS_X + BB_OFFSET, y: CROSS_Y + 100 },
    { label: 'LIGHTS', sublabel: 'Fixtures & Mods', direction: 'Turn Left', arrow: '\u2190', x: CROSS_X - BB_OFFSET, y: CROSS_Y + 210 },
    { label: 'EQUIPMENT', sublabel: 'Full Inventory', direction: 'Straight Ahead', arrow: '\u2191', x: CROSS_X + BB_OFFSET, y: CROSS_Y + 320 }
];

// Remove trees that collide with billboards
for (let i = scenery.length - 1; i >= 0; i--) {
    const s = scenery[i];
    for (const bb of billboards) {
        const dx = s.x - bb.x;
        const dy = s.y - bb.y;
        if (Math.abs(dx) < 55 && Math.abs(dy) < 60) {
            scenery.splice(i, 1);
            break;
        }
    }
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

    // Check rocket (back to space)
    {
        const dx = car.x - rocket.x;
        const dy = car.y - rocket.y;
        if (Math.sqrt(dx * dx + dy * dy) < rocket.radius) {
            window.location.href = 'index.html';
            return;
        }
    }

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
    ctx.font = `bold ${size || 10}px "Courier New", monospace`;
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

    // Draw rocket (behind car)
    if (rocket.y < car.y) drawRocket();

    // Draw billboards (behind car if above, in front if below)
    for (const bb of billboards) {
        if (bb.y < car.y) drawBillboard(bb);
    }

    // Draw destination buildings
    for (const dest of destinations) {
        drawBuilding(dest.x, dest.y, dest.label);
    }

    // Draw crossroads signs
    drawCrossroadsSigns();

    // Draw car
    drawCar();

    // Draw rocket (in front of car)
    if (rocket.y >= car.y) drawRocket();

    // Draw billboards in front of car
    for (const bb of billboards) {
        if (bb.y >= car.y) drawBillboard(bb);
    }

    // Draw scenery in front of car
    for (const s of sorted) {
        if (s.y >= car.y) drawTree(s.x, s.y);
    }

    // HUD
    drawHUD();
}

function drawRoads() {
    // Vertical road (extended for longer approach)
    px(CROSS_X - ROAD_W / 2, CROSS_Y - 200, ROAD_W, START_Y + 250, C.road);

    // Horizontal road (left to Lights, right to Grip)
    px(CROSS_X - 200, CROSS_Y - ROAD_W / 2, 400, ROAD_W, C.road);

    // Center line dashes — vertical (extended)
    for (let y = CROSS_Y - 200; y < CROSS_Y + START_Y + 50; y += 8) {
        if (Math.abs(y - CROSS_Y) < ROAD_W / 2) continue;
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

function drawRocket() {
    const rx = rocket.x;
    const ry = rocket.y;

    // Landing pad (circle-ish)
    px(rx - 12, ry + 4, 24, 3, '#333344');
    px(rx - 10, ry + 7, 20, 2, '#2a2a3a');

    // Exhaust glow (subtle)
    const flicker = 0.5 + Math.random() * 0.3;
    px(rx - 3, ry + 2, 6, 3, `rgba(255,150,50,${flicker * 0.3})`);

    // Rocket body
    px(rx - 4, ry - 14, 8, 18, '#ccccdd');
    // Dark stripe
    px(rx - 4, ry - 4, 8, 3, '#8888aa');
    // Nose cone
    px(rx - 3, ry - 18, 6, 4, '#ee4444');
    px(rx - 2, ry - 20, 4, 2, '#ee4444');
    px(rx - 1, ry - 22, 2, 2, '#ee4444');
    // Window
    px(rx - 1.5, ry - 12, 3, 3, '#446688');
    // Fins
    px(rx - 7, ry, 3, 5, '#cc3333');
    px(rx + 4, ry, 3, 5, '#cc3333');

    // Label
    pxText('BACK TO SPACE', rx, ry + 13, '#ccddbb', 13);
}

function drawBillboard(bb) {
    const bw = 62;  // billboard width
    const bh = 48;  // billboard height

    // Posts (two legs)
    px(bb.x - 8, bb.y, 3, 12, C.sign);
    px(bb.x + 6, bb.y, 3, 12, C.sign);

    // Board background
    px(bb.x - bw / 2, bb.y - bh, bw, bh, '#111a11');
    // Board border (thicker)
    px(bb.x - bw / 2, bb.y - bh, bw, 2, '#667744');
    px(bb.x - bw / 2, bb.y - 2, bw, 2, '#667744');
    px(bb.x - bw / 2, bb.y - bh, 2, bh, '#667744');
    px(bb.x + bw / 2 - 2, bb.y - bh, 2, bh, '#667744');

    // Direction text with inline arrow
    // Measure text to position arrow next to it
    ctx.font = 'bold 13px "Courier New", monospace';
    const dirText = bb.direction;
    const dirW = ctx.measureText(dirText).width / PIXEL;
    const lineY = bb.y - bh + 12;
    const lineCX = (bb.x - cam.x) * PIXEL;

    const ay = (lineY - cam.y) * PIXEL;
    const as = 4 * PIXEL;
    ctx.fillStyle = C.arrow;
    const shaft = as * 0.3; // shaft thickness

    if (bb.arrow === '\u2192') { // right — arrow on right side of text
        pxText(dirText, bb.x - 4, lineY, C.arrow, 13);
        const textRight = lineCX + (dirW / 2) * PIXEL;
        const ax = textRight + 6 * PIXEL;
        // Shaft
        ctx.fillRect(ax - as * 1.35, ay - shaft, as * 1.35, shaft * 2);
        // Triangle head
        ctx.beginPath();
        ctx.moveTo(ax + as * 0.75, ay);
        ctx.lineTo(ax - as * 0.25, ay - as * 0.75);
        ctx.lineTo(ax - as * 0.25, ay + as * 0.75);
        ctx.closePath();
        ctx.fill();
    } else if (bb.arrow === '\u2190') { // left — arrow on left side of text
        pxText(dirText, bb.x + 4, lineY, C.arrow, 13);
        const textLeft = lineCX - (dirW / 2) * PIXEL;
        const ax = textLeft - 6 * PIXEL;
        // Shaft
        ctx.fillRect(ax, ay - shaft, as * 1.35, shaft * 2);
        // Triangle head
        ctx.beginPath();
        ctx.moveTo(ax - as * 0.75, ay);
        ctx.lineTo(ax + as * 0.25, ay - as * 0.75);
        ctx.lineTo(ax + as * 0.25, ay + as * 0.75);
        ctx.closePath();
        ctx.fill();
    } else { // up — arrow left of text
        pxText(dirText, bb.x + 4, lineY, C.arrow, 13);
        const textLeft = lineCX - (dirW / 2) * PIXEL;
        const ax = textLeft - 6 * PIXEL;
        // Shaft
        ctx.fillRect(ax - shaft, ay, shaft * 2, as * 1.35);
        // Triangle head
        ctx.beginPath();
        ctx.moveTo(ax, ay - as * 0.75);
        ctx.lineTo(ax - as * 0.75, ay + as * 0.25);
        ctx.lineTo(ax + as * 0.75, ay + as * 0.25);
        ctx.closePath();
        ctx.fill();
    }

    // Label (middle, big)
    pxText(bb.label, bb.x, bb.y - bh + 26, C.white, 17);
    // Sublabel (bottom)
    pxText(bb.sublabel, bb.x, bb.y - bh + 40, '#ccddbb', 13);
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

}

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

    // Reset car on the approach road, facing forward (up)
    car.x = CROSS_X;
    car.y = CROSS_Y + START_Y - 40;
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
