(function () {
  // Win95 Theme — wraps major surfaces in decorative window chrome,
  // adds a status bar to the chat surface, and observes the send/stop
  // button to mirror generation state. CSS does the heavy lifting; this
  // file only adds the elements CSS can't conjure on its own.
  //
  // Settings panel: Ctrl+Shift+9 or visit #win95.

  var CHAT_SURFACES = [
    { selector: '[data-component="ChatArea.Conversation"]', title: "Marinara — Conversation", statusbar: true },
    { selector: '[data-component="ChatArea.Roleplay"]',     title: "Marinara — Roleplay",     statusbar: true },
  ];
  var PANEL_SURFACES = [
    // The right panel renders its own header with a close button per
    // active section (Settings, Characters, etc.) — wrapping it in a
    // Win95 titlebar produced a double header. Skinning is CSS-only.
    { selector: '[data-component="ChatSidebar"]', title: "Chats" },
  ];
  var SEND_BTN_SELECTOR = ".mari-chat-send-btn";
  var POLL_MS = 1000;

  var KEY_CHROME = "marinara-win95-chrome";
  var KEY_STATUSBAR = "marinara-win95-statusbar";

  function readBool(key, def) {
    var v = localStorage.getItem(key);
    return v === null ? def : v === "true";
  }
  function writeBool(key, val) { localStorage.setItem(key, val ? "true" : "false"); }

  var statusEl = null, sendObserver = null, lastStatus = null;
  var panel = null, panelLoad = null;

  // ── Window chrome ────────────────────────────────────────────────
  function makeTitlebar(title) {
    var bar = document.createElement("div");
    bar.className = "win95-titlebar";
    bar.setAttribute("data-win95-chrome", "titlebar");
    bar.setAttribute("aria-hidden", "true");
    bar.innerHTML =
      '<span class="win95-titlebar-title"></span>' +
      '<div class="win95-titlebar-buttons">' +
        '<button class="win95-titlebar-btn win95-skip" data-act="min" aria-label="Minimize">_</button>' +
        '<button class="win95-titlebar-btn win95-skip" data-act="max" aria-label="Maximize">□</button>' +
        '<button class="win95-titlebar-btn win95-skip" data-act="close" aria-label="Close">×</button>' +
      '</div>';
    bar.querySelector(".win95-titlebar-title").textContent = title;
    // Buttons are decorative — clicks do nothing destructive.
    bar.querySelectorAll(".win95-titlebar-btn").forEach(function (btn) {
      marinara.on(btn, "click", function (e) { e.preventDefault(); e.stopPropagation(); });
    });
    return bar;
  }

  function ensureChrome(surface, title, withStatusbar) {
    if (!surface) return;
    if (!readBool(KEY_CHROME, true)) {
      removeChrome(surface);
      return;
    }
    surface.classList.add("win95-window");
    if (withStatusbar) surface.classList.add("has-statusbar");

    if (!surface.querySelector(':scope > [data-win95-chrome="titlebar"]')) {
      var bar = makeTitlebar(title);
      // Prepend our element alongside React's children — never touch them.
      surface.insertBefore(bar, surface.firstChild);
      // Ensure cleanup removes the node when the extension unloads.
      marinara.onCleanup(function () { try { bar.remove(); } catch (e) {} });
    }

    if (withStatusbar && !surface.querySelector(':scope > [data-win95-chrome="statusbar"]')) {
      var sb = document.createElement("div");
      sb.className = "win95-statusbar";
      sb.setAttribute("data-win95-chrome", "statusbar");
      sb.setAttribute("aria-hidden", "true");
      sb.innerHTML =
        '<div class="win95-statusbar-cell" data-win95-status="state">Ready</div>' +
        '<div class="win95-statusbar-cell is-fixed" data-win95-status="hint">Marinara Engine</div>';
      surface.appendChild(sb);
      statusEl = sb.querySelector('[data-win95-status="state"]');
      marinara.onCleanup(function () { try { sb.remove(); } catch (e) {} });
    } else if (withStatusbar) {
      statusEl = surface.querySelector('[data-win95-status="state"]');
    }
  }

  function removeChrome(surface) {
    if (!surface) return;
    surface.classList.remove("win95-window", "has-statusbar");
    surface.querySelectorAll(':scope > [data-win95-chrome]').forEach(function (n) { n.remove(); });
  }

  function refreshAllChrome() {
    CHAT_SURFACES.forEach(function (cfg) {
      ensureChrome(document.querySelector(cfg.selector), cfg.title, cfg.statusbar);
    });
    PANEL_SURFACES.forEach(function (cfg) {
      ensureChrome(document.querySelector(cfg.selector), cfg.title, false);
    });
  }

  // ── Status bar ───────────────────────────────────────────────────
  function detectStreaming() {
    // Fallback — streaming state lives in Zustand, not the DOM. OR
    // several stable DOM signatures so any one hit flips us to
    // "Generating…":
    //   1. Tailwind arbitrary-value `[animation-delay:0ms]` — used in
    //      the three places the engine renders typing dots, all of
    //      which only mount while streaming. Most reliable signal.
    //   2. `.mari-message-typing` class wrapper (older path).
    //   3. `.rpg-streaming` class on a roleplay bubble.
    //   4. Stop-* icon under the send button (Lucide).
    //   5. `hover:opacity-80` on the send button — streaming branch only.
    // (a) The send button's `title` attribute flips between "Send"
    // and "Stop" based on streaming state — most reliable signal.
    // Confirmed via DevTools: the button carries `title="Stop"` only
    // while a generation is in flight.
    if (document.querySelector('button[title="Stop"]')) return true;
    // (b) The streaming message bubble mounts with id "__streaming__"
    // once content starts arriving. Misses the pre-content typing
    // phase but covers everything after the first token.
    if (document.querySelector('[data-message-id="__streaming__"]')) return true;
    // (b) Pre-content typing indicator: the engine renders "<X> is
    // typing..." in an italic span with no class hook (wrapper is a
    // generic div, dots use inline-style animation delays). Scan
    // spans inside the chat surface for that literal text — short
    // length filter so a real message containing the words doesn't
    // false-positive.
    var area = document.querySelector(".mari-chat-area, .rpg-chat-area");
    if (area) {
      var spans = area.querySelectorAll("span");
      for (var i = 0; i < spans.length; i++) {
        var t = spans[i].textContent;
        if (t && t.length < 80 && t.indexOf(" is typing") !== -1) return true;
      }
    }
    // (c) ChatMessage's typing-dot spans use the Tailwind class
    // `[animation-delay:0ms]`. ConversationView's dots use an inline
    // style instead, which is why (b) above exists.
    if (document.querySelector('[class*="animation-delay:0ms"]')) return true;
    if (document.querySelector(".mari-message-typing")) return true;
    if (document.querySelector(".rpg-streaming")) return true;
    var btn = document.querySelector(SEND_BTN_SELECTOR);
    if (btn) {
      if (btn.querySelector('[class*="stop"]')) return true;
      var cls = btn.className || "";
      if (typeof cls === "string" && cls.indexOf("hover:opacity-80") !== -1) return true;
    }
    return false;
  }

  function updateStatus() {
    if (!readBool(KEY_STATUSBAR, true)) return;
    if (!statusEl) return;
    var streaming = detectStreaming();
    var next = streaming ? "Generating…" : "Ready";
    if (next === lastStatus) return;
    lastStatus = next;
    statusEl.textContent = next;
  }

  function attachSendObserver() {
    if (sendObserver) return;
    var btn = document.querySelector(SEND_BTN_SELECTOR);
    if (!btn) return;
    sendObserver = marinara.observe(btn, updateStatus, { childList: true, subtree: true, attributes: true });
    updateStatus();
  }

  function reattachSendObserver() {
    if (sendObserver) {
      try { sendObserver.disconnect(); } catch (e) {}
      sendObserver = null;
    }
    attachSendObserver();
  }

  // ── Settings panel ───────────────────────────────────────────────
  function buildPanel() {
    if (panel) return;
    panel = marinara.addElement("body", "div", { class: "win95-settings is-hidden" });
    if (!panel) return;
    panel.innerHTML =
      '<div class="win95-settings-titlebar">' +
        '<span class="win95-settings-titlebar-title">Win95 Theme — Settings</span>' +
        '<button class="win95-titlebar-btn win95-skip" data-w95="close" aria-label="Close">×</button>' +
      '</div>' +
      '<div class="win95-settings-body">' +
        '<div class="win95-settings-row">' +
          '<input type="checkbox" id="w95-chrome" data-w95="chrome">' +
          '<label for="w95-chrome">Show window chrome (titlebars)</label>' +
        '</div>' +
        '<div class="win95-settings-row">' +
          '<input type="checkbox" id="w95-statusbar" data-w95="statusbar">' +
          '<label for="w95-statusbar">Show chat status bar</label>' +
        '</div>' +
        '<p class="win95-settings-help">Press <b>Ctrl+Shift+9</b> or visit <b>#win95</b> to reopen this panel. Settings persist in your browser.</p>' +
        '<div class="win95-settings-actions">' +
          '<button class="win95-skip" data-w95="reset">Reset</button>' +
          '<button class="win95-skip" data-w95="ok">OK</button>' +
        '</div>' +
      '</div>';

    var qs = function (sel) { return panel.querySelector(sel); };
    var chromeEl = qs('[data-w95="chrome"]');
    var statusEl2 = qs('[data-w95="statusbar"]');

    panelLoad = function () {
      chromeEl.checked = readBool(KEY_CHROME, true);
      statusEl2.checked = readBool(KEY_STATUSBAR, true);
    };

    marinara.on(chromeEl, "change", function () {
      writeBool(KEY_CHROME, chromeEl.checked);
      refreshAllChrome();
    });
    marinara.on(statusEl2, "change", function () {
      writeBool(KEY_STATUSBAR, statusEl2.checked);
      refreshAllChrome();
      updateStatus();
    });
    marinara.on(qs('[data-w95="reset"]'), "click", function () {
      localStorage.removeItem(KEY_CHROME);
      localStorage.removeItem(KEY_STATUSBAR);
      panelLoad();
      refreshAllChrome();
    });
    marinara.on(qs('[data-w95="ok"]'), "click", hidePanel);
    marinara.on(qs('[data-w95="close"]'), "click", hidePanel);
  }

  function showPanel() { if (!panel) buildPanel(); if (!panel) return; panelLoad(); panel.classList.remove("is-hidden"); }
  function hidePanel() { if (panel) panel.classList.add("is-hidden"); }
  function togglePanel() {
    if (!panel || panel.classList.contains("is-hidden")) showPanel();
    else hidePanel();
  }

  function checkHash() {
    var h = (location.hash || "").toLowerCase();
    if (h === "#win95" || h === "#win95-settings") {
      showPanel();
      try {
        history.replaceState(null, "", location.pathname + location.search);
      } catch (e) { location.hash = ""; }
    }
  }

  function onKeydown(e) {
    if (e.key === "Escape" && panel && !panel.classList.contains("is-hidden")) {
      hidePanel();
      return;
    }
    if (e.key === "9" && e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      togglePanel();
    }
  }

  // ── Pixel-art icon swap ──────────────────────────────────────────
  // Replaces Lucide icon SVGs with 16×16 pixel-art equivalents. Only
  // the inner geometry, viewBox, and shape-rendering are swapped — the
  // outer <svg> element keeps the parent's sizing classes, so layout
  // is untouched. All paths use `currentColor` so the icon inherits
  // its container's text color (works in dark buttons, light status
  // bars, beveled toolbars, etc).
  //
  // To add an icon: append an entry to WIN95_ICONS keyed by the Lucide
  // kebab-case name (the bit after `lucide-` in the SVG's class). The
  // value is the inner SVG markup on a 16-unit grid.
  var WIN95_ICONS = {
    "x":             '<polygon points="3,4 4,3 8,7 12,3 13,4 9,8 13,12 12,13 8,9 4,13 3,12 7,8"/>',
    "plus":          '<rect x="7" y="3" width="2" height="10"/><rect x="3" y="7" width="10" height="2"/>',
    "chevron-down":  '<polygon points="3,5 13,5 8,11"/>',
    "chevron-up":    '<polygon points="3,11 13,11 8,5"/>',
    "chevron-left":  '<polygon points="11,3 11,13 5,8"/>',
    "chevron-right": '<polygon points="5,3 5,13 11,8"/>',
    // Bold right-arrow read as "send" — paper-plane geometry doesn't
    // pixel-art cleanly at 16×16.
    "send":          '<polygon points="2,7 10,7 10,4 14,8 10,12 10,9 2,9"/>',
    "stop-circle":   '<path fill-rule="evenodd" d="M2 2h12v12H2zM3 3v10h10V3z"/><rect x="6" y="6" width="4" height="4"/>',
    "settings":      '<path fill-rule="evenodd" d="M6 1h4v2H6zM6 13h4v2H6zM1 6h2v4H1zM13 6h2v4h-2zM3 3h10v10H3zM6 6h4v4H6z"/>',
    "settings-2":    '<path fill-rule="evenodd" d="M6 1h4v2H6zM6 13h4v2H6zM1 6h2v4H1zM13 6h2v4h-2zM3 3h10v10H3zM6 6h4v4H6z"/>',
    "trash":         '<rect x="3" y="3" width="10" height="2"/><rect x="6" y="1" width="4" height="2"/><path fill-rule="evenodd" d="M4 5h8v9H4zM6 7h1v5H6zM9 7h1v5H9z"/>',
    "trash-2":       '<rect x="3" y="3" width="10" height="2"/><rect x="6" y="1" width="4" height="2"/><path fill-rule="evenodd" d="M4 5h8v9H4zM6 7h1v5H6zM9 7h1v5H9z"/>',
    "search":        '<path fill-rule="evenodd" d="M2 2h7v7H2zM3 3v5h5V3z"/><rect x="9" y="9" width="2" height="2"/><rect x="11" y="11" width="2" height="2"/><rect x="13" y="13" width="2" height="2"/>',
    "home":          '<path fill-rule="evenodd" d="M8 2L1 8h2v6h10V8h2zM7 10v4h2v-4z"/>',
    "sparkles":      '<polygon points="6,2 7,5 10,6 7,7 6,10 5,7 2,6 5,5"/><rect x="11" y="2" width="2" height="3"/><rect x="10" y="3" width="4" height="1"/><rect x="11" y="11" width="2" height="3"/><rect x="10" y="12" width="4" height="1"/>',
    "smile":         '<path fill-rule="evenodd" d="M2 2h12v12H2zM3 3v10h10V3z"/><rect x="5" y="6" width="2" height="2"/><rect x="9" y="6" width="2" height="2"/><rect x="5" y="10" width="6" height="1"/>',
    "user":          '<rect x="6" y="2" width="4" height="4"/><rect x="4" y="8" width="8" height="1"/><rect x="3" y="9" width="10" height="5"/>',
    "users":         '<rect x="4" y="3" width="3" height="3"/><rect x="9" y="3" width="3" height="3"/><rect x="2" y="8" width="7" height="6"/><rect x="7" y="8" width="7" height="6"/>',
    "circle-user":   '<path fill-rule="evenodd" d="M2 2h12v12H2zM3 3v10h10V3zM6 5h4v3H6zM4 10h8v3H4z"/>',
    "paperclip":     '<path fill-rule="evenodd" d="M5 2h6v11H5zM7 4v7h2V4z"/><rect x="6" y="13" width="4" height="1"/>',
    "link":          '<path fill-rule="evenodd" d="M2 5h5v6H2zM3 6v4h3V6zM9 5h5v6H9zM10 6v4h3V6z"/><rect x="6" y="7" width="4" height="2"/>',
    "help-circle":   '<path fill-rule="evenodd" d="M2 2h12v12H2zM3 3v10h10V3z"/><rect x="6" y="4" width="4" height="1"/><rect x="9" y="5" width="1" height="2"/><rect x="7" y="7" width="2" height="2"/><rect x="7" y="11" width="2" height="1"/>',
    "panel-left":    '<path fill-rule="evenodd" d="M2 2h12v12H2zM3 3v10h10V3z"/><rect x="3" y="3" width="3" height="10"/>',
    "panel-right":   '<path fill-rule="evenodd" d="M2 2h12v12H2zM3 3v10h10V3z"/><rect x="10" y="3" width="3" height="10"/>',
    "image":         '<path fill-rule="evenodd" d="M2 2h12v12H2zM3 3v10h10V3z"/><rect x="5" y="5" width="2" height="2"/><polygon points="3,12 6,8 9,11 11,9 13,12 13,13 3,13"/>',
    "image-icon":    '<path fill-rule="evenodd" d="M2 2h12v12H2zM3 3v10h10V3z"/><rect x="5" y="5" width="2" height="2"/><polygon points="3,12 6,8 9,11 11,9 13,12 13,13 3,13"/>',
    "image-plus":    '<path fill-rule="evenodd" d="M2 2h12v12H2zM3 3v10h10V3z"/><rect x="5" y="5" width="2" height="2"/><polygon points="3,12 6,8 9,11 11,9 13,12 13,13 3,13"/>',
    "image-play":    '<path fill-rule="evenodd" d="M2 2h12v12H2zM3 3v10h10V3z"/><polygon points="6,5 11,8 6,11"/>',
    "folder":        '<path fill-rule="evenodd" d="M2 4h5v2H2zM2 5h12v9H2zM3 7v6h10V7z"/>',
    "folder-open":   '<path fill-rule="evenodd" d="M2 4h5v2H2zM2 5h12v9H2zM3 7v6h10V7z"/>',
    "file-text":     '<path fill-rule="evenodd" d="M3 2h10v12H3zM4 3v10h8V3z"/><rect x="5" y="5" width="6" height="1"/><rect x="5" y="7" width="6" height="1"/><rect x="5" y="9" width="6" height="1"/><rect x="5" y="11" width="4" height="1"/>',
    "file-json":     '<path fill-rule="evenodd" d="M3 2h10v12H3zM4 3v10h8V3z"/><rect x="5" y="5" width="6" height="1"/><rect x="5" y="7" width="6" height="1"/><rect x="5" y="9" width="6" height="1"/><rect x="5" y="11" width="4" height="1"/>',
    "book-open":     '<path fill-rule="evenodd" d="M2 3h5v10H2zM3 4v8h3V4zM9 3h5v10H9zM10 4v8h3V4z"/><rect x="7" y="3" width="2" height="10"/>',
    "book":          '<rect x="2" y="3" width="2" height="11"/><path fill-rule="evenodd" d="M4 3h9v11H4zM5 4v9h7V4z"/>',
    "store":         '<rect x="1" y="3" width="14" height="2"/><path fill-rule="evenodd" d="M2 5h12v9H2zM6 9v5h4V9z"/>',
    "briefcase":     '<path fill-rule="evenodd" d="M5 2h6v3H5zM6 3v1h4V3z"/><rect x="2" y="5" width="12" height="9"/>',
    "package":       '<path fill-rule="evenodd" d="M2 4h12v10H2zM3 5v8h10V5z"/><rect x="2" y="4" width="12" height="2"/><rect x="7" y="4" width="2" height="10"/>',
    "power":         '<rect x="7" y="2" width="2" height="5"/><path fill-rule="evenodd" d="M3 5h10v9H3zM4 6v7h8V6z"/>',
    "globe":         '<path fill-rule="evenodd" d="M2 2h12v12H2zM3 3v4h4V3zM9 3v4h4V3zM3 9v4h4V9zM9 9v4h4V9z"/>',
    "pen-line":      '<rect x="2" y="13" width="12" height="1"/><polygon points="3,9 5,11 11,5 9,3"/>',
    "pencil":        '<polygon points="2,12 2,14 4,14 14,4 12,2"/>',
    "pin":           '<rect x="6" y="2" width="4" height="6"/><rect x="5" y="8" width="6" height="1"/><rect x="7" y="9" width="2" height="5"/>',
    "puzzle":        '<path fill-rule="evenodd" d="M2 4h5v3H2zM2 9h5v5H2zM7 4h2v2H7zM9 6h5v3H9zM7 11h7v3H7z"/>',
    "theater":       '<path fill-rule="evenodd" d="M2 3h6v10H2zM3 4v8h4V4zM8 3h6v10H8zM9 4v8h4V4z"/>',
    "paintbrush":    '<rect x="11" y="2" width="3" height="3"/><polygon points="2,14 4,12 12,4 14,6 6,14"/>',
    "smile-icon":    '<path fill-rule="evenodd" d="M2 2h12v12H2zM3 3v10h10V3z"/><rect x="5" y="6" width="2" height="2"/><rect x="9" y="6" width="2" height="2"/><rect x="5" y="10" width="6" height="1"/>',
    // 6-arm asterisk for `regex` (matches Lucide's regex marker — also
    // covers wildcards / glob patterns where it appears).
    "regex":         '<rect x="7" y="2" width="2" height="12"/><polygon points="3,4 4,3 13,12 12,13"/><polygon points="12,3 13,4 4,13 3,12"/>',
    "asterisk":      '<rect x="7" y="2" width="2" height="12"/><polygon points="3,4 4,3 13,12 12,13"/><polygon points="12,3 13,4 4,13 3,12"/>',
    "moon":          '<path d="M5 2h4v1H5zm-2 1h2v1H3zm-1 1h1v6H2zm1 6h1v2H3zm1 2h2v1H4zm2 1h6v1H6zm0-2h7v1H6zM5 9h7v1H5zM5 7h6v1H5zM5 5h6v1H5zM6 3h5v1H6z"/>',
    "loader":        '<rect x="7" y="2" width="2" height="3"/><rect x="7" y="11" width="2" height="3"/><rect x="2" y="7" width="3" height="2"/><rect x="11" y="7" width="3" height="2"/>',
    "loader-2":      '<rect x="7" y="2" width="2" height="3"/><rect x="7" y="11" width="2" height="3"/><rect x="2" y="7" width="3" height="2"/><rect x="11" y="7" width="3" height="2"/>',
  };

  var ICON_MARK_ATTR = "data-win95-icon";

  // The chrome surfaces are the only places we observe — never
  // document.body, which would tick on every streaming token.
  var ICON_OBSERVE_TARGETS = [
    '[data-component="ChatArea.Conversation"]',
    '[data-component="ChatArea.Roleplay"]',
    '[data-component="ChatSidebar"]',
    '[data-component="RightPanel"]',
    '[data-component="Modal"]',
  ];
  var iconObserved = new WeakSet();

  function lucideName(svg) {
    var cls = svg.getAttribute("class") || "";
    var m = cls.match(/\blucide-([a-z0-9-]+)\b/);
    // Skip the bare `lucide` class — that's the base, not an icon name.
    return m && m[1] !== "icon" ? m[1] : null;
  }

  function swapIcon(svg) {
    if (svg.hasAttribute(ICON_MARK_ATTR)) return;
    var name = lucideName(svg);
    if (!name) return;
    var inner = WIN95_ICONS[name];
    if (!inner) return;
    svg.setAttribute(ICON_MARK_ATTR, name);
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("shape-rendering", "crispEdges");
    svg.innerHTML = inner;
    // Lucide's stroke styling shadows our flat fills if left in place.
    svg.removeAttribute("stroke-width");
    svg.removeAttribute("stroke-linecap");
    svg.removeAttribute("stroke-linejoin");
    svg.style.fill = "currentColor";
    svg.style.stroke = "none";
  }

  function swapIconsIn(root) {
    if (!root || !root.querySelectorAll) return;
    var svgs = root.querySelectorAll('svg[class*="lucide-"]:not([' + ICON_MARK_ATTR + '])');
    for (var i = 0; i < svgs.length; i++) swapIcon(svgs[i]);
  }

  function handleIconMutations(mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var added = mutations[i].addedNodes;
      for (var j = 0; j < added.length; j++) {
        var n = added[j];
        if (n.nodeType !== 1) continue;
        if (n.matches && n.matches('svg[class*="lucide-"]')) swapIcon(n);
        else swapIconsIn(n);
      }
    }
  }

  function attachIconObservers() {
    ICON_OBSERVE_TARGETS.forEach(function (sel) {
      var els = document.querySelectorAll(sel);
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (iconObserved.has(el)) continue;
        iconObserved.add(el);
        swapIconsIn(el);
        marinara.observe(el, handleIconMutations, { childList: true, subtree: true });
      }
    });
  }

  // ── Boot ─────────────────────────────────────────────────────────
  marinara.on(window, "keydown", onKeydown);
  marinara.on(window, "hashchange", checkHash);
  checkHash();

  // Periodically reconcile chrome + the send-button observer so chat
  // mode switches and surface remounts pick up automatically. 1Hz is
  // cheap and avoids a body-wide MutationObserver.
  marinara.setInterval(function () {
    refreshAllChrome();
    if (!document.querySelector(SEND_BTN_SELECTOR + " *")) {
      // Send button gone (e.g. no active chat) — drop the observer; it
      // will reattach next tick once the button reappears.
      if (sendObserver) { try { sendObserver.disconnect(); } catch (e) {} sendObserver = null; }
    } else if (!sendObserver) {
      attachSendObserver();
    }
    updateStatus();
    attachIconObservers();
    // Chrome elements (titlebar, statusbar) and our settings panel
    // also contain icons we want swapped — body-scoped sweep, but
    // narrowed to unmarked Lucide SVGs only so it's cheap.
    swapIconsIn(document.body);
  }, POLL_MS);

  refreshAllChrome();
  attachSendObserver();
  attachIconObservers();
  swapIconsIn(document.body);
  updateStatus();
})();
