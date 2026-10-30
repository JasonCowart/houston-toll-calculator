/* Light / dark theme for the Toll Calculator.
   Mode is "auto" (follow the device), "light" or "dark", kept in this browser. The resolved
   theme is set as <html data-theme="light|dark"> before the page draws (this file loads in the
   head), so there's no white flash at night. Esri's map controls switch theme too.
   Print and the PDF always use the light colors. */
(function (root) {
  "use strict";
  var KEY = "htc-theme", mode = "auto", listeners = [];
  try { mode = localStorage.getItem(KEY) || "auto"; } catch (e) { /* default */ }
  if (mode !== "light" && mode !== "dark") mode = "auto";
  var mq = root.matchMedia ? root.matchMedia("(prefers-color-scheme: dark)") : null;
  function resolved() { return mode === "auto" ? (mq && mq.matches ? "dark" : "light") : mode; }
  var last = null;
  function apply() {
    var t = resolved();
    document.documentElement.setAttribute("data-theme", t);
    document.documentElement.setAttribute("data-mode", mode);
    // Esri's newer controls (the address search boxes) are Calcite components: they follow
    // these classes, not the theme stylesheet below.
    document.documentElement.classList.toggle("calcite-mode-dark", t === "dark");
    document.documentElement.classList.toggle("calcite-mode-light", t !== "dark");
    var link = document.querySelector('link[href*="/esri/themes/"]');
    if (link) {
      var want = link.href.replace(/\/esri\/themes\/(light|dark)\//, "/esri/themes/" + t + "/");
      if (want !== link.href) link.href = want;
    }
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", t === "dark" ? "#2a1640" : "#662d91");
    if (t !== last) {
      last = t;
      listeners.forEach(function (f) { try { f(t, mode); } catch (e) { console.warn(e); } });
    }
  }
  function set(m) {
    mode = m === "light" || m === "dark" ? m : "auto";
    try { if (mode === "auto") localStorage.removeItem(KEY); else localStorage.setItem(KEY, mode); } catch (e) { /* not kept */ }
    last = null; // tell listeners even if the colors stay the same (the button shows the mode)
    apply();
  }
  if (mq) {
    var onDevice = function () { if (mode === "auto") apply(); };
    if (mq.addEventListener) mq.addEventListener("change", onDevice); else if (mq.addListener) mq.addListener(onDevice);
  }
  apply();
  root.Theme = {
    get mode() { return mode; },
    get theme() { return resolved(); },
    set: set,
    next: function () { set(mode === "auto" ? "dark" : mode === "dark" ? "light" : "auto"); },
    onChange: function (f) { listeners.push(f); },
    apply: apply
  };
})(this);
