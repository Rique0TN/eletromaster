/* EletroMaster — Módulos 1–8: editor de planta + projetos + área/perímetro
   Coordenadas internas em metros. Tudo salvo no localStorage do aparelho. */
'use strict';

const CHAVE = 'eletromaster.projetos.v1';
const TIPOS = [
  ['sala', 'Sala'], ['quarto', 'Quarto'], ['cozinha', 'Cozinha'], ['copa', 'Copa'],
  ['banheiro', 'Banheiro'], ['lavabo', 'Lavabo'], ['area_servico', 'Área de serviço'],
  ['varanda', 'Varanda'], ['corredor', 'Corredor'], ['garagem', 'Garagem'],
  ['escritorio', 'Escritório'], ['despensa', 'Despensa'], ['outro', 'Outro']
];
const nomeTipo = t => (TIPOS.find(x => x[0] === t) || [, 'Cômodo'])[1];
const CORES = { sala: '#3b9cff', quarto: '#a77bff', cozinha: '#ff9f43', copa: '#ffb86b', banheiro: '#2ed3c6', lavabo: '#2ed3c6', area_servico: '#5fd35f', varanda: '#9bd35f', corredor: '#8fa3bf', garagem: '#7f8c9f', escritorio: '#ff6fb5', despensa: '#c7a26b', outro: '#b0bccd' };

const GRADE = 0.05;      // ímã da grade: 5 cm
const TOL_PX = 16;       // tolerância de toque em pixels

// ---------- utilidades ----------
const $ = s => document.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const fmt = (v, c = 2) => v.toFixed(c).replace('.', ',');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function area(pts) { let s = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s) / 2; }
// NBR 5410 (9.5.2.1): ao menos 1 ponto de luz no teto por cômodo, com interruptor;
// carga mínima: até 6 m² = 100 VA; acima disso, 100 VA + 60 VA a cada 4 m² inteiros
function iluminacao(pts) { const a = area(pts); const va = a <= 6 ? 100 : 100 + 60 * Math.floor((a - 6 + 1e-9) / 4); return { pontos: 1, va }; }
// NBR 5410 (9.5.2.2) — TUG (tomadas de uso geral), mínimos aplicados pelo EletroMaster:
// banheiro/lavabo: 1 junto ao lavatório; cozinha/copa/área de serviço: 1 a cada 3,5 m de perímetro (ou fração),
// com 2 acima da bancada da pia; sala/quarto: 1 a cada 5 m (ou fração); varanda: 1;
// demais: até 6 m² = 1; acima, 1 a cada 5 m (ou fração).
// Potência: áreas molhadas = 600 VA nos 3 primeiros e 100 VA nos demais (se passar de 6, 600 VA em 2 e 100 VA no resto); outros = 100 VA cada.
const MOLHADAS = ['banheiro', 'lavabo', 'cozinha', 'copa', 'area_servico'];
const EXTRA_REC = { sala: 2, quarto: 2, cozinha: 3, copa: 2, area_servico: 2, banheiro: 1, lavabo: 0, varanda: 1, escritorio: 2, garagem: 1, corredor: 1, despensa: 0, outro: 1 };
function tugVA(tipo, n) { if (!MOLHADAS.includes(tipo)) return n * 100; const g = n > 6 ? 2 : Math.min(n, 3); return g * 600 + (n - g) * 100; }
function tug(c) {
  const a = area(c.pts), p = perimetro(c.pts), por = d => Math.max(1, Math.ceil(p / d - 1e-9)); let min, obs = '';
  if (c.tipo === 'banheiro' || c.tipo === 'lavabo') { min = 1; obs = '1 junto ao lavatório'; }
  else if (['cozinha', 'copa', 'area_servico'].includes(c.tipo)) { min = Math.max(por(3.5), c.tipo === 'area_servico' ? 1 : 2); obs = c.tipo === 'area_servico' ? '1 a cada 3,5 m de perímetro' : '1 a cada 3,5 m de perímetro; 2 acima da bancada da pia'; }
  else if (c.tipo === 'sala' || c.tipo === 'quarto') { min = por(5); obs = '1 a cada 5 m de perímetro, bem distribuídas'; }
  else if (c.tipo === 'varanda') { min = 1; obs = 'pelo menos 1'; }
  else { min = a <= 6 ? 1 : por(5); obs = a <= 2.25 ? '1 (pode ficar do lado de fora, até 0,80 m da porta)' : a <= 6 ? '1 (até 6 m²)' : '1 a cada 5 m de perímetro'; }
  const max = min + (EXTRA_REC[c.tipo] ?? 1), col = (c.pontos || []).filter(q => q.k === 'tom').length, n = Math.max(min, col);
  const sl = tomSlots(c, n), vaN = tugVA(c.tipo, n), va = sl.reduce((s, x) => s + x.va, 0);
  return { min, max, col, n, va, vaNorma: vaN, vaAp: va - vaN, vaMax: Math.max(tugVA(c.tipo, max), va), obs };
}
// v32: aparelhos ligados em tomada comum (TUG). Carga de cada tomada = maior entre o valor da norma e a soma dos aparelhos.
const APAR_TUG = [['geladeira', 'Geladeira', 250, 0.9], ['freezer', 'Freezer', 300, 0.9], ['micro', 'Micro-ondas', 1400, 0.95], ['airfryer', 'Air fryer', 1500, 1], ['liquid', 'Liquidificador', 600, 0.9], ['cafe', 'Cafeteira', 800, 1], ['sanduich', 'Sanduicheira', 750, 1], ['tv', 'TV', 150, 0.9], ['pc', 'Computador', 300, 0.9], ['note', 'Notebook', 90, 0.9], ['carreg', 'Carregador de celular', 20, 0.9], ['vent', 'Ventilador', 120, 0.9], ['ferro', 'Ferro de passar', 1200, 1], ['secador', 'Secador de cabelo', 1300, 1], ['chapinha', 'Chapinha', 60, 1], ['aspir', 'Aspirador', 1200, 0.9], ['roteador', 'Roteador/Wi-Fi', 15, 0.9], ['som', 'Som', 100, 0.9], ['outro', 'Outro aparelho', 100, 1]];
const apVA = u => Math.round(u.w / (u.fp || 1));
const apSoma = q => (q.ap || []).reduce((s, u) => s + apVA(u), 0);
function tomSlots(c, n) { // uma linha por tomada (colocadas na ordem da planta + as que faltam p/ o mínimo)
  const tom = (c.pontos || []).filter(q => q.k === 'tom'), out = [];
  for (let k = 1; k <= n; k++) { const q = tom[k - 1], base = tugVA(c.tipo, k) - tugVA(c.tipo, k - 1), ap = q ? apSoma(q) : 0; out.push({ q, base, ap, va: Math.max(base, ap) }); }
  return out;
}
function perimetro(pts) { let s = 0; for (let i = 0; i < pts.length; i++) s += dist(pts[i], pts[(i + 1) % pts.length]); return s; }
function centroide(pts) {
  let A = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length], f = a[0] * b[1] - b[0] * a[1]; A += f; cx += (a[0] + b[0]) * f; cy += (a[1] + b[1]) * f; }
  if (Math.abs(A) < 1e-9) { const n = pts.length; return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n]; }
  return [cx / (3 * A), cy / (3 * A)];
}
function dentro(p, pts) {
  let r = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) r = !r;
  }
  return r;
}
function distSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
  let t = L ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L : 0; t = Math.max(0, Math.min(1, t));
  return dist(p, [a[0] + t * dx, a[1] + t * dy]);
}
// "3,5" "3.5m" "350cm" "350 cm" -> metros. unidadePadrao: 'm' ou 'cm'
function lerMedida(txt, unidadePadrao) {
  if (txt == null) return NaN;
  let s = String(txt).trim().toLowerCase().replace(/\s+/g, '');
  let un = unidadePadrao;
  if (s.endsWith('cm')) { un = 'cm'; s = s.slice(0, -2); }
  else if (s.endsWith('mm')) { un = 'mm'; s = s.slice(0, -2); }
  else if (s.endsWith('m')) { un = 'm'; s = s.slice(0, -1); }
  s = s.replace(',', '.');
  const v = parseFloat(s);
  if (!isFinite(v) || v <= 0) return NaN;
  if (un === 'm' && !/[a-z]/.test(String(txt).toLowerCase()) && v > 50) un = 'cm'; // "350" digitado em metros = 350 cm
  return un === 'cm' ? v / 100 : un === 'mm' ? v / 1000 : v;
}

// ---------- armazenamento ----------
let banco = carregar();
function carregar() { try { return JSON.parse(localStorage.getItem(CHAVE)) || { projetos: [], unidade: 'm' }; } catch { return { projetos: [], unidade: 'm' }; } }
function salvar() { try { localStorage.setItem(CHAVE, JSON.stringify(banco)); } catch (e) { aviso('Não consegui salvar no aparelho: ' + e.message); } if (window.EMNuvem) EMNuvem.agendar(); }

// ---------- tela de projetos ----------
function mostrarTela(id) { document.querySelectorAll('.tela').forEach(t => t.classList.toggle('ativa', t.id === id)); }

function renderLista() {
  const el = $('#listaProjetos');
  const lista = [...banco.projetos].sort((a, b) => b.atualizado - a.atualizado);
  if (!lista.length) { el.innerHTML = '<div class="vazio">Nenhum projeto ainda. Crie o primeiro e desenhe a planta.</div>'; return; }
  el.innerHTML = lista.map(p => {
    const at = p.comodos.reduce((s, c) => s + area(c.pts), 0);
    const data = new Date(p.atualizado).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    return `<div class="cartao" data-id="${p.id}">
      <h3 data-acao="abrir">${esc(p.nome)}</h3>
      <div class="info">${p.comodos.length} cômodo(s) · ${fmt(at)} m² · editado ${data}</div>
      <div class="acoes">
        <button class="btn primario" data-acao="abrir">Abrir</button>
        <button class="btn" data-acao="renomear">Renomear</button>
        <button class="btn" data-acao="notas">📝 Notas${p.notas ? ' •' : ''}</button>
        <button class="btn" data-acao="duplicar">Duplicar</button>
        <button class="btn perigo" data-acao="excluir">Excluir</button>
      </div></div>`;
  }).join('');
}
$('#listaProjetos').addEventListener('click', e => {
  const b = e.target.closest('[data-acao]'); if (!b) return;
  const id = b.closest('.cartao').dataset.id, p = banco.projetos.find(x => x.id === id);
  const acao = b.dataset.acao;
  if (acao === 'abrir') abrirProjeto(id);
  else if (acao === 'renomear') pedirTexto('Renomear projeto', p.nome, n => { p.nome = n; p.atualizado = Date.now(); salvar(); renderLista(); });
  else if (acao === 'duplicar') { const c = clone(p); c.id = uid(); c.nome = p.nome + ' (cópia)'; c.criado = c.atualizado = Date.now(); banco.projetos.push(c); salvar(); renderLista(); }
  else if (acao === 'excluir') confirmar(`Excluir "${p.nome}"? Não dá pra desfazer.`, () => { banco.projetos = banco.projetos.filter(x => x.id !== id); if (window.EMNuvem) EMNuvem.apagado(id); salvar(); renderLista(); });
  else if (acao === 'notas') abrirNotas(p, renderLista);
});
$('#btnNovoProjeto').onclick = () => {
  pedirTexto('Nome do projeto', 'Casa ' + (banco.projetos.length + 1), nome => {
    const p = { id: uid(), nome, criado: Date.now(), atualizado: Date.now(), comodos: [] };
    banco.projetos.push(p); salvar(); abrirProjeto(p.id);
  });
};

// bloco de notas por projeto
function abrirNotas(p, depois) {
  abrirModal(`<h2>📝 Notas · ${esc(p.nome)}</h2><div class="campo"><textarea id="mNotas" rows="9" maxlength="20000" placeholder="Anotações da obra: medidas, pedidos do cliente, materiais, pendências...">${esc(p.notas || '')}</textarea></div>
    <div class="botoes"><button class="btn" id="mCanc">Cancelar</button><button class="btn primario" id="mOk">Salvar</button></div>`);
  $('#mCanc').onclick = fecharModal;
  $('#mOk').onclick = () => { p.notas = $('#mNotas').value; p.atualizado = Date.now(); salvar(); fecharModal(); aviso('Notas salvas'); if (depois) depois(); };
}
// abas da tela inicial
document.querySelectorAll('.abas [data-aba]').forEach(b => b.onclick = () => {
  document.querySelectorAll('.abas [data-aba]').forEach(x => x.classList.toggle('ativa', x === b));
  const meus = b.dataset.aba === 'meus';
  $('#abaMeus').hidden = !meus; $('#abaComp').hidden = meus;
});
$('#btnNotasProj').onclick = () => proj && abrirNotas(proj);

