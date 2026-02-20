// ── 16-Bit Equipment Road Game ──────────────────────────────────────

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// Offscreen canvas for darkness layer (lights cut holes in it)
const darkCanvas = document.createElement('canvas');
const darkCtx = darkCanvas.getContext('2d');

// Pixel scale — render at low res, scale up for 16-bit look
const PIXEL = 3;
let W, H, GW, GH; // canvas size and game (logical) size

function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W;
    canvas.height = H;
    darkCanvas.width = W;
    darkCanvas.height = H;
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
    arrow: '#ffff44',
    sand1: '#d4b896',
    sand2: '#c9a882'
};

// ── World Layout ────────────────────────────────────────────────────
// Coordinate system: game pixels. Car starts at bottom, drives up.
// Crossroads at center of world.

const ROAD_W = 28;       // road width in game pixels
const CROSS_Y = 0;       // crossroads Y center
const CROSS_X = 0;       // crossroads X center
const START_Y = 400;     // car start offset below crossroads (longer approach)
const ZONE_DIST = 120;   // distance from crossroads to trigger zone
const BORDER = { left: -240, right: 240, top: -240, bottom: START_Y + 300 };

// ── Sand Lot (left of north-south road) ─────────────────────────────

const sandLot = {
    x: CROSS_X - ROAD_W / 2 - 200,   // left edge
    y: CROSS_Y + 50,                   // just below crossroads
    w: 200,                             // width
    h: 250                              // height (extends south along road)
};

// ── Sound Stages on sand lot ────────────────────────────────────────

// Stage 1 filming light show — lightning flash triggered on first pass
const stage1Show = {
    triggered: false,
    t: 0,
    on: false,
    strikes: 0,      // how many lightning strikes so far
    maxStrikes: 3,
    nextFlash: 0,     // dt until next state change
    done: false
};

const soundStages = [
    { x: sandLot.x + sandLot.w - 45, y: sandLot.y + 35, label: 'STAGE 1' },
    { x: sandLot.x + sandLot.w - 145, y: sandLot.y + 35, label: 'STAGE 2',
      doorOpen: 0, doorState: 'closed' }  // 1 = fully open, 0 = closed
];

// ── Rocket (back to space) ───────────────────────────────────────────

const rocket = {
    x: CROSS_X,
    y: CROSS_Y + START_Y + 120,
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
    x: rocket.x - 75,
    y: rocket.y + 10,
    startX: rocket.x - 75,
    startY: rocket.y + 10,
    state: 'parked',   // parked → loading → driving → fading → gone
    stateT: 0,
    alpha: 1,
    facing: 'left',
    waypointIdx: 0
};

const stage2 = { x: sandLot.x + sandLot.w - 145, y: sandLot.y + 35 };
const truckWaypoints = [
    { x: truck.startX, y: rocket.y - 30 },             // drive north past dirt area
    { x: CROSS_X, y: rocket.y - 30 },                  // drive east to road
    { x: CROSS_X, y: stage2.y + 25 + 20 },             // drive north past Stage 2 door level
    { x: stage2.x, y: stage2.y + 25 + 20 },           // drive west to Stage 2 entrance
    { x: stage2.x, y: stage2.y + 25 + 5 }             // drive north to door
];

// Lights delivered to each crane — drop positions match where the hook lands when lowered
// (boom tip ground projection: boomStartX + dir*35, cable hangs 20px below)
const craneLights = [
    { placed: false, pickedUp: false,
      dropX: rocket.x - 12, dropY: rocket.y + 15 },
    { placed: false, pickedUp: false,
      dropX: rocket.x + 12, dropY: rocket.y + 15 }
];

const workers = {
    t: 0,
    phase: 0,   // 0-7: two round trips (right crane first, then left)
    done: false,
    w1x: 0, w1y: 0,
    w2x: 0, w2y: 0,
    carrying: false,
    dirX: 1, dirY: 0  // facing direction (normalized), default: facing right toward cranes
};

// ── Police Car NPC ──────────────────────────────────────────────────

const policeCar = {
    x: CROSS_X, y: CROSS_Y - 220,
    state: 'waiting', // waiting → driving → parked
    stateT: 0,
    facing: 'down',
    waypointIdx: 0
};

const policeWaypoints = [
    { x: CROSS_X, y: CROSS_Y },
    { x: CROSS_X, y: rocket.y - 30 },                  // drive south to end of road
    { x: ROAD_W / 2 + 15, y: rocket.y - 30 },         // off-road right to avoid rocket
    { x: ROAD_W / 2 + 15, y: rocket.y + 40 },         // south past dirt area
    { x: truck.startX, y: rocket.y + 40 },             // west across bottom
    { x: truck.startX, y: truck.startY }               // north to truck
];

// ── Car ─────────────────────────────────────────────────────────────

