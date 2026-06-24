// =======================================================
// SEARCH.JS – Integrated with dashboard.html
// =======================================================

(function () {
  const page = document.getElementById("page-search");
  if (!page) return;


  // -------------------- Elements --------------------
  const searchBox    = document.getElementById("searchBox");
  const statusEl     = document.getElementById("search-status");
  const resultsEl    = document.getElementById("results");
  const minRatingEl  = document.getElementById("minRating");
  const minRatingVal = document.getElementById("minRatingVal");
  const scidInput    = document.getElementById("scid");
  const loadBtn      = document.getElementById("load");

  if (!searchBox || !resultsEl) return;

  // -------------------- Config --------------------
  let apiBase = "http://127.0.0.1:8099/api";
  const DERO_PREFIX = "dero://";

  // Fetch the actual Gnomon API port from the native host
  (async function initApiBase() {
    try {
      const resp = await RT.runtime.sendMessage({ cmd: "get_config" });
      if (resp?.ok && resp?.result?.gnomon_api_port) {
        apiBase = "http://127.0.0.1:" + resp.result.gnomon_api_port + "/api";
      }
    } catch (e) {
      // keep default
    }
  })();

  let allResults = [];
  let fuse       = null;
  let minRating  = 30;
  let loadToken  = 0;

  // Keyboard navigation
  let selectedIndex = -1;
  let keyboardNavigating = false;

  // dURL dropdown
  const searchSuggestions = document.getElementById("searchSuggestions");

  let suggestionResults = [];
  let suggestionIndex = -1;

  // -------------------- Suggestions Dropdown --------------------
  const suggestionsEl = document.createElement("div");
  suggestionsEl.id = "search-suggestions";
  searchBox.parentElement.style.position = "relative";
  searchBox.parentElement.appendChild(suggestionsEl);

  // -------------------- Default Rating --------------------
  if (minRatingEl && minRatingVal) {
    minRatingEl.value        = minRating;
    minRatingVal.textContent = minRating;
  }

  function isHiddenByExtension(url) {
    if (!url) return false;

    const hidden = window.getHiddenExtensions?.() || [];
    const lower = url.toLowerCase();

    return hidden.some(ext => lower.endsWith(ext));
  }

  // -------------------- Fetch SCID Data --------------------
  async function fetchSCIDData(scid) {
    try {
      const resp = await fetch(`${apiBase}/scvarsbyheight?scid=${scid}`);
      if (!resp.ok) return null;

      const data = await resp.json();
      if (!data.variables) return null;

      let dURL = scid;
      let nameHdr = scid;
      let descrHdr = "";
      let iconURL = "";
      let createdHeight = Infinity;

      const ratings = [];

      data.variables.forEach(v => {
        const key = v.Key;
        const val = v.Value;

        if (key === "dURL" && val) dURL = val;
        else if (key === "nameHdr" && val) nameHdr = val;
        else if (key === "descrHdr" && val) descrHdr = val;
        else if (key === "iconURLHdr" && val) iconURL = val;
        else if (typeof key === "string" && key.startsWith("dero1")) {
          const [rating, height] = String(val).split("_");

          ratings.push({
            rating: Number(rating),
            height: Number(height)
          });

          if (Number(height) < createdHeight) {
            createdHeight = Number(height);
          }
        }
      });

      const likes = ratings.filter(r => r.rating >= 50).length;
      const dislikes = ratings.filter(r => r.rating < 50).length;

      const average = ratings.length
        ? Math.round(
            ratings.reduce((a, r) => a + r.rating, 0) / ratings.length
          )
        : 0;

      return {
        scid,
        dURL,
        nameHdr,
        descrHdr,
        iconURL,
        likes,
        dislikes,
        average,
        createdHeight:
          createdHeight === Infinity ? 0 : createdHeight
      };

    } catch (err) {
      console.error("SCID fetch error", err);
      return null;
    }
  }

  async function fetchAllSCIDs() {
    const resp = await fetch(`${apiBase}/indexedscs`);

    if (!resp.ok) {
      throw new Error("Indexed SCID fetch failed");
    }

    const data = await resp.json();

    return Object.keys(data.indexedscs || {});
  }

  // -------------------- Load SCIDs --------------------
  async function loadSearchSCIDs() {
    const token = ++loadToken;

    try {
      statusEl.textContent = "⏳ Fetching indexed SCIDs...";
      resultsEl.replaceChildren();

      // 1. Try direct discovery first for instant results
      try {
        const disc = await RT.runtime.sendMessage({ cmd: "discover_tela" });
        if (token !== loadToken) return;
        if (disc?.ok && disc?.result?.apps) {
          const directApps = disc.result.apps.map(app => ({
            scid: app.scid,
            dURL: app.durl,
            nameHdr: app.name,
            descrHdr: "",
            iconURL: "",
            likes: 0,
            dislikes: 0,
            average: 0,
            createdHeight: 0,
            isDirect: true,
            from_api: app.from_api
          }));
          
          if (directApps.length > 0) {
            if (token === loadToken) allResults = directApps;
            fuse = new Fuse(allResults, {
              keys: ["scid", "dURL", "nameHdr", "descrHdr"],
              threshold: 0.25,
              ignoreLocation: true
            });
            renderResults(allResults);
            statusEl.textContent = `✅ Loaded ${allResults.length} apps (direct)`;
          }
        }
      } catch (e) {
        console.warn("Direct discovery failed, falling back to Gnomon", e);
      }

      let scids;
      try {
        scids = await fetchAllSCIDs();
      } catch (e) {
        console.warn("fetchAllSCIDs failed, trying daemon RPC fallback", e);
        scids = [];
      }

      if (token !== loadToken) return;

      const localResults = [];

      // Step 1: Fetch from local Gnomon API when available (lower priority).
      // On local nodes this is the primary source; on remote nodes the API
      // returns stale data for a subset of SCIDs.
      if (scids.length > 0) {
        let index = 0;
        const concurrency = 5;
        async function worker() {
          while (index < scids.length) {
            const scid = scids[index++];
            if (token !== loadToken) return;
            const res = await fetchSCIDData(scid);
            if (res) localResults.push(res);
            if (token === loadToken) {
              statusEl.textContent = `Loaded ${localResults.length} / ${scids.length} SCIDs...`;
            }
          }
        }
        await Promise.all(Array(concurrency).fill().map(worker));
      }

      // Step 2: Fetch from daemon RPC for apps that came from bundled list
      // or registry (not from Gnomon API). On remote nodes the local Gnomon
      // API is stale/incomplete, so daemon RPC fills names, dURLs, and ratings
      // for the full catalog. On local nodes all apps have from_api=true, so
      // this step is skipped (Gnomon API already has complete data).
      const hasBundledApps = allResults.some(r => r.isDirect && !r.from_api);
      if (hasBundledApps) {
        try {
          statusEl.textContent = "⏳ Querying daemon for SCID data...";
          const discScids = allResults.map(r => r.scid);
          const varsResp = await RT.runtime.sendMessage({
            cmd: "get_scid_vars",
            params: { scids: discScids }
          });
          if (varsResp?.ok && varsResp?.result?.vars) {
            for (const v of varsResp.result.vars) {
              localResults.push(v);
            }
          }
        } catch (e) {
          console.warn("get_scid_vars fallback failed:", e);
        }
      }

      // Merge fetched data with direct discovery results
      const gnomonMap = new Map(localResults.map(r => [r.scid, r]));
      
      // Upgrade all items with Gnomon metadata where available
      const mergedResults = allResults.map(direct => {
        const gnomon = gnomonMap.get(direct.scid);
        if (gnomon) {
          return { ...direct, ...gnomon, isDirect: false };
        }
        return { ...direct };
      });
      
      // Add any Gnomon results that weren't in direct discovery
      for (const gnomon of localResults) {
        if (!mergedResults.some(r => r.scid === gnomon.scid)) {
          mergedResults.push({ ...gnomon, isDirect: false });
        }
      }

      // Never shrink allResults — once we have N SCIDs, keep at least N
      if (mergedResults.length >= allResults.length) allResults = mergedResults;

      fuse = new Fuse(allResults, {
        keys: ["scid", "dURL", "nameHdr", "descrHdr"],
        threshold: 0.25,
        ignoreLocation: true
      });

      statusEl.textContent =
        `✅ Loaded ${allResults.length} SCIDs`;

      renderResults(allResults);

    } catch (err) {
      if (token !== loadToken) return;

      console.error("Error loading SCIDs:", err);

      statusEl.textContent =
        "❌ Failed loading SCIDs – is Gnomon indexer running?";
    }
  }

  window.loadSearchSCIDs = loadSearchSCIDs;

  // -------------------- Sort --------------------
  function getSortValue() {
    const sel = document.querySelector("#sortMode .selected");
    return sel?.getAttribute("data-value") || "name_asc";
  }

  function initSortDropdown() {
    const select = document.getElementById("sortMode");
    if (!select) return;
    const trigger = select.querySelector(".custom-select-trigger");
    const menu = select.querySelector(".custom-select-menu");
    const textEl = select.querySelector(".custom-select-text");
    if (!trigger || !menu || !textEl) return;

    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      select.classList.toggle("open");
    });

    menu.querySelectorAll("li").forEach((li) => {
      li.addEventListener("click", () => {
        menu.querySelectorAll("li").forEach((l) => l.classList.remove("selected"));
        li.classList.add("selected");
        textEl.textContent = li.textContent;
        select.classList.remove("open");
        renderResults(allResults);
      });
    });

    document.addEventListener("click", () => {
      select.classList.remove("open");
    });
  }

  function sortResults(list, mode) {
    const arr = [...list];

    switch (mode) {
      case "name_asc":
        return arr.sort((a, b) =>
          a.nameHdr.localeCompare(
            b.nameHdr,
            undefined,
            { sensitivity: "base" }
          )
        );

      case "name_desc":
        return arr.sort((a, b) =>
          b.nameHdr.localeCompare(
            a.nameHdr,
            undefined,
            { sensitivity: "base" }
          )
        );

      case "newest":
        return arr.sort(
          (a, b) => b.createdHeight - a.createdHeight
        );

      case "oldest":
        return arr.sort(
          (a, b) => a.createdHeight - b.createdHeight
        );

      default:
        return arr;
    }
  }

  // -------------------- Hex Icon --------------------
  function createHexIcon() {
    const div = document.createElement("div");

    div.className = "scid-svg";

    div.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 867 1001">
        <polygon points="0.5,250.55 433.47,0.58 866.43,250.55 866.43,750.5 433.47,1000.47 0.5,750.5"
                 fill="none" stroke="currentColor" stroke-width="6"/>
        <polygon points="209.17,371.63 209.17,628.97 433.69,759.79 657.39,630.28 657.39,374.85 433.26,241.71 209.17,371.63"
                 fill="none" stroke="currentColor" stroke-width="6"/>
        <polygon points="239.64,389.3 239.64,611.21 348.32,675.69 366.79,580 331.72,558.65 331.72,442.81 433.41,384.91 533.88,443.47 533.88,559.84 498.24,579.73 515.93,678.24 626.31,612.4 626.31,392.17 433.26,277.45 239.64,389.3"
                 fill="none" stroke="currentColor" stroke-width="6"/>
        <polygon points="432.54,420.32 502.73,461.22 502.73,542 464.66,563.58 485.09,694.51 433.7,724.39 378.96,692.5 400.62,564.62 362.1,541.19 362.1,461.28 432.54,420.32"
                 fill="none" stroke="currentColor" stroke-width="6"/>
      </svg>
    `;

    return div;
  }

  // -------------------- Render Results --------------------
  function renderResults(results) {
  resultsEl.replaceChildren();

  const hiddenExt = window.getHiddenExtensions?.() || [];

  const filtered = sortResults(
    results,
    getSortValue()
  ).filter(r => {
    // Skip rating filter for direct discovery results (they have no ratings yet)
    if (!r.isDirect && r.average < minRating) return false;

    if (!r.dURL) return true;

    const url = r.dURL.toLowerCase();

    return !hiddenExt.some(ext => url.endsWith(ext));
  });

  if (!filtered.length) {
    const msg = document.createElement("div");
    msg.className = "no-results";
    msg.textContent = "No results found";
    resultsEl.appendChild(msg);
    return;
  }

  filtered.forEach(r => {
    const div = document.createElement("div");
    div.className = "result";
    div.onclick = () => handleSCIDClick(r.scid);

    const iconSlot = document.createElement("div");
    iconSlot.className = "icon-slot";

    if (r.iconURL) {
      const img = document.createElement("img");
      img.className = "icon";
      img.src = r.iconURL;

      img.onerror = () => {
        iconSlot.replaceChildren(createHexIcon());
      };

      iconSlot.appendChild(img);
    } else {
      iconSlot.appendChild(createHexIcon());
    }

    const content = document.createElement("div");
    content.className = "content";

    const urlEl = document.createElement("div");
    urlEl.className = "url";
    urlEl.textContent = r.dURL;

    const nameEl = document.createElement("div");
    nameEl.className = "nameHdr";
    nameEl.textContent = r.nameHdr;

    const scidEl = document.createElement("div");
    scidEl.className = "scid";
    scidEl.textContent = r.scid;

    const descrEl = document.createElement("div");
    descrEl.className = "descr";
    descrEl.textContent = r.descrHdr;

    const ratingEl = document.createElement("div");
    ratingEl.className = "rating";
    ratingEl.textContent =
      `👍 ${r.likes} 👎 ${r.dislikes} ⭐ ${r.average}`;

    [urlEl, nameEl, scidEl].forEach(el => {
      el.style.cursor = "pointer";
      el.onclick = (e) => {
        e.stopPropagation();
        handleSCIDClick(r.scid);
      };
    });

    content.append(urlEl, nameEl, scidEl, descrEl, ratingEl);
    div.append(iconSlot, content);
    resultsEl.appendChild(div);
  });
}
  // -------------------- Handle SCID --------------------
  function handleSCIDClick(scid) {
    if (scidInput) {
      scidInput.value = scid;

      scidInput.dispatchEvent(
        new Event("input")
      );
    }

    if (window.selectSCID) {
      window.selectSCID(scid);
    }

    const directLoad =
      typeof window.getDirectLoadSetting === "function"
        ? window.getDirectLoadSetting()
        : true;

    if (directLoad && loadBtn) {
      loadBtn.click();
    }
  }

  // -------------------- dURL Lookup --------------------
  function findByDURL(input) {
    const normalized =
      input.trim().toLowerCase();

    return allResults.find(r =>
      (r.dURL || "")
        .toLowerCase()
        .startsWith(normalized)
    );
  }

  function getDURLSuggestions(input) {
    const q = input.trim().toLowerCase();

    if (!q) return [];

    return allResults
      .filter(r =>
        (r.dURL || "")
          .toLowerCase()
          .startsWith(q)
      )
      .sort((a, b) =>
        a.dURL.length - b.dURL.length
      )
      .slice(0, 8);
  }

  // -------------------- Suggestions UI --------------------
  function renderSuggestions(results) {
    if (!searchSuggestions) return;

    searchSuggestions.innerHTML = "";

    suggestionResults = results.slice(0, 8);
    suggestionIndex = -1;

    if (!suggestionResults.length) {
      searchSuggestions.classList.add("hidden");
      return;
    }

    suggestionResults.forEach((r, index) => {
      const item = document.createElement("div");
      item.className = "search-suggestion";

      item.innerHTML = `
        <div class="durl">${r.dURL}</div>
        <div class="meta">${r.nameHdr || r.scid}</div>
      `;

      item.onclick = () => {
        handleSCIDClick(r.scid);
        hideSuggestions();
      };

      searchSuggestions.appendChild(item);
    });

    searchSuggestions.classList.remove("hidden");
  }

  function hideSuggestions() {
    if (!searchSuggestions) return;

    searchSuggestions.classList.add("hidden");
    suggestionIndex = -1;
  }

  function updateSuggestionSelection() {
    const items = searchSuggestions.querySelectorAll(".search-suggestion");

    items.forEach((el, i) => {
      el.classList.toggle("selected", i === suggestionIndex);

    if (i === suggestionIndex) {
      el.scrollIntoView({
        block: "nearest",
        behavior: "smooth"
      });
    }
  });

    if (suggestionIndex >= 0 && suggestionResults[suggestionIndex]) {
      searchBox.value = DERO_PREFIX + suggestionResults[suggestionIndex].dURL;
    }
  }

  // -------------------- Search --------------------
  function runSearch(value) {
    const query = value.replace(DERO_PREFIX, "").trim();

    if (!query) {
      renderResults(allResults);
      hideSuggestions();
      return;
    }

    if (!fuse) return;

    const results = fuse.search(query).map(r => r.item);

    renderResults(results);

    // dURL dropdown suggestions
    const durlMatches = results.filter(r =>
      (r.dURL || "").toLowerCase().includes(query.toLowerCase())
    );

    renderSuggestions(durlMatches);
  }

  // -------------------- Highlight --------------------
  function highlightSelected() {
    const items =
      resultsEl.querySelectorAll(".result");

    items.forEach((el, i) => {
      if (i === selectedIndex) {
        el.classList.add("keyboard-selected");

        el.scrollIntoView({
          block: "nearest",
          behavior: "smooth"
        });

      } else {
        el.classList.remove("keyboard-selected");
      }
    });
  }

  // -------------------- Init --------------------
  searchBox.value = DERO_PREFIX;

  // -------------------- Input --------------------
  searchBox.addEventListener("input", e => {
    let value = e.target.value;

    if (!value.startsWith(DERO_PREFIX)) {
      value =
        DERO_PREFIX +
        value.replace(/^dero:\/\//, "");

      e.target.value = value;
    }

    if (
      e.target.selectionStart <
      DERO_PREFIX.length
    ) {
      e.target.setSelectionRange(
        DERO_PREFIX.length,
        DERO_PREFIX.length
      );
    }

    suggestionIndex = -1;

    runSearch(value);
  });

  // -------------------- Keydown --------------------
  searchBox.addEventListener("keydown", e => {
    const pos = searchBox.selectionStart;

    // Protect prefix
    if (
      (e.key === "Backspace" &&
        pos <= DERO_PREFIX.length) ||
      (e.key === "Delete" &&
        pos < DERO_PREFIX.length)
    ) {
      e.preventDefault();
      return;
    }

    const suggestions =
      suggestionsEl.querySelectorAll(
        ".search-suggestion"
      );

    // Arrow DOWN
    if (e.key === "ArrowDown") {
      const items = searchSuggestions.querySelectorAll(".search-suggestion");

      if (items.length) {
        e.preventDefault();

        suggestionIndex =
          suggestionIndex < items.length - 1
            ? suggestionIndex + 1
            : 0;

        updateSuggestionSelection();
      }
    }

    // Arrow UP
    if (e.key === "ArrowUp") {
      const items = searchSuggestions.querySelectorAll(".search-suggestion");

      if (items.length) {
        e.preventDefault();

        suggestionIndex =
          suggestionIndex > 0
            ? suggestionIndex - 1
            : items.length - 1;

        updateSuggestionSelection();
      }
    }

    // ENTER
    if (e.key === "Enter") {
      const selected = suggestionResults[suggestionIndex];

      if (selected) {
        e.preventDefault();

        handleSCIDClick(selected.scid);
        hideSuggestions();
        return;
      }
    }
  });

  // -------------------- Mouse Move --------------------
  resultsEl.addEventListener("mousemove", () => {
    if (!keyboardNavigating) return;

    keyboardNavigating = false;

    document.body.classList.remove(
      "keyboard-nav"
    );

    selectedIndex = -1;

    highlightSelected();
  });

  // -------------------- Prefix Protection --------------------
  searchBox.addEventListener("click", () => {
    if (
      searchBox.selectionStart <
      DERO_PREFIX.length
    ) {
      searchBox.setSelectionRange(
        DERO_PREFIX.length,
        DERO_PREFIX.length
      );
    }
  });

  // -------------------- Filters --------------------
  minRatingEl?.addEventListener("input", e => {
    minRating = Number(e.target.value);

    minRatingVal.textContent = minRating;

    renderResults(allResults);
  });

  initSortDropdown();

  // -------------------- Page Lifecycle --------------------
  document.addEventListener("pageChanged", async (e) => {
    if (e.detail.page === "search") {
      await loadSearchSCIDs();
    }
  });

  // -------------------- Node Lifecycle --------------------
  document.addEventListener("nodeConnected", async () => {
    if (statusEl) statusEl.textContent = "⏳ Loading apps...";
    searchBox.disabled = false;
    await loadSearchSCIDs();
  });

  // Catalog may have finished before this page loaded
  (async () => {
    try {
      const resp = await fetch(`${apiBase}/indexedscs`);
      if (!resp.ok) return;
      const data = await resp.json();
      const count = Object.keys(data.indexedscs || {}).length;
      if (count > 0) {
        searchBox.disabled = false;
        await loadSearchSCIDs();
      }
    } catch {}
  })();

})();