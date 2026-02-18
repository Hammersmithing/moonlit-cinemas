// ── Canvas Setup ────────────────────────────────────────────────────

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
resize();
window.addEventListener('resize', resize);

// Prevent scroll/bounce on mobile (allow scroll on overlays)
document.body.addEventListener('touchmove', e => {
    if (!document.querySelector('.section-overlay:not(.hidden)')) {
        e.preventDefault();
    }
}, { passive: false });

// ── State ───────────────────────────────────────────────────────────

let running = false;
const keys = {};

window.addEventListener('keydown', e => { keys[e.key] = true; });
window.addEventListener('keyup', e => { keys[e.key] = false; });

// ── Touch / Joystick ────────────────────────────────────────────────

const isTouchDevice = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

const joystick = {
    active: false,
    dx: 0,       // -1 to 1 horizontal offset
    dy: 0,       // -1 to 1 vertical offset
    magnitude: 0 // 0 to 1 how far from center
};

if (isTouchDevice) {
    const base = document.getElementById('joystick-base');
    const knob = document.getElementById('joystick-knob');
    const maxDist = 38; // max pixel offset for knob

    function handleJoystickMove(clientX, clientY) {
        const rect = base.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        let dx = clientX - cx;
        let dy = clientY - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const clamped = Math.min(dist, maxDist);
        if (dist > 0) {
            dx = (dx / dist) * clamped;
            dy = (dy / dist) * clamped;
        }
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
        joystick.dx = dx / maxDist;
        joystick.dy = dy / maxDist;
        joystick.magnitude = clamped / maxDist;
        joystick.active = true;
    }

    function resetJoystick() {
        knob.style.transform = 'translate(0, 0)';
        joystick.dx = 0;
        joystick.dy = 0;
        joystick.magnitude = 0;
        joystick.active = false;
    }

    base.addEventListener('touchstart', e => {
        e.preventDefault();
        const t = e.touches[0];
        handleJoystickMove(t.clientX, t.clientY);
    }, { passive: false });

    base.addEventListener('touchmove', e => {
        e.preventDefault();
        const t = e.touches[0];
        handleJoystickMove(t.clientX, t.clientY);
    }, { passive: false });

    base.addEventListener('touchend', e => {
        e.preventDefault();
        resetJoystick();
    }, { passive: false });

    base.addEventListener('touchcancel', e => {
        resetJoystick();
    });
}

// ── Stars (background) ─────────────────────────────────────────────

const stars = [];
for (let i = 0; i < 200; i++) {
    stars.push({
        x: Math.random() * 4000 - 2000,
        y: Math.random() * 4000 - 2000,
        r: Math.random() * 1.5 + 0.3,
        bright: Math.random()
    });
}

// ── Ship ────────────────────────────────────────────────────────────

const ship = {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    angle: -Math.PI / 2,  // pointing up
    radius: 14,
    thrust: 0,
    rotSpeed: 0.06,
    accel: 0.15,
    friction: 0.995,
    maxSpeed: 5
};

// ── Asteroids ───────────────────────────────────────────────────────

const ASTEROID_LABELS = ['Reel', 'Equipment', 'Hire Me'];

const asteroids = ASTEROID_LABELS.map((label, i) => {
    // Place them in a ring around the ship start position
    const angle = (i / ASTEROID_LABELS.length) * Math.PI * 2 - Math.PI / 2;
    const dist = 500 + Math.random() * 200;
    return {
        label: label,
        x: Math.cos(angle) * dist,
        y: Math.sin(angle) * dist,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        radius: 55 + label.length * 4,
        angle: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.008,
        vertices: generateAsteroidShape(55 + label.length * 4)
    };
});

function generateAsteroidShape(radius) {
    const points = [];
    const numPoints = 10 + Math.floor(Math.random() * 4);
    for (let i = 0; i < numPoints; i++) {
        const a = (i / numPoints) * Math.PI * 2;
        const r = radius * (0.75 + Math.random() * 0.5);
        points.push({ a, r });
    }
    return points;
}

// ── Section Content ─────────────────────────────────────────────────

const sectionContent = {
    'Reel': `
        <h2>REEL</h2>
        <p>Selected work as Gaffer / Lighting Technician</p>
        <ul>
            <li>Coming soon — reel in production</li>
        </ul>
        <p style="margin-top:24px;color:#556;">Check back for updated showreel and credits.</p>
    `,
    'Equipment': `
        <h2>EQUIPMENT</h2>
        <p>Lighting package available for your production</p>
        <ul>
            <li>Aputure 600 Series</li>
            <li>Aputure 300 Series</li>
            <li>Aputure Amaran Series</li>
            <li>Grip & Rigging</li>
            <li>Distribution & Cabling</li>
        </ul>
        <p style="margin-top:24px;color:#556;">Full equipment list available on request.</p>
    `,
    'Hire Me': `
        <h2>HIRE ME</h2>
        <p>Gaffer based in your area, available for features, shorts, commercials, and music videos.</p>
        <p>Experienced in both studio and location work with crews of all sizes.</p>
        <ul>
            <li>Email: <a href="mailto:hello@moonlitcinemas.com">hello@moonlitcinemas.com</a></li>
        </ul>
        <p style="margin-top:24px;color:#556;">Let's light something beautiful.</p>
    `
};

