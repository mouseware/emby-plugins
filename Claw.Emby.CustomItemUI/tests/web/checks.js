// Shared column-resize assertions used by every plugin's page test.
const sleep = ms => new Promise(r => setTimeout(r, ms));
module.exports = function (p, ok) {
  const thBox = (sel, id) => p.$eval(sel, (t, id) => { const th = [...t.tHead.rows[0].cells].find(c => (c.getAttribute('data-sort') || c.getAttribute('data-fsort') || c.textContent.replace(/[▲▼↑↓]/g, '').trim()) === id); const r = th.getBoundingClientRect(); const h = th.querySelector('.cr-h').getBoundingClientRect(); return { w: r.width, hx: h.x + h.width / 2, hy: h.y + h.height / 2 }; }, id);
  async function drag(sel, id, dx) {
    const b = await thBox(sel, id);
    const hit = await p.evaluate((x, y) => document.elementFromPoint(x, y).className, b.hx, b.hy);
    await p.mouse.move(b.hx, b.hy); await p.mouse.down(); await p.mouse.move(b.hx + dx / 2, b.hy, { steps: 3 }); await p.mouse.move(b.hx + dx, b.hy, { steps: 3 }); await p.mouse.up(); await sleep(100);
    return hit;
  }
  return {
    thBox, drag,
    async run(label, sel, id, key, rerender) {
      ok(await p.$$eval(sel + ' > thead > tr > th', a => a.length > 0 && a.every(th => th.querySelector(':scope > .cr-h'))), `${label}: handle on every header`);
      const looks = await p.$eval(sel, t => ({ fixed: t.classList.contains('cr-fixed'), w: t.style.width }));
      ok(!looks.fixed && !looks.w, `${label}: untouched table keeps automatic layout`);
      const html0 = await p.$eval(sel + ' > tbody', b => b.children.length);
      const w0 = (await thBox(sel, id)).w;
      const hit = await drag(sel, id, 120);
      ok(/cr-h/.test(hit), `${label}: header edge is grabbable (${hit})`);
      const w1 = (await thBox(sel, id)).w;
      ok(w1 - w0 > 100 && w1 - w0 < 140, `${label}: drag resizes "${id}" ${Math.round(w0)} -> ${Math.round(w1)}`);
      const st = await p.evaluate(k => JSON.parse(localStorage.getItem(k) || 'null'), key);
      ok(st && Math.abs(st[id] - w1) <= 2, `${label}: saved in localStorage["${key}"]`);
      ok(await p.$eval(sel + ' > tbody', b => b.children.length) === html0, `${label}: rows unchanged`);
      if (rerender) { await rerender(); await sleep(200); ok(Math.abs((await thBox(sel, id)).w - w1) <= 2, `${label}: width kept after re-render`); }
      return w1;
    }
  };
};
