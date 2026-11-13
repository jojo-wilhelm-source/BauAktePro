/**
 * 360° viewer for equirectangular photos (Insta360 export), shared by web and app (WebView), works offline.
 * Plain WebGL, no library: a full-screen quad whose fragment shader maps the view direction to the panorama.
 * PANO_JS is the body of a function (canvas, img) => cleanup; drag to look around, wheel/pinch to zoom.
 */
export const PANO_JS = String.raw`
const gl = canvas.getContext('webgl', { antialias: false, preserveDrawingBuffer: false });
if (!gl) { canvas.replaceWith(document.createTextNode('360°-Ansicht wird von diesem Gerät nicht unterstützt.')); return () => {}; }
const vs = 'attribute vec2 p; varying vec2 v; void main(){ v = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }';
const fs = 'precision highp float; uniform sampler2D t; uniform float yaw, pitch, fov, aspect; varying vec2 v;' +
  'void main(){ vec2 q = v * 2.0 - 1.0; float f = tan(fov * 0.5);' +
  ' vec3 d = normalize(vec3(q.x * f * aspect, q.y * f, -1.0));' +
  ' float cp = cos(pitch), sp = sin(pitch); d = vec3(d.x, d.y * cp - d.z * sp, d.y * sp + d.z * cp);' +
  ' float cy = cos(yaw), sy = sin(yaw); d = vec3(d.x * cy + d.z * sy, d.y, -d.x * sy + d.z * cy);' +
  ' float lon = atan(d.x, -d.z); float lat = asin(clamp(d.y, -1.0, 1.0));' +
  ' gl_FragColor = texture2D(t, vec2(lon / 6.2831853 + 0.5, 0.5 - lat / 3.1415927)); }';
const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
const prog = gl.createProgram();
gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(prog); gl.useProgram(prog);
const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
// Downscale panoramas larger than the GPU allows (older iPhones: 4096).
const max = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), 8192);
let src = img;
if (img.naturalWidth > max) {
  const c = document.createElement('canvas'); c.width = max; c.height = Math.round(max * img.naturalHeight / img.naturalWidth);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); src = c;
}
const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, src);
const u = (n) => gl.getUniformLocation(prog, n);
let yaw = 0, pitch = 0, fov = 1.4, frame = 0;
const draw = () => {
  frame = 0;
  const r = window.devicePixelRatio || 1; const w = Math.round(canvas.clientWidth * r), h = Math.round(canvas.clientHeight * r);
  if (!w || !h) return;
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  gl.viewport(0, 0, w, h);
  gl.uniform1f(u('yaw'), yaw); gl.uniform1f(u('pitch'), pitch); gl.uniform1f(u('fov'), fov); gl.uniform1f(u('aspect'), w / h);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
};
const redraw = () => { if (!frame) frame = requestAnimationFrame(draw); };
const pts = new Map(); let pinch = 0;
const down = (e) => { canvas.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); };
const move = (e) => {
  const prev = pts.get(e.pointerId); if (!prev) return;
  if (pts.size === 1) {
    const k = fov / canvas.clientHeight;
    yaw += (e.clientX - prev[0]) * k; pitch = Math.max(-1.5, Math.min(1.5, pitch + (e.clientY - prev[1]) * k));
  }
  pts.set(e.pointerId, [e.clientX, e.clientY]);
  if (pts.size === 2) {
    const [a, b] = [...pts.values()]; const dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (pinch) fov = Math.max(0.5, Math.min(2.0, fov * pinch / dist)); pinch = dist;
  }
  redraw();
};
const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = 0; };
const wheel = (e) => { e.preventDefault(); fov = Math.max(0.5, Math.min(2.0, fov * (1 + e.deltaY * 0.001))); redraw(); };
canvas.style.touchAction = 'none'; canvas.style.cursor = 'grab';
canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move);
canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up); canvas.addEventListener('wheel', wheel, { passive: false });
window.addEventListener('resize', redraw);
// The canvas may get its size only after the first frame (WebView, sheets that animate in).
const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(redraw) : null;
if (ro) ro.observe(canvas);
draw(); setTimeout(redraw, 120); setTimeout(redraw, 500);
return () => { window.removeEventListener('resize', redraw); if (ro) ro.disconnect(); gl.deleteTexture(tex); gl.deleteProgram(prog); };
`;

/** Self-contained HTML page for the app's WebView; the image is passed as data URL (works offline). */
export function panoHtml(dataUrl: string) {
  return '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">' +
    '<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}canvas{width:100%;height:100%;display:block}</style></head><body>' +
    '<canvas id="c"></canvas><script>window.onerror=function(m,u,l){if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage("Fehler: "+m+" @"+l)};(function(){var img=new Image();img.onerror=function(){if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage("Bild konnte nicht geladen werden")};img.onload=function(){(function(canvas,img){' + PANO_JS + '})(document.getElementById("c"),img)};img.src=' +
    JSON.stringify(dataUrl) + ';})();</script></body></html>';
}
