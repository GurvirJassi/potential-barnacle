"use strict";

/* ---------- 1. Math (grows into vec3/mat4 later) ---------- */
const vec2 = {
  sub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y }),
  add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y }),
};

/* ---------- 2. Scene state: plain data, knows nothing about drawing ---------- */
const scene = {
  nodes: [
    { id: 1, kind: "rect",   x: -200, y: -80, w: 120, h: 80, color: "#4f8cff" },
    { id: 2, kind: "circle", x:  100, y:  40, r: 50,          color: "#ff7a59" },
    { id: 3, kind: "rect",   x:   40, y: -160, w: 80, h: 80,  color: "#5fd38d" },
  ],
  selected: null,
  hover: null,
};

/* ---------- 3. Camera: world <-> screen (a 2D cousin of view/projection) ---------- */
const camera = {
  x: 0, y: 0, zoom: 1,           // x,y = world point at screen centre
  viewport: { w: 1, h: 1 },
  worldToScreen(p) {
    return { x: (p.x - this.x) * this.zoom + this.viewport.w / 2,
             y: (p.y - this.y) * this.zoom + this.viewport.h / 2 };
  },
  screenToWorld(p) {
    return { x: (p.x - this.viewport.w / 2) / this.zoom + this.x,
             y: (p.y - this.viewport.h / 2) / this.zoom + this.y };
  },
  zoomAt(screenPt, factor) {     // keep the point under the cursor fixed
    const before = this.screenToWorld(screenPt);
    this.zoom = Math.min(20, Math.max(0.1, this.zoom * factor));
    const after = this.screenToWorld(screenPt);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
  },
};

/* ---------- 4. Renderer interface (swap for WebGL2 later) ----------
   Contract: begin(camera), line, rect, circle, text, end.
   Scene code never touches ctx directly. */
function createCanvas2DRenderer(canvas) {
  const ctx = canvas.getContext("2d");
  return {
    resize() {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
      camera.viewport.w = canvas.clientWidth;
      camera.viewport.h = canvas.clientHeight;
      this.dpr = dpr;
    },
    begin(cam) {
      this.cam = cam;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const s = this.dpr * cam.zoom;           // world -> device pixels
      ctx.setTransform(s, 0, 0, s,
        (cam.viewport.w / 2 - cam.x * cam.zoom) * this.dpr,
        (cam.viewport.h / 2 - cam.y * cam.zoom) * this.dpr);
    },
    // widths are in screen pixels, so lines stay crisp when zooming
    line(a, b, color, width = 1) {
      ctx.strokeStyle = color; ctx.lineWidth = width / this.cam.zoom;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    },
    rect(x, y, w, h, fill, stroke, sw = 2) {
      ctx.fillStyle = fill; ctx.fillRect(x, y, w, h);
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = sw / this.cam.zoom; ctx.strokeRect(x, y, w, h); }
    },
    circle(x, y, r, fill, stroke, sw = 2) {
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = fill; ctx.fill();
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = sw / this.cam.zoom; ctx.stroke(); }
    },
    text(p, str, color = "#fff") {              // text stays screen-sized
      const s = this.cam.worldToScreen(p);
      ctx.save(); ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.fillStyle = color; ctx.font = "12px sans-serif";
      ctx.fillText(str, s.x, s.y); ctx.restore();
    },
    end() {},
  };
}

/* ---------- 5. Input layer: events -> plain state, consumed once per frame ---------- */
const input = {
  pos: { x: 0, y: 0 }, delta: { x: 0, y: 0 },
  down: false, pressed: false, released: false, wheel: 0,
  endFrame() {
    this.delta.x = this.delta.y = 0;
    this.pressed = this.released = false; this.wheel = 0;
  },
};
function bindInput(canvas) {
  canvas.addEventListener("pointermove", e => {
    input.delta.x += e.offsetX - input.pos.x;
    input.delta.y += e.offsetY - input.pos.y;
    input.pos.x = e.offsetX; input.pos.y = e.offsetY;
  });
  canvas.addEventListener("pointerdown", e => {
    canvas.setPointerCapture(e.pointerId);
    input.pos.x = e.offsetX; input.pos.y = e.offsetY;
    input.down = input.pressed = true;
  });
  canvas.addEventListener("pointerup", () => { input.down = false; input.released = true; });
  canvas.addEventListener("wheel", e => { e.preventDefault(); input.wheel += e.deltaY; }, { passive: false });
}

