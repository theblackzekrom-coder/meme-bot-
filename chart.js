/* chart.js — every chart is hand-drawn on <canvas>, devicePixelRatio aware.
   No chart library (SPEC Step 3/8). */
(function () {
  "use strict";

  function prep(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return null;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }

  var COLORS = {
    green: "#00d35a", red: "#ff453a", orange: "#ff9f0a", blue: "#0a84ff",
    tertiary: "rgba(235,235,245,0.3)", secondary: "rgba(235,235,245,0.6)",
    separator: "rgba(84,84,88,0.55)",
  };

  /* Line chart for Home. points: [{ts, value}], marks: [{ts, kind, label, value}].
     opts: {startValue, progress (0..1 reveal for the slide-in), empty} */
  function drawLine(canvas, points, marks, opts) {
    opts = opts || {};
    var p = prep(canvas);
    if (!p) return;
    var ctx = p.ctx, w = p.w, h = p.h;
    var padL = 4, padR = 4, padT = 26, padB = 8;
    var iw = w - padL - padR, ih = h - padT - padB;
    if (!points || points.length === 0) return;

    var t0 = points[0].ts, t1 = points[points.length - 1].ts;
    if (t1 === t0) t1 = t0 + 1;
    var vals = points.map(function (pt) { return pt.value; });
    if (opts.startValue != null) vals.push(opts.startValue);
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    if (max === min) { max += 1; min -= 1; }
    var pad = (max - min) * 0.12; max += pad; min -= pad;

    function X(ts) { return padL + ((ts - t0) / (t1 - t0)) * iw; }
    function Y(v) { return padT + (1 - (v - min) / (max - min)) * ih; }

    /* dashed start line */
    if (opts.startValue != null) {
      ctx.save();
      ctx.strokeStyle = COLORS.tertiary; ctx.lineWidth = 1; ctx.setLineDash([5, 5]);
      ctx.beginPath(); ctx.moveTo(padL, Y(opts.startValue)); ctx.lineTo(w - padR, Y(opts.startValue)); ctx.stroke();
      ctx.restore();
    }

    var progress = opts.progress == null ? 1 : opts.progress;
    var upto = Math.max(2, Math.ceil(points.length * progress));
    var drawPts = points.slice(0, upto);

    /* gradient fill under the line */
    ctx.beginPath();
    drawPts.forEach(function (pt, i) {
      if (i === 0) ctx.moveTo(X(pt.ts), Y(pt.value)); else ctx.lineTo(X(pt.ts), Y(pt.value));
    });
    var grad = ctx.createLinearGradient(0, padT, 0, h - padB);
    grad.addColorStop(0, "rgba(0,211,90,0.30)");
    grad.addColorStop(1, "rgba(0,211,90,0.0)");
    ctx.save();
    ctx.lineTo(X(drawPts[drawPts.length - 1].ts), h - padB);
    ctx.lineTo(X(drawPts[0].ts), h - padB);
    ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
    ctx.restore();

    /* the line */
    ctx.beginPath();
    drawPts.forEach(function (pt, i) {
      if (i === 0) ctx.moveTo(X(pt.ts), Y(pt.value)); else ctx.lineTo(X(pt.ts), Y(pt.value));
    });
    ctx.strokeStyle = COLORS.green; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.stroke();

    /* last point dot */
    var last = drawPts[drawPts.length - 1];
    ctx.beginPath(); ctx.arc(X(last.ts), Y(last.value), 3.5, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.green; ctx.fill();

    /* marks above the line; later marks move up a row so labels never overlap */
    if (marks && marks.length) {
      ctx.font = "600 11px -apple-system, system-ui, sans-serif";
      ctx.textAlign = "center";
      var placed = [];
      marks.forEach(function (m) {
        if (m.ts < t0 || m.ts > t1) return;
        /* balance value at the mark's time (nearest point) */
        var v = points[0].value;
        for (var i = 0; i < points.length; i++) { if (points[i].ts <= m.ts) v = points[i].value; else break; }
        var x = Math.max(34, Math.min(w - 34, X(m.ts)));
        var level = 0;
        placed.forEach(function (pl) { if (Math.abs(pl.x - x) < 76 && pl.level === level) level++; });
        placed.push({ x: x, level: level });
        var y = Y(v) - 12 - level * 15;
        var color = m.kind === "bought" || m.kind === "buy" ? COLORS.blue
          : m.kind === "stopped" || m.kind === "exit" ? COLORS.red : COLORS.green;
        ctx.beginPath(); ctx.arc(X(m.ts), Y(v), 3, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
        ctx.fillStyle = color;
        var label = m.kind === "bought" || m.kind === "buy" ? (m.label || "Bought")
          : (m.value || m.label || "");
        ctx.fillText(label, x, Math.max(10, y));
      });
    }
  }

  /* Candles for the Coin screen. candles: [{ts,o,h,l,c,v}].
     opts: {exitLine: {value,label} | null} */
  function drawCandles(canvas, candles, opts) {
    opts = opts || {};
    var p = prep(canvas);
    if (!p) return;
    var ctx = p.ctx, w = p.w, h = p.h;
    if (!candles || candles.length === 0) {
      ctx.fillStyle = COLORS.secondary;
      ctx.font = "14px -apple-system, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("No price history yet", w / 2, h / 2);
      return;
    }
    var volH = Math.round(h * 0.18), priceH = h - volH - 14;
    var padR = 4, padL = 4;
    var max = -Infinity, min = Infinity, vmax = 0;
    candles.forEach(function (c) { max = Math.max(max, c.h); min = Math.min(min, c.l); vmax = Math.max(vmax, c.v || 0); });
    if (opts.exitLine && opts.exitLine.value) { max = Math.max(max, opts.exitLine.value); min = Math.min(min, opts.exitLine.value); }
    if (max === min) { max += 1; min -= 1; }
    var pad = (max - min) * 0.08; max += pad; min -= pad;
    function Y(v) { return 6 + (1 - (v - min) / (max - min)) * (priceH - 12); }
    var slot = (w - padL - padR) / candles.length;
    var bw = Math.max(1.5, slot * 0.62);

    candles.forEach(function (c, i) {
      var cx = padL + slot * i + slot / 2;
      var up = c.c >= c.o;
      var color = up ? COLORS.green : COLORS.red;
      ctx.strokeStyle = color; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx, Y(c.h)); ctx.lineTo(cx, Y(c.l)); ctx.stroke();
      ctx.fillStyle = color;
      var yo = Y(c.o), yc = Y(c.c);
      ctx.fillRect(cx - bw / 2, Math.min(yo, yc), bw, Math.max(1.5, Math.abs(yc - yo)));
      if (vmax > 0 && c.v) {
        var vh = (c.v / vmax) * (volH - 4);
        ctx.globalAlpha = 0.55;
        ctx.fillRect(cx - bw / 2, h - vh, bw, vh);
        ctx.globalAlpha = 1;
      }
    });

    if (opts.exitLine && opts.exitLine.value) {
      var y = Y(opts.exitLine.value);
      ctx.save();
      ctx.strokeStyle = COLORS.orange; ctx.lineWidth = 1.4; ctx.setLineDash([6, 5]);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = COLORS.orange;
      ctx.font = "600 11px -apple-system, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(opts.exitLine.label || "Risk trailing stop", padL + 2, Math.max(10, y - 5));
    }
  }

  /* Analyst score ring. score 0..100 or null. Green from 70 (SPEC Step 8). */
  function drawRing(canvas, score) {
    var p = prep(canvas);
    if (!p) return;
    var ctx = p.ctx, w = p.w, h = p.h;
    var cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 7;
    ctx.lineWidth = 9; ctx.lineCap = "round";
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = "#2c2c2e"; ctx.stroke();
    if (score == null) return;
    var frac = Math.max(0, Math.min(1, score / 100));
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
    ctx.strokeStyle = score >= 70 ? COLORS.green : "#ffd60a";
    ctx.stroke();
  }

  window.DeskCharts = { drawLine: drawLine, drawCandles: drawCandles, drawRing: drawRing };
})();
