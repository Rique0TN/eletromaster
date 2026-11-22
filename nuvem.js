/* EletroMaster — login com Google (opcional) e projetos salvos na nuvem.
 * Firebase próprio do EletroMaster (separado do site de simulados).
 * Cada projeto vira um documento em usuarios/{uid}/projetos/{idProjeto} = { dados: JSON, atualizado }.
 * Sem login (ou sem internet) tudo continua salvo só no aparelho. */
(function () {
  'use strict';
  const CFG = { apiKey: 'AIzaSyDLavs9nuI2tBXGcZdgzI-cBwpw-uaSBJM', authDomain: 'eletromaster.firebaseapp.com', projectId: 'eletromaster', storageBucket: 'eletromaster.firebasestorage.app', messagingSenderId: '534560044012', appId: '1:534560044012:web:b9ca1f2840c850c7a206c9' };
  const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/', K_LOBBY = 'eletromaster.lobby';
  let auth = null, db = null, usuario = null, pronto = false, timer = null, enviados = {}, status = '';
  const el = id => document.getElementById(id);
  const carregarJS = src => new Promise((ok, erro) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => erro(new Error(src)); document.head.appendChild(s); });
  const col = () => db.collection('usuarios').doc(usuario.uid).collection('projetos');
  const comp = () => db.collection('compart'); // v43: compartilhamento (link = só ver; e-mail na lista = pode editar)
  const novoSid = () => { const c = 'abcdefghijkmnpqrstuvwxyz23456789'; let s = ''; const r = crypto.getRandomValues(new Uint8Array(20)); r.forEach(v => s += c[v % c.length]); return s; };
  let timerComp = null;
  function dadosComp(p) { const q = JSON.parse(JSON.stringify(p)); return { nome: p.nome, dados: JSON.stringify(q), atualizado: p.atualizado || Date.now() }; }

  function renderConta() {
    const a = el('contaArea'); if (!a) return;
    if (!auth) { a.innerHTML = ''; return; }
    if (usuario) {
      const limpa = s => String(s || '').replace(/[<>&"]/g, '');
      const nomeT = limpa(usuario.displayName || usuario.email || 'Conta'), nome = nomeT.split(' ')[0], ini = (nome[0] || '?').toUpperCase();
      const foto = usuario.photoURL && /^https:\/\//.test(usuario.photoURL) ? limpa(usuario.photoURL) : '';
      const av = (t) => foto ? `<img class="avatar${t}" src="${foto}" alt="" referrerpolicy="no-referrer" onerror="this.outerHTML='<span class=&quot;avatar${t} avatar-ini&quot;>${ini}</span>'">` : `<span class="avatar${t} avatar-ini">${ini}</span>`;
      a.innerHTML = `<button class="conta-btn" id="btnConta" title="${limpa(status)}" aria-label="Minha conta">${av('')}</button>`;
      el('btnConta').onclick = () => {
        abrirModal(`<div style="text-align:center">${av(' avatar-g')}<h2 style="margin:10px 0 2px">${nomeT}</h2><button class="btn peq" id="cNome" style="margin:6px 0">✏️ Mudar nome</button><div style="font-size:14px;opacity:.7">${limpa(usuario.email)}</div>
          <div style="font-size:13px;margin:12px 0;opacity:.85">☁️ Projetos salvos na sua conta Google e neste aparelho.</div></div>
          <div style="display:flex;gap:8px"><button class="btn" id="cFechar" style="flex:1">Fechar</button><button class="btn perigo" id="btnSair" style="flex:1">Sair da conta</button></div>`);
        el('cFechar').onclick = fecharModal;
        el('cNome').onclick = () => pedirTexto('Como você quer ser chamado?', usuario.displayName || '', v => {
          v = v.trim().slice(0, 40); if (!v) return;
          usuario.updateProfile({ displayName: v }).then(() => { renderConta(); aviso('Nome atualizado'); }).catch(() => aviso('Não deu pra mudar o nome agora.'));
        });
        el('btnSair').onclick = () => confirmar('Sair da conta? Os projetos continuam neste aparelho.', () => auth.signOut(), 'Sair');
      };
      const s = el('saudacao'); if (s) { s.hidden = false; s.innerHTML = `${av(' avatar-m')}<div><div style="font-weight:700">Olá, ${nome}!</div><div style="font-size:13px;opacity:.7">Seus projetos estão salvos na nuvem.</div></div>`; }
    } else { a.innerHTML = '<button class="btn primario peq" id="btnEntrar">Entrar</button>'; el('btnEntrar').onclick = entrar; const s = el('saudacao'); if (s) s.hidden = true; }
    const n = el('avisoSalvo'); if (n) n.textContent = usuario ? 'Projetos salvos na sua conta Google e neste aparelho.' : 'Sem login: os projetos ficam salvos só neste aparelho.';
  }
  function entrar() {
    if (!auth) { aviso('Sem conexão com o login agora.'); return; }
    const p = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(p).catch(e => { if (e && (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment' || e.code === 'auth/web-storage-unsupported')) abrirNoSafari(); else if (e && e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') aviso('Não deu para entrar agora.'); });
  }

  // v39: navegador de dentro do WhatsApp/Instagram bloqueia o login do Google → pedir pra abrir no Safari
  function abrirNoSafari() {
    const url = 'https://rique0tn.github.io/eletromaster/';
    if (typeof abrirModal !== 'function') { aviso('Abra o site no Safari pra entrar com Google.'); return; }
    abrirModal(`<h2>🔐 Abra no Safari pra entrar</h2>
      <div style="font-size:15px;line-height:1.5;margin:8px 0 12px">O navegador de dentro do WhatsApp (e do Instagram) não deixa o Google fazer login. No Safari funciona.<br><br>1. Toque em <b>•••</b> ou no ícone da bússola, lá embaixo.<br>2. Escolha <b>Abrir no Safari</b> (ou <b>Abrir no navegador</b>).<br>3. Toque em <b>Entrar com Google</b> de novo.</div>
      <div class="botoes"><button class="btn" id="mCanc">Fechar</button><button class="btn primario" id="mCopLink">📋 Copiar link</button></div>`);
    document.getElementById('mCanc').onclick = fecharModal;
    document.getElementById('mCopLink').onclick = () => { try { navigator.clipboard.writeText(url).then(() => aviso('Link copiado! Cole no Safari.')); } catch (e) { aviso(url); } };
  }

  // ---------- lobby ----------
  function lobbyEscolhido() { try { return localStorage.getItem(K_LOBBY) === 'convidado'; } catch { return false; } }
  function fecharLobby() { const l = el('lobby'); if (l) l.remove(); }
  function mostrarLobby() {
    if (el('lobby') || lobbyEscolhido() || /[?&]p=/.test(location.search)) return;
    const l = document.createElement('div'); l.id = 'lobby'; l.className = 'lobby';
    l.innerHTML = `<div class="lobby-caixa"><div class="lobby-raio">⚡</div><h2>EletroMaster</h2>
      <p class="lobby-sub">Planta baixa e projeto elétrico pela NBR 5410, com o porquê de cada valor.</p>
      <button class="btn primario lobby-btn" id="lbEntrar">Entrar com Google</button>
      <p class="lobby-nota">Seus projetos ficam salvos na conta e aparecem em qualquer aparelho.</p>
      <button class="btn lobby-btn" id="lbConv">Continuar sem login</button>
      <p class="lobby-aviso">⚠️ Sem login, os projetos ficam só neste aparelho. Dá pra perder se limpar os dados do navegador ou trocar de celular.</p></div>`;
    document.body.appendChild(l);
    el('lbEntrar').onclick = entrar;
    el('lbConv').onclick = () => { try { localStorage.setItem(K_LOBBY, 'convidado'); } catch { } fecharLobby(); };
  }

  // ---------- sincronização ----------
  function enviar() {
    if (!usuario || !pronto) return;
    const lote = db.batch(); let n = 0;
    banco.projetos.forEach(p => { if (enviados[p.id] !== p.atualizado) { lote.set(col().doc(p.id), { dados: JSON.stringify(p), atualizado: p.atualizado || Date.now() }); n++; } });
    (banco.apagados || []).forEach(id => { lote.delete(col().doc(id)); n++; });
    if (!n) return;
    const marca = banco.projetos.map(p => [p.id, p.atualizado]), apag = (banco.apagados || []).slice();
    lote.commit().then(() => {
      marca.forEach(([id, t]) => enviados[id] = t);
      banco.apagados = (banco.apagados || []).filter(id => !apag.includes(id)); salvarLocal();
      status = 'Sincronizado às ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); renderConta();
    }).catch(e => { status = 'Sem conexão: salvo só no aparelho por enquanto.'; renderConta(); console.warn('sync', e && e.code); });
  }
  const salvarLocal = () => { try { localStorage.setItem(CHAVE, JSON.stringify(banco)); } catch { } };
  function sincronizarAoEntrar() {
    pronto = false; enviados = {};
    col().get().then(snap => {
      const apag = banco.apagados || []; let trouxe = 0;
      snap.forEach(d => {
        if (apag.includes(d.id)) return;
        let p; try { p = JSON.parse(d.data().dados); } catch { return; }
        const i = banco.projetos.findIndex(x => x.id === d.id);
        if (i < 0) { banco.projetos.push(p); trouxe++; }
        else if ((p.atualizado || 0) > (banco.projetos[i].atualizado || 0) && !(typeof proj !== 'undefined' && proj && proj.id === d.id)) { banco.projetos[i] = p; trouxe++; }
        if ((banco.projetos.find(x => x.id === d.id) || {}).atualizado === p.atualizado) enviados[d.id] = p.atualizado;
      });
      banco.projetos.filter(p => p.compId).forEach(p => comp().doc(p.compId).get().then(d => { if (!d.exists) return; const x = d.data(); if ((x.atualizado || 0) > (p.atualizado || 0) && !(typeof proj !== 'undefined' && proj && proj.id === p.id)) { try { const np = JSON.parse(x.dados); np.compId = p.compId; Object.assign(p, np); salvarLocal(); if (el('telaProjetos').classList.contains('ativa')) renderLista(); } catch { } } }).catch(() => { }));
      salvarLocal(); pronto = true;
      if (trouxe) { aviso(`${trouxe} projeto(s) da sua conta carregado(s).`); if (el('telaProjetos').classList.contains('ativa')) renderLista(); }
      enviar();
    }).catch(e => { status = 'Não foi possível sincronizar agora.'; renderConta(); console.warn('sync', e && e.code); });
  }

  window.EMNuvem = {
    pronto: () => !!db,
    usuario: () => usuario,
    lerComp: sid => db ? comp().doc(sid).get().then(d => d.exists ? d.data() : null) : Promise.reject(new Error('offline')),
    criarComp(p) { const sid = novoSid(); return comp().doc(sid).set({ dono: usuario.uid, donoNome: usuario.displayName || '', donoEmail: (usuario.email || '').toLowerCase(), editores: [], ...dadosComp(p) }).then(() => sid); },
    salvarComp(p, sid) { if (!usuario || !db || !sid) return; clearTimeout(timerComp); timerComp = setTimeout(() => comp().doc(sid).update(dadosComp(p)).catch(e => { console.warn('comp', e && e.code); aviso('Não consegui salvar no projeto compartilhado agora.'); }), 1500); },
    editores: (sid, lista) => comp().doc(sid).update({ editores: lista }),
    pararComp: sid => comp().doc(sid).delete(),
    criarChave(sid) { const k = novoSid(); return comp().doc(sid).collection('chaves').doc(k).set({ criado: Date.now() }).then(() => k); },
    apagarChave: (sid, k) => comp().doc(sid).collection('chaves').doc(k).delete(),
    entrarComChave: (sid, k) => comp().doc(sid).collection('entradas').doc(usuario.email).set({ chave: k, em: Date.now() }),
    listarComp: () => usuario && usuario.email ? comp().where('editores', 'array-contains', usuario.email.toLowerCase()).get().then(s => { const r = []; s.forEach(d => r.push({ sid: d.id, ...d.data() })); return r; }) : Promise.resolve([]),
    agendar() { if (!usuario || !pronto) return; clearTimeout(timer); timer = setTimeout(enviar, 1500); },
    apagado(id) { banco.apagados = [...new Set([...(banco.apagados || []), id])]; salvarLocal(); this.agendar(); },
    logado: () => !!usuario
  };

  renderConta();
  carregarJS(SDK + 'firebase-app-compat.js').then(() => carregarJS(SDK + 'firebase-auth-compat.js')).then(() => carregarJS(SDK + 'firebase-firestore-compat.js')).then(() => {
    firebase.initializeApp(CFG); auth = firebase.auth(); db = firebase.firestore();
    auth.getRedirectResult().catch(() => { });
    let linkFeito = false;
    auth.onAuthStateChanged(u => { usuario = u; status = ''; renderConta(); if (u) { fecharLobby(); sincronizarAoEntrar(); } else { pronto = false; mostrarLobby(); }
      if (!linkFeito && typeof abrirLink === 'function') { linkFeito = true; abrirLink(); }
      if (typeof renderComp === 'function') renderComp(); });
  }).catch(() => { renderConta(); });
})();