// ── Camera ──────────────────────────────────────────────────────────

const camera = { x: 0, y: 0 };

// ── Particles (thrust exhaust) ──────────────────────────────────────

const particles = [];

function spawnThrustParticle() {
    const backAngle = ship.angle + Math.PI;
    const spread = (Math.random() - 0.5) * 0.6;
    particles.push({
        x: ship.x + Math.cos(backAngle) * 12,
        y: ship.y + Math.sin(backAngle) * 12,
        vx: Math.cos(backAngle + spread) * (1.5 + Math.random() * 2) + ship.vx * 0.3,
        vy: Math.sin(backAngle + spread) * (1.5 + Math.random() * 2) + ship.vy * 0.3,
        life: 1,
        decay: 0.02 + Math.random() * 0.03
    });
}

// ── Collision flash ─────────────────────────────────────────────────

let flashAlpha = 0;

// ── Update ──────────────────────────────────────────────────────────

function update() {
    // Rotation
    if (keys['a'] || keys['A'] || keys['ArrowLeft']) ship.angle -= ship.rotSpeed;
    if (keys['d'] || keys['D'] || keys['ArrowRight']) ship.angle += ship.rotSpeed;

    // Thrust
    ship.thrust = (keys['w'] || keys['W'] || keys['ArrowUp']) ? 1 : 0;

    // Joystick input — point ship toward joystick direction and thrust proportionally
    if (joystick.active && joystick.magnitude > 0.15) {
        const targetAngle = Math.atan2(joystick.dy, joystick.dx);
        // Smooth rotation toward target angle
        let diff = targetAngle - ship.angle;
        // Normalize to -PI..PI
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        ship.angle += diff * 0.12;
        ship.thrust = joystick.magnitude;
    }

    if (ship.thrust) {
        ship.vx += Math.cos(ship.angle) * ship.accel * ship.thrust;
        ship.vy += Math.sin(ship.angle) * ship.accel * ship.thrust;
        if (Math.random() > 0.3) spawnThrustParticle();
    }

    // Friction
    ship.vx *= ship.friction;
    ship.vy *= ship.friction;

    // Speed cap
    const speed = Math.sqrt(ship.vx * ship.vx + ship.vy * ship.vy);
    if (speed > ship.maxSpeed) {
        ship.vx = (ship.vx / speed) * ship.maxSpeed;
        ship.vy = (ship.vy / speed) * ship.maxSpeed;
    }

    ship.x += ship.vx;
    ship.y += ship.vy;

    // Update asteroids
    for (const a of asteroids) {
        a.x += a.vx;
        a.y += a.vy;
        a.angle += a.rotSpeed;
    }

    // Update particles
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life -= p.decay;
        if (p.life <= 0) particles.splice(i, 1);
    }

    // Flash decay
    if (flashAlpha > 0) flashAlpha -= 0.03;

    // Camera follows ship
    camera.x = ship.x - canvas.width / 2;
    camera.y = ship.y - canvas.height / 2;

    // Collision detection
    for (const a of asteroids) {
        const dx = ship.x - a.x;
        const dy = ship.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < ship.radius + a.radius - 10) {
            openSection(a.label);
            // Bounce ship away
            ship.vx = -ship.vx * 0.5;
            ship.vy = -ship.vy * 0.5;
            ship.x += dx * 0.3;
            ship.y += dy * 0.3;
            flashAlpha = 0.6;
            break;
        }
    }
}

// ── Draw ────────────────────────────────────────────────────────────

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(-camera.x, -camera.y);

    // Stars
    for (const s of stars) {
        const twinkle = 0.5 + 0.5 * Math.sin(Date.now() * 0.001 * s.bright + s.x);
        ctx.fillStyle = `rgba(255, 255, 255, ${0.3 + twinkle * 0.5})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
    }

    // Particles
    for (const p of particles) {
        ctx.fillStyle = `rgba(255, ${150 + Math.floor(p.life * 100)}, 50, ${p.life * 0.7})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.5 + p.life, 0, Math.PI * 2);
        ctx.fill();
    }

    // Asteroids
    for (const a of asteroids) {
        ctx.save();
        ctx.translate(a.x, a.y);
        ctx.rotate(a.angle);

        // Draw shape
        ctx.strokeStyle = '#888';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 0; i < a.vertices.length; i++) {
            const v = a.vertices[i];
            const px = Math.cos(v.a) * v.r;
            const py = Math.sin(v.a) * v.r;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();

        // Label (counter-rotate so text stays upright)
        ctx.rotate(-a.angle);
        ctx.fillStyle = '#ccc';
        ctx.font = '15px "Courier New", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(a.label.toUpperCase(), 0, 0);

        ctx.restore();
    }

    // Ship
    ctx.save();
    ctx.translate(ship.x, ship.y);
    ctx.rotate(ship.angle);

    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(18, 0);
    ctx.lineTo(-12, -10);
    ctx.lineTo(-7, 0);
    ctx.lineTo(-12, 10);
    ctx.closePath();
    ctx.stroke();

    // Thrust flame
    if (ship.thrust) {
        ctx.strokeStyle = `rgba(255, 180, 50, ${0.5 + Math.random() * 0.5})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-7, -4);
        ctx.lineTo(-14 - Math.random() * 8, 0);
        ctx.lineTo(-7, 4);
        ctx.stroke();
    }

    ctx.restore();

    // Direction indicators for off-screen asteroids
    drawDirectionIndicators();

    ctx.restore();

    // Flash overlay
    if (flashAlpha > 0) {
        ctx.fillStyle = `rgba(255, 255, 255, ${flashAlpha})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
}

