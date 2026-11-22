// staff-board.js, the staff every Memory game is played on.
//
// One component, three games (Visual / Sequence / Comparison Memory): a
// treble, bass or grand staff divided into COLUMNS (time slots), with notes
// drawn per column. It is both a display (flash a snapshot,
// follow a melody as it plays) and an input surface:
//   "place" , tap/click a spot to put a note there (Visual Memory)
//   "select", tap a column to pick that note (Comparison Memory)
//
// Deliberately NOT js/notation.js's renderNotation: that one folds extreme
// registers into a comfortable window and re-picks clefs from content, which
// is right for display-only reveals but wrong here, in a memory game the
// picture you studied and the surface you answer on have to be the SAME
// picture, pixel for pixel. Staves/clefs are drawn once per layout by
// VexFlow; noteheads, stems, accidentals and ledger lines are individual
// SMuFL glyphs in their own layer, so redraws are cheap (hover previews run
// on every pointermove) and every note can be colored/animated with CSS.
//
// Pitch positions are DIATONIC STEPS ("d"): d = octave * 7 + letterIndex,
// so middle C (C4) = 28, treble top line F5 = 38, bass top line A3 = 26.
// Even d = on a line (ledger lines included), odd d = in a space, and on a
// grand staff that parity stays continuous across middle C.

/* global Vex */

export const LETTERS = ["C", "D", "E", "F", "G", "A", "B"];
const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export const MIDDLE_C_D = 28;

export function isLine(d) {
  return ((d % 2) + 2) % 2 === 0;
}
export function letterOf(d) {
  return LETTERS[((d % 7) + 7) % 7];
}
export function midiOf({ d, alter }) {
  return (Math.floor(d / 7) + 1) * 12 + LETTER_PC[letterOf(d)] + alter;
}
export function spelledOf({ d, alter }) {
  return { letter: letterOf(d), alter, octave: Math.floor(d / 7) };
}
export function pcOf(n) {
  return ((midiOf(n) % 12) + 12) % 12;
}
/** Spell a midi number as a staff position, preferring the key's own
 *  spelling (alterOf: letter → alter from theory.keySpelling); notes outside
 *  the key take the single sharp/flat closest to the key's version of that
 *  letter (ties go to sharps). Returns { d, alter }. */
export function spellMidi(midi, alterOf = {}) {
  const pc = ((midi % 12) + 12) % 12;
  let best = null;
  LETTERS.forEach((L, li) => {
    const keyAlter = alterOf[L] || 0;
    for (const a of [-1, 0, 1]) {
      if ((((LETTER_PC[L] + a) % 12) + 12) % 12 !== pc) continue;
      const cost = a === keyAlter ? 0 : 1 + Math.abs(a) * 0.1 + (a < 0 ? 0.05 : 0);
      if (!best || cost < best.cost) {
        const naturalMidi = midi - a;
        best = { d: (Math.floor(naturalMidi / 12) - 1) * 7 + li, alter: a, cost };
      }
    }
  });
  return { d: best.d, alter: best.alter };
}

const STEP = 5; // one diatonic step = half a staff space (VexFlow's 10-unit spacing)
const GLYPH_PT = 38; // VexFlow's standard notation point size
const HEAD_W = { whole: 16.64, black: 11.63 };
const HEAD_CODE = { whole: "noteheadWhole", black: "noteheadBlack" };
const ACC_GLYPH = { "-1": "accidentalFlat", 0: "accidentalNatural", 1: "accidentalSharp" };
const ACC_W = { "-1": 8.9, 0: 6.6, 1: 9.8 };
const STEM_LEN = 35;
const END_PAD = 12;

// Per layout: where the staves sit, the placeable range (3 ledger lines
// each way), and the total height. T = treble top line y, B = bass top line y.
const LAYOUTS = {
  grand: { T: 40, B: 130, dMin: 12, dMax: 44, H: 212, staveX: 18 },
  treble: { T: 40, dMin: 24, dMax: 44, H: 122, staveX: 8 },
  bass: { B: 40, dMin: 12, dMax: 32, H: 122, staveX: 8 },
};

const SVG_NS = "http://www.w3.org/2000/svg";

/** A standalone engraved accidental (♭ ♮ ♯ from the same SMuFL font the
 *  staff uses) as a small inline SVG, colored by currentColor, for
 *  buttons, where system fonts render these symbols wildly unevenly. */