// ---------- modal ----------
function abrirModal(html) { $('#modalConteudo').innerHTML = html; $('#modal').classList.remove('escondido'); }
function fecharModal() { $('#modal').classList.add('escondido'); $('#modalConteudo').innerHTML = ''; }
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal' && !$('#modal').dataset.obrigatorio) fecharModal(); });
function pedirTexto(titulo, valor, ok) {
  abrirModal(`<h2>${esc(titulo)}</h2><div class="campo"><input id="mTxt" type="text" value="${esc(valor)}" maxlength="80"></div>
    <div class="botoes"><button class="btn" id="mCanc">Cancelar</button><button class="btn primario" id="mOk">Salvar</button></div>`);
  const i = $('#mTxt'); i.focus(); i.select();
  const fim = () => { const v = i.value.trim(); if (!v) return; fecharModal(); ok(v); };
  $('#mOk').onclick = fim; $('#mCanc').onclick = fecharModal; i.onkeydown = e => { if (e.key === 'Enter') fim(); };
}
// avisos e confirmações próprios (alguns apps abrem o site num navegador interno que ignora alert/confirm)
function aviso(msg) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('vis'); clearTimeout(aviso.tm); aviso.tm = setTimeout(() => t.classList.remove('vis'), 3200);
}
function confirmar(msg, ok, rotulo = 'Excluir') {
  abrirModal(`<h2>${esc(msg)}</h2><div class="botoes"><button class="btn" id="mCanc">Cancelar</button><button class="btn primario perigoso" id="mOk">${esc(rotulo)}</button></div>`);
  $('#mCanc').onclick = fecharModal; $('#mOk').onclick = () => { fecharModal(); ok(); };
}
const opcoesTipo = sel => TIPOS.map(([k, n]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${n}</option>`).join('');

// ---------- estado do editor ----------
let proj = null;                 // projeto aberto
let vista = { esc: 60, ox: 0, oy: 0 }; // px por metro e deslocamento
let modo = 'selecionar';
let sel = { comodo: null, parede: null };
let rascunho = [];               // pontos do desenho em andamento
let cursor = null;               // posição prevista (mouse)
let pilhaDesfazer = [], pilhaRefazer = [];

function abrirProjeto(id) {
  proj = banco.projetos.find(p => p.id === id);
  pilhaDesfazer = []; pilhaRefazer = []; rascunho = []; sel = { comodo: null, parede: null };
  $('#nomeProjeto').textContent = proj.nome;
  mostrarTela('telaEditor');
  definirModo(proj.comodos.length ? 'selecionar' : 'desenhar');
  requestAnimationFrame(() => { enquadrar(); render(); if (!banco.tutorialVisto && !document.getElementById('lobby')) tutorial(0); });
}
$('#btnVoltar').onclick = () => { const sair = () => { rascunho = []; proj = null; mostrarTela('telaProjetos'); renderLista(); }; rascunho.length ? confirmar('Descartar o cômodo que está sendo desenhado?', sair, 'Descartar') : sair(); };
$('#nomeProjeto').onclick = () => pedirTexto('Renomear projeto', proj.nome, n => { proj.nome = n; gravar(); $('#nomeProjeto').textContent = n; });

function gravar() { proj.atualizado = Date.now(); salvar(); }
function checkpoint() { pilhaDesfazer.push(clone(proj.comodos)); if (pilhaDesfazer.length > 80) pilhaDesfazer.shift(); pilhaRefazer = []; atualizarBotoes(); }
function desfazer() {
  if (modo === 'desenhar' && rascunho.length) { rascunho.pop(); render(); return; }
  if (!pilhaDesfazer.length) return;
  pilhaRefazer.push(clone(proj.comodos)); proj.comodos = pilhaDesfazer.pop();
  sel = { comodo: null, parede: null }; gravar(); render();
}
function refazer() {
  if (!pilhaRefazer.length) return;
  pilhaDesfazer.push(clone(proj.comodos)); proj.comodos = pilhaRefazer.pop();
  sel = { comodo: null, parede: null }; gravar(); render();
}
function atualizarBotoes() { $('#btnDesfazer').disabled = !(pilhaDesfazer.length || rascunho.length); $('#btnRefazer').disabled = !pilhaRefazer.length; }
$('#btnDesfazer').onclick = desfazer; $('#btnRefazer').onclick = refazer;
document.addEventListener('keydown', e => {
  if (!proj || e.target.tagName === 'INPUT') return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? refazer() : desfazer(); }
  if (e.key === 'Escape') { rascunho = []; sel = { comodo: null, parede: null }; render(); }
  if ((e.key === 'Delete' || e.key === 'Backspace') && sel.comodo && sel.parede == null) excluirComodo();
});

const comodo = id => proj.comodos.find(c => c.id === id);

// ---------- vista ----------
const svg = $('#svg');
const tela = w => [w[0] * vista.esc + vista.ox, w[1] * vista.esc + vista.oy];
const mundo = s => [(s[0] - vista.ox) / vista.esc, (s[1] - vista.oy) / vista.esc];
function enquadrar() {
  const r = svg.getBoundingClientRect();
  const pts = proj.comodos.flatMap(c => c.pts).concat(rascunho); { const g = proj && ruaGeo(); if (g) { const o = k => [g.m[0] + g.dir[0] * k, g.m[1] + g.dir[1] * k]; pts.push(g.A, g.B, o(7.5)); } }
  if (!pts.length) { vista.esc = Math.min(r.width, r.height) / 8; vista.ox = r.width / 2; vista.oy = r.height / 2; return; }
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
  const w = Math.max(maxx - minx, 1), h = Math.max(maxy - miny, 1);
  vista.esc = Math.min((r.width - 90) / w, (r.height - 110) / h, 300);
  vista.ox = r.width / 2 - (minx + w / 2) * vista.esc;
  vista.oy = r.height / 2 - (miny + h / 2) * vista.esc;
}
$('#btnCentralizar').onclick = () => { enquadrar(); render(); };
// v29: camadas da planta (mostrar/ocultar cada tipo de marcação)
const CAMADAS = [['cotas', '📏 Medidas das paredes'], ['nomes', '🏷️ Nome e área dos cômodos'], ['cargas', '💡 Cargas (luz, TUG, TUE)'], ['pontos', '🔌 Tomadas, interruptores e quadro'], ['portas', '🚪 Portas, janelas e vãos']];
function cam(k) { if (!banco.camadas) banco.camadas = { cotas: !banco.ocultarCotas }; return banco.camadas[k] !== false; }
function marcarCotas() { const b = $('#btnCotas'), oc = CAMADAS.filter(([k]) => !cam(k)).length; b.style.opacity = oc ? .6 : 1; b.textContent = oc ? '👁' + oc : '👁'; }
function abrirCamadas() {
  abrirModal(`<h2>👁 O que mostrar na planta</h2>
    ${CAMADAS.map(([k, n]) => `<label style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--linha)"><span>${n}</span><input type="checkbox" data-cam="${k}" ${cam(k) ? 'checked' : ''} style="width:24px;height:24px"></label>`).join('')}
    <div style="margin:10px 0;font-size:13px;opacity:.75">A parede selecionada sempre mostra a medida, e no modo 🔌 Pontos as tomadas aparecem mesmo ocultas, pra você poder editar.</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="camTodos">Mostrar tudo</button><button class="btn" id="camNada">Ocultar tudo</button><button class="btn primario" id="camOk" style="margin-left:auto">Pronto</button></div>`);
  const set = (k, v) => { cam(k); banco.camadas[k] = v; banco.ocultarCotas = !cam('cotas'); salvar(); marcarCotas(); render(); };
  document.querySelectorAll('[data-cam]').forEach(i => i.onchange = () => set(i.dataset.cam, i.checked));
  $('#camTodos').onclick = () => { CAMADAS.forEach(([k]) => set(k, true)); abrirCamadas(); };
  $('#camNada').onclick = () => { CAMADAS.forEach(([k]) => set(k, false)); abrirCamadas(); };
  $('#camOk').onclick = fecharModal;
}
$('#btnCotas').onclick = abrirCamadas;
marcarCotas();
window.addEventListener('resize', () => proj && render());
function zoomEm(sx, sy, fator) {
  const novo = Math.max(8, Math.min(1500, vista.esc * fator)); fator = novo / vista.esc;
  vista.ox = sx - (sx - vista.ox) * fator; vista.oy = sy - (sy - vista.oy) * fator; vista.esc = novo;
}

// ---------- ímãs ----------
function todosVertices(excetoId) { const v = []; proj.comodos.forEach(c => { if (c.id !== excetoId) c.pts.forEach(p => v.push(p)); }); return v; }
function paredesTodas(excetoId) { const r = []; proj.comodos.forEach(c => { if (c.id !== excetoId) c.pts.forEach((a, i) => r.push([a, c.pts[(i + 1) % c.pts.length]])); }); return r; }
function imantar(w, ref, excetoId, mult = 1) {
  const tol = TOL_PX * mult / vista.esc;
  const cand = todosVertices(excetoId).concat(rascunho.length >= 3 ? [rascunho[0]] : []);
  let melhor = null, md = tol;
  cand.forEach(p => { const d = dist(p, w); if (d < md) { md = d; melhor = p; } });
  if (melhor) return [melhor[0], melhor[1]];
  let x = w[0], y = w[1];
  if (ref) { // ortogonal: trava no eixo quando quase reto
    const dx = x - ref[0], dy = y - ref[1], ang = Math.abs(Math.atan2(dy, dx) * 180 / Math.PI);
    if (ang < 9 || ang > 171) y = ref[1];
    else if (Math.abs(ang - 90) < 9) x = ref[0];
  }
  // encosta numa parede existente (pra começar ou terminar um cômodo colado no outro)
  const fixY = ref && y === ref[1], fixX = ref && x === ref[0];
  for (const [a, b] of paredesTodas(excetoId)) {
    if (distSeg([x, y], a, b) > tol) continue;
    const vert = Math.abs(a[0] - b[0]) < 1e-6, horiz = Math.abs(a[1] - b[1]) < 1e-6;
    if (fixY && vert) return [a[0], y];
    if (fixX && horiz) return [x, a[1]];
    if (!ref) {
      const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
      let t = ((x - a[0]) * dx + (y - a[1]) * dy) / L2; t = Math.max(0, Math.min(1, t));
      const L = Math.sqrt(L2); t = Math.round(t * L / GRADE) * GRADE / L;
      return [+(a[0] + t * dx).toFixed(4), +(a[1] + t * dy).toFixed(4)];
    }
  }
  const g = v => Math.round(v / GRADE) * GRADE;
  if (ref && y === ref[1]) return [ref[0] + g(x - ref[0]), y];
  if (ref && x === ref[0]) return [x, ref[1] + g(y - ref[1])];
  return [g(x), g(y)];
}

// ---------- portas ----------
// v41: tipos de abertura (porta de giro, dupla, de correr, vão livre, arco, janela)
const TIPOS_ABERT = [['giro', '🚪 Porta'], ['dupla', '🚪🚪 Porta dupla'], ['correr', '↔️ Porta de correr'], ['vao', '▯ Vão livre'], ['arco', '⌒ Arco'], ['janela', '🪟 Janela']];
// porta = { id, parede, pos (m do canto inicial até o centro), largura, fora (abre pra fora), inverter (dobradiça do outro lado) }
function geoPorta(c, pt) {
  const n = c.pts.length, a = c.pts[pt.parede % n], b = c.pts[(pt.parede + 1) % n], L = dist(a, b);
  if (L < 1e-6) return null;
  const w = Math.min(pt.largura, L), pos = Math.max(w / 2, Math.min(L - w / 2, pt.pos));
  const d = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  let nrm = [-d[1], d[0]];
  const ct = centroide(c.pts), mid = [a[0] + d[0] * pos, a[1] + d[1] * pos];
  if ((ct[0] - mid[0]) * nrm[0] + (ct[1] - mid[1]) * nrm[1] < 0) nrm = [-nrm[0], -nrm[1]];
  if (pt.fora) nrm = [-nrm[0], -nrm[1]];
  const p0 = [a[0] + d[0] * (pos - w / 2), a[1] + d[1] * (pos - w / 2)], p1 = [a[0] + d[0] * (pos + w / 2), a[1] + d[1] * (pos + w / 2)];
  const h = pt.inverter ? p1 : p0, u = pt.inverter ? [-d[0], -d[1]] : d;
  return { p0, p1, h, u, nrm, w };
}
function svgPorta(c, pt, destaque) {
  const g = geoPorta(c, pt); if (!g) return '';
  const A = tela(g.p0), B = tela(g.p1), H = tela(g.h);
  const folha = tela([g.h[0] + g.nrm[0] * g.w, g.h[1] + g.nrm[1] * g.w]);
  let arco = [];
  for (let k = 0; k <= 16; k++) { const t = k / 16 * Math.PI / 2, q = [g.h[0] + g.w * (Math.cos(t) * g.nrm[0] + Math.sin(t) * g.u[0]), g.h[1] + g.w * (Math.cos(t) * g.nrm[1] + Math.sin(t) * g.u[1])]; arco.push(tela(q).map(v => v.toFixed(1)).join(',')); }
  const cor = destaque ? '#ffc531' : '#e8eef7', tp = pt.tipo || 'giro', L = (p, q) => { const P = tela(p), Q = tela(q); return `<line x1="${P[0].toFixed(1)}" y1="${P[1].toFixed(1)}" x2="${Q[0].toFixed(1)}" y2="${Q[1].toFixed(1)}"`; };
  const of = (p, k) => [p[0] + g.nrm[0] * k, p[1] + g.nrm[1] * k], fundo = `<line x1="${A[0]}" y1="${A[1]}" x2="${B[0]}" y2="${B[1]}" stroke="#0d1626" stroke-width="7"/>`;
  if (tp !== 'giro') {
    const ombro = p => `${L(of(p, -0.12), of(p, 0.12))} stroke="${cor}" stroke-width="2.5"/>`;
    if (tp === 'vao' || tp === 'arco') return fundo + ombro(g.p0) + ombro(g.p1) + (tp === 'arco' ? `${L(g.p0, g.p1)} stroke="${cor}" stroke-width="1.3" stroke-dasharray="6 4"/>` : '');
    if (tp === 'janela') return fundo + ombro(g.p0) + ombro(g.p1) + [-0.06, 0, 0.06].map(k => `${L(of(g.p0, k), of(g.p1, k))} stroke="#7ee0ff" stroke-width="${k ? 1.6 : 1}"/>`).join('');
    if (tp === 'correr') { const m = [(g.p0[0] + g.p1[0]) / 2, (g.p0[1] + g.p1[1]) / 2], s = pt.inverter ? -1 : 1; return fundo + ombro(g.p0) + ombro(g.p1) + `${L(of(g.p0, 0.05), of(m, 0.05))} stroke="${cor}" stroke-width="2.5"/>` + `${L(of(m, -0.05), of(g.p1, -0.05))} stroke="${cor}" stroke-width="2.5"/>`; }
    if (tp === 'dupla') {
      const w2 = g.w / 2, arc = (h, u) => { const r = []; for (let k = 0; k <= 12; k++) { const t = k / 12 * Math.PI / 2; r.push(tela([h[0] + w2 * (Math.cos(t) * g.nrm[0] + Math.sin(t) * u[0]), h[1] + w2 * (Math.cos(t) * g.nrm[1] + Math.sin(t) * u[1])]).map(v => v.toFixed(1)).join(',')); } return `<polyline points="${r.join(' ')}" fill="none" stroke="${cor}" stroke-width="1.3" stroke-dasharray="4 3"/>`; };
      const dd = [(g.p1[0] - g.p0[0]) / g.w, (g.p1[1] - g.p0[1]) / g.w];
      return fundo + `${L(g.p0, of(g.p0, w2))} stroke="${cor}" stroke-width="2.5"/>${L(g.p1, of(g.p1, w2))} stroke="${cor}" stroke-width="2.5"/>` + arc(g.p0, dd) + arc(g.p1, [-dd[0], -dd[1]]);
    }
  }
  return `<line x1="${A[0]}" y1="${A[1]}" x2="${B[0]}" y2="${B[1]}" stroke="#0d1626" stroke-width="7"/>
    <line x1="${H[0]}" y1="${H[1]}" x2="${folha[0]}" y2="${folha[1]}" stroke="${cor}" stroke-width="2.5"/>
    <polyline points="${arco.join(' ')}" fill="none" stroke="${cor}" stroke-width="1.3" stroke-dasharray="4 3"/>`;
}

// ---------- desenho ----------
function render() {
  if (!proj) return;
  const r = svg.getBoundingClientRect(), W = r.width, H = r.height;
  let h = '';
  // grade
  let passo = 0.5; while (passo * vista.esc < 14) passo *= 2; if (passo * vista.esc > 120) passo = 0.25;
  const [x0, y0] = mundo([0, 0]), [x1, y1] = mundo([W, H]);
  for (let x = Math.floor(x0 / passo) * passo; x <= x1; x += passo) {
    const sx = tela([x, 0])[0], forte = Math.abs(x - Math.round(x)) < 1e-6 && passo <= 1;
    h += `<line x1="${sx}" y1="0" x2="${sx}" y2="${H}" stroke="${forte ? '#1f3150' : '#16243b'}" stroke-width="1"/>`;
  }
  for (let y = Math.floor(y0 / passo) * passo; y <= y1; y += passo) {
    const sy = tela([0, y])[1], forte = Math.abs(y - Math.round(y)) < 1e-6 && passo <= 1;
    h += `<line x1="0" y1="${sy}" x2="${W}" y2="${sy}" stroke="${forte ? '#1f3150' : '#16243b'}" stroke-width="1"/>`;
  }
  h += svgRua();
  // cômodos
  proj.comodos.forEach(c => {
    const cor = CORES[c.tipo] || '#b0bccd', s = c.id === sel.comodo;
    const d = c.pts.map(p => tela(p).map(v => v.toFixed(1)).join(',')).join(' ');
    h += `<polygon points="${d}" fill="${cor}" fill-opacity="${s ? .22 : .12}" stroke="#e8eef7" stroke-width="${s ? 4 : 3}" stroke-linejoin="round"/>`;
  });
  { const c = sel.comodo && comodo(sel.comodo); if (c && sel.parede != null) { const A = tela(c.pts[sel.parede]), B = tela(c.pts[(sel.parede + 1) % c.pts.length]); h += `<line x1="${A[0]}" y1="${A[1]}" x2="${B[0]}" y2="${B[1]}" stroke="#ffc531" stroke-width="6" stroke-linecap="round"/>`; } }
  if (cam('portas')) proj.comodos.forEach(c => (c.portas || []).forEach(pt => h += svgPorta(c, pt, c.id === sel.comodo && sel.parede === pt.parede)));
  if (cam('pontos') || modo === 'pontos') proj.comodos.forEach(c => (c.pontos || []).forEach(q => h += svgPonto(c, q, modo === 'pontos' && selPonto === q.id)));
  if (modo === 'pontos') { const cc = centroCargas(); if (cc) { const P = tela(cc); h += `<g transform="translate(${P[0].toFixed(1)},${P[1].toFixed(1)})" opacity=".85"><circle r="11" fill="none" stroke="#ff7a59" stroke-width="2" stroke-dasharray="4 3"/><path d="M-15,0H15M0,-15V15" stroke="#ff7a59" stroke-width="1.5"/><text y="-16" text-anchor="middle" font-size="10" font-weight="700" fill="#ff7a59">centro de cargas</text></g>`; } }
  proj.comodos.forEach(c => {
    const s = c.id === sel.comodo;
    // cotas das paredes: sempre na horizontal (fácil de ler) e um pouco pra dentro do cômodo
    const ctc = tela(centroide(c.pts));
    c.pts.forEach((a, i) => {
      const b = c.pts[(i + 1) % c.pts.length], L = dist(a, b);
      const A = tela(a), B = tela(b), mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2;
      if (Math.hypot(B[0] - A[0], B[1] - A[1]) < 52) return;
      const ps = s && sel.parede === i;
      if (!cam('cotas') && !ps) return;
      const Ls = Math.hypot(B[0] - A[0], B[1] - A[1]); let nx = -(B[1] - A[1]) / Ls, ny = (B[0] - A[0]) / Ls;
      if (nx * (ctc[0] - mx) + ny * (ctc[1] - my) < 0) { nx = -nx; ny = -ny; }
      const off = Math.abs(nx) > Math.abs(ny) ? 34 : 18, lx = mx + nx * off, ly = my + ny * off;
      h += `<g transform="translate(${lx.toFixed(1)},${ly.toFixed(1)})"><rect x="-27" y="-11" width="54" height="21" rx="6" fill="#0d1626" fill-opacity=".9"/>
        <text y="4.5" text-anchor="middle" font-size="14" font-weight="700" fill="${ps ? '#ffc531' : '#cfe0f5'}">${fmt(L)}</text></g>`;
    });
    // nome + área / cargas (camadas)
    const ct = tela(centroide(c.pts));
    if (cam('nomes')) h += `<text x="${ct[0]}" y="${ct[1] - 4}" text-anchor="middle" font-size="14" font-weight="700" fill="#fff">${esc(c.nome)}</text>
      <text x="${ct[0]}" y="${ct[1] + 13}" text-anchor="middle" font-size="12" fill="#ffc531">${fmt(area(c.pts))} m²</text>`;
    if (cam('cargas')) h += `<text x="${ct[0]}" y="${ct[1] + 28}" text-anchor="middle" font-size="11" fill="#7ee0a0">🔌 ${tug(c).min}–${tug(c).max} TUG${(c.tue || []).length ? ` · ⚡ ${c.tue.length} TUE` : ''}</text>
      <g transform="translate(${ct[0]},${ct[1] - 34})"><circle r="9" fill="#0d1626" stroke="#ffd84a" stroke-width="2"/><path d="M-6,-6L6,6M6,-6L-6,6" stroke="#ffd84a" stroke-width="2"/>
      <text x="13" y="4" font-size="11" fill="#ffd84a">${iluminacao(c.pts).va} VA</text></g>`;
    if (s && modo === 'selecionar') c.pts.forEach(p => { const P = tela(p); h += `<circle cx="${P[0]}" cy="${P[1]}" r="7" fill="#3b9cff" stroke="#fff" stroke-width="2"/>`; });
  });
  if (modo === 'desenhar') proj.comodos.forEach(c => c.pts.forEach(p => { const P = tela(p); h += `<circle cx="${P[0]}" cy="${P[1]}" r="7" fill="#3b9cff" stroke="#fff" stroke-width="2"/>`; }));
  // rascunho
  if (rascunho.length) {
    const pts = rascunho.map(tela);
    const prev = cursor && modo === 'desenhar' ? tela(cursor) : null;
    h += `<polyline points="${pts.map(p => p.join(',')).join(' ')}" fill="none" stroke="#ffc531" stroke-width="3"/>`;
    if (prev) {
      const ult = pts[pts.length - 1];
      h += `<line x1="${ult[0]}" y1="${ult[1]}" x2="${prev[0]}" y2="${prev[1]}" stroke="#ffc531" stroke-width="2" stroke-dasharray="6 5"/>`;
      h += `<text x="${prev[0] + 10}" y="${prev[1] - 10}" font-size="14" font-weight="700" fill="#ffc531">${fmt(dist(rascunho[rascunho.length - 1], cursor))}</text>`;
    }
    rascunho.forEach((p, i) => {
      if (i) { const a = tela(rascunho[i - 1]), b = tela(p); h += `<text x="${(a[0] + b[0]) / 2}" y="${(a[1] + b[1]) / 2 - 8}" text-anchor="middle" font-size="14" font-weight="700" fill="#ffc531">${fmt(dist(rascunho[i - 1], p))}</text>`; }
    });
    pts.forEach((p, i) => h += `<circle cx="${p[0]}" cy="${p[1]}" r="${i === 0 && rascunho.length >= 3 ? 10 : 6}" fill="${i === 0 ? '#3ddc97' : '#ffc531'}" stroke="#0d1626" stroke-width="2"/>`);
  }
  svg.innerHTML = h;
  atualizarBotoes();
  renderPainel(); ajustarPainel();
  renderDica();
}

function renderDica() {
  let t = '';
  if (modo === 'desenhar') {
    if (!rascunho.length) t = proj.comodos.length ? 'Comece numa bolinha azul (ou numa parede) e arraste pra criar o próximo cômodo' : 'Arraste o dedo pra desenhar a primeira parede';
    else if (rascunho.length < 3) t = 'Arraste de novo pra próxima parede (ou digite a medida e use as setas)';
    else t = 'Continue, ou arraste até o ponto verde pra fechar';
  } else if (modo === 'pontos') t = proj.comodos.length ? 'Escolha o tipo embaixo e toque perto da parede pra colocar. Arraste pra mudar de lugar.' : 'Desenhe um cômodo primeiro';
  else if (modo === 'ver') t = 'Modo livre: arraste pra mover e use a pinça pro zoom. Toque num modo embaixo pra editar.';
  else if (!proj.comodos.length) t = 'Toque em Desenhar ou Retângulo para começar';
  else if (!sel.comodo) t = 'Toque num cômodo ou numa parede';
  else if (sel.parede == null) t = 'Arraste cantos ou portas, ou toque numa parede pra medida e porta';
  $('#dica').textContent = t;
}

// ---------- painel inferior ----------
// painel recolhível: toque na barrinha do topo esconde; botão ▴ traz de volta (desenho nunca recolhe)
let painelMin = false;
function ajustarPainel() {
  const p = $('#painel'), b = $('#btnPainel'), pode = p.classList.contains('aberto') && p.dataset.tipo !== 'desenho';
  if (!pode) painelMin = false;
  p.classList.toggle('min', painelMin && pode);
  b.hidden = !(painelMin && pode);
  let g = p.querySelector('.puxador');
  if (pode && !g) { g = document.createElement('button'); g.className = 'puxador'; g.setAttribute('aria-label', 'Ocultar detalhes'); g.innerHTML = '<span></span>▾ Ocultar'; g.onclick = () => { painelMin = true; ajustarPainel(); render(); }; p.prepend(g); }
  if (!pode && g) g.remove();
}
$('#btnPainel').onclick = () => { painelMin = false; ajustarPainel(); render(); };
function renderPainel() {
  const p = $('#painel');
  if (modo === 'desenhar') {
    p.classList.add('aberto');
    if (p.dataset.tipo === 'desenho') { // não recria (mantém o teclado aberto)
      p.querySelector('#btnFechar').disabled = rascunho.length < 3; return;
    }
    p.dataset.tipo = 'desenho';
    p.innerHTML = `<div class="linha">
        <label>Medida</label><input id="inMedida" class="num" type="text" inputmode="decimal" placeholder="${banco.unidade === 'cm' ? '350' : '3,50'}">
        <select id="selUn"><option value="m" ${banco.unidade === 'm' ? 'selected' : ''}>m</option><option value="cm" ${banco.unidade === 'cm' ? 'selected' : ''}>cm</option></select>
        <div class="setas"><span></span><button data-d="0,-1">↑</button><span></span><button data-d="-1,0">←</button><button data-d="0,1">↓</button><button data-d="1,0">→</button></div>
      </div>
      <div class="linha"><button class="btn" id="btnCancDes">Cancelar</button><button class="btn primario" id="btnFechar">Fechar cômodo</button></div>`;
    p.querySelector('#selUn').onchange = e => { banco.unidade = e.target.value; salvar(); p.querySelector('#inMedida').placeholder = banco.unidade === 'cm' ? '350' : '3,50'; };
    p.querySelectorAll('.setas button').forEach(b => b.onclick = () => {
      const L = lerMedida(p.querySelector('#inMedida').value, banco.unidade);
      if (!rascunho.length) { aviso('Primeiro toque no desenho pra marcar o canto inicial.'); return; }
      if (!isFinite(L)) { aviso('Digite a medida da parede (ex.: 3,50 m ou 350 cm).'); return; }
      const [dx, dy] = b.dataset.d.split(',').map(Number), u = rascunho[rascunho.length - 1];
      const novo = [+(u[0] + dx * L).toFixed(4), +(u[1] + dy * L).toFixed(4)];
      if (rascunho.length >= 3 && dist(novo, rascunho[0]) < 0.005) { fecharRascunho(); return; }
      rascunho.push(novo); p.querySelector('#inMedida').value = ''; garantirVisivel(novo); render();
    });
    p.querySelector('#btnCancDes').onclick = () => { rascunho = []; definirModo('selecionar'); };
    p.querySelector('#btnFechar').onclick = fecharRascunho;
    p.querySelector('#btnFechar').disabled = rascunho.length < 3;
    return;
  }
  p.dataset.tipo = '';
  if (modo === 'ver') { p.classList.remove('aberto'); p.innerHTML = ''; return; }
  if (modo === 'pontos') { painelPontos(p); return; }
  const c = sel.comodo && comodo(sel.comodo);
  if (!c) { p.classList.remove('aberto'); p.innerHTML = ''; return; }
  p.classList.add('aberto');
  if (sel.parede != null) {
    const i = sel.parede, a = c.pts[i], b = c.pts[(i + 1) % c.pts.length], L = dist(a, b);
    const val = banco.unidade === 'cm' ? fmt(L * 100, 1) : fmt(L);
    p.innerHTML = `<div class="linha medidas">${esc(c.nome)} · parede ${i + 1}: <b>${fmt(L)} m</b></div>
      <div class="linha"><label>Nova medida</label><input id="inParede" class="num" type="text" inputmode="decimal" value="${val}">
        <select id="selUn2"><option value="m" ${banco.unidade === 'm' ? 'selected' : ''}>m</option><option value="cm" ${banco.unidade === 'cm' ? 'selected' : ''}>cm</option></select>
        <button class="btn primario" id="btnAplicar">Aplicar</button><button class="btn" id="btnVoltarComodo">Cômodo</button></div>
      ${(c.portas || []).map((pt, k) => pt.parede === i ? `<div class="linha porta-linha" data-k="${k}">${TIPOS_ABERT.find(x => x[0] === (pt.tipo || 'giro'))[1]} ${fmt(pt.largura)} m · a <input class="num pPos" type="text" inputmode="decimal" value="${fmt(Math.max(0, pt.pos - pt.largura / 2))}"> m do canto
        ${!pt.tipo || pt.tipo === 'giro' ? `<button class="btn pGirar">↻ Girar</button><button class="btn pFora">${pt.fora ? 'Pra fora' : 'Pra dentro'}</button><button class="btn pInv">⇆ Lado</button>` : pt.tipo === 'dupla' ? `<button class="btn pFora">${pt.fora ? 'Pra fora' : 'Pra dentro'}</button>` : ''}<button class="btn perigo pExc">✕</button></div>` : '').join('')}
      <div class="linha"><select id="selTipoAb">${TIPOS_ABERT.map(([k, n]) => `<option value="${k}" ${k === (banco.ultAb || 'giro') ? 'selected' : ''}>${n}</option>`).join('')}</select><select id="selLargPorta">${[0.6, 0.7, 0.8, 0.9, 1.0, 1.2, 1.5, 2.0, 2.5, 3.0].map(v => `<option value="${v}" ${v === (banco.ultLarg || 0.8) ? 'selected' : ''}>${fmt(v)} m</option>`).join('')}</select>
        <button class="btn" id="btnAddPorta">+ Adicionar</button></div>`;
    p.querySelector('#btnAddPorta').onclick = () => {
      const w = parseFloat(p.querySelector('#selLargPorta').value);
      if (w > L + 1e-6) { aviso('A porta é maior que a parede.'); return; }
      const tp = p.querySelector('#selTipoAb').value; banco.ultAb = tp; banco.ultLarg = w; salvar();
      checkpoint(); c.portas = c.portas || []; c.portas.push({ id: uid(), tipo: tp, parede: i, pos: L / 2, largura: w, fora: false, inverter: false }); gravar(); render();
    };
    p.querySelectorAll('.porta-linha').forEach(row => {
      const pt = c.portas[+row.dataset.k];
      if (row.querySelector('.pGirar')) row.querySelector('.pGirar').onclick = () => { // 4 posições: dentro-esq, dentro-dir, fora-dir, fora-esq
        checkpoint(); const k = (pt.fora ? 2 : 0) + ((pt.fora ? !pt.inverter : pt.inverter) ? 1 : 0), n = (k + 1) % 4;
        pt.fora = n >= 2; pt.inverter = pt.fora ? n === 2 : n === 1; gravar(); render();
      };
      if (row.querySelector('.pFora')) row.querySelector('.pFora').onclick = () => { checkpoint(); pt.fora = !pt.fora; gravar(); render(); };
      if (row.querySelector('.pInv')) row.querySelector('.pInv').onclick = () => { checkpoint(); pt.inverter = !pt.inverter; gravar(); render(); };
      row.querySelector('.pExc').onclick = () => { checkpoint(); c.portas.splice(+row.dataset.k, 1); gravar(); render(); };
      row.querySelector('.pPos').onchange = e => {
        const v = parseFloat(String(e.target.value).replace(',', '.'));
        if (!isFinite(v) || v < 0) { render(); return; }
        checkpoint(); pt.pos = Math.min(L - pt.largura / 2, v + pt.largura / 2); gravar(); render();
      };
    });
    p.querySelector('#selUn2').onchange = e => { banco.unidade = e.target.value; salvar(); render(); };
    const aplicar = () => {
      const N = lerMedida(p.querySelector('#inParede').value, banco.unidade);
      if (!isFinite(N)) { aviso('Medida inválida. Ex.: 3,50 (m) ou 350 (cm).'); return; }
      checkpoint(); esticarParede(c, i, N); gravar(); render();
    };
    p.querySelector('#btnAplicar').onclick = aplicar;
    p.querySelector('#inParede').onkeydown = e => { if (e.key === 'Enter') aplicar(); };
    p.querySelector('#btnVoltarComodo').onclick = () => { sel.parede = null; render(); };
    return;
  }
  p.innerHTML = `<div class="linha"><input id="inNome" type="text" value="${esc(c.nome)}" maxlength="40"><select id="selTipo">${opcoesTipo(c.tipo)}</select></div>
    <div class="linha medidas">Área <b>${fmt(area(c.pts))} m²</b> · Perímetro <b>${fmt(perimetro(c.pts))} m</b> · ${c.pts.length} paredes</div>
    <div class="linha medidas">Pé-direito (altura) <input id="inAlt" class="num" type="text" inputmode="decimal" value="${fmt(peDireito(c))}" style="max-width:80px"> m · Volume <b>${fmt(area(c.pts) * peDireito(c), 1)} m³</b> · Paredes <b>${fmt(perimetro(c.pts) * peDireito(c), 1)} m²</b> <button class="btn" id="btnAltTodos">Usar em todos</button></div>
    <div class="linha medidas">💡 Iluminação (NBR 5410): mín. <b>1 ponto no teto</b> com interruptor · carga mín. <b>${iluminacao(c.pts).va} VA</b></div>
    <div class="linha medidas">🔌 Tomadas TUG: mín. <b>${tug(c).min}</b> (NBR 5410: ${tug(c).obs}) · recomendado até <b>${tug(c).max}</b> · colocadas na planta <b>${tug(c).col}</b> · carga <b>${tug(c).va} VA</b>${tug(c).vaAp > 0 ? ` (norma ${tug(c).vaNorma} + ${tug(c).vaAp} pelos aparelhos)` : ''}</div>
    <div class="linha medidas">⚡ TUE: ${(c.tue || []).length ? (c.tue || []).map(u => `<span class="chip" data-edtue="${u.id}">✏️ ${esc(u.nome)} ${u.w} W · ${fmt(tueA(u), 1)} A${tueA(u) > 10 ? ' · circ. exclusivo' : ''} <button class="x" data-tue="${u.id}">✕</button></span>`).join(' ') + ` · total <b>${tueTotal(c)} VA</b>` : 'nenhuma'} <button class="btn" id="btnTUE">+ TUE</button><button class="btn" id="btnTensao" title="Tensão da instalação">🔁 ${tensao()} V</button></div>
    <div class="linha"><button class="btn" id="btnPorque">❓ Por que esses valores?</button><button class="btn" id="btnDup">Duplicar</button><button class="btn perigo" id="btnExc">Excluir</button></div>`;
  p.querySelector('#inNome').onchange = e => { const v = e.target.value.trim(); if (!v) return; checkpoint(); c.nome = v; gravar(); render(); };
  p.querySelector('#selTipo').onchange = e => {
    checkpoint(); const velho = nomeTipo(c.tipo); c.tipo = e.target.value;
    if (c.nome.startsWith(velho)) c.nome = nomeAuto(c.tipo, c.id);
    gravar(); render();
  };
  p.querySelector('#btnExc').onclick = excluirComodo;
  const lerAlt = () => { const v = lerMedida(p.querySelector('#inAlt').value, 'm'); if (!isFinite(v) || v < 1.8 || v > 10) { aviso('Pé-direito entre 1,80 e 10 m (ex.: 2,80).'); render(); return null; } return +v.toFixed(3); };
  p.querySelector('#inAlt').onchange = () => { const v = lerAlt(); if (v == null) return; checkpoint(); c.altura = v; gravar(); render(); };
  p.querySelector('#btnAltTodos').onclick = () => { const v = lerAlt(); if (v == null) return; checkpoint(); proj.comodos.forEach(o => o.altura = v); gravar(); render(); aviso(`Pé-direito de ${fmt(v)} m em todos os cômodos`); };
  p.querySelector('#btnPorque').onclick = () => explicar(c);
  p.querySelector('#btnTUE').onclick = () => adicionarTUE(c);
  p.querySelector('#btnTensao').onclick = () => { proj.tensao = tensao() === 220 ? 127 : 220; gravar(); render(); aviso(`Tensão do projeto: ${proj.tensao} V`); };
  p.querySelectorAll('[data-edtue]').forEach(ch => ch.onclick = e => { if (e.target.closest('[data-tue]')) return; const u = c.tue.find(x => x.id === ch.dataset.edtue); if (u) editarTUE(c, u); });
  p.querySelectorAll('[data-tue]').forEach(b => b.onclick = () => { checkpoint(); c.tue = c.tue.filter(u => u.id !== b.dataset.tue); gravar(); render(); });
  p.querySelector('#btnDup').onclick = () => {
    checkpoint(); const n = clone(c); n.id = uid(); n.nome = nomeAuto(n.tipo);
    const larg = Math.max(...c.pts.map(q => q[0])) - Math.min(...c.pts.map(q => q[0]));
    n.pts = n.pts.map(q => [q[0] + larg, q[1]]); proj.comodos.push(n); sel = { comodo: n.id, parede: null }; gravar(); render();
  };
}
function excluirComodo() {
  const c = comodo(sel.comodo); if (!c) return;
  confirmar(`Excluir ${c.nome}?`, () => { checkpoint(); proj.comodos = proj.comodos.filter(x => x.id !== c.id); sel = { comodo: null, parede: null }; gravar(); render(); });
}
// ---------- TUE (módulo 5) ----------
// NBR 5410 (9.5.2.3): TUE recebe a potência nominal do equipamento e fica a no máximo 1,5 m do local dele.
// Equipamento com corrente nominal acima de 10 A pede circuito independente.
// Tensão fase-neutro do projeto: 220 V (padrão Coelba em Salvador) ou 127 V, conforme a instalação da casa
const tensao = () => (proj && proj.tensao === 127 ? 127 : 220);
const EQUIP = [
  ['chuveiro', 'Chuveiro elétrico', 5500, 1], ['torneira', 'Torneira elétrica', 3500, 1], ['forno', 'Forno elétrico', 2000, 1],
  ['cooktop', 'Cooktop de indução', 6000, 1], ['micro', 'Micro-ondas', 1400, 1], ['lavalouca', 'Lava-louças', 1500, 1],
  ['maquina', 'Máquina de lavar', 1000, 0.8], ['secadora', 'Secadora de roupas', 3500, 1], ['ar9', 'Ar-condicionado 9.000 BTU', 850, 0.9],
  ['ar12', 'Ar-condicionado 12.000 BTU', 1100, 0.9], ['ar18', 'Ar-condicionado 18.000 BTU', 1700, 0.9], ['aquecedor', 'Aquecedor de água (boiler)', 2500, 1],
  ['outro', 'Outro equipamento', 1000, 1]
];
const SUGESTAO = { banheiro: ['chuveiro'], cozinha: ['torneira', 'micro', 'forno'], area_servico: ['maquina'], quarto: ['ar9'], sala: ['ar12'], escritorio: ['ar9'] };
const equip = k => EQUIP.find(e => e[0] === k) || EQUIP[EQUIP.length - 1];
const tueVA = u => Math.round(u.w / u.fp);
const tueA = u => tueVA(u) / tensao();
function tueTotal(c) { return (c.tue || []).reduce((s, u) => s + tueVA(u), 0); }
function adicionarTUE(c) {
  const sug = SUGESTAO[c.tipo] || [];
  const ops = EQUIP.map(([k, n, w]) => `<option value="${k}">${n}${sug.includes(k) ? ' ★' : ''}</option>`).join('');
  abrirModal(`<h2>Adicionar TUE · ${esc(c.nome)}</h2>
    <p class="aviso" style="margin:0 0 10px">TUE = tomada de uso específico, para um aparelho fixo (chuveiro, ar, forno...). ★ = comum neste cômodo.</p>
    <div class="campo"><label>Equipamento</label><select id="mEq">${ops}</select></div>
    <div class="campo"><label>Nome</label><input id="mNomeEq" type="text" maxlength="40"></div>
    <div class="campo"><label>Potência (W) — confira na etiqueta do aparelho</label><input id="mW" type="number" inputmode="numeric" min="1"></div>
    <div class="botoes"><button class="btn" id="mCanc">Cancelar</button><button class="btn primario" id="mOk">Adicionar</button></div>`);
  const pre = () => { const e = equip($('#mEq').value); $('#mNomeEq').value = e[1]; $('#mW').value = e[2]; };
  if (sug[0]) $('#mEq').value = sug[0]; pre(); $('#mEq').onchange = pre;
  $('#mCanc').onclick = fecharModal;
  $('#mOk').onclick = () => {
    const w = parseFloat(String($('#mW').value).replace(',', '.')); if (!(w > 0)) { $('#mW').style.borderColor = '#ff5d5d'; return; }
    const e = equip($('#mEq').value); checkpoint(); c.tue = c.tue || [];
    c.tue.push({ id: uid(), eq: e[0], nome: $('#mNomeEq').value.trim() || e[1], w, fp: e[3] }); fecharModal(); gravar(); render();
  };
}
function editarTUE(c, u) {
  abrirModal(`<h2>Editar TUE · ${esc(c.nome)}</h2>
    <div class="campo"><label>Nome</label><input id="mNomeEq" type="text" maxlength="40" value="${esc(u.nome)}"></div>
    <div class="campo"><label>Potência (W) — confira na etiqueta do aparelho</label><input id="mW" type="number" inputmode="decimal" min="1" value="${u.w}"></div>
    <div class="campo"><label>Fator de potência (1 para resistivos: chuveiro, forno, torneira)</label><input id="mFp" type="number" inputmode="decimal" min="0.5" max="1" step="0.05" value="${u.fp}"></div>
    <p class="aviso" id="mPrev" style="margin:4px 0 10px"></p>
    <div class="botoes"><button class="btn perigo" id="mDel">Excluir</button><button class="btn" id="mCanc">Cancelar</button><button class="btn primario" id="mOk">Salvar</button></div>`);
  const num = id => parseFloat(String($(id).value).replace(',', '.'));
  const prev = () => { const w = num('#mW'), fp = num('#mFp'); if (w > 0 && fp > 0) { const va = Math.round(w / fp), i = va / tensao(); $('#mPrev').innerHTML = `${va} VA → ${fmt(i, 1)} A em ${tensao()} V${i > 10 ? ' · <b>circuito exclusivo</b>' : ''}`; } };
  prev(); $('#mW').oninput = prev; $('#mFp').oninput = prev;
  $('#mCanc').onclick = fecharModal;
  $('#mDel').onclick = () => { checkpoint(); c.tue = c.tue.filter(x => x.id !== u.id); fecharModal(); gravar(); render(); };
  $('#mOk').onclick = () => {
    const w = num('#mW'), fp = num('#mFp');
    if (!(w > 0)) { $('#mW').style.borderColor = '#ff5d5d'; return; }
    if (!(fp >= 0.5 && fp <= 1)) { $('#mFp').style.borderColor = '#ff5d5d'; return; }
    checkpoint(); u.w = w; u.fp = fp; u.nome = $('#mNomeEq').value.trim() || u.nome; fecharModal(); gravar(); render();
  };
}
// ---------- módulo 6: cargas e demanda ----------
// Fatores de demanda da tabela usual de livros-texto e normas de distribuidoras (iluminação + TUG por faixa de potência;
// TUE pelo número de aparelhos). Conferir sempre com a norma de fornecimento da Coelba vigente.
const FD_LUZ_TUG = [[1000, 0.86], [2000, 0.75], [3000, 0.66], [4000, 0.59], [5000, 0.52], [6000, 0.45], [7000, 0.40], [8000, 0.35], [9000, 0.31], [10000, 0.27], [Infinity, 0.24]];
const FD_TUE = [1, 1, 1, 0.84, 0.76, 0.70, 0.65, 0.60, 0.57, 0.54, 0.52, 0.49, 0.48, 0.46, 0.45, 0.44, 0.43, 0.42, 0.41, 0.40, 0.40, 0.39, 0.39, 0.39, 0.38, 0.38];
const fdLuzTug = w => FD_LUZ_TUG.find(f => w <= f[0])[1];
const fdTue = n => n <= 0 ? 0 : FD_TUE[Math.min(n, FD_TUE.length - 1)];
function demanda() {
  const cs = proj.comodos;
  const luzVA = cs.reduce((s, c) => s + iluminacao(c.pts).va, 0), tugVAt = cs.reduce((s, c) => s + tug(c).va, 0);
  const luzW = luzVA * 1.0, tugW = tugVAt * 0.8, base = luzW + tugW, f1 = base > 0 ? fdLuzTug(base) : 0, d1 = base * f1;
  const us = cs.flatMap(c => (c.tue || []).map(u => ({ ...u, comodo: c.nome })));
  const tueW = us.reduce((s, u) => s + u.w, 0), f2 = fdTue(us.length), d2 = tueW * f2;
  const dW = d1 + d2, dVA = dW / 0.92, i = dVA / tensao();
  return { luzVA, tugVAt, luzW, tugW, base, f1, d1, us, tueW, f2, d2, dW, dVA, i, instW: base + tueW };
}
function mostrarDemanda() {
  const d = demanda(), kw = v => fmt(v / 1000, 2) + ' kW';
  const lista = arr => `<ul class="passos">${arr.map(x => `<li>${x}</li>`).join('')}</ul>`;
  const bloco = (t, n, a) => `<h3 class="exp-t">${t}</h3><div class="exp-norma"><b>📘 O que a regra diz</b>${lista(n)}</div><div class="exp-aplic"><b>🧮 Como foi aplicado na sua casa</b>${lista(a)}</div>`;
  const faixa = FD_LUZ_TUG.findIndex(f => d.base <= f[0]);
  abrirModal(`<h2>📊 Demanda de ${esc(proj.nome)}</h2>
    <div class="exp-aplic" style="margin-bottom:8px;font-size:15px">Potência instalada: <b>${kw(d.instW)}</b><br>Demanda (o que realmente liga junto): <b>${kw(d.dW)}</b> ≈ <b>${fmt(d.dVA / 1000, 2)} kVA</b><br>Corrente estimada em ${tensao()} V (monofásico): <b>${fmt(d.i, 1)} A</b></div>
    ${bloco('1️⃣ De VA para W', ['As cargas de luz e tomadas são calculadas em <b>VA</b> (potência aparente). Para somar a potência real usa-se o <b>fator de potência</b>.', 'Valores usuais em projeto residencial: iluminação <b>1,0</b>; tomadas de uso geral (TUG) <b>0,8</b>. Nas TUE usa-se a potência em W da etiqueta.'],
      [`Iluminação: ${d.luzVA} VA × 1,0 = <b>${d.luzW} W</b>.`, `TUG: ${d.tugVAt} VA × 0,8 = <b>${fmt(d.tugW, 0)} W</b>.`, `Soma luz + TUG: <b>${fmt(d.base, 0)} W</b>.`])}
    ${bloco('2️⃣ Demanda de iluminação + TUG', ['Nem todas as lâmpadas e tomadas são usadas ao mesmo tempo, então a soma é multiplicada por um <b>fator de demanda</b>, que diminui conforme a potência cresce.', 'Tabela de fatores de demanda residenciais da Neoenergia (DIS-NOR-030, vale para a Coelba): até 1 kW = 0,86 · 1–2 kW = 0,75 · 2–3 = 0,66 · 3–4 = 0,59 · 4–5 = 0,52 · 5–6 = 0,45 · 6–7 = 0,40 · 7–8 = 0,35 · 8–9 = 0,31 · 9–10 = 0,27 · acima de 10 kW = 0,24.'],
      d.base ? [`${kw(d.base)} está na faixa ${faixa === 0 ? 'até 1 kW' : faixa === FD_LUZ_TUG.length - 1 ? 'acima de 10 kW' : `${faixa}–${faixa + 1} kW`} → fator <b>${fmt(d.f1, 2)}</b>.`, `${fmt(d.base, 0)} × ${fmt(d.f1, 2)} = <b>${fmt(d.d1, 0)} W</b>.`] : ['Nenhum cômodo ainda.'])}
    ${bloco('3️⃣ Demanda das TUE', ['As TUE (chuveiro, ar, forno...) também não ligam todas juntas. O fator depende do <b>número de aparelhos</b>.', 'Tabela usual: 1 ou 2 aparelhos = 1,00 · 3 = 0,84 · 4 = 0,76 · 5 = 0,70 · 6 = 0,65 · 7 = 0,60 · 8 = 0,57 · 9 = 0,54 · 10 = 0,52 · e vai caindo até cerca de 0,38.'],
      d.us.length ? [`Aparelhos: ${d.us.map(u => `${esc(u.nome)} (${esc(u.comodo)}) ${u.w} W`).join(' · ')}.`, `Soma: <b>${d.tueW} W</b> com ${d.us.length} aparelho(s) → fator <b>${fmt(d.f2, 2)}</b>.`, `${d.tueW} × ${fmt(d.f2, 2)} = <b>${fmt(d.d2, 0)} W</b>.`] : ['Nenhuma TUE cadastrada. Adicione nos cômodos com "+ TUE".'])}
    ${bloco('4️⃣ Demanda total', ['Demanda total = demanda de luz + TUG + demanda das TUE.', 'Para kVA divide-se por um fator de potência médio (aqui <b>0,92</b>). A corrente é kVA ÷ tensão. Esse valor é a base para escolher o padrão de entrada da Coelba (módulo futuro).'],
      [`${fmt(d.d1, 0)} + ${fmt(d.d2, 0)} = <b>${fmt(d.dW, 0)} W</b>.`, `${fmt(d.dW, 0)} ÷ 0,92 = <b>${fmt(d.dVA, 0)} VA</b> → ÷ ${tensao()} V = <b>${fmt(d.i, 1)} A</b>.`])}
    <p class="aviso">O fator de luz + TUG é o mesmo da tabela de fatores de demanda residenciais da norma DIS-NOR-030 da Neoenergia (que vale para a Coelba). O fator das TUE é o da tabela usual de livros-texto: a Coelba agrupa os aparelhos por tipo, e isso entra no módulo do padrão de entrada. O valor oficial para o padrão de entrada deve ser conferido na norma de fornecimento da Neoenergia Coelba vigente. Ferramenta de apoio: o projeto oficial precisa de profissional habilitado e ART.</p>
    <div class="botoes"><button class="btn" id="mVolta">← Cômodos</button><button class="btn" id="mCanc">Fechar</button></div>`);
  $('#mCanc').onclick = fecharModal; $('#mVolta').onclick = () => $('#btnComodos').onclick();
}
// ---------- módulo 7: divisão de circuitos ----------
// NBR 5410 (9.5.3): circuitos de iluminação separados dos de tomadas; tomadas de cozinha, copa, área de serviço e
// lavanderia em circuitos só delas; aparelho acima de 10 A em circuito independente.
// Módulo 8/9: o limite de cada circuito vem da coordenação Ib ≤ In ≤ Iz (corrente do circuito ≤ disjuntor ≤ capacidade do fio corrigida).
// Capacidade de condução: cobre, isolação PVC 70 °C, eletroduto embutido em alvenaria (método B1), 2 condutores carregados, 30 °C.
const CAP = [[1.5, 17.5], [2.5, 24], [4, 32], [6, 41], [10, 57], [16, 76], [25, 101], [35, 125], [50, 151], [70, 192]];
const FCA = [1, 1, 0.80, 0.70, 0.65, 0.60, 0.57, 0.54, 0.52, 0.50]; // fator de agrupamento por nº de circuitos no mesmo eletroduto
const MOLH_CIRC = ['cozinha', 'copa', 'area_servico'];
const DISJ = [10, 16, 20, 25, 32, 40, 50, 63, 70, 80, 100, 125];
const agrup = () => Math.min(Math.max(proj.agrup || 3, 1), 9);
const fca = () => FCA[agrup()];
const secMin = tipo => tipo === 'Iluminação' ? 1.5 : 2.5;
const maiorDisj = sec => { const iz = CAP.find(c => c[0] === sec)[1] * fca(); return [...DISJ].reverse().find(d => d <= iz) || 0; };
const RHO = 1 / 56, QUEDA_MAX = 4, H_QDC = 1.5, PE_DIREITO = 2.8; // cobre (Ω·mm²/m); limite p/ circuitos terminais; altura do meio do quadro; pé-direito padrão
const ALT_M = { bx: 0.3, md: 1.3, al: 2.0 };
const peDireito = c => c && c.altura > 0 ? c.altura : PE_DIREITO;
// DR 30 mA obrigatório (NBR 5410): locais com chuveiro/banheira, cozinha, copa, área de serviço/lavanderia, garagem, áreas externas;
// pontos de luz a 2,50 m ou mais do piso podem ficar sem DR
const DR_TIPOS = ['banheiro', 'lavabo', 'cozinha', 'copa', 'area_servico', 'garagem', 'varanda'];
const drComodo = (c, luz) => DR_TIPOS.includes(c.tipo) && !(luz && peDireito(c) >= 2.5);
const dpsUc = () => tensao() === 127 ? 175 : 275;
function qdcPos() { for (const c of proj.comodos) { const q = (c.pontos || []).find(x => x.k === 'qdc'); if (q) { const g = geoPonto(c, q); if (g) return { m: g.m, h: peDireito(c) }; } } return null; }
// caminho em "L" (como o eletroduto anda) + sobe do quadro até o teto + desce do teto até o ponto
const distQdc = (p, Q, hTeto, hPonto) => Q ? Math.abs(p[0] - Q.m[0]) + Math.abs(p[1] - Q.m[1]) + Math.max(0, Q.h - H_QDC) + Math.max(0, hTeto - hPonto) : null;
const queda = (ib, L, S) => 2 * RHO * L * ib / S / tensao() * 100;
function dimensionar(c) { // escolhe disjuntor e seção pela regra Ib ≤ In ≤ Iz e pela queda de tensão
  const ib = c.i, inn = DISJ.find(d => d >= ib - 1e-9) || DISJ[DISJ.length - 1];
  let k = CAP.findIndex(([s, cap]) => s >= secMin(c.tipo) && cap * fca() >= inn); if (k < 0) k = CAP.length - 1;
  const kAmp = k;
  if (c.L != null) while (k < CAP.length - 1 && queda(ib, c.L, CAP[k][0]) > QUEDA_MAX) k++;
  const ok = CAP[k], iz = ok[1] * fca(), dmax = [...DISJ].reverse().find(d => d <= iz + 1e-9) || inn;
  return { inn, sec: ok[0], cap: ok[1], iz, dmin: inn, dmax, dv: c.L != null ? queda(ib, c.L, ok[0]) : null, dvAntes: c.L != null ? queda(ib, c.L, CAP[kAmp][0]) : null, secAmp: CAP[kAmp][0], porQueda: k > kAmp };
}
function agrupar(itens, lim) {
  const cs = []; let atual = null;
  itens.forEach(it => { if (!atual || atual.va + it.va > lim) { atual = { va: 0, itens: [], L: null }; cs.push(atual); } atual.va += it.va; atual.itens.push(it); if (it.d != null) atual.L = Math.max(atual.L || 0, it.d); });
  return cs;
}
function resumoItens(its) { const m = new Map(); its.forEach(i => m.set(i.nome, (m.get(i.nome) || 0) + i.n)); return [...m].map(([n, q]) => `${esc(n)}${q > 1 ? ` (${q})` : ''}`).join(', '); }
function circuitos() {
  const Q = qdcPos(), V = tensao(), limL = maiorDisj(1.5) * V, limT = maiorDisj(2.5) * V, lim = limT, cs = proj.comodos, out = [];
  const luz = cs.map(c => ({ nome: c.nome, dr: drComodo(c, true), va: iluminacao(c.pts).va, n: 1, d: distQdc(centroide(c.pts), Q, peDireito(c), peDireito(c)) }));
  agrupar(luz, limL).forEach(g => out.push({ tipo: 'Iluminação', desc: resumoItens(g.itens), va: g.va, L: g.L, np: g.itens.length, dr: g.itens.some(i => i.dr) }));
  const tomadas = grupo => cs.filter(grupo).flatMap(c => { const t = tug(c), arr = [], tom = (c.pontos || []).filter(q => q.k === 'tom').map(q => ({ g: geoPonto(c, q), h: ALT_M[q.alt] ?? 0.3 })).filter(x => x.g);
    const sl = tomSlots(c, t.n);
    for (let k = 1; k <= t.n; k++) { const tk = tom[k - 1]; arr.push({ nome: c.nome, dr: drComodo(c), va: sl[k - 1].va, n: 1, d: distQdc(tk ? tk.g.m : centroide(c.pts), Q, peDireito(c), tk ? tk.h : 0.3) }); } return arr; });
  agrupar(tomadas(c => !MOLH_CIRC.includes(c.tipo)), lim).forEach(g => out.push({ tipo: 'TUG', desc: resumoItens(g.itens), va: g.va, L: g.L, np: g.itens.length, dr: g.itens.some(i => i.dr) }));
  agrupar(tomadas(c => MOLH_CIRC.includes(c.tipo)), lim).forEach(g => out.push({ tipo: 'TUG (cozinha/serviço)', desc: resumoItens(g.itens), va: g.va, L: g.L, np: g.itens.length, dr: true }));
  cs.forEach(c => (c.tue || []).forEach(u => out.push({ tipo: 'TUE', np: 1, desc: `${esc(u.nome)} (${esc(c.nome)})`, va: tueVA(u), exclusivo: tueA(u) > 10, dr: drComodo(c), L: distQdc(centroide(c.pts), Q, peDireito(c), 1.3) })));
  out.forEach((c, i) => { c.n = i + 1; c.i = c.va / V; Object.assign(c, dimensionar(c)); });
  return { lista: out, V, lim, limL, limT, Q };
}
function mostrarCircuitos() {
  const { lista, V, limL, limT, Q } = circuitos();
  const ls = arr => `<ul class="passos">${arr.map(x => `<li>${x}</li>`).join('')}</ul>`;
  const linhas = lista.map(c => `<tr><td class="n">${c.n}</td><td>${c.tipo}</td><td>${c.desc}</td><td class="n">${c.va}</td><td class="n">${fmt(c.i, 1)}</td><td class="n">${fmt(c.sec, 1).replace(',0', '')}</td><td class="n">${fmt(c.iz, 1)}</td><td class="n"><b>${c.inn}</b></td><td class="n">${c.dmin}–${c.dmax}</td><td class="n">${c.L != null ? fmt(c.L, 1) : '—'}</td><td class="n">${c.dv != null ? (c.dv > QUEDA_MAX ? '⚠️ ' : '') + fmt(c.dv, 2) : '—'}</td><td>${c.dr ? '<b>Obrigatório</b>' : 'Recomendado'}</td></tr>`).join('');
  const nL = lista.filter(c => c.tipo === 'Iluminação').length, nT = lista.filter(c => c.tipo === 'TUG').length, nM = lista.filter(c => c.tipo.startsWith('TUG (')).length, nE = lista.filter(c => c.tipo === 'TUE').length;
  abrirModal(`<h2>🔀 Circuitos de ${esc(proj.nome)}</h2>
    ${lista.length ? `<table><tr><th class="n">Nº</th><th>Tipo</th><th>Atende</th><th class="n">VA</th><th class="n">Ib (A)</th><th class="n">Fio (mm²)</th><th class="n">Fio aguenta Iz (A)</th><th class="n">Disj. (A)</th><th class="n">Disj. mín–máx</th><th class="n">Dist. (m)</th><th class="n">Queda (%)</th><th>DR 30 mA</th></tr>${linhas}</table>` : '<div class="vazio">Desenhe os cômodos primeiro.</div>'}
    <div class="linha medidas" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:6px 0">Circuitos no mesmo eletroduto (pior trecho): <select id="mAgr">${[1, 2, 3, 4, 5, 6].map(n => `<option ${n === agrup() ? 'selected' : ''}>${n}</option>`).join('')}</select> → fator ${fmt(fca(), 2)}</div>
    <h3 class="exp-t">Por que ficou assim?</h3>
    <div class="exp-norma"><b>📘 O que a norma diz</b>${ls(['Iluminação e tomadas devem ficar em <b>circuitos separados</b>.', 'As tomadas de <b>cozinha, copa, área de serviço e lavanderia</b> devem ter circuitos <b>só para elas</b>, sem misturar com outros cômodos.', 'Todo aparelho com corrente acima de <b>10 A</b> precisa de <b>circuito independente</b>.', 'Os circuitos devem ser divididos para facilitar manutenção e evitar que um defeito desligue a casa toda.', 'A norma não fixa potência máxima por circuito. O que vale é a <b>coordenação entre fio e disjuntor</b>: <b>Ib ≤ In ≤ Iz</b>.', '<b>Ib</b> = corrente que o circuito puxa (potência ÷ tensão). <b>In</b> = corrente nominal do disjuntor. <b>Iz</b> = corrente que o fio aguenta sem esquentar demais, já com os fatores de correção.', 'Em palavras: o disjuntor tem que <b>aguentar a carga sem desarmar</b> (In ≥ Ib) e <b>desarmar antes de o fio superaquecer</b> (In ≤ Iz). Por isso o disjuntor mínimo é o primeiro valor comercial acima de Ib, e o máximo é o maior valor que não passa de Iz.', 'Também se exige que a corrente que garante o desarme por sobrecarga não passe de 1,45 × Iz; os disjuntores residenciais (NBR NM 60898) já atendem isso quando In ≤ Iz.', 'Seção mínima do fio de cobre: <b>1,5 mm²</b> em iluminação e <b>2,5 mm²</b> em tomadas e força.', 'A capacidade do fio diminui quando vários circuitos passam no mesmo eletroduto (<b>fator de agrupamento</b>) e em ambientes mais quentes que 30 °C.', 'Valores de capacidade usados: cobre com isolação PVC, eletroduto embutido em alvenaria, 2 condutores carregados, 30 °C.', '<b>DR (dispositivo diferencial-residual) de 30 mA</b> é obrigatório nos circuitos que atendem: banheiro (local com chuveiro ou banheira), cozinha, copa, lavanderia/área de serviço, garagem, áreas externas e tomadas internas que possam alimentar aparelhos lá fora. Pontos de luz a 2,50 m ou mais do piso podem ficar de fora.', '<b>DPS</b> (protetor contra surtos) é exigido quando a casa recebe energia por <b>rede aérea</b> ou fica em região com muitas trovoadas, o caso comum em Salvador. Vai no quadro, ligado entre cada condutor vivo e o terra.', '<b>Queda de tensão</b>: nos circuitos terminais (do quadro até a tomada ou luz) ela não pode passar de <b>4%</b>. Fio comprido ou corrente alta = mais queda; se passar, aumenta-se a seção do fio.'])}</div>
    <div class="exp-aplic"><b>🧮 Como foi aplicado na sua casa</b>${ls([`Fio mínimo: 1,5 mm² na luz, 2,5 mm² nas tomadas. Com ${agrup()} circuito(s) no mesmo eletroduto o fio aguenta menos (fator ${fmt(fca(), 2)}): 1,5 mm² → ${fmt(17.5 * fca(), 1)} A e 2,5 mm² → ${fmt(24 * fca(), 1)} A.`, `Por isso cada circuito de luz vai até o disjuntor de ${maiorDisj(1.5)} A (${limL} VA em ${V} V) e cada circuito de TUG até ${maiorDisj(2.5)} A (${limT} VA). Passou disso, o app abre outro circuito.`, `Iluminação: ${nL} circuito(s) · TUG: ${nT} · TUG de cozinha/serviço: ${nM} (exclusivos) · TUE: ${nE}, um por aparelho${lista.some(c => c.exclusivo) ? ' (os de mais de 10 A são obrigatórios pela norma)' : ''}.`, ...lista.filter(c => c.tipo === 'TUE' || c.sec > secMin(c.tipo)).map(c => `Circuito ${c.n}: Ib = ${c.va} ÷ ${V} = ${fmt(c.i, 1)} A → disjuntor mínimo ${c.dmin} A → precisa de fio que aguente ≥ ${c.dmin} A: ${fmt(c.sec, 1).replace(',0', '')} mm² aguenta ${c.cap} × ${fmt(fca(), 2)} = ${fmt(c.iz, 1)} A ✔ → com esse fio, o disjuntor pode ir de ${c.dmin} A até ${c.dmax} A.`), `DR: ${lista.filter(c => c.dr).length} de ${lista.length} circuito(s) com DR 30 mA obrigatório (${lista.filter(c => c.dr).map(c => c.n).join(', ') || 'nenhum'}). Os outros ficam como recomendado: muitos projetistas protegem a casa toda com DR, porque ele salva vidas em choque elétrico.`, `DPS sugerido (valores usuais de mercado): classe II, In ≥ 20 kA, Uc ≥ ${dpsUc()} V (${tensao() === 127 ? 'rede 127/220 V' : 'rede 220/380 V'}), um por fase e um no neutro quando o neutro não está aterrado no quadro.`, ...(Q ? [`Distância: do quadro até o ponto mais longe de cada circuito, andando em "L" pelas paredes (como o eletroduto costuma ir) + a subida do quadro (meio a ${fmt(H_QDC, 1)} m do piso) até o teto + a descida do teto até o ponto. A altura usa o pé-direito de cada cômodo e a altura da tomada (baixa 0,30 · média 1,30 · alta 2,00 m); TUE conta 1,30 m. Tomadas colocadas usam a posição real; as que faltam, o meio do cômodo a 0,30 m.`, `Queda (%) = 2 × ρ × L × Ib ÷ (S × V) × 100, com ρ do cobre = 1/56 Ω·mm²/m. Considera toda a carga no ponto mais longe (a favor da segurança).`, ...lista.filter(c => c.porQueda).map(c => `Circuito ${c.n}: com ${fmt(c.secAmp, 1).replace(',0', '')} mm² a queda seria ${fmt(c.dvAntes, 2)}% (passa de 4%) → o fio subiu pra ${fmt(c.sec, 1).replace(',0', '')} mm² e ficou ${fmt(c.dv, 2)}% ✔.`), ...(lista.some(c => c.porQueda) ? [] : ['Todos os circuitos ficaram abaixo de 4% de queda com o fio escolhido ✔.'])] : ['Queda de tensão: coloque o quadro na planta (botão 🔌 Pontos → ▣ Quadro) pra o app medir as distâncias.'])])}</div>
    <p class="aviso">Regras da NBR 5410 (itens 9.5.3, 6.2.6, 6.2.7, 5.3, 5.1.3.2.2 e 6.3.5) explicadas com nossas palavras. Ferramenta de apoio: o projeto oficial precisa de profissional habilitado e ART.</p>
    <div class="botoes"><button class="btn" id="mVolta">← Cômodos</button><button class="btn primario" id="mQd2">📋 Quadro</button><button class="btn" id="mCanc">Fechar</button></div>`);
  $('#mCanc').onclick = fecharModal; $('#mVolta').onclick = () => $('#btnComodos').onclick();
  $('#mQd2').onclick = mostrarQuadro;
  $('#mAgr').onchange = e => { proj.agrup = +e.target.value; gravar(); mostrarCircuitos(); };
}
// ---------- módulo 10: quadro de cargas + disjuntor geral ----------
// Espaço reserva no quadro (NBR 5410): até 6 circuitos → 2; 7 a 12 → 3; 13 a 30 → 4; acima de 30 → 15%.
const reservaQd = n => n <= 6 ? 2 : n <= 12 ? 3 : n <= 30 ? 4 : Math.ceil(n * 0.15);
function geral() {
  const d = demanda(), ib = d.i, inn = DISJ.find(x => x >= ib - 1e-9) || DISJ[DISJ.length - 1];
  const k = CAP.findIndex(([s, cap]) => s >= 2.5 && cap >= inn), ok = CAP[k < 0 ? CAP.length - 1 : k];
  return { d, ib, inn, sec: ok[0], iz: ok[1] };
}
function mostrarQuadro() {
  const { lista, V } = circuitos(), g = geral(), al = alimentador(), ls = arr => `<ul class="passos">${arr.map(x => `<li>${x}</li>`).join('')}</ul>`;
  const bloco = (t, n, a) => `<h3 class="exp-t">${t}</h3><div class="exp-norma"><b>📘 O que a norma diz</b>${ls(n)}</div><div class="exp-aplic"><b>🧮 Como foi aplicado na sua casa</b>${ls(a)}</div>`;
  const col = c => c.tipo === 'Iluminação' ? 0 : c.tipo === 'TUE' ? 2 : 1, tot = [0, 0, 0];
  const linhas = lista.map(c => { const v = ['—', '—', '—']; v[col(c)] = c.va; tot[col(c)] += c.va; return `<tr><td class="n">${c.n}</td><td>${c.tipo}</td><td>${c.desc}</td><td class="n">${v[0]}</td><td class="n">${v[1]}</td><td class="n">${v[2]}</td><td class="n"><b>${c.va}</b></td><td class="n">${fmt(c.i, 1)}</td><td class="n">${fmt(c.sec, 1).replace(',0', '')}</td><td class="n">${c.inn}</td><td>${c.dr ? 'DR' : '—'}</td></tr>`; }).join('');
  const n = lista.length, res = reservaQd(n), nDr = lista.filter(c => c.dr).length, total = tot[0] + tot[1] + tot[2];
  abrirModal(`<h2>📋 Quadro de cargas de ${esc(proj.nome)}</h2>
    ${n ? `<table><tr><th class="n">Nº</th><th>Circuito</th><th>Atende</th><th class="n">Luz (VA)</th><th class="n">TUG (VA)</th><th class="n">TUE (VA)</th><th class="n">Total (VA)</th><th class="n">Ib (A)</th><th class="n">Fio (mm²)</th><th class="n">Disj. (A)</th><th>DR</th></tr>${linhas}
    <tr class="total"><td></td><td>Total</td><td>${n} circuito(s)</td><td class="n">${tot[0]}</td><td class="n">${tot[1]}</td><td class="n">${tot[2]}</td><td class="n">${total}</td><td colspan="4"></td></tr></table>` : '<div class="vazio">Desenhe os cômodos primeiro.</div>'}
    <div class="exp-aplic" style="margin:8px 0;font-size:15px">Tensão: <b>${V} V</b> monofásico · Demanda: <b>${fmt(g.d.dVA / 1000, 2)} kVA</b> → <b>${fmt(g.ib, 1)} A</b><br>Disjuntor geral: <b>${g.inn} A</b> · Fio do quadro (alimentador): <b>${fmt((al ? al.sec : g.sec), 1).replace(',0', '')} mm²</b>${al ? ` · ${fmt(al.L, 1)} m do medidor · queda ${fmt(al.dv, 2)}%` : ` (aguenta ${g.iz} A)`}<br>Espaços no quadro: <b>${n}</b> circuitos + <b>${res}</b> reserva = <b>${n + res}</b> disjuntores</div>
    ${bloco('1️⃣ O que é o quadro de cargas', ['É a tabela que resume <b>todos os circuitos</b> da casa: o que cada um atende, a potência separada em iluminação, TUG e TUE, a corrente, o fio e o disjuntor.', 'É ela que o eletricista usa pra montar o quadro e que vai no projeto junto com a planta e o diagrama unifilar.'],
      [`${n} circuito(s): luz ${tot[0]} VA, TUG ${tot[1]} VA, TUE ${tot[2]} VA. Potência instalada: <b>${total} VA</b>.`, 'Fio e disjuntor de cada linha vêm da tela 🔀 Circuitos (regra Ib ≤ In ≤ Iz e queda de tensão).'])}
    ${bloco('2️⃣ Disjuntor geral', ['O disjuntor geral protege o <b>alimentador</b>, o fio que vem do medidor até o quadro.', 'Ele é escolhido pela <b>demanda</b> (o que liga junto de verdade), e não pela soma de tudo, pela mesma regra Ib ≤ In ≤ Iz.', 'O valor final também precisa bater com a <b>categoria de fornecimento da Coelba</b> (padrão de entrada), que vem no módulo do padrão Coelba.'],
      [`Demanda: ${fmt(g.d.dW, 0)} W ÷ 0,92 = ${fmt(g.d.dVA, 0)} VA → Ib = ${fmt(g.d.dVA, 0)} ÷ ${V} = <b>${fmt(g.ib, 1)} A</b>.`, `Primeiro disjuntor comercial acima: <b>${g.inn} A</b>.`, `Fio que aguenta ≥ ${g.inn} A sozinho no eletroduto (sem fator de agrupamento): <b>${fmt(g.sec, 1).replace(',0', '')} mm²</b> (Iz = ${g.iz} A) ✔.`, ...(al ? [`Distância medidor → quadro: em "L" pelas paredes + 2 m de subidas/descidas = <b>${fmt(al.L, 1)} m</b>.`, `Queda no alimentador: o app usa até <b>1%</b> aqui, pra somar no máximo 5% com os 4% dos circuitos (a NBR 5410 limita a 5% a partir do ponto de entrega da Coelba e 4% nos circuitos terminais).`, al.porQueda ? `Com ${fmt(al.secAmp, 1).replace(',0', '')} mm² a queda seria ${fmt(al.dvAntes, 2)}% → o fio subiu pra <b>${fmt(al.sec, 1).replace(',0', '')} mm²</b> e ficou ${fmt(al.dv, 2)}% ✔.` : `Com ${fmt(al.sec, 1).replace(',0', '')} mm² a queda fica ${fmt(al.dv, 2)}% ✔.`] : ['Coloque o ⊠ Medidor e o ▣ Quadro na planta (modo 🔌 Pontos) pra o app medir a distância e a queda de tensão do alimentador.'])])}
    ${bloco('3️⃣ Espaço reserva', ['O quadro deve ter <b>espaço livre para circuitos futuros</b>, conforme o número de circuitos: até 6 → 2 espaços · 7 a 12 → 3 · 13 a 30 → 4 · acima de 30 → 15%.'],
      [`${n} circuito(s) → <b>${res}</b> espaço(s) reserva. Quadro com pelo menos <b>${n + res}</b> posições, mais o geral${nDr ? ', o(s) DR' : ''} e o DPS.`])}
    ${bloco('4️⃣ DR e DPS no quadro', ['O DR pode proteger um circuito sozinho ou um grupo de circuitos.', 'O DPS fica logo depois do disjuntor geral, ligado ao terra.'],
      [`${nDr} circuito(s) precisam de DR 30 mA. Opção simples: um DR geral de 30 mA com corrente ≥ ${g.inn} A, ou um DR para o grupo das áreas molhadas.`, `DPS sugerido: classe II, Uc ≥ ${dpsUc()} V (valores usuais de mercado, confirmar no projeto).`])}
    <p class="aviso">Regras da NBR 5410 explicadas com nossas palavras. A demanda e o disjuntor geral devem ser conferidos com a norma de fornecimento da Neoenergia Coelba. Ferramenta de apoio: o projeto oficial precisa de profissional habilitado e ART.</p>
    <div class="botoes"><button class="btn" id="mVolta">← Cômodos</button><button class="btn" id="mCirc2">🔀 Circuitos</button><button class="btn primario" id="mUnif">⚡ Unifilar</button><button class="btn" id="mMat2">🧾 Materiais</button><button class="btn" id="mCanc">Fechar</button></div>`);
  $('#mCanc').onclick = fecharModal; $('#mVolta').onclick = () => $('#btnComodos').onclick(); $('#mCirc2').onclick = mostrarCircuitos; $('#mUnif').onclick = mostrarUnifilar; $('#mMat2').onclick = mostrarMateriais;
}
// ---------- explicação: o que a norma diz + como foi aplicado ----------
function regraTUG(tipo) {
  if (tipo === 'banheiro' || tipo === 'lavabo') return ['Em banheiros, deve haver <b>pelo menos 1 tomada perto do lavatório</b> (pia).', 'A tomada precisa respeitar a distância do box/banheira definida pela norma para áreas molhadas (volumes de risco).'];
  if (['cozinha', 'copa', 'area_servico'].includes(tipo)) return ['Em cozinhas, copas, áreas de serviço e lavanderias: <b>1 tomada a cada 3,5 m de perímetro</b>, ou fração.', 'Acima de cada bancada de pia com 30 cm ou mais de largura: <b>pelo menos 2 tomadas</b>, no mesmo ponto ou separadas.', 'Potência: <b>600 VA</b> em cada uma das <b>3 primeiras</b> tomadas e <b>100 VA</b> nas demais. Se o cômodo tiver <b>mais de 6</b>, pode-se usar 600 VA em só <b>2</b> e 100 VA no resto.'];
  if (tipo === 'sala' || tipo === 'quarto') return ['Em salas e dormitórios: <b>1 tomada a cada 5 m de perímetro</b>, ou fração.', 'As tomadas devem ficar <b>espalhadas da forma mais uniforme possível</b> pelo cômodo.', 'Potência: <b>100 VA</b> por tomada.'];
  if (tipo === 'varanda') return ['Em varandas: <b>pelo menos 1 tomada</b>.', 'Se a varanda for pequena e não couber, pode ficar perto do acesso a ela.', 'Potência: <b>100 VA</b> por tomada.'];
  return ['Nos demais cômodos: até <b>2,25 m²</b>, pelo menos 1 tomada (pode ficar do lado de fora, a até 0,80 m da porta).', 'De <b>2,25 m² a 6 m²</b>: pelo menos 1 tomada.', 'Acima de <b>6 m²</b>: <b>1 tomada a cada 5 m de perímetro</b>, ou fração, bem distribuídas.', 'Potência: <b>100 VA</b> por tomada.'];
}
function explicar(c) {
  const a = area(c.pts), p = perimetro(c.pts), L = iluminacao(c.pts), t = tug(c), mol = MOLHADAS.includes(c.tipo), tipo = nomeTipo(c.tipo);
  const lista = arr => `<ul class="passos">${arr.map(x => `<li>${x}</li>`).join('')}</ul>`;
  const bloco = (titulo, norma, aplic) => `<h3 class="exp-t">${titulo}</h3><div class="exp-norma"><b>📘 O que a norma diz</b>${lista(norma)}</div><div class="exp-aplic"><b>🧮 Como foi aplicado em ${esc(c.nome)}</b>${lista(aplic)}</div>`;
  // iluminação
  const luzN = ['Todo cômodo precisa de <b>pelo menos 1 ponto de luz no teto</b>, com interruptor.', 'Carga mínima: <b>100 VA</b> para os primeiros <b>6 m²</b>, mais <b>60 VA</b> a cada <b>4 m² inteiros</b> que passarem disso.'];
  let luzA;
  if (a <= 6) luzA = [`Área de <b>${fmt(a)} m²</b> → até 6 m², então fica nos <b>100 VA</b>.`];
  else { const sobra = a - 6, bl = Math.floor(sobra / 4 + 1e-9);
    luzA = [`Área: <b>${fmt(a)} m²</b>. Primeiros 6 m² → 100 VA.`, `Sobram ${fmt(a)} − 6 = <b>${fmt(sobra)} m²</b> → ${fmt(sobra)} ÷ 4 = ${fmt(sobra / 4)} → <b>${bl}</b> bloco(s) de 4 m² inteiros (a fração não conta).`, `100 + ${bl} × 60 = <b>${L.va} VA</b>, em 1 ponto no teto.`]; }
  // TUG
  let tugA = [];
  if (['cozinha', 'copa', 'area_servico'].includes(c.tipo)) { const n = Math.ceil(p / 3.5 - 1e-9);
    tugA.push(`Perímetro: <b>${fmt(p)} m</b> → ${fmt(p)} ÷ 3,5 = ${fmt(p / 3.5)} → com fração arredonda pra cima: <b>${n}</b>.`);
    if (c.tipo !== 'area_servico') tugA.push(`Dessas, <b>2</b> devem ficar acima da bancada da pia.${n < 2 ? ' Como a conta deu menos de 2, o mínimo sobe pra 2.' : ''}`); }
  else if (c.tipo === 'sala' || c.tipo === 'quarto' || (!['banheiro', 'lavabo', 'varanda'].includes(c.tipo) && a > 6))
    tugA.push(`${a > 6 && !['sala', 'quarto'].includes(c.tipo) ? `Área de ${fmt(a)} m² passa de 6 m². ` : ''}Perímetro: <b>${fmt(p)} m</b> → ${fmt(p)} ÷ 5 = ${fmt(p / 5)} → arredonda pra cima: <b>${t.min}</b>.`);
  else if (c.tipo === 'banheiro' || c.tipo === 'lavabo') tugA.push(`${tipo}: <b>1</b> tomada junto à pia.`);
  else if (c.tipo === 'varanda') tugA.push('Varanda: <b>1</b> tomada.');
  else tugA.push(`Área de <b>${fmt(a)} m²</b> → ${a <= 2.25 ? 'até 2,25 m²' : 'entre 2,25 e 6 m²'}: <b>1</b> tomada.`);
  if (mol) { const g = t.min > 6 ? 2 : Math.min(t.min, 3), r = t.min - g; tugA.push(`Carga: ${g} × 600${r ? ` + ${r} × 100` : ''} = <b>${t.va} VA</b>.`); }
  else tugA.push(`Carga: ${t.min} × 100 = <b>${t.va} VA</b>.`);
  tugA.push(`Máximo de <b>${t.max}</b>: recomendação do EletroMaster pra uso confortável (a norma só fixa o mínimo). Com ${t.max} tomadas a carga seria ${tugVA(c.tipo, t.max)} VA${mol && t.max > 6 ? ' (menor, por causa da regra de mais de 6 tomadas)' : ''}.`);
  // TUE
  const tueN = [`Tensão usada neste projeto: <b>${tensao()} V</b> (troque no botão de tensão do painel conforme a instalação da casa). Em 127 V a corrente fica maior e mais aparelhos passam de 10 A.`, 'Cada TUE recebe a <b>potência nominal</b> do aparelho (a da etiqueta).', 'A tomada (ou ponto) fica a <b>no máximo 1,5 m</b> do lugar do aparelho.', 'Aparelho com corrente acima de <b>10 A</b> deve ter <b>circuito só dele</b>.'];
  const us = c.tue || [];
  const tueAp = us.length ? us.map(u => `${esc(u.nome)}: ${u.w} W${u.fp < 1 ? ` ÷ ${fmt(u.fp, 1)} (fator de potência) = ${tueVA(u)} VA` : ` = ${tueVA(u)} VA`} → ${tueVA(u)} ÷ ${tensao()} V = <b>${fmt(tueA(u), 1)} A</b>${tueA(u) > 10 ? ' → passa de 10 A: <b>circuito exclusivo</b>.' : ' → até 10 A.'}`).concat([`Total de TUE: <b>${tueTotal(c)} VA</b>.`]) : ['Nenhuma TUE neste cômodo ainda. Use "+ TUE" pra adicionar chuveiro, ar, forno etc.'];
  abrirModal(`<h2>Por que esses valores? · ${esc(c.nome)} (${tipo})</h2>
    ${bloco('💡 Iluminação', luzN, luzA)}${bloco(`🔌 Tomadas de uso geral (TUG) em ${tipo.toLowerCase()}`, regraTUG(c.tipo), tugA)}${bloco("⚡ Tomadas de uso específico (TUE)", tueN, tueAp)}
    <p class="aviso">Regras da NBR 5410 (item 9.5.2) explicadas com nossas palavras, sem copiar o texto da ABNT. Ferramenta de apoio: o projeto oficial precisa de profissional habilitado e ART.</p>
    <div class="botoes"><button class="btn" id="mCanc">Entendi</button></div>`);
  $('#mCanc').onclick = fecharModal;
}
function nomeAuto(tipo, exceto) {
  const base = nomeTipo(tipo), n = proj.comodos.filter(c => c.tipo === tipo && c.id !== exceto).length;
  return n ? `${base} ${n + 1}` : base;
}

// Muda o comprimento da parede i "esticando" o cômodo: tudo que está além do fim da parede anda junto.
function esticarParede(c, i, novoL) {
  const a = c.pts[i], b = c.pts[(i + 1) % c.pts.length], L = dist(a, b); if (L < 1e-9) return;
  const d = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], delta = novoL - L, lim = b[0] * d[0] + b[1] * d[1] - 1e-6;
  c.pts = c.pts.map(p => (p[0] * d[0] + p[1] * d[1] >= lim) ? [+(p[0] + d[0] * delta).toFixed(4), +(p[1] + d[1] * delta).toFixed(4)] : p);
}

// ---------- fechar cômodo: tipo obrigatório ----------
function fecharRascunho() {
  if (rascunho.length < 3) return;
  const pts = rascunho.slice();
  if (area(pts) < 0.05) { aviso('Esse cômodo ficou sem área. Confira os cantos.'); return; }
  pedirTipo(pts);
}
function pedirTipo(pts) {
  $('#modal').dataset.obrigatorio = '1';
  abrirModal(`<h2>Que cômodo é esse?</h2>
    <p class="aviso" style="margin:0 0 12px">O tipo define as regras da NBR 5410 (iluminação e tomadas) que o EletroMaster vai aplicar.</p>
    <div class="campo"><label>Tipo</label><select id="mTipo"><option value="">Escolha…</option>${opcoesTipo('')}</select></div>
    <div class="campo"><label>Nome (opcional)</label><input id="mNome" type="text" maxlength="40" placeholder="Ex.: Quarto do casal"></div>
    <div class="medidas" style="margin-bottom:12px">Área <b>${fmt(area(pts))} m²</b> · Perímetro <b>${fmt(perimetro(pts))} m</b></div>
    <div class="botoes"><button class="btn" id="mCanc">Voltar ao desenho</button><button class="btn primario" id="mOk">Salvar cômodo</button></div>`);
  $('#mCanc').onclick = () => { delete $('#modal').dataset.obrigatorio; fecharModal(); };
  $('#mOk').onclick = () => {
    const tipo = $('#mTipo').value;
    if (!tipo) { $('#mTipo').focus(); $('#mTipo').style.borderColor = '#ff5d5d'; return; }
    const nome = $('#mNome').value.trim() || nomeAuto(tipo);
    delete $('#modal').dataset.obrigatorio; fecharModal();
    checkpoint();
    const c = { id: uid(), nome, tipo, pts };
    proj.comodos.push(c); rascunho = []; gravar();
    sel = { comodo: c.id, parede: null }; definirModo('selecionar');
  };
}

// ---------- retângulo rápido ----------
$('#btnRetangulo').onclick = () => {
  const u = banco.unidade;
  abrirModal(`<h2>Cômodo retangular</h2>
    <div class="dupla"><div class="campo"><label>Largura (${u})</label><input id="mL" type="text" inputmode="decimal" value="${u === 'cm' ? '300' : '3,00'}" onfocus="this.select()"></div>
    <div class="campo"><label>Comprimento (${u})</label><input id="mC" type="text" inputmode="decimal" value="${u === 'cm' ? '400' : '4,00'}" onfocus="this.select()"></div></div>
    <div class="campo"><label>Tipo</label><select id="mTipo"><option value="">Escolha…</option>${opcoesTipo('')}</select></div>
    <div class="campo"><label>Nome (opcional)</label><input id="mNome" type="text" maxlength="40"></div>
    <div class="botoes"><button class="btn" id="mCanc">Cancelar</button><button class="btn primario" id="mOk">Criar</button></div>`);
  $('#mL').focus();
  $('#mCanc').onclick = fecharModal;
  $('#mOk').onclick = () => {
    const L = lerMedida($('#mL').value, u), C = lerMedida($('#mC').value, u), tipo = $('#mTipo').value;
    if (!isFinite(L) || !isFinite(C)) { aviso('Preencha largura e comprimento.'); return; }
    if (!tipo) { $('#mTipo').style.borderColor = '#ff5d5d'; $('#mTipo').focus(); return; }
    let x = 0, y = 0;
    const tod = todosVertices();
    if (tod.length) { x = Math.max(...tod.map(p => p[0])); y = Math.min(...tod.map(p => p[1])); }
    const c = { id: uid(), tipo, nome: $('#mNome').value.trim() || nomeAuto(tipo), pts: [[x, y], [x + L, y], [x + L, y + C], [x, y + C]].map(p => p.map(v => +v.toFixed(4))) };
    fecharModal(); checkpoint(); proj.comodos.push(c); gravar();
    sel = { comodo: c.id, parede: null }; definirModo('selecionar'); enquadrar(); render();
  };
};

// ---------- lista de cômodos ----------
$('#btnComodos').onclick = () => {
  if (!proj.comodos.length) { abrirModal('<h2>Cômodos</h2><div class="vazio">Nenhum cômodo desenhado ainda.</div><div class="botoes"><button class="btn" id="mCanc">Fechar</button></div>'); $('#mCanc').onclick = fecharModal; return; }
  let ta = 0, tp = 0, tv = 0, tn = 0, tt = 0, te = 0;
  const linhas = proj.comodos.map(c => { const a = area(c.pts), p = perimetro(c.pts), v = iluminacao(c.pts).va, t = tug(c); ta += a; tp += p; tv += v; tn += t.min; tt += t.va; const e = tueTotal(c); te += e; return `<tr class="clicavel" data-id="${c.id}"><td>${esc(c.nome)}</td><td>${nomeTipo(c.tipo)}</td><td class="n">${fmt(a)}</td><td class="n">${fmt(p)}</td><td class="n">${v}</td><td class="n">${t.min}–${t.max}</td><td class="n">${t.va}</td><td class="n">${e}</td></tr>`; }).join('');
  abrirModal(`<h2>Cômodos de ${esc(proj.nome)}</h2>
    <table><tr><th>Nome</th><th>Tipo</th><th class="n">Área (m²)</th><th class="n">Perím. (m)</th><th class="n">Luz (VA)</th><th class="n">TUG</th><th class="n">TUG (VA)</th><th class="n">TUE (VA)</th></tr>${linhas}
    <tr class="total"><td>Total</td><td>${proj.comodos.length} cômodo(s)</td><td class="n">${fmt(ta)}</td><td class="n">—</td><td class="n">${tv}</td><td class="n">${tn}</td><td class="n">${tt}</td><td class="n">${te}</td></tr></table>
    <p class="aviso" style="margin-top:10px">Luz: mínimo pela NBR 5410 (1 ponto no teto por cômodo; 100 VA até 6 m², +60 VA a cada 4 m² inteiros). TUG: mínimo da NBR 5410 – máximo recomendado pelo app; VA calculado com o mínimo (600 VA nas 3 primeiras de cozinha, copa, área de serviço e banheiro; 100 VA nas demais). TUE: potência do aparelho; acima de 10 A na tensão do projeto (${tensao()} V), circuito exclusivo. Ferramenta de apoio: confira com profissional habilitado.</p>
    <div class="botoes"><button class="btn primario" id="mDem">📊 Demanda da casa</button><button class="btn primario" id="mCirc">🔀 Circuitos</button><button class="btn primario" id="mQd">📋 Quadro de cargas</button><button class="btn primario" id="mMat">🧾 Materiais</button><button class="btn primario" id="mRel">📄 Relatório PDF</button><button class="btn primario" id="mTr">🎓 Treinar</button><button class="btn" id="mImg">📷 Imagem da planta</button><button class="btn" id="mCanc">Fechar</button></div>`);
  $('#mCanc').onclick = fecharModal; $('#mDem').onclick = mostrarDemanda; $('#mCirc').onclick = mostrarCircuitos; $('#mQd').onclick = mostrarQuadro; $('#mMat').onclick = mostrarMateriais; $('#mRel').onclick = mostrarRelatorio; $('#mTr').onclick = treinar; $('#mImg').onclick = () => { fecharModal(); exportarImagem(); };
  $('#modalConteudo').querySelectorAll('tr[data-id]').forEach(tr => tr.onclick = () => { fecharModal(); definirModo('selecionar'); sel = { comodo: tr.dataset.id, parede: null }; render(); });
};

// ---------- modos ----------
function definirModo(m) {
  modo = m; if (m === 'desenhar' || m === 'ver') sel = { comodo: null, parede: null }; if (m === 'ver') selPonto = null;
  document.querySelectorAll('.barra .modo').forEach(b => b.classList.toggle('ativo', b.dataset.modo === m));
  $('#painel').dataset.tipo = '';
  render();
}
document.querySelectorAll('.barra .modo').forEach(b => b.onclick = () => {
  const ir = () => { if (b.dataset.modo !== 'desenhar') rascunho = []; definirModo(modo === b.dataset.modo ? 'ver' : b.dataset.modo); }; // v40: tocar de novo no modo ativo fecha (modo livre)
  if (modo === 'desenhar' && b.dataset.modo !== 'desenhar' && rascunho.length) confirmar('Descartar o cômodo em desenho?', ir, 'Descartar'); else ir();
});
function garantirVisivel(w) {
  const r = svg.getBoundingClientRect(), s = tela(w);
  if (s[0] < 30 || s[1] < 30 || s[0] > r.width - 30 || s[1] > r.height - 30) { enquadrar(); }
}

// ---------- toque / mouse ----------
const ponteiros = new Map();
let gesto = null;
const pos = e => { const r = svg.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

svg.addEventListener('pointerdown', e => {
  svg.setPointerCapture(e.pointerId);
  ponteiros.set(e.pointerId, pos(e));
  if (ponteiros.size === 2) {
    const [a, b] = [...ponteiros.values()];
    gesto = { tipo: 'pinca', d0: dist(a, b), esc0: vista.esc, m0: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], ox0: vista.ox, oy0: vista.oy };
    return;
  }
  if (ponteiros.size > 2) return;
  const s = pos(e), w = mundo(s);
  gesto = { tipo: 'pan', ini: s, ox0: vista.ox, oy0: vista.oy, moveu: false };
  if (modo === 'desenhar') {
    // arrastar o dedo desenha a parede: começa no último canto (ou onde tocou, se for a primeira)
    const inicio = rascunho.length ? rascunho[rascunho.length - 1] : imantar(w, null, undefined, 2);
    gesto = { tipo: 'traco', ini: s, inicio, novoInicio: !rascunho.length, moveu: false };
    return;
  }
  if (modo === 'pontos') {
    const pq = pontoEm(s);
    if (pq) { selPonto = pq.q.id; sel = { comodo: pq.c.id, parede: null }; gesto = { tipo: 'ponto', ini: s, c: pq.c, q: pq.q, moveu: false }; render(); }
    return;
  }
  if (modo === 'selecionar') {
    const pe = portaEm(s);
    if (pe && !(sel.comodo && comodo(sel.comodo).pts.some(p => dist(tela(p), s) < TOL_PX + 4))) { gesto = { tipo: 'porta', ini: s, c: pe.c, pt: pe.pt, moveu: false }; return; }
  }
  if (modo === 'selecionar' && sel.comodo) {
    const c = comodo(sel.comodo);
    const vi = c.pts.findIndex(p => dist(tela(p), s) < TOL_PX + 4);
    if (vi >= 0) gesto = { tipo: 'vertice', ini: s, c, vi, orig: c.pts[vi].slice(), moveu: false };
    else if (dentro(w, c.pts) && !paredeEm(s)) gesto = { tipo: 'mover', ini: s, c, w0: w, orig: clone(c.pts), moveu: false };
  }
});

svg.addEventListener('pointermove', e => {
  const s = pos(e);
  if (ponteiros.has(e.pointerId)) ponteiros.set(e.pointerId, s);
  if (gesto && gesto.tipo === 'pinca' && ponteiros.size === 2) {
    const [a, b] = [...ponteiros.values()], d = dist(a, b), m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    vista.esc = gesto.esc0; vista.ox = gesto.ox0 + (m[0] - gesto.m0[0]); vista.oy = gesto.oy0 + (m[1] - gesto.m0[1]);
    zoomEm(m[0], m[1], d / gesto.d0); render(); return;
  }
  if (!gesto) { // mouse passando: prévia no modo desenho
    if (modo === 'desenhar' && rascunho.length && e.pointerType === 'mouse') { cursor = imantar(mundo(s), rascunho[rascunho.length - 1]); render(); }
    return;
  }
  if (!gesto.moveu && dist(s, gesto.ini) < 7) return;
  if (!gesto.moveu) { gesto.moveu = true; if (gesto.tipo === 'vertice' || gesto.tipo === 'mover' || gesto.tipo === 'porta' || gesto.tipo === 'ponto') checkpoint(); }
  if (gesto.tipo === 'ponto') { const m = paredeMaisPerto(gesto.c, mundo(s)); if (m) { gesto.q.parede = m.i; gesto.q.pos = m.pos; } render(); return; }
  if (gesto.tipo === 'traco') {
    if (gesto.novoInicio) { rascunho.push(gesto.inicio); gesto.novoInicio = false; }
    cursor = imantar(mundo(s), rascunho[rascunho.length - 1]); render(); return;
  }
  if (gesto.tipo === 'porta') {
    // arrasta a porta pra qualquer parede do cômodo, deslizando ao longo dela
    const c = gesto.c, pt = gesto.pt, w = mundo(s); let melhor = null, md = Infinity;
    c.pts.forEach((a, i) => {
      const b = c.pts[(i + 1) % c.pts.length], L = dist(a, b); if (L < pt.largura) return;
      const d = distSeg(w, a, b); if (d < md) { md = d; const t = ((w[0] - a[0]) * (b[0] - a[0]) + (w[1] - a[1]) * (b[1] - a[1])) / L; melhor = { i, pos: Math.max(pt.largura / 2, Math.min(L - pt.largura / 2, Math.round(t / GRADE) * GRADE)) }; }
    });
    if (melhor) { pt.parede = melhor.i; pt.pos = melhor.pos; sel = { comodo: c.id, parede: melhor.i }; }
    render(); return;
  }
  if (gesto.tipo === 'pan') { vista.ox = gesto.ox0 + s[0] - gesto.ini[0]; vista.oy = gesto.oy0 + s[1] - gesto.ini[1]; render(); }
  else if (gesto.tipo === 'vertice') {
    const c = gesto.c, n = c.pts.length, ant = c.pts[(gesto.vi - 1 + n) % n], prox = c.pts[(gesto.vi + 1) % n];
    let novo = imantar(mundo(s), null, c.id);
    const tolA = 12 / vista.esc;
    if (!todosVertices(c.id).some(v => v[0] === novo[0] && v[1] === novo[1])) { // não estava preso num canto
      const w = mundo(s);
      novo = [Math.abs(w[0] - ant[0]) < tolA ? ant[0] : Math.abs(w[0] - prox[0]) < tolA ? prox[0] : novo[0],
              Math.abs(w[1] - ant[1]) < tolA ? ant[1] : Math.abs(w[1] - prox[1]) < tolA ? prox[1] : novo[1]];
    }
    // leva junto cantos de outros cômodos que estavam colados neste
    proj.comodos.forEach(o => { if (o.id !== c.id) o.pts.forEach((p, k) => { if (dist(p, gesto.orig) < 0.002) o.pts[k] = novo.slice(); }); });
    c.pts[gesto.vi] = novo; gesto.orig = novo.slice(); render();
  } else if (gesto.tipo === 'mover') {
    const w = mundo(s); let dx = w[0] - gesto.w0[0], dy = w[1] - gesto.w0[1];
    dx = Math.round(dx / GRADE) * GRADE; dy = Math.round(dy / GRADE) * GRADE;
    // ímã: encosta um canto em canto de outro cômodo
    const tol = TOL_PX / vista.esc, outros = todosVertices(gesto.c.id); let melhor = null, md = tol;
    gesto.orig.forEach(p => { const q = [p[0] + dx, p[1] + dy]; outros.forEach(o => { const d = dist(o, q); if (d < md) { md = d; melhor = [o[0] - p[0], o[1] - p[1]]; } }); });
    if (melhor) [dx, dy] = melhor;
    gesto.c.pts = gesto.orig.map(p => [+(p[0] + dx).toFixed(4), +(p[1] + dy).toFixed(4)]); render();
  }
});

function fimPonteiro(e) {
  if (!ponteiros.has(e.pointerId)) return;
  const s = ponteiros.get(e.pointerId); ponteiros.delete(e.pointerId);
  if (gesto && gesto.tipo === 'pinca') { if (ponteiros.size === 0) gesto = null; else gesto = { tipo: 'nada', moveu: true }; return; }
  if (!gesto) return;
  const g = gesto; gesto = null;
  if ((g.tipo === 'vertice' || g.tipo === 'mover' || g.tipo === 'porta' || g.tipo === 'ponto') && g.moveu) { gravar(); render(); return; }
  if (g.tipo === 'ponto') return;
  if (g.tipo === 'porta') { sel = { comodo: g.c.id, parede: g.pt.parede }; render(); return; }
  if (g.tipo === 'traco' && g.moveu) {
    const u = rascunho[rascunho.length - 1], fim = imantar(mundo(s), u); cursor = null;
    if (rascunho.length >= 3 && dist(tela(fim), tela(rascunho[0])) < TOL_PX + 6) { render(); fecharRascunho(); return; }
    if (dist(u, fim) >= 0.05) rascunho.push(fim);
    else if (rascunho.length === 1) rascunho = [];
    render(); return;
  }
  if (!g.moveu && e.type === 'pointerup') toque(s);
}
svg.addEventListener('pointerup', fimPonteiro);
svg.addEventListener('pointercancel', fimPonteiro);
svg.addEventListener('wheel', e => { e.preventDefault(); const s = pos(e); zoomEm(s[0], s[1], Math.exp(-e.deltaY * 0.0015)); render(); }, { passive: false });

function portaEm(s) {
  let melhor = null, md = Infinity;
  proj.comodos.forEach(c => (c.portas || []).forEach(pt => {
    const g = geoPorta(c, pt); if (!g) return;
    const m = tela([(g.p0[0] + g.p1[0]) / 2 + g.nrm[0] * g.w / 2, (g.p0[1] + g.p1[1]) / 2 + g.nrm[1] * g.w / 2]);
    const d = dist(m, s), raio = Math.max(g.w * vista.esc * 0.6, TOL_PX + 6);
    if (d < raio && d < md) { md = d; melhor = { c, pt }; }
  }));
  return melhor;
}
function paredeEm(s) {
  let melhor = null, md = TOL_PX;
  const ordem = sel.comodo ? [comodo(sel.comodo), ...proj.comodos.filter(c => c.id !== sel.comodo)] : proj.comodos;
  ordem.forEach(c => c.pts.forEach((a, i) => {
    const d = distSeg(s, tela(a), tela(c.pts[(i + 1) % c.pts.length]));
    if (d < md - (c.id === sel.comodo ? 0 : 0.5)) { md = d; melhor = { comodo: c.id, parede: i }; }
  }));
  return melhor;
}

function toque(s) {
  const w = mundo(s);
  if (modo === 'ver') return;
  if (modo === 'pontos') { colocarPonto(w); return; }
  if (modo === 'desenhar') {
    if (rascunho.length >= 3 && dist(tela(rascunho[0]), s) < TOL_PX + 6) { fecharRascunho(); return; }
    const p = imantar(w, rascunho[rascunho.length - 1], undefined, rascunho.length ? 1 : 2);
    const u = rascunho[rascunho.length - 1];
    if (u && dist(u, p) < 0.01) return;
    rascunho.push(p); cursor = null; render(); return;
  }
  const par = paredeEm(s);
  if (par) { sel = par; render(); return; }
  for (let i = proj.comodos.length - 1; i >= 0; i--) {
    if (dentro(w, proj.comodos[i].pts)) { sel = { comodo: proj.comodos[i].id, parede: null }; render(); return; }
  }
  sel = { comodo: null, parede: null }; render();
}

// ---------- pontos na planta: tomadas e interruptores (simbologia usual NBR 5444) ----------
let selPonto = null, ferramenta = 'bx', dupla = false;
const ALT = { bx: ['Baixa', '0,30 m'], md: ['Média', '1,30 m'], al: ['Alta', '2,00 m'] };
const FERR = [['bx', '▽ Baixa'], ['md', '◭ Média'], ['al', '▲ Alta'], ['int', '● Interruptor'], ['par', '◐ Paralelo'], ['qdc', '▣ Quadro'], ['med', '⊠ Medidor']];
function paredeMaisPerto(c, w) {
  let melhor = null, md = Infinity;
  c.pts.forEach((a, i) => {
    const b = c.pts[(i + 1) % c.pts.length], L = dist(a, b); if (L < 0.2) return;
    const d = distSeg(w, a, b); if (d < md) { md = d; const t = ((w[0] - a[0]) * (b[0] - a[0]) + (w[1] - a[1]) * (b[1] - a[1])) / L; melhor = { i, pos: Math.max(0.1, Math.min(L - 0.1, Math.round(t / GRADE) * GRADE)), d }; }
  });
  return melhor;
}
function geoPonto(c, q) {
  const n = c.pts.length, a = c.pts[q.parede % n], b = c.pts[(q.parede + 1) % n], L = dist(a, b); if (L < 1e-6) return null;
  const d = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], pos = Math.min(q.pos, L), m = [a[0] + d[0] * pos, a[1] + d[1] * pos];
  let nrm = [-d[1], d[0]]; const ct = centroide(c.pts);
  if ((ct[0] - m[0]) * nrm[0] + (ct[1] - m[1]) * nrm[1] < 0) nrm = [-nrm[0], -nrm[1]];
  return { m, nrm, d };
}
function letraLuz(c) { const i = proj.comodos.indexOf(c); return String.fromCharCode(97 + (i % 26)); }
function svgPonto(c, q, destaque) {
  const g = geoPonto(c, q); if (!g) return '';
  const P = tela(g.m), off = 16, C = [P[0] + g.nrm[0] * off, P[1] + g.nrm[1] * off], cor = destaque ? '#ffc531' : '#e8eef7';
  let h = `<line x1="${P[0]}" y1="${P[1]}" x2="${C[0]}" y2="${C[1]}" stroke="${cor}" stroke-width="1.6"/>`;
  if (q.k === 'med') {
    const a = Math.atan2(g.d[1], g.d[0]) * 180 / Math.PI;
    return `<g transform="translate(${P[0].toFixed(1)},${P[1].toFixed(1)}) rotate(${a.toFixed(1)})"><rect x="-12" y="-9" width="24" height="18" fill="#0d1626" stroke="${cor}" stroke-width="1.8"/><path d="M-12,-9L12,9M12,-9L-12,9" stroke="${cor}" stroke-width="1.4"/></g><text x="${C[0] + g.nrm[0] * 10}" y="${C[1] + g.nrm[1] * 10 + 4}" text-anchor="middle" font-size="11" font-weight="700" fill="#7ee0ff">MEDIDOR</text>`;
  }
  if (q.k === 'qdc') {
    const a = Math.atan2(g.d[1], g.d[0]) * 180 / Math.PI;
    return `<g transform="translate(${P[0].toFixed(1)},${P[1].toFixed(1)}) rotate(${a.toFixed(1)})"><rect x="-14" y="-6" width="28" height="12" fill="#0d1626" stroke="${cor}" stroke-width="1.8"/><polygon points="-14,-6 14,-6 -14,6" fill="${cor}"/></g><text x="${C[0] + g.nrm[0] * 8}" y="${C[1] + g.nrm[1] * 8 + 4}" text-anchor="middle" font-size="11" font-weight="700" fill="#ffc531">QDC</text>`;
  }
  if (q.k === 'tom' && q.dupla) {
    const sh = 8, q1 = Object.assign({}, q, { dupla: false });
    const um = (dx) => { const C2 = [C[0] + g.d[0] * dx, C[1] + g.d[1] * dx], r = 8, ang = Math.atan2(g.nrm[1], g.nrm[0]);
      const v = [0, 2.094, 4.189].map(t => [C2[0] + r * Math.cos(ang + t), C2[1] + r * Math.sin(ang + t)]), pts = v.map(p => p.map(x => x.toFixed(1)).join(',')).join(' ');
      let o = `<polygon points="${pts}" fill="${q.alt === 'al' ? cor : '#0d1626'}" stroke="${cor}" stroke-width="1.5"/>`;
      if (q.alt === 'md') { const meio = [(v[1][0] + v[2][0]) / 2, (v[1][1] + v[2][1]) / 2]; o += `<polygon points="${[v[0], v[1], meio].map(p => p.map(x => x.toFixed(1)).join(',')).join(' ')}" fill="${cor}"/>`; }
      return o; };
    return h + um(-sh) + um(sh);
  }
  if (q.k === 'tom') {
    const r = 9, ang = Math.atan2(g.nrm[1], g.nrm[0]);
    const v = [0, 2.094, 4.189].map(t => [C[0] + r * Math.cos(ang + t), C[1] + r * Math.sin(ang + t)]);
    const pts = v.map(p => p.map(x => x.toFixed(1)).join(',')).join(' ');
    h += `<polygon points="${pts}" fill="${q.alt === 'al' ? cor : '#0d1626'}" stroke="${cor}" stroke-width="1.6"/>`;
    if (q.alt === 'md') { const meio = [(v[1][0] + v[2][0]) / 2, (v[1][1] + v[2][1]) / 2]; h += `<polygon points="${[v[0], v[1], meio].map(p => p.map(x => x.toFixed(1)).join(',')).join(' ')}" fill="${cor}"/>`; }
  } else {
    const r = 6; h += `<circle cx="${C[0]}" cy="${C[1]}" r="${r}" fill="${q.k === 'par' ? '#0d1626' : cor}" stroke="${cor}" stroke-width="1.6"/>`;
    if (q.k === 'par') h += `<path d="M${C[0]},${C[1] - r}A${r},${r} 0 0 1 ${C[0]},${C[1] + r}Z" fill="${cor}"/>`;
    h += `<text x="${C[0] + 9}" y="${C[1] - 6}" font-size="11" font-weight="700" fill="#ffd84a">${letraLuz(c)}</text>`;
  }
  return h;
}
function pontoEm(s) {
  let melhor = null, md = TOL_PX + 6;
  proj.comodos.forEach(c => (c.pontos || []).forEach(q => { const g = geoPonto(c, q); if (!g) return; const P = tela(g.m), C = [P[0] + g.nrm[0] * 16, P[1] + g.nrm[1] * 16], d = dist(C, s); if (d < md) { md = d; melhor = { c, q }; } }));
  return melhor;
}
function colocarPonto(w) {
  let c = null; for (let i = proj.comodos.length - 1; i >= 0; i--) if (dentro(w, proj.comodos[i].pts)) { c = proj.comodos[i]; break; }
  if (!c) { selPonto = null; aviso('Toque dentro de um cômodo, perto da parede.'); render(); return; }
  const m = paredeMaisPerto(c, w); if (!m) return;
  checkpoint(); c.pontos = c.pontos || [];
  if (ferramenta === 'qdc' || ferramenta === 'med') proj.comodos.forEach(o => { if (o.pontos) o.pontos = o.pontos.filter(x => x.k !== ferramenta); });
  const q = ferramenta === 'qdc' || ferramenta === 'med' ? { id: uid(), k: ferramenta, parede: m.i, pos: m.pos } : ferramenta === 'int' || ferramenta === 'par' ? { id: uid(), k: ferramenta, parede: m.i, pos: m.pos } : { id: uid(), k: 'tom', alt: ferramenta, dupla, parede: m.i, pos: m.pos };
  c.pontos.push(q); selPonto = q.id; sel = { comodo: c.id, parede: null }; gravar(); render();
}
function achaPonto(id) { for (const c of proj.comodos) { const q = (c.pontos || []).find(x => x.id === id); if (q) return { c, q }; } return null; }
function painelPontos(p) {
  p.classList.add('aberto');
  const ach = selPonto && achaPonto(selPonto), c = ach ? ach.c : sel.comodo && comodo(sel.comodo);
  let h = `<div class="linha">${FERR.map(([k, n]) => `<button class="btn ${ferramenta === k ? 'primario' : ''}" data-ferr="${k}">${n}</button>`).join('')}<button class="btn ${dupla ? 'primario' : ''}" id="btnDupla">${dupla ? '☑' : '☐'} Dupla</button><button class="btn" id="btnLegenda">Legenda</button></div>`;
  if (!proj.comodos.some(o => (o.pontos || []).some(x => x.k === 'qdc'))) h += `<div class="linha medidas">⚠️ Coloque o quadro (▣ Quadro) pra calcular a distância e a queda de tensão.</div>`;
  if (proj.comodos.length) { const al = alimentador(); h += `<div class="linha"><button class="btn" id="btnSugQdc">🎯 Sugerir lugar do quadro</button><button class="btn ${proj.rua && proj.rua.on ? 'primario' : ''}" id="btnRua">🛣️ Rua e muro</button>${al ? `<span class="medidas"> Medidor → quadro: <b>${fmt(al.L, 1)} m</b> · fio <b>${fmt(al.sec, 1).replace(',0', '')} mm²</b> · queda ${fmt(al.dv, 2)}%</span>` : '<span class="medidas"> Coloque o ⊠ Medidor e o ▣ Quadro pra calcular o fio entre eles.</span>'}</div>`; }
  if (c) { const t = tug(c), ni = (c.pontos || []).filter(q => q.k === 'int' || q.k === 'par').length; h += `<div class="linha medidas">${esc(c.nome)}: tomadas <b>${t.col}</b> (mín. ${t.min} · recom. até ${t.max})${t.col < t.min ? ' ⚠️ faltam ' + (t.min - t.col) : t.col > t.max ? ' · acima do recomendado' : ' ✔'} · interruptores <b>${ni}</b> (luz "${letraLuz(c)}")</div>`; }
  if (ach) {
    const q = ach.q;
    if (q.k === 'med') h += `<div class="linha medidas">⊠ Medidor / padrão de entrada Coelba · fica no muro ou na fachada, virado pra rua · arraste pra mudar <button class="btn perigo" id="pExc">✕ Excluir</button></div>`;
    else if (q.k === 'qdc') h += `<div class="linha medidas">▣ Quadro de distribuição (QDC) · arraste pra mudar de lugar <button class="btn perigo" id="pExc">✕ Excluir</button></div>`;
    else h += `<div class="linha">${q.k === 'tom' ? `Tomada <select id="pAlt">${Object.entries(ALT).map(([k, [n, a]]) => `<option value="${k}" ${q.alt === k ? 'selected' : ''}>${n} (${a})</option>`).join('')}</select><select id="pDupla"><option value="0" ${q.dupla ? '' : 'selected'}>Simples</option><option value="1" ${q.dupla ? 'selected' : ''}>Dupla</option></select>` : `Interruptor <select id="pTipoInt"><option value="int" ${q.k === 'int' ? 'selected' : ''}>Simples</option><option value="par" ${q.k === 'par' ? 'selected' : ''}>Paralelo (three-way)</option></select>`}
      <button class="btn perigo" id="pExc">✕ Excluir</button></div>`;
    if (q.k === 'tom') { const sl = tomSlots(ach.c, tug(ach.c).n).find(x => x.q === q); h += `<div class="linha medidas">🔌 Aparelhos nesta tomada: ${(q.ap || []).length ? q.ap.map(u => `<span class="chip">${esc(u.nome)} ${u.w} W <button class="x" data-apx="${u.id}">✕</button></span>`).join(' ') : 'nenhum'} <button class="btn" id="pAp">+ Aparelho</button>${sl ? `<br>Carga usada: <b>${sl.va} VA</b> (norma ${sl.base} VA${sl.ap ? ` · aparelhos ${sl.ap} VA` : ''}; vale o maior)` : ''}</div>`; }
  }
  p.innerHTML = h;
  p.querySelectorAll('[data-ferr]').forEach(b => b.onclick = () => { ferramenta = b.dataset.ferr; selPonto = null; render(); });
  p.querySelector('#btnLegenda').onclick = legendaPontos;
  const sq = p.querySelector('#btnSugQdc'); if (sq) sq.onclick = sugerirQdc; const br = p.querySelector('#btnRua'); if (br) br.onclick = abrirRua;
  p.querySelector('#btnDupla').onclick = () => { dupla = !dupla; if (ferramenta === 'int' || ferramenta === 'par') ferramenta = 'bx'; render(); };
  if (ach) {
    const q = ach.q, a = p.querySelector('#pAlt'), ti = p.querySelector('#pTipoInt');
    if (a) a.onchange = e => { checkpoint(); q.alt = e.target.value; gravar(); render(); };
    const du = p.querySelector('#pDupla'); if (du) du.onchange = e => { checkpoint(); q.dupla = e.target.value === '1'; gravar(); render(); };
    if (ti) ti.onchange = e => { checkpoint(); q.k = e.target.value; gravar(); render(); };
    const pa = p.querySelector('#pAp'); if (pa) pa.onclick = () => novoAparelho(q);
    p.querySelectorAll('[data-apx]').forEach(b => b.onclick = () => { checkpoint(); q.ap = q.ap.filter(u => u.id !== b.dataset.apx); gravar(); render(); });
    p.querySelector('#pExc').onclick = () => { checkpoint(); ach.c.pontos = ach.c.pontos.filter(x => x.id !== q.id); selPonto = null; gravar(); render(); };
  }
}
function novoAparelho(q) {
  abrirModal(`<h2>🔌 Aparelho na tomada</h2>
    <div class="campo"><label>Aparelho</label><select id="mAp">${APAR_TUG.map(e => `<option value="${e[0]}">${e[1]} · ${e[2]} W</option>`).join('')}</select></div>
    <div class="dupla"><div class="campo"><label>Nome</label><input id="mApNome" type="text" maxlength="40"></div><div class="campo"><label>Potência (W)</label><input id="mApW" type="text" inputmode="numeric" style="max-width:110px"></div></div>
    <div id="mApInfo" class="medidas" style="font-size:13px;margin-bottom:10px"></div>
    <div style="font-size:12px;opacity:.7;margin-bottom:10px">Veja a potência na etiqueta do aparelho. O app usa na tomada o maior valor entre a norma (100 ou 600 VA) e a soma dos aparelhos.</div>
    <div class="botoes"><button class="btn" id="mCanc">Cancelar</button><button class="btn primario" id="mOk">Adicionar</button></div>`);
  const s = $('#mAp'), nm = $('#mApNome'), w = $('#mApW'), eq = () => APAR_TUG.find(e => e[0] === s.value);
  const info = () => { const e = eq(), W = +String(w.value).replace(',', '.') || 0, i = W / (e[3] || 1) / tensao(); $('#mApInfo').innerHTML = `${Math.round(W / (e[3] || 1))} VA · ${fmt(i, 1)} A em ${tensao()} V${i > 10 ? ' · ⚠️ passa de 10 A: o ideal é ligar como TUE, com circuito próprio' : ''}`; };
  const fill = () => { const e = eq(); nm.value = e[1]; w.value = e[2]; info(); };
  s.onchange = fill; w.oninput = info; fill();
  $('#mCanc').onclick = fecharModal;
  $('#mOk').onclick = () => { const e = eq(), W = Math.round(+String(w.value).replace(',', '.')); if (!(W > 0)) return aviso('Digite a potência em W'); checkpoint(); (q.ap = q.ap || []).push({ id: uid(), eq: e[0], nome: nm.value.trim() || e[1], w: W, fp: e[3] }); fecharModal(); gravar(); render(); };
}
// v37: rua e muro — medidor no limite do terreno com a via pública
const LADOS_RUA = [['s', '⬇ Embaixo'], ['n', '⬆ Em cima'], ['o', '⬅ Esquerda'], ['l', '➡ Direita']];
function ruaGeo() {
  const R = proj.rua; if (!R || !R.on || !proj.comodos.length) return null;
  const ps = proj.comodos.flatMap(c => c.pts), xs = ps.map(p => p[0]), ys = ps.map(p => p[1]);
  const mnx = Math.min(...xs) - 1, mxx = Math.max(...xs) + 1, mny = Math.min(...ys) - 1, mxy = Math.max(...ys) + 1, rc = Math.max(0, +R.recuo || 0), t = R.pos ?? .5;
  let A, B, dir; // dir = sentido da rua (pra fora do lote)
  if (R.lado === 'n') { const y = mny + 1 - rc; A = [mnx, y]; B = [mxx, y]; dir = [0, -1]; }
  else if (R.lado === 'o') { const x = mnx + 1 - rc; A = [x, mny]; B = [x, mxy]; dir = [-1, 0]; }
  else if (R.lado === 'l') { const x = mxx - 1 + rc; A = [x, mny]; B = [x, mxy]; dir = [1, 0]; }
  else { const y = mxy - 1 + rc; A = [mnx, y]; B = [mxx, y]; dir = [0, 1]; }
  return { A, B, dir, m: [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t] };
}
function svgRua() {
  const g = ruaGeo(); if (!g) return '';
  const off = (p, k) => tela([p[0] + g.dir[0] * k, p[1] + g.dir[1] * k]), A = tela(g.A), B = tela(g.B);
  const c1 = off(g.A, 1.5), c2 = off(g.B, 1.5), c3 = off(g.B, 7.5), c4 = off(g.A, 7.5), mid = off([(g.A[0] + g.B[0]) / 2, (g.A[1] + g.B[1]) / 2], 4.5);
  const pol = [c1, c2, c3, c4].map(p => p.map(v => v.toFixed(1)).join(',')).join(' ');
  let h = `<polygon points="${pol}" fill="#2a3342" opacity=".8"/><text x="${mid[0].toFixed(1)}" y="${(mid[1] + 5).toFixed(1)}" font-size="14" font-weight="700" fill="#8fa3bf" text-anchor="middle" letter-spacing="4">RUA</text>`;
  h += `<line x1="${A[0].toFixed(1)}" y1="${A[1].toFixed(1)}" x2="${B[0].toFixed(1)}" y2="${B[1].toFixed(1)}" stroke="#b0bccd" stroke-width="3" stroke-dasharray="10 7"/>`;
  const mt = off(g.A, -0.4); h += `<text x="${mt[0].toFixed(1)}" y="${mt[1].toFixed(1)}" font-size="11" fill="#8fa3bf">muro</text>`;
  if (cam('pontos') || modo === 'pontos') { const M = tela(g.m); h += `<g transform="translate(${M[0].toFixed(1)},${M[1].toFixed(1)})"><rect x="-10" y="-10" width="20" height="20" fill="#0d1626" stroke="#7ee0ff" stroke-width="2"/><path d="M-10,-10L10,10M10,-10L-10,10" stroke="#7ee0ff" stroke-width="1.4"/></g>`; }
  return h;
}
function abrirRua() {
  if (!proj.comodos.length) return aviso('Desenhe os cômodos primeiro.');
  const R = proj.rua = proj.rua || { on: false, lado: 's', recuo: 3, pos: .5 };
  abrirModal(`<h2>🛣️ Rua e muro</h2>
    <label style="display:flex;justify-content:space-between;align-items:center;padding:8px 0"><span>Mostrar rua e muro, com o medidor no muro</span><input type="checkbox" id="rOn" ${R.on ? 'checked' : ''}></label>
    <div class="campo"><label>De que lado fica a rua?</label><div class="linha">${LADOS_RUA.map(([k, n]) => `<button class="btn ${R.lado === k ? 'primario' : ''}" data-lado="${k}">${n}</button>`).join('')}</div></div>
    <div class="campo"><label>Distância da casa até o muro (m)</label><input id="rRec" type="text" inputmode="decimal" value="${fmt(+R.recuo || 0, 1)}" style="max-width:110px"></div>
    <div class="campo"><label>Posição do medidor no muro</label><input id="rPos" type="range" min="0" max="100" value="${Math.round((R.pos ?? .5) * 100)}" style="width:100%"></div>
    <div class="medidas" style="font-size:13px;margin:8px 0">📘 A Coelba pede o padrão de entrada (medidor) no limite do terreno com a rua, com acesso livre pra leitura. 🧮 Com a rua ligada, o fio do alimentador é medido do medidor no muro até o ▣ Quadro, e o ⊠ Medidor colocado na parede deixa de valer.</div>
    <div class="botoes"><button class="btn primario" id="mCanc">Pronto</button></div>`);
  const upd = () => { gravar(); render(); };
  $('#rOn').onchange = e => { checkpoint(); R.on = e.target.checked; if (R.on) enquadrar(); upd(); };
  document.querySelectorAll('[data-lado]').forEach(b => b.onclick = () => { checkpoint(); R.lado = b.dataset.lado; R.on = true; $('#rOn').checked = true; document.querySelectorAll('[data-lado]').forEach(x => x.classList.toggle('primario', x === b)); enquadrar(); upd(); });
  $('#rRec').onchange = e => { const v = +String(e.target.value).replace(',', '.'); if (!(v >= 0 && v <= 100)) return aviso('Digite de 0 a 100 m'); checkpoint(); R.recuo = v; enquadrar(); upd(); };
  $('#rPos').oninput = e => { R.pos = e.target.value / 100; upd(); };
  $('#mCanc').onclick = () => { fecharModal(); if (modo === 'pontos') render(); };
}
// v33: centro de cargas, sugestão do QDC e alimentador medidor → QDC
function centroCargas() {
  let s = 0, x = 0, y = 0;
  proj.comodos.forEach(c => { const va = iluminacao(c.pts).va + tug(c).va + tueTotal(c), ct = centroide(c.pts); s += va; x += va * ct[0]; y += va * ct[1]; });
  return s ? [x / s, y / s] : null;
}
function sugerirQdc() {
  const cc = centroCargas(); if (!cc) return;
  let c = proj.comodos.slice().reverse().find(o => dentro(cc, o.pts));
  if (!c) c = proj.comodos.reduce((b, o) => !b || dist(centroide(o.pts), cc) < dist(centroide(b.pts), cc) ? o : b, null);
  const m = paredeMaisPerto(c, cc); if (!m) return;
  checkpoint(); proj.comodos.forEach(o => { if (o.pontos) o.pontos = o.pontos.filter(x => x.k !== 'qdc'); });
  const q = { id: uid(), k: 'qdc', parede: m.i, pos: m.pos }; (c.pontos = c.pontos || []).push(q); selPonto = q.id; sel = { comodo: c.id, parede: null };
  gravar(); render();
  aviso(`Quadro sugerido em ${c.nome}, na parede mais perto do centro de cargas. Evite banheiro e atrás de porta; arraste se precisar.`);
}
const QUEDA_ALIM = 1; // % no alimentador (somado aos 4% dos circuitos, fica até 5% a partir do medidor)
function alimentador() {
  let M = null, Q = null;
  proj.comodos.forEach(c => (c.pontos || []).forEach(q => { const g = (q.k === 'med' || q.k === 'qdc') && geoPonto(c, q); if (g) { if (q.k === 'med') M = g.m; else Q = g.m; } }));
  { const rg = ruaGeo(); if (rg) M = rg.m; }
  if (!M || !Q) return null;
  const g = geral(), L = Math.abs(M[0] - Q[0]) + Math.abs(M[1] - Q[1]) + 2; // + 2 m de subidas/descidas nas caixas
  let k = CAP.findIndex(([s]) => s === g.sec); if (k < 0) k = 0; const k0 = k;
  while (k < CAP.length - 1 && queda(g.ib, L, CAP[k][0]) > QUEDA_ALIM) k++;
  return { L, ib: g.ib, inn: g.inn, sec: CAP[k][0], iz: CAP[k][1], secAmp: CAP[k0][0], dv: queda(g.ib, L, CAP[k][0]), dvAntes: queda(g.ib, L, CAP[k0][0]), porQueda: k > k0 };
}
// v34: diagrama unifilar (módulo 11) — medidor → disjuntor geral → DPS → DR → barramento → circuitos
function mostrarUnifilar() {
  const { lista, V } = circuitos(), g = geral(), al = alimentador(), res = reservaQd(lista.length);
  if (!lista.length) { abrirModal('<h2>⚡ Diagrama unifilar</h2><div class="vazio">Desenhe os cômodos primeiro.</div><div class="botoes"><button class="btn" id="mCanc">Fechar</button></div>'); $('#mCanc').onclick = fecharModal; return; }
  const comDR = lista.filter(c => c.dr), semDR = lista.filter(c => !c.dr), ord = [...semDR, ...comDR];
  const passo = 74, x0 = 300, W = x0 + (ord.length + res) * passo + 40, yBar = 90, yDisj = 170, yFim = 420, H = 470, cor = '#e8eef7', am = '#ffc531';
  const t = (x, y, s, o = {}) => `<text x="${x}" y="${y}" font-size="${o.f || 11}" ${o.b ? 'font-weight="700"' : ''} fill="${o.c || cor}" text-anchor="${o.a || 'middle'}">${s}</text>`;
  const disj = (x, y, n) => `<line x1="${x}" y1="${y - 14}" x2="${x}" y2="${y - 6}" stroke="${cor}" stroke-width="2"/><path d="M${x},${y - 6} L${x + 8},${y + 8}" stroke="${cor}" stroke-width="2"/><line x1="${x}" y1="${y + 8}" x2="${x}" y2="${y + 14}" stroke="${cor}" stroke-width="2"/><circle cx="${x}" cy="${y - 6}" r="2.2" fill="${cor}"/>${t(x - 10, y + 4, n + ' A', { a: 'end', b: 1, c: am })}`;
  const fios = (x, y) => `<path d="M${x - 6},${y + 5}L${x + 6},${y - 5}M${x - 6},${y + 11}L${x + 6},${y + 1}" stroke="${cor}" stroke-width="1.4"/><path d="M${x - 6},${y + 17}L${x + 6},${y + 7}" stroke="#7ee07e" stroke-width="1.4"/>`;
  let s = '';
  // entrada
  s += `<rect x="20" y="${yBar - 28}" width="56" height="56" rx="4" fill="#0d1626" stroke="#7ee0ff" stroke-width="2"/><path d="M20,${yBar - 28}L76,${yBar + 28}M76,${yBar - 28}L20,${yBar + 28}" stroke="#7ee0ff" stroke-width="1.2"/>${t(48, yBar + 46, 'Medidor', { c: '#7ee0ff', b: 1 })}${t(48, yBar + 60, 'Coelba', { c: '#7ee0ff' })}`;
  s += `<line x1="76" y1="${yBar}" x2="${x0 - 10}" y2="${yBar}" stroke="${cor}" stroke-width="3"/>`;
  s += `${t(112, yBar - 34, `${fmt(al ? al.sec : g.sec, 1).replace(',0', '')} mm²`, { b: 1 })}${t(112, yBar - 20, al ? fmt(al.L, 1) + ' m' : 'alimentador')}${fios(112, yBar - 8)}`;
  // geral (desenhado na horizontal)
  s += `<rect x="150" y="${yBar - 12}" width="34" height="24" fill="#0d1626"/><path d="M152,${yBar} L162,${yBar} L178,${yBar - 10}" stroke="${cor}" stroke-width="2.4" fill="none"/><circle cx="162" cy="${yBar}" r="2.4" fill="${cor}"/>${t(170, yBar + 30, `Geral ${g.inn} A`, { b: 1, c: am })}`;
  // DPS
  s += `<line x1="212" y1="${yBar}" x2="212" y2="${yBar + 40}" stroke="${cor}" stroke-width="1.6"/><rect x="202" y="${yBar + 40}" width="20" height="28" fill="#0d1626" stroke="${cor}" stroke-width="1.6"/><path d="M212,${yBar + 44}L212,${yBar + 52}L207,${yBar + 56}L217,${yBar + 58}L212,${yBar + 64}" stroke="${am}" fill="none" stroke-width="1.4"/><line x1="212" y1="${yBar + 68}" x2="212" y2="${yBar + 84}" stroke="#7ee07e" stroke-width="1.6"/><path d="M202,${yBar + 84}H222M205,${yBar + 89}H219M209,${yBar + 94}H215" stroke="#7ee07e" stroke-width="1.6"/>${t(232, yBar + 58, `DPS ${dpsUc()} V`, { a: 'start', f: 10 })}`;
  // barramento
  const xEnd = x0 + (ord.length + res - 1) * passo + 20;
  s += `<line x1="${x0 - 10}" y1="${yBar}" x2="${xEnd}" y2="${yBar}" stroke="${cor}" stroke-width="4"/>${t(x0 + 10, yBar - 10, `Barramento ${V} V`, { a: 'start', f: 10 })}`;
  ord.forEach((c, i) => {
    const x = x0 + i * passo;
    s += `<line x1="${x}" y1="${yBar}" x2="${x}" y2="${yDisj - 14}" stroke="${cor}" stroke-width="2"/>${c.dr ? '' : ''}${disj(x, yDisj, c.inn)}<line x1="${x}" y1="${yDisj + 14}" x2="${x}" y2="${yFim}" stroke="${cor}" stroke-width="2"/>${fios(x, yDisj + 40)}`;
    s += `${t(x - 6, yDisj + 76, fmt(c.sec, 1).replace(',0', '') + ' mm²', { b: 1, a: 'end' })}${t(x, yFim + 16, 'C' + c.n, { b: 1, c: am, f: 12 })}`;
    const tp = c.tipo === 'Iluminação' ? 'Luz' : c.tipo.startsWith('TUG (') ? 'TUG coz./serv.' : c.tipo;
    s += `<g transform="translate(${x + 14},${yFim - 6}) rotate(-90)">${t(0, 0, `${tp} · ${c.va} VA`, { a: 'start', f: 10 })}</g><g transform="translate(${x + 27},${yFim - 6}) rotate(-90)">${t(0, 0, c.desc.replace(/<[^>]+>/g, '').slice(0, 24), { a: 'start', f: 9, c: '#9fb3cc' })}</g>`;
  });
  // DR (um para o grupo de áreas molhadas)
  if (comDR.length) {
    let xa = x0 + semDR.length * passo - 18, xb = x0 + (ord.length - 1) * passo + 18; if (xb - xa < 200) { const m = (xa + xb) / 2; xa = m - 100; xb = m + 100; }
    s += `<rect x="${xa}" y="${yBar + 18}" width="${xb - xa}" height="26" rx="6" fill="#16243b" stroke="#ff7a59" stroke-width="1.6"/>${t((xa + xb) / 2, yBar + 35, `DR 30 mA · ${comDR.length} circuito(s) · ≥ ${Math.max(...comDR.map(c => c.inn)) < 25 ? 25 : 40} A`, { c: '#ff9a7a', b: 1, f: 10 })}`;
  }
  for (let r = 0; r < res; r++) { const x = x0 + (ord.length + r) * passo; s += `<line x1="${x}" y1="${yBar}" x2="${x}" y2="${yDisj + 14}" stroke="#5b6b82" stroke-width="1.6" stroke-dasharray="5 4"/>${t(x, yDisj + 34, 'Reserva', { c: '#7f8ea6', f: 10 })}`; }
  s += `<line x1="${x0 - 30}" y1="${H - 14}" x2="${x0 - 18}" y2="${H - 24}" stroke="${cor}"/>${t(x0 - 12, H - 15, 'fase e neutro', { a: 'start', f: 10 })}<line x1="${x0 + 70}" y1="${H - 14}" x2="${x0 + 82}" y2="${H - 24}" stroke="#7ee07e"/>${t(x0 + 88, H - 15, 'terra (PE)', { a: 'start', f: 10 })}`;
  abrirModal(`<h2>⚡ Diagrama unifilar · ${esc(proj.nome)}</h2>
    <div style="font-size:13px;opacity:.8;margin-bottom:6px">Arraste pro lado pra ver todos os circuitos. Cada tracinho no fio é um condutor: fase e neutro (brancos) e terra (verde).</div>
    <div style="overflow:auto;border:1px solid var(--linha);border-radius:10px;background:#0d1626"><svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${s}</svg></div>
    <div class="exp-norma" style="margin-top:10px"><b>📘 Como ler</b><ul class="passos"><li>O unifilar mostra a instalação com <b>uma linha só</b> por circuito; os tracinhos dizem quantos fios passam ali.</li><li>Ordem no quadro: medidor (Coelba) → alimentador → <b>disjuntor geral</b> → <b>DPS</b> ligado ao terra → barramento → <b>disjuntor de cada circuito</b>.</li><li>Os circuitos de áreas molhadas ficam juntos sob um <b>DR 30 mA</b>. Também dá pra usar um DR por circuito ou um DR geral.</li><li>Os espaços tracejados são a <b>reserva</b> pra circuitos futuros.</li></ul></div>
    <p class="aviso">Diagrama simplificado, gerado pelo app. O unifilar do projeto oficial precisa ser revisado e assinado por profissional habilitado (ART).</p>
    <div class="botoes"><button class="btn" id="mQd">📋 Quadro de cargas</button><button class="btn" id="mCanc">Fechar</button></div>`);
  $('#mCanc').onclick = fecharModal; $('#mQd').onclick = mostrarQuadro;
}
// v35: módulo 12 — lista de materiais (estimativa)
const L_SEM_QDC = 10, EXTRA_PONTO = 2, SOBRA = 1.1, RET_INT = 3;
function materiais() {
  const { lista, Q } = circuitos(), g = geral(), al = alimentador(), res = reservaQd(lista.length), cs = proj.comodos;
  const fios = {};
  const add = (sec, cor, m) => { const k = `${sec}|${cor}`; fios[k] = (fios[k] || 0) + m; };
  const rotas = [];
  lista.forEach(c => {
    const L = c.L != null ? c.L : L_SEM_QDC, rota = L + Math.max(0, (c.np || 1) - 1) * EXTRA_PONTO; rotas.push(rota);
    add(c.sec, 'Fase (preto ou vermelho)', rota); add(c.sec, 'Neutro (azul-claro)', rota); add(c.sec, 'Terra (verde-amarelo)', rota);
  });
  const nInt = cs.reduce((s, c) => s + (c.pontos || []).filter(q => q.k === 'int' || q.k === 'par').length, 0), nPar = cs.reduce((s, c) => s + (c.pontos || []).filter(q => q.k === 'par').length, 0);
  const nRet = Math.max(nInt, cs.length); add(1.5, 'Retorno (amarelo, branco ou cinza)', nRet * RET_INT + nPar * RET_INT);
  if (al) ['Fase (preto ou vermelho)', 'Neutro (azul-claro)', 'Terra (verde-amarelo)'].forEach(cor => add(al.sec, cor + ' · alimentador', al.L));
  const tom = cs.flatMap(c => (c.pontos || []).filter(q => q.k === 'tom')), falta = cs.reduce((s, c) => s + Math.max(0, tug(c).min - tug(c).col), 0);
  const cnt = f => tom.filter(f).length;
  const disj = {}; lista.forEach(c => disj[c.inn] = (disj[c.inn] || 0) + 1);
  const comDR = lista.filter(c => c.dr), drA = comDR.length ? (Math.max(...comDR.map(c => c.inn)) < 25 ? 25 : 40) : 0;
  const nTue = lista.filter(c => c.tipo === 'TUE').length;
  const posicoes = lista.length + res + 1 + (comDR.length ? 2 : 0) + 2;
  const linhas = [], sec = s => fmt(s, 1).replace(',0', '');
  Object.entries(fios).sort().forEach(([k, m]) => { const [s, cor] = k.split('|'), mm = Math.ceil(m * SOBRA); linhas.push(['Fios e cabos', `Cabo flexível ${sec(+s)} mm² · ${cor}`, `${mm} m`, mm > 60 ? `${Math.ceil(mm / 100)} rolo(s) de 100 m` : 'comprar a metro']); });
  linhas.push(['Quadro', 'Quadro de distribuição (QDC) com trilho DIN', '1', `pelo menos ${posicoes} posições`]);
  linhas.push(['Quadro', `Disjuntor geral ${g.inn} A (curva C)`, '1', `pela demanda (${fmt(g.ib, 1)} A)`]);
  Object.keys(disj).map(Number).sort((x, y) => x - y).forEach(i => linhas.push(['Quadro', `Disjuntor ${i} A (curva C)`, `${disj[i]}`, 'circuitos']));
  if (comDR.length) linhas.push(['Quadro', `DR 30 mA, ${drA} A, bipolar`, '1', `${comDR.length} circuito(s) de áreas molhadas`]);
  linhas.push(['Quadro', `DPS classe II, ${dpsUc()} V, 20 kA`, '2', 'fase e neutro']);
  linhas.push(['Quadro', 'Barramentos de neutro e de terra', '1 de cada', '']);
  linhas.push(['Pontos', 'Tomada 2P+T 10 A simples', `${cnt(q => !q.dupla) + falta}`, falta ? `inclui ${falta} ainda não colocada(s) na planta` : '']);
  if (cnt(q => q.dupla)) linhas.push(['Pontos', 'Tomada 2P+T 10 A dupla', `${cnt(q => q.dupla)}`, '']);
  if (nTue) linhas.push(['Pontos', 'Tomada 2P+T 20 A ou conector (TUE)', `${nTue}`, 'chuveiro: ligação direta com conector']);
  if (nInt - nPar) linhas.push(['Pontos', 'Interruptor simples', `${nInt - nPar}`, '']);
  if (nPar) linhas.push(['Pontos', 'Interruptor paralelo (three-way)', `${nPar}`, 'sempre em par']);
  if (nInt < cs.length) linhas.push(['Pontos', 'Interruptor simples (a posicionar)', `${cs.length - nInt}`, '1 por cômodo sem interruptor na planta']);
  linhas.push(['Pontos', 'Ponto de luz (plafon/lâmpada LED)', `${cs.length}`, '1 por cômodo']);
  linhas.push(['Caixas', 'Caixa 4x2 (tomadas e interruptores)', `${tom.length + falta + nTue + Math.max(nInt, cs.length)}`, '']);
  linhas.push(['Caixas', 'Caixa octogonal 4x4 (teto)', `${cs.length}`, '']);
  const eletr = Math.ceil(rotas.reduce((s, r) => s + r, 0) * 0.6 * SOBRA);
  linhas.push(['Eletroduto', 'Eletroduto corrugado 20 mm (3/4")', `${eletr} m`, 'estimativa: circuitos dividem trechos']);
  if (al) linhas.push(['Eletroduto', 'Eletroduto 25 mm ou mais (alimentador)', `${Math.ceil(al.L * SOBRA)} m`, 'medidor → quadro']);
  linhas.push(['Outros', 'Fita isolante, conectores de emenda, buchas e parafusos', '—', 'a gosto do eletricista']);
  return { linhas, semQdc: !Q };
}
function mostrarMateriais() {
  if (!proj.comodos.length) return aviso('Desenhe os cômodos primeiro.');
  const m = materiais(); let grupo = '', rows = '';
  m.linhas.forEach(([gr, it, q, ob]) => { if (gr !== grupo) { grupo = gr; rows += `<tr class="total"><td colspan="2">${gr}</td></tr>`; } rows += `<tr><td>${esc(it)}${ob ? `<div style="font-size:11px;opacity:.65">${esc(ob)}</div>` : ''}</td><td class="n"><b>${esc(q)}</b></td></tr>`; });
  const ls = arr => `<ul class="passos">${arr.map(x => `<li>${x}</li>`).join('')}</ul>`;
  abrirModal(`<h2>🧾 Lista de materiais · ${esc(proj.nome)}</h2>
    ${m.semQdc ? '<div class="exp-aplic" style="margin-bottom:8px">⚠️ Sem o ▣ Quadro na planta, cada circuito foi estimado com 10 m. Coloque o quadro (modo 🔌 Pontos) pra medir de verdade.</div>' : ''}
    <table><tr><th>Item</th><th class="n">Qtd.</th></tr>${rows}</table>
    <div class="exp-norma" style="margin-top:10px"><b>🧮 Como o app estimou</b>${ls([`Fios: cada circuito leva fase, neutro e terra do quadro até o ponto mais longe + ${EXTRA_PONTO} m por ponto a mais, com a seção calculada em 🔀 Circuitos.`, `Retorno: ${RET_INT} m por interruptor (do interruptor até a luz), e mais ${RET_INT} m nos paralelos.`, 'Cores: neutro azul-claro e terra verde-amarelo (ou verde) são as da NBR 5410; fase e retorno podem ser outras cores, desde que não sejam essas.', `Tudo com ${Math.round((SOBRA - 1) * 100)}% de sobra pra emendas e perdas. Eletroduto ≈ 60% da soma dos caminhos, porque os circuitos dividem trechos perto do quadro.`])}</div>
    <p class="aviso">Estimativa pra orçamento. Confira na obra antes de comprar.</p>
    <div class="botoes"><button class="btn primario" id="mCopiar">📋 Copiar lista</button><button class="btn" id="mRel2">📄 PDF</button><button class="btn" id="mQd2">📋 Quadro</button><button class="btn" id="mCanc">Fechar</button></div>`);
  $('#mCanc').onclick = fecharModal; $('#mQd2').onclick = mostrarQuadro; $('#mRel2').onclick = mostrarRelatorio;
  $('#mCopiar').onclick = () => {
    const txt = `Lista de materiais · ${proj.nome} (EletroMaster)\n` + m.linhas.map(([gr, it, q, ob]) => `• ${it}: ${q}${ob ? ` (${ob})` : ''}`).join('\n');
    const velho = () => { const t = document.createElement('textarea'); t.value = txt; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); aviso('Lista copiada.'); } catch { aviso('Não deu pra copiar.'); } t.remove(); };
    if (navigator.clipboard) navigator.clipboard.writeText(txt).then(() => aviso('Lista copiada. Cole no WhatsApp ou nas notas.')).catch(velho); else velho();
  };
}
// v36: módulo 13 — relatório do projeto (imprimir / salvar em PDF)
function capturarModal(f) { const o = abrirModal; let h = ''; abrirModal = x => { h = x; }; try { f(); } catch (e) { } finally { abrirModal = o; } return h; }
function mostrarRelatorio() {
  if (!proj.comodos.length) return aviso('Desenhe os cômodos primeiro.');
  fecharModal();
  const svg = $('#svg'), W = svg.clientWidth, H = svg.clientHeight, sel0 = sel; sel = { comodo: null, parede: null }; render();
  const planta = new XMLSerializer().serializeToString(svg).replace('<svg', `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;background:#0b1424;border-radius:8px"`);
  sel = sel0; render();
  const { lista, V } = circuitos(), g = geral(), al = alimentador(), m = materiais(), res = reservaQd(lista.length);
  const unif = (capturarModal(mostrarUnifilar).match(/<svg[\s\S]*?<\/svg>/) || [''])[0].replace(/<svg width="(\d+)" height="(\d+)"/, '<svg style="width:100%;height:auto;background:#0d1626;border-radius:8px"');
  const s1 = x => fmt(x, 1).replace(',0', '');
  const com = proj.comodos.map(c => { const t = tug(c); return `<tr><td>${esc(c.nome)}</td><td>${nomeTipo(c.tipo)}</td><td>${fmt(area(c.pts))}</td><td>${fmt(perimetro(c.pts))}</td><td>${fmt(peDireito(c))}</td><td>${iluminacao(c.pts).va}</td><td>${t.min} / ${t.col}</td><td>${t.va}</td><td>${tueTotal(c)}</td></tr>`; }).join('');
  const cir = lista.map(c => `<tr><td>${c.n}</td><td>${c.tipo}</td><td>${c.desc}</td><td>${c.va}</td><td>${fmt(c.i, 1)}</td><td>${s1(c.sec)}</td><td>${c.inn}</td><td>${c.dv != null ? fmt(c.dv, 2) : '—'}</td><td>${c.dr ? 'Sim' : '—'}</td></tr>`).join('');
  const mat = m.linhas.map(([gr, it, q, ob]) => `<tr><td>${gr}</td><td>${esc(it)}${ob ? ` <small>(${esc(ob)})</small>` : ''}</td><td>${esc(q)}</td></tr>`).join('');
  const hoje = new Date().toLocaleDateString('pt-BR');
  const r = document.createElement('div'); r.id = 'relatorio';
  r.innerHTML = `<div class="rel-barra"><button class="btn primario" id="relPdf">🖨️ Salvar em PDF</button><button class="btn" id="relFechar">Fechar</button></div>
    <div class="rel-folha">
      <h1>⚡ ${esc(proj.nome)}</h1>
      <div class="rel-sub">Projeto elétrico residencial · ${hoje} · ${V} V · gerado no EletroMaster</div>
      <h2>Planta baixa</h2>${planta}
      <h2>Cômodos</h2><table><tr><th>Cômodo</th><th>Tipo</th><th>Área (m²)</th><th>Perím. (m)</th><th>Pé-dir. (m)</th><th>Luz (VA)</th><th>TUG mín./col.</th><th>TUG (VA)</th><th>TUE (VA)</th></tr>${com}</table>
      <h2>Quadro de cargas</h2><table><tr><th>Nº</th><th>Circuito</th><th>Atende</th><th>VA</th><th>Ib (A)</th><th>Fio (mm²)</th><th>Disj. (A)</th><th>Queda (%)</th><th>DR</th></tr>${cir}</table>
      <p>Demanda: <b>${fmt(g.d.dVA / 1000, 2)} kVA</b> (${fmt(g.ib, 1)} A) · Disjuntor geral: <b>${g.inn} A</b> · Alimentador: <b>${s1(al ? al.sec : g.sec)} mm²</b>${al ? ` (${fmt(al.L, 1)} m, queda ${fmt(al.dv, 2)}%)` : ''} · Reserva: ${res} espaço(s) · DPS classe II ${dpsUc()} V</p>
      <h2>Diagrama unifilar</h2>${unif}
      <h2>Lista de materiais (estimativa)</h2><table><tr><th>Grupo</th><th>Item</th><th>Qtd.</th></tr>${mat}</table>
      <h2>Normas aplicadas</h2><p>ABNT NBR 5410 (iluminação e tomadas mínimas, divisão de circuitos, Ib ≤ In ≤ Iz, seção mínima, queda de tensão, DR 30 mA, DPS, espaço reserva, cores dos condutores) · Neoenergia Coelba DIS-NOR-030 (fatores de demanda) · simbologia usual (NBR 5444) · NR-10.</p>
      <p class="rel-aviso">Documento de apoio gerado automaticamente. O projeto elétrico oficial deve ser elaborado e assinado por profissional habilitado, com ART, e conferido com as normas vigentes e a distribuidora.</p>
      <div class="rel-ass">______________________________<br>Responsável técnico · registro / ART</div>
    </div>`;
  document.body.appendChild(r);
  $('#relFechar').onclick = () => r.remove();
  $('#relPdf').onclick = () => { try { window.print(); } catch (e) { aviso('Não deu pra abrir a impressão aqui. Abra o site no Safari e tente de novo.'); } };
}
function legendaPontos() {
  const cor = '#e8eef7';
  const tri = alt => `<svg width="40" height="34"><polygon points="20,4 4,30 36,30" fill="${alt === 'al' ? cor : '#0d1626'}" stroke="${cor}" stroke-width="2"/>${alt === 'md' ? `<polygon points="20,4 4,30 20,30" fill="${cor}"/>` : ''}</svg>`;
  const circ = par => `<svg width="40" height="34"><circle cx="20" cy="17" r="9" fill="${par ? '#0d1626' : cor}" stroke="${cor}" stroke-width="2"/>${par ? `<path d="M20,8A9,9 0 0 1 20,26Z" fill="${cor}"/>` : ''}</svg>`;
  abrirModal(`<h2>Legenda dos pontos</h2>
    <table class="tab"><tr><td>${tri('bx')}</td><td>Tomada baixa · 0,30 m do piso</td></tr><tr><td>${tri('md')}</td><td>Tomada média · 1,30 m do piso</td></tr><tr><td>${tri('al')}</td><td>Tomada alta · 2,00 m do piso</td></tr>
    <tr><td><svg width="40" height="34"><polygon points="11,6 2,28 20,28" fill="#0d1626" stroke="${cor}" stroke-width="2"/><polygon points="29,6 20,28 38,28" fill="#0d1626" stroke="${cor}" stroke-width="2"/></svg></td><td>Tomada dupla (2 tomadas na mesma caixa) · vale para as 3 alturas</td></tr>
    <tr><td><svg width="40" height="34"><rect x="6" y="11" width="28" height="12" fill="#0d1626" stroke="${cor}" stroke-width="2"/><polygon points="6,11 34,11 6,23" fill="${cor}"/></svg></td><td>Quadro de distribuição (QDC) embutido</td></tr>
    <tr><td>${circ(false)}</td><td>Interruptor simples · a letra é o ponto de luz que ele acende</td></tr><tr><td>${circ(true)}</td><td>Interruptor paralelo (three-way) · comanda a mesma luz de 2 lugares</td></tr></table>
    <p class="aviso" style="margin-top:10px">Símbolos e alturas do padrão tradicional brasileiro (NBR 5444). Essa norma foi cancelada em 2014 sem substituta, mas continua sendo a mais usada em projetos residenciais; por isso todo projeto deve trazer a sua legenda. Tomada dupla conta como <b>1 ponto de tomada</b> (a NBR 5410 conta pontos, não tomadas) e entra com a carga de 1 ponto. As tomadas colocadas contam no cálculo: se você puser mais que o mínimo, a carga de TUG e os circuitos usam a quantidade colocada.</p>
    <div class="botoes"><button class="btn" id="mCanc">Fechar</button></div>`);
  $('#mCanc').onclick = fecharModal;
}

// ---------- início ----------
renderLista();
// v29: Livro de normas — mostra quais normas o app está aplicando neste projeto agora
// v38: módulo 14 — modo aprendizagem (treino com perguntas da norma e do próprio projeto)
const QUIZ_FIXO = [
  ['Qual a carga mínima de iluminação num cômodo de até 6 m²?', '100 VA', ['60 VA', '160 VA', '200 VA'], 'A NBR 5410 pede pelo menos 100 VA de iluminação em cômodo de até 6 m².'],
  ['Num cômodo com mais de 6 m², quanto se soma de iluminação?', '60 VA a cada 4 m² inteiros', ['100 VA a cada 6 m²', '60 VA a cada 5 m²', '40 VA a cada m²'], '100 VA pros primeiros 6 m² e mais 60 VA a cada 4 m² inteiros que sobram.'],
  ['Quanto vale cada uma das 3 primeiras tomadas da cozinha?', '600 VA', ['100 VA', '300 VA', '1000 VA'], 'Em cozinha, copa, área de serviço e banheiro, as 3 primeiras tomadas valem 600 VA cada; as outras, 100 VA.'],
  ['Na sala e no quarto, quantas tomadas no mínimo?', '1 a cada 5 m de perímetro', ['1 a cada 3,5 m de perímetro', '2 por cômodo, sempre', '1 a cada 10 m²'], 'Sala e dormitório: uma tomada a cada 5 m de perímetro (ou fração), bem distribuídas.'],
  ['Na cozinha, quantas tomadas no mínimo?', '1 a cada 3,5 m de perímetro', ['1 a cada 5 m de perímetro', '1 por bancada', '3 fixas'], 'Cozinha, copa e área de serviço: uma a cada 3,5 m de perímetro, com duas acima da bancada da pia.'],
  ['Qual a sensibilidade do DR para proteger pessoas?', '30 mA', ['300 mA', '10 A', '100 mA'], 'Dispositivo DR de alta sensibilidade (até 30 mA) em banheiros, cozinha, área de serviço, áreas externas e tomadas de áreas molhadas.'],
  ['Seção mínima do fio de um circuito de tomadas?', '2,5 mm²', ['1,5 mm²', '1,0 mm²', '4 mm²'], 'Tomadas (força) pedem no mínimo 2,5 mm² de cobre; iluminação, 1,5 mm².'],
  ['Seção mínima do fio de iluminação?', '1,5 mm²', ['0,75 mm²', '2,5 mm²', '1,0 mm²'], 'Circuito de iluminação: no mínimo 1,5 mm² de cobre.'],
  ['Qual a cor do condutor neutro?', 'Azul-claro', ['Verde-amarelo', 'Preto', 'Vermelho'], 'Neutro é azul-claro. Terra (PE) é verde-amarelo ou verde. Fase pode ser outras cores, como preto, vermelho ou branco.'],
  ['Qual a cor do condutor de proteção (terra)?', 'Verde-amarelo', ['Azul-claro', 'Branco', 'Cinza'], 'O terra (PE) é verde-amarelo, ou verde. Essa cor não pode ser usada em outro condutor.'],
  ['Qual a regra do disjuntor certo?', 'Ib ≤ In ≤ Iz', ['In ≤ Ib ≤ Iz', 'Iz ≤ In ≤ Ib', 'In = Iz'], 'A corrente do circuito (Ib) tem que ser menor ou igual ao disjuntor (In), e o disjuntor menor ou igual ao que o fio aguenta (Iz).'],
  ['Queda de tensão máxima nos circuitos terminais (usada no app)?', '4%', ['1%', '10%', '7%'], 'O app limita 4% do quadro ao ponto mais longe e 1% no alimentador, somando até 5% desde a entrega.'],
  ['Um aparelho de 1.500 W numa tomada comum em 127 V passa de 10 A. O que fazer?', 'Ligar como TUE, com circuito próprio', ['Usar benjamim', 'Trocar só a tomada', 'Nada, está ok'], '1500 ÷ 127 ≈ 11,8 A. Acima de 10 A o ideal é tomada de uso específico (TUE) com circuito exclusivo.'],
  ['Pela NR-10, como se trabalha na instalação?', 'Com o circuito desenergizado e bloqueado', ['Com o disjuntor ligado, com cuidado', 'Só de luva comum', 'Com o DR desligado'], 'NR-10: desenergizar, bloquear, testar a ausência de tensão e aterrar antes de mexer.'],
  ['Onde a Coelba pede o medidor (padrão de entrada)?', 'No limite do terreno com a rua', ['No meio da sala', 'Dentro da cozinha', 'Em qualquer lugar'], 'O padrão de entrada fica no muro ou na fachada, virado pra rua, com acesso livre pra leitura.'],
  ['Quantos circuitos de reserva deixar no quadro?', 'Depende do número de circuitos (a NBR 5410 dá uma tabela)', ['Nenhum', 'Sempre 1', 'Sempre 10'], 'A NBR 5410 pede espaço reserva conforme o número de circuitos: até 6 → 2; 7 a 12 → 3; 13 a 30 → 4; acima → 15%.']
];
function quizProjeto() {
  const q = [], mix = (c, e) => { const s = [...new Set(e.filter(x => x !== c))].slice(0, 3); return s.length === 3 ? s : null; };
  proj.comodos.forEach(c => {
    const l = iluminacao(c.pts).va, a = area(c.pts), e = mix(l + ' VA', [l + 60 + ' VA', Math.max(100, l - 60) + ' VA', l + 120 + ' VA', l + 100 + ' VA']);
    if (e) q.push([`${esc(c.nome)} tem ${fmt(a)} m². Qual a carga mínima de iluminação?`, l + ' VA', e, `${fmt(a)} m² → ${a <= 6 ? 'até 6 m², 100 VA' : `100 VA + 60 VA × ${Math.floor((a - 6 + 1e-9) / 4)} (cada 4 m² inteiros acima de 6) = ${l} VA`}.`]);
    const t = tug(c), e2 = mix(String(t.min), [t.min + 1, t.min + 2, Math.max(1, t.min - 1), t.min + 3].map(String));
    if (e2) q.push([`${esc(c.nome)} (${nomeTipo(c.tipo)}, ${fmt(perimetro(c.pts))} m de perímetro). Quantas tomadas no mínimo?`, String(t.min), e2, `${nomeTipo(c.tipo)}: ${t.obs} → mínimo de ${t.min}.`]);
  });
  const { lista, V } = circuitos(), D = [6, 10, 13, 16, 20, 25, 32, 40, 50, 63], S = ['1,5', '2,5', '4', '6', '10', '16'];
  lista.forEach(c => {
    const k = D.indexOf(c.inn), e = mix(c.inn + ' A', [D[k + 1], D[k - 1], D[k + 2], D[k - 2]].filter(Boolean).map(x => x + ' A'));
    if (e) q.push([`Circuito ${c.n} (${String(c.desc).replace(/<[^>]+>/g, "")}): ${c.va} VA em ${V} V. Qual disjuntor?`, c.inn + ' A', e, `Ib = ${c.va} ÷ ${V} = ${fmt(c.i, 1)} A. Escolhe o disjuntor comercial que fica acima de Ib e protege o fio (Ib ≤ In ≤ Iz): ${c.inn} A.`]);
    const s = fmt(c.sec, 1).replace(',0', ''), j = S.indexOf(s), e3 = j >= 0 && mix(s + ' mm²', [S[j + 1], S[j - 1], S[j + 2], S[j - 2]].filter(Boolean).map(x => x + ' mm²'));
    if (e3) q.push([`Circuito ${c.n} (${String(c.desc).replace(/<[^>]+>/g, "")}). Qual o fio?`, s + ' mm²', e3, `Mínimo da norma (${c.tipo === 'Iluminação' ? '1,5' : '2,5'} mm²), depois sobe até aguentar a corrente e a queda de tensão ficar ≤ 4%: ${s} mm².`]);
  });
  return q;
}
function treinar() {
  const emb = x => x.map(v => [Math.random(), v]).sort((p, q) => p[0] - q[0]).map(p => p[1]);
  const doProj = proj && proj.comodos.length ? emb(quizProjeto()).slice(0, 5) : [];
  const rod = emb([...doProj, ...emb(QUIZ_FIXO).slice(0, 10 - doProj.length)]);
  let i = 0, ok = 0;
  const tela = () => {
    if (i >= rod.length) {
      const t = banco.treino = banco.treino || { acertos: 0, total: 0 }; t.acertos += ok; t.total += rod.length; salvar();
      abrirModal(`<h2>🎓 Resultado</h2><div style="font-size:42px;text-align:center;margin:14px 0">${ok}/${rod.length}</div><div class="medidas" style="text-align:center;margin-bottom:12px">${ok >= 8 ? 'Mandou bem! 👏' : ok >= 5 ? 'Bom caminho. Revise as explicações e tente de novo.' : 'Bora revisar: o 📘 Livro de normas ajuda.'}<br>No total: ${t.acertos} acertos em ${t.total} perguntas.</div><div class="botoes"><button class="btn" id="mCanc">Fechar</button><button class="btn primario" id="qDe">🔁 Treinar de novo</button></div>`);
      $('#mCanc').onclick = fecharModal; $('#qDe').onclick = treinar; return;
    }
    const [p, c, e, ex] = rod[i], ops = emb([c, ...e]);
    abrirModal(`<h2>🎓 Modo aprendizagem · ${i + 1}/${rod.length}</h2><div style="font-size:16px;margin:8px 0 12px;line-height:1.4">${p}</div>
      ${ops.map((o, k) => `<button class="btn" data-op="${k}" style="display:block;width:100%;text-align:left;margin-bottom:8px">${o}</button>`).join('')}
      <div id="qEx" style="display:none;font-size:14px;line-height:1.45;margin:10px 0"></div>
      <div class="botoes"><button class="btn" id="mCanc">Sair</button><button class="btn primario" id="qProx" style="display:none">Próxima ›</button></div>`);
    $('#mCanc').onclick = fecharModal; $('#qProx').onclick = () => { i++; tela(); };
    document.querySelectorAll('[data-op]').forEach(b => b.onclick = () => {
      const certo = ops[+b.dataset.op] === c; if (certo) ok++;
      document.querySelectorAll('[data-op]').forEach(x => { x.disabled = true; if (ops[+x.dataset.op] === c) x.style.background = '#1f6b3a'; });
      if (!certo) b.style.background = '#7a2330';
      const qe = $('#qEx'); qe.style.display = 'block'; qe.innerHTML = `${certo ? '✅ Certo!' : `❌ A resposta é <b>${c}</b>.`}<br>📘 ${ex}`;
      $('#qProx').style.display = ''; $('#qProx').textContent = i + 1 >= rod.length ? 'Ver resultado' : 'Próxima ›';
    });
  };
  tela();
}
function livroNormas() {
  const cs = proj ? proj.comodos : [], tem = cs.length > 0;
  const pontos = cs.flatMap(c => c.pontos || []), qdc = pontos.some(q => q.k === 'qdc');
  const tomCol = pontos.some(q => q.k === 'tom'), ints = pontos.some(q => q.k === 'int' || q.k === 'par');
  const nTue = cs.reduce((s, c) => s + (c.tue || []).length, 0), molh = cs.filter(c => DR_TIPOS.includes(c.tipo));
  const it = (uso, titulo, oque, onde) => `<div style="padding:10px 0;border-bottom:1px solid var(--linha)"><div><b>${uso ? '✅' : '⚪'} ${titulo}</b></div><div style="font-size:14px;margin-top:3px">${oque}</div><div style="font-size:12px;opacity:.65;margin-top:3px">${uso ? 'Em uso agora · ' : 'Ainda não usado neste projeto · '}${onde}</div></div>`;
  const sec = (t, d, h) => `<h3 style="margin:16px 0 4px;font-size:16px">${t}</h3><div style="font-size:12px;opacity:.7">${d}</div>${h}`;
  let h = `<h2>📘 Livro de normas</h2><div style="font-size:13px;opacity:.8">O que o app está aplicando neste projeto (${esc(proj ? proj.nome : '')}), em ${tensao()} V. ✅ = sendo usado agora.</div>`;
  h += sec('ABNT NBR 5410 · Instalações elétricas de baixa tensão', 'A norma principal. O app aplica as regras com palavras próprias; o texto oficial é da ABNT.',
    it(tem, 'Iluminação mínima', '1 ponto de luz no teto por cômodo, com interruptor. 100 VA até 6 m² e +60 VA a cada 4 m² inteiros.', `${cs.length} cômodo(s) · painel do cômodo e ❓`) +
    it(tem, 'Tomadas de uso geral (TUG)', 'Quantidade mínima pelo tipo e tamanho do cômodo (perímetro ou área) e potência: 600 VA nas 3 primeiras de áreas molhadas, 100 VA nas demais.', 'painel do cômodo, tabela e ❓') +
    it(nTue > 0, 'Tomadas de uso específico (TUE)', 'Potência do aparelho (VA = W ÷ fator de potência), com circuito próprio.', `${nTue} aparelho(s)`) +
    it(tem, 'Divisão em circuitos', 'Luz separada de tomadas; tomadas de cozinha, copa e área de serviço em circuitos só delas; cada TUE com o seu.', '🔀 Circuitos') +
    it(tem, 'Fio e disjuntor (Ib ≤ In ≤ Iz)', `Corrente do circuito ≤ disjuntor ≤ o que o fio aguenta (cobre, PVC, método B1, 30 °C), com fator de agrupamento de ${fmt(fca(), 2)} (${agrup()} circuito(s) no eletroduto).`, '🔀 Circuitos') +
    it(tem, 'Seção mínima dos fios', '1,5 mm² para iluminação e 2,5 mm² para tomadas.', '🔀 Circuitos') +
    it(qdc, 'Queda de tensão', 'Até 4% do quadro ao ponto mais longe; se passar, o app aumenta o fio. No alimentador (medidor → quadro) o app usa até 1%, somando no máximo 5% a partir da entrega da Coelba.', qdc ? '🔀 Circuitos (Dist. e Queda)' : 'coloque o ▣ Quadro na planta') +
    it(molh.length > 0, 'DR 30 mA', 'Proteção diferencial nos circuitos de áreas molhadas e externas (banheiro, cozinha, área de serviço, varanda, garagem...).', molh.length ? molh.map(c => esc(c.nome)).join(', ') : 'nenhum cômodo molhado ainda') +
    it(tem, 'DPS', `Protetor de surto no quadro: classe II, In ≥ 20 kA, Uc ${tensao() === 220 ? 275 : 175} V.`, '📋 Quadro de cargas') +
    it(tem, 'Diagrama unifilar', 'Medidor → geral → DPS → DR → barramento → disjuntor e fio de cada circuito, com a reserva.', '📋 Quadro → ⚡ Unifilar') +
    it(tem, 'Espaço reserva no quadro', 'Até 6 circuitos: 2 · 7 a 12: 3 · 13 a 30: 4 · mais de 30: 15%.', '📋 Quadro de cargas') +
    it(ints || tomCol, 'Cores dos condutores', 'Neutro azul-claro, proteção (terra) verde-amarelo ou verde. Fase e retorno em outras cores.', 'Legenda dos pontos'));
  h += sec('Neoenergia Coelba · DIS-NOR-030', 'Norma da distribuidora da Bahia para fornecimento em baixa tensão.',
    it(tem, 'Fator de demanda (luz e tomadas)', 'Tabela 6 por faixa de potência instalada, para achar a demanda da casa e o disjuntor geral.', '📊 Demanda e 📋 Quadro') +
    it(!!ruaGeo(), 'Medidor no limite do terreno', 'O padrão de entrada fica no muro, virado pra rua, com acesso livre pra leitura.', ruaGeo() ? '🔌 Pontos → 🛣️ Rua e muro' : 'ligue 🛣️ Rua e muro no modo 🔌 Pontos') +
    it(false, 'Padrão de entrada e demanda por tipo de aparelho', 'Chuveiros, ar-condicionado, fornos etc. agrupados como a Coelba pede.', 'em breve (módulo 18)'));
  h += sec('Simbologia (NBR 5444)', 'Cancelada em 2014, mas ainda é o padrão usado no mercado.',
    it(tomCol || ints || qdc, 'Símbolos de tomadas, interruptores e quadro', 'Tomada baixa, média e alta; interruptor simples e paralelo; quadro de distribuição.', 'modo 🔌 Pontos · Legenda'));
  h += sec('NR-10 · Segurança em eletricidade', 'Norma do Ministério do Trabalho.',
    it(true, 'Aviso de segurança', 'O EletroMaster é ferramenta de apoio. Execução e projeto oficial exigem profissional habilitado, ART e serviço com o circuito desenergizado.', 'sempre'));
  h += `<div style="font-size:12px;opacity:.6;margin:12px 0">Confira sempre a versão vigente das normas. Projeto oficial precisa de responsável técnico.</div><button class="btn primario" id="lnTr" style="width:100%;margin-bottom:8px">🎓 Treinar (modo aprendizagem)</button><button class="btn" id="lnOk" style="width:100%">Fechar</button>`;
  abrirModal(h); $('#lnOk').onclick = fecharModal; $('#lnTr').onclick = treinar;
}
$('#btnNormas').onclick = livroNormas;
// v31: tutorial de como usar (passo a passo); abre na 1ª vez que entra no editor e pelo botão 🎓
const TUTO = [
  ['⚡', 'Bem-vindo ao EletroMaster', 'Você desenha a planta da casa e o app calcula luz, tomadas, circuitos, fios e disjuntores pela NBR 5410, explicando o porquê de cada valor.'],
  ['📁', '1. Crie um projeto', 'Na tela inicial, toque em <b>+ Novo projeto</b> e dê um nome. Tudo fica salvo sozinho no aparelho e, se entrou com Google, na nuvem.'],
  ['✎', '2. Desenhe os cômodos', 'Use <b>▭ Retângulo</b> pra um cômodo pronto, ou <b>✎ Desenhar</b> e arraste o dedo parede por parede. Feche no ponto verde. Dá pra digitar a medida de cada parede.'],
  ['☝', '3. Ajuste e dê o tipo', 'Em <b>☝ Selecionar</b>, toque no cômodo pra escolher o tipo (sala, cozinha, banheiro...) e o pé-direito. Toque numa parede pra mudar a medida ou pôr porta, porta dupla, de correr, janela, vão livre ou arco. Arraste os cantos pra mexer.'],
  ['🔌', '4. Coloque os pontos', 'No modo <b>🔌 Pontos</b>, escolha tomada (baixa, média, alta, dupla), interruptor ou <b>▣ Quadro</b> e toque perto da parede. O app avisa se faltam tomadas. Em <b>🛣️ Rua e muro</b> você desenha a rua e o medidor fica no muro.'],
  ['⚡', '5. Aparelhos (TUE)', 'No painel do cômodo, toque em <b>+ TUE</b> pra chuveiro, ar-condicionado, forno... Cada um ganha circuito próprio. O botão <b>🔁 220 V</b> troca a tensão da casa.'],
  ['📊', '6. Veja os cálculos', 'Em <b>☰ Cômodos</b> você abre <b>📊 Demanda</b>, <b>🔀 Circuitos</b> (fio, disjuntor, queda de tensão, DR), <b>📋 Quadro de cargas</b> e, dentro dele, o <b>⚡ Unifilar</b>, a <b>🧾 Lista de materiais</b> e o <b>📄 Relatório PDF</b> com tudo junto.'],
  ['❓', '7. Entenda o porquê', 'O botão <b>❓ Por que esses valores?</b> mostra o que a norma diz e a conta passo a passo. O <b>📘 Livro de normas</b> no topo mostra quais regras estão sendo usadas, e o <b>🎓 Treinar</b> faz perguntas com o seu próprio projeto.'],
  ['👁', '8. Deixe a tela limpa', 'O <b>👁</b> esconde medidas, nomes, cargas, tomadas ou portas. <b>▾ Ocultar</b> recolhe o painel, e tocar de novo no modo ativo (Selecionar, Desenhar, Pontos) fecha tudo e deixa a planta livre. <b>⤢</b> centraliza a planta, <b>↶ ↷</b> desfazem, <b>📝</b> guarda notas e <b>‹</b> volta pros projetos.'],
  ['⚠️', 'Importante', 'O EletroMaster é ferramenta de apoio. Projeto oficial precisa de profissional habilitado e ART. Bom trabalho!']
];
function tutorial(i = 0) {
  const [ic, t, d] = TUTO[i], ult = i === TUTO.length - 1;
  abrirModal(`<div style="text-align:center;font-size:42px">${ic}</div><h2 style="text-align:center">${t}</h2><div style="font-size:15px;line-height:1.5">${d}</div>
    <div style="text-align:center;margin:14px 0;font-size:12px;opacity:.6">${i + 1} de ${TUTO.length}</div>
    <div style="display:flex;gap:8px"><button class="btn" id="tuPular">${ult ? 'Fechar' : 'Pular'}</button>${i ? '<button class="btn" id="tuVoltar">‹ Voltar</button>' : ''}<button class="btn primario" id="tuProx" style="margin-left:auto">${ult ? 'Começar' : 'Próximo ›'}</button></div>`);
  const fim = () => { banco.tutorialVisto = true; salvar(); fecharModal(); };
  $('#tuPular').onclick = fim;
  if (i) $('#tuVoltar').onclick = () => tutorial(i - 1);
  $('#tuProx').onclick = () => ult ? fim() : tutorial(i + 1);
}
$('#btnTutorial').onclick = () => tutorial(0);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js?v=41').catch(() => {});

// ---------- exportar imagem (PNG) da planta ----------
function exportarImagem() {
  const svg = $('#svg'), W = svg.clientWidth, H = svg.clientHeight;
  const sel0 = sel, modo0 = modo; sel = { comodo: null, parede: null }; render(); // sem seleção na imagem
  const xml = new XMLSerializer().serializeToString(svg).replace('<svg', `<svg width="${W}" height="${H}" style="font-family:-apple-system,Helvetica,Arial,sans-serif"`);
  sel = sel0; modo = modo0; render();
  const img = new Image();
  img.onload = () => {
    const k = 2, cv = document.createElement('canvas'); cv.width = W * k; cv.height = H * k;
    const g = cv.getContext('2d'); g.fillStyle = '#0b1424'; g.fillRect(0, 0, cv.width, cv.height); g.scale(k, k); g.drawImage(img, 0, 0);
    g.fillStyle = '#8fa3bf'; g.font = '12px sans-serif'; g.fillText(`EletroMaster · ${proj.nome}`, 10, H - 10);
    cv.toBlob(async b => {
      const nome = `${proj.nome.replace(/[^\w\- ]+/g, '').trim() || 'planta'}.png`, f = new File([b], nome, { type: 'image/png' });
      try { if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: proj.nome }); return; } } catch (e) { if (e.name === 'AbortError') return; }
      const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = nome; document.body.appendChild(a); a.click(); a.remove();
      aviso('Imagem gerada.');
    }, 'image/png');
  };
  img.onerror = () => aviso('Não consegui gerar a imagem.');
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
}

// v39: bloqueia o zoom por toque duplo do iPhone (fica só o de pinça na planta)
document.addEventListener('dblclick', e => e.preventDefault(), { passive: false });
document.addEventListener('gesturestart', e => e.preventDefault(), { passive: false });