/* ---------- 6. Hit-testing (becomes ray casting in 3D) ---------- */
function hitTest(n, p) {
  if (n.kind === "rect")   return p.x >= n.x && p.x <= n.x + n.w && p.y >= n.y && p.y <= n.y + n.h;
  if (n.kind === "circle") return Math.hypot(p.x - n.x, p.y - n.y) <= n.r;
  return false;
}
function pick(p) {
  for (let i = scene.nodes.length - 1; i >= 0; i--)   // topmost first
    if (hitTest(scene.nodes[i], p)) return scene.nodes[i];
  return null;
}

/* ---------- 7. Update: input + state -> new state (no drawing here) ---------- */
let drag = null, panning = false;
function update(dt) {
  const world = camera.screenToWorld(input.pos);

  if (input.wheel) camera.zoomAt(input.pos, Math.exp(-input.wheel * 0.001));

  scene.hover = pick(world);

  if (input.pressed) {
    if (scene.hover) {
      scene.selected = scene.hover;
      drag = { node: scene.hover, off: vec2.sub({ x: scene.hover.x, y: scene.hover.y }, world) };
      // bring to front
      scene.nodes.splice(scene.nodes.indexOf(scene.hover), 1);
      scene.nodes.push(scene.hover);
    } else {
      scene.selected = null;
      panning = true;
    }
  }
  if (input.down && drag) {
    drag.node.x = world.x + drag.off.x;
    drag.node.y = world.y + drag.off.y;
  }
  if (input.down && panning) {
    camera.x -= input.delta.x / camera.zoom;
    camera.y -= input.delta.y / camera.zoom;
  }
  if (input.released) { drag = null; panning = false; }
}

/* ---------- 8. Draw: state + camera -> pixels, only via the renderer interface ---------- */
function draw(r) {
  r.begin(camera);

  // grid, only over the visible world rect
  const tl = camera.screenToWorld({ x: 0, y: 0 });
  const br = camera.screenToWorld({ x: camera.viewport.w, y: camera.viewport.h });
  const step = 50;
  for (let x = Math.floor(tl.x / step) * step; x <= br.x; x += step)
    r.line({ x, y: tl.y }, { x, y: br.y }, x === 0 ? "#3a4252" : "#23272f");
  for (let y = Math.floor(tl.y / step) * step; y <= br.y; y += step)
    r.line({ x: tl.x, y }, { x: br.x, y }, y === 0 ? "#3a4252" : "#23272f");

  for (const n of scene.nodes) {
    const stroke = n === scene.selected ? "#ffffff" : n === scene.hover ? "#ffd866" : null;
    if (n.kind === "rect")   r.rect(n.x, n.y, n.w, n.h, n.color, stroke);
    if (n.kind === "circle") r.circle(n.x, n.y, n.r, n.color, stroke);
  }
  for (const n of scene.nodes)
    r.text({ x: n.x, y: n.y - 6 }, "node " + n.id, "#cfd6e1");

  r.end();
}

/* ---------- 9. Main loop ---------- */
const canvas = document.getElementById("c");
const hud = document.getElementById("hud");
const renderer = createCanvas2DRenderer(canvas);
bindInput(canvas);
window.addEventListener("resize", () => renderer.resize());
renderer.resize();

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.1);   // clamp after tab switches
  last = now;
  update(dt);
  draw(renderer);
  hud.textContent = "drag empty space: pan | wheel: zoom | click/drag shapes\n" +
    `zoom ${camera.zoom.toFixed(2)}  cam (${camera.x.toFixed(0)}, ${camera.y.toFixed(0)})`;
  hud.style.whiteSpace = "pre";
  input.endFrame();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
