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
  var KEY_BOOTSPLASH = "marinara-win95-bootsplash";
  var KEY_SOUNDS = "marinara-win95-sounds";
  var SESSION_BOOT_KEY = "win95-boot-shown";
  var SESSION_BOOT_CHIME_KEY = "win95-boot-chime-played";

  // Titlebar-button state machine — `_` minimize, `□` maximize,
  // `×` close. State stored per-surface under STATE_KEY_PREFIX + key.
  var STATE_KEY_PREFIX = "marinara-win95-state-";
  // Surface key used in localStorage. Resolved from the surface's
  // data-component attribute. Sidebar gets "sidebar" since
  // [data-component="ChatSidebar"] won't have a matching CHAT_SURFACES
  // / PANEL_SURFACES key in this map by default.
  function getSurfaceKey(el) {
    if (!el) return null;
    var dc = el.getAttribute("data-component") || "";
    if (dc === "ChatArea.Conversation") return "chat-conversation";
    if (dc === "ChatArea.Roleplay")     return "chat-roleplay";
    if (dc === "ChatSidebar")           return "sidebar";
    return null;
  }
  function getStoredState(key) {
    return localStorage.getItem(STATE_KEY_PREFIX + key) || "normal";
  }
  function storeState(key, state) {
    if (!state || state === "normal") localStorage.removeItem(STATE_KEY_PREFIX + key);
    else localStorage.setItem(STATE_KEY_PREFIX + key, state);
  }
  // Apply a state to a surface: clear all win95-state-* classes,
  // add the one for the target state (if not "normal"), and toggle
  // body.win95-chat-max so the sidebar/right-panel hide CSS fires
  // when any chat surface is maximized.
  function applyTitlebarState(surface, state) {
    if (!surface) return;
    surface.classList.remove("win95-state-min", "win95-state-max", "win95-state-closed");
    if (state && state !== "normal") {
      surface.classList.add("win95-state-" + state);
    }
    var anyMax = !!document.querySelector(
      '[data-component="ChatArea.Conversation"].win95-state-max,' +
      '[data-component="ChatArea.Roleplay"].win95-state-max'
    );
    document.body.classList.toggle("win95-chat-max", anyMax);
  }
  function handleTitlebarClick(action, surface) {
    var key = getSurfaceKey(surface);
    if (!key) return;
    // Sidebar's `□` is a no-op — sidebar is fixed-width and
    // "maximizing" it would conflict with the AppShell layout.
    if (action === "max" && key === "sidebar") return;
    var current = getStoredState(key);
    var target = "normal";
    if (action === "min")   target = (current === "min"    ? "normal" : "min");
    if (action === "max")   target = (current === "max"    ? "normal" : "max");
    if (action === "close") target = (current === "closed" ? "normal" : "closed");
    storeState(key, target);
    applyTitlebarState(surface, target);
  }
  // Restore persisted state for a freshly-mounted surface (called
  // from ensureChrome after the titlebar is attached).
  function restoreTitlebarState(surface) {
    var key = getSurfaceKey(surface);
    if (!key) return;
    var saved = getStoredState(key);
    if (saved !== "normal") applyTitlebarState(surface, saved);
  }
  function restoreAllWindows() {
    ["chat-conversation", "chat-roleplay", "sidebar"].forEach(function (k) {
      storeState(k, "normal");
    });
    document.querySelectorAll(".win95-state-min, .win95-state-max, .win95-state-closed").forEach(function (el) {
      el.classList.remove("win95-state-min", "win95-state-max", "win95-state-closed");
    });
    document.body.classList.remove("win95-chat-max");
  }

  function readBool(key, def) {
    var v = localStorage.getItem(key);
    return v === null ? def : v === "true";
  }
  function writeBool(key, val) { localStorage.setItem(key, val ? "true" : "false"); }

  var statusEl = null, sendObserver = null, lastStatus = null;
  var panel = null, panelLoad = null;

  // ── Window chrome ────────────────────────────────────────────────
  // Titlebar buttons used to embed `_` `□` `×` text glyphs but their
  // baseline + size was font-dependent and made the symbols sit
  // off-center inside the 16×14 button box. Embedded SVG gives us
  // pixel-perfect placement on any font/zoom level.
  var TITLEBAR_GLYPH_MIN =
    '<svg viewBox="0 0 16 14" width="10" height="10" shape-rendering="crispEdges">' +
      '<rect x="3" y="11" width="8" height="2" fill="currentColor"/>' +
    '</svg>';
  var TITLEBAR_GLYPH_MAX =
    '<svg viewBox="0 0 16 14" width="10" height="10" shape-rendering="crispEdges">' +
      '<path fill="currentColor" fill-rule="evenodd" d="M3 2h10v10H3zM4 4v7h8V4z"/>' +
    '</svg>';
  var TITLEBAR_GLYPH_CLOSE =
    '<svg viewBox="0 0 16 14" width="10" height="10" shape-rendering="crispEdges">' +
      '<polygon fill="currentColor" points="3,3 4,2 8,6 12,2 13,3 9,7 13,11 12,12 8,8 4,12 3,11 7,7"/>' +
    '</svg>';

  function makeTitlebar(title) {
    var bar = document.createElement("div");
    bar.className = "win95-titlebar";
    bar.setAttribute("data-win95-chrome", "titlebar");
    bar.setAttribute("aria-hidden", "true");
    bar.innerHTML =
      '<span class="win95-titlebar-title"></span>' +
      '<div class="win95-titlebar-buttons">' +
        '<button class="win95-titlebar-btn win95-skip" data-act="min" aria-label="Minimize">' + TITLEBAR_GLYPH_MIN + '</button>' +
        '<button class="win95-titlebar-btn win95-skip" data-act="max" aria-label="Maximize">' + TITLEBAR_GLYPH_MAX + '</button>' +
        '<button class="win95-titlebar-btn win95-skip" data-act="close" aria-label="Close">' + TITLEBAR_GLYPH_CLOSE + '</button>' +
      '</div>';
    bar.querySelector(".win95-titlebar-title").textContent = title;
    // Wire the three titlebar buttons to the min/max/close state
    // machine. Each click toggles the surface's state in localStorage
    // and re-applies the matching CSS class. Clicks are still
    // preventDefault'd to avoid any default browser behavior on the
    // <button> element (e.g. focus shift).
    bar.querySelectorAll(".win95-titlebar-btn").forEach(function (btn) {
      marinara.on(btn, "click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        var action = btn.getAttribute("data-act");
        var surface = btn.closest("[data-component]");
        if (action && surface) handleTitlebarClick(action, surface);
      });
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
      // Restore any persisted min/max/closed state for this
      // surface. Idempotent — if the state is "normal" or unsaved
      // this is a no-op.
      restoreTitlebarState(surface);
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
    var streaming = detectStreaming();
    var next = streaming ? "Generating…" : "Ready";
    // Always detect Generating→Ready transition (= a streaming
    // message finished) so the sound hook fires regardless of
    // whether the statusbar is visible.
    if (lastStatus === "Generating…" && next === "Ready") {
      ding();
    }
    if (next !== lastStatus) lastStatus = next;
    if (!readBool(KEY_STATUSBAR, true)) return;
    if (!statusEl) return;
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
        '<button class="win95-titlebar-btn win95-skip" data-w95="close" aria-label="Close">' + TITLEBAR_GLYPH_CLOSE + '</button>' +
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
        '<div class="win95-settings-row">' +
          '<input type="checkbox" id="w95-bootsplash" data-w95="bootsplash">' +
          '<label for="w95-bootsplash">Show boot splash on session start</label>' +
        '</div>' +
        '<div class="win95-settings-row">' +
          '<input type="checkbox" id="w95-sounds" data-w95="sounds">' +
          '<label for="w95-sounds">Play Win95 system sounds (chime / ding / error)</label>' +
        '</div>' +
        '<div class="win95-settings-row">' +
          '<button class="win95-skip" data-w95="splash-now" style="margin-left: 22px; padding: 2px 10px;">Show splash now</button>' +
        '</div>' +
        '<div class="win95-settings-row">' +
          '<button class="win95-skip" data-w95="restore-all" style="margin-left: 22px; padding: 2px 10px;">Restore all windows</button>' +
        '</div>' +
        '<p class="win95-settings-help">Press <b>Ctrl+Shift+9</b> or visit <b>#win95</b> to reopen this panel. Settings persist in your browser. Titlebar buttons (<b>_ □ ×</b>) toggle each surface\'s minimize / maximize / close state.</p>' +
        '<div class="win95-settings-actions">' +
          '<button class="win95-skip" data-w95="reset">Reset</button>' +
          '<button class="win95-skip" data-w95="ok">OK</button>' +
        '</div>' +
      '</div>';

    var qs = function (sel) { return panel.querySelector(sel); };
    var chromeEl = qs('[data-w95="chrome"]');
    var statusEl2 = qs('[data-w95="statusbar"]');
    var bootEl = qs('[data-w95="bootsplash"]');
    var soundsEl = qs('[data-w95="sounds"]');

    panelLoad = function () {
      chromeEl.checked = readBool(KEY_CHROME, true);
      statusEl2.checked = readBool(KEY_STATUSBAR, true);
      bootEl.checked = readBool(KEY_BOOTSPLASH, true);
      soundsEl.checked = readBool(KEY_SOUNDS, true);
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
    marinara.on(bootEl, "change", function () {
      writeBool(KEY_BOOTSPLASH, bootEl.checked);
    });
    marinara.on(soundsEl, "change", function () {
      writeBool(KEY_SOUNDS, soundsEl.checked);
      if (soundsEl.checked) {
        // Preview the chime so the user hears what they enabled.
        // Uses the existing audio context — counts as a user
        // gesture, so AudioContext should already be unlocked.
        var ac = getAudioContext();
        if (ac && ac.state === "suspended") { try { ac.resume(); } catch (e) {} }
        marinara.setTimeout(bootChime, 100);
      }
    });
    marinara.on(qs('[data-w95="splash-now"]'), "click", function () {
      hidePanel();
      // Slight delay so the panel is gone before the splash mounts
      // (otherwise the panel's click-to-close swallows the splash's
      // click-to-dismiss handler).
      marinara.setTimeout(function () { showBootSplash({ force: true }); }, 50);
    });
    marinara.on(qs('[data-w95="restore-all"]'), "click", function () {
      restoreAllWindows();
    });
    marinara.on(qs('[data-w95="reset"]'), "click", function () {
      localStorage.removeItem(KEY_CHROME);
      localStorage.removeItem(KEY_STATUSBAR);
      localStorage.removeItem(KEY_BOOTSPLASH);
      localStorage.removeItem(KEY_SOUNDS);
      restoreAllWindows();
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
    // Use `e.code === "Digit9"` instead of `e.key === "9"` — with
    // Shift held, `e.key` becomes "(" on US layouts (and varies by
    // locale: "ç", "º", etc). `e.code` is layout-independent and
    // always reports the physical key. v2.7 bugfix: prior version
    // checked `e.key === "9"` which never matched once Shift was
    // down, silently breaking the shortcut.
    if (e.code === "Digit9" && e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey) {
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
    // Tighter again: 4x4 lens + 2-step handle. Visible bounds
    // x=3..11 (vs Lucide's full ~24-unit content). Combined with
    // the global `padding-left: 2.25rem` rule on Search * inputs
    // this should always clear placeholder text.
    "search":        '<path fill-rule="evenodd" d="M3 3h4v4H3zM4 4v2h2V4z"/><rect x="7" y="7" width="2" height="2"/><rect x="9" y="9" width="2" height="2"/>',
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
    // Toolbar / message-action icons.
    "heart":         '<polygon points="3,3 6,3 8,5 10,3 13,3 14,5 14,7 8,13 2,7 2,5"/>',
    "message-circle":'<path fill-rule="evenodd" d="M2 2h12v9H2zM3 3v7h10V3z"/><polygon points="4,11 7,11 4,14"/><rect x="5" y="6" width="2" height="1"/><rect x="9" y="6" width="2" height="1"/>',
    "copy":          '<path fill-rule="evenodd" d="M2 4h9v10H2zM3 5v8h7V5zM6 2h8v10H6zM7 3v8h6V3z"/>',
    "refresh-cw":    '<path fill-rule="evenodd" d="M3 4h8v8H3zM4 5v6h6V5z"/><rect x="11" y="3" width="2" height="1"/><polygon points="11,2 14,4 11,6"/>',
    "rotate-ccw":    '<path fill-rule="evenodd" d="M5 4h8v8H5zM6 5v6h6V5z"/><rect x="3" y="3" width="2" height="1"/><polygon points="5,2 2,4 5,6"/>',
    "git-branch":    '<rect x="4" y="3" width="2" height="10"/><rect x="10" y="6" width="2" height="7"/><rect x="6" y="6" width="4" height="2"/><rect x="3" y="2" width="4" height="3"/><rect x="3" y="11" width="4" height="3"/><rect x="9" y="3" width="4" height="3"/>',
    "languages":     '<polygon points="3,12 5,4 7,12 6,9 4,9"/><rect x="6" y="7" width="6" height="2"/><polygon points="11,5 14,8 11,11"/>',
    "trash-icon":    '<rect x="3" y="3" width="10" height="2"/><rect x="6" y="1" width="4" height="2"/><path fill-rule="evenodd" d="M4 5h8v9H4zM6 7h1v5H6zM9 7h1v5H9z"/>',
    "alert-circle":  '<path fill-rule="evenodd" d="M2 2h12v12H2zM3 3v10h10V3z"/><rect x="7" y="5" width="2" height="5"/><rect x="7" y="11" width="2" height="2"/>',
    "alert-triangle":'<path fill-rule="evenodd" d="M8 2L14 13L2 13zM7 6h2v4H7zM7 11h2v1H7z"/>',
    "triangle-alert":'<path fill-rule="evenodd" d="M8 2L14 13L2 13zM7 6h2v4H7zM7 11h2v1H7z"/>',
    "info":          '<path fill-rule="evenodd" d="M2 2h12v12H2zM3 3v10h10V3z"/><rect x="7" y="4" width="2" height="2"/><rect x="7" y="7" width="2" height="6"/>',
    // Check widened from 3 → 4 units thick so it stays readable
    // even when the engine forces small `width="0.75rem"` (~12px)
    // on theme-row indicators. Lower-edge: (1,7)→(5,11)→(12,4).
    // Upper-edge (offset +4 vertically): (12,8)→(5,15)→(1,11).
    "check":         '<polygon points="1,7 5,11 12,4 12,8 5,15 1,11"/>',
    "check-circle":  '<path fill-rule="evenodd" d="M2 2h12v12H2zM3 3v10h10V3z"/><polygon points="3,7 6,10 11,5 11,8 6,13 3,10"/>',
    "check-square":  '<path fill-rule="evenodd" d="M2 2h12v12H2zM3 3v10h10V3z"/><polygon points="3,7 6,10 11,5 11,8 6,13 3,10"/>',
    "square":        '<path fill-rule="evenodd" d="M2 2h12v12H2zM3 3v10h10V3z"/>',
    "circle":        '<path fill-rule="evenodd" d="M2 2h12v12H2zM3 3v10h10V3z"/>',
    "minimize":      '<rect x="3" y="11" width="10" height="2"/>',
    "minimize-2":    '<polygon points="9,7 13,3 13,5 11,7 13,9 13,11 9,11"/><polygon points="7,9 3,13 3,11 5,9 3,7 3,5 7,5"/>',
    "external-link": '<path fill-rule="evenodd" d="M2 4h8v10H2zM3 5v8h6V5z"/><rect x="9" y="2" width="5" height="1"/><rect x="13" y="2" width="1" height="5"/><polygon points="13,2 8,7 9,8 14,3"/>',
    // Eye icons (used as toggle indicators in lorebook Enabled, etc).
    // Pixel-art lens silhouette + center pupil square. Curves don't
    // render crisp under shape-rendering="crispEdges" so we use rects.
    "eye":           '<path fill-rule="evenodd" d="M2 7h12v3H2zM3 8v1h10V8z"/><rect x="7" y="6" width="2" height="4"/>',
    "eye-off":       '<path fill-rule="evenodd" d="M2 7h12v3H2zM3 8v1h10V8z"/><rect x="7" y="6" width="2" height="4"/><polygon points="2,12 4,14 14,4 12,2"/>',
    "moon":          '<path d="M5 2h4v1H5zm-2 1h2v1H3zm-1 1h1v6H2zm1 6h1v2H3zm1 2h2v1H4zm2 1h6v1H6zm0-2h7v1H6zM5 9h7v1H5zM5 7h6v1H5zM5 5h6v1H5zM6 3h5v1H6z"/>',
    "loader":        '<rect x="7" y="2" width="2" height="3"/><rect x="7" y="11" width="2" height="3"/><rect x="2" y="7" width="3" height="2"/><rect x="11" y="7" width="3" height="2"/>',
    "loader-2":      '<rect x="7" y="2" width="2" height="3"/><rect x="7" y="11" width="2" height="3"/><rect x="2" y="7" width="3" height="2"/><rect x="11" y="7" width="3" height="2"/>',
    // ─── Batch 3 (audit-driven): navigation, media, status, dice ───
    "bot":           '<path fill-rule="evenodd" d="M2 4h12v9H2zM3 5v7h10V5z"/><rect x="5" y="7" width="2" height="2"/><rect x="9" y="7" width="2" height="2"/><rect x="5" y="10" width="6" height="1"/><rect x="7" y="2" width="2" height="2"/>',
    "arrow-left":    '<polygon points="2,8 8,3 8,6 14,6 14,10 8,10 8,13"/>',
    "arrow-right":   '<polygon points="2,6 8,6 8,3 14,8 8,13 8,10 2,10"/>',
    "arrow-up":      '<polygon points="8,2 13,8 10,8 10,14 6,14 6,8 3,8"/>',
    "arrow-down":    '<polygon points="6,2 10,2 10,8 13,8 8,14 3,8 6,8"/>',
    "arrow-right-left":'<polygon points="2,5 6,2 6,4 14,4 14,6 6,6 6,8"/><polygon points="14,11 10,8 10,10 2,10 2,12 10,12 10,14"/>',
    "arrow-up-down": '<polygon points="4,1 7,4 5,4 5,11 7,11 4,14 1,11 3,11 3,4 1,4"/><polygon points="12,2 15,5 13,5 13,12 15,12 12,15 9,12 11,12 11,5 9,5"/>',
    "chevrons-down-up":'<polygon points="3,4 13,4 8,9"/><polygon points="3,12 13,12 8,7"/>',
    "chevrons-up-down":'<polygon points="3,8 8,3 13,8"/><polygon points="3,9 13,9 8,14"/>',
    "move":          '<polygon points="8,1 11,4 9,4 9,7 12,7 12,5 15,8 12,11 12,9 9,9 9,12 11,12 8,15 5,12 7,12 7,9 4,9 4,11 1,8 4,5 4,7 7,7 7,4 5,4"/>',
    // Floppy disk for save — chunky body with shutter slot top-left
    // and label window bottom (both as fill-rule cutouts).
    "save":          '<path fill-rule="evenodd" d="M2 2h12v12H2zM3 3v3h9V3zM4 9v4h8V9zM5 10v2h6v-2z"/><rect x="4" y="3" width="2" height="3"/>',
    "lock":          '<rect x="3" y="7" width="10" height="7"/><path fill-rule="evenodd" d="M4 2h8v6H4zM5 3v5h6V3z"/>',
    "unlock":        '<rect x="3" y="7" width="10" height="7"/><path fill-rule="evenodd" d="M4 2h8v3H4zM5 3v2h6V3zM4 5h3v3H4zM5 6v2h2V6z"/>',
    "play":          '<polygon points="3,3 13,8 3,13"/>',
    "pause":         '<rect x="3" y="3" width="3" height="10"/><rect x="10" y="3" width="3" height="10"/>',
    // Two prongs sticking up out of the plug body, with a cord
    // trailing down. Reads as electrical plug for connection icons.
    "plug":          '<rect x="6" y="2" width="2" height="3"/><rect x="10" y="2" width="2" height="3"/><rect x="4" y="5" width="10" height="6"/><rect x="8" y="11" width="2" height="4"/>',
    "star":          '<polygon points="8,1 10,6 15,6 11,9 13,14 8,11 3,14 5,9 1,6 6,6"/>',
    "hash":          '<rect x="4" y="2" width="2" height="12"/><rect x="10" y="2" width="2" height="12"/><rect x="2" y="5" width="12" height="2"/><rect x="2" y="9" width="12" height="2"/>',
    "download":      '<rect x="7" y="2" width="2" height="6"/><polygon points="4,7 12,7 8,12"/><rect x="2" y="13" width="12" height="2"/>',
    "camera":        '<path fill-rule="evenodd" d="M2 5h12v9H2zM3 6v7h10V6zM5 8h6v4H5zM6 9v2h4V9z"/><rect x="6" y="3" width="4" height="2"/>',
    "clock":         '<path fill-rule="evenodd" d="M2 2h12v12H2zM3 3v10h10V3z"/><rect x="7" y="5" width="2" height="4"/><rect x="9" y="7" width="3" height="2"/>',
    "history":       '<path fill-rule="evenodd" d="M2 2h12v12H2zM3 3v10h10V3z"/><rect x="7" y="5" width="2" height="4"/><rect x="9" y="7" width="3" height="2"/><rect x="2" y="2" width="3" height="2"/>',
    // 5-pip die face — picked because Lucide's Dices renders two
    // overlapping dice; we go simpler with a single die.
    "dices":         '<path fill-rule="evenodd" d="M2 2h12v12H2zM3 3v10h10V3z"/><rect x="5" y="5" width="2" height="2"/><rect x="9" y="5" width="2" height="2"/><rect x="7" y="7" width="2" height="2"/><rect x="5" y="9" width="2" height="2"/><rect x="9" y="9" width="2" height="2"/>',
    "shield":        '<polygon points="8,2 14,4 14,9 8,14 2,9 2,4"/>',
    "compass":       '<path fill-rule="evenodd" d="M2 2h12v12H2zM3 3v10h10V3z"/><polygon points="8,4 10,8 8,12 6,8"/>',
    "scroll-text":   '<path fill-rule="evenodd" d="M2 3h12v10H2zM3 4v8h10V4z"/><rect x="5" y="6" width="6" height="1"/><rect x="5" y="8" width="6" height="1"/><rect x="5" y="10" width="4" height="1"/>',
    "list-checks":   '<polygon points="2,4 4,6 7,3 6,2 4,4 3,3"/><rect x="9" y="3" width="6" height="1"/><polygon points="2,9 4,11 7,8 6,7 4,9 3,8"/><rect x="9" y="8" width="6" height="1"/><rect x="9" y="13" width="6" height="1"/>',
    "shuffle":       '<polygon points="2,4 6,4 6,2 9,5 6,8 6,6 4,6 4,10 6,10 6,8 9,11 6,14 6,12 2,12"/><rect x="9" y="11" width="3" height="1"/><polygon points="11,8 14,11 11,14"/>',
    // ─── Batch 4 (audit-driven): toolbar coverage ───
    // Wrench (Function Calling) — handle + jaw silhouette.
    "wrench":        '<polygon points="2,12 4,14 11,7 12,8 13,7 11,5 10,6 9,5 11,3 9,3 7,5 7,7 4,10 2,10"/>',
    // Brain (Memory Recall family) — chunky lobed silhouette
    // with a center crease. Pixel-art compromise on a real brain.
    "brain":         '<path fill-rule="evenodd" d="M3 4h10v9H3zM4 5v7h8V5zM7 5v7h2V5z"/>',
    "brain-circuit": '<path fill-rule="evenodd" d="M3 4h10v9H3zM4 5v7h8V5zM7 5v7h2V5z"/><rect x="2" y="7" width="2" height="2"/><rect x="12" y="7" width="2" height="2"/>',
    // Volume / speaker — trapezoid horn + sound waves on the right.
    "volume":        '<polygon points="2,6 5,6 9,3 9,13 5,10 2,10"/><rect x="11" y="6" width="1" height="4"/><rect x="13" y="4" width="1" height="8"/>',
    "volume-1":      '<polygon points="2,6 5,6 9,3 9,13 5,10 2,10"/><rect x="11" y="6" width="1" height="4"/>',
    "volume-2":      '<polygon points="2,6 5,6 9,3 9,13 5,10 2,10"/><rect x="11" y="6" width="1" height="4"/><rect x="13" y="4" width="1" height="8"/>',
    "volume-x":      '<polygon points="2,6 5,6 9,3 9,13 5,10 2,10"/><polygon points="11,5 12,4 14,6 13,7 14,8 13,9 14,10 12,12 11,11 12,10 13,9 12,8 11,7 12,6"/>',
    // No-hyphen Lucide aliases (newer naming convention).
    "volume1":       '<polygon points="2,6 5,6 9,3 9,13 5,10 2,10"/><rect x="11" y="6" width="1" height="4"/>',
    "volume2":       '<polygon points="2,6 5,6 9,3 9,13 5,10 2,10"/><rect x="11" y="6" width="1" height="4"/><rect x="13" y="4" width="1" height="8"/>',
    "volumex":       '<polygon points="2,6 5,6 9,3 9,13 5,10 2,10"/><polygon points="11,5 12,4 14,6 13,7 14,8 13,9 14,10 12,12 11,11 12,10 13,9 12,8 11,7 12,6"/>',
    "speaker":       '<polygon points="2,6 5,6 9,3 9,13 5,10 2,10"/><rect x="11" y="6" width="1" height="4"/><rect x="13" y="4" width="1" height="8"/>',
    // Headphones — band over two ear cups.
    "headphones":    '<path fill-rule="evenodd" d="M2 8h2v6H2zM12 8h2v6h-2z"/><polyline points="2,8 2,5 8,2 14,5 14,8" stroke="currentColor" stroke-width="1" fill="none" shape-rendering="crispEdges"/>',
    // Mic — capsule + stand.
    "mic":           '<rect x="6" y="2" width="4" height="7"/><polyline points="3,9 3,11 13,11 13,9" stroke="currentColor" stroke-width="1" fill="none"/><rect x="7" y="11" width="2" height="3"/>',
    "mic-off":       '<rect x="6" y="2" width="4" height="7"/><rect x="7" y="11" width="2" height="3"/><polygon points="2,12 4,14 14,4 12,2"/>',
    // Earth / globe alt (Translate uses Globe sometimes).
    "earth":         '<path fill-rule="evenodd" d="M2 2h12v12H2zM3 3v4h4V3zM9 3v4h4V3zM3 9v4h4V9zM9 9v4h4V9z"/>',
    // Type / typography — a capital "T" inside a chunky frame.
    "type":          '<rect x="3" y="3" width="10" height="2"/><rect x="7" y="3" width="2" height="11"/>',
    // Film / video — strip with sprocket holes.
    "film":          '<path fill-rule="evenodd" d="M2 2h12v12H2zM3 3v10h10V3zM4 4h2v2H4zM10 4h2v2h-2zM4 10h2v2H4zM10 10h2v2h-2z"/>',
    // Hard drive / server — stacked rectangles.
    "hard-drive":    '<path fill-rule="evenodd" d="M2 5h12v6H2zM3 6v4h10V6z"/><rect x="4" y="7" width="6" height="2"/><rect x="11" y="7" width="2" height="2"/>',
    "server":        '<path fill-rule="evenodd" d="M2 3h12v4H2zM3 4v2h10V4zM2 9h12v4H2zM3 10v2h10v-2z"/><rect x="11" y="4" width="2" height="2"/><rect x="11" y="10" width="2" height="2"/>',
    "database":      '<path fill-rule="evenodd" d="M2 3h12v3H2zM3 4v1h10V4zM2 6h12v3H2zM3 7v1h10V7zM2 9h12v3H2zM3 10v1h10v-1z"/>',
    // Map / map-pin — for location-y icons.
    "map":           '<path fill-rule="evenodd" d="M2 3h12v10H2zM3 4v8h10V4zM5 4v8M10 4v8" stroke="none"/><rect x="5" y="4" width="1" height="8"/><rect x="10" y="4" width="1" height="8"/>',
    "map-pin":       '<polygon points="8,2 13,6 13,8 8,14 3,8 3,6"/><rect x="6" y="5" width="4" height="3"/>',
    // Flame — chunky teardrop.
    "flame":         '<polygon points="8,2 11,6 10,8 12,11 11,14 5,14 4,11 6,8 5,6"/>',
    // Calendar / clock-calendar.
    "calendar":      '<path fill-rule="evenodd" d="M2 4h12v10H2zM3 5v8h10V5z"/><rect x="2" y="2" width="2" height="3"/><rect x="12" y="2" width="2" height="3"/><rect x="4" y="7" width="2" height="2"/><rect x="7" y="7" width="2" height="2"/><rect x="10" y="7" width="2" height="2"/>',
    "calendar-clock":'<path fill-rule="evenodd" d="M2 4h12v10H2zM3 5v8h10V5z"/><rect x="2" y="2" width="2" height="3"/><rect x="12" y="2" width="2" height="3"/>',
    // Layers / stack icon.
    "layers":        '<polygon points="8,2 14,6 8,10 2,6"/><polyline points="2,9 8,13 14,9" stroke="currentColor" stroke-width="1" fill="none"/>',
    // Filter funnel.
    "filter":        '<polygon points="2,3 14,3 10,8 10,13 6,13 6,8"/>',
    // Sliders horizontal/vertical.
    "sliders":       '<rect x="2" y="4" width="12" height="1"/><rect x="2" y="11" width="12" height="1"/><rect x="5" y="3" width="2" height="3"/><rect x="9" y="10" width="2" height="3"/>',
    "sliders-horizontal":'<rect x="2" y="4" width="12" height="1"/><rect x="2" y="11" width="12" height="1"/><rect x="5" y="3" width="2" height="3"/><rect x="9" y="10" width="2" height="3"/>',
    // Edit / pencil-square (composite).
    "edit":          '<path fill-rule="evenodd" d="M2 4h7v10H2zM3 5v8h5V5z"/><polygon points="9,4 12,1 15,4 12,7 9,4"/>',
    "edit-3":        '<polygon points="2,12 2,14 4,14 14,4 12,2"/>',
    "trash-3":       '<rect x="3" y="3" width="10" height="2"/><rect x="6" y="1" width="4" height="2"/><path fill-rule="evenodd" d="M4 5h8v9H4zM6 7h1v5H6zM9 7h1v5H9z"/>',
    // Mouse-pointer / cursor.
    "mouse-pointer": '<polygon points="3,2 3,12 6,9 8,13 10,12 8,8 11,7"/>',
    // Code-related.
    "code":          '<polygon points="6,4 2,8 6,12 4,12 0,8 4,4"/><polygon points="10,4 14,8 10,12 12,12 16,8 12,4"/>',
    "code-2":        '<polygon points="6,4 2,8 6,12 4,12 0,8 4,4"/><polygon points="10,4 14,8 10,12 12,12 16,8 12,4"/>',
    "terminal":      '<path fill-rule="evenodd" d="M2 3h12v10H2zM3 4v8h10V4z"/><polyline points="4,7 6,9 4,11" stroke="currentColor" stroke-width="1" fill="none"/><rect x="7" y="11" width="4" height="1"/>',
    // Tools-y collection.
    "tool":          '<polygon points="2,12 4,14 11,7 12,8 13,7 11,5 10,6 9,5 11,3 9,3 7,5 7,7 4,10 2,10"/>',
    "swords":        '<polygon points="2,12 4,14 11,7 9,5 2,12"/><polygon points="14,12 12,14 5,7 7,5 14,12"/>',
    // ─── Batch 5 (audit-driven): Lucide naming variants ────────────
    // Lucide changed conventions over versions — some icons render
    // without the hyphen between word and digit (`trash2` not
    // `trash-2`, `settings2` not `settings-2`), some got renamed
    // entirely (`home`→`house`, `help-circle`→`circle-help`), and
    // newer icons (`message-square`, `square-check-big`, `ellipsis`)
    // weren't in earlier batches. Each alias here points at the
    // same SVG body as its already-mapped counterpart (or adds a
    // fresh design where one didn't exist yet).
    "circle-help":   '<path fill-rule="evenodd" d="M2 2h12v12H2zM3 3v10h10V3z"/><rect x="6" y="4" width="4" height="1"/><rect x="9" y="5" width="1" height="2"/><rect x="7" y="7" width="2" height="2"/><rect x="7" y="11" width="2" height="1"/>',
    "trash2":        '<rect x="3" y="3" width="10" height="2"/><rect x="6" y="1" width="4" height="2"/><path fill-rule="evenodd" d="M4 5h8v9H4zM6 7h1v5H6zM9 7h1v5H9z"/>',
    "settings2":     '<path fill-rule="evenodd" d="M6 1h4v2H6zM6 13h4v2H6zM1 6h2v4H1zM13 6h2v4h-2zM3 3h10v10H3zM6 6h4v4H6z"/>',
    "house":         '<path fill-rule="evenodd" d="M8 2L1 8h2v6h10V8h2zM7 10v4h2v-4z"/>',
    "ellipsis":      '<rect x="2" y="7" width="2" height="2"/><rect x="7" y="7" width="2" height="2"/><rect x="12" y="7" width="2" height="2"/>',
    "ellipsis-vertical":'<rect x="7" y="2" width="2" height="2"/><rect x="7" y="7" width="2" height="2"/><rect x="7" y="12" width="2" height="2"/>',
    // Square message bubble (vs message-circle which is rounded).
    "message-square":'<path fill-rule="evenodd" d="M2 2h12v9H2zM3 3v7h10V3z"/><polygon points="4,11 7,11 4,14"/>',
    // Upload — arrow up out of a tray (mirror of download).
    "upload":        '<rect x="7" y="6" width="2" height="6"/><polygon points="4,7 12,7 8,2"/><rect x="2" y="13" width="12" height="2"/>',
    // Letter / text — a sheet with horizontal text lines.
    "letter-text":   '<path fill-rule="evenodd" d="M2 2h12v12H2zM3 3v10h10V3z"/><rect x="5" y="5" width="6" height="1"/><rect x="5" y="7" width="6" height="1"/><rect x="5" y="9" width="6" height="1"/><rect x="5" y="11" width="4" height="1"/>',
    // File + plus / folder + plus — file-text/folder with a small
    // plus marker bottom-right.
    "file-plus":     '<path fill-rule="evenodd" d="M3 2h10v12H3zM4 3v10h8V3z"/><rect x="7" y="6" width="2" height="6"/><rect x="5" y="8" width="6" height="2"/>',
    "file-plus-2":   '<path fill-rule="evenodd" d="M3 2h10v12H3zM4 3v10h8V3z"/><rect x="7" y="6" width="2" height="6"/><rect x="5" y="8" width="6" height="2"/>',
    "file-plus2":    '<path fill-rule="evenodd" d="M3 2h10v12H3zM4 3v10h8V3z"/><rect x="7" y="6" width="2" height="6"/><rect x="5" y="8" width="6" height="2"/>',
    "folder-plus":   '<path fill-rule="evenodd" d="M2 4h5v2H2zM2 5h12v9H2zM3 7v6h10V7z"/><rect x="7" y="8" width="2" height="4"/><rect x="5" y="9" width="6" height="2"/>',
    // Big square-check (newer Lucide name, same as our check-square).
    "square-check":  '<path fill-rule="evenodd" d="M2 2h12v12H2zM3 3v10h10V3z"/><polygon points="4,8 6,10 11,5 11,7 6,12 4,10"/>',
    "square-check-big":'<path fill-rule="evenodd" d="M2 2h12v12H2zM3 3v10h10V3z"/><polygon points="4,8 6,10 11,5 11,7 6,12 4,10"/>',
    // Vertical sliders (rotated horizontal sliders).
    "sliders-vertical":'<rect x="4" y="2" width="1" height="12"/><rect x="11" y="2" width="1" height="12"/><rect x="3" y="5" width="3" height="2"/><rect x="10" y="9" width="3" height="2"/>',
    // Pencil ruler / edit alt.
    "pencil-ruler":  '<polygon points="2,12 2,14 4,14 14,4 12,2"/>',
    // Newer Lucide alt names for already-mapped icons.
    "x-mark":        '<polygon points="3,4 4,3 8,7 12,3 13,4 9,8 13,12 12,13 8,9 4,13 3,12 7,8"/>',
    "circle-x":      '<path fill-rule="evenodd" d="M2 2h12v12H2zM3 3v10h10V3z"/><polygon points="4,5 5,4 8,7 11,4 12,5 9,8 12,11 11,12 8,9 5,12 4,11 7,8"/>',
    "circle-check":  '<path fill-rule="evenodd" d="M2 2h12v12H2zM3 3v10h10V3z"/><polygon points="4,8 6,10 11,5 11,7 6,12 4,10"/>',
    "circle-alert":  '<path fill-rule="evenodd" d="M2 2h12v12H2zM3 3v10h10V3z"/><rect x="7" y="5" width="2" height="5"/><rect x="7" y="11" width="2" height="2"/>',
    "octagon-alert": '<polygon points="5,2 11,2 14,5 14,11 11,14 5,14 2,11 2,5"/>',
    // Layout / panel variants.
    "layout":        '<path fill-rule="evenodd" d="M2 2h12v12H2zM3 3v10h10V3z"/><rect x="3" y="3" width="3" height="10"/><rect x="3" y="3" width="10" height="3"/>',
    // Power-on / power-off variants.
    "power-off":     '<rect x="7" y="2" width="2" height="5"/><path fill-rule="evenodd" d="M3 5h10v9H3zM4 6v7h8V6z"/><polygon points="2,12 4,14 14,4 12,2"/>',
    // ─── Batch 6 (final-mile audit): flag, code-xml, palette ───
    // Flag — pole on left + filled rectangular banner waving right.
    // Common in message-action toolbars (flag-as-favorite / report).
    "flag":          '<rect x="3" y="2" width="1" height="12"/><rect x="4" y="3" width="9" height="5"/>',
    // Code-XML — angle brackets `< >` plus a forward slash through
    // the middle (the `</>` glyph used in preset format labels).
    "code-xml":      '<polygon points="5,3 1,8 5,13 6,12 3,8 6,4"/><polygon points="11,3 15,8 11,13 10,12 13,8 10,4"/><polygon points="9,2 11,2 7,14 5,14"/>',
    // Palette — wide rectangular body (palette held horizontally)
    // with a rectangular thumb-hole cutout on the right edge, and
    // a row of 4 paint blobs along the top. Less curvy than a real
    // palette but reads as "thing with paint on it".
    "palette":       '<path fill-rule="evenodd" d="M1 4h14v8H1zM11 8h3v4h-3z"/><rect x="3" y="2" width="2" height="2"/><rect x="6" y="2" width="2" height="2"/><rect x="9" y="2" width="2" height="2"/><rect x="12" y="2" width="2" height="2"/>',
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

  // ── Sparkle stripper ─────────────────────────────────────────────
  // The engine puts literal ✧/✦/✨/⋆ characters around branding text
  // (`✧ Marinara Engine ✧` in ChatArea, `✧ Chats` in ChatSidebar
  // header, etc) — Y2K decoration that doesn't fit the Win95 chrome.
  // CSS can't target individual text characters, so we walk the text
  // nodes inside `.retro-glow-text` elements and strip those chars
  // (plus surrounding whitespace). React shouldn't normally re-render
  // these static labels, but the 1Hz reconcile re-runs the strip in
  // case it does. Marker attribute `data-win95-stripped` keeps us from
  // re-traversing nodes we've already cleaned.
  var SPARKLE_RE = /[✦✧✨★☆⋆✩✪✫✬✭✮✯]/g;

  function stripSparkles() {
    var els = document.querySelectorAll(".retro-glow-text:not([data-win95-stripped])");
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      el.setAttribute("data-win95-stripped", "");
      var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
      var node;
      while ((node = walker.nextNode())) {
        if (!node.nodeValue || !SPARKLE_RE.test(node.nodeValue)) {
          // Reset lastIndex so test() works on the next iteration too.
          SPARKLE_RE.lastIndex = 0;
          continue;
        }
        SPARKLE_RE.lastIndex = 0;
        var cleaned = node.nodeValue.replace(SPARKLE_RE, "").replace(/\s+/g, " ").trim();
        if (cleaned !== node.nodeValue) node.nodeValue = cleaned;
      }
    }
  }

  // ── Win95 system sounds (Web Audio synthesis) ────────────────────
  // No bundled WAVs — Microsoft's actual Win95 sounds (chimes.wav,
  // ding.wav, etc.) are copyrighted, and even if they weren't, a
  // 30-50 KB blob of base64 audio bloats the JSON for marginal
  // payoff. Synthesizing the equivalent tones via OscillatorNode
  // lands close enough to "this feels Win95-y" without the
  // bundle weight or licensing risk.
  //
  // Three sounds wired in v2.7:
  //   bootChime   — C-major arpeggio when extension loads (gated
  //                 by first user-interaction unlock, since
  //                 browser autoplay policy blocks AudioContext
  //                 from playing audio before any user gesture)
  //   ding        — two-tone bell on Generating→Ready transition
  //                 (= a streaming message finished arriving)
  //   errorBuzz   — descending dyad on engine error toast
  //
  // All gated by the KEY_SOUNDS preference (default OFF per the
  // roadmap — the chime would otherwise surprise users who didn't
  // know what they were installing).
  var audioCtx = null;
  function getAudioContext() {
    if (audioCtx) return audioCtx;
    try {
      var Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      audioCtx = new Ctor();
    } catch (e) { return null; }
    return audioCtx;
  }
  // Single tone helper — schedules an oscillator + envelope at
  // `when` seconds from now. Triangle wave + 10ms attack + decay
  // back to silence sounds bell-ish without the harshness of a
  // square. Skips silently if sounds are disabled or the audio
  // context can't be created (older browsers, locked-down
  // environments).
  function tone(freq, duration, when, gain) {
    if (!readBool(KEY_SOUNDS, true)) return;
    var ac = getAudioContext();
    if (!ac) return;
    when = when || 0;
    gain = gain || 0.18;
    try {
      var t0 = ac.currentTime + when;
      var osc = ac.createOscillator();
      var g = ac.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      osc.connect(g);
      g.connect(ac.destination);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
      osc.start(t0);
      osc.stop(t0 + duration + 0.05);
    } catch (e) { /* swallow — audio is non-essential */ }
  }
  function bootChime() {
    // C-major arpeggio (C4 / E4 / G4 / C5) — short, recognizable,
    // not too long to be annoying on every page load. ~0.65s total.
    tone(523.25, 0.4, 0.00);  // C5
    tone(659.25, 0.4, 0.08);  // E5
    tone(783.99, 0.4, 0.16);  // G5
    tone(1046.50, 0.5, 0.24); // C6
  }
  function ding() {
    // Two-tone bell, fifth interval (C6 → G6).
    tone(1046.50, 0.18, 0.00, 0.14);
    tone(1567.98, 0.22, 0.05, 0.12);
  }
  function errorBuzz() {
    // Descending dyad — A3 then A2. Brief and lower-pitched so it
    // reads as "something went wrong" without being a real error
    // tone the engine might also play.
    tone(220, 0.15, 0.00, 0.16);
    tone(110, 0.20, 0.13, 0.16);
  }
  // Suppress the engine's own new-message notification ping
  // (`playNotificationPing` in lib/notification-sound.ts) when our
  // Win95 sounds are enabled — otherwise the user hears both the
  // engine's modern ping AND our Win95 ding layered.
  //
  // The engine creates two sine oscillators at 880 Hz and 1320 Hz
  // and sets their frequency via `frequency.setValueAtTime(880, now)`.
  // Reading `frequency.value` immediately after a schedule is
  // unreliable (the value may not have propagated through the audio
  // thread yet), so we ALSO patch AudioParam.prototype.setValueAtTime
  // to record the most-recently-scheduled value on the param itself
  // and read THAT in our start() check.
  //
  // Our own tones use `type = "triangle"` and never hit 880/1320 Hz
  // exactly, so they're never caught. Gated by KEY_SOUNDS so
  // disabling our sounds restores the engine's ping naturally.
  var oscillatorPatched = false;
  function suppressEngineNotification() {
    if (oscillatorPatched) return;
    var ACtor = window.AudioContext || window.webkitAudioContext;
    if (!ACtor || !window.AudioParam) return;
    var origCreate = ACtor.prototype.createOscillator;
    if (!origCreate) return;

    // Track most-recently-scheduled value on every AudioParam so we
    // can read it back synchronously at oscillator-start time.
    var origSetValueAtTime = AudioParam.prototype.setValueAtTime;
    if (origSetValueAtTime && !origSetValueAtTime.__win95Patched) {
      AudioParam.prototype.setValueAtTime = function (value, when) {
        try { this.__win95LastValue = value; } catch (e) {}
        return origSetValueAtTime.apply(this, arguments);
      };
      AudioParam.prototype.setValueAtTime.__win95Patched = true;
    }

    ACtor.prototype.createOscillator = function () {
      var osc = origCreate.call(this);
      var origStart = osc.start.bind(osc);
      osc.start = function () {
        try {
          if (readBool(KEY_SOUNDS, true) && osc.type === "sine") {
            var freq = osc.frequency.__win95LastValue;
            if (typeof freq !== "number") freq = osc.frequency.value;
            if (Math.abs(freq - 880) < 10 || Math.abs(freq - 1320) < 10) {
              // Match the engine's notification-ping pattern.
              // Disconnect from the audio graph + no-op start/stop
              // so no sound is produced. Our triangle-wave tones
              // are never caught (different `type`, different freqs).
              try { osc.disconnect(); } catch (e) {}
              osc.start = function () {};
              osc.stop = function () {};
              return;
            }
          }
        } catch (e) { /* defensive — fall through to original */ }
        return origStart.apply(this, arguments);
      };
      return osc;
    };
    oscillatorPatched = true;
  }

  // Browsers block AudioContext.start until a user gesture has
  // happened. We can't fire the boot chime on page load — but we
  // CAN listen for the first click/keydown and fire then. Marker
  // in sessionStorage prevents replaying on every page reload
  // within the same browser session.
  function unlockAndPlayBootChime() {
    if (!readBool(KEY_SOUNDS, true)) return;
    try {
      if (sessionStorage.getItem(SESSION_BOOT_CHIME_KEY)) return;
      sessionStorage.setItem(SESSION_BOOT_CHIME_KEY, "1");
    } catch (e) { /* sessionStorage may throw in private mode */ }
    var ac = getAudioContext();
    if (ac && ac.state === "suspended") {
      try { ac.resume(); } catch (e) {}
    }
    bootChime();
  }
  function armBootChime() {
    if (!readBool(KEY_SOUNDS, true)) return;
    var fired = false;
    var fire = function () {
      if (fired) return;
      fired = true;
      unlockAndPlayBootChime();
    };
    // Capture-phase listeners so we don't compete with React's
    // event system on bubble.
    document.addEventListener("click", fire, { once: true, capture: true });
    document.addEventListener("keydown", fire, { once: true, capture: true });
    document.addEventListener("touchstart", fire, { once: true, capture: true });
  }
  // Engine error detection — observe added nodes for toast
  // notifications carrying error semantics. Marinara renders
  // toasts via sonner (visible class names like
  // `[data-sonner-toast][data-type="error"]`). Scoped observer
  // on body, gated by the sounds preference, marks each
  // observed toast so the same error doesn't fire ding+errorBuzz
  // multiple times on re-renders.
  var ERROR_TOAST_MARK = "data-win95-error-rang";
  function checkForErrorToast(root) {
    if (!readBool(KEY_SOUNDS, true)) return;
    if (!root || !root.querySelectorAll) return;
    var toasts = root.querySelectorAll('[data-sonner-toast][data-type="error"]:not([' + ERROR_TOAST_MARK + ']),' +
                                       '[data-type="error"]:not([' + ERROR_TOAST_MARK + ']),' +
                                       '.toast-error:not([' + ERROR_TOAST_MARK + '])');
    for (var i = 0; i < toasts.length; i++) {
      toasts[i].setAttribute(ERROR_TOAST_MARK, "");
      errorBuzz();
    }
  }

  // ── Boot splash ──────────────────────────────────────────────────
  // Win95-style "Starting Marinara…" splash shown once per browser
  // session (sessionStorage gated). Auto-dismisses after the
  // progress-bar animation finishes (~2.6s) or on first click.
  // Toggle in settings; pass `force: true` to bypass both gates
  // (used by the settings panel "Show splash now" preview button).
  function showBootSplash(opts) {
    opts = opts || {};
    if (!opts.force) {
      if (!readBool(KEY_BOOTSPLASH, true)) return;
      try {
        if (sessionStorage.getItem(SESSION_BOOT_KEY)) return;
        sessionStorage.setItem(SESSION_BOOT_KEY, "1");
      } catch (e) { /* sessionStorage may throw in private mode — show splash anyway */ }
    }

    // Don't double-mount if already on screen.
    if (document.querySelector(".win95-boot-splash")) return;

    var splash = document.createElement("div");
    splash.className = "win95-boot-splash win95-skip";
    splash.setAttribute("data-win95-chrome", "boot-splash");
    splash.setAttribute("aria-hidden", "true");
    splash.innerHTML =
      '<div class="win95-boot-content">' +
        '<div class="win95-boot-flag"><div></div><div></div><div></div><div></div></div>' +
        '<div class="win95-boot-title">Marinara Engine</div>' +
        '<div class="win95-boot-tagline">LOCAL AI ROLEPLAY FRONTEND</div>' +
        '<div class="win95-boot-status">Starting Marinara Engine&hellip;</div>' +
        '<div class="win95-boot-bar"><div class="win95-boot-bar-fill"></div></div>' +
        '<div class="win95-boot-hint">Click anywhere to continue</div>' +
      '</div>';
    document.body.appendChild(splash);

    var dismissed = false;
    function dismiss() {
      if (dismissed) return;
      dismissed = true;
      try { splash.parentNode && splash.parentNode.removeChild(splash); } catch (e) {}
    }
    marinara.on(splash, "click", dismiss);
    // 2.6s = a hair past the progress-bar animation so users see
    // it complete before fade-out. Click anywhere skips early.
    marinara.setTimeout(dismiss, 2600);
    marinara.onCleanup(dismiss);
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
    stripSparkles();
    // Cheap scan for unrung error toasts. The marker attribute
    // prevents double-firing on toasts we've already seen.
    checkForErrorToast(document.body);
  }, POLL_MS);

  refreshAllChrome();
  attachSendObserver();
  attachIconObservers();
  swapIconsIn(document.body);
  stripSparkles();
  updateStatus();
  suppressEngineNotification();
  showBootSplash();
  armBootChime();
})();
