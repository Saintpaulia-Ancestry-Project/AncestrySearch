// Runs before the page is drawn (a plain script in <head>): applies the saved look so there is no flash of the wrong colors.
// The real setting lives in the device database; the settings screen mirrors it here (localStorage) for this one purpose.
(function () {
  var MODES = ["device", "light", "dark", "hc-light", "hc-dark"], SCHEMES = ["violet", "blue", "green", "red", "brown", "grey"];
  var r = document.documentElement, s = {};
  try { s = JSON.parse(localStorage.getItem("hybridizer-look") || "{}") || {}; } catch (e) { s = {}; }
  r.setAttribute("data-mode", MODES.indexOf(s.mode) >= 0 ? s.mode : "device");
  r.setAttribute("data-scheme", SCHEMES.indexOf(s.scheme) >= 0 ? s.scheme : "violet");
  r.setAttribute("data-text", ["small", "normal", "large"].indexOf(s.text_size) >= 0 ? s.text_size : "normal");
  r.setAttribute("data-density", s.density === "compact" ? "compact" : "comfortable");
  if (s.reduce_motion) r.setAttribute("data-motion", "reduce");
})();
