/*
 * "Importar a Compra": se ejecuta desde el marcador del navegador estando en dia.es. Dos opciones:
 *   · Importar esta categoría: lee los productos de la categoría que estás viendo (hasta 5 páginas).
 *   · Actualizar mis precios: relee solo la ficha de los productos de Dia que usas en tus listas.
 * Solo lee lo que la propia web de Dia muestra, y siempre porque tú pulsas el botón.
 *
 * El marcador define antes window.__COMPRA = { url, key } con la dirección de la app y su clave.
 */
(function () {
  if (window.__compraImporting) return;
  const old = document.getElementById('compra-import-box');
  if (old) old.remove();

  const cfg = window.__COMPRA || {};
  const MAX_PAGES = 5;        // robots.txt de Dia solo permite hasta pag-5
  const PAUSE_MS = 600;       // pausa entre páginas para no cargar su web

  /* ---------- Ventanita ---------- */
  const box = document.createElement('div');
  box.id = 'compra-import-box';
  box.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;width:310px;max-width:calc(100vw - 32px);' +
    'background:#1e1e1e;color:#f0f0ec;font:14px/1.4 -apple-system,system-ui,sans-serif;border-radius:14px;' +
    'box-shadow:0 10px 30px rgba(0,0,0,.35);padding:14px 16px';
  box.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
    '<b style="font-size:15px">🛒 Compra</b>' +
    '<button data-close style="border:0;background:none;color:#8d8d88;font-size:20px;cursor:pointer;padding:0 2px">×</button></div>' +
    '<div class="msg"></div><div class="det" style="color:#8d8d88;font-size:13px;margin-top:4px"></div><div class="btns"></div>';
  box.querySelector('[data-close]').onclick = () => box.remove();
  document.body.appendChild(box);
  const $ = s => box.querySelector(s);
  const msg = (t, d) => { $('.msg').textContent = t; $('.det').textContent = d || ''; };
  const done = (t, d, ok) => { msg(t, d); $('.btns').innerHTML = ''; box.style.borderLeft = '4px solid ' + (ok ? '#4cc283' : '#ff6b55'); window.__compraImporting = false; };
  const button = (label, primary, fn) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'display:block;width:100%;margin-top:8px;border:0;border-radius:10px;padding:10px;font:600 14px -apple-system,system-ui,sans-serif;cursor:pointer;' +
      (primary ? 'background:#4cc283;color:#0d2a1a' : 'background:#2c2c2a;color:#f0f0ec');
    b.onclick = () => { $('.btns').innerHTML = ''; box.style.borderLeft = ''; window.__compraImporting = true; fn().catch(err => done('No se pudo completar.', String(err && err.message || err), false)); };
    $('.btns').appendChild(b);
  };

  if (!cfg.url || !cfg.key) return done('Falta configurar el botón.', 'Vuelve a copiarlo desde la app (Gasto → Productos de Dia).');
  if (!/(^|\.)dia\.es$/.test(location.hostname)) return done('Esto solo funciona en dia.es.', 'Entra en dia.es y vuelve a pulsar el botón.');

  /* ---------- Utilidades ---------- */
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const pretty = s => { s = s.replace(/-/g, ' '); return s.charAt(0).toUpperCase() + s.slice(1); };

  async function load(path) {
    const res = await fetch(path, { credentials: 'include' });
    if (!res.ok) throw new Error('Dia respondió ' + res.status);
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    const el = doc.getElementById('vike_pageContext');
    if (!el) throw new Error('La página de Dia ha cambiado y no encuentro los productos.');
    const st = JSON.parse(el.textContent).INITIAL_STATE || {};
    const t = (doc.title || '').match(/^Comprar (.+?) - /);
    return { st, title: t ? t[1] : '' };
  }

  async function post(body) {
    const res = await fetch(cfg.url, { method: 'POST', body: JSON.stringify(Object.assign({ key: cfg.key }, body)) });
    const out = await res.json();
    if (!out.ok) throw new Error(out.error || 'La app no aceptó la petición.');
    return out;
  }

  /* ---------- Importar la categoría que estás viendo ---------- */
  // /seccion/c/L101  ·  /seccion/categoria/c/L2051  ·  /seccion/categoria/pag-2/c/L2051
  const m = location.pathname.match(/^\/([^/]+)\/(?:([^/]+)\/)?(?:pag-\d+\/)?c\/(L\d+)/);

  function fromList(st, section, category) {
    const list = (st.l2 && st.l2.plp_items && st.l2.plp_items.length) ? st.l2.plp_items : ((st.l1 && st.l1.items) || []);
    return list.filter(i => i && i.sku_id && i.prices).map(i => ({
      id: String(i.sku_id),
      name: i.display_name,
      brand: i.brand || '',
      price: i.prices.price,
      ppu: i.prices.price_per_unit,
      unit: (i.prices.measure_unit || '').toLowerCase(),
      promo: !!(i.prices.is_promo_price || i.prices.discount_percentage > 0),
      before: i.prices.strikethrough_price,
      img: i.image ? 'https://www.dia.es' + i.image : '',
      url: i.url ? 'https://www.dia.es' + i.url : '',
      section,
      category
    }));
  }

  async function importCategory(sec, cat, id) {
    const base = `/${sec}/${cat}`;
    const first = await load(`${base}/c/${id}`);
    const name = first.title || pretty(cat);
    const pag = (first.st.pagination && first.st.pagination.pagination) || {};
    const pages = Math.min(Number(pag.total_pages) || 1, MAX_PAGES);
    let items = fromList(first.st, pretty(sec), name);
    for (let p = 2; p <= pages; p++) {
      msg(`Leyendo ${name}…`, `Página ${p} de ${pages}`);
      await wait(PAUSE_MS);
      items = items.concat(fromList((await load(`${base}/pag-${p}/c/${id}`)).st, pretty(sec), name));
    }
    return { name, items, capped: (Number(pag.total_pages) || 1) > MAX_PAGES };
  }

  async function runImport() {
    const [, sectionSlug, catSlug, catId] = m;
    let cats;
    if (catSlug) {
      cats = [[sectionSlug, catSlug, catId]];
    } else {
      // Sección general (p. ej. Quesos): recorre sus subcategorías.
      const seen = new Set();
      cats = [];
      document.querySelectorAll(`a[href^="/${sectionSlug}/"]`).forEach(a => {
        const mm = a.getAttribute('href').match(/^\/([^/]+)\/([^/]+)\/c\/(L\d+)$/);
        if (mm && mm[1] === sectionSlug && mm[3] !== catId && !seen.has(mm[3])) { seen.add(mm[3]); cats.push([mm[1], mm[2], mm[3]]); }
      });
    }

    let total = 0, added = 0, updated = 0;
    const capped = [];
    if (!cats.length) {
      msg('Leyendo productos…');
      const items = fromList((await load(location.pathname)).st, pretty(sectionSlug), pretty(sectionSlug));
      const r = await post({ products: items });
      total = items.length; added = r.added; updated = r.updated;
    } else {
      for (let i = 0; i < cats.length; i++) {
        msg(`Leyendo ${pretty(cats[i][1])}…`, cats.length > 1 ? `Categoría ${i + 1} de ${cats.length}` : '');
        const c = await importCategory(...cats[i]);
        if (c.capped) capped.push(c.name);
        if (c.items.length) {
          msg(`Guardando ${c.name}…`, `${c.items.length} productos`);
          const r = await post({ products: c.items });
          total += c.items.length; added += r.added; updated += r.updated;
        }
        if (i < cats.length - 1) await wait(PAUSE_MS);
      }
    }
    done(`✓ ${total} productos importados`,
      `${added} nuevos · ${updated} con precio actualizado` +
      (capped.length ? ` · En ${capped.join(', ')} solo se leen las 5 primeras páginas.` : ''), true);
  }

  /* ---------- Actualizar solo los productos que usas ---------- */
  async function runMine() {
    msg('Pidiendo tus productos a la app…');
    const mine = (await post({ action: 'mine' })).products || [];
    if (!mine.length) return done('No tienes productos de Dia vinculados.', 'Añádelos a tu lista eligiéndolos en las sugerencias "Dia" de la app.', false);

    const fresh = [], missing = [];
    let changed = 0;
    for (let i = 0; i < mine.length; i++) {
      const it = mine[i];
      msg('Actualizando tus precios…', `${i + 1} de ${mine.length} · ${it.name}`);
      try {
        const path = it.url ? new URL(it.url).pathname : '';
        const p = path && (await load(path)).st.product;
        if (!p || String(p.sku_id) !== it.id || !p.prices) { missing.push(it.name); }
        else {
          fresh.push({
            id: it.id,
            name: it.name,
            price: p.prices.price,
            ppu: p.prices.price_per_unit,
            unit: (p.prices.measure_unit || '').toLowerCase(),
            promo: Number(p.prices.strikethrough_price) > Number(p.prices.price),
            before: p.prices.strikethrough_price
          });
        }
      } catch (e) { missing.push(it.name); }
      // Guardar por tandas para no perder lo hecho si se cierra la pestaña.
      if (fresh.length >= 20 || (i === mine.length - 1 && fresh.length)) {
        changed += (await post({ products: fresh.splice(0) })).updated;
      }
      if (i < mine.length - 1) await wait(PAUSE_MS);
    }
    done(`✓ ${changed} precios actualizados`,
      missing.length ? `No encontrados en Dia (quizá descatalogados): ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}` : 'Todos tus productos están al día.', true);
  }

  /* ---------- Menú ---------- */
  msg('¿Qué quieres hacer?');
  if (m) button(m[2] ? `Importar "${pretty(m[2])}"` : `Importar la sección "${pretty(m[1])}"`, false, runImport);
  button('Actualizar mis precios', true, runMine);
  if (!m) $('.det').textContent = 'Para importar productos nuevos, abre antes una categoría (p. ej. Leche).';
})();
