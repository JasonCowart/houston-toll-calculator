/* MiniPDF: a small one-page-at-a-time PDF writer for the trip summary (Save PDF).
   Standard Helvetica fonts (no font files), text, boxes, lines and a JPEG picture.
   Text is WinAnsi (Windows-1252); characters outside it are swapped for close ones. */
(function (root) {
  "use strict";
  // Glyph widths (1/1000 em) for codes 32..255, from Adobe's Helvetica metrics.
  var W = { F1: [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,350,556,350,222,556,333,1000,556,556,333,1000,667,333,1000,350,611,350,350,222,222,333,333,350,556,1000,333,1000,500,333,944,350,500,667,278,333,556,556,556,556,260,556,333,737,370,556,584,333,737,333,400,584,333,333,333,556,537,278,333,333,365,556,834,834,834,611,667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,556,556,556,556,556,556,556,584,611,556,556,556,556,500,556,500], F2: [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,350,556,350,278,556,500,1000,556,556,333,1000,667,333,1000,350,611,350,350,278,278,500,500,350,556,1000,333,1000,556,333,944,350,500,667,278,333,556,556,556,556,280,556,333,737,370,556,584,333,737,333,400,584,333,333,333,611,556,278,333,333,365,556,834,834,834,611,722,722,722,722,722,722,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,556,556,556,556,556,278,278,278,278,611,611,611,611,611,611,611,584,611,611,611,611,611,556,611,556] };
  var SWAP = { "→": ">", "←": "<", " ": " ", " ": " ", " ": " ", "−": "-", "✕": "x", "≈": "~" };
  var CP = { 0x20ac: 128, 0x201a: 130, 0x192: 131, 0x201e: 132, 0x2026: 133, 0x2020: 134, 0x2021: 135, 0x2c6: 136, 0x2030: 137, 0x160: 138,
    0x2039: 139, 0x152: 140, 0x17d: 142, 0x2018: 145, 0x2019: 146, 0x201c: 147, 0x201d: 148, 0x2022: 149, 0x2013: 150, 0x2014: 151,
    0x2dc: 152, 0x2122: 153, 0x161: 154, 0x203a: 155, 0x153: 156, 0x17e: 158, 0x178: 159 };
  function enc(s) {
    var out = "";
    for (var i = 0; i < s.length; i++) {
      var ch = SWAP[s[i]] != null ? SWAP[s[i]] : s[i];
      for (var k = 0; k < ch.length; k++) {
        var c = ch.charCodeAt(k);
        if (c >= 32 && c < 127) out += String.fromCharCode(c);
        else if (c >= 160 && c <= 255) out += String.fromCharCode(c);
        else if (CP[c]) out += String.fromCharCode(CP[c]);
        else if (c === 10 || c === 9) out += " ";
        else out += "?";
      }
    }
    return out;
  }
  function width(s, size, bold) {
    var t = enc(s), w = W[bold ? "F2" : "F1"], n = 0;
    for (var i = 0; i < t.length; i++) { var c = t.charCodeAt(i); n += c >= 32 ? w[c - 32] : 0; }
    return n * size / 1000;
  }
  // Split text into lines no wider than maxW.
  function wrap(s, size, bold, maxW) {
    var words = String(s).split(/\s+/).filter(Boolean), lines = [], cur = "";
    words.forEach(function (wd) {
      var t = cur ? cur + " " + wd : wd;
      if (!cur || width(t, size, bold) <= maxW) { cur = t; return; }
      lines.push(cur); cur = wd;
      while (width(cur, size, bold) > maxW && cur.length > 1) { // a long link: break it anywhere
        var j = cur.length; while (j > 1 && width(cur.slice(0, j), size, bold) > maxW) j--;
        lines.push(cur.slice(0, j)); cur = cur.slice(j);
      }
    });
    if (cur) lines.push(cur);
    return lines;
  }
  function esc(t) { return t.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)"); }
  function num(v) { return (Math.round(v * 100) / 100).toString(); }
  function rgb(c) { // "#662d91" -> "0.4 0.176 0.569"
    var h = c.replace("#", ""); return [0, 2, 4].map(function (i) { return num(parseInt(h.substr(i, 2), 16) / 255); }).join(" ");
  }

  function Doc(w, h) { this.W = w || 612; this.H = h || 792; this.pages = []; this.images = []; this.addPage(); }
  Doc.prototype.addPage = function () { this.ops = []; this.pages.push(this.ops); };
  // y is measured from the top of the page (like the screen); PDF counts from the bottom.
  Doc.prototype.text = function (x, y, s, o) {
    o = o || {};
    var size = o.size || 10, f = o.bold ? "F2" : "F1";
    if (o.align === "right") x -= width(s, size, o.bold);
    this.ops.push("BT /" + f + " " + num(size) + " Tf " + rgb(o.color || "#1c1b1d") + " rg " + num(x) + " " + num(this.H - y) + " Td (" + esc(enc(s)) + ") Tj ET");
  };
  // Wrapped text; returns the y below the last line.
  Doc.prototype.para = function (x, y, s, maxW, o) {
    o = o || {}; var size = o.size || 10, lh = o.lineHeight || size * 1.3, self = this;
    wrap(s, size, o.bold, maxW).forEach(function (ln, i) { self.text(x, y + size + i * lh, ln, o); });
    return y + size + (wrap(s, size, o.bold, maxW).length - 1) * lh + (lh - size);
  };
  Doc.prototype.rect = function (x, y, w, h, o) {
    o = o || {};
    var s = "";
    if (o.fill) s += rgb(o.fill) + " rg ";
    if (o.stroke) s += rgb(o.stroke) + " RG " + num(o.lineWidth || 0.75) + " w ";
    s += num(x) + " " + num(this.H - y - h) + " " + num(w) + " " + num(h) + " re " + (o.fill && o.stroke ? "B" : o.fill ? "f" : "S");
    this.ops.push(s);
  };
  // A filled circle centered at x, y (y from the top).
  Doc.prototype.circle = function (x, y, r, o) {
    o = o || {};
    var k = 0.5523 * r, cy = this.H - y, s = rgb(o.fill || "#000000") + " rg ";
    if (o.stroke) s += rgb(o.stroke) + " RG " + num(o.lineWidth || 0.75) + " w ";
    s += num(x + r) + " " + num(cy) + " m " +
      num(x + r) + " " + num(cy + k) + " " + num(x + k) + " " + num(cy + r) + " " + num(x) + " " + num(cy + r) + " c " +
      num(x - k) + " " + num(cy + r) + " " + num(x - r) + " " + num(cy + k) + " " + num(x - r) + " " + num(cy) + " c " +
      num(x - r) + " " + num(cy - k) + " " + num(x - k) + " " + num(cy - r) + " " + num(x) + " " + num(cy - r) + " c " +
      num(x + k) + " " + num(cy - r) + " " + num(x + r) + " " + num(cy - k) + " " + num(x + r) + " " + num(cy) + " c " + (o.stroke ? "B" : "f");
    this.ops.push(s);
  };
  Doc.prototype.line = function (x1, y1, x2, y2, o) {
    o = o || {};
    this.ops.push(rgb(o.color || "#cccccc") + " RG " + num(o.lineWidth || 0.5) + " w " + num(x1) + " " + num(this.H - y1) + " m " + num(x2) + " " + num(this.H - y2) + " l S");
  };
  // A JPEG data URL, drawn into the box x, y, w, h.
  Doc.prototype.jpeg = function (dataUrl, pxW, pxH, x, y, w, h) {
    var bin = atob(dataUrl.split(",")[1]);
    var name = "Im" + (this.images.length + 1);
    this.images.push({ name: name, data: bin, w: pxW, h: pxH });
    this.ops.push("q " + num(w) + " 0 0 " + num(h) + " " + num(x) + " " + num(this.H - y - h) + " cm /" + name + " Do Q");
  };
  // The finished file as bytes.
  Doc.prototype.bytes = function () {
    var objs = [], self = this;
    function add(s) { objs.push(s); return objs.length; }
    var f1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    var f2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    var imgs = this.images.map(function (im) {
      return { name: im.name, id: add("<< /Type /XObject /Subtype /Image /Width " + im.w + " /Height " + im.h +
        " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " + im.data.length + " >>\nstream\n" + im.data + "\nendstream") };
    });
    var res = "<< /Font << /F1 " + f1 + " 0 R /F2 " + f2 + " 0 R >> /XObject << " + imgs.map(function (i) { return "/" + i.name + " " + i.id + " 0 R"; }).join(" ") + " >> >>";
    var pagesId = objs.length + this.pages.length * 2 + 1; // after each page's content and page objects
    var kids = [];
    this.pages.forEach(function (ops) {
      var body = ops.join("\n");
      var c = add("<< /Length " + body.length + " >>\nstream\n" + body + "\nendstream");
      kids.push(add("<< /Type /Page /Parent " + pagesId + " 0 R /MediaBox [0 0 " + self.W + " " + self.H + "] /Resources " + res + " /Contents " + c + " 0 R >>"));
    });
    var pages = add("<< /Type /Pages /Kids [" + kids.map(function (k) { return k + " 0 R"; }).join(" ") + "] /Count " + kids.length + " >>");
    var cat = add("<< /Type /Catalog /Pages " + pages + " 0 R >>");
    var out = "%PDF-1.4\n%âãÏÓ\n", offs = [];
    objs.forEach(function (o, i) { offs.push(out.length); out += (i + 1) + " 0 obj\n" + o + "\nendobj\n"; });
    var xref = out.length;
    out += "xref\n0 " + (objs.length + 1) + "\n0000000000 65535 f \n" + offs.map(function (o) { return ("000000000" + o).slice(-10) + " 00000 n \n"; }).join("");
    out += "trailer\n<< /Size " + (objs.length + 1) + " /Root " + cat + " 0 R >>\nstartxref\n" + xref + "\n%%EOF\n";
    var u = new Uint8Array(out.length);
    for (var i = 0; i < out.length; i++) u[i] = out.charCodeAt(i) & 255;
    return u;
  };
  root.MiniPDF = { Doc: Doc, width: width, wrap: wrap };
})(this);