export function accidentalIcon(alter) {
  const div = document.createElement("div");
  const { Renderer, Glyph } = Vex.Flow;
  const r = new Renderer(div, Renderer.Backends.SVG);
  r.resize(16, 34);
  const ctx = r.getContext();
  Glyph.renderGlyph(ctx, 8 - ACC_W[alter] / 2, 21, GLYPH_PT, ACC_GLYPH[alter]);
  const svg = div.querySelector("svg");
  svg.removeAttribute("width");
  svg.removeAttribute("height");
  svg.removeAttribute("style");
  svg.setAttribute("viewBox", "0 0 16 34");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("vms-acc-icon");
  return svg;
}
function svgEl(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) node.setAttribute(k, attrs[k]);
  return node;
}

/**
 * createStaffBoard(host, options)
 *   layout:   "grand" | "treble" | "bass"
 *   columns:  number of time slots
 *   colWidth: preferred column width (viewBox units)
 *   colMax:   widest a column may stretch to fill minWidth
 *   minWidth: narrowest the drawing gets (viewBox units)
 *   head:     "whole" | "black";  stems: draw stems on single-note columns
 *   guides:   faint column bands (a visible grid of slots)
 *   minScale / maxScale: rendered px per viewBox unit bounds, below
 *             minScale the board scrolls horizontally instead of shrinking.
 *   onPlace(col, d), onHover(pos|null), onSelect(col)
 */
