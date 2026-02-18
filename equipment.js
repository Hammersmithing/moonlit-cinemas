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

// ── Launch Cranes (flanking the rocket) ─────────────────────────────

const cranes = [
    { x: rocket.x - 50, y: rocket.y + 10, side: 'left',
      baseX: rocket.x - 50, baseY: rocket.y + 10,
      phase: 0, t: 0, boomSwing: 0, boomRaise: 0, driveOffset: 0,
      state: 'working', stateT: 0 },
    { x: rocket.x + 50, y: rocket.y + 10, side: 'right',
      baseX: rocket.x + 50, baseY: rocket.y + 10,
      phase: 2, t: 0, boomSwing: 0, boomRaise: 0, driveOffset: 0,
      state: 'working', stateT: 0 }
];

// ── Box Truck & Workers ─────────────────────────────────────────────

const truck = {
    x: rocket.x + 75,
    y: rocket.y + 25
};

// Lights delivered to each crane (index matches cranes[])
const craneLights = [
    { placed: false, pickedUp: false,
      dropX: cranes[0].baseX + 8, dropY: cranes[0].baseY + 5 },
    { placed: false, pickedUp: false,
      dropX: cranes[1].baseX - 8, dropY: cranes[1].baseY + 5 }
];

const workers = {
    t: 0,
    phase: 0,   // 0-7: two round trips (right crane first, then left)
    done: false,
    w1x: 0, w1y: 0,
    w2x: 0, w2y: 0,
    carrying: false
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

// Billboard light flash state (next billboard flickers when you pass one)
const bbFlash = billboards.map(() => ({
    triggered: false,
    timer: 0,
    count: 0,    // how many on/off cycles completed
    on: false     // current flash state
}));

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

// Remove trees near cranes
for (let i = scenery.length - 1; i >= 0; i--) {
    const s = scenery[i];
    for (const cr of cranes) {
        const dx = s.x - cr.x;
        const dy = s.y - cr.y;
        if (Math.abs(dx) < 30 && Math.abs(dy) < 50) {
            scenery.splice(i, 1);
            break;
        }
    }
}

// Remove trees near truck
for (let i = scenery.length - 1; i >= 0; i--) {
    const s = scenery[i];
    const dx = s.x - truck.x;
    const dy = s.y - truck.y;
    if (Math.abs(dx) < 35 && Math.abs(dy) < 40) {
        scenery.splice(i, 1);
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

// ── Social Billboard (top-left of crossing) ────────────────────────

const socialVideo = document.createElement('video');
socialVideo.src = 'social-video.mp4';
socialVideo.loop = true;
socialVideo.muted = true;
socialVideo.playsInline = true;
socialVideo.preload = 'auto';
let socialPlaying = false;

const socialBillboard = {
    x: CROSS_X - 80,
    y: CROSS_Y - 25,
    viewDist: 120
};

// Remove trees near social billboard
for (let i = scenery.length - 1; i >= 0; i--) {
    const s = scenery[i];
    const dx = s.x - socialBillboard.x;
    const dy = s.y - socialBillboard.y;
    if (Math.abs(dx) < 65 && Math.abs(dy) < 65) {
        scenery.splice(i, 1);
    }
}

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

    // Social billboard — play/pause video based on distance
    {
        const dx = car.x - socialBillboard.x;
        const dy = car.y - socialBillboard.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < socialBillboard.viewDist && !socialPlaying) {
            socialVideo.play().catch(() => {});
            socialPlaying = true;
        } else if (dist >= socialBillboard.viewDist && socialPlaying) {
            socialVideo.pause();
            socialPlaying = false;
        }
    }

    // Animate workers — two round trips delivering HMI lights to cranes
    {
        const w = workers;
        if (!w.done) {
            const truckBackX = truck.x - 10;
            const truckBackY = truck.y + 8;
            // Trip 1 → right crane (closer), Trip 2 → left crane (farther)
            const dest1X = craneLights[1].dropX;
            const dest1Y = craneLights[1].dropY;
            const dest2X = craneLights[0].dropX;
            const dest2Y = craneLights[0].dropY;

            const walkSpeed = 0.25; // game pixels per frame

            if (w.phase === 0 || w.phase === 4) {
                // Pause at truck
                w.t += 0.005;
                w.w1x = truckBackX; w.w1y = truckBackY;
                w.w2x = truckBackX; w.w2y = truckBackY + 5;
                w.carrying = false;
            } else if (w.phase === 1) {
                // Walk to right crane drop with light
                const dx = dest1X - truckBackX, dy = dest1Y - truckBackY;
                const dist = Math.sqrt(dx * dx + dy * dy);
                w.t += walkSpeed / Math.max(dist, 1);
                const p = Math.min(w.t, 1);
                w.w1x = truckBackX + dx * p;
                w.w1y = truckBackY + dy * p;
                w.w2x = w.w1x + 3; w.w2y = w.w1y + 5;
                w.carrying = true;
            } else if (w.phase === 2) {
                // Set down light 1
                w.t += 0.008;
                w.w1x = dest1X; w.w1y = dest1Y;
                w.w2x = dest1X + 3; w.w2y = dest1Y + 5;
                w.carrying = false;
                if (!craneLights[1].placed) craneLights[1].placed = true;
            } else if (w.phase === 3) {
                // Walk back to truck
                const dx = truckBackX - dest1X, dy = truckBackY - dest1Y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                w.t += walkSpeed / Math.max(dist, 1);
                const p = Math.min(w.t, 1);
                w.w1x = dest1X + dx * p;
                w.w1y = dest1Y + dy * p;
                w.w2x = w.w1x + 3; w.w2y = w.w1y + 5;
                w.carrying = false;
            } else if (w.phase === 5) {
                // Walk to left crane drop with light
                const dx = dest2X - truckBackX, dy = dest2Y - truckBackY;
                const dist = Math.sqrt(dx * dx + dy * dy);
                w.t += walkSpeed / Math.max(dist, 1);
                const p = Math.min(w.t, 1);
                w.w1x = truckBackX + dx * p;
                w.w1y = truckBackY + dy * p;
                w.w2x = w.w1x + 3; w.w2y = w.w1y + 5;
                w.carrying = true;
            } else if (w.phase === 6) {
                // Set down light 2
                w.t += 0.008;
                w.w1x = dest2X; w.w1y = dest2Y;
                w.w2x = dest2X + 3; w.w2y = dest2Y + 5;
                w.carrying = false;
                if (!craneLights[0].placed) craneLights[0].placed = true;
            } else if (w.phase === 7) {
                // Walk back to truck
                const dx = truckBackX - dest2X, dy = truckBackY - dest2Y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                w.t += walkSpeed / Math.max(dist, 1);
                const p = Math.min(w.t, 1);
                w.w1x = dest2X + dx * p;
                w.w1y = dest2Y + dy * p;
                w.w2x = w.w1x + 3; w.w2y = w.w1y + 5;
                w.carrying = false;
            }

            if (w.t >= 1) {
                w.t = 0;
                w.phase++;
                if (w.phase > 7) w.done = true;
            }
        } else {
            // Done — workers idle at truck
            w.w1x = truck.x - 10; w.w1y = truck.y + 8;
            w.w2x = truck.x - 7; w.w2y = truck.y + 13;
            w.carrying = false;
        }
    }

    // Animate cranes — state machine: working → pickup → lifting → holding
    for (let ci = 0; ci < cranes.length; ci++) {
        const cr = cranes[ci];
        const cl = craneLights[ci];

        if (cr.state === 'working') {
            // Normal 3-phase animation (swing, raise, drive)
            const speed = 0.0015;
            cr.t += speed;
            if (cr.t >= 1) {
                cr.t = 0;
                cr.phase = (cr.phase + 1) % 3;
            }
            const pp = Math.sin(cr.t * Math.PI);

            if (cr.phase === 0) {
                const dir = cr.side === 'left' ? -1 : 1;
                cr.boomSwing = pp * 0.2 * dir;
                cr.boomRaise = 0;
                cr.driveOffset = 0;
            } else if (cr.phase === 1) {
                cr.boomSwing = 0;
                cr.boomRaise = pp * 0.25;
                cr.driveOffset = 0;
            } else {
                cr.boomSwing = 0;
                cr.boomRaise = 0;
                cr.driveOffset = -pp * 6;
            }

            // Transition to pickup when light is placed
            if (cl.placed && !cl.pickedUp) {
                cr.state = 'pickup';
                cr.stateT = 0;
                cr.driveOffset = 0;
            }
        } else if (cr.state === 'pickup') {
            // Lower boom to reach the light on the ground
            cr.stateT += 0.004;
            cr.boomSwing = 0;
            cr.boomRaise = cr.boomRaise * (1 - cr.stateT) + (-0.83) * cr.stateT;
            cr.driveOffset = 0;
            if (cr.stateT >= 1) {
                cr.boomRaise = -0.83;
                cr.state = 'lifting';
                cr.stateT = 0;
                cl.pickedUp = true;
            }
        } else if (cr.state === 'lifting') {
            // Raise boom with light attached
            cr.stateT += 0.003;
            cr.boomRaise = -0.83 + cr.stateT * 1.03; // -0.83 → 0.2
            cr.boomSwing = 0;
            cr.driveOffset = 0;
            if (cr.stateT >= 1) {
                cr.boomRaise = 0.2;
                cr.state = 'holding';
            }
        } else if (cr.state === 'holding') {
            // Hold position with light up
            cr.boomRaise = 0.2;
            cr.boomSwing = 0;
            cr.driveOffset = 0;
        }

        cr.x = cr.baseX;
        cr.y = cr.baseY - cr.driveOffset;
    }

    // Billboard flash triggers — passing one billboard flickers the next (skip index 0)
    for (let i = billboards.length - 1; i > 1; i--) {
        if (car.y < billboards[i].y && !bbFlash[i - 1].triggered) {
            bbFlash[i - 1].triggered = true;
            bbFlash[i - 1].timer = 0;
            bbFlash[i - 1].count = 0;
            bbFlash[i - 1].on = false;
        }
    }
    for (const f of bbFlash) {
        if (f.triggered && f.count < 4) {
            f.timer++;
            // First 2 blinks fast (5 frames), last 2 slow (10 frames)
            const speed = f.count < 2 ? 5 : 10;
            if (f.timer >= speed) {
                f.timer = 0;
                f.on = !f.on;
                if (!f.on) f.count++;
            }
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

// ── Time-of-Day Lighting ───────────────────────────────────────────

function getDarkness() {
    const h = new Date().getHours();
    const m = new Date().getMinutes();
    const t = h + m / 60;
    if (t >= 7 && t <= 17) return 0;         // daytime
    if (t >= 20 || t <= 4) return 0.7;       // full night
    if (t > 4 && t < 7) return 0.7 * (1 - (t - 4) / 3);   // dawn
    if (t > 17 && t < 20) return 0.7 * ((t - 17) / 3);     // dusk
    return 0;
}

function getTimeTint() {
    const h = new Date().getHours();
    const m = new Date().getMinutes();
    const t = h + m / 60;
    // Dawn warm tint (5-7)
    if (t > 5 && t < 7) {
        const f = 1 - Math.abs(t - 6) / 1;
        return { r: 60, g: 20, b: 0, a: f * 0.15 };
    }
    // Dusk warm tint (17-19)
    if (t > 17 && t < 19) {
        const f = 1 - Math.abs(t - 18) / 1;
        return { r: 80, g: 30, b: 0, a: f * 0.2 };
    }
    return null;
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

    // Draw truck & workers (behind car)
    if (truck.y < car.y) {
        drawTruck();
        drawWorkers();
    }

    // Draw cranes (behind car)
    for (let i = 0; i < cranes.length; i++) {
        if (cranes[i].y < car.y) drawCrane(i);
    }

    // Draw rocket (behind car)
    if (rocket.y < car.y) drawRocket();

    // Draw billboards (behind car if above, in front if below)
    for (let i = 0; i < billboards.length; i++) {
        if (billboards[i].y < car.y) drawBillboard(billboards[i], bbFlash[i]);
    }

    // Draw destination buildings
    for (const dest of destinations) {
        drawBuilding(dest.x, dest.y, dest.label);
    }

    // Draw social billboard (behind car if above)
    if (socialBillboard.y < car.y) drawSocialBillboard();

    // Draw crossroads signs
    drawCrossroadsSigns();

    // Draw car
    drawCar();

    // Draw rocket (in front of car)
    if (rocket.y >= car.y) drawRocket();

    // Draw billboards in front of car
    for (let i = 0; i < billboards.length; i++) {
        if (billboards[i].y >= car.y) drawBillboard(billboards[i], bbFlash[i]);
    }

    // Draw social billboard (in front of car if below)
    if (socialBillboard.y >= car.y) drawSocialBillboard();

    // Draw cranes (in front of car)
    for (let i = 0; i < cranes.length; i++) {
        if (cranes[i].y >= car.y) drawCrane(i);
    }

    // Draw truck & workers (in front of car)
    if (truck.y >= car.y) {
        drawTruck();
        drawWorkers();
    }

    // Draw scenery in front of car
    for (const s of sorted) {
        if (s.y >= car.y) drawTree(s.x, s.y);
    }

    // Time-of-day lighting
    const darkness = getDarkness();

    // Darkness overlay with vignette
    if (darkness > 0) {
        ctx.fillStyle = `rgba(5, 5, 30, ${darkness})`;
        ctx.fillRect(0, 0, W, H);

        // Vignette (darker at edges)
        const vigGrad = ctx.createRadialGradient(W / 2, H / 2, W * 0.25, W / 2, H / 2, W * 0.7);
        vigGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
        vigGrad.addColorStop(1, `rgba(0, 0, 10, ${darkness * 0.4})`);
        ctx.fillStyle = vigGrad;
        ctx.fillRect(0, 0, W, H);
    }

    // Dawn/dusk warm tint
    const tint = getTimeTint();
    if (tint) {
        ctx.fillStyle = `rgba(${tint.r}, ${tint.g}, ${tint.b}, ${tint.a})`;
        ctx.fillRect(0, 0, W, H);
    }

    // Headlight cones (when dark)
    if (darkness > 0.1) {
        drawHeadlightCones(darkness);
    }

    // Crane-mounted HMI illumination (when dark and lights are lifted)
    if (darkness > 0.1) {
        drawCraneLightBeams(darkness);
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

function drawCrane(idx) {
    const cr = cranes[idx];
    const cl = craneLights[idx];
    const cx = cr.x;
    const cy = cr.y;
    const dir = cr.side === 'left' ? 1 : -1; // boom points toward rocket

    const yellow = '#ddaa22';
    const darkYellow = '#bb8811';
    const black = '#222';

    // Draw ground HMI (placed but not yet picked up)
    if (cl.placed && !cl.pickedUp) {
        drawHMI(cl.dropX, cl.dropY, false);
    }

    // Tracks (caterpillar treads)
    px(cx - 8, cy + 1, 16, 4, black);
    px(cx - 9, cy + 2, 1, 2, '#444');
    px(cx + 8, cy + 2, 1, 2, '#444');

    // Body / chassis
    px(cx - 6, cy - 5, 12, 7, yellow);
    px(cx - 6, cy - 6, 12, 1, darkYellow);

    // Engine housing (back side)
    px(cx - dir * 4, cy - 8, 6, 4, darkYellow);
    // Exhaust pipe
    px(cx - dir * 2, cy - 10, 2, 2, '#444');

    // Cab (operator)
    px(cx + dir * 2, cy - 10, 5 * dir, 6, yellow);
    px(cx + dir * 3, cy - 9, 3 * dir, 3, '#446688'); // window

    // Boom arm (angled up toward rocket, animated)
    const boomLen = 35;
    const baseBoomRise = 30;
    const boomRise = baseBoomRise + (cr.boomRaise || 0) * baseBoomRise;
    const boomStartX = cx + dir * 3;
    const boomStartY = cy - 10;
    const swing = (cr.boomSwing || 0) * boomLen;
    const boomEndX = boomStartX + dir * boomLen + swing * dir;
    const boomEndY = boomStartY - boomRise;

    // Draw boom as thick angled line
    const bsx = (boomStartX - cam.x) * PIXEL;
    const bsy = (boomStartY - cam.y) * PIXEL;
    const bex = (boomEndX - cam.x) * PIXEL;
    const bey = (boomEndY - cam.y) * PIXEL;

    ctx.strokeStyle = yellow;
    ctx.lineWidth = 3 * PIXEL;
    ctx.beginPath();
    ctx.moveTo(bsx, bsy);
    ctx.lineTo(bex, bey);
    ctx.stroke();

    // Boom lattice cross pattern
    ctx.strokeStyle = darkYellow;
    ctx.lineWidth = 1;
    const steps = 6;
    for (let i = 1; i < steps; i++) {
        const t = i / steps;
        const mx = bsx + (bex - bsx) * t;
        const my = bsy + (bey - bsy) * t;
        const perpX = (bey - bsy) / steps * 0.3;
        const perpY = -(bex - bsx) / steps * 0.3;
        ctx.beginPath();
        ctx.moveTo(mx - perpX, my - perpY);
        ctx.lineTo(mx + perpX, my + perpY);
        ctx.stroke();
    }

    // Cable from boom tip down
    const cableEndY = boomEndY + 20;
    const cex = (boomEndX - cam.x) * PIXEL;
    const cey1 = bey;
    const cey2 = (cableEndY - cam.y) * PIXEL;
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cex, cey1);
    ctx.lineTo(cex, cey2);
    ctx.stroke();

    if (cl.pickedUp) {
        // Draw HMI attached to hook (lit when holding at night)
        const isLit = cr.state === 'holding' && getDarkness() > 0.1;
        drawHMI(boomEndX, cableEndY, true, isLit);

        // Store boom tip position for light beam rendering
        cl.beamX = boomEndX;
        cl.beamY = cableEndY;
    } else {
        // Regular hook
        px(boomEndX - 1, cableEndY, 3, 2, '#888');
        px(boomEndX - (dir > 0 ? 0 : 1), cableEndY + 2, 2, 1, '#888');
    }

    // Hydraulic cylinder (body to boom)
    const hydX1 = (cx - cam.x) * PIXEL;
    const hydY1 = ((cy - 5) - cam.y) * PIXEL;
    const hydX2 = bsx + (bex - bsx) * 0.35;
    const hydY2 = bsy + (bey - bsy) * 0.35;
    ctx.strokeStyle = '#999';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(hydX1, hydY1);
    ctx.lineTo(hydX2, hydY2);
    ctx.stroke();
}

function drawBillboard(bb, flash) {
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

    // Billboard spotlights (two point sources when dark)
    const dark = getDarkness();
    if (dark > 0.1) {
        const lx = (bb.x - cam.x) * PIXEL;
        const ly = (bb.y - bh - cam.y) * PIXEL;
        const lh = bh * PIXEL;
        const halfW = (bw / 2) * PIXEL;
        const alpha = Math.min(0.5, dark * 0.7);

        // Two light fixtures (at thirds of sign width)
        const thirdW = halfW * 2 / 3;
        const fixtures = [lx - thirdW / 2, lx + thirdW / 2];
        const flashing = flash && flash.triggered && flash.count < 4;

        for (let fi = 0; fi < fixtures.length; fi++) {
            const fx = fixtures[fi];

            // Left fixture (fi=0) flickers during flash sequence
            const isFlashLight = fi === 0 && flashing;
            const lightOn = isFlashLight ? flash.on : true;

            // Fixture dot
            ctx.fillStyle = lightOn ? '#ffee88' : '#333';
            ctx.fillRect(fx - 1.5 * PIXEL, ly - 2 * PIXEL, 3 * PIXEL, 2 * PIXEL);

            if (!lightOn) continue;

            // Triangle beam clipped to billboard face
            ctx.save();
            ctx.beginPath();
            ctx.rect(lx - halfW, ly, halfW * 2, lh);
            ctx.clip();

            ctx.beginPath();
            ctx.moveTo(fx - 2 * PIXEL, ly);
            ctx.lineTo(fx + 2 * PIXEL, ly);
            ctx.lineTo(lx + halfW, ly + lh);
            ctx.lineTo(lx - halfW, ly + lh);
            ctx.closePath();
            ctx.clip();

            const radius = Math.max(lh, halfW) * 1.3;
            const radGrad = ctx.createRadialGradient(fx, ly, 0, fx, ly + lh * 0.4, radius);
            radGrad.addColorStop(0, `rgba(255, 240, 160, ${alpha})`);
            radGrad.addColorStop(0.35, `rgba(255, 240, 160, ${alpha * 0.5})`);
            radGrad.addColorStop(0.7, `rgba(255, 240, 160, ${alpha * 0.15})`);
            radGrad.addColorStop(1, 'rgba(255, 240, 160, 0)');
            ctx.fillStyle = radGrad;
            ctx.fillRect(lx - halfW, ly, halfW * 2, lh);
            ctx.restore();
        }
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

    // Headlights (always on when dark, otherwise when moving)
    if (car.speed > 0.05 || getDarkness() > 0.1) {
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

function drawHeadlightCones(darkness) {
    const sx = (car.x - cam.x) * PIXEL;
    const sy = (car.y - cam.y) * PIXEL;
    const s = PIXEL;

    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(car.angle);

    const coneLen = 55 * s;
    const coneW = 12 * s;
    const alpha = Math.min(0.35, darkness * 0.5);

    // Two headlight cones (left and right headlight positions)
    const offsets = [-1.5 * s, 1.5 * s];
    for (const off of offsets) {
        const grad = ctx.createLinearGradient(5 * s, 0, coneLen, 0);
        grad.addColorStop(0, `rgba(255, 238, 120, ${alpha})`);
        grad.addColorStop(0.6, `rgba(255, 238, 120, ${alpha * 0.3})`);
        grad.addColorStop(1, 'rgba(255, 238, 120, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(5 * s, off);
        ctx.lineTo(coneLen, off - coneW);
        ctx.lineTo(coneLen, off + coneW);
        ctx.closePath();
        ctx.fill();
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

// ── Social Billboard Drawing & Overlay ──────────────────────────────

function drawSocialBillboard() {
    const bx = socialBillboard.x;
    const by = socialBillboard.y;
    const bw = 75;
    const bh = 120;

    // Posts (legs stop before road)
    const legH = Math.min(10, (CROSS_Y - ROAD_W / 2) - by - 1);
    if (legH > 0) {
        px(bx - 24, by, 5, legH, C.sign);
        px(bx + 20, by, 5, legH, C.sign);
    }

    // Board background
    px(bx - bw / 2, by - bh, bw, bh, '#0a0a1a');
    // Border
    px(bx - bw / 2, by - bh, bw, 3, '#4488cc');
    px(bx - bw / 2, by - 3, bw, 3, '#4488cc');
    px(bx - bw / 2, by - bh, 3, bh, '#4488cc');
    px(bx + bw / 2 - 3, by - bh, 3, bh, '#4488cc');

    // Draw video frame on the billboard
    const pad = 4;
    const imgX = Math.floor((bx - bw / 2 + pad - cam.x) * PIXEL);
    const imgY = Math.floor((by - bh + pad - cam.y) * PIXEL);
    const imgW = Math.ceil((bw - pad * 2) * PIXEL);
    const imgH = Math.ceil((bh - pad * 2) * PIXEL);

    if (socialVideo.readyState >= 2) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(socialVideo, imgX, imgY, imgW, imgH);
    } else {
        ctx.fillStyle = '#111';
        ctx.fillRect(imgX, imgY, imgW, imgH);
    }

    // Spotlights (two point sources when dark)
    const dark = getDarkness();
    if (dark > 0.1) {
        const lx = (bx - cam.x) * PIXEL;
        const ly = (by - bh - cam.y) * PIXEL;
        const lh = bh * PIXEL;
        const halfW = (bw / 2) * PIXEL;
        const alpha = Math.min(0.5, dark * 0.7);

        const thirdW = halfW * 2 / 3;
        const fixtures = [lx - thirdW / 2, lx + thirdW / 2];
        for (const fx of fixtures) {
            ctx.fillStyle = '#ffee88';
            ctx.fillRect(fx - 1.5 * PIXEL, ly - 2 * PIXEL, 3 * PIXEL, 2 * PIXEL);

            ctx.save();
            ctx.beginPath();
            ctx.rect(lx - halfW, ly, halfW * 2, lh);
            ctx.clip();

            ctx.beginPath();
            ctx.moveTo(fx - 2 * PIXEL, ly);
            ctx.lineTo(fx + 2 * PIXEL, ly);
            ctx.lineTo(lx + halfW, ly + lh);
            ctx.lineTo(lx - halfW, ly + lh);
            ctx.closePath();
            ctx.clip();

            const radius = Math.max(lh, halfW) * 1.3;
            const radGrad = ctx.createRadialGradient(fx, ly, 0, fx, ly + lh * 0.4, radius);
            radGrad.addColorStop(0, `rgba(255, 240, 160, ${alpha})`);
            radGrad.addColorStop(0.35, `rgba(255, 240, 160, ${alpha * 0.5})`);
            radGrad.addColorStop(0.7, `rgba(255, 240, 160, ${alpha * 0.15})`);
            radGrad.addColorStop(1, 'rgba(255, 240, 160, 0)');
            ctx.fillStyle = radGrad;
            ctx.fillRect(lx - halfW, ly, halfW * 2, lh);
            ctx.restore();
        }
    }
}

// ── Box Truck Drawing ───────────────────────────────────────────────

function drawTruck() {
    const tx = truck.x;
    const ty = truck.y;

    // Shadow
    px(tx - 14, ty + 6, 28, 4, 'rgba(0,0,0,0.15)');

    // Wheels (back and front axle)
    px(tx - 12, ty + 4, 4, 3, '#222');
    px(tx + 8, ty + 4, 4, 3, '#222');
    // Wheel hubs
    px(tx - 11, ty + 5, 2, 1, '#555');
    px(tx + 9, ty + 5, 2, 1, '#555');

    // Chassis / frame rail
    px(tx - 13, ty + 3, 26, 2, '#444');

    // Box body (big white cargo area)
    px(tx - 12, ty - 12, 20, 16, '#e8e8e8');
    // Roof edge
    px(tx - 12, ty - 13, 20, 1, '#ccc');
    // Bottom trim
    px(tx - 12, ty + 3, 20, 1, '#aaa');
    // Side panels / detail line
    px(tx - 12, ty - 4, 1, 7, '#bbb');
    px(tx + 7, ty - 4, 1, 7, '#bbb');

    // Roll-up door (rear, open — visible from side)
    px(tx - 12, ty - 4, 3, 8, '#999');
    px(tx - 12, ty - 5, 3, 1, '#888');

    // Cab
    px(tx + 8, ty - 8, 8, 12, '#ddd');
    // Cab roof
    px(tx + 8, ty - 9, 8, 1, '#bbb');
    // Cab window
    px(tx + 12, ty - 7, 3, 4, '#446688');
    // Cab door line
    px(tx + 11, ty - 6, 1, 8, '#aaa');

    // Front bumper
    px(tx + 15, ty + 1, 2, 3, '#888');

    // Headlight
    px(tx + 15, ty - 1, 2, 2, '#ffee88');
    // Tail light
    px(tx - 13, ty + 1, 1, 2, '#cc3333');

    // "MOONLIT" text on box body
    pxText('MOONLIT', tx - 2, ty - 5, '#888', 7);
}

// ── Workers Drawing ─────────────────────────────────────────────────

function drawWorkers() {
    const w = workers;
    const walking = w.phase === 1 || w.phase === 3 || w.phase === 5 || w.phase === 7;

    // Draw carried HMI between workers
    if (w.carrying) {
        const midX = (w.w1x + w.w2x) / 2;
        const midY = (w.w1y + w.w2y) / 2;
        drawHMI(midX, midY, true);
    }

    // Worker 1 (front)
    drawWorkerFigure(w.w1x, w.w1y, walking);

    // Worker 2 (behind, slightly offset)
    drawWorkerFigure(w.w2x, w.w2y, walking);
}

function drawHMI(x, y, carried, litUp) {
    // Arri 15K HMI — big chunky fresnel light
    const lx = x;
    const ly = carried ? y - 1 : y + 1;

    // Yoke / stirrup (U-shaped mounting bracket)
    px(lx - 4, ly - 2, 1, 5, '#666');
    px(lx + 4, ly - 2, 1, 5, '#666');
    px(lx - 4, ly + 3, 9, 1, '#666');

    // Light body (big barrel shape)
    px(lx - 3, ly - 3, 7, 6, '#333');
    px(lx - 2, ly - 4, 5, 1, '#444');

    // Lens face (front) — glows bright when lit
    const dark = getDarkness();
    const isLit = litUp || (carried && dark > 0.1);
    px(lx - 2, ly - 2, 5, 3, isLit ? '#ffe8a0' : '#556');
    px(lx - 1, ly - 1, 3, 1, isLit ? '#fff4cc' : '#668');

    // Rear housing (ballast/connector area)
    px(lx - 3, ly + 2, 7, 2, '#2a2a2a');

    // Cable dangling from back
    px(lx + 1, ly + 4, 1, 2, '#333');
    px(lx + 2, ly + 5, 1, 2, '#333');

    // Label
    if (!carried) {
        pxText('15K', lx + 1, ly - 6, '#999', 6);
    }
}

function drawWorkerFigure(x, y, walking) {
    // Hard hat
    px(x - 1, y - 6, 3, 2, '#ddaa22');
    // Head
    px(x, y - 4, 2, 2, '#ddb88c');
    // Body (work vest)
    px(x - 1, y - 2, 3, 4, '#dd8822');
    // Hi-vis stripe
    px(x - 1, y - 1, 3, 1, '#ffee44');
    // Legs
    if (walking) {
        // Walking — legs offset for stride
        const stride = Math.sin(Date.now() * 0.01) * 1.5;
        px(x - 1, y + 2, 1, 3, '#336');
        px(x + 1, y + 2, 1, 3, '#336');
        // Slight horizontal movement for walking effect
        px(x - 1 + (stride > 0 ? 1 : 0), y + 5, 1, 1, '#222');
        px(x + 1 + (stride > 0 ? 0 : 1), y + 5, 1, 1, '#222');
    } else {
        // Standing
        px(x - 1, y + 2, 1, 3, '#336');
        px(x + 1, y + 2, 1, 3, '#336');
        // Boots
        px(x - 1, y + 5, 1, 1, '#222');
        px(x + 1, y + 5, 1, 1, '#222');
    }
    // Arms
    px(x - 2, y - 2, 1, 3, '#ddb88c');
    px(x + 2, y - 2, 1, 3, '#ddb88c');
}

// ── Crane Light Beams (HMIs illuminating rocket at night) ───────────

function drawCraneLightBeams(darkness) {
    for (let i = 0; i < cranes.length; i++) {
        const cl = craneLights[i];
        if (!cl.pickedUp || cranes[i].state !== 'holding') continue;

        const alpha = Math.min(0.45, darkness * 0.6);

        // HMI lens glow
        const glowX = (cl.beamX - cam.x) * PIXEL;
        const glowY = (cl.beamY - cam.y) * PIXEL;
        const glowRad = 8 * PIXEL;
        const glowGrad = ctx.createRadialGradient(glowX, glowY, 0, glowX, glowY, glowRad);
        glowGrad.addColorStop(0, `rgba(255, 250, 220, ${alpha * 0.8})`);
        glowGrad.addColorStop(0.3, `rgba(255, 240, 180, ${alpha * 0.3})`);
        glowGrad.addColorStop(1, 'rgba(255, 240, 180, 0)');
        ctx.fillStyle = glowGrad;
        ctx.fillRect(glowX - glowRad, glowY - glowRad, glowRad * 2, glowRad * 2);

        // Cone of light from HMI down toward rocket area
        const lightX = (cl.beamX - cam.x) * PIXEL;
        const lightY = (cl.beamY - cam.y) * PIXEL;
        const targetX = (rocket.x - cam.x) * PIXEL;
        const targetY = (rocket.y + 10 - cam.y) * PIXEL;

        // Direction from light to target
        const dx = targetX - lightX;
        const dy = targetY - lightY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const nx = dx / dist;
        const ny = dy / dist;

        // Perpendicular for cone spread
        const px2 = -ny;
        const py2 = nx;
        const spread = 25 * PIXEL;

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(lightX - px2 * 3, lightY - py2 * 3);
        ctx.lineTo(lightX + px2 * 3, lightY + py2 * 3);
        ctx.lineTo(targetX + px2 * spread, targetY + py2 * spread);
        ctx.lineTo(targetX - px2 * spread, targetY - py2 * spread);
        ctx.closePath();
        ctx.clip();

        const beamGrad = ctx.createRadialGradient(
            lightX, lightY, 0,
            lightX + dx * 0.5, lightY + dy * 0.5, dist * 0.8
        );
        beamGrad.addColorStop(0, `rgba(255, 245, 200, ${alpha})`);
        beamGrad.addColorStop(0.3, `rgba(255, 245, 200, ${alpha * 0.4})`);
        beamGrad.addColorStop(0.7, `rgba(255, 245, 200, ${alpha * 0.1})`);
        beamGrad.addColorStop(1, 'rgba(255, 245, 200, 0)');
        ctx.fillStyle = beamGrad;
        ctx.fillRect(
            Math.min(lightX, targetX) - spread,
            Math.min(lightY, targetY) - spread,
            Math.abs(dx) + spread * 2,
            Math.abs(dy) + spread * 2
        );
        ctx.restore();
    }
}

// ── Game Loop ───────────────────────────────────────────────────────

function loop() {
    if (!running) return;
    update();
    draw();
    requestAnimationFrame(loop);
}

running = true;
loop();
