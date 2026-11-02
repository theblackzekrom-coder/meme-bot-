/* app.js — Grok Bot desk, plan B (SPEC Steps 3B/7/8).
   Polls state/chart/activity (+ agents/account/coin/audit JSON the desk
   writer publishes) under the secret data path. The path itself arrives
   once in the #d= fragment, lives in localStorage, and is stripped from
   the address bar. No keys or tokens exist in this app. */
(function () {
  "use strict";

  /* ---------- data path (secret, fragment -> localStorage) ---------- */
  (function capturePath() {
    var m = location.hash.match(/#d=([A-Za-z0-9_-]+)/);
    if (m) {
      localStorage.setItem("desk_dp", m[1]);
      history.replaceState(null, "", location.pathname + location.search);
    }
  })();
  var DP = localStorage.getItem("desk_dp");
  var BASE = DP ? "d/" + DP + "/" : null;

  var SIGNUP_URL = "https://fomo.family/r/savipww";
  var CHAIN_ID_SOLANA = 1399811149;
  function coinUrl(mint) {
    /* same string links.py builds (SPEC Step 6) */
    return "https://fomo.family/coin?address=" + mint + "&chainId=" +
      CHAIN_ID_SOLANA + "&r=savipww&source=share_link";
  }
  function profileUrl(handle) {
    return "https://fomo.family/profile/" + String(handle || "").replace(/^@/, "") +
      "?source=share_link&r=savipww";
  }

  var REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var AGENTS = ["scanner", "auditor", "analyst", "executor", "risk"];
  var AGENT_COLORS = { scanner: "#64d2ff", auditor: "#fff", analyst: "#ffd60a", executor: "#00d35a", risk: "#ff6b9a" };

  var S = {
    state: null, chart: null, activity: null, agents: null, account: null,
    lastOk: 0, failures: 0, range: "LIVE", tab: "home",
    coin: null, coinMint: null, auditorMint: null,
    seenSignals: {}, chartAnim: null, lastChartTs: 0,
  };

  /* ---------- formatting ---------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmtMoney(v, digits) {
    if (v == null || isNaN(v)) return "—";
    return "$" + Number(v).toLocaleString("en-US", {
      minimumFractionDigits: digits == null ? 2 : digits,
      maximumFractionDigits: digits == null ? 2 : digits });
  }
  function fmtPrice(v) {
    if (v == null || isNaN(v)) return "—";
    var p = Number(v);
    if (p >= 1) return "$" + p.toFixed(2);
    if (p >= 0.01) return "$" + p.toFixed(4);
    return "$" + parseFloat(p.toPrecision(3)).toString();
  }
  function fmtPct(v, signed) {
    if (v == null || isNaN(v)) return "—";
    var n = Number(v);
    return (signed && n > 0 ? "+" : "") + n.toFixed(2) + "%";
  }
  function fmtTime(ts) {
    if (!ts) return "";
    return new Date(ts * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  function fmtAge(s) {
    if (s == null) return "";
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + "m old";
    if (s < 86400) return Math.round(s / 360) / 10 + "h old";
    return Math.round(s / 8640) / 10 + "d old";
  }
  function fmtDur(s) {
    if (s == null) return "—";
    if (s <= 0) return "0m";
    var h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
    return h > 0 ? h + "h " + m + "m" : m + "m";
  }
  function shortMint(m) { return m ? m.slice(0, 4) + "…" + m.slice(-4) : ""; }
  function toast(msg) {
    var t = $("toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(t._h); t._h = setTimeout(function () { t.hidden = true; }, 2200);
  }

  /* ---------- fetching ---------- */
  function fetchJson(path, optional) {
    return fetch(BASE + path, { cache: "no-store" }).then(function (r) {
      if (!r.ok) { if (optional) return null; throw new Error("HTTP " + r.status); }
      return r.json();
    }).catch(function (e) { if (optional) return null; throw e; });
  }

  function poll() {
    if (!BASE) { renderNoKey(); return; }
    var jobs = [
      fetchJson("state.json"), fetchJson("chart.json"), fetchJson("activity.json"),
      fetchJson("agents.json", true), fetchJson("account.json", true),
    ];
    Promise.all(jobs).then(function (res) {
      S.state = res[0]; S.chart = res[1]; S.activity = res[2];
      if (res[3]) S.agents = res[3];
      if (res[4]) S.account = res[4];
      S.lastOk = Date.now(); S.failures = 0;
      $("offlineBar").hidden = true;
      indexCoins();
      render();
      refreshOpenScreens();
    }).catch(function () {
      S.failures++;
      showOffline();
    });
  }

  function showOffline() {
    var bar = $("offlineBar");
    var last = S.lastOk ? new Date(S.lastOk).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" }) : "never";
    bar.textContent = "Desk offline · retrying in 15s · last update " + last;
    bar.hidden = false;
  }

  function renderNoKey() {
    $("updatedAt").innerHTML = '<span style="color:#ff453a">No desk key in this browser yet — open the full link Castiel sent you (the one with #d= in it) once.</span>';
  }

  /* ---------- coin index (search + names) ---------- */
  var coinIndex = new Map();
  function indexCoins() {
    function add(mint, name, symbol) {
      if (!mint) return;
      var cur = coinIndex.get(mint) || {};
      if (name) cur.name = name;
      if (symbol) cur.symbol = symbol;
      cur.mint = mint;
      coinIndex.set(mint, cur);
    }
    (S.activity ? S.activity.rows : []).forEach(function (r) {
      add(r.mint, nameFromTitle(r.title), null);
    });
    if (S.agents) {
      AGENTS.forEach(function (a) {
        ((S.agents.agents[a] || {}).decisions || []).forEach(function (d) { add(d.mint, d.name, d.symbol); });
      });
    }
    if (S.coin && S.coinMint) add(S.coinMint, S.coin.name, S.coin.symbol);
  }
  function nameFromTitle(title) {
    if (!title) return null;
    var t = title.replace(/^(Bought|Sold|Stopped|Rejected|Skipped|Sell|Passed|Clean)\s+/i, "").trim();
    return t || null;
  }
  function coinName(mint, fallback) {
    var c = coinIndex.get(mint);
    return (c && c.name) || fallback || shortMint(mint);
  }

  /* ---------- odometer ---------- */
  function setOdometer(el, text) {
    if (REDUCED || !el.dataset.odo) {
      el.textContent = text;
      el.dataset.odo = "1";
      el.dataset.text = text;
      return;
    }
    var old = el.dataset.text || "";
    if (old === text) return;
    el.dataset.text = text;
    el.innerHTML = "";
    var n = text.length;
    for (var i = 0; i < n; i++) {
      var ch = text[i];
      if (/\d/.test(ch)) {
        var col = document.createElement("span"); col.className = "odo-col";
        var strip = document.createElement("span"); strip.className = "odo-strip";
        for (var d = 0; d <= 9; d++) {
          var s = document.createElement("span"); s.textContent = d; strip.appendChild(s);
        }
        strip.style.transitionDelay = ((n - 1 - i) * 30) + "ms";
        col.appendChild(strip); el.appendChild(col);
        (function (stripEl, digit) {
          requestAnimationFrame(function () {
            stripEl.style.transform = "translateY(-" + digit + "em)";
          });
        })(strip, +ch);
      } else {
        var st = document.createElement("span"); st.className = "odo-static"; st.textContent = ch;
        el.appendChild(st);
      }
    }
  }

  /* ---------- status helpers ---------- */
  function agentState(name) {
    if (!S.state) return { status: "down", age: null };
    var a = S.state.agents.find(function (x) { return x.name === name; });
    if (!a) return { status: "down", age: null };
    var age = a.heartbeat_age_s;
    var status = a.status;
    if (age != null && age > 120) status = "down"; /* stale heartbeat wins */
    return { status: status, age: age };
  }
  function dotClass(status) { return status === "running" ? "" : status === "paused" ? " paused" : " down"; }

  function settingsVal(key, fallback) {
    if (S.agents && S.agents.settings && S.agents.settings[key] != null) return S.agents.settings[key];
    if (S.account && S.account.settings && S.account.settings[key]) return S.account.settings[key].value;
    return fallback;
  }

  /* ---------- activity rows ---------- */
  function actIcon(row) {
    if (row.kind === "buy") return { t: "B", c: "#00d35a" };
    if (row.kind === "exit") return { t: row.title.indexOf("Sold") === 0 ? "S" : "!", c: row.title.indexOf("Sold") === 0 ? "#00d35a" : "#ff453a" };
    if (row.kind === "reject") return { t: "✕", c: "#ff453a" };
    if (row.kind === "skip") return { t: "–", c: "rgba(235,235,245,0.3)" };
    if (row.kind === "audit") return { t: "✓", c: "#64d2ff" };
    if (row.kind === "scan") return { t: "◎", c: "#64d2ff" };
    return { t: "·", c: "rgba(235,235,245,0.6)" };
  }
  function actValueClass(row) {
    var v = row.value || "";
    if (row.kind === "reject" || row.kind === "skip") return "skip";
    if (/^\+/.test(v)) return "pos";
    if (/^-/.test(v)) return "neg";
    return "";
  }
  function activityRow(row) {
    var ic = actIcon(row);
    var name = coinName(row.mint, nameFromTitle(row.title));
    var sub = esc(row.subtitle || row.agent || "");
    var agentLabel = row.agent ? row.agent[0].toUpperCase() + row.agent.slice(1) : "";
    if (sub && agentLabel && sub.indexOf(agentLabel) !== 0) sub = agentLabel + " · " + sub;
    else if (!sub) sub = agentLabel;
    sub += (sub ? " · " : "") + fmtTime(row.ts);
    return '<button class="activity-row" data-mint="' + esc(row.mint || "") + '" data-kind="' + esc(row.kind || "") + '">' +
      '<span class="act-ic" style="color:' + ic.c + '">' + ic.t + "</span>" +
      '<span class="act-main"><span class="act-title">' + esc(row.title || name) + "</span>" +
      '<span class="act-sub" style="display:block">' + sub + "</span></span>" +
      '<span class="act-value ' + actValueClass(row) + '">' + esc(row.value || "") + "</span></button>";
  }

  /* ---------- agent cards ---------- */
  function feedRows(items) {
    if (!items || !items.length) return '<div class="rowline"><span style="color:var(--tertiary)">Nothing yet tonight</span></div>';
    return items.slice(0, 4).map(function (d) {
      var name = esc(coinName(d.mint, d.name));
      if (d.verdict === "kill") {
        return '<div class="rowline killed"><span class="nm">' + name + '</span><span class="r reason">' + esc(d.reason || "") + "</span></div>";
      }
      if (d.verdict === "pass") {
        return '<div class="rowline"><span>' + name + '</span><span class="r pass">→ auditor</span></div>';
      }
      var verdict = esc(d.verdict || "");
      var reason = d.reason ? '<span class="d-reason" style="color:var(--secondary)">' + esc(d.reason) + "</span>" : "";
      return '<div class="rowline"><span>' + name + '</span><span class="r">' + verdict + reason + "</span></div>";
    }).join("");
  }

  function agentCard(name, full) {
    var st = agentState(name);
    var data = S.agents ? (S.agents.agents[name] || {}) : {};
    var fallbackCount = (S.activity ? S.activity.rows : []).filter(function (r) { return r.agent === name; }).length;
    var count = data.count_today != null ? data.count_today : fallbackCount;
    var head = '<div class="ac-head"><span class="status-dot' + dotClass(st.status) + '"></span>' +
      '<span class="ac-name" style="color:' + AGENT_COLORS[name] + '">' + name + "</span>" +
      '<span class="ac-status">' + esc(st.status) + (st.age != null ? " · " + Math.round(st.age) + "s" : "") + "</span></div>";
    var body = "";

    if (name === "scanner") {
      body = '<div class="ac-big">' + count + ' <span style="font-size:20px;color:var(--secondary)">pools</span></div>' +
        '<div class="ac-sub">Listening for graduations</div>' +
        '<div class="ac-body"><div class="ac-feed">' + feedRows(data.decisions) + "</div></div>";
    } else if (name === "auditor") {
      var latest = data.latest;
      var strips = "";
      var layers = latest && latest.layers ? latest.layers : [];
      for (var i = 0; i < 8; i++) {
        var l = layers[i];
        var cls = !l || l.pass == null ? "" : l.pass ? " ok" : " bad";
        var mark = !l || l.pass == null ? (i + 1) : l.pass ? "✓" : "✕";
        strips += '<span class="layer-strip' + cls + '">' + mark + "</span>";
      }
      var statusLine = !latest ? "No coin taken apart yet"
        : latest.passed ? "8/8 → Executor" : esc(latest.reason || "Rejected");
      body = '<div class="ac-big">' + count + ' <span style="font-size:20px;color:var(--secondary)">taken apart</span></div>' +
        '<div class="ac-sub">' + statusLine + " · " + (data.rejected_today || 0) + ' rejected</div>' +
        '<div class="ac-body"><div class="layer-strips">' + strips + "</div></div>";
    } else if (name === "analyst") {
      var lv = data.latest;
      var lines = lv ? ["alive_6h", "organic", "flush", "chase"].map(function (k) {
        return "<span>" + k + " <b>" + (lv[k] == null ? "—" : Number(lv[k]).toFixed(2)) + "</b></span>";
      }).join("") : '<span style="color:var(--tertiary)">No verdicts yet</span>';
      body = '<div class="ac-big">Scoring</div>' +
        '<div class="ac-body"><div class="score-wrap"><div class="score-ring-box">' +
        '<canvas class="score-ring" data-score="' + (lv && lv.score != null ? lv.score : "") + '"></canvas>' +
        '<div class="score-center"><b>' + (lv && lv.score != null ? Math.round(lv.score) : "—") + '</b><span>score</span></div></div>' +
        '<div class="score-lines">' + lines + "</div></div></div>";
    } else if (name === "executor") {
      var sig = data.latest;
      var seen = sig && S.seenSignals[sig.id];
      if (sig && !seen) S.seenSignals[sig.id] = Date.now();
      var fresh = sig && (Date.now() - (S.seenSignals[sig.id] || 0) < 4000);
      var big = sig ? fmtMoney(sig.size_usd) + ' <span style="font-size:20px;color:var(--secondary)">· ' + sig.stack_pct + '% of stack</span>' : "No trades yet";
      var bar = sig ? '<div class="exec-bar"><i style="width:' + (sig.status === "bought" ? 100 : 35) + '%"></i></div>' +
        '<div class="ac-sub">' + (sig.status === "bought" ? (fresh && !REDUCED ? "Executing… → ✓ Filled" : "✓ Filled") : esc(sig.status)) + "</div>" : "";
      body = '<div class="ac-big" style="font-size:32px">' + big + '</div>' +
        '<div class="ac-sub">' + count + ' trades</div><div class="ac-body">' + bar + "</div>";
    } else if (name === "risk") {
      var open = data.open_count || 0;
      var le = data.latest_exit;
      var bigR = open > 0 ? "Guarding" : le ? (le.exit_reason === "trail" ? "Trailed out" : le.exit_reason === "stop" ? "Stopped" : "Last exit") : "Guarding";
      var subR = open > 0 ? open + " position" + (open > 1 ? "s" : "") + " open"
        : le ? (le.pnl_usd != null ? (le.pnl_usd >= 0 ? "+" : "−") + "$" + Math.abs(le.pnl_usd).toFixed(2) + " · " + esc(le.exit_reason || "") : "")
        : "No open positions";
      var stopPct = settingsVal("risk.stop_pct", 6), trailPct = settingsVal("risk.trail_pct", 12);
      body = '<div class="ac-big">' + bigR + '</div><div class="ac-sub">' + subR + '</div>' +
        '<div class="ac-body"><div class="pills"><span class="pill red">stop -' + stopPct + '%</span>' +
        '<span class="pill green">trail ' + trailPct + '%</span></div></div>';
    }

    if (!full) {
      return '<article class="agent-card" data-agent="' + name + '">' + head + body + "</article>";
    }
    /* full card: decisions + pause switch (read-only in plan B) + settings shortcut */
    var decisions = (data.decisions || []).slice(0, 20);
    var decHtml;
    if (decisions.length) {
      decHtml = decisions.map(function (d) {
        return '<div class="decision-row"><time>' + fmtTime(d.ts) + '</time>' +
          '<button class="d-name" data-mint="' + esc(d.mint || "") + '" style="text-align:left">' + esc(coinName(d.mint, d.name)) + "</button>" +
          '<span class="d-verdict">' + esc(d.verdict || "") +
          (d.reason ? '<span class="d-reason">' + esc(d.reason) + "</span>" : "") + "</span></div>";
      }).join("");
    } else {
      var rows = (S.activity ? S.activity.rows : []).filter(function (r) { return r.agent === name; });
      decHtml = rows.length ? rows.map(function (r) {
        return '<div class="decision-row"><time>' + fmtTime(r.ts) + '</time>' +
          '<button class="d-name" data-mint="' + esc(r.mint || "") + '" style="text-align:left">' + esc(nameFromTitle(r.title) || "") + "</button>" +
          '<span class="d-verdict">' + esc(r.kind) +
          '<span class="d-reason">' + esc(r.value || r.subtitle || "") + "</span></span></div>";
      }).join("") : '<div class="empty-box">No decisions yet tonight</div>';
    }
    var paused = st.status === "paused";
    var locked = name === "risk" && (data.open_count || 0) > 0;
    return '<article class="agent-full" data-agent="' + name + '">' + head + body +
      '<div class="switch-row"><span class="switch' + (paused ? "" : " on") + '" aria-hidden="true"></span>' +
      '<span class="switch-note">' + (locked ? "Risk is locked while a position is open. " : "") +
      'Pause/resume runs through Telegram in plan B — send "pause ' + name + '".</span></div>' +
      '<div class="decisions">' + decHtml + "</div>" +
      '<button class="shortcut-btn" data-goto-settings="' + name + '">Settings · ' + name + " ›</button></article>";
  }

  function drawRings(root) {
    (root || document).querySelectorAll("canvas.score-ring").forEach(function (cv) {
      var v = cv.getAttribute("data-score");
      DeskCharts.drawRing(cv, v === "" || v == null ? null : Number(v));
    });
  }

  /* ---------- home chart ---------- */
  var RANGE_S = { "1H": 3600, "4H": 14400, "1D": 86400, "1W": 604800 };
  function drawHomeChart(animate) {
    var cv = $("homeChart");
    if (!S.chart || !S.chart.points || !S.chart.points.length) {
      $("chartEmpty").hidden = false;
      var p0 = prepEmpty(cv); return;
    }
    var pts = S.chart.points;
    var lastTs = pts[pts.length - 1].ts;
    var range = S.range;
    var filtered = pts;
    if (RANGE_S[range]) filtered = pts.filter(function (p) { return p.ts >= lastTs - RANGE_S[range]; });
    if (filtered.length < 2) { $("chartEmpty").hidden = pts.length < 2; }
    else $("chartEmpty").hidden = true;
    var marks = (S.chart.marks || []).filter(function (m) {
      return !RANGE_S[range] || m.ts >= lastTs - RANGE_S[range];
    });
    var startValue = pts[0].value;
    function draw(progress) {
      DeskCharts.drawLine(cv, filtered, marks, { startValue: startValue, progress: progress });
    }
    if (animate && !REDUCED && filtered.length > 2) {
      var t0 = performance.now();
      (function step(t) {
        var f = Math.min(1, (t - t0) / 250);
        draw(((filtered.length - 1) + f) / filtered.length);
        if (f < 1) requestAnimationFrame(step);
      })(t0);
    } else draw(1);
  }
  function prepEmpty(cv) {
    var ctx = cv.getContext("2d"); if (ctx) ctx.clearRect(0, 0, cv.width, cv.height);
  }

  /* ---------- renders ---------- */
  function render() {
    if (!S.state) return;
    /* balance */
    setOdometer($("balanceValue"), fmtMoney(S.state.balance, 2).replace("$", "$"));
    $("paperBadge").hidden = S.state.mode !== "PAPER";
    var tp = $("todayPct");
    tp.textContent = fmtPct(S.state.today_pct, true) + " today";
    tp.className = "today-pct " + (S.state.today_pct >= 0 ? "pos" : "neg");
    var mp = $("multiplierPill");
    mp.hidden = false;
    mp.textContent = Number(S.state.multiplier).toFixed(2) + "×";
    mp.className = "mult-pill" + (S.state.multiplier >= 1 ? "" : " neg");
    $("updatedAt").textContent = "updated " + fmtTime(S.state.ts);

    var running = S.state.agents.filter(function (a) { return agentState(a.name).status === "running"; }).length;
    $("agentsRunning").textContent = "· " + running + " running";

    /* bell: unread pushes */
    var rows = S.activity ? S.activity.rows : [];
    var maxId = rows.reduce(function (m, r) { return Math.max(m, r.id || 0); }, 0);
    var seenAct = Number(localStorage.getItem("desk_seen_act") || 0);
    if (!localStorage.getItem("desk_seen_act")) { localStorage.setItem("desk_seen_act", maxId); seenAct = maxId; }
    $("bellDot").hidden = !(maxId > seenAct);

    $("agentCarousel").innerHTML = AGENTS.map(function (a) { return agentCard(a, false); }).join("");
    $("agentStack").innerHTML = AGENTS.map(function (a) { return agentCard(a, true); }).join("");
    drawRings(document);

    var actHtml = rows.length ? rows.map(activityRow).join("") : '<div class="empty-box">Nothing yet tonight</div>';
    $("activityList").innerHTML = actHtml;
    $("homeActivity").innerHTML = rows.length ? rows.slice(0, 5).map(activityRow).join("") : '<div class="empty-box">Nothing yet tonight</div>';

    var newLast = S.chart && S.chart.points.length ? S.chart.points[S.chart.points.length - 1].ts : 0;
    var animate = newLast > S.lastChartTs && S.lastChartTs !== 0;
    S.lastChartTs = newLast;
    drawHomeChart(animate);
    renderAccount();
  }

  /* ---------- account (read-only, plan B) ---------- */
  var GROUP_TITLES = { scanner: "Scanner", auditor: "Auditor", analyst: "Analyst", executor: "Executor", risk: "Risk", desk: "Desk" };
  function prettyKey(key) {
    var s = key.split(".").slice(1).join(".").replace(/_/g, " ");
    return s.replace(/\bh1\b/g, "1h").replace(/\b6h\b/g, "6h");
  }
  function fmtSetting(v, kind) {
    if (kind === "bool") return v ? "On" : "Off";
    if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000);
    return String(v);
  }
  function renderAccount() {
    var body = $("accountBody");
    var mode = S.account ? S.account.mode : (S.state ? S.state.mode : "PAPER");
    var seg = '<span class="' + (mode === "PAPER" ? "sel-paper" : "") + '">PAPER</span><span class="' + (mode === "LIVE" ? "sel-live" : "") + '">LIVE</span>';
    var html = "";
    if (S.account && S.account.ticket_warning) {
      html += '<div class="warn-box">Ticket check: ' + esc(S.account.ticket_warning) + "</div>";
    }
    html += '<div class="acct-card">' +
      '<div class="acct-row"><span class="r-label">Mode</span><span class="mode-seg">' + seg + "</span></div>" +
      '<div class="acct-row"><span class="r-label">Stack<span class="r-sub">current balance the desk sizes from</span></span>' +
      '<span class="r-value">' + fmtMoney(S.account ? S.account.stack : (S.state ? S.state.balance : null)) + "</span></div>";
    if (S.account) {
      html += '<div class="acct-row"><span class="r-label">Paper start stack</span><span class="r-value">' + fmtMoney(S.account.paper_start_stack) + "</span></div>" +
        '<div class="acct-row"><span class="r-label">Live stack</span><span class="r-value">' + fmtMoney(S.account.stack_live) + "</span></div>";
    }
    html += "</div>";

    html += '<div class="acct-card">';
    if (S.account && S.account.profile_url) {
      html += '<a class="acct-row" href="' + esc(S.account.profile_url) + '" target="_blank" rel="noopener"><span class="r-label">Your FOMO profile<span class="r-sub">@' + esc(S.account.fomo_handle || "") + '</span></span><span class="r-value">Open ›</span></a>';
    }
    html += '<button class="acct-row" id="inviteBtn" style="width:100%;text-align:left"><span class="r-label">Invite a friend<span class="r-sub">Share your FOMO referral link</span></span><span class="r-value">Share ›</span></button>' +
      '<div class="acct-row"><span class="r-label">Telegram<span class="r-sub">Pushes and commands run through the bot</span></span><span class="r-value">' +
      (S.account ? esc(S.account.notifier || "telegram") : "telegram") + "</span></div>" +
      '<div class="acct-row"><span class="r-label">Notifications<span class="r-sub">Web push is unavailable in plan B — Telegram carries pushes</span></span><span class="r-value">Telegram</span></div>' +
      '<div class="acct-row"><span class="r-label">Send test push<span class="r-sub">Not available from the app in plan B</span></span><span class="r-value">—</span></div>' +
      "</div>";

    html += '<p class="readonly-note">Account is read-only in plan B. Change anything through Telegram commands — e.g. "set stop to -8%", "stack 50", "pause scanner", "paper" / "live".</p>';

    if (S.account && S.account.settings) {
      var groups = {};
      Object.keys(S.account.settings).forEach(function (k) {
        var g = k.split(".")[0];
        (groups[g] = groups[g] || []).push(k);
      });
      ["scanner", "auditor", "analyst", "executor", "risk", "desk"].forEach(function (g) {
        if (!groups[g]) return;
        html += '<h3 class="acct-group-title" id="settings-' + g + '">' + (GROUP_TITLES[g] || g) + '</h3><div class="acct-card">';
        groups[g].sort().forEach(function (k) {
          var s = S.account.settings[k];
          var range = (s.min != null && s.max != null) ? '<span class="r-sub">' + s.min + " – " + s.max + "</span>" : "";
          html += '<div class="acct-row"><span class="r-label">' + esc(prettyKey(k)) + range + '</span>' +
            '<span class="r-value mono">' + esc(fmtSetting(s.value, s.kind)) + "</span></div>";
        });
        html += "</div>";
      });
    } else {
      html += '<p class="readonly-note">Settings publish with the desk writer\'s next cycle. Until then they are visible and changeable through Telegram only.</p>';
    }
    body.innerHTML = html;
    var inv = $("inviteBtn");
    if (inv) inv.addEventListener("click", shareInvite);
  }

  function shareInvite() {
    var url = (S.account && S.account.signup_url) || SIGNUP_URL;
    if (navigator.share) {
      navigator.share({ title: "FOMO", url: url }).catch(function () {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(function () { toast("Link copied"); });
    } else { toast(url); }
  }

  /* ---------- coin screen ---------- */
  function openScreen(id) { $(id).hidden = false; $(id).scrollTop = 0; document.body.style.overflow = "hidden"; }
  function closeScreens() {
    ["coinScreen", "auditorScreen", "searchScreen"].forEach(function (id) { $(id).hidden = true; });
    document.body.style.overflow = "";
    S.coinMint = null; S.auditorMint = null;
  }

  function openCoin(mint, seedTitle) {
    if (!mint) return;
    S.coinMint = mint;
    openScreen("coinScreen");
    $("coinBody").innerHTML = '<div class="skel" style="height:120px;margin-top:16px"></div><div class="skel" style="height:230px;margin-top:14px"></div>';
    loadCoin(mint, seedTitle);
  }

  function loadCoin(mint, seedTitle) {
    if (!BASE) return;
    fetchJson("coin/" + mint + ".json", true).then(function (c) {
      if (S.coinMint !== mint) return;
      if (!c) { renderCoinFallback(mint, seedTitle); return; }
      S.coin = c; indexCoins();
      renderCoin(c);
    });
  }

  function renderCoinFallback(mint, seedTitle) {
    var name = coinName(mint, nameFromTitle(seedTitle));
    var mode = S.state ? S.state.mode : "PAPER";
    $("coinPaperBadge").hidden = mode !== "PAPER";
    $("coinBody").innerHTML =
      '<div class="coin-name">' + esc(name) + '</div>' +
      '<div class="coin-sub">' + esc(shortMint(mint)) + ' · Solana</div>' +
      '<div class="coin-price">—</div>' +
      '<p class="readonly-note" style="margin-top:14px">Live detail for this coin has not been published yet — price and stats show once the desk writer reaches it. Nothing here is estimated.</p>' +
      '<a class="big-action" href="' + coinUrl(mint) + '" target="_blank" rel="noopener">Buy on FOMO</a>' +
      '<div class="fomo-note">Opens the coin in FOMO with your referral link.</div>';
  }

  function renderCoin(c) {
    var mode = c.mode || (S.state ? S.state.mode : "PAPER");
    $("coinPaperBadge").hidden = mode !== "PAPER";
    var name = c.name || coinName(c.mint) || shortMint(c.mint);
    var audit = c.audit || {};
    var chip = audit.passed ? '<span class="shield-chip">🛡 8/8</span>'
      : audit.layers_checked ? '<span class="shield-chip bad">' + audit.layers_checked + '/8 · rejected</span>'
      : '<span class="shield-chip mid">Not audited yet</span>';
    var pct = c.position && c.position.pct_since_entry != null ? c.position.pct_since_entry
      : (c.candles && c.candles.length > 1 ? 100 * (c.candles[c.candles.length - 1].c / c.candles[0].o - 1) : null);
    var pos = c.position;
    var open = pos && (pos.status === "open" || pos.status === "exiting");
    var html = '<div class="coin-name">' + esc(name) + " " + chip + "</div>" +
      '<div class="coin-sub">' + esc(c.symbol || "") + (c.symbol ? " · " : "") + "Solana" +
      (c.age_s != null ? " · " + fmtAge(c.age_s) : "") + "</div>" +
      '<div class="coin-price">' + fmtPrice(c.price) + "</div>" +
      (pct != null ? '<div class="coin-pct ' + (pct >= 0 ? "pos" : "neg") + '">' + (pct >= 0 ? "▲ " : "▼ ") + Math.abs(pct).toFixed(2) + "%" + (open ? " since entry" : " in window") + "</div>" : "") +
      '<div class="coin-chart-card"><canvas id="candleCanvas"></canvas></div>' +
      '<div class="stats-grid">' +
      statBox("Market cap", c.stats && c.stats.market_cap != null ? fmtMoney(c.stats.market_cap, 0) : "n/a") +
      statBox("Liquidity", c.stats && c.stats.liquidity_usd != null ? fmtMoney(c.stats.liquidity_usd, 0) : "n/a") +
      statBox("24h volume", c.stats && c.stats.volume_24h != null ? fmtMoney(c.stats.volume_24h, 0) : "n/a") +
      statBox("Holders", c.holders != null ? Number(c.holders).toLocaleString() : "n/a") +
      "</div>";

    if (open) {
      html += '<div class="detail-card"><h3>Your position · ' + fmtMoney(pos.size_usd) + ' in · Executor</h3>' +
        kv("Entry", fmtPrice(pos.entry_price)) +
        kv("Current exit line", fmtPrice(pos.exit_line)) +
        kv("Stop line", fmtPrice(pos.stop_price) + "  (-" + pos.stop_pct + "%)") +
        kv("Trail line", pos.trail_active ? fmtPrice(pos.trail_line) + "  (armed)" : "Arms at +" + settingsVal("risk.trail_start_pct", 20) + "%") +
        kv("Time left to timeout", fmtDur(pos.time_left_s)) +
        (pos.status === "exiting" ? kv("Status", "Exiting — waiting for your Sold tap") : "") +
        "</div>";
    } else if (pos) {
      html += '<div class="detail-card"><h3>Closed position</h3>' +
        kv("In", fmtMoney(pos.size_usd)) +
        kv("Entry → exit", fmtPrice(pos.entry_price) + " → " + fmtPrice(pos.exit_price)) +
        kv("Result", (pos.pnl_usd >= 0 ? "+" : "−") + "$" + Math.abs(pos.pnl_usd || 0).toFixed(2) + " · " + esc(pos.exit_reason || "")) +
        "</div>";
    } else {
      html += '<div class="detail-card"><h3>No position</h3><div style="color:var(--secondary);font-size:14.5px">The desk has not bought this coin. No exit card until it does.</div></div>';
    }

    if (audit.layers_checked) {
      html += '<button class="detail-card" id="coinAuditBtn" style="width:100%;text-align:left"><h3>Auditor · ' +
        (audit.passed ? "Cleared 8/8" : "Rejected · " + esc(audit.reason || "")) + '</h3>' +
        '<div style="color:var(--secondary);font-size:14.5px">See the 8 layers ›</div></button>';
    }
    if (c.verdict) {
      html += '<div class="detail-card"><h3>Analyst · score ' + Math.round(c.verdict.score) + "</h3>" +
        kv("alive 6h", Number(c.verdict.alive_6h).toFixed(2)) + kv("organic", Number(c.verdict.organic).toFixed(2)) +
        kv("flush", Number(c.verdict.flush).toFixed(2)) + kv("chase", Number(c.verdict.chase).toFixed(2)) + "</div>";
    }

    html += '<a class="big-action' + (open ? " sell" : "") + '" href="' + esc(c.coin_url || coinUrl(c.mint)) + '" target="_blank" rel="noopener">' +
      (open ? "Sell on FOMO" : "Buy on FOMO") + "</a>" +
      '<div class="fomo-note">The desk never trades for you — this opens the coin in FOMO.</div>';
    $("coinBody").innerHTML = html;

    var cv = $("candleCanvas");
    var exitLine = open && pos.exit_line ? { value: pos.exit_line, label: "Risk trailing stop" } : null;
    DeskCharts.drawCandles(cv, c.candles || [], { exitLine: exitLine });
    var ab = $("coinAuditBtn");
    if (ab) ab.addEventListener("click", function () { openAuditor(c.mint); });
  }
  function statBox(k, v) { return '<div class="stat-box"><div class="k">' + k + '</div><div class="v">' + v + "</div></div>"; }
  function kv(k, v) { return '<div class="kv"><span class="k">' + k + '</span><span class="v">' + v + "</span></div>"; }

  /* ---------- auditor screen ---------- */
  function openAuditor(mint) {
    if (!mint) return;
    S.auditorMint = mint;
    openScreen("auditorScreen");
    $("auditorBody").innerHTML = '<div class="skel" style="height:200px;margin-top:16px"></div>';
    if (!BASE) return;
    fetchJson("audit/" + mint + ".json", true).then(function (a) {
      if (S.auditorMint !== mint) return;
      if (!a && S.coin && S.coinMint === mint) {
        a = Object.assign({}, S.coin.audit, { mint: mint, name: S.coin.name, symbol: S.coin.symbol, coin_url: S.coin.coin_url, signal: S.coin.signal });
      }
      if (!a) { renderAuditorFallback(mint); return; }
      renderAuditor(a);
    });
  }

  function renderAuditorFallback(mint) {
    $("auditorBody").innerHTML = '<div class="coin-name">' + esc(coinName(mint)) + "</div>" +
      '<div class="empty-box">No coin taken apart yet — this coin has no audit on file.</div>' +
      '<a class="big-action plain" href="' + coinUrl(mint) + '" target="_blank" rel="noopener">Open on FOMO</a>';
  }

  function renderAuditor(a) {
    var name = a.name || coinName(a.mint);
    var layers = a.layers || [];
    var html = '<div class="coin-name">' + esc(name) + "</div>" +
      '<div class="coin-sub">' + esc(a.symbol || "") + (a.symbol ? " · " : "") + esc(shortMint(a.mint)) + "</div>" +
      '<div class="disc-stack" id="discStack">' +
      layers.map(function (l) {
        var cls = l.pass == null ? "" : l.pass ? " ok" : " bad";
        var mark = l.pass == null ? l.n : l.pass ? "✓" : "✕";
        return '<div class="disc' + cls + '"><span class="ball">' + mark + "</span>" +
          '<span><span class="d-name">' + esc(l.name) + '</span><br><span class="d-src">' + esc(l.source || "") + "</span></span>" +
          '<span class="d-val' + (l.pass == null ? " grey" : "") + '">' + esc(l.value) + "</span></div>";
      }).join("") + "</div>";

    if (a.layers_checked === 0 || (!a.passed && !a.reason)) {
      html += '<div class="verdict-banner" style="background:var(--card);color:var(--secondary)">Not taken apart yet.</div>';
    } else if (!a.passed) {
      html += '<div class="verdict-banner red">Rejected · ' + esc(a.reason || "") +
        '<div class="vb-sub">Grok Bot won\'t buy ' + esc(name) + "</div></div>";
    } else {
      html += '<div class="verdict-banner green">Cleared · 8/8 parts' +
        '<div class="vb-sub">Sent to Executor' + (a.signal && a.signal.size_usd ? " · " + fmtMoney(a.signal.size_usd) : "") + "</div></div>";
    }

    var enabled = settingsVal("auditor.enabled", true);
    html += '<div class="switch-row" style="margin-top:18px"><span class="switch' + (enabled ? " on" : "") + '"></span>' +
      '<span class="switch-note">Take apart before buying — read-only here; changes go through Telegram in plan B. Turning it off is a two-confirm change there, by design.</span></div>' +
      '<a class="big-action plain" href="' + esc(a.coin_url || coinUrl(a.mint)) + '" target="_blank" rel="noopener">Open on FOMO</a>';
    $("auditorBody").innerHTML = html;

    /* beam: light the discs top -> bottom, 350ms per layer. The colors are
       only ever the results the server already sent — the beam never
       invents an outcome, it just reveals them in order. */
    var discs = document.querySelectorAll("#discStack .disc");
    if (REDUCED) { discs.forEach(function (d) { d.classList.add("lit"); }); return; }
    discs.forEach(function (d, i) {
      setTimeout(function () { d.classList.add("lit"); }, 150 + i * 350);
    });
  }

  /* ---------- search ---------- */
  function renderSearch(q) {
    var box = $("searchResults");
    q = (q || "").trim().toLowerCase();
    var out = [];
    coinIndex.forEach(function (c) { out.push(c); });
    var filtered = out.filter(function (c) {
      return !q || (c.name && c.name.toLowerCase().indexOf(q) >= 0) ||
        (c.symbol && c.symbol.toLowerCase().indexOf(q) >= 0) ||
        c.mint.toLowerCase().indexOf(q) >= 0;
    });
    var html = "";
    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q) && !coinIndex.has(q)) {
      html += '<button class="activity-row" data-mint="' + esc(q) + '" data-kind="coin"><span class="act-ic" style="color:#64d2ff">◎</span>' +
        '<span class="act-main"><span class="act-title">' + esc(shortMint(q)) + '</span><span class="act-sub" style="display:block">Open by mint address</span></span></button>';
    }
    html += filtered.slice(0, 30).map(function (c) {
      return '<button class="activity-row" data-mint="' + esc(c.mint) + '" data-kind="coin"><span class="act-ic" style="color:#64d2ff">◎</span>' +
        '<span class="act-main"><span class="act-title">' + esc(c.name || shortMint(c.mint)) + '</span>' +
        '<span class="act-sub" style="display:block">' + esc(c.symbol || "") + (c.symbol ? " · " : "") + esc(shortMint(c.mint)) + "</span></span></button>";
    }).join("");
    box.innerHTML = html || '<div class="empty-box">No coins match — paste a mint address to open it directly.</div>';
  }

  /* ---------- screen refresh while open ---------- */
  function refreshOpenScreens() {
    if (S.coinMint && !$("coinScreen").hidden) loadCoin(S.coinMint);
  }

  /* ---------- navigation / events ---------- */
  function switchTab(tab) {
    S.tab = tab;
    ["home", "agents", "activity", "account"].forEach(function (t) {
      $("view-" + t).hidden = t !== tab;
    });
    document.querySelectorAll("#tabbar .tab").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-tab") === tab);
    });
    window.scrollTo(0, 0);
    if (tab === "activity") {
      var rows = S.activity ? S.activity.rows : [];
      var maxId = rows.reduce(function (m, r) { return Math.max(m, r.id || 0); }, 0);
      localStorage.setItem("desk_seen_act", maxId);
      $("bellDot").hidden = true;
    }
    if (tab === "home") drawHomeChart(false);
    drawRings(document);
  }

  document.querySelectorAll("#tabbar .tab").forEach(function (b) {
    b.addEventListener("click", function () { switchTab(b.getAttribute("data-tab")); });
  });
  $("avatarBtn").addEventListener("click", function () { switchTab("account"); });
  $("brandBtn").addEventListener("click", function () { switchTab("home"); });
  $("seeAllActivity").addEventListener("click", function () { switchTab("activity"); });
  $("bellBtn").addEventListener("click", function () { switchTab("activity"); });
  $("searchBtn").addEventListener("click", function () {
    openScreen("searchScreen");
    renderSearch("");
    setTimeout(function () { $("searchInput").focus(); }, 60);
  });
  $("searchInput").addEventListener("input", function (e) { renderSearch(e.target.value); });
  document.querySelectorAll("[data-close-screen]").forEach(function (b) {
    b.addEventListener("click", closeScreens);
  });
  $("rangeRow").addEventListener("click", function (e) {
    var b = e.target.closest("[data-range]"); if (!b) return;
    S.range = b.getAttribute("data-range");
    document.querySelectorAll("#rangeRow .range-btn").forEach(function (x) {
      x.classList.toggle("active", x === b);
    });
    drawHomeChart(false);
  });

  document.addEventListener("click", function (e) {
    var gs = e.target.closest("[data-goto-settings]");
    if (gs) {
      switchTab("account");
      var target = $("settings-" + gs.getAttribute("data-goto-settings"));
      if (target) setTimeout(function () { target.scrollIntoView({ behavior: REDUCED ? "auto" : "smooth" }); }, 60);
      return;
    }
    var row = e.target.closest("[data-mint]");
    if (row) {
      var mint = row.getAttribute("data-mint");
      var kind = row.getAttribute("data-kind") || "";
      if (!mint) return;
      closeScreens();
      if (kind === "reject") openAuditor(mint);
      else openCoin(mint, row.textContent);
    }
  });

  window.addEventListener("resize", function () {
    if (S.state) { drawHomeChart(false); drawRings(document); }
    if (S.coin && S.coinMint && !$("coinScreen").hidden) renderCoin(S.coin);
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  }

  /* skeleton first paint */
  $("agentCarousel").innerHTML = AGENTS.map(function (a) {
    return '<article class="agent-card skel" style="display:flex;align-items:center;justify-content:center;color:var(--tertiary);font-weight:600">' + a + "</article>";
  }).join("");
  $("homeActivity").innerHTML = '<div class="skel" style="height:62px"></div>';

  poll();
  setInterval(poll, 15000);
})();
