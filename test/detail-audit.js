// Finds clipped glyphs and off-centre icons on whatever is on screen.
// Serve as /__audit.js and run: (await import('/__audit.js')).audit()
const ctx = document.createElement('canvas').getContext('2d');
const visible = (el) => {
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > innerHeight) return false;
  for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
    const cs = getComputedStyle(n);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false;
  }
  return true;
};
const desc = (el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''} "${el.textContent.trim().slice(0, 24)}"`;

export function audit(scope = document) {
  const issues = [];
  // 1. glyphs cut by their own box: overflow hidden, line clamp, or text painted with background-clip
  for (const el of scope.querySelectorAll('body *')) {
    if (!el.textContent.trim() || !visible(el) || el.closest('svg')) continue;
    const cs = getComputedStyle(el);
    const clips = cs.overflow !== 'visible' || cs.webkitBackgroundClip === 'text' || cs.backgroundClip === 'text' || /\d/.test(cs.webkitLineClamp || '');
    if (!clips) continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own) continue;
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const m = ctx.measureText(el.textContent.trim());
    const fontSize = parseFloat(cs.fontSize);
    const lh = cs.lineHeight === 'normal' ? fontSize * 1.2 : parseFloat(cs.lineHeight);
    // Where the baseline sits inside the line box, from the font's own metrics.
    const baseline = (lh - (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)) / 2 + m.fontBoundingBoxAscent;
    const overTop = m.actualBoundingBoxAscent - baseline - parseFloat(cs.paddingTop);
    const overBottom = baseline + m.actualBoundingBoxDescent - lh - parseFloat(cs.paddingBottom);
    const spill = Math.max(overTop, overBottom);
    if (spill > 1.5)
      issues.push(`glyphs clipped ${overBottom > overTop ? 'at the bottom' : 'at the top'} by ~${spill.toFixed(1)}px: ${desc(el)} (font ${fontSize}px, line ${lh.toFixed(1)}px)`);
  }
  // 2. icons that are not centred in their control
  for (const svg of scope.querySelectorAll('button svg.i, a svg.i, .path svg.i, .top-go svg.i')) {
    // Covers and the corner play chips place their icons on purpose.
    if (!visible(svg) || svg.closest('.pl-cover, .liked-heart, .station-play, .tile-play, .row-play')) continue;
    const host = svg.closest('button, a, .path, .top-go');
    const s = svg.getBoundingClientRect(), h = host.getBoundingClientRect();
    const textOnly = !host.textContent.trim();
    const dy = s.top + s.height / 2 - (h.top + h.height / 2);
    const dx = s.left + s.width / 2 - (h.left + h.width / 2);
    const isPlay = /M7 4\.6|M19 5\.4|M5 5\.4/.test(svg.innerHTML); // play glyphs are nudged right on purpose
    if (Math.abs(dy) > 1.5) issues.push(`icon ${dy > 0 ? 'low' : 'high'} by ${Math.abs(dy).toFixed(1)}px in ${desc(host)} ${host.dataset.act || ''}`);
    if (textOnly && !isPlay && Math.abs(dx) > 1.5) issues.push(`icon off-centre sideways by ${dx.toFixed(1)}px in ${desc(host)} ${host.dataset.act || ''}`);
  }
  return [...new Set(issues)];
}
