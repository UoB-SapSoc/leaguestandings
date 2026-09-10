/* Sapsoc — league site
 * Reads data/league.db (a SQLite file) entirely client-side with sql.js
 * (compiled SQLite via WebAssembly) and renders standings + player detail.
 * Replace data/league.db with an updated export any time — no build step.
 */

(() => {
  "use strict";

  const DB_PATH = "data/league.db";

  const els = {
    heroStats: document.getElementById("heroStats"),
    tabs: Array.from(document.querySelectorAll(".tab")),
    semesterPicker: document.getElementById("semesterPicker"),
    semesterSelect: document.getElementById("semesterSelect"),
    standingsBody: document.getElementById("standingsBody"),
    pointsHeader: document.getElementById("pointsHeader"),
    tableNote: document.getElementById("tableNote"),
    dbUpdated: document.getElementById("dbUpdated"),
    heroSection: document.getElementById("heroSection"),
    boardSection: document.getElementById("boardSection"),
    detailSection: document.getElementById("detailSection"),
    emptyState: document.getElementById("emptyState"),
    closeDetail: document.getElementById("closeDetail"),
    detailName: document.getElementById("detailName"),
    detailSub: document.getElementById("detailSub"),
    detailFigures: document.getElementById("detailFigures"),
    chartRange: document.getElementById("chartRange"),
    eloChart: document.getElementById("eloChart"),
    matchList: document.getElementById("matchList"),
  };

  let db = null;
  let currentView = "alltime"; // 'alltime' | 'active' | 'semester'
  let currentSemesterId = null;

  init();

  async function init() {
    try {
      const SQL = await initSqlJs({ locateFile: (f) => `vendor/${f}` });
      const buf = await fetchDbBuffer();
      db = new SQL.Database(new Uint8Array(buf));
    } catch (err) {
      console.error("Failed to load league database:", err);
      showEmptyState("The league database couldn't be loaded. Check that data/league.db exists and is a valid export of the schema.");
      return;
    }

    const playerCount = queryScalar("SELECT COUNT(*) FROM players");
    if (!playerCount) {
      showEmptyState();
      return;
    }

    populateSemesterPicker();
    renderHeader();
    renderHero();
    wireTabs();
    els.closeDetail.addEventListener("click", closeDetail);
    renderStandings();
  }

  async function fetchDbBuffer() {
    const res = await fetch(DB_PATH, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${DB_PATH}`);
    return res.arrayBuffer();
  }

  function showEmptyState(message) {
    els.heroSection.hidden = true;
    els.boardSection.hidden = true;
    els.detailSection.hidden = true;
    els.emptyState.hidden = false;
    if (message) els.emptyState.querySelector("p").textContent = message;
    els.dbUpdated.textContent = "No data loaded";
  }

  /* ---------------- query helpers ---------------- */

  function queryAll(sql, params = []) {
    const stmt = db.prepare(sql);
    if (params.length) stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }

  function queryScalar(sql, params = []) {
    const rows = queryAll(sql, params);
    if (!rows.length) return null;
    const firstKey = Object.keys(rows[0])[0];
    return rows[0][firstKey];
  }

  /* ---------------- header / hero ---------------- */

  function renderHeader() {
    const lastPlayed = queryScalar("SELECT MAX(played_at) FROM matches");
    els.dbUpdated.textContent = lastPlayed
      ? `Results last updated ${formatDate(lastPlayed)}`
      : "Awaiting first results";
  }

  function renderHero() {
    const activePlayers = queryScalar("SELECT COUNT(*) FROM players WHERE is_active = 1");
    const totalMatches = queryScalar("SELECT COUNT(*) FROM matches WHERE player2_id IS NOT NULL");
    const current = queryAll(
      `SELECT display_name FROM semesters WHERE status = 'active' ORDER BY start_date DESC LIMIT 1`
    );
    const top = queryAll(
      `SELECT player_name, current_elo FROM v_alltime_standings_active ORDER BY current_elo DESC LIMIT 1`
    );

    const stats = [
      { label: "Active players", figure: String(activePlayers ?? 0) },
      { label: "Matches played", figure: String(totalMatches ?? 0) },
      {
        label: "Current semester",
        figure: current.length ? current[0].display_name : "Off-season",
      },
    ];
    if (top.length) {
      stats.push({
        label: "Top Elo",
        figure: `${Math.round(top[0].current_elo)} — ${top[0].player_name}`,
      });
    }

    els.heroStats.innerHTML = stats
      .map(
        (s) => `
        <div class="hero-stat" role="listitem">
          <span class="figure">${escapeHtml(s.figure)}</span>
          <span class="label">${escapeHtml(s.label)}</span>
        </div>`
      )
      .join("");
  }

  /* ---------------- semester picker ---------------- */

  function populateSemesterPicker() {
    const semesters = queryAll(
      `SELECT semester_id, display_name, status FROM semesters ORDER BY start_date DESC`
    );
    els.semesterSelect.innerHTML = semesters
      .map(
        (s) =>
          `<option value="${s.semester_id}">${escapeHtml(s.display_name)}${
            s.status === "active" ? " (current)" : ""
          }</option>`
      )
      .join("");
    if (semesters.length) currentSemesterId = semesters[0].semester_id;
    els.semesterSelect.addEventListener("change", () => {
      currentSemesterId = Number(els.semesterSelect.value);
      renderStandings();
    });
  }

  /* ---------------- tabs ---------------- */

  function wireTabs() {
    els.tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        els.tabs.forEach((t) => t.setAttribute("aria-selected", "false"));
        tab.setAttribute("aria-selected", "true");
        currentView = tab.dataset.view;
        els.semesterPicker.hidden = currentView !== "semester";
        renderStandings();
      });
    });
  }

  /* ---------------- standings table ---------------- */

  function renderStandings() {
    let rows, mode;

    if (currentView === "alltime") {
      rows = queryAll(
        `SELECT player_id, player_name, current_elo, starting_elo, points, wins, losses, matches_played
         FROM v_alltime_standings ORDER BY current_elo DESC`
      );
      mode = "career";
      els.pointsHeader.textContent = "Points";
      els.tableNote.textContent =
        "Ranked by current Elo across every semester played. Points are the sum of semester points earned.";
    } else if (currentView === "active") {
      rows = queryAll(
        `SELECT player_id, player_name, current_elo, starting_elo, points, wins, losses, matches_played
         FROM v_alltime_standings_active ORDER BY current_elo DESC`
      );
      mode = "career";
      els.pointsHeader.textContent = "Points";
      els.tableNote.textContent = "Currently active players only, ranked by Elo.";
    } else {
      if (currentSemesterId == null) {
        rows = [];
      } else {
        rows = queryAll(
          `SELECT player_id, player_name, current_elo, starting_elo, ending_elo, points, wins, losses, matches_played
           FROM v_semester_standings WHERE semester_id = ? ORDER BY points DESC, current_elo DESC`,
          [currentSemesterId]
        );
      }
      mode = "semester";
      els.pointsHeader.textContent = "Points";
      const sem = queryAll(`SELECT name, status FROM semesters WHERE semester_id = ?`, [
        currentSemesterId,
      ]);
      els.tableNote.textContent = sem.length
        ? `Semester points come from match wins in ${escapeHtml(sem[0].name)}${
            sem[0].status === "active" ? " (in progress)" : ""
          }. Elo shown is each player's current rating.`
        : "";
    }

    const activeIds = new Set(
      queryAll("SELECT player_id FROM players WHERE is_active = 1").map((r) => r.player_id)
    );

    if (!rows.length) {
      els.standingsBody.innerHTML = `<tr class="empty-row"><td colspan="8">No standings for this view yet.</td></tr>`;
      return;
    }

    els.standingsBody.innerHTML = rows
      .map((r, i) => {
        let elo
        if (r.ending_elo) {
          elo = r.ending_elo;
        } else {
          elo = r.current_elo;
        }

        const delta =
          mode === "semester"
            ? elo - r.starting_elo
            : r.current_elo - r.starting_elo; // starting_elo = base_elo in v_alltime_standings
        const trendClass = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
        const trendSign = delta > 0 ? "+" : "";
        const isInactive = !activeIds.has(r.player_id);

        return `
        <tr tabindex="0" data-player-id="${r.player_id}" class="${
          isInactive && currentView !== "active" ? "inactive-row" : ""
        }">
          <td class="col-rank">${i + 1}</td>
          <td class="col-name">${escapeHtml(r.player_name)}${
          isInactive ? '<span class="member-dot" title="Inactive player" aria-hidden="true"></span>' : ""
        }</td>
          <td class="col-elo">${Math.round(elo)}</td>
          <td class="col-trend"><span class="trend ${trendClass}">${trendSign}${Math.round(delta)}</span></td>
          <td class="col-points">${r.points}</td>
          <td class="col-record">${r.wins}&#8211;${r.losses}</td>
          <td class="col-played">${r.matches_played}</td>
        </tr>`;
      })
      .join("");

    Array.from(els.standingsBody.querySelectorAll("tr[data-player-id]")).forEach((tr) => {
      tr.addEventListener("click", () => openDetail(Number(tr.dataset.playerId)));
      tr.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openDetail(Number(tr.dataset.playerId));
        }
      });
    });
  }

  /* ---------------- player detail ---------------- */

  function openDetail(playerId) {
    const player = queryAll(
      `SELECT p.player_id, p.first_name, p.last_name, p.is_member, p.is_active, p.joined_date,
              p.base_elo, p.current_elo,
              v.points, v.wins, v.losses, v.byes, v.matches_played
       FROM players p
       JOIN v_alltime_standings v ON v.player_id = p.player_id
       WHERE p.player_id = ?`,
      [playerId]
    )[0];
    if (!player) return;

    els.detailName.textContent = `${player.first_name} ${player.last_name}`;
    const bits = [
      player.is_member ? "League member" : "Guest player",
      player.is_active ? "Active" : "Inactive",
      `Joined ${formatDate(player.joined_date)}`,
    ];
    els.detailSub.textContent = bits.join(" \u00b7 ");

    const figures = [
      { label: "Current Elo", figure: Math.round(player.current_elo) },
      { label: "Starting Elo", figure: Math.round(player.base_elo) },
      { label: "Career points", figure: player.points },
      { label: "Record", figure: `${player.wins}\u2013${player.losses}` },
    ];
    els.detailFigures.innerHTML = figures
      .map(
        (f) => `
        <div class="figure-block">
          <div class="figure">${escapeHtml(String(f.figure))}</div>
          <div class="label">${escapeHtml(f.label)}</div>
        </div>`
      )
      .join("");

    renderEloChart(playerId, player.base_elo);
    renderMatchList(playerId);

    els.heroSection.hidden = true;
    els.boardSection.hidden = true;
    els.detailSection.hidden = false;
    window.scrollTo({ top: 450, behavior: "smooth" });
  }

  function closeDetail() {
    els.detailSection.hidden = true;
    els.heroSection.hidden = false;
    els.boardSection.hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderEloChart(playerId, baseElo) {
    const history = queryAll(
      `SELECT elo_after, recorded_at FROM v_player_elo_timeline WHERE player_id = ? ORDER BY recorded_at ASC`,
      [playerId]
    );

    if (!history.length) {
      els.eloChart.innerHTML = `<p class="no-data">No matches recorded yet for this player.</p>`;
      els.chartRange.textContent = "";
      return;
    }

    const values = [baseElo, ...history.map((h) => h.elo_after)];
    els.chartRange.textContent = `${formatDate(history[0].recorded_at)} \u2013 ${formatDate(
      history[history.length - 1].recorded_at
    )}`;
    els.eloChart.innerHTML = buildLineChart(values);
  }

  function buildLineChart(values) {
    const width = 900;
    const height = 260;
    const padX = 28;
    const padTop = 20;
    const padBottom = 30;

    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const plotW = width - padX * 2;
    const plotH = height - padTop - padBottom;

    const pt = (i, v) => {
      const x = padX + (values.length === 1 ? plotW / 2 : (i / (values.length - 1)) * plotW);
      const y = padTop + plotH - ((v - min) / range) * plotH;
      return [x, y];
    };

    const points = values.map((v, i) => pt(i, v));
    const linePath = points
      .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
      .join(" ");
    const areaPath = `${linePath} L${points[points.length - 1][0].toFixed(1)},${(padTop + plotH).toFixed(
      1
    )} L${points[0][0].toFixed(1)},${(padTop + plotH).toFixed(1)} Z`;

    const gridLines = [0, 0.25, 0.5, 0.75, 1]
      .map((f) => {
        const y = padTop + plotH * f;
        const val = Math.round(max - range * f);
        return `<line x1="${padX}" y1="${y}" x2="${width - padX}" y2="${y}" stroke="#DCD1B4" stroke-width="1" />
                <text x="${padX}" y="${y - 5}" font-family="IBM Plex Mono" font-size="11" fill="#5B4E3B">${val}</text>`;
      })
      .join("");

    const last = points[points.length - 1];

    return `
      <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Elo rating over time">
        ${gridLines}
        <path d="${areaPath}" fill="#1E4D3A" opacity="0.08" stroke="none" />
        <path d="${linePath}" fill="none" stroke="#1E4D3A" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round" />
        <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="4.5" fill="#B8863B" />
      </svg>`;
  }

  function renderMatchList(playerId) {
    const matches = queryAll(
      `SELECT m.match_id, m.played_at, m.player1_id, m.player2_id, m.winner_id,
              CASE WHEN m.player1_id = ?1 THEN p2.first_name || ' ' || p2.last_name
                   ELSE p1.first_name || ' ' || p1.last_name END AS opponent_name,
              CASE WHEN m.player1_id = ?1 THEN m.player1_elo_after ELSE m.player2_elo_after END AS elo_after,
              CASE WHEN m.player1_id = ?1 THEN m.player1_elo_before ELSE m.player2_elo_before END AS elo_before
       FROM matches m
       LEFT JOIN players p1 ON p1.player_id = m.player1_id
       LEFT JOIN players p2 ON p2.player_id = m.player2_id
       WHERE m.player1_id = ?1 OR m.player2_id = ?1
       ORDER BY m.match_id DESC
       LIMIT 25`,
      [playerId]
    );

    if (!matches.length) {
      els.matchList.innerHTML = `<li>No matches recorded yet.</li>`;
      return;
    }

    els.matchList.innerHTML = matches
      .map((m) => {
        let resultClass, resultLabel, opponentText;

        if (m.player2_id === null) {
          resultClass = "bye";
          resultLabel = "Bye";
          opponentText = "No opponent";

        } else if (m.winner_id === playerId) {
          resultClass = "win";
          resultLabel = "Win";
          opponentText = `vs ${m.opponent_name}`;

        } else if (m.winner_id) {
          resultClass = "loss";
          resultLabel = "Loss";
          opponentText = `vs ${m.opponent_name}`;

        } else {
          resultClass = "bye";
          resultLabel = "Unplayed";
          opponentText = `vs ${m.opponent_name}`;
        }

        let delta
        delta = m.elo_after != null && m.elo_before != null ? m.elo_after - m.elo_before : null;
        delta = Math.round(delta)

        const deltaText = delta == null ? "" : ` (${delta > 0 ? "+" : ""}${delta})`;
        return `
        <li>
          <span class="match-opponent">${escapeHtml(opponentText)}</span>
          <span class="match-meta">${formatDate(m.played_at)}${escapeHtml(deltaText)}</span>
          <span class="match-result ${resultClass}">${resultLabel}</span>
        </li>`;
      })
      .join("");
  }

  /* ---------------- utils ---------------- */

  // Function to check mobile view and toggle CSS classes
  function updateInterface() {
    const isMobile = window.matchMedia("(max-width: 768px)").matches;

    if (isMobile) {
      document.body.classList.add("is-mobile");
      document.body.classList.remove("is-desktop");
      // Run mobile-specific logic (e.g., render hamburger menu)
    } else {
      document.body.classList.add("is-desktop");
      document.body.classList.remove("is-mobile");
      // Run desktop-specific logic
    }
  }

  // Initial check on load
  updateInterface();

  // Listen for screen resize or orientation changes dynamically
  window.matchMedia("(max-width: 768px)").addEventListener("change", (e) => {
    updateInterface();
  });

  function formatDate(str) {
    if (!str) return "";
    const d = new Date(str.replace(" ", "T"));
    if (isNaN(d.getTime())) return str;
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]));
  }
})();