// ── Direction Indicators ────────────────────────────────────────────

function drawDirectionIndicators() {
    const margin = 50;
    const screenL = camera.x + margin;
    const screenR = camera.x + canvas.width - margin;
    const screenT = camera.y + margin;
    const screenB = camera.y + canvas.height - margin;

    for (const a of asteroids) {
        // Check if asteroid is off screen
        if (a.x > camera.x - a.radius && a.x < camera.x + canvas.width + a.radius &&
            a.y > camera.y - a.radius && a.y < camera.y + canvas.height + a.radius) {
            continue; // on screen
        }

        const dx = a.x - ship.x;
        const dy = a.y - ship.y;
        const angle = Math.atan2(dy, dx);
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Clamp indicator to screen edge
        let ix = ship.x + Math.cos(angle) * (canvas.width * 0.4);
        let iy = ship.y + Math.sin(angle) * (canvas.height * 0.4);
        ix = Math.max(screenL, Math.min(screenR, ix));
        iy = Math.max(screenT, Math.min(screenB, iy));

        // Arrow
        ctx.save();
        ctx.translate(ix, iy);
        ctx.rotate(angle);

        const alpha = Math.max(0.3, 1 - dist / 2000);
        ctx.strokeStyle = `rgba(150, 170, 200, ${alpha})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(10, 0);
        ctx.lineTo(-4, -5);
        ctx.moveTo(10, 0);
        ctx.lineTo(-4, 5);
        ctx.stroke();

        // Label
        ctx.rotate(-angle);
        ctx.fillStyle = `rgba(150, 170, 200, ${alpha})`;
        ctx.font = '11px "Courier New", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(a.label.toUpperCase(), 0, -14);

        ctx.restore();
    }
}

// ── Section Navigation ──────────────────────────────────────────────

const sectionOverlay = document.getElementById('section-overlay');
const sectionContentEl = document.getElementById('section-content');
const backBtn = document.getElementById('back-btn');

const joystickZone = document.getElementById('joystick-zone');

function openSection(label) {
    // Equipment opens its own game page
    if (label === 'Equipment') {
        window.location.href = 'equipment.html';
        return;
    }
    // Reel opens the living room game
    if (label === 'Reel') {
        window.location.href = 'reel.html';
        return;
    }
    running = false;
    sectionContentEl.innerHTML = sectionContent[label] || `<h2>${label}</h2><p>Coming soon.</p>`;
    sectionOverlay.classList.remove('hidden');
    if (joystickZone) joystickZone.style.display = 'none';
}

backBtn.addEventListener('click', () => {
    sectionOverlay.classList.add('hidden');
    if (joystickZone && isTouchDevice) joystickZone.style.display = 'block';
    running = true;
    loop();
});

// ── Start ───────────────────────────────────────────────────────────

const controlsOverlay = document.getElementById('controls-overlay');
const startBtn = document.getElementById('start-btn');

startBtn.addEventListener('click', () => {
    controlsOverlay.style.display = 'none';
    running = true;
    canvas.focus();
    loop();
});

// Also allow Enter to start
window.addEventListener('keydown', e => {
    if (e.key === 'Enter' && controlsOverlay.style.display !== 'none') {
        startBtn.click();
    }
});

// Auto-open Hire Me if linked with #hire
if (window.location.hash === '#hire') {
    controlsOverlay.style.display = 'none';
    running = true;
    openSection('Hire Me');
    window.location.hash = '';
}

// ── Game Loop ───────────────────────────────────────────────────────

function loop() {
    if (!running) return;
    update();
    draw();
    requestAnimationFrame(loop);
}

// Draw the initial stars in background even before start
function drawBackground() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const s of stars) {
        const sx = ((s.x % canvas.width) + canvas.width) % canvas.width;
        const sy = ((s.y % canvas.height) + canvas.height) % canvas.height;
        const twinkle = 0.5 + 0.5 * Math.sin(Date.now() * 0.001 * s.bright);
        ctx.fillStyle = `rgba(255, 255, 255, ${0.2 + twinkle * 0.3})`;
        ctx.beginPath();
        ctx.arc(sx, sy, s.r, 0, Math.PI * 2);
        ctx.fill();
    }
    if (!running) requestAnimationFrame(drawBackground);
}
drawBackground();