export function createStaffBoard(host, options = {}) {
  const opts = {
    layout: "grand",
    columns: 1,
    colWidth: 44,
    colMax: 72,
    minWidth: 224,
    head: "whole",
    stems: false,
    guides: false,
    minScale: 0.62,
    maxScale: 2.1,
    ...options,
  };

  const wrap = document.createElement("div");
  wrap.className = "vms";
  host.appendChild(wrap);

  let svg = null;
  let geo = null;
  let colLayer, laneLayer, notesLayer, previewLayer;
  let ctx = null;
  let interactive = false; // false | "place" | "select"
  let activeCol = null;
  let committed = [];
  let preview = null; // { col, d, alter }
  let dragging = false;

  function build() {
    const L = LAYOUTS[opts.layout];
    wrap.innerHTML = "";
    const { Renderer, Stave, StaveConnector } = Vex.Flow;
    const renderer = new Renderer(wrap, Renderer.Backends.SVG);

    // Horizontal geometry: clef zone, then N equal columns.
    const n = Math.max(1, opts.columns);
    const probe = new Stave(L.staveX, 0, 200);
    probe.addClef(opts.layout === "bass" ? "bass" : "treble");
    const noteStart = probe.getNoteStartX() + 6;
    let colW = opts.colWidth;
    let W = noteStart + n * colW + END_PAD;
    let offset = 0;
    if (W < opts.minWidth) {
      colW = Math.min(opts.colMax, (opts.minWidth - noteStart - END_PAD) / n);
      W = opts.minWidth;
      offset = (W - noteStart - END_PAD - n * colW) / 2;
    }
    const staveW = W - L.staveX - 4;
    renderer.resize(W, L.H);
    ctx = renderer.getContext();
    svg = wrap.querySelector("svg");
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    svg.removeAttribute("style");
    svg.setAttribute("viewBox", `0 0 ${W} ${L.H}`);
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg.classList.add("vms-svg");
    svg.style.maxWidth = `${Math.round(W * opts.maxScale)}px`;
    svg.style.minWidth = `${Math.round(W * opts.minScale)}px`;

    const staffGroup = ctx.openGroup("vms-staff");
    const staves = {};
    if (opts.layout !== "bass") {
      staves.treble = new Stave(L.staveX, L.T - 40, staveW);
      staves.treble.addClef("treble").setContext(ctx).draw();
    }
    if (opts.layout !== "treble") {
      staves.bass = new Stave(L.staveX, L.B - 40, staveW);
      staves.bass.addClef("bass").setContext(ctx).draw();
    }
    if (opts.layout === "grand") {
      new StaveConnector(staves.treble, staves.bass).setType("brace").setContext(ctx).draw();
      new StaveConnector(staves.treble, staves.bass).setType("singleLeft").setContext(ctx).draw();
    }
    ctx.closeGroup();
    staffGroup.classList.add("vms-staff");

    const top = yOfRaw(L, L.dMax) - 9;
    const bottom = yOfRaw(L, L.dMin) + 9;
    geo = { L, n, colW, noteStart, offset, W, top, bottom };

    colLayer = svgEl("g", { class: "vms-cols" });
    laneLayer = svgEl("g", { class: "vms-lane-layer" });
    notesLayer = svgEl("g", { class: "vms-notes" });
    previewLayer = svgEl("g", { class: "vms-preview" });
    // Column bands sit UNDER the staff lines so the staff stays crisp.
    svg.insertBefore(colLayer, svg.firstChild);
    svg.append(laneLayer, notesLayer, previewLayer);
    drawColumns();
    wrap.classList.toggle("guides", !!opts.guides);
  }

  function yOfRaw(L, d) {
    if (opts.layout === "grand") return d >= MIDDLE_C_D ? L.T + (38 - d) * STEP : L.B + (26 - d) * STEP;
    if (opts.layout === "treble") return L.T + (38 - d) * STEP;
    return L.B + (26 - d) * STEP;
  }
  function yOf(d) {
    return yOfRaw(geo.L, d);
  }
  function dOfY(y) {
    const L = geo.L;
    let d;
    if (opts.layout === "grand") {
      const split = (yOf(MIDDLE_C_D) + yOf(MIDDLE_C_D - 1)) / 2;
      if (y < split) d = Math.max(MIDDLE_C_D, 38 - Math.round((y - L.T) / STEP));
      else d = Math.min(MIDDLE_C_D - 1, 26 - Math.round((y - L.B) / STEP));
    } else if (opts.layout === "treble") d = 38 - Math.round((y - L.T) / STEP);
    else d = 26 - Math.round((y - L.B) / STEP);
    return Math.max(L.dMin, Math.min(L.dMax, d));
  }
  function colCenter(col) {
    return geo.noteStart + geo.offset + geo.colW * (col + 0.5);
  }
  function colOfX(x) {
    const i = Math.floor((x - geo.noteStart - geo.offset) / geo.colW);
    return Math.max(0, Math.min(geo.n - 1, i));
  }
  function staffOf(d) {
    if (opts.layout === "grand") return d >= MIDDLE_C_D ? "treble" : "bass";
    return opts.layout;
  }
  function middleLineD(d) {
    return staffOf(d) === "treble" ? 34 : 22;
  }

  function drawColumns() {
    colLayer.innerHTML = "";
    for (let i = 0; i < geo.n; i++) {
      const x = colCenter(i) - geo.colW / 2;
      colLayer.appendChild(
        svgEl("rect", {
          x: x + 1.5,
          width: geo.colW - 3,
          y: geo.top,
          height: geo.bottom - geo.top,
          rx: 3,
          class: "vms-col" + (i % 2 ? " odd" : "") + (i === activeCol ? " active" : ""),
          "data-col": i,
        })
      );
    }
  }

  function ledgerDs(d) {
    const out = [];
    const tr = staffOf(d) === "treble";
    const topLine = tr ? 38 : 26;
    const bottomLine = tr ? 30 : 18;
    for (let L = topLine + 2; L <= d; L += 2) out.push(L);
    for (let L = bottomLine - 2; L >= d; L -= 2) out.push(L);
    return out;
  }

  function glyph(code, x, y, cls) {
    const g = ctx.openGroup(cls);
    Vex.Flow.Glyph.renderGlyph(ctx, x, y, GLYPH_PT, code);
    ctx.closeGroup();
    return g;
  }

  /** Engraving for one column: a 2nd displaces the upper note to the right
   *  (never two in a row), accidentals stagger leftward so any two within a
   *  6th never collide. */
  function layoutColumn(notes, col) {
    const headW = HEAD_W[opts.head];
    const left = colCenter(col) - headW / 2;
    const sorted = [...notes].sort((a, b) => a.d - b.d);
    let prev = null;
    let prevShifted = false;
    const placed = sorted.map((n) => {
      const shifted = prev !== null && n.d - prev === 1 && !prevShifted;
      prev = n.d;
      prevShifted = shifted;
      return { ...n, x: left + (shifted ? headW - 1 : 0), y: yOf(n.d) };
    });
    const accCols = [];
    placed
      .filter((n) => n.alter || n.forceNatural)
      .sort((a, b) => b.d - a.d)
      .forEach((n) => {
        let c = accCols.findIndex((lastD) => lastD - n.d >= 6);
        if (c === -1) {
          c = accCols.length;
          accCols.push(n.d);
        } else accCols[c] = n.d;
        n.accX = left - 2.5 - ACC_W[n.forceNatural ? 0 : n.alter] - c * 10.5;
      });
    return placed;
  }

  function drawNote(layer, n, { single, extraCls = "" } = {}) {
    const headW = HEAD_W[opts.head];
    const g = svgEl("g", { class: `vms-note ${n.cls || "ink"} ${extraCls}`.trim() });
    ledgerDs(n.d).forEach((Ld) => {
      const y = yOf(Ld);
      g.appendChild(svgEl("line", { x1: n.x - 4.5, x2: n.x + headW + 4.5, y1: y, y2: y, class: "vms-ledger" }));
    });
    if (opts.stems && single && opts.head === "black") {
      const mid = yOf(middleLineD(n.d));
      const up = n.d < middleLineD(n.d);
      const x = up ? n.x + headW - 0.65 : n.x + 0.65;
      const y1 = up ? n.y - 1.5 : n.y + 1.5;
      let y2 = up ? n.y - STEM_LEN : n.y + STEM_LEN;
      // Notes far off the staff stretch their stem to the middle line.
      if (up && y2 > mid) y2 = mid;
      if (!up && y2 < mid) y2 = mid;
      g.appendChild(svgEl("line", { x1: x, x2: x, y1, y2, class: "vms-stem" }));
    }
    g.appendChild(glyph(HEAD_CODE[opts.head], n.x, n.y, "vms-head"));
    if (n.accX !== undefined) g.appendChild(glyph(ACC_GLYPH[n.forceNatural ? 0 : n.alter], n.accX, n.y, "vms-acc"));
    layer.appendChild(g);
    return g;
  }

  /** notes: [{ col, d, alter, cls?, just?, forceNatural? }].
   *  cls ∈ ink | good | bad | missed | ghost | pending | play | sel | dim.
   *  opts.animate: "pop" | "stagger" | undefined. */
  function setNotes(notes, { animate } = {}) {
    committed = notes;
    notesLayer.innerHTML = "";
    const byCol = new Map();
    notes.forEach((n) => {
      const c = n.col || 0;
      if (!byCol.has(c)) byCol.set(c, []);
      byCol.get(c).push(n);
    });
    let i = 0;
    [...byCol.keys()]
      .sort((a, b) => a - b)
      .forEach((c) => {
        const colNotes = byCol.get(c);
        layoutColumn(colNotes, c).forEach((n) => {
          const g = drawNote(notesLayer, n, { single: colNotes.length === 1, extraCls: animate ? "vms-" + animate : "" });
          if (animate === "stagger") g.style.animationDelay = `${i * 40}ms`;
          if (n.just) g.classList.add("vms-just");
          i++;
        });
      });
    if (preview) renderPreview();
    fitHeight(notes);
  }

  // Grow the drawing to fit every note and its ledger lines, so nothing is
  // ever cut off at the top or bottom.
  function fitHeight(notes) {
    if (!svg || !geo) return;
    let y0 = 0;
    let y1 = geo.L.H;
    for (const n of notes) {
      if (typeof n.d !== "number") continue;
      y0 = Math.min(y0, yOf(n.d) - 12);
      y1 = Math.max(y1, yOf(n.d) + 12);
    }
    svg.setAttribute("viewBox", `0 ${y0} ${geo.W} ${y1 - y0}`);
  }

  function renderPreview() {
    previewLayer.innerHTML = "";
    laneLayer.innerHTML = "";
    if (!preview) return;
    const { col, d, alter } = preview;
    const exists = committed.some((n) => (n.col || 0) === col && n.d === d);
    const cx = colCenter(col);
    laneLayer.appendChild(
      svgEl("rect", {
        x: cx - geo.colW / 2 + 1.5,
        width: geo.colW - 3,
        y: yOf(d) - STEP,
        height: STEP * 2,
        rx: 2,
        class: "vms-lane" + (exists ? " remove" : ""),
      })
    );
    if (exists) return;
    const colNotes = committed.filter((n) => (n.col || 0) === col);
    const ghost = layoutColumn([...colNotes, { col, d, alter, cls: "ghost", isPreview: true }], col).find((n) => n.isPreview);
    drawNote(previewLayer, ghost, { single: colNotes.length === 0 });
  }

  function setPreview(col, d, alter = 0) {
    preview = col === null || col === undefined || d === null || d === undefined ? null : { col, d, alter };
    renderPreview();
  }

  function setActiveColumn(col) {
    activeCol = col;
    colLayer.querySelectorAll(".vms-col").forEach((r) => r.classList.toggle("active", Number(r.dataset.col) === col));
  }

  // ---- pointer input (listeners live on the wrapper, which survives rebuilds) ----
  function pointToPos(evt) {
    if (!svg) return null;
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    const m = svg.getScreenCTM();
    if (!m) return null;
    const p = pt.matrixTransform(m.inverse());
    // No fingertip offset: a quick tap must land exactly where it touched.
    // (The lane highlight spans the whole column, so it stays visible
    // around a finger while dragging to adjust.)
    return { col: colOfX(p.x), d: dOfY(p.y) };
  }
  function hoverTo(pos) {
    if (interactive === "place") {
      const same = preview && pos && preview.col === pos.col && preview.d === pos.d;
      if (same) return;
      setPreview(pos ? pos.col : null, pos ? pos.d : null, currentAlter);
      if (opts.onHover) opts.onHover(pos);
    } else if (interactive === "select") {
      if (opts.onHover) opts.onHover(pos);
    }
  }
  let currentAlter = 0;

  wrap.addEventListener("pointerdown", (e) => {
    if (!interactive) return;
    dragging = true;
    try {
      wrap.setPointerCapture(e.pointerId);
    } catch {
      /* not every pointer can be captured */
    }
    hoverTo(pointToPos(e));
    if (e.pointerType !== "mouse") e.preventDefault();
  });
  wrap.addEventListener("pointermove", (e) => {
    if (!interactive) return;
    if (e.pointerType === "touch" && !dragging) return;
    hoverTo(pointToPos(e));
  });
  wrap.addEventListener("pointerup", (e) => {
    if (!interactive || !dragging) return;
    dragging = false;
    const pos = pointToPos(e);
    if (!pos) return;
    if (interactive === "place" && opts.onPlace) opts.onPlace(pos.col, pos.d);
    if (interactive === "select" && opts.onSelect) opts.onSelect(pos.col);
    if (e.pointerType === "touch") {
      setPreview(null);
      if (opts.onHover) opts.onHover(null);
    }
  });
  wrap.addEventListener("pointercancel", () => {
    dragging = false;
  });
  wrap.addEventListener("pointerleave", () => {
    if (dragging || !interactive) return;
    setPreview(null);
    if (opts.onHover) opts.onHover(null);
  });

  build();

  return {
    el: wrap,
    /** Change layout/columns/etc., rebuilds the static staff. */
    configure(next) {
      const changed = Object.keys(next).some((k) => next[k] !== opts[k]);
      Object.assign(opts, next);
      if (changed) {
        activeCol = null;
        preview = null;
        build();
        committed = [];
      }
    },
    setNotes,
    setPreview(col, d, alter) {
      if (alter !== undefined) currentAlter = alter;
      setPreview(col, d, alter === undefined ? currentAlter : alter);
    },
    get preview() {
      return preview;
    },
    setActiveColumn,
    setInteractive(mode) {
      interactive = mode || false;
      wrap.classList.toggle("interactive", !!mode);
      wrap.dataset.mode = mode || "";
      if (!mode) {
        dragging = false;
        setPreview(null);
      }
    },
    /** Keep a column visible when the board is wider than the screen. */
    scrollToColumn(col) {
      if (!svg || wrap.scrollWidth <= wrap.clientWidth) return;
      const frac = colCenter(col) / geo.W;
      const target = frac * wrap.scrollWidth - wrap.clientWidth / 2;
      wrap.scrollTo({ left: Math.max(0, target), behavior: "smooth" });
    },
    get columns() {
      return geo.n;
    },
    get dMin() {
      return geo.L.dMin;
    },
    get dMax() {
      return geo.L.dMax;
    },
  };
}