const car = {
    x: CROSS_X,
    y: rocket.y - 50,
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
for (let y = -250; y <= START_Y + 100; y += 18 + Math.floor(Math.random() * 12)) {
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
    { label: 'EQUIPMENT', direction: 'Straight Ahead', arrow: '\u2191', x: CROSS_X + BB_OFFSET, y: CROSS_Y + 100 },
    { label: 'LIGHTS', sublabel: 'Stage 2', direction: 'Turn Left', arrow: '\u2190', x: CROSS_X - BB_OFFSET, y: CROSS_Y + 210 },
    { label: 'GRIP GEAR', sublabel: 'Stage 1', direction: 'Turn Left', arrow: '\u2190', x: CROSS_X + BB_OFFSET, y: CROSS_Y + 320 }
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

// Remove trees behind courthouse (back two rows)
const courtY = CROSS_Y - ZONE_DIST - 20;
for (let i = scenery.length - 1; i >= 0; i--) {
    const s = scenery[i];
    if (Math.abs(s.x - CROSS_X) < 80 && s.y < courtY + 20 && s.y > courtY - 80) {
        scenery.splice(i, 1);
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

// Remove trees inside sand lot
for (let i = scenery.length - 1; i >= 0; i--) {
    const s = scenery[i];
    if (s.x > sandLot.x - 5 && s.x < sandLot.x + sandLot.w + 5 &&
        s.y > sandLot.y - 5 && s.y < sandLot.y + sandLot.h + 5) {
        scenery.splice(i, 1);
    }
}

// Street lamps at each corner of the intersection
const LAMP_OFF = ROAD_W / 2 + 4; // offset from road center to lamp pole
const streetLamps = [
    { x: CROSS_X - LAMP_OFF, y: CROSS_Y - LAMP_OFF }, // NW
    { x: CROSS_X + LAMP_OFF, y: CROSS_Y - LAMP_OFF }, // NE
    { x: CROSS_X - LAMP_OFF, y: CROSS_Y + LAMP_OFF }, // SW
    { x: CROSS_X + LAMP_OFF, y: CROSS_Y + LAMP_OFF }, // SE
];

// Work light poles at corners of dirt area around rocket
const dirtCX = rocket.x;
const dirtCY = rocket.y + 5;
const dirtW = 140;
const dirtH = 60;
const workLights = [
    { x: dirtCX - dirtW / 2, y: dirtCY - dirtH / 2 },     // NW corner
    { x: dirtCX + dirtW / 2, y: dirtCY - dirtH / 2 },     // NE corner
    { x: dirtCX - dirtW / 2, y: dirtCY + dirtH / 2 },     // SW corner
    { x: dirtCX + dirtW / 2, y: dirtCY + dirtH / 2 },     // SE corner
];

// Destination buildings
const destinations = [
    { label: 'EQUIPMENT', x: CROSS_X, y: CROSS_Y - ZONE_DIST - 20, dir: 'straight' }
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

function update(dt) {
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
        car.angle += car.turnSpeed * (inputX > 0 ? 1 : -1) * Math.sign(car.speed) * dt;
    }

    // Joystick angle steering (when moving)
    if (joystick.active && joystick.magnitude > 0.3 && Math.abs(car.speed) > 0.05) {
        const targetAngle = Math.atan2(inputY, inputX);
        let diff = targetAngle - car.angle;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        car.angle += diff * 0.08 * dt;
    }

    // Acceleration
    if (inputThrust) {
        car.speed += car.accel * dt;
    } else if (inputY > 0 && !joystick.active) {
        car.speed -= car.brake * dt;
    }

    car.speed *= Math.pow(car.friction, dt);
    if (Math.abs(car.speed) < 0.01) car.speed = 0;
    car.speed = Math.max(-car.maxSpeed * 0.4, Math.min(car.maxSpeed, car.speed));

    car.x += Math.cos(car.angle) * car.speed * dt;
    car.y += Math.sin(car.angle) * car.speed * dt;

    // City border — clamp car position
    if (car.x < BORDER.left)  { car.x = BORDER.left;  car.speed *= 0.3; }
    if (car.x > BORDER.right) { car.x = BORDER.right;  car.speed *= 0.3; }
    if (car.y < BORDER.top)   { car.y = BORDER.top;    car.speed *= 0.3; }
    if (car.y > BORDER.bottom){ car.y = BORDER.bottom;  car.speed *= 0.3; }

    // Camera smoothly follows car
    cam.x += (car.x - GW / 2 - cam.x) * (1 - Math.pow(1 - 0.08, dt));
    cam.y += (car.y - GH / 2 - cam.y) * (1 - Math.pow(1 - 0.08, dt));

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
            const truckBackX = truck.x + 10;
            const truckBackY = truck.y + 8;
            // Trip 1 → right crane (closer), Trip 2 → left crane (farther)
            const dest1X = craneLights[1].dropX;
            const dest1Y = craneLights[1].dropY;
            const dest2X = craneLights[0].dropX;
            const dest2Y = craneLights[0].dropY;

            const walkSpeed = 0.25; // game pixels per frame

            if (w.phase === 0 || w.phase === 4) {
                // Brief pause at truck then go
                w.t = 1;
                w.w1x = truckBackX; w.w1y = truckBackY;
                w.w2x = truckBackX; w.w2y = truckBackY + 5;
                w.carrying = false;
            } else if (w.phase === 1) {
                // Walk to right crane drop with light
                const dx = dest1X - truckBackX, dy = dest1Y - truckBackY;
                const dist = Math.sqrt(dx * dx + dy * dy);
                w.dirX = dx / dist; w.dirY = dy / dist;
                w.t += walkSpeed / Math.max(dist, 1) * dt;
                const p = Math.min(w.t, 1);
                w.w1x = truckBackX + dx * p;
                w.w1y = truckBackY + dy * p;
                w.w2x = w.w1x + 3; w.w2y = w.w1y + 5;
                w.carrying = true;
            } else if (w.phase === 2) {
                // Set down light 1
                w.t += 0.008 * dt;
                w.w1x = dest1X; w.w1y = dest1Y;
                w.w2x = dest1X + 3; w.w2y = dest1Y + 5;
                w.carrying = false;
                if (!craneLights[1].placed) craneLights[1].placed = true;
            } else if (w.phase === 3) {
                // Walk back to truck
                const dx = truckBackX - dest1X, dy = truckBackY - dest1Y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                w.dirX = dx / dist; w.dirY = dy / dist;
                w.t += walkSpeed / Math.max(dist, 1) * dt;
                const p = Math.min(w.t, 1);
                w.w1x = dest1X + dx * p;
                w.w1y = dest1Y + dy * p;
                w.w2x = w.w1x + 3; w.w2y = w.w1y + 5;
                w.carrying = false;
            } else if (w.phase === 5) {
                // Walk to left crane drop with light
                const dx = dest2X - truckBackX, dy = dest2Y - truckBackY;
                const dist = Math.sqrt(dx * dx + dy * dy);
                w.dirX = dx / dist; w.dirY = dy / dist;
                w.t += walkSpeed / Math.max(dist, 1) * dt;
                const p = Math.min(w.t, 1);
                w.w1x = truckBackX + dx * p;
                w.w1y = truckBackY + dy * p;
                w.w2x = w.w1x + 3; w.w2y = w.w1y + 5;
                w.carrying = true;
            } else if (w.phase === 6) {
                // Set down light 2
                w.t += 0.008 * dt;
                w.w1x = dest2X; w.w1y = dest2Y;
                w.w2x = dest2X + 3; w.w2y = dest2Y + 5;
                w.carrying = false;
                if (!craneLights[0].placed) craneLights[0].placed = true;
            } else if (w.phase === 7) {
                // Walk back to truck
                const dx = truckBackX - dest2X, dy = truckBackY - dest2Y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                w.dirX = dx / dist; w.dirY = dy / dist;
                w.t += walkSpeed / Math.max(dist, 1) * dt;
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
        } else if (truck.state === 'parked') {
            // Done delivering — trigger truck departure
            truck.state = 'loading';
            truck.stateT = 0;
        }

        // During loading: workers walk to cab then get in
        if (truck.state === 'loading') {
            const cabX = truck.x - 10;
            const cabY = truck.y - 2;
            const idleX1 = truck.startX + 10, idleY1 = truck.startY + 8;
            const idleX2 = truck.startX + 7, idleY2 = truck.startY + 13;
            const lt = Math.min(truck.stateT / 60, 1);
            w.w1x = idleX1 + (cabX - idleX1) * lt;
            w.w1y = idleY1 + (cabY - idleY1) * lt;
            w.w2x = idleX2 + (cabX - idleX2) * lt;
            w.w2y = idleY2 + (cabY - idleY2) * lt;
            w.carrying = false;
        }
    }

    // Truck departure state machine
    if (truck.state === 'loading') {
        truck.stateT += dt;
        if (truck.stateT > 90) {
            truck.state = 'driving';
            truck.stateT = 0;
            truck.waypointIdx = 0;
        }
    } else if (truck.state === 'driving') {
        // Follow waypoints along access road
        const wp = truckWaypoints[truck.waypointIdx];
        const dx = wp.x - truck.x;
        const dy = wp.y - truck.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const speed = 0.6 * dt;

        // Update facing based on movement direction
        if (Math.abs(dx) > Math.abs(dy)) {
            truck.facing = dx > 0 ? 'right' : 'left';
        } else {
            truck.facing = dy > 0 ? 'down' : 'up';
        }

        if (dist < speed) {
            truck.x = wp.x;
            truck.y = wp.y;
            truck.waypointIdx++;
            // Open doors early when truck turns toward stage
            if (truck.waypointIdx === 3 && soundStages[1].doorState === 'closed') {
                soundStages[1].doorState = 'opening';
            }
            if (truck.waypointIdx >= truckWaypoints.length) {
                truck.state = 'entering';
                truck.stateT = 0;
                truck.facing = 'up';
            }
        } else {
            truck.x += (dx / dist) * speed;
            truck.y += (dy / dist) * speed;
        }
    } else if (truck.state === 'entering') {
        // Truck drives into Stage 2
        truck.stateT += dt;
        truck.y -= 0.4 * dt;
        truck.facing = 'up';
        truck.alpha = Math.max(0, 1 - truck.stateT / 120);
        if (truck.alpha <= 0) {
            truck.state = 'gone';
            soundStages[1].doorState = 'closing';
        }
    }

    // Stage 2 door animation
    {
        const s2 = soundStages[1];
        if (s2.doorState === 'opening') {
            s2.doorOpen = Math.min(1, s2.doorOpen + 0.008 * dt);
            if (s2.doorOpen >= 1) {
                s2.doorOpen = 1;
                s2.doorState = 'open';
            }
        } else if (s2.doorState === 'closing') {
            s2.doorOpen = Math.max(0, s2.doorOpen - 0.008 * dt);
            if (s2.doorOpen <= 0) {
                s2.doorOpen = 0;
                s2.doorState = 'closed';
            }
        }
    }

    // Police car state machine
    if (policeCar.state === 'waiting') {
        policeCar.stateT += dt;
        if (policeCar.stateT >= 1800) {
            policeCar.state = 'driving';
            policeCar.stateT = 0;
            policeCar.waypointIdx = 0;
        }
    } else if (policeCar.state === 'driving') {
        const wp = policeWaypoints[policeCar.waypointIdx];
        const dx = wp.x - policeCar.x;
        const dy = wp.y - policeCar.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const speed = 0.6 * dt;

        if (Math.abs(dx) > Math.abs(dy)) {
            policeCar.facing = dx > 0 ? 'right' : 'left';
        } else {
            policeCar.facing = dy > 0 ? 'down' : 'up';
        }

        if (dist < speed) {
            policeCar.x = wp.x;
            policeCar.y = wp.y;
            policeCar.waypointIdx++;
            if (policeCar.waypointIdx >= policeWaypoints.length) {
                policeCar.state = 'parked';
                policeCar.stateT = 0;
                policeCar.facing = 'left';
            }
        } else {
            policeCar.x += (dx / dist) * speed;
            policeCar.y += (dy / dist) * speed;
        }
    }

    // Animate cranes — state machine: working → lowering → lifting → holding
    for (let ci = 0; ci < cranes.length; ci++) {
        const cr = cranes[ci];
        const cl = craneLights[ci];

        if (cr.state === 'working') {
            // Normal 3-phase animation (swing, raise, drive)
            const speed = 0.0015;
            cr.t += speed * dt;
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

            // Start lowering preemptively during the truck pause before the walk
            const headingHere = (ci === 1 && workers.phase >= 0 && workers.phase <= 1 && !cl.placed) ||
                                (ci === 0 && workers.phase >= 4 && workers.phase <= 5 && !cl.placed);
            if (headingHere && !cl.placed && !cl.pickedUp) {
                cr.state = 'lowering';
                cr.stateT = 0;
                cr.lowerFrom = 0;
                cr.boomRaise = 0;
                cr.driveOffset = 0;
                cr.boomSwing = 0;
            }
        } else if (cr.state === 'lowering') {
            // Lower boom at same speed as lifting (0.003) — starts early enough to be ready
            cr.stateT += 0.003 * dt;
            cr.boomSwing *= Math.pow(0.95, dt); // smoothly zero out any residual swing
            cr.driveOffset *= Math.pow(0.95, dt);
            const from = cr.lowerFrom || 0;
            const t = Math.min(cr.stateT, 1);
            cr.boomRaise = from + (-0.83 - from) * t;

            // Light placed and boom is down — pick it up and start lifting
            if (cl.placed && !cl.pickedUp && t >= 0.95) {
                cr.boomRaise = -0.83;
                cl.pickedUp = true;
                cr.state = 'lifting';
                cr.stateT = 0;
            }
        } else if (cr.state === 'lifting') {
            // Raise boom with light attached
            cr.stateT += 0.003 * dt;
            cr.boomRaise = -0.83 + cr.stateT * 1.83; // -0.83 → 1.0
            cr.boomSwing = 0;
            cr.driveOffset = 0;
            if (cr.stateT >= 1) {
                cr.boomRaise = 1.0;
                cr.state = 'holding';
            }
        } else if (cr.state === 'holding') {
            // Hold position with light up
            cr.boomRaise = 1.0;
            cr.boomSwing = 0;
            cr.driveOffset = 0;
        }

        cr.x = cr.baseX;
        cr.y = cr.baseY - cr.driveOffset;
    }

    // Billboard flash trigger — bad bulb on EQUIPMENT sign (index 2) as you pass it
    if (car.y < billboards[2].y + 100 && !bbFlash[2].triggered) {
        bbFlash[2].triggered = true;
        bbFlash[2].timer = 0;
        bbFlash[2].count = 0;
        bbFlash[2].on = false;
    }
    for (const f of bbFlash) {
        if (f.triggered && f.count < 4) {
            f.timer += dt;
            // First 2 blinks fast (5 frames), last 2 slow (10 frames)
            const speed = f.count < 2 ? 5 : 10;
            if (f.timer >= speed) {
                f.timer = 0;
                f.on = !f.on;
                if (!f.on) f.count++;
            }
        }
    }

    // Stage 1 light show trigger — momentary flash on first pass
    if (!stage1Show.triggered) {
        const s1 = soundStages[0];
        const dx = car.x - s1.x;
        const dy = car.y - s1.y;
        if (Math.sqrt(dx * dx + dy * dy) < 120) {
            stage1Show.triggered = true;
            stage1Show.t = 0;
            stage1Show.strikes = 0;
            stage1Show.on = true;
            stage1Show.nextFlash = 2 + Math.random() * 2;  // first strike starts immediately
        }
    }
    if (stage1Show.triggered && !stage1Show.done) {
        stage1Show.t += dt;
        if (stage1Show.t >= stage1Show.nextFlash) {
            stage1Show.t = 0;
            stage1Show.on = !stage1Show.on;
            if (stage1Show.on) {
                // Flash ON — erratic durations: some are single-frame snaps, some linger
                const roll = Math.random();
                if (roll < 0.3) stage1Show.nextFlash = 3 + Math.random() * 3;  // quick flash
                else if (roll < 0.6) stage1Show.nextFlash = 6 + Math.random() * 6;  // medium
                else stage1Show.nextFlash = 10 + Math.random() * 8;  // lingers
            } else {
                stage1Show.strikes++;
                if (stage1Show.strikes >= stage1Show.maxStrikes) {
                    stage1Show.done = true;
                } else {
                    // Chaotic gaps — sometimes rapid double-strike, sometimes long pause
                    const roll = Math.random();
                    if (roll < 0.3) stage1Show.nextFlash = 1 + Math.random() * 2;   // rapid re-strike
                    else if (roll < 0.6) stage1Show.nextFlash = 6 + Math.random() * 10; // medium
                    else stage1Show.nextFlash = 15 + Math.random() * 20;  // long dark pause
                }
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
    // Stage 1 → grip inventory (must be inside the doorway)
    const s1 = soundStages[0];
    const s1dx = car.x - s1.x;
    const s1dy = car.y - (s1.y + 15);
    if (Math.abs(s1dx) < 12 && Math.abs(s1dy) < 10) {
        arrived = 'right';
        running = false;
        showInventory('right');
    }
    // Stage 2 → lights inventory (must be inside the doorway)
    const s2 = soundStages[1];
    const s2dx = car.x - s2.x;
    const s2dy = car.y - (s2.y + 15);
    if (Math.abs(s2dx) < 12 && Math.abs(s2dy) < 10) {
        arrived = 'left';
        running = false;
        showInventory('left');
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
    ctx.fillText(text, Math.floor((x - cam.x) * PIXEL), Math.floor((y - cam.y) * PIXEL));
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

    // Sand lot (left of north-south road)
    px(sandLot.x, sandLot.y, sandLot.w, sandLot.h, C.sand1);
    // Sand variation patches
    for (let sx = sandLot.x; sx < sandLot.x + sandLot.w; sx += 10) {
        for (let sy = sandLot.y; sy < sandLot.y + sandLot.h; sy += 10) {
            if ((Math.floor(sx / 10) + Math.floor(sy / 10)) % 3 === 0) {
                px(sx, sy, 10, 10, C.sand2);
            }
        }
    }

    // Dirt work site around rocket and cranes
    px(dirtCX - dirtW / 2, dirtCY - dirtH / 2, dirtW, dirtH, C.dirt);
    // Subtle variation patches on the dirt (clamped to boundary)
    const dirtL = dirtCX - dirtW / 2, dirtR = dirtCX + dirtW / 2;
    const dirtT = dirtCY - dirtH / 2, dirtB = dirtCY + dirtH / 2;
    for (let dx = dirtL; dx < dirtR; dx += 12) {
        for (let dy = dirtT; dy < dirtB; dy += 12) {
            if ((Math.floor(dx / 12) + Math.floor(dy / 12)) % 4 === 0) {
                const pw = Math.min(12, dirtR - dx);
                const ph = Math.min(12, dirtB - dy);
                px(dx, dy, pw, ph, '#7a6548');
            }
        }
    }

    // Studio lot perimeter fence
    drawFence();

    // Draw roads
    drawRoads();

    // Draw destination buildings (before trees so trees layer on top)
    for (const dest of destinations) {
        drawBuilding(dest.x, dest.y, dest.label);
    }

    // Draw scenery (trees)
    const sorted = [...scenery].sort((a, b) => a.y - b.y);
    for (const s of sorted) {
        if (s.y < car.y) drawTree(s.x, s.y);
    }

    // Draw police car (behind car)
    if (policeCar.state !== 'waiting' && policeCar.y < car.y) drawPoliceCarScene();

    // Draw truck & workers (behind car)
    if (truck.state !== 'gone' && truck.y < car.y) {
        drawTruckScene();
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

    // Draw sound stages (always behind car)
    for (const stage of soundStages) {
        drawSoundStage(stage);
    }

    // Draw social billboard (behind car if above)
    if (socialBillboard.y < car.y) drawSocialBillboard();

    // Draw street lamps (y-sorted with car)
    for (const lamp of streetLamps) {
        if (lamp.y < car.y) drawStreetLamp(lamp.x, lamp.y);
    }
    // Draw work lights at dirt area corners
    for (const wl of workLights) {
        if (wl.y < car.y) drawWorkLight(wl);
    }

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

    // Draw police car (in front of car)
    if (policeCar.state !== 'waiting' && policeCar.y >= car.y) drawPoliceCarScene();

    // Draw truck & workers (in front of car)
    if (truck.state !== 'gone' && truck.y >= car.y) {
        drawTruckScene();
    }

    // Draw street lamps in front of car
    for (const lamp of streetLamps) {
        if (lamp.y >= car.y) drawStreetLamp(lamp.x, lamp.y);
    }
    // Draw work lights in front of car
    for (const wl of workLights) {
        if (wl.y >= car.y) drawWorkLight(wl);
    }

    // Draw scenery in front of car
    for (const s of sorted) {
        if (s.y >= car.y) drawTree(s.x, s.y);
    }

    // Time-of-day lighting with proper darkness cutouts
    drawDarknessWithLights();

    // HUD
    drawHUD();
}

function drawRoads() {
    const hw = ROAD_W / 2;
    const roadBottom = dirtCY - dirtH / 2;

    // Vertical road (stops at courthouse steps)
    const courtSteps = CROSS_Y - ZONE_DIST - 20 + 27 + 6;
    px(CROSS_X - hw, courtSteps, ROAD_W, roadBottom - courtSteps, C.road);

    // Horizontal road (left to Lights, right to Grip)
    px(CROSS_X - 200, CROSS_Y - hw, 400, ROAD_W, C.road);

    // Center line dashes — main vertical
    for (let y = courtSteps; y < roadBottom; y += 8) {
        if (Math.abs(y - CROSS_Y) < hw) continue;
        px(CROSS_X - 0.5, y, 1, 4, C.roadLine);
    }

    // Center line dashes — main horizontal
    for (let x = CROSS_X - 200; x < CROSS_X + 200; x += 8) {
        if (Math.abs(x - CROSS_X) < hw) continue;
        px(x, CROSS_Y - 0.5, 4, 1, C.roadLine);
    }
}

function drawTree(x, y) {
    // Tall palm trunk (slight curve)
    px(x, y - 2, 2, 5, C.treeTrunk);
    px(x, y - 7, 2, 5, C.treeTrunk);
    px(x - 1, y - 12, 2, 5, '#5a3620');
    px(x - 1, y - 17, 2, 5, '#5a3620');
    px(x - 1, y - 20, 2, 3, '#4d2e1a');
    // Coconuts
    px(x - 1, y - 21, 1, 1, '#6b4226');
    px(x + 1, y - 21, 1, 1, '#6b4226');
    // Fronds (drooping fan shape)
    px(x - 6, y - 22, 5, 2, '#1d5a1d');
    px(x - 8, y - 20, 4, 2, '#247a24');
    px(x + 2, y - 22, 5, 2, '#1d5a1d');
    px(x + 5, y - 20, 4, 2, '#247a24');
    px(x - 3, y - 24, 7, 2, '#2d6a2d');
    px(x - 2, y - 26, 5, 2, '#347a34');
    // Drooping tips
    px(x - 9, y - 18, 3, 1, '#1d5a1d');
    px(x + 7, y - 18, 3, 1, '#1d5a1d');
}

function drawSoundStage(stage) {
    const x = stage.x, y = stage.y, label = stage.label;
    const bw = 80;  // building width
    const bh = 50;  // building height (depth)
    const doorOpen = stage.doorOpen !== undefined ? stage.doorOpen : 0;

    const doorW = 14;  // half-door width
    const doorH = 16;
    const doorY = y + bh / 2 - doorH;
    const slideOffset = Math.floor(doorOpen * doorW);

    // Dark interior (behind everything)
    px(x - doorW, doorY, doorW * 2, doorH, '#1a1a22');

    // Main wall
    px(x - bw / 2, y - bh / 2, bw, bh, '#7a7a88');
    // Cut out the doorway (redraw interior over wall)
    px(x - doorW, doorY, doorW * 2, doorH, '#1a1a22');

    // Corrugated roof (ridged top)
    px(x - bw / 2 - 2, y - bh / 2 - 6, bw + 4, 7, '#606070');
    // Roof ridges
    for (let rx = x - bw / 2; rx < x + bw / 2; rx += 6) {
        px(rx, y - bh / 2 - 6, 3, 7, '#555565');
    }

    // Small windows along top
    const filming = stage.label === 'STAGE 1';
    const winY = y - bh / 2 + 4;
    const s = PIXEL;

    if (filming && stage1Show.triggered) {
        const bright = stage1Show.on ? 1.0 : 0;
        for (let wx = x - bw / 2 + 8; wx < x + bw / 2 - 8; wx += 12) {
            if (bright > 0) {
                px(wx, winY, 5, 4, '#ffffff');
                // Huge light beam from window
                const bx = (wx + 2.5 - cam.x) * s;
                const by = (winY + 4 - cam.y) * s;
                const beamH = 90 * s;
                const beamTopW = 2 * s;
                const beamBotW = 14 * s;
                const grad = ctx.createLinearGradient(bx, by, bx, by + beamH);
                grad.addColorStop(0, 'rgba(255,255,240,0.7)');
                grad.addColorStop(0.15, 'rgba(255,255,230,0.4)');
                grad.addColorStop(0.5, 'rgba(255,255,220,0.14)');
                grad.addColorStop(1, 'rgba(255,255,220,0)');
                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.moveTo(bx - beamTopW, by);
                ctx.lineTo(bx + beamTopW, by);
                ctx.lineTo(bx + beamBotW, by + beamH);
                ctx.lineTo(bx - beamBotW, by + beamH);
                ctx.closePath();
                ctx.fill();
                // Core beam
                const coreH = beamH * 0.6;
                const coreW = beamBotW * 0.3;
                const coreGrad = ctx.createLinearGradient(bx, by, bx, by + coreH);
                coreGrad.addColorStop(0, 'rgba(255,255,255,0.5)');
                coreGrad.addColorStop(0.4, 'rgba(255,255,240,0.15)');
                coreGrad.addColorStop(1, 'rgba(255,255,240,0)');
                ctx.fillStyle = coreGrad;
                ctx.beginPath();
                ctx.moveTo(bx - 1 * s, by);
                ctx.lineTo(bx + 1 * s, by);
                ctx.lineTo(bx + coreW, by + coreH);
                ctx.lineTo(bx - coreW, by + coreH);
                ctx.closePath();
                ctx.fill();
            } else {
                px(wx, winY, 5, 4, '#667788');
            }
        }
    } else if (filming) {
        // Before trigger — dark windows
        for (let wx = x - bw / 2 + 8; wx < x + bw / 2 - 8; wx += 12) {
            px(wx, winY, 5, 4, '#667788');
        }
    } else {
        for (let wx = x - bw / 2 + 8; wx < x + bw / 2 - 8; wx += 12) {
            px(wx, winY, 5, 4, '#8899aa');
        }
    }

    // Stage number label
    pxText(label, x, y - 4, C.white, 14);

    // Door frame (on top of wall)
    px(x - doorW - 1, doorY - 1, doorW * 2 + 2, 1, '#4a4a58');
    px(x - doorW - 1, doorY - 1, 1, doorH + 1, '#4a4a58');
    px(x + doorW, doorY - 1, 1, doorH + 1, '#4a4a58');

    // Doors (on top of everything — slide over the wall)
    if (doorOpen < 1) {
        px(x - doorW - slideOffset, doorY, doorW, doorH, '#555566');
        px(x + slideOffset, doorY, doorW, doorH, '#555566');
    }

    // Door center gap (only when fully closed)
    if (doorOpen <= 0) {
        px(x, doorY, 1, doorH, '#3a3a48');
    }

    // Red recording light — always on for Stage 1, illuminates like headlights
    if (filming) {
        px(x - 1, doorY - 4, 3, 3, '#ff1111');
        // Red glow (small)
        const rlx = (x + 0.5 - cam.x) * s;
        const rly = (doorY - 2.5 - cam.y) * s;
        const glowR = 8 * s;
        const glow = ctx.createRadialGradient(rlx, rly, 0, rlx, rly, glowR);
        glow.addColorStop(0, 'rgba(255,20,20,0.5)');
        glow.addColorStop(0.4, 'rgba(255,20,20,0.15)');
        glow.addColorStop(1, 'rgba(255,0,0,0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(rlx, rly, glowR, 0, Math.PI * 2);
        ctx.fill();
        // Red illumination pool on ground (like headlights)
        const poolX = (x + 0.5 - cam.x) * s;
        const poolY = (doorY + 10 - cam.y) * s;
        const poolR = 25 * s;
        const pool = ctx.createRadialGradient(poolX, poolY, 0, poolX, poolY, poolR);
        pool.addColorStop(0, 'rgba(255,30,30,0.18)');
        pool.addColorStop(0.3, 'rgba(255,20,20,0.08)');
        pool.addColorStop(0.6, 'rgba(255,10,10,0.03)');
        pool.addColorStop(1, 'rgba(255,0,0,0)');
        ctx.fillStyle = pool;
        ctx.beginPath();
        ctx.arc(poolX, poolY, poolR, 0, Math.PI * 2);
        ctx.fill();
    } else {
        const redOn = stage.doorState === 'closed';
        px(x, doorY - 3, 2, 2, redOn ? '#ff2222' : '#cc3333');
    }
}

function drawBuilding(x, y, label) {
    // Grand Hollywood courthouse
    const bw = 80, bh = 55;

    // Main stone facade
    px(x - bw / 2, y - bh / 2, bw, bh, '#c8b898');
    // Darker base
    px(x - bw / 2, y + bh / 2 - 6, bw, 6, '#a89878');

    // Columns (6 evenly spaced)
    for (let i = 0; i < 6; i++) {
        const cx = x - bw / 2 + 8 + i * 13;
        px(cx, y - bh / 2 + 10, 3, bh - 16, '#d8cca8');
        // Column cap
        px(cx - 1, y - bh / 2 + 9, 5, 2, '#d8cca8');
        // Column base
        px(cx - 1, y + bh / 2 - 7, 5, 2, '#b8a888');
    }

    // Entablature (horizontal band above columns)
    px(x - bw / 2, y - bh / 2 + 6, bw, 4, '#b8a888');

    // Pediment (triangular roof)
    const peakY = y - bh / 2 - 10;
    const roofL = x - bw / 2 - 2;
    const roofR = x + bw / 2 + 2;
    const sx = PIXEL;
    const pxLeft = (roofL - cam.x) * sx;
    const pxRight = (roofR - cam.x) * sx;
    const pxPeakX = (x - cam.x) * sx;
    const pxPeakY = (peakY - cam.y) * sx;
    const pxBaseY = (y - bh / 2 + 6 - cam.y) * sx;
    ctx.fillStyle = '#b8a888';
    ctx.beginPath();
    ctx.moveTo(pxLeft, pxBaseY);
    ctx.lineTo(pxPeakX, pxPeakY);
    ctx.lineTo(pxRight, pxBaseY);
    ctx.closePath();
    ctx.fill();
    // Tympanum (inner triangle, lighter)
    ctx.fillStyle = '#d0c4a0';
    ctx.beginPath();
    ctx.moveTo(pxLeft + 6 * sx, pxBaseY);
    ctx.lineTo(pxPeakX, pxPeakY + 4 * sx);
    ctx.lineTo(pxRight - 6 * sx, pxBaseY);
    ctx.closePath();
    ctx.fill();

    // Grand double doors
    px(x - 5, y + bh / 2 - 14, 4, 14, '#6b4e2a');
    px(x + 1, y + bh / 2 - 14, 4, 14, '#6b4e2a');
    // Door frame
    px(x - 6, y + bh / 2 - 15, 12, 1, '#8a7a5a');
    px(x - 6, y + bh / 2 - 15, 1, 15, '#8a7a5a');
    px(x + 5, y + bh / 2 - 15, 1, 15, '#8a7a5a');

    // Steps (3 wide steps in front)
    px(x - 12, y + bh / 2, 24, 2, '#b8a888');
    px(x - 15, y + bh / 2 + 2, 30, 2, '#a89878');
    px(x - 18, y + bh / 2 + 4, 36, 2, '#988868');

    // Windows (dark recesses between columns)
    for (let i = 0; i < 5; i++) {
        const wx = x - bw / 2 + 12 + i * 13;
        px(wx, y - bh / 2 + 14, 5, 8, '#4a4030');
    }

    // Label on entablature
    pxText(label, x, y - bh / 2 + 3, '#4a3a2a', 10);
}

function drawFence() {
    const L = BORDER.left, R = BORDER.right, T = BORDER.top, B = BORDER.bottom;
    const postSpacing = 16;
    const postColor = '#8a7a5a';
    const railColor = '#a09070';
    const wireColor = '#888';

    // Draw fence segments — top, bottom, left, right
    // Top edge
    for (let x = L; x <= R; x += postSpacing) {
        px(x, T - 2, 2, 5, postColor);  // post
    }
    px(L, T - 1, R - L, 1, railColor);  // top rail
    px(L, T + 1, R - L, 1, wireColor);  // wire

    // Bottom edge
    for (let x = L; x <= R; x += postSpacing) {
        px(x, B - 2, 2, 5, postColor);
    }
    px(L, B - 1, R - L, 1, railColor);
    px(L, B + 1, R - L, 1, wireColor);

    // Left edge
    for (let y = T; y <= B; y += postSpacing) {
        px(L - 1, y, 4, 2, postColor);
    }
    px(L, T, 1, B - T, railColor);
    px(L + 1, T, 1, B - T, wireColor);

    // Right edge
    for (let y = T; y <= B; y += postSpacing) {
        px(R - 1, y, 4, 2, postColor);
    }
    px(R, T, 1, B - T, railColor);
    px(R + 1, T, 1, B - T, wireColor);
}

function drawStreetLamp(x, y) {
    const dark = getDarkness();
    // Pole
    px(x, y + 2, 1, 1, '#555');
    px(x, y, 1, 2, '#666');
    px(x, y - 4, 1, 4, '#777');
    px(x, y - 8, 1, 4, '#888');
    // Arm (extends toward intersection center)
    const armDirX = x < CROSS_X ? 1 : -1;
    px(x, y - 9, 1, 1, '#888');
    px(x + armDirX, y - 9, 1, 1, '#888');
    px(x + armDirX * 2, y - 9, 1, 1, '#777');
    // Lamp fixture
    px(x + armDirX * 2, y - 8, 1, 1, dark > 0.1 ? '#ffeeaa' : '#ddd');
    // Glow dot when dark
    if (dark > 0.1) {
        px(x + armDirX * 2 - 1, y - 9, 3, 2, `rgba(255,238,170,${Math.min(0.5, dark)})`);
    }
}

function drawWorkLight(wl) {
    const x = wl.x;
    const y = wl.y;
    const dark = getDarkness();
    const towardX = dirtCX - x;
    const armDx = towardX > 0 ? 1 : -1;

    // Tall pole
    px(x, y + 2, 1, 1, '#444');
    px(x, y - 2, 1, 4, '#555');
    px(x, y - 6, 1, 4, '#666');
    px(x, y - 10, 1, 4, '#777');
    px(x, y - 14, 1, 4, '#888');
    px(x, y - 16, 1, 2, '#888');

    // Cross-arm at top angled toward center
    px(x + armDx, y - 17, 1, 1, '#888');
    px(x + armDx * 2, y - 17, 1, 1, '#777');

    // Fixture head — warm tungsten
    px(x + armDx * 2 - 1, y - 16, 3, 1, dark > 0.1 ? '#ffcc66' : '#ccc');

    // Glow when dark
    if (dark > 0.1) {
        px(x + armDx * 2 - 1, y - 15, 3, 1, `rgba(255,200,100,${Math.min(0.7, dark)})`);
    }
}

function drawWorkLightBeams(darkness) {
    if (darkness <= 0.1) return;
    const alpha = Math.min(0.35, darkness * 0.45);
    const s = PIXEL;
    for (const wl of workLights) {
        const towardX = dirtCX - wl.x;
        const armDx = towardX > 0 ? 1 : -1;
        const fx = (wl.x + armDx * 2 - cam.x) * s;
        const fy = (wl.y - 16 - cam.y) * s;
        // Tight downward cone — warm tungsten
        const coneLen = 18 * s;
        const coneW = 4 * s; // narrow spread
        const grad = ctx.createLinearGradient(fx, fy, fx, fy + coneLen);
        grad.addColorStop(0, `rgba(255, 200, 100, ${alpha})`);
        grad.addColorStop(0.4, `rgba(255, 200, 100, ${alpha * 0.3})`);
        grad.addColorStop(1, 'rgba(255, 200, 100, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(fx - 1 * s, fy);
        ctx.lineTo(fx + 1 * s, fy);
        ctx.lineTo(fx + coneW, fy + coneLen);
        ctx.lineTo(fx - coneW, fy + coneLen);
        ctx.closePath();
        ctx.fill();
    }
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

    // Single headlamp on front of cab (facing toward rocket)
    const dark = getDarkness();
    const hlX = cx + dir * 7;
    const hlY = cy - 6;
    px(hlX, hlY, 1, 2, dark > 0.1 ? '#ffee88' : '#ccc');
}

function drawBillboard(bb, flash) {
    const bw = 46;  // billboard width
    const bh = 36;  // billboard height

    // Posts (two legs)
    px(bb.x - 6, bb.y, 2, 10, C.sign);
    px(bb.x + 5, bb.y, 2, 10, C.sign);

    // Board background
    px(bb.x - bw / 2, bb.y - bh, bw, bh, '#111a11');
    // Board border (thicker)
    px(bb.x - bw / 2, bb.y - bh, bw, 2, '#667744');
    px(bb.x - bw / 2, bb.y - 2, bw, 2, '#667744');
    px(bb.x - bw / 2, bb.y - bh, 2, bh, '#667744');
    px(bb.x + bw / 2 - 2, bb.y - bh, 2, bh, '#667744');

    // Direction text with inline arrow
    ctx.font = 'bold 10px "Courier New", monospace';
    const dirText = bb.direction;
    const dirW = ctx.measureText(dirText).width / PIXEL;
    const lineY = bb.y - bh + 8;
    const lineCX = (bb.x - cam.x) * PIXEL;

    const ay = (lineY - cam.y) * PIXEL;
    const as = 3 * PIXEL;
    ctx.fillStyle = C.arrow;
    const shaft = as * 0.3;

    if (bb.arrow === '\u2192') { // right
        pxText(dirText, bb.x - 3, lineY, C.arrow, 10);
        const textRight = lineCX + (dirW / 2) * PIXEL;
        const ax = textRight + 4 * PIXEL;
        ctx.fillRect(ax - as * 1.35, ay - shaft, as * 1.35, shaft * 2);
        ctx.beginPath();
        ctx.moveTo(ax + as * 0.75, ay);
        ctx.lineTo(ax - as * 0.25, ay - as * 0.75);
        ctx.lineTo(ax - as * 0.25, ay + as * 0.75);
        ctx.closePath();
        ctx.fill();
    } else if (bb.arrow === '\u2190') { // left
        pxText(dirText, bb.x + 3, lineY, C.arrow, 10);
        const textLeft = lineCX - (dirW / 2) * PIXEL;
        const ax = textLeft - 4 * PIXEL;
        ctx.fillRect(ax, ay - shaft, as * 1.35, shaft * 2);
        ctx.beginPath();
        ctx.moveTo(ax - as * 0.75, ay);
        ctx.lineTo(ax + as * 0.25, ay - as * 0.75);
        ctx.lineTo(ax + as * 0.25, ay + as * 0.75);
        ctx.closePath();
        ctx.fill();
    } else { // up
        pxText(dirText, bb.x + 3, lineY, C.arrow, 10);
        const textLeft = lineCX - (dirW / 2) * PIXEL;
        const ax = textLeft - 4 * PIXEL;
        ctx.fillRect(ax - shaft, ay, shaft * 2, as * 1.35);
        ctx.beginPath();
        ctx.moveTo(ax, ay - as * 0.75);
        ctx.lineTo(ax - as * 0.75, ay + as * 0.25);
        ctx.lineTo(ax + as * 0.75, ay + as * 0.25);
        ctx.closePath();
        ctx.fill();
    }

    // Billboard spotlight fixtures
    const dark = getDarkness();
    if (dark > 0.1) {
        const lx = (bb.x - cam.x) * PIXEL;
        const ly = (bb.y - bh - cam.y) * PIXEL;
        const halfW = (bw / 2) * PIXEL;
        const thirdW = halfW * 2 / 3;
        const fixtures = [lx - thirdW / 2, lx + thirdW / 2];
        const flashing = flash && flash.triggered && flash.count < 4;

        for (let fi = 0; fi < fixtures.length; fi++) {
            const fx = fixtures[fi];
            const isFlashLight = fi === 1 && flashing;
            const lightOn = isFlashLight ? flash.on : true;
            ctx.fillStyle = lightOn ? '#ffee88' : '#333';
            ctx.fillRect(fx - 1.5 * PIXEL, ly - 2 * PIXEL, 3 * PIXEL, 2 * PIXEL);
        }
    }

    // Label
    pxText(bb.label, bb.x, bb.y - bh + 20, C.white, 13);
    // Sublabel (if present)
    if (bb.sublabel) pxText(bb.sublabel, bb.x, bb.y - bh + 30, '#ccddbb', 10);
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

    // Night illumination — warm light on body
    const dark = getDarkness();
    if (dark > 0.1) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = `rgba(160,60,40,${dark * 0.8})`;
        ctx.fillRect(-3 * s, -5 * s, 6 * s, 10 * s);
        ctx.restore();
    }

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

    // "BACK TO SPACE" label above rocket — always on top
    pxText('BACK TO SPACE', rocket.x, rocket.y + 13, '#ffffff', 13);
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

    // Spawn car outside the building it just entered, facing away
    if (arrived === 'straight') {
        // EQUIPMENT courthouse — spawn south of steps facing down
        car.x = CROSS_X;
        car.y = CROSS_Y - ZONE_DIST - 20 + 40;
        car.angle = Math.PI / 2;
    } else if (arrived === 'right') {
        // Stage 1 — spawn south of door facing down
        const s1 = soundStages[0];
        car.x = s1.x;
        car.y = s1.y + 25 + 25;
        car.angle = Math.PI / 2;
    } else if (arrived === 'left') {
        // Stage 2 — spawn south of door facing down
        const s2 = soundStages[1];
        car.x = s2.x;
        car.y = s2.y + 25 + 25;
        car.angle = Math.PI / 2;
    }
    car.speed = 0;
    arrived = null;
    running = true;
    lastTime = performance.now();
    requestAnimationFrame(loop);
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

    // Spotlight fixtures (dots only; beams handled by darkness cutout system)
    const dark = getDarkness();
    if (dark > 0.1) {
        const lx = (bx - cam.x) * PIXEL;
        const ly = (by - bh - cam.y) * PIXEL;
        const halfW = (bw / 2) * PIXEL;
        const thirdW = halfW * 2 / 3;
        const fixtures = [lx - thirdW / 2, lx + thirdW / 2];
        for (const fx of fixtures) {
            ctx.fillStyle = '#ffee88';
            ctx.fillRect(fx - 1.5 * PIXEL, ly - 2 * PIXEL, 3 * PIXEL, 2 * PIXEL);
        }
    }
}

// ── Box Truck & Workers Drawing ─────────────────────────────────────

function drawTruckScene() {
    if (truck.state === 'gone') return;

    ctx.save();
    ctx.globalAlpha = truck.alpha;

    if (truck.state === 'parked' || truck.state === 'loading') {
        drawTruckFacingLeft();
    } else if (truck.facing === 'left') {
        drawTruckFacingLeft();
    } else if (truck.facing === 'up') {
        drawTruckDriving();
    } else {
        drawTruckParked(); // facing right
    }

    // Draw workers (only while parked or early loading)
    const showWorkers = truck.state === 'parked' ||
        (truck.state === 'loading' && truck.stateT < 60);
    if (showWorkers) {
        drawWorkers();
    }

    ctx.globalAlpha = 1;
    ctx.restore();
}

function drawTruckParked() {
    const tx = truck.x;
    const ty = truck.y;

    // Shadow
    px(tx - 14, ty + 6, 28, 4, 'rgba(0,0,0,0.15)');

    // Wheels (back and front axle)
    px(tx - 12, ty + 4, 4, 3, '#222');
    px(tx + 8, ty + 4, 4, 3, '#222');
    px(tx - 11, ty + 5, 2, 1, '#555');
    px(tx + 9, ty + 5, 2, 1, '#555');

    // Chassis
    px(tx - 13, ty + 3, 26, 2, '#444');

    // Box body
    px(tx - 12, ty - 12, 20, 16, '#e8e8e8');
    px(tx - 12, ty - 13, 20, 1, '#ccc');
    px(tx - 12, ty + 3, 20, 1, '#aaa');
    px(tx - 12, ty - 4, 1, 7, '#bbb');
    px(tx + 7, ty - 4, 1, 7, '#bbb');

    // Roll-up door (open)
    px(tx - 12, ty - 4, 3, 8, '#999');
    px(tx - 12, ty - 5, 3, 1, '#888');

    // Cab
    px(tx + 8, ty - 8, 8, 12, '#ddd');
    px(tx + 8, ty - 9, 8, 1, '#bbb');
    px(tx + 12, ty - 7, 3, 4, '#446688');
    px(tx + 11, ty - 6, 1, 8, '#aaa');

    // Front bumper
    px(tx + 15, ty + 1, 2, 3, '#888');
    // Headlight & tail light
    px(tx + 15, ty - 1, 2, 2, '#ffee88');
    px(tx - 13, ty + 1, 1, 2, '#cc3333');

    pxText('MOONLIT', tx - 2, ty - 5, '#444', 10);
}

function drawTruckDriving() {
    const tx = truck.x;
    const ty = truck.y;

    // Top-down north-facing box truck
    // Shadow
    px(tx - 5, ty + 9, 10, 3, 'rgba(0,0,0,0.15)');

    // Rear wheels
    px(tx - 7, ty + 5, 3, 4, '#222');
    px(tx + 4, ty + 5, 3, 4, '#222');
    // Front wheels
    px(tx - 7, ty - 7, 3, 3, '#222');
    px(tx + 4, ty - 7, 3, 3, '#222');

    // Box body
    px(tx - 5, ty - 3, 10, 13, '#e8e8e8');
    // Side rails
    px(tx - 5, ty - 3, 1, 13, '#ccc');
    px(tx + 4, ty - 3, 1, 13, '#ccc');

    // Roll-up door (closed, rear)
    px(tx - 4, ty + 8, 8, 2, '#aaa');

    // Cab
    px(tx - 5, ty - 10, 10, 8, '#ddd');
    px(tx - 5, ty - 10, 10, 1, '#bbb');
    // Windshield
    px(tx - 4, ty - 10, 8, 3, '#446688');

    // Headlights (glowing)
    px(tx - 5, ty - 11, 2, 1, '#ffee88');
    px(tx + 3, ty - 11, 2, 1, '#ffee88');
    // Tail lights
    px(tx - 4, ty + 10, 2, 1, '#cc3333');
    px(tx + 2, ty + 10, 2, 1, '#cc3333');

    pxText('MOONLIT', tx, ty + 3, '#444', 8);
}

function drawTruckFacingLeft() {
    const tx = truck.x;
    const ty = truck.y;

    // Side-view facing left (mirror of parked)
    // Shadow
    px(tx - 14, ty + 6, 28, 4, 'rgba(0,0,0,0.15)');

    // Wheels
    px(tx - 12, ty + 4, 4, 3, '#222');
    px(tx + 8, ty + 4, 4, 3, '#222');
    px(tx - 11, ty + 5, 2, 1, '#555');
    px(tx + 9, ty + 5, 2, 1, '#555');

    // Chassis
    px(tx - 13, ty + 3, 26, 2, '#444');

    // Cab (now on left side)
    px(tx - 16, ty - 8, 8, 12, '#ddd');
    px(tx - 16, ty - 9, 8, 1, '#bbb');
    px(tx - 15, ty - 7, 3, 4, '#446688');
    px(tx - 12, ty - 6, 1, 8, '#aaa');

    // Box body (shifted right)
    px(tx - 8, ty - 12, 20, 16, '#e8e8e8');
    px(tx - 8, ty - 13, 20, 1, '#ccc');
    px(tx - 8, ty + 3, 20, 1, '#aaa');
    px(tx - 8, ty - 4, 1, 7, '#bbb');
    px(tx + 11, ty - 4, 1, 7, '#bbb');

    // Roll-up door (on right side now)
    px(tx + 9, ty - 4, 3, 8, '#999');
    px(tx + 9, ty - 5, 3, 1, '#888');

    // Front bumper (left side)
    px(tx - 17, ty + 1, 2, 3, '#888');
    // Headlight & tail light
    px(tx - 17, ty - 1, 2, 2, '#ffee88');
    px(tx + 12, ty + 1, 1, 2, '#cc3333');

    pxText('MOONLIT', tx + 2, ty - 5, '#444', 10);
}

function drawWorkers() {
    const w = workers;
    const walking = w.phase === 1 || w.phase === 3 || w.phase === 5 || w.phase === 7 ||
        truck.state === 'loading';

    // Draw carried HMI between workers
    if (w.carrying) {
        const midX = (w.w1x + w.w2x) / 2;
        const midY = (w.w1y + w.w2y) / 2;
        drawHMI(midX, midY, true);
    }

    drawWorkerFigure(w.w1x, w.w1y, walking);
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
    // Headlamp on hard hat (cool white 6500K, visible when dark)
    const dark = getDarkness();
    if (dark > 0.1) {
        px(x, y - 6, 1, 1, '#e8eeff');
        // Small directional beam in walking direction
        const hx = (x - cam.x) * PIXEL;
        const hy = (y - 5 - cam.y) * PIXEL;
        const w = workers;
        const beamLen = 3 * PIXEL;
        const beamSpread = 2 * PIXEL;
        const alpha = Math.min(0.18, dark * 0.25);
        const perpX = -w.dirY;
        const perpY = w.dirX;
        const tipX = hx + w.dirX * beamLen * PIXEL;
        const tipY = hy + w.dirY * beamLen * PIXEL;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.lineTo(tipX + perpX * beamSpread, tipY + perpY * beamSpread);
        ctx.lineTo(tipX - perpX * beamSpread, tipY - perpY * beamSpread);
        ctx.closePath();
        ctx.clip();
        const beamGrad = ctx.createRadialGradient(hx, hy, 0, hx + w.dirX * beamLen * PIXEL * 0.5, hy + w.dirY * beamLen * PIXEL * 0.5, beamLen * PIXEL);
        beamGrad.addColorStop(0, `rgba(220, 230, 255, ${alpha})`);
        beamGrad.addColorStop(0.5, `rgba(220, 230, 255, ${alpha * 0.3})`);
        beamGrad.addColorStop(1, 'rgba(220, 230, 255, 0)');
        ctx.fillStyle = beamGrad;
        ctx.fillRect(Math.min(hx, tipX) - beamSpread, Math.min(hy, tipY) - beamSpread,
            Math.abs(tipX - hx) + beamSpread * 2, Math.abs(tipY - hy) + beamSpread * 2);
        ctx.restore();
    }
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

// ── Truck Headlight Beams ────────────────────────────────────────────

function drawTruckHeadlights() {
    if (truck.state === 'gone') return;
    const tx = (truck.x - cam.x) * PIXEL;
    const ty = (truck.y - cam.y) * PIXEL;
    const s = PIXEL;
    const dark = getDarkness();
    const baseAlpha = Math.max(0.15, Math.min(0.4, dark * 0.5 + 0.15));
    const alpha = baseAlpha * truck.alpha;

    // Determine rotation from facing
    let angle;
    if (truck.facing === 'right') angle = 0;
    else if (truck.facing === 'left') angle = Math.PI;
    else if (truck.facing === 'up') angle = -Math.PI / 2;
    else angle = Math.PI / 2;

    ctx.save();
    ctx.translate(tx, ty);
    ctx.rotate(angle);

    const coneLen = 55 * s;
    const coneW = 10 * s;
    // Match beam origin to actual headlight bulb positions per facing
    let fwd, offsets;
    if (truck.facing === 'up') {
        fwd = 11 * s;   // top-down: headlights at ty - 11
        offsets = [-4 * s, 4 * s]; // two headlights at tx ± 4
    } else {
        fwd = 16 * s;   // side view: headlight at ±16 from center
        offsets = [-1 * s, 1 * s]; // single headlight, small spread
    }

    for (const off of offsets) {
        const grad = ctx.createLinearGradient(fwd, 0, fwd + coneLen, 0);
        grad.addColorStop(0, `rgba(255, 238, 120, ${alpha})`);
        grad.addColorStop(0.5, `rgba(255, 238, 120, ${alpha * 0.3})`);
        grad.addColorStop(1, 'rgba(255, 238, 120, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(fwd, off);
        ctx.lineTo(fwd + coneLen, off - coneW);
        ctx.lineTo(fwd + coneLen, off + coneW);
        ctx.closePath();
        ctx.fill();
    }

    ctx.restore();
}

// ── Police Car Drawing ──────────────────────────────────────────────

function drawPoliceCarScene() {
    if (policeCar.state === 'waiting') return;
    if (policeCar.facing === 'down') drawPoliceCarDown();
    else if (policeCar.facing === 'right') drawPoliceCarRight();
    else if (policeCar.facing === 'left') drawPoliceCarLeft();
    else drawPoliceCarDown(); // fallback
}

function drawPoliceCarLightBar(barCX, barCY) {
    // No-op — police light beams handled in drawPoliceLightBeams
}

function drawPoliceCarDown() {
    const cx = policeCar.x;
    const cy = policeCar.y;
    const flashLeft = Math.floor(Date.now() / 300) % 2 === 0;

    // Shadow
    px(cx - 4, cy + 8, 8, 3, 'rgba(0,0,0,0.15)');
    // Wheels
    px(cx - 5.5, cy + 4, 2, 4, '#222');
    px(cx + 3.5, cy + 4, 2, 4, '#222');
    px(cx - 5.5, cy - 6, 2, 4, '#222');
    px(cx + 3.5, cy - 6, 2, 4, '#222');
    // Body
    px(cx - 4, cy - 7, 8, 14, '#e8e8e8');
    // Hood (front = bottom)
    px(cx - 4, cy + 3, 8, 4, '#ddd');
    // Black stripe
    px(cx - 4, cy - 1, 8, 1.5, '#222');
    // Rear windshield (top)
    px(cx - 3, cy - 6, 6, 3, '#446688');
    // Front windshield (bottom)
    px(cx - 3, cy + 4, 6, 2, '#446688');
    // Light bar (centered on roof)
    px(cx - 2, cy - 2, 2, 2, flashLeft ? '#ff0000' : '#0044ff');
    px(cx, cy - 2, 2, 2, flashLeft ? '#0044ff' : '#ff0000');
    drawPoliceCarLightBar(cx, cy - 1);
    // Headlights (bottom = front)
    px(cx - 3, cy + 7.5, 2, 1.5, '#ffee88');
    px(cx + 1, cy + 7.5, 2, 1.5, '#ffee88');
    // Tail lights (top = rear)
    px(cx - 3.5, cy - 8, 2, 1, '#cc3333');
    px(cx + 1.5, cy - 8, 2, 1, '#cc3333');
}

function drawPoliceCarRight() {
    const cx = policeCar.x;
    const cy = policeCar.y;
    const flashLeft = Math.floor(Date.now() / 300) % 2 === 0;

    // Shadow
    px(cx - 3, cy + 5, 14, 3, 'rgba(0,0,0,0.15)');
    // Wheels
    px(cx - 6, cy + 3, 4, 2, '#222');
    px(cx + 4, cy + 3, 4, 2, '#222');
    px(cx - 6, cy - 3, 4, 2, '#222');
    px(cx + 4, cy - 3, 4, 2, '#222');
    // Body (side view, longer horizontal)
    px(cx - 7, cy - 4, 14, 8, '#e8e8e8');
    // Hood (right = front)
    px(cx + 3, cy - 4, 4, 8, '#ddd');
    // Black stripe
    px(cx - 7, cy, 14, 1.5, '#222');
    // Rear windshield (left)
    px(cx - 6, cy - 3, 3, 6, '#446688');
    // Front windshield (right)
    px(cx + 4, cy - 3, 2, 6, '#446688');
    // Light bar (centered on roof)
    px(cx - 2, cy - 5, 2, 2, flashLeft ? '#ff0000' : '#0044ff');
    px(cx, cy - 5, 2, 2, flashLeft ? '#0044ff' : '#ff0000');
    drawPoliceCarLightBar(cx, cy - 4);
    // Headlights (right = front)
    px(cx + 7.5, cy - 2, 1.5, 2, '#ffee88');
    px(cx + 7.5, cy + 1, 1.5, 2, '#ffee88');
    // Tail lights (left = rear)
    px(cx - 8, cy - 2, 1, 2, '#cc3333');
    px(cx - 8, cy + 1, 1, 2, '#cc3333');
}

function drawPoliceCarLeft() {
    const cx = policeCar.x;
    const cy = policeCar.y;
    const flashLeft = Math.floor(Date.now() / 300) % 2 === 0;

    // Shadow
    px(cx - 11, cy + 5, 14, 3, 'rgba(0,0,0,0.15)');
    // Wheels
    px(cx - 8, cy + 3, 4, 2, '#222');
    px(cx + 2, cy + 3, 4, 2, '#222');
    px(cx - 8, cy - 3, 4, 2, '#222');
    px(cx + 2, cy - 3, 4, 2, '#222');
    // Body (side view, longer horizontal)
    px(cx - 7, cy - 4, 14, 8, '#e8e8e8');
    // Hood (left = front)
    px(cx - 7, cy - 4, 4, 8, '#ddd');
    // Black stripe
    px(cx - 7, cy, 14, 1.5, '#222');
    // Rear windshield (right)
    px(cx + 3, cy - 3, 3, 6, '#446688');
    // Front windshield (left)
    px(cx - 6, cy - 3, 2, 6, '#446688');
    // Light bar (centered on roof)
    px(cx - 2, cy - 5, 2, 2, flashLeft ? '#ff0000' : '#0044ff');
    px(cx, cy - 5, 2, 2, flashLeft ? '#0044ff' : '#ff0000');
    drawPoliceCarLightBar(cx, cy - 4);
    // Headlights (left = front)
    px(cx - 9, cy - 2, 1.5, 2, '#ffee88');
    px(cx - 9, cy + 1, 1.5, 2, '#ffee88');
    // Tail lights (right = rear)
    px(cx + 7, cy - 2, 1, 2, '#cc3333');
    px(cx + 7, cy + 1, 1, 2, '#cc3333');
}

// ── Police Car Headlight Beams ──────────────────────────────────────

function policeAngle() {
    if (policeCar.facing === 'right') return 0;
    if (policeCar.facing === 'left') return Math.PI;
    if (policeCar.facing === 'up') return -Math.PI / 2;
    return Math.PI / 2; // down
}

function drawPoliceHeadlights() {
    if (policeCar.state === 'waiting') return;
    const tx = (policeCar.x - cam.x) * PIXEL;
    const ty = (policeCar.y - cam.y) * PIXEL;
    const s = PIXEL;
    const dark = getDarkness();
    const baseAlpha = Math.max(0.15, Math.min(0.4, dark * 0.5 + 0.15));

    const angle = policeAngle();

    ctx.save();
    ctx.translate(tx, ty);
    ctx.rotate(angle);

    const coneLen = 40 * s;
    const coneW = 8 * s;
    const fwd = 5 * s;
    const offsets = [-1.5 * s, 1.5 * s];

    for (const off of offsets) {
        const grad = ctx.createLinearGradient(fwd, 0, fwd + coneLen, 0);
        grad.addColorStop(0, `rgba(255, 238, 120, ${baseAlpha})`);
        grad.addColorStop(0.5, `rgba(255, 238, 120, ${baseAlpha * 0.3})`);
        grad.addColorStop(1, 'rgba(255, 238, 120, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(fwd, off);
        ctx.lineTo(fwd + coneLen, off - coneW);
        ctx.lineTo(fwd + coneLen, off + coneW);
        ctx.closePath();
        ctx.fill();
    }

    ctx.restore();
}

function drawPoliceLightBeams() {
    if (policeCar.state === 'waiting') return;
    const tx = (policeCar.x - cam.x) * PIXEL;
    const ty = (policeCar.y - cam.y) * PIXEL;
    const s = PIXEL;
    const flashLeft = Math.floor(Date.now() / 300) % 2 === 0;

    const radius = 45 * s;
    const redAlpha = flashLeft ? 0.25 : 0.08;
    const blueAlpha = flashLeft ? 0.08 : 0.25;

    // Red omnidirectional glow
    const gR = ctx.createRadialGradient(tx - 2 * s, ty, 0, tx - 2 * s, ty, radius);
    gR.addColorStop(0, `rgba(255, 30, 30, ${redAlpha})`);
    gR.addColorStop(0.3, `rgba(255, 30, 30, ${redAlpha * 0.5})`);
    gR.addColorStop(0.6, `rgba(255, 30, 30, ${redAlpha * 0.15})`);
    gR.addColorStop(1, 'rgba(255, 30, 30, 0)');
    ctx.fillStyle = gR;
    ctx.beginPath();
    ctx.arc(tx - 2 * s, ty, radius, 0, Math.PI * 2);
    ctx.fill();

    // Blue omnidirectional glow
    const gB = ctx.createRadialGradient(tx + 2 * s, ty, 0, tx + 2 * s, ty, radius);
    gB.addColorStop(0, `rgba(30, 60, 255, ${blueAlpha})`);
    gB.addColorStop(0.3, `rgba(30, 60, 255, ${blueAlpha * 0.5})`);
    gB.addColorStop(0.6, `rgba(30, 60, 255, ${blueAlpha * 0.15})`);
    gB.addColorStop(1, 'rgba(30, 60, 255, 0)');
    ctx.fillStyle = gB;
    ctx.beginPath();
    ctx.arc(tx + 2 * s, ty, radius, 0, Math.PI * 2);
    ctx.fill();
}

// ── Crane Light Beams (HMIs illuminating rocket at night) ───────────

function drawCraneLightBeams(darkness) {
    for (let i = 0; i < cranes.length; i++) {
        const cl = craneLights[i];
        if (!cl.pickedUp || cranes[i].state !== 'holding') continue;

        const alpha = Math.min(0.7, darkness * 0.9);

        // HMI lens glow
        const glowX = (cl.beamX - cam.x) * PIXEL;
        const glowY = (cl.beamY - cam.y) * PIXEL;
        const glowRad = 14 * PIXEL;
        const glowGrad = ctx.createRadialGradient(glowX, glowY, 0, glowX, glowY, glowRad);
        glowGrad.addColorStop(0, `rgba(255, 250, 230, ${alpha})`);
        glowGrad.addColorStop(0.3, `rgba(255, 245, 200, ${alpha * 0.5})`);
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
        const spread = 30 * PIXEL;

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(lightX - px2 * 5, lightY - py2 * 5);
        ctx.lineTo(lightX + px2 * 5, lightY + py2 * 5);
        ctx.lineTo(targetX + px2 * spread, targetY + py2 * spread);
        ctx.lineTo(targetX - px2 * spread, targetY - py2 * spread);
        ctx.closePath();
        ctx.clip();

        const beamGrad = ctx.createRadialGradient(
            lightX, lightY, 0,
            lightX + dx * 0.5, lightY + dy * 0.5, dist * 0.85
        );
        beamGrad.addColorStop(0, `rgba(255, 250, 220, ${alpha})`);
        beamGrad.addColorStop(0.2, `rgba(255, 245, 200, ${alpha * 0.6})`);
        beamGrad.addColorStop(0.5, `rgba(255, 245, 200, ${alpha * 0.25})`);
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

function drawCraneHeadlampBeams(darkness) {
    if (darkness <= 0.1) return;
    const s = PIXEL;
    const alpha = Math.min(0.2, darkness * 0.3);
    for (const cr of cranes) {
        const dir = cr.side === 'left' ? 1 : -1;
        const lx = (cr.x + dir * 7 - cam.x) * s;
        const ly = (cr.y - 6 - cam.y) * s;
        const coneLen = 14 * s;
        const coneW = 4 * s;
        const fwdX = dir;
        const fwdY = 0.4;
        const len = Math.sqrt(fwdX * fwdX + fwdY * fwdY);
        const nx = fwdX / len;
        const ny = fwdY / len;
        const endX = lx + nx * coneLen;
        const endY = ly + ny * coneLen;
        const perpX = -ny;
        const perpY = nx;
        const grad = ctx.createLinearGradient(lx, ly, endX, endY);
        grad.addColorStop(0, `rgba(255, 238, 120, ${alpha})`);
        grad.addColorStop(0.5, `rgba(255, 238, 120, ${alpha * 0.3})`);
        grad.addColorStop(1, 'rgba(255, 238, 120, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(lx, ly);
        ctx.lineTo(endX + perpX * coneW, endY + perpY * coneW);
        ctx.lineTo(endX - perpX * coneW, endY - perpY * coneW);
        ctx.closePath();
        ctx.fill();
    }
}

// ── Darkness + Light Cutout System ───────────────────────────────────
// Draws darkness on an offscreen canvas, then cuts holes where lights shine.
// This reveals the original scene underneath instead of just overlaying yellow.

function drawDarknessWithLights() {
    const darkness = getDarkness();

    // Dawn/dusk warm tint (always applies when active)
    const tint = getTimeTint();
    if (tint) {
        ctx.fillStyle = `rgba(${tint.r}, ${tint.g}, ${tint.b}, ${tint.a})`;
        ctx.fillRect(0, 0, W, H);
    }

    if (darkness <= 0) return;

    // ── Build darkness layer on offscreen canvas ──
    darkCtx.clearRect(0, 0, W, H);
    darkCtx.globalCompositeOperation = 'source-over';
    darkCtx.globalAlpha = 1;
    darkCtx.fillStyle = `rgba(5, 5, 30, ${darkness})`;
    darkCtx.fillRect(0, 0, W, H);

    // Vignette (darker at edges)
    const vigGrad = darkCtx.createRadialGradient(W / 2, H / 2, W * 0.25, W / 2, H / 2, W * 0.7);
    vigGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vigGrad.addColorStop(1, `rgba(0, 0, 10, ${darkness * 0.4})`);
    darkCtx.fillStyle = vigGrad;
    darkCtx.fillRect(0, 0, W, H);

    // ── Cut light holes with destination-out ──
    // destination-out: result_alpha = dest * (1 - src). Need src ≈ 1.0 for full reveal.
    darkCtx.globalCompositeOperation = 'destination-out';
    const cutAlpha = 1.0;

    // --- Car headlights ---
    if (darkness > 0.1) {
        const sx = (car.x - cam.x) * PIXEL;
        const sy = (car.y - cam.y) * PIXEL;
        const s = PIXEL;
        darkCtx.save();
        darkCtx.translate(sx, sy);
        darkCtx.rotate(car.angle);
        const coneLen = 55 * s;
        const coneW = 12 * s;
        const offsets = [-1.5 * s, 1.5 * s];
        for (const off of offsets) {
            const grad = darkCtx.createLinearGradient(5 * s, 0, coneLen, 0);
            grad.addColorStop(0, `rgba(255,255,255,${cutAlpha})`);
            grad.addColorStop(0.3, `rgba(255,255,255,${cutAlpha * 0.7})`);
            grad.addColorStop(0.6, `rgba(255,255,255,${cutAlpha * 0.3})`);
            grad.addColorStop(1, 'rgba(255,255,255,0)');
            darkCtx.fillStyle = grad;
            darkCtx.beginPath();
            darkCtx.moveTo(5 * s, off);
            darkCtx.lineTo(coneLen, off - coneW);
            darkCtx.lineTo(coneLen, off + coneW);
            darkCtx.closePath();
            darkCtx.fill();
        }
        // Car body glow cutout — partial reveal so car stays visible
        darkCtx.rotate(-car.angle); // undo rotation, stay translated
        darkCtx.rotate(car.angle + Math.PI / 2); // align to car sprite
        const bodyGlow = darkCtx.createRadialGradient(0, 0, 0, 0, 0, 8 * s);
        bodyGlow.addColorStop(0, `rgba(255,255,255,${cutAlpha * 0.5})`);
        bodyGlow.addColorStop(0.6, `rgba(255,255,255,${cutAlpha * 0.25})`);
        bodyGlow.addColorStop(1, 'rgba(255,255,255,0)');
        darkCtx.fillStyle = bodyGlow;
        darkCtx.beginPath();
        darkCtx.arc(0, 0, 8 * s, 0, Math.PI * 2);
        darkCtx.fill();
        darkCtx.restore();
    }

    // --- Billboard spotlights ---
    if (darkness > 0.1) {
        const bbW = 46, bbH = 36;
        for (let i = 0; i < billboards.length; i++) {
            const bb = billboards[i];
            const flash = bbFlash[i];
            const lx = (bb.x - cam.x) * PIXEL;
            const ly = (bb.y - bbH - cam.y) * PIXEL;
            const lh = bbH * PIXEL;
            const halfW = (bbW / 2) * PIXEL;
            const thirdW = halfW * 2 / 3;
            const fixtures = [lx - thirdW / 2, lx + thirdW / 2];
            const flashing = flash && flash.triggered && flash.count < 4;

            for (let fi = 0; fi < fixtures.length; fi++) {
                const fx = fixtures[fi];
                const isFlashLight = fi === 1 && flashing;
                const lightOn = isFlashLight ? flash.on : true;
                if (!lightOn) continue;

                // Fixture glow (so fixture dots are visible through darkness)
                const fGlow = darkCtx.createRadialGradient(fx, ly - PIXEL, 0, fx, ly - PIXEL, 8 * PIXEL);
                fGlow.addColorStop(0, `rgba(255,255,255,${cutAlpha * 0.8})`);
                fGlow.addColorStop(0.4, `rgba(255,255,255,${cutAlpha * 0.3})`);
                fGlow.addColorStop(1, 'rgba(255,255,255,0)');
                darkCtx.fillStyle = fGlow;
                darkCtx.fillRect(fx - 8 * PIXEL, ly - 9 * PIXEL, 16 * PIXEL, 16 * PIXEL);

                // Beam cutout on billboard face
                darkCtx.save();
                darkCtx.beginPath();
                darkCtx.rect(lx - halfW, ly, halfW * 2, lh);
                darkCtx.clip();
                darkCtx.beginPath();
                darkCtx.moveTo(fx - 2 * PIXEL, ly);
                darkCtx.lineTo(fx + 2 * PIXEL, ly);
                darkCtx.lineTo(lx + halfW, ly + lh);
                darkCtx.lineTo(lx - halfW, ly + lh);
                darkCtx.closePath();
                darkCtx.clip();
                const radius = Math.max(lh, halfW) * 1.3;
                const radGrad = darkCtx.createRadialGradient(fx, ly, 0, fx, ly + lh * 0.4, radius);
                radGrad.addColorStop(0, `rgba(255,255,255,${cutAlpha})`);
                radGrad.addColorStop(0.3, `rgba(255,255,255,${cutAlpha * 0.6})`);
                radGrad.addColorStop(0.6, `rgba(255,255,255,${cutAlpha * 0.2})`);
                radGrad.addColorStop(1, 'rgba(255,255,255,0)');
                darkCtx.fillStyle = radGrad;
                darkCtx.fillRect(lx - halfW, ly, halfW * 2, lh);
                darkCtx.restore();
            }
        }
    }

    // --- Social billboard LED screen (self-illuminated) ---
    if (darkness > 0) {
        const sbx = socialBillboard.x, sby = socialBillboard.y;
        const sbW = 75, sbH = 120;
        const pad = 4;
        // Full cutout for the LED screen — it's self-lit
        const scrX = (sbx - sbW / 2 + pad - cam.x) * PIXEL;
        const scrY = (sby - sbH + pad - cam.y) * PIXEL;
        const scrW = (sbW - pad * 2) * PIXEL;
        const scrH = (sbH - pad * 2) * PIXEL;
        darkCtx.fillStyle = `rgba(255,255,255,${cutAlpha})`;
        darkCtx.fillRect(scrX, scrY, scrW, scrH);
        // Ambient glow spilling from the screen
        const glowX = (sbx - cam.x) * PIXEL;
        const glowY = (sby - sbH / 2 - cam.y) * PIXEL;
        const glowR = Math.max(scrW, scrH) * 0.8;
        const ambGlow = darkCtx.createRadialGradient(glowX, glowY, scrW * 0.3, glowX, glowY, glowR);
        ambGlow.addColorStop(0, `rgba(255,255,255,${cutAlpha * 0.3})`);
        ambGlow.addColorStop(1, 'rgba(255,255,255,0)');
        darkCtx.fillStyle = ambGlow;
        darkCtx.fillRect(glowX - glowR, glowY - glowR, glowR * 2, glowR * 2);
    }

    // --- Social billboard spotlights ---
    if (darkness > 0.1) {
        const sbx = socialBillboard.x, sby = socialBillboard.y;
        const sbW = 75, sbH = 120;
        const lx = (sbx - cam.x) * PIXEL;
        const ly = (sby - sbH - cam.y) * PIXEL;
        const lh = sbH * PIXEL;
        const halfW = (sbW / 2) * PIXEL;
        const thirdW = halfW * 2 / 3;
        const fixtures = [lx - thirdW / 2, lx + thirdW / 2];

        for (const fx of fixtures) {
            // Fixture glow
            const fGlow = darkCtx.createRadialGradient(fx, ly - PIXEL, 0, fx, ly - PIXEL, 8 * PIXEL);
            fGlow.addColorStop(0, `rgba(255,255,255,${cutAlpha * 0.8})`);
            fGlow.addColorStop(0.4, `rgba(255,255,255,${cutAlpha * 0.3})`);
            fGlow.addColorStop(1, 'rgba(255,255,255,0)');
            darkCtx.fillStyle = fGlow;
            darkCtx.fillRect(fx - 8 * PIXEL, ly - 9 * PIXEL, 16 * PIXEL, 16 * PIXEL);

            // Beam cutout
            darkCtx.save();
            darkCtx.beginPath();
            darkCtx.rect(lx - halfW, ly, halfW * 2, lh);
            darkCtx.clip();
            darkCtx.beginPath();
            darkCtx.moveTo(fx - 2 * PIXEL, ly);
            darkCtx.lineTo(fx + 2 * PIXEL, ly);
            darkCtx.lineTo(lx + halfW, ly + lh);
            darkCtx.lineTo(lx - halfW, ly + lh);
            darkCtx.closePath();
            darkCtx.clip();
            const radius = Math.max(lh, halfW) * 1.3;
            const radGrad = darkCtx.createRadialGradient(fx, ly, 0, fx, ly + lh * 0.4, radius);
            radGrad.addColorStop(0, `rgba(255,255,255,${cutAlpha})`);
            radGrad.addColorStop(0.3, `rgba(255,255,255,${cutAlpha * 0.6})`);
            radGrad.addColorStop(0.6, `rgba(255,255,255,${cutAlpha * 0.2})`);
            radGrad.addColorStop(1, 'rgba(255,255,255,0)');
            darkCtx.fillStyle = radGrad;
            darkCtx.fillRect(lx - halfW, ly, halfW * 2, lh);
            darkCtx.restore();
        }
    }

    // --- Crane HMI beams ---
    if (darkness > 0.1) {
        for (let i = 0; i < cranes.length; i++) {
            const cl = craneLights[i];
            if (!cl.pickedUp || cranes[i].state !== 'holding') continue;

            // Lens glow cutout
            const glowX = (cl.beamX - cam.x) * PIXEL;
            const glowY = (cl.beamY - cam.y) * PIXEL;
            const glowRad = 20 * PIXEL;
            const glowGrad = darkCtx.createRadialGradient(glowX, glowY, 0, glowX, glowY, glowRad);
            glowGrad.addColorStop(0, `rgba(255,255,255,${cutAlpha})`);
            glowGrad.addColorStop(0.2, `rgba(255,255,255,${cutAlpha * 0.8})`);
            glowGrad.addColorStop(0.5, `rgba(255,255,255,${cutAlpha * 0.4})`);
            glowGrad.addColorStop(1, 'rgba(255,255,255,0)');
            darkCtx.fillStyle = glowGrad;
            darkCtx.fillRect(glowX - glowRad, glowY - glowRad, glowRad * 2, glowRad * 2);

            // Beam cone cutout toward rocket
            const lightX = glowX;
            const lightY = glowY;
            const targetX = (rocket.x - cam.x) * PIXEL;
            const targetY = (rocket.y + 10 - cam.y) * PIXEL;
            const dx = targetX - lightX;
            const dy = targetY - lightY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const nx = dx / dist;
            const ny = dy / dist;
            const px2 = -ny;
            const py2 = nx;
            const spread = 30 * PIXEL;

            darkCtx.save();
            darkCtx.beginPath();
            darkCtx.moveTo(lightX - px2 * 5, lightY - py2 * 5);
            darkCtx.lineTo(lightX + px2 * 5, lightY + py2 * 5);
            darkCtx.lineTo(targetX + px2 * spread, targetY + py2 * spread);
            darkCtx.lineTo(targetX - px2 * spread, targetY - py2 * spread);
            darkCtx.closePath();
            darkCtx.clip();
            const beamGrad = darkCtx.createRadialGradient(
                lightX, lightY, 0,
                lightX + dx * 0.5, lightY + dy * 0.5, dist * 0.85
            );
            beamGrad.addColorStop(0, `rgba(255,255,255,${cutAlpha})`);
            beamGrad.addColorStop(0.2, `rgba(255,255,255,${cutAlpha * 0.8})`);
            beamGrad.addColorStop(0.5, `rgba(255,255,255,${cutAlpha * 0.4})`);
            beamGrad.addColorStop(1, 'rgba(255,255,255,0)');
            darkCtx.fillStyle = beamGrad;
            darkCtx.fillRect(
                Math.min(lightX, targetX) - spread,
                Math.min(lightY, targetY) - spread,
                Math.abs(dx) + spread * 2,
                Math.abs(dy) + spread * 2
            );
            darkCtx.restore();
        }
    }

    // --- Stage 1 red light + window cutouts ---
    if (stage1Show.triggered) {
        const s1 = soundStages[0];
        const rlx = (s1.x + 0.5 - cam.x) * PIXEL;
        const rly = (s1.y + 25 - 2.5 - cam.y) * PIXEL;
        const redR = 20 * PIXEL;
        const rGrad = darkCtx.createRadialGradient(rlx, rly, 0, rlx, rly, redR);
        rGrad.addColorStop(0, `rgba(255,255,255,${cutAlpha * 0.6})`);
        rGrad.addColorStop(0.4, `rgba(255,255,255,${cutAlpha * 0.2})`);
        rGrad.addColorStop(1, 'rgba(255,255,255,0)');
        darkCtx.fillStyle = rGrad;
        darkCtx.beginPath();
        darkCtx.arc(rlx, rly, redR, 0, Math.PI * 2);
        darkCtx.fill();

        // Window light cutouts — all in unison, on/off
        if (stage1Show.on) {
            const winCutY = (s1.y - 25 + 8 - cam.y) * PIXEL;
            for (let wx = s1.x - 40 + 8; wx < s1.x + 40 - 8; wx += 12) {
                const wcx = (wx + 2.5 - cam.x) * PIXEL;
                const wR = 80 * PIXEL;
                const cutStr = cutAlpha * 0.7;
                const wGrad = darkCtx.createRadialGradient(wcx, winCutY, 0, wcx, winCutY + wR * 0.6, wR);
                wGrad.addColorStop(0, `rgba(255,255,255,${cutStr})`);
                wGrad.addColorStop(0.3, `rgba(255,255,255,${cutStr * 0.4})`);
                wGrad.addColorStop(1, 'rgba(255,255,255,0)');
                darkCtx.fillStyle = wGrad;
                darkCtx.fillRect(wcx - wR, winCutY, wR * 2, wR * 1.5);
            }
        }
    }

    // --- Crane headlamp cutouts ---
    if (darkness > 0.1) {
        for (const cr of cranes) {
            const dir = cr.side === 'left' ? 1 : -1;
            const poolCX = (cr.x + dir * 10 - cam.x) * PIXEL;
            const poolCY = (cr.y - 3 - cam.y) * PIXEL;
            const poolR = 10 * PIXEL;
            const grad = darkCtx.createRadialGradient(poolCX, poolCY, 0, poolCX, poolCY, poolR);
            grad.addColorStop(0, `rgba(255,255,255,${cutAlpha * 0.6})`);
            grad.addColorStop(0.5, `rgba(255,255,255,${cutAlpha * 0.25})`);
            grad.addColorStop(1, 'rgba(255,255,255,0)');
            darkCtx.fillStyle = grad;
            darkCtx.beginPath();
            darkCtx.arc(poolCX, poolCY, poolR, 0, Math.PI * 2);
            darkCtx.fill();
        }
    }

    // --- Truck headlights ---
    if ((truck.state === 'driving' || truck.state === 'fading') && truck.state !== 'gone') {
        const tx = (truck.x - cam.x) * PIXEL;
        const ty = (truck.y - cam.y) * PIXEL;
        const s = PIXEL;
        let angle;
        if (truck.facing === 'right') angle = 0;
        else if (truck.facing === 'left') angle = Math.PI;
        else if (truck.facing === 'up') angle = -Math.PI / 2;
        else angle = Math.PI / 2;

        darkCtx.save();
        darkCtx.globalAlpha = truck.alpha;
        darkCtx.translate(tx, ty);
        darkCtx.rotate(angle);
        const coneLen = 55 * s;
        const coneW = 10 * s;
        let fwd, offsets;
        if (truck.facing === 'up') {
            fwd = 11 * s;
            offsets = [-4 * s, 4 * s];
        } else {
            fwd = 16 * s;
            offsets = [-1 * s, 1 * s];
        }
        for (const off of offsets) {
            const grad = darkCtx.createLinearGradient(fwd, 0, fwd + coneLen, 0);
            grad.addColorStop(0, `rgba(255,255,255,${cutAlpha * 0.9})`);
            grad.addColorStop(0.3, `rgba(255,255,255,${cutAlpha * 0.5})`);
            grad.addColorStop(0.7, `rgba(255,255,255,${cutAlpha * 0.15})`);
            grad.addColorStop(1, 'rgba(255,255,255,0)');
            darkCtx.fillStyle = grad;
            darkCtx.beginPath();
            darkCtx.moveTo(fwd, off);
            darkCtx.lineTo(fwd + coneLen, off - coneW);
            darkCtx.lineTo(fwd + coneLen, off + coneW);
            darkCtx.closePath();
            darkCtx.fill();
        }
        darkCtx.restore();
    }

    // --- Police car headlights + light bar ---
    if (policeCar.state !== 'waiting') {
        const pcx = (policeCar.x - cam.x) * PIXEL;
        const pcy = (policeCar.y - cam.y) * PIXEL;
        const s = PIXEL;
        // Headlights facing current direction
        darkCtx.save();
        darkCtx.translate(pcx, pcy);
        darkCtx.rotate(policeAngle());
        const coneLen = 40 * s;
        const coneW = 8 * s;
        const fwd = 5 * s;
        const offsets = [-1.5 * s, 1.5 * s];
        for (const off of offsets) {
            const grad = darkCtx.createLinearGradient(fwd, 0, fwd + coneLen, 0);
            grad.addColorStop(0, `rgba(255,255,255,${cutAlpha * 0.9})`);
            grad.addColorStop(0.3, `rgba(255,255,255,${cutAlpha * 0.5})`);
            grad.addColorStop(0.7, `rgba(255,255,255,${cutAlpha * 0.15})`);
            grad.addColorStop(1, 'rgba(255,255,255,0)');
            darkCtx.fillStyle = grad;
            darkCtx.beginPath();
            darkCtx.moveTo(fwd, off);
            darkCtx.lineTo(fwd + coneLen, off - coneW);
            darkCtx.lineTo(fwd + coneLen, off + coneW);
            darkCtx.closePath();
            darkCtx.fill();
        }
        darkCtx.restore();
        // Light bar glow cutout
        const barGlow = darkCtx.createRadialGradient(pcx, pcy, 0, pcx, pcy, 12 * s);
        barGlow.addColorStop(0, `rgba(255,255,255,${cutAlpha * 0.5})`);
        barGlow.addColorStop(0.5, `rgba(255,255,255,${cutAlpha * 0.15})`);
        barGlow.addColorStop(1, 'rgba(255,255,255,0)');
        darkCtx.fillStyle = barGlow;
        darkCtx.fillRect(pcx - 12 * s, pcy - 12 * s, 24 * s, 24 * s);
    }

    // --- Work light poles (bright downward pools at dirt area) ---
    for (const wl of workLights) {
        const towardX = dirtCX - wl.x;
        const towardY = dirtCY - wl.y;
        const armDx = towardX > 0 ? 1 : -1;
        // Light center is below the fixture, biased toward dirt center
        const lx = (wl.x + armDx * 2 - cam.x) * PIXEL;
        const ly = (wl.y - 16 - cam.y) * PIXEL;
        const poolY = ly + 20 * PIXEL; // pool lands on the ground
        const radius = 22 * PIXEL;
        const grad = darkCtx.createRadialGradient(lx, poolY, 0, lx, poolY, radius);
        grad.addColorStop(0, `rgba(255,255,255,${cutAlpha * 0.9})`);
        grad.addColorStop(0.2, `rgba(255,255,255,${cutAlpha * 0.6})`);
        grad.addColorStop(0.5, `rgba(255,255,255,${cutAlpha * 0.2})`);
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        darkCtx.fillStyle = grad;
        darkCtx.beginPath();
        darkCtx.arc(lx, poolY, radius, 0, Math.PI * 2);
        darkCtx.fill();
    }

    // --- Street lamps (warm downward pools at intersection) ---
    for (const lamp of streetLamps) {
        const armDirX = lamp.x < CROSS_X ? 1 : -1;
        const lx = (lamp.x + armDirX * 2 - cam.x) * PIXEL;
        const ly = (lamp.y - 8 - cam.y) * PIXEL;
        const radius = 18 * PIXEL;
        const grad = darkCtx.createRadialGradient(lx, ly, 0, lx, ly + 4 * PIXEL, radius);
        grad.addColorStop(0, `rgba(255,255,255,${cutAlpha * 0.8})`);
        grad.addColorStop(0.3, `rgba(255,255,255,${cutAlpha * 0.4})`);
        grad.addColorStop(0.7, `rgba(255,255,255,${cutAlpha * 0.1})`);
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        darkCtx.fillStyle = grad;
        darkCtx.beginPath();
        darkCtx.arc(lx, ly + 4 * PIXEL, radius, 0, Math.PI * 2);
        darkCtx.fill();
    }

    // --- Worker headlamps (small directional cones, cool white 6500K) ---
    const workersVisible = truck.state === 'parked' ||
        (truck.state === 'loading' && truck.stateT < 60);
    if (darkness > 0.1 && workersVisible && !workers.done) {
        const w = workers;
        const beamLen = 3 * PIXEL;
        const beamSpread = 2 * PIXEL;
        const perpX = -w.dirY;
        const perpY = w.dirX;
        const positions = [[w.w1x, w.w1y], [w.w2x, w.w2y]];
        for (const [wx, wy] of positions) {
            const hx = (wx - cam.x) * PIXEL;
            const hy = (wy - 5 - cam.y) * PIXEL;
            const tipX = hx + w.dirX * beamLen * PIXEL;
            const tipY = hy + w.dirY * beamLen * PIXEL;
            // Tiny glow at the lamp
            const dotGlow = darkCtx.createRadialGradient(hx, hy, 0, hx, hy, 3 * PIXEL);
            dotGlow.addColorStop(0, `rgba(255,255,255,${cutAlpha * 0.4})`);
            dotGlow.addColorStop(1, 'rgba(255,255,255,0)');
            darkCtx.fillStyle = dotGlow;
            darkCtx.fillRect(hx - 3 * PIXEL, hy - 3 * PIXEL, 6 * PIXEL, 6 * PIXEL);
            // Directional cone cutout
            darkCtx.save();
            darkCtx.beginPath();
            darkCtx.moveTo(hx, hy);
            darkCtx.lineTo(tipX + perpX * beamSpread, tipY + perpY * beamSpread);
            darkCtx.lineTo(tipX - perpX * beamSpread, tipY - perpY * beamSpread);
            darkCtx.closePath();
            darkCtx.clip();
            const coneGrad = darkCtx.createRadialGradient(hx, hy, 0,
                hx + w.dirX * beamLen * PIXEL * 0.5, hy + w.dirY * beamLen * PIXEL * 0.5, beamLen * PIXEL);
            coneGrad.addColorStop(0, `rgba(255,255,255,${cutAlpha * 0.6})`);
            coneGrad.addColorStop(0.4, `rgba(255,255,255,${cutAlpha * 0.2})`);
            coneGrad.addColorStop(1, 'rgba(255,255,255,0)');
            darkCtx.fillStyle = coneGrad;
            darkCtx.fillRect(Math.min(hx, tipX) - beamSpread, Math.min(hy, tipY) - beamSpread,
                Math.abs(tipX - hx) + beamSpread * 2, Math.abs(tipY - hy) + beamSpread * 2);
            darkCtx.restore();
        }
    }

    // ── Reset and composite ──
    darkCtx.globalCompositeOperation = 'source-over';
    darkCtx.globalAlpha = 1;

    // Composite darkness layer (with light holes) onto main canvas
    ctx.drawImage(darkCanvas, 0, 0);

    // Add subtle warm glow at light sources (lighter blend for color temperature)
    if (darkness > 0.1) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.35;
        drawHeadlightCones(darkness);
        drawCraneLightBeams(darkness);
        drawCraneHeadlampBeams(darkness);
        if (truck.state === 'driving' || truck.state === 'fading') {
            drawTruckHeadlights();
        }
        if (policeCar.state !== 'waiting') {
            drawPoliceHeadlights();
            drawPoliceLightBeams();
        }
        // Work light sodium vapor glow + beams
        drawWorkLightBeams(darkness);
        for (const wl of workLights) {
            const towardX = dirtCX - wl.x;
            const armDx = towardX > 0 ? 1 : -1;
            const lx = (wl.x + armDx * 2 - cam.x) * PIXEL;
            const ly = (wl.y - 16 - cam.y) * PIXEL;
            const poolY = ly + 20 * PIXEL;
            const radius = 18 * PIXEL;
            const grad = ctx.createRadialGradient(lx, poolY, 0, lx, poolY, radius);
            grad.addColorStop(0, `rgba(255, 200, 100, ${darkness * 0.25})`);
            grad.addColorStop(0.5, `rgba(255, 200, 100, ${darkness * 0.08})`);
            grad.addColorStop(1, 'rgba(255, 200, 100, 0)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(lx, poolY, radius, 0, Math.PI * 2);
            ctx.fill();
        }
        // Street lamp warm glow
        for (const lamp of streetLamps) {
            const armDirX = lamp.x < CROSS_X ? 1 : -1;
            const lx = (lamp.x + armDirX * 2 - cam.x) * PIXEL;
            const ly = (lamp.y - 8 - cam.y) * PIXEL;
            const radius = 14 * PIXEL;
            const grad = ctx.createRadialGradient(lx, ly + 3 * PIXEL, 0, lx, ly + 3 * PIXEL, radius);
            grad.addColorStop(0, `rgba(255, 220, 130, ${darkness * 0.25})`);
            grad.addColorStop(0.5, `rgba(255, 220, 130, ${darkness * 0.08})`);
            grad.addColorStop(1, 'rgba(255, 220, 130, 0)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(lx, ly + 3 * PIXEL, radius, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }
}

// ── Game Loop ───────────────────────────────────────────────────────

let lastTime = performance.now();

function loop(now) {
    if (!running) return;
    const elapsed = now - lastTime;
    lastTime = now;
    // dt = 1.0 at 60fps, 2.0 at 30fps, etc. Clamped to avoid spiral of death.
    const dt = Math.min(elapsed / (1000 / 60), 3);
    update(dt);
    draw();
    requestAnimationFrame(loop);
}

running = true;
requestAnimationFrame(loop);
