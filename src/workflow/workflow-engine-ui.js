(function initWorkflowUI(globalScope) {
  'use strict';

  // ── Estado interno do módulo ──────────────────────────────────────────────
  const _st = {
    painelAtual: 'tarefas',
    instanciaAtual: null,
    tarefaAtual: null,
    formularioAtual: null,
    formularioCampos: [],
    formularioModelos: [],
    formularioOrigem: null,
    grupos: [],
    // Designer visual
    designerModelo: null,
    designerModo: 'simples',
    designerNoSel: null,
    designerArestaSel: null,
    designerDrag: null,
    iniciarAba: 'mapeamento',
    // Paginação
    tarefasCursor: 0,
    instanciasCursor: 0,
    tarefasLista: null,
    instanciasLista: null,
  };

  function _uid() {
    return globalScope.usuarioLogado?.uid
      || globalScope.fb?.()?.auth?.currentUser?.uid
      || null;
  }

  // ── Helpers Firestore ─────────────────────────────────────────────────────
  function _db() { return globalScope.fb().db; }

  function _col(nome) {
    const { collection } = globalScope.fb();
    return collection(_db(), nome);
  }

  function _docRef(colNome, id) {
    const { doc } = globalScope.fb();
    return doc(_db(), colNome, id);
  }

  function _wfEmHostLocal() {
    const host = String(globalScope.location?.hostname || '').toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  }

  function _wfReportarErroNaoCritico(contexto, error_) {
    const mensagem = error_?.message || String(error_ || 'Erro desconhecido');
    if (_wfEmHostLocal()) {
      globalScope.console?.warn?.(`[WF] ${contexto}: ${mensagem}`);
    }
  }

  function _wfErroConsultaOpcional(error_) {
    const mensagem = String(error_?.message || error_ || '');
    return _wfErroPermissao(error_)
      || error_?.code === 'failed-precondition'
      || /index/i.test(mensagem);
  }

  function _wfErroStorageIgnoravel(error_) {
    const mensagem = String(error_?.message || error_ || '');
    return error_?.code === 'storage/object-not-found'
      || /object-not-found/i.test(mensagem);
  }

  function _wfDevLocalAtivo() {
    const qp = new URLSearchParams(typeof globalScope.location?.search === 'string' ? globalScope.location.search : '');
    return _wfEmHostLocal() && qp.get('dev_nologin') === '1';
  }

  function _wfErroPermissao(error_) {
    const msg = String(error_?.message || error_ || '');
    return /Missing or insufficient permissions/i.test(msg) || error_?.code === 'permission-denied';
  }

  function _wfCacheKey(colNome) {
    return `siga_wf_local_${colNome}`;
  }

  function _wfPodeUsarCacheLocal(colNome) {
    return _wfDevLocalAtivo() && String(colNome || '').startsWith('wf_');
  }

  function _wfLerColecaoLocal(colNome) {
    if (!_wfPodeUsarCacheLocal(colNome)) return [];
    try {
      const raw = globalScope.localStorage?.getItem(_wfCacheKey(colNome));
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (error_) {
      _wfReportarErroNaoCritico(`falha ao ler cache local de ${colNome}`, error_);
      return [];
    }
  }

  function _wfSalvarColecaoLocal(colNome, docs) {
    if (!_wfPodeUsarCacheLocal(colNome)) return;
    try {
      globalScope.localStorage?.setItem(_wfCacheKey(colNome), JSON.stringify(Array.isArray(docs) ? docs : []));
    } catch (error_) {
      _wfReportarErroNaoCritico(`falha ao salvar cache local de ${colNome}`, error_);
    }
  }

  function _wfAplicarConstraintsLocal(docs, queryConstraints) {
    if (!Array.isArray(queryConstraints) || !queryConstraints.length) return docs;
    return docs.filter((doc) => queryConstraints.every((constraint) => {
      const field = constraint?.field;
      const op = constraint?.op;
      if (!field || op !== '==') return true;
      return doc?.[field] === constraint?.value;
    }));
  }

    let _wfLocalIdSeq = 0;

    function _wfEntropiaIdLocal() {
      const cryptoApi = globalScope.crypto;
      if (typeof cryptoApi?.randomUUID === 'function') {
        return cryptoApi.randomUUID().replaceAll('-', '').slice(0, 18);
      }
      if (typeof cryptoApi?.getRandomValues === 'function') {
        const bytes = new Uint8Array(9);
        cryptoApi.getRandomValues(bytes);
        return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
      }
      _wfLocalIdSeq += 1;
      const highRes = typeof globalScope.performance?.now === 'function'
        ? Math.floor(globalScope.performance.now() * 1000).toString(36)
        : '0';
      return `${Date.now().toString(36)}${highRes}${_wfLocalIdSeq.toString(36)}`;
    }

  function _wfNovoIdLocal(colNome) {
    const prefixo = String(colNome || 'wf').replace(/[^a-z0-9_]/gi, '').toLowerCase();
      return `${prefixo}_${_wfEntropiaIdLocal()}`;
  }

  async function _getAll(colNome, ...queryConstraints) {
    const { getDocs, query } = globalScope.fb();
    const q = queryConstraints.length
      ? query(_col(colNome), ...queryConstraints)
      : _col(colNome);
    try {
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (error_) {
      if (_wfPodeUsarCacheLocal(colNome) && _wfErroPermissao(error_)) {
        return _wfAplicarConstraintsLocal(_wfLerColecaoLocal(colNome), queryConstraints);
      }
      throw error_;
    }
  }

  async function _getDoc(colNome, id) {
    const { getDoc } = globalScope.fb();
    try {
      const snap = await getDoc(_docRef(colNome, id));
      if (!snap.exists()) return null;
      return { id: snap.id, ...snap.data() };
    } catch (error_) {
      if (_wfPodeUsarCacheLocal(colNome) && _wfErroPermissao(error_)) {
        return _wfLerColecaoLocal(colNome).find((doc) => doc?.id === id) || null;
      }
      throw error_;
    }
  }

  async function _addDoc(colNome, dados) {
    const { addDoc } = globalScope.fb();
    try {
      const ref = await addDoc(_col(colNome), { ...dados, _criado_em: new Date() });
      return ref.id;
    } catch (error_) {
      if (_wfPodeUsarCacheLocal(colNome) && _wfErroPermissao(error_)) {
        const docs = _wfLerColecaoLocal(colNome);
        const id = _wfNovoIdLocal(colNome);
        docs.push({ id, ...dados, _criado_em: new Date().toISOString() });
        _wfSalvarColecaoLocal(colNome, docs);
        return id;
      }
      throw error_;
    }
  }

  async function _updateDoc(colNome, id, dados) {
    const { updateDoc } = globalScope.fb();
    try {
      await updateDoc(_docRef(colNome, id), { ...dados, _atualizado_em: new Date() });
    } catch (error_) {
      if (_wfPodeUsarCacheLocal(colNome) && _wfErroPermissao(error_)) {
        const docs = _wfLerColecaoLocal(colNome);
        const idx = docs.findIndex((doc) => doc?.id === id);
        if (idx >= 0) {
          docs[idx] = { ...docs[idx], ...dados, _atualizado_em: new Date().toISOString() };
          _wfSalvarColecaoLocal(colNome, docs);
          return;
        }
      }
      throw error_;
    }
  }

  async function _deleteDoc(colNome, id) {
    const { deleteDoc } = globalScope.fb();
    try {
      await deleteDoc(_docRef(colNome, id));
    } catch (error_) {
      if (_wfPodeUsarCacheLocal(colNome) && _wfErroPermissao(error_)) {
        _wfSalvarColecaoLocal(colNome, _wfLerColecaoLocal(colNome).filter((doc) => doc?.id !== id));
        return;
      }
      throw error_;
    }
  }

  function _wfApiBaseUrl() {
    const explicit = String(globalScope.CONFIG?.WORKFLOW_API_BASE_URL || '').trim();
    if (explicit && explicit !== '__WORKFLOW_API_BASE_URL__') {
      let normalized = explicit;
      while (normalized.endsWith('/')) normalized = normalized.slice(0, -1);
      return normalized;
    }
    const projectId = globalScope.fb?.()?.FIREBASE_CONFIG?.projectId || 'gesproc2';
    return `https://us-central1-${projectId}.cloudfunctions.net`;
  }

  async function _wfApiRequest(functionName, path = '', options = {}) {
    const auth = globalScope.fb?.()?.auth;
    const currentUser = auth?.currentUser;
    if (!currentUser || typeof currentUser.getIdToken !== 'function') {
      throw new Error('Usuário não autenticado.');
    }

    const token = await currentUser.getIdToken();
    const url = `${_wfApiBaseUrl()}/${functionName}${path}`;
    const headers = { Authorization: `Bearer ${token}`, ...(options.headers || {}) };
    const hasBody = Object.prototype.hasOwnProperty.call(options, 'body');
    if (hasBody && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: hasBody ? JSON.stringify(options.body) : undefined,
    });

    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;
    if (!response.ok) {
      throw new Error(payload?.mensagem || payload?.erro || `Falha ao chamar ${functionName}.`);
    }
    return payload;
  }

  // ── Helpers de UI ─────────────────────────────────────────────────────────
  function _esc(v) {
    return typeof globalScope.esc === 'function'
      ? globalScope.esc(v)
      : String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function _safeUrl(url) {
    if (typeof globalScope.safeUrl === 'function') return globalScope.safeUrl(url);
    const raw = String(url ?? '');
    return /^https?:\/\//i.test(raw) ? raw : '#';
  }

  function _badge(texto, cor) {
    return `<span style="padding:2px 10px;border-radius:999px;font-size:11px;font-weight:600;background:${cor}22;color:${cor}">${_esc(texto)}</span>`;
  }

  function _slaInfo(tarefa) {
    if (!tarefa.prazo) return '';
    const prazo = tarefa.prazo?.toDate ? tarefa.prazo.toDate() : new Date(tarefa.prazo.seconds * 1000);
    const agora = new Date();
    const diff = prazo - agora;
    let cor, label;
    if (diff < 0) { cor = '#ef4444'; label = 'Vencido'; }
    else if (diff < 7200000) { cor = '#f59e0b'; label = 'Vencendo'; }
    else { cor = '#10b981'; label = 'No prazo'; }
    return `<div style="display:flex;align-items:center;gap:6px;font-size:12px;margin-top:6px">
      <div style="width:8px;height:8px;border-radius:50%;background:${cor}"></div>
      <span style="color:${cor}">${label}</span>
      <span style="color:var(--ink3)">— ${prazo.toLocaleString('pt-BR')}</span>
    </div>`;
  }

  function _card(conteudo) {
    return `<div class="card" style="padding:16px">${conteudo}</div>`;
  }

  function _renderer() {
    return globalScope.wfWorkflowRenderer || null;
  }

  // ── Navegação interna do módulo ───────────────────────────────────────────
  const _paineis = ['tarefas','instancias','solicitacoes','iniciar','executar','historico','formularios','modelagem','config-modelo','notificacoes','equipes','admin-tarefas'];

  function wfNavWorkflow(painel) {
    _st.painelAtual = painel;
    _paineis.forEach(p => {
      const el = document.getElementById(`wf-painel-${p}`);
      if (el) el.style.display = 'none';
    });
    const alvo = document.getElementById(`wf-painel-${painel}`);
    if (alvo) alvo.style.display = '';

    const tabIds = ['tarefas','instancias','solicitacoes','modelagem','formularios','equipes','admin-tarefas'];
    tabIds.forEach(t => {
      const btn = document.getElementById(`wf-tab-${t}`);
      if (btn) btn.style.fontWeight = t === painel ? '700' : '';
    });

    const carregadores = {
      tarefas: wfCarregarTarefas,
      instancias: wfCarregarInstancias,
      solicitacoes: wfCarregarSolicitacoes,
      iniciar: wfCarregarIniciar,
      formularios: wfCarregarFormularios,
      modelagem: wfCarregarModelos,
      notificacoes: _wfRenderNotifPanel,
      equipes: wfCarregarEquipes,
      'admin-tarefas': wfCarregarAdminTarefas,
    };
    carregadores[painel]?.();
  }

  // P2.1 — Badge de notificações não lidas no botão do módulo
  function _wfAplicarBadgeNotificacoes(count) {
    const btn = document.getElementById('nb-workflow');
    if (!btn) return;
    let badge = btn.querySelector('.wf-notif-badge');
    if (count > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'wf-notif-badge';
        badge.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:#ef4444;color:#fff;font-size:10px;font-weight:700;margin-left:4px;vertical-align:middle';
        btn.appendChild(badge);
      }
      badge.textContent = count > 99 ? '99+' : String(count);
      return;
    }
    badge?.remove();
  }

  async function _wfAtualizarBadgeNotificacoes(notificacoes = null) {
    const uid = _uid();
    if (!uid) {
      _st._notifCount = 0;
      _wfAplicarBadgeNotificacoes(0);
      return [];
    }
    try {
      const lista = Array.isArray(notificacoes) ? notificacoes : await _wfApiRequest('wfNotificacoes');
      const count = lista.filter((item) => !item.lida).length;
      _st._notifCount = count;
      _wfAplicarBadgeNotificacoes(count);
      return lista;
    } catch (error_) {
      _wfReportarErroNaoCritico('falha ao carregar notificacoes do workflow', error_);
      return [];
    }
  }

  function _wfIniciarBadge() {
    void _wfAtualizarBadgeNotificacoes();
  }

  async function _wfRenderNotifPanel(notificacoes = null) {
    const el = document.getElementById('wf-notif-lista');
    if (!el || _st.painelAtual !== 'notificacoes') return;
    const uid = _uid();
    if (!uid) return;
    el.innerHTML = '<div style="color:var(--ink3);font-size:14px">Carregando…</div>';
    try {
      let notifs = Array.isArray(notificacoes) ? notificacoes : await _wfApiRequest('wfNotificacoes');
      notifs.sort((a, b) => {
        const ta = a.criado_em?.seconds ?? a._criado_em?.seconds ?? 0;
        const tb = b.criado_em?.seconds ?? b._criado_em?.seconds ?? 0;
        return tb - ta;
      });
      await _wfAtualizarBadgeNotificacoes(notifs);
      if (!notifs.length) {
        el.innerHTML = '<div style="color:var(--ink3);font-size:14px;padding:16px 0">Nenhuma notificação.</div>';
        return;
      }
      const renderer = _renderer();
      el.innerHTML = renderer
        ? renderer.renderNotificacoes(notifs, _esc)
        : notifs.map(n => {
          const seconds = n.criado_em?.seconds ?? n._criado_em?.seconds ?? null;
          const ts = seconds
            ? new Date(seconds * 1000).toLocaleString('pt-BR')
            : '—';
          const bg = n.lida ? 'var(--bg)' : 'var(--blue-soft,#eff6ff)';
          return `<div style="background:${bg};border:1px solid var(--bdr);border-radius:8px;padding:12px 14px;margin-bottom:8px;cursor:pointer"
            onclick="wfMarcarNotifLida('${n.id}','${n.instancia_id || ''}','${n.titulo || ''}','${n.instancia_id || ''}')">
            <div style="font-weight:600;font-size:13px">${_esc(n.titulo || '')}</div>
            <div style="font-size:12px;color:var(--ink2);margin-top:2px">${_esc(n.mensagem || '')}</div>
            <div style="font-size:11px;color:var(--ink3);margin-top:4px">${ts}</div>
          </div>`;
        }).join('');
    } catch (e) {
      el.innerHTML = `<div style="color:#ef4444;font-size:13px">Erro: ${_esc(e.message)}</div>`;
    }
  }

  async function wfMarcarNotifLida(notifId, instanciaId, titulo, id) {
    try {
      await _wfApiRequest('wfNotificacoes', `/${encodeURIComponent(notifId)}/marcar-lida`, { method: 'POST' });
      await _wfAtualizarBadgeNotificacoes();
      if (instanciaId) wfAbrirHistorico(instanciaId, titulo || instanciaId, '');
      else wfNavWorkflow('notificacoes');
    } catch {
      wfNavWorkflow('notificacoes');
    }
  }

  function rWorkflow() {
    if (typeof globalScope.wfValidateWorkflowUIContract === 'function') {
      globalScope.wfValidateWorkflowUIContract({ strict: false });
    }
    _wfIniciarBadge();
    // Solicitante: ajusta abas e label (suporta multi-perfil via isSolicitante())
    const sol = globalScope.isSolicitante?.() || globalScope.usuarioLogado?.perfil === 'solicitante';
    document.querySelectorAll('.wf-tab-nao-solicitante').forEach(el => {
      el.style.display = sol ? 'none' : '';
    });
    const labelInstancias = document.getElementById('wf-tab-instancias-label');
    if (labelInstancias) labelInstancias.textContent = sol ? 'Minhas Solicitações' : 'Processos Ativos';
    // Solicitante começa em "Minhas Solicitações"; outros em "Minhas Tarefas"
    wfNavWorkflow(sol ? 'instancias' : (_st.painelAtual || 'tarefas'));
  }

  const _WF_PAGE = 20; // itens por página

  function _wfMensagemLista(el, mensagem) {
    if (el) el.innerHTML = `<div style="color:var(--ink3);font-size:14px">${mensagem}</div>`;
  }

  async function _wfBuscarComentarios(params = {}) {
    const qs = new URLSearchParams();
    if (params.tarefaId) qs.set('tarefa_id', params.tarefaId);
    if (params.instanciaId) qs.set('instancia_id', params.instanciaId);
    return _wfApiRequest('wfComentarios', `?${qs.toString()}`);
  }

  async function _wfCarregarMinhasTarefas(uid) {
    const { where, limit, startAfter, query, collection, getDocs } = globalScope.fb();
    const constraints = [
      where('responsavel_uid', '==', uid),
      where('status', 'in', ['pendente', 'em_execucao']),
      limit(_WF_PAGE),
    ];
    if (_st.tarefasCursor) constraints.push(startAfter(_st.tarefasCursor));
    const snap = await getDocs(query(collection(_db(), 'wf_tarefa_workflows'), ...constraints));
    _st.tarefasCursor = snap.docs[snap.docs.length - 1] || null;
    return snap;
  }

  async function _wfCarregarTarefasPorPerfil(perfil) {
    if (!perfil) return [];
    try {
      const abertas = await _getAll('wf_tarefa_workflows',
        globalScope.fb().where('papel_alvo', '==', perfil),
        globalScope.fb().where('status', 'in', ['pendente', 'em_execucao']),
      );
      return abertas.filter(t => !t.responsavel_uid);
    } catch (error_) {
      if (!_wfErroConsultaOpcional(error_)) throw error_;
      _wfReportarErroNaoCritico('consulta opcional de tarefas por perfil', error_);
      return [];
    }
  }

  async function _wfGarantirMeusGrupos(acrescentar) {
    if (_st.meusGrupos || acrescentar) return;
    try {
      const email = globalScope.usuarioLogado?.email || '';
      _st.meusGrupos = email
        ? await _getAll('wf_grupos', globalScope.fb().where('membros_email', 'array-contains', email))
        : [];
    } catch (error_) {
      _wfReportarErroNaoCritico('consulta de grupos do usuario', error_);
      _st.meusGrupos = [];
    }
  }

  async function _wfCarregarTarefasDeGrupo(acrescentar) {
    if (acrescentar) return [];
    const tarefasGrupo = [];
    for (const grupo of (_st.meusGrupos || [])) {
      try {
        const tarefas = await _getAll('wf_tarefa_workflows',
          globalScope.fb().where('grupo_id', '==', grupo.id),
          globalScope.fb().where('status', '==', 'pendente'),
        );
        tarefas.filter(t => !t.responsavel_uid).forEach((tarefa) => {
          tarefa._nomeGrupo = grupo.nome || grupo.id;
          tarefa._eFila = true;
          tarefasGrupo.push(tarefa);
        });
      } catch (error_) {
        if (!_wfErroConsultaOpcional(error_)) throw error_;
        _wfReportarErroNaoCritico(`consulta opcional de tarefas do grupo ${grupo.id}`, error_);
      }
    }
    return tarefasGrupo;
  }

  function _wfMesclarTarefas(acrescentar, el, colecoes) {
    const mapa = {};
    if (acrescentar) {
      el.querySelectorAll('[data-tarefa-id]').forEach((item) => {
        mapa[item.dataset.tarefaId] = true;
      });
    }
    colecoes.flat().forEach((tarefa) => {
      mapa[tarefa.id] = tarefa;
    });
    return Object.values(mapa).filter(tarefa => typeof tarefa === 'object');
  }

  function _wfFiltrarTarefas(tarefas) {
    const filtroStatus = document.getElementById('wf-filtro-tarefa-status')?.value || '';
    const filtroTexto = (document.getElementById('wf-filtro-tarefa-texto')?.value || '').toLowerCase();
    return tarefas.filter((tarefa) => {
      const combinaStatus = !filtroStatus || tarefa.status === filtroStatus;
      const nomeEtapa = (tarefa.etapa_nome || '').toLowerCase();
      const nomeProcesso = (tarefa.processo_nome || '').toLowerCase();
      const combinaTexto = !filtroTexto || nomeEtapa.includes(filtroTexto) || nomeProcesso.includes(filtroTexto);
      return combinaStatus && combinaTexto;
    });
  }

  function _wfRenderCardsTarefasFallback(tarefasFiltradas, podeGerenciar, statusLabels, statusCores) {
    return tarefasFiltradas.map((t) => {
      const eFila = t._eFila || (!t.responsavel_uid && !!t.grupo_id);
      const eDisponivel = !t.responsavel_uid && !t.grupo_id;
      let badgeFila = '';
      if (eFila) {
        badgeFila = `${_badge('👥 Fila: ' + (t._nomeGrupo || t.grupo_id), '#1e3a5f')} `;
      } else if (eDisponivel) {
        badgeFila = `${_badge('📋 Dispon\xEDvel', '#4b5563')} `;
      }
      const botoesAcao = (eFila || eDisponivel)
        ? `<button type="button" class="btn btn-p btn-sm" onclick="wfAssumirTarefa('${_esc(t.id)}')">Assumir</button>`
        : `<button type="button" class="btn btn-p btn-sm" onclick="wfAbrirTarefa('${_esc(t.id)}')">Abrir</button>
          <button type="button" class="btn btn-sm" onclick="wfAbrirDelegacao('${_esc(t.id)}')">Delegar</button>`;
      const slaBadge = t.sla_vencido
        ? ' <span style="background:#ef4444;color:#fff;font-size:9px;padding:1px 5px;border-radius:4px;vertical-align:middle">SLA VENCIDO</span>'
        : '';
      const etapaDescHtml = t.etapa_desc
        ? `<div style="font-size:12px;color:var(--ink2);margin-top:6px">${_esc(t.etapa_desc)}</div>`
        : '';
      const excluirHtml = podeGerenciar
        ? `<button type="button" class="btn btn-r btn-sm" onclick="wfExcluirTarefa('${_esc(t.id)}')">Excluir</button>`
        : '';
      const conteudoCard = `
        <div style="font-weight:600;font-size:14px;margin-bottom:4px">${_esc(t.etapa_nome || t.etapa_modelo_id)}${slaBadge}</div>
        <div style="font-size:12px;color:var(--ink3);margin-bottom:6px">${_esc(t.processo_nome || t.instancia_id)}</div>
        ${_badge(statusLabels[t.status] || t.status, statusCores[t.status] || '#6b7280')} ${badgeFila}
        ${_slaInfo(t)}
        ${etapaDescHtml}
        <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">
          ${botoesAcao}
          ${excluirHtml}
        </div>
      `;
      return `<div data-tarefa-id="${_esc(t.id)}">${_card(conteudoCard)}</div>`;
    }).join('');
  }

  function _wfRenderCardsTarefas(tarefasFiltradas, podeGerenciar) {
    const statusLabels = { pendente: 'Pendente', em_execucao: 'Em execução', concluida: 'Concluída', vencida: 'Vencida' };
    const statusCores = { pendente: '#3b82f6', em_execucao: '#f59e0b', concluida: '#10b981', vencida: '#ef4444' };
    const renderer = _renderer();
    if (renderer) {
      return renderer.renderTarefasCards(tarefasFiltradas, {
        esc: _esc,
        badge: _badge,
        slaInfo: _slaInfo,
        statusLabels,
        statusCores,
        podeGerenciar,
      });
    }
    return _wfRenderCardsTarefasFallback(tarefasFiltradas, podeGerenciar, statusLabels, statusCores);
  }

  // ── Tarefas ───────────────────────────────────────────────────────────────
  async function wfCarregarTarefas(acrescentar = false) {
    const el = document.getElementById('wf-lista-tarefas');
    if (!el) return;
    if (!acrescentar) {
      _wfMensagemLista(el, 'Carregando…');
      _st.tarefasCursor = 0;
      _st.tarefasLista = null;
    }
    try {
      const uid = _uid();
      if (!uid) {
        _st.tarefasLista = [];
        _wfMensagemLista(el, 'Usuário não autenticado.');
        return;
      }

      if (!_st.tarefasLista) {
        _st.tarefasLista = await _wfApiRequest('wfTarefas');
      }

      const tarefas = Array.isArray(_st.tarefasLista) ? _st.tarefasLista.slice() : [];

      if (!tarefas.length) {
        _wfMensagemLista(el, 'Nenhuma tarefa pendente.');
        return;
      }
      const perfilAtual = globalScope.usuarioLogado?.perfil;
      const podeGerenciar = perfilAtual === 'ep' || perfilAtual === 'gestor';

      const tarefasFiltradas = _wfFiltrarTarefas(tarefas);

      if (!tarefasFiltradas.length) {
        _wfMensagemLista(el, 'Nenhuma tarefa encontrada.');
        return;
      }
      const quantidade = acrescentar ? _st.tarefasCursor + _WF_PAGE : _WF_PAGE;
      _st.tarefasCursor = Math.min(quantidade, tarefasFiltradas.length);
      const tarefasVisiveis = tarefasFiltradas.slice(0, _st.tarefasCursor);
      const cards = _wfRenderCardsTarefas(tarefasVisiveis, podeGerenciar);

      const temMais = _st.tarefasCursor < tarefasFiltradas.length;
      el.innerHTML = cards + (temMais
        ? `<div style="text-align:center;margin-top:12px"><button type="button" class="btn btn-sm" onclick="wfCarregarTarefas(true)">Carregar mais</button></div>`
        : '');
    } catch (e) {
      el.innerHTML = `<div style="color:var(--red);font-size:14px">${_esc(e.message)}</div>`;
    }
  }

  async function _wfMarcarTarefaEmExecucaoSeNecessario(tarefaId, tarefa) {
    if (tarefa.status !== 'pendente') return;
    await _wfApiRequest('wfTarefas', `/${encodeURIComponent(tarefaId)}/iniciar`, { method: 'POST' });
    tarefa.status = 'em_execucao';
    if (!tarefa.responsavel_uid) {
      tarefa.responsavel_uid = _uid();
    }
  }

  function _wfPrepararTelaExecucaoTarefa(tarefa) {
    document.getElementById('wf-exec-titulo').textContent = tarefa.etapa_nome || tarefa.etapa_modelo_id;
    document.getElementById('wf-exec-obs').value = '';
    document.getElementById('wf-exec-formulario').innerHTML = '';
    const instrDiv = document.getElementById('wf-exec-instrucoes');
    if (!tarefa.etapa_desc) {
      instrDiv.style.display = 'none';
      return;
    }
    instrDiv.textContent = tarefa.etapa_desc;
    instrDiv.style.display = '';
  }

  function _wfRenderDadosAnterioresExecucao(instancia) {
    const dadosAntEl = document.getElementById('wf-exec-dados-anteriores');
    const dadosAntConteudo = document.getElementById('wf-exec-dados-anteriores-conteudo');
    const dadosEntradas = Object.entries(instancia?.dados_consolidados ?? {}).filter(([, valor]) => valor !== undefined && valor !== '');
    if (dadosEntradas.length === 0) {
      dadosAntEl.style.display = 'none';
      return;
    }
    dadosAntConteudo.innerHTML = dadosEntradas.map(([campo, valor]) =>
      `<div style="font-size:12px;margin-bottom:4px"><strong>${_esc(campo)}:</strong> ${_esc(String(valor))}</div>`
    ).join('');
    dadosAntEl.style.display = '';
  }

  function _wfHtmlProgressoExecucao(etapas, idxAtual, tarefa) {
    if (etapas.length <= 1) return '';
    const barras = etapas.map((etapa, idx) => {
      let bg = 'var(--bdr)';
      if (idx < idxAtual) bg = '#10b981';
      else if (idx === idxAtual) bg = '#3b82f6';
      return `<div style="height:4px;flex:1;border-radius:2px;background:${bg}" title="${_esc(etapa.nome)}"></div>`;
    }).join('');
    return `<div style="font-size:12px;color:var(--ink3);margin-bottom:12px">Etapa ${idxAtual + 1} de ${etapas.length}: <strong>${_esc(tarefa.etapa_nome || tarefa.etapa_modelo_id)}</strong></div>
         <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:16px">${barras}</div>`;
  }

  function _wfRenderProgressoExecucao(instancia, tarefa) {
    const etapas = instancia?.snapshot_etapas || [];
    const idxAtual = etapas.findIndex(e => e.id === tarefa.etapa_modelo_id);
    document.getElementById('wf-exec-progresso').innerHTML = _wfHtmlProgressoExecucao(etapas, idxAtual, tarefa);
  }

  function _wfRenderPapelExecucao(tarefa) {
    const papelEl = document.getElementById('wf-exec-papel');
    if (!papelEl) return;
    papelEl.innerHTML = tarefa.papel_responsavel
      ? `Seu papel: ${_badge(globalScope.WF_PAPEL_LABELS?.[tarefa.papel_responsavel] || tarefa.papel_responsavel, '#6366f1')}`
      : '';
  }

  async function _wfFormularioIdExecucaoTarefa(tarefa) {
    if (tarefa.formulario_id) return tarefa.formulario_id;
    const configProc = await _getDoc('wf_config_processo', tarefa.processo_id);
    return configProc?.etapas?.[tarefa.etapa_modelo_id]?.formulario_id || null;
  }

  async function _wfCarregarFormularioExecucaoTarefa(tarefa, formContainer) {
    try {
      const formularioId = await _wfFormularioIdExecucaoTarefa(tarefa);
      if (!formularioId) return;
      const schema = await _getDoc('wf_formulario_modelos', formularioId);
      if (!schema) return;
      if (typeof globalScope.wfRenderizarFormulario !== 'function') {
        formContainer.innerHTML = '<p class="text-danger small">Módulo de formulários não carregado. Recarregue a página ou contate o suporte.</p>';
        return;
      }
      const formEl = globalScope.wfRenderizarFormulario(schema, tarefa.dados_formulario ?? {});
      formContainer.appendChild(formEl);
      _st.tarefaAtual._campos = schema.campos ?? [];
    } catch (e) {
      console.warn('[WF] Falha ao carregar formulário da tarefa:', e?.message || e);
    }
  }

  function _wfVincularAtualizacaoAcoesExecucao(formContainer, instancia, tarefa) {
    if (!formContainer) return;
    const atualizar = () => _wfRenderAcoesExecucao(instancia, tarefa, _wfColetarDadosParciaisExecucao());
    formContainer.addEventListener('input', atualizar);
    formContainer.addEventListener('change', atualizar);
  }

  async function wfAbrirTarefa(tarefaId) {
    const tarefa = await _wfApiRequest('wfTarefas', `/${encodeURIComponent(tarefaId)}`);
    if (!tarefa) { alert('Tarefa não encontrada.'); return; }
    _st.tarefaAtual = tarefa;

    await _wfMarcarTarefaEmExecucaoSeNecessario(tarefaId, tarefa);
    _wfPrepararTelaExecucaoTarefa(tarefa);

    // Dados já coletados nas etapas anteriores
    const instancia = await _wfApiRequest('wfInstanciaItem', `/${encodeURIComponent(tarefa.instancia_id)}`);
    _wfRenderDadosAnterioresExecucao(instancia);
    _wfRenderProgressoExecucao(instancia, tarefa);
    _wfRenderPapelExecucao(tarefa);

    // Carrega formulário: do nó (tarefa.formulario_id) ou da config do processo
    const formContainer = document.getElementById('wf-exec-formulario');
    await _wfCarregarFormularioExecucaoTarefa(tarefa, formContainer);

    // Indica obrigatoriedade de parecer
    const parecerHint = document.getElementById('wf-exec-parecer-hint');
    if (parecerHint) parecerHint.style.display = tarefa.exige_parecer ? '' : 'none';

    // Botões de ação dinâmicos: variam conforme os valores atuais do formulário.
    _wfRenderAcoesExecucao(instancia, tarefa, _wfColetarDadosParciaisExecucao());
    _wfVincularAtualizacaoAcoesExecucao(formContainer, instancia, tarefa);

    // Inicializa lista de anexos (carrega os já existentes na tarefa)
    _st._anexosTarefa = (tarefa.anexos || []).slice();
    _wfRenderAnexos();

    // Carrega comentários desta etapa
    wfCancelarResposta();
    wfCarregarComentarios(tarefa.id);

    wfNavWorkflow('executar');
  }

  async function wfAssumirTarefa(tarefaId) {
    const uid = _uid();
    if (!uid) { alert('Usuário não autenticado.'); return; }
    const tarefa = await _getDoc('wf_tarefa_workflows', tarefaId);
    if (!tarefa) { alert('Tarefa não encontrada.'); return; }
    if (tarefa.responsavel_uid) { alert('Esta tarefa já foi assumida por outro usuário.'); return; }
    await _wfApiRequest('wfTarefas', `/${encodeURIComponent(tarefaId)}/assumir`, { method: 'POST' });
    _st.meusGrupos = null;
    wfCarregarTarefas();
  }

  function _wfRenderAnexos() {
    const lista = document.getElementById('wf-exec-anexos-lista');
    if (!lista) return;
    const anexos = _st._anexosTarefa || [];
    if (!anexos.length) { lista.innerHTML = '<div style="font-size:12px;color:var(--ink3)">Nenhum anexo.</div>'; return; }
    lista.innerHTML = anexos.map((a, i) => {
      const href = _safeUrl(a.url);
      return `
      <div style="display:flex;align-items:center;gap:8px;font-size:12px;padding:5px 8px;background:var(--surf2);border-radius:6px;margin-bottom:4px">
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">📎 <a href="${_esc(href)}" target="_blank" rel="noopener noreferrer" style="color:var(--blue)">${_esc(a.nome)}</a></span>
        <span style="color:var(--ink3);flex-shrink:0">${_esc(a.tamanho || '')}</span>
        <button type="button" onclick="wfRemoverAnexo(${i})" style="background:none;border:none;cursor:pointer;color:var(--ink4);font-size:13px;padding:0 2px" aria-label="Remover anexo">✕</button>
      </div>`;
    }).join('');
  }

  async function wfAnexarArquivos(input) {
    const files = Array.from(input.files || []);
    if (!files.length) return;
    const fb = globalScope.fb?.();
    if (!(fb?.storage && fb.storageRef && fb.uploadBytes && fb.getDownloadURL)) {
      alert('Armazenamento não disponível.');
      return;
    }
    const prog = document.getElementById('wf-exec-anexo-progresso');
    for (const file of files) {
      if (prog) prog.textContent = `Enviando ${file.name}…`;
      try {
        const path = `workflow/${_st.tarefaAtual.instancia_id}/${_st.tarefaAtual.id}/${Date.now()}_${file.name}`;
        const sref = fb.storageRef(fb.storage, path);
        await fb.uploadBytes(sref, file);
        const url = await fb.getDownloadURL(sref);
        const kb = file.size < 1024 * 1024
          ? Math.round(file.size / 1024) + ' KB'
          : (file.size / (1024 * 1024)).toFixed(1) + ' MB';
        _st._anexosTarefa.push({ nome: file.name, url, path, tamanho: kb });
        _wfRenderAnexos();
      } catch (e) {
        alert(`Erro ao enviar ${file.name}: ${e.message}`);
      }
    }
    if (prog) prog.textContent = '';
    input.value = '';
  }

  async function wfRemoverAnexo(idx) {
    const anexo = (_st._anexosTarefa || [])[idx];
    if (!anexo) return;
    if (!confirm(`Remover "${anexo.nome}"?`)) return;
    const fb = globalScope.fb?.();
    if (fb?.storage && fb.storageRef && fb.deleteObject && anexo.path) {
      try {
        await fb.deleteObject(fb.storageRef(fb.storage, anexo.path));
      } catch (error_) {
        if (!_wfErroStorageIgnoravel(error_)) throw error_;
        _wfReportarErroNaoCritico(`remocao de anexo inexistente ${anexo.path}`, error_);
      }
    }
    _st._anexosTarefa.splice(idx, 1);
    _wfRenderAnexos();
  }

  function proxEtapaLegado(instancia, tarefa) {
    const etapas = instancia?.snapshot_etapas || [];
    const idx = etapas.findIndex(e => e.id === tarefa.etapa_modelo_id);
    return etapas[idx + 1] || null;
  }

  function _wfColetarDadosParciaisExecucao() {
    const root = document.querySelector('#wf-exec-formulario .wf-form');
    if (!root) return {};
    const grupos = root.querySelectorAll('[data-campo-id]');
    const dados = {};
    grupos.forEach((grupo) => {
      const id = grupo.dataset.campoId;
      if (!id) return;
      const input = grupo.querySelector(`#wf-campo-${id}`);
      if (!input) return;
      dados[id] = input.type === 'checkbox' ? !!input.checked : (input.value ?? '');
    });
    return dados;
  }

  function _wfAcoesVisiveisExecucao(instancia, tarefa, dadosParciais = {}) {
    const acoesDisponiveis = tarefa.acoes_disponiveis;
    let base = ['concluir'];
    if (acoesDisponiveis?.length) {
      base = acoesDisponiveis;
    } else if (proxEtapaLegado(instancia, tarefa)) {
      base = ['avancar'];
    }
    if (!instancia?.canvas) return base;

    const arestas = (instancia.canvas.arestas || []).filter(a => a.origem === tarefa.etapa_modelo_id);
    if (!arestas.length) return base;

    const dados = { ...instancia.dados_consolidados, ...dadosParciais };
    const noAtual = (instancia.canvas?.nos || []).find(n => n.id === tarefa.etapa_modelo_id);
    const regrasAcoes = noAtual?.config?.acoes_condicionais || [];

    const passaRegraDaAcao = (acao) => {
      const regras = regrasAcoes.filter(r => r.acao === acao && r.campo);
      if (!regras.length) return null;
      return regras.some(r => _avaliarCondicaoObj({ campo: r.campo, operador: r.operador || '=', valor: r.valor }, dados));
    };

    return base.filter((acao) => {
      const passaRegra = passaRegraDaAcao(acao);
      if (passaRegra === false) return false;

      if (acao === 'devolver' || acao === 'rejeitar') {
        const regrasDaAcao = arestas.filter(a => a.acao === acao);
        if (!regrasDaAcao.length) return true;
        const padrao = regrasDaAcao.find(a => a.padrao);
        const passou = regrasDaAcao.find((aresta) => {
          if (aresta.condicoes?.length) {
            return _avaliarCondicoes(aresta.condicoes, aresta.operador_logico, dados);
          }
          return _avaliarCondicao(aresta.condicao, dados);
        });
        return !!(passou || padrao);
      }
      return !!_proximoNoExecutavel(instancia.canvas, tarefa.etapa_modelo_id, acao, dados);
    });
  }

  const _WF_ACAO_NORMALIZAR = { aprovar: 'avancar', rejeitar: 'devolver', solicitar_ajuste: 'devolver', concluir: 'avancar' };
  const _WF_ACAO_DESC = {
    avancar:  'Confirma a etapa e avança para a próxima.',
    devolver: 'Retorna à etapa anterior. Informe o que precisa ser ajustado.',
  };

  function _wfRenderAcoesExecucao(instancia, tarefa, dadosParciais) {
    const acoesEl = document.getElementById('wf-exec-acoes');
    if (!acoesEl) return;
    const acoesBruto = _wfAcoesVisiveisExecucao(instancia, tarefa, dadosParciais);
    // normaliza ações legadas para avancar/devolver, sem duplicatas
    const acoes = [...new Set(acoesBruto.map(a => _WF_ACAO_NORMALIZAR[a] || a))].filter(a => a === 'avancar' || a === 'devolver');
    if (!acoes.length) acoes.push('avancar');

    acoesEl.innerHTML = acoes.map(a => {
      const isDevolver = a === 'devolver';
      const cls = isDevolver ? 'btn' : 'btn btn-p';
      const style = isDevolver ? ' style="background:#f59e0b;color:#fff;border-color:#f59e0b"' : '';
      return `<button type="button" class="${cls}"${style} title="${_esc(_WF_ACAO_DESC[a]||'')}" onclick="wfConcluirTarefa('${a}')">${_esc(globalScope.WF_ACAO_LABELS?.[a] || a)}</button>`;
    }).join('') + `<button type="button" class="btn" onclick="wfNavWorkflow('tarefas')">Cancelar</button>`;

    // mostra/oculta campo de motivo da devolução
    let motivoEl = document.getElementById('wf-exec-motivo-devolucao');
    if (!motivoEl) {
      motivoEl = document.createElement('div');
      motivoEl.id = 'wf-exec-motivo-devolucao';
      motivoEl.style.cssText = 'display:none;margin-top:10px';
      motivoEl.innerHTML = `<label class="lbl">O que precisa ser ajustado? <span style="color:var(--red)">*</span></label><textarea id="wf-exec-motivo-devolucao-txt" class="fi" rows="3" placeholder="Descreva o que o solicitante deve corrigir ou complementar…" style="margin-top:4px;width:100%"></textarea>`;
      acoesEl.parentElement.insertBefore(motivoEl, acoesEl);
    }
    motivoEl.style.display = acoes.includes('devolver') ? '' : 'none';
  }

  function _wfValidarConclusaoTarefa(tarefa, acao, obs) {
    const exigeParecer = tarefa.exige_parecer;
    if (exigeParecer && !obs) {
      alert('É obrigatório informar um parecer/justificativa para esta ação.');
      return false;
    }
    return true;
  }

  function _wfColetarDadosConclusaoTarefa(tarefa, acao) {
    const dadosForm = {};
    const formContainer = document.querySelector('#wf-exec-formulario .wf-form');
    if (!(formContainer && _st.tarefaAtual._campos && acao !== 'rejeitar')) return dadosForm;
    const resultado = globalScope.wfColetarDadosFormulario(formContainer, _st.tarefaAtual._campos);
    if (!resultado.valido) return null;
    Object.assign(dadosForm, resultado.dados);
    return dadosForm;
  }

  async function wfConcluirTarefa(acaoOriginal) {
    if (!_st.tarefaAtual) return;
    const tarefa = _st.tarefaAtual;
    const acao = _WF_ACAO_NORMALIZAR[acaoOriginal] || acaoOriginal || tarefa.acoes_disponiveis?.[0] || 'avancar';
    const obs = (document.getElementById('wf-exec-obs')?.value || '').trim();
    const motivoDevolucao = acao === 'devolver' ? (document.getElementById('wf-exec-motivo-devolucao-txt')?.value || '').trim() : '';
    if (acao === 'devolver' && !motivoDevolucao) {
      alert('Informe o que precisa ser ajustado antes de devolver.');
      document.getElementById('wf-exec-motivo-devolucao-txt')?.focus();
      return;
    }
    if (!_wfValidarConclusaoTarefa(tarefa, acao, obs)) return;
    const dadosForm = _wfColetarDadosConclusaoTarefa(tarefa, acao);
    if (dadosForm == null) return;

    try {
      await _wfApiRequest('wfTarefas', `/${encodeURIComponent(tarefa.id)}/concluir`, {
        method: 'POST',
        body: {
          acao,
          observacao: obs,
          motivo_devolucao: motivoDevolucao || undefined,
          dados_formulario: dadosForm,
          anexos: _st._anexosTarefa || [],
        },
      });

      wfNavWorkflow('tarefas');
    } catch (e) {
      alert('Erro ao concluir tarefa: ' + e.message);
    }
  }

  async function _registrarHistorico(instanciaId, tipo, usuarioUid, etapaId, tarefaId, descricao, dados) {
    await _addDoc('wf_historico_workflows', {
      instancia_id: instanciaId,
      tipo_evento: tipo,
      usuario_uid: usuarioUid || null,
      etapa_id: etapaId || null,
      tarefa_id: tarefaId || null,
      descricao,
      dados: dados ?? {},
    });
  }

  // ── Instâncias ────────────────────────────────────────────────────────────
  async function wfCarregarInstancias(acrescentar = false) {
    const el = document.getElementById('wf-lista-instancias');
    if (!el) return;
    if (!acrescentar) {
      el.innerHTML = '<div style="color:var(--ink3);font-size:14px">Carregando…</div>';
      _st.instanciasCursor = 0;
      _st.instanciasLista = null;
    }
    try {
      const uid = _uid();
      if (!uid) {
        _st.instanciasLista = [];
        el.innerHTML = '<div style="color:var(--ink3);font-size:14px">Usuário não autenticado.</div>';
        return;
      }
      if (!_st.instanciasLista) {
        _st.instanciasLista = await _wfApiRequest('wfInstancias');
      }

      let instancias = Array.isArray(_st.instanciasLista) ? _st.instanciasLista.slice() : [];
      instancias.sort((a, b) => {
        const ta = a._criado_em?.seconds ?? (a._criado_em ? a._criado_em.getTime() / 1000 : 0);
        const tb = b._criado_em?.seconds ?? (b._criado_em ? b._criado_em.getTime() / 1000 : 0);
        return tb - ta;
      });

      // Filtro client-side
      const filtroInstStatus = document.getElementById('wf-filtro-inst-status')?.value || '';
      const filtroInstTexto = (document.getElementById('wf-filtro-inst-texto')?.value || '').toLowerCase();
      const instanciasFiltradas = instancias.filter(i => {
        if (i.excluida) return false;
        if (filtroInstStatus && i.status !== filtroInstStatus) return false;
        if (filtroInstTexto && !(i.titulo || '').toLowerCase().includes(filtroInstTexto)) return false;
        return true;
      });

      if (!instanciasFiltradas.length && !acrescentar) {
        el.innerHTML = '<div style="color:var(--ink3);font-size:14px">Nenhum processo encontrado.</div>';
        return;
      }
      const quantidade = acrescentar ? _st.instanciasCursor + _WF_PAGE : _WF_PAGE;
      _st.instanciasCursor = Math.min(quantidade, instanciasFiltradas.length);
      const instanciasVisiveis = instanciasFiltradas.slice(0, _st.instanciasCursor);
      const statusLabels = { em_andamento:'Em andamento', concluido:'Concluído', cancelado:'Cancelado', suspenso:'Suspenso' };
      const statusCores = { em_andamento:'#3b82f6', concluido:'#10b981', cancelado:'#ef4444', suspenso:'#f59e0b' };
      const podeGerenciar = globalScope.isEP?.() || globalScope.isGestor?.();
      const isEp = globalScope.isEP?.();
      const renderer = _renderer();
      const cards = renderer
        ? renderer.renderInstanciasCards(instanciasVisiveis, {
          esc: _esc,
          badge: _badge,
          podeGerenciar,
          statusLabels,
          statusCores,
        })
        : instanciasVisiveis.map(i => {
        const etapas = i.snapshot_etapas || [];
        const idxAtual = etapas.findIndex(e => e.id === i.etapa_atual_id);
        let pct = 0;
        if (etapas.length > 1 && idxAtual >= 0) {
          pct = Math.round((idxAtual / (etapas.length - 1)) * 100);
        } else if (i.status === 'concluido') {
          pct = 100;
        }
        const etapaAtualHtml = i.etapa_atual_id && i.status === 'em_andamento'
          ? `<div style="font-size:12px;color:var(--ink3);margin-bottom:6px">Etapa atual: <strong>${_esc(etapas.find(e => e.id === i.etapa_atual_id)?.nome || i.etapa_atual_id)}</strong></div>`
          : '';
        const progressoHtml = etapas.length > 1 && i.status === 'em_andamento'
          ? `
          <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:10px;align-items:center">
            ${etapas.map((e, idx) => {
              const concluida = idx < idxAtual;
              const ativa = idx === idxAtual;
              let bg = 'var(--bdr)';
              if (concluida) bg = '#10b981';
              else if (ativa) bg = '#3b82f6';
              return `<div style="height:4px;flex:1;border-radius:2px;background:${bg}" title="${_esc(e.nome)}"></div>`;
            }).join('')}
          </div>
          <div style="font-size:11px;color:var(--ink3);margin-top:4px">${pct}% concluído</div>`
          : '';
        return _card(`
          <div style="font-weight:600;font-size:14px;margin-bottom:4px">${_esc(i.titulo)}</div>
          ${etapaAtualHtml}
          ${_badge(statusLabels[i.status] || i.status, statusCores[i.status] || '#6b7280')}
          ${progressoHtml}
          <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">
            <button type="button" class="btn btn-sm" onclick="wfAbrirHistorico('${_esc(i.id)}','${_esc(i.titulo)}','${_esc(i.status)}')">Ver histórico</button>
            ${i.status === 'em_andamento' && podeGerenciar ? `<button type="button" class="btn btn-sm" onclick="wfSuspenderInstancia('${_esc(i.id)}')">Suspender</button>` : ''}
            ${i.status === 'suspenso' && podeGerenciar ? `<button type="button" class="btn btn-p btn-sm" onclick="wfRetomarInstancia('${_esc(i.id)}')">Retomar</button>` : ''}
            ${i.status === 'em_andamento' && podeGerenciar ? `<button type="button" class="btn btn-r btn-sm" onclick="wfConfirmarCancelar('${_esc(i.id)}')">Cancelar</button>` : ''}
            ${(i.status === 'cancelado' && podeGerenciar) || isEp ? `<button type="button" class="btn btn-r btn-sm" onclick="wfExcluirInstancia('${_esc(i.id)}')">🗑 Excluir</button>` : ''}
          </div>
        `);
      }).join('');

      const temMais = _st.instanciasCursor < instanciasFiltradas.length;
      const btnMais = temMais ? `<div style="text-align:center;margin-top:12px"><button type="button" class="btn btn-sm" onclick="wfCarregarInstancias(true)">Carregar mais</button></div>` : '';

      if (acrescentar) {
        const btnAnterior = el.querySelector('.wf-btn-mais');
        if (btnAnterior) btnAnterior.remove();
        el.insertAdjacentHTML('beforeend', cards + btnMais);
      } else {
        el.innerHTML = cards + btnMais;
      }
    } catch (e) {
      el.innerHTML = `<div style="color:var(--red);font-size:14px">${_esc(e.message)}</div>`;
    }
  }

  // ── Iniciar: abas (mapeamento × templates) ────────────────────────────────
  function wfIniciarAba(aba) {
    _st.iniciarAba = aba;
    const mapPane = document.getElementById('wf-iniciar-aba-mapeamento');
    const tplPane = document.getElementById('wf-iniciar-aba-templates');
    if (mapPane) mapPane.style.display = aba === 'mapeamento' ? '' : 'none';
    if (tplPane) tplPane.style.display = aba === 'templates' ? '' : 'none';
    ['mapeamento','templates'].forEach(a => {
      const b = document.getElementById(`wf-iniciar-tab-${a}`);
      if (b) b.style.fontWeight = a === aba ? '700' : '';
    });
    if (aba === 'mapeamento') wfCarregarProcessosMapeados();
    else wfCarregarTemplatesPublicados();
  }

  async function wfCarregarIniciar() {
    const sel = document.getElementById('wf-np-modelo');
    if (!sel) return;
    sel.innerHTML = '<option value="">Carregando…</option>';
    try {
      const { where } = globalScope.fb();
      const modelos = await _getAll('wf_processo_modelos', where('status', '==', 'publicado'));
      if (!modelos.length) {
        sel.innerHTML = '<option value="">Nenhum processo disponível</option>';
        return;
      }
      sel.innerHTML = '<option value="">Selecione o processo a iniciar…</option>' +
        modelos.map(m => `<option value="${_esc(m.id)}">${_esc(m.nome)}</option>`).join('');
    } catch (e) {
      _wfReportarErroNaoCritico('carregamento de processos publicados para inicio', e);
      sel.innerHTML = '<option value="">Erro ao carregar processos</option>';
    }
  }

  // Lista de templates publicados
  async function wfCarregarTemplatesPublicados() {
    const el = document.getElementById('wf-lista-templates');
    if (!el) return;
    el.innerHTML = '<div style="color:var(--ink3);font-size:14px">Carregando templates…</div>';
    try {
      const { where } = globalScope.fb();
      const modelos = await _getAll('wf_processo_modelos', where('status', '==', 'publicado'));
      if (!modelos.length) {
        el.innerHTML = '<div style="color:var(--ink3);font-size:14px">Nenhum template publicado. Importe um mapeamento e publique-o no designer.</div>';
        return;
      }
      const isEp = globalScope.isEP?.();
      el.innerHTML = modelos.map(m => {
        const nos = m.canvas?.nos || [];
        const exec = nos.filter(n => n.tipo === 'tarefa' || n.tipo === 'aprovacao');
        return _card(`
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
            <div style="flex:1">
              <div style="font-weight:600;font-size:14px;margin-bottom:4px">${_esc(m.nome)}</div>
              ${m.descricao ? `<div style="font-size:12px;color:var(--ink3);margin-bottom:4px">${_esc(m.descricao)}</div>` : ''}
              <div style="font-size:12px;color:var(--ink3)">${exec.length} etapa(s) · versão ${_esc(String(m.versao || 1))}</div>
            </div>
            <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">
              <button type="button" class="btn btn-p btn-sm" onclick="wfIniciarDeModelo('${_esc(m.id)}')">Iniciar</button>
              ${isEp ? `<button type="button" class="btn btn-sm" onclick="wfAbrirDesigner('${_esc(m.id)}')">Editar</button>` : ''}
            </div>
          </div>
        `);
      }).join('');
    } catch (e) {
      _wfReportarErroNaoCritico('carregamento de templates publicados', e);
      el.innerHTML = `<div style="color:var(--red);font-size:14px">${_esc(e.message)}</div>`;
    }
  }

  // ── Iniciar: lista processos mapeados disponíveis ─────────────────────────
  async function wfCarregarProcessosMapeados() {
    const el = document.getElementById('wf-lista-mapeamentos');
    if (!el) return;
    el.innerHTML = '<div style="color:var(--ink3);font-size:14px">Carregando processos mapeados…</div>';
    try {
      // Busca processos publicados (etapa 'acompanha' ou 'publicacao') com etapas mapeadas
      const processos = await _getAll('processos');
      const disponiveis = processos.filter(p => {
        const etapas = (p.mod?.etapas_proc_tobe || []).length
          ? p.mod.etapas_proc_tobe
          : (p.mod?.etapas_proc || []);
        // Apenas atividades executáveis (exclui eventos estruturais e comentários)
        const atividades = etapas.filter(e => !e.tipo || e.tipo === 'Atividade' || e.tipo === 'Aprovação');
        return atividades.length > 0;
      });

      if (!disponiveis.length) {
        el.innerHTML = '<div style="color:var(--ink3);font-size:14px">Nenhum processo com mapeamento disponível. Conclua o mapeamento de um processo antes de iniciar workflows.</div>';
        return;
      }

      const isEp = globalScope.isEP?.();
      el.innerHTML = disponiveis.map(p => {
        const usaToBe = (p.mod?.etapas_proc_tobe || []).length > 0;
        const etapas = usaToBe ? p.mod.etapas_proc_tobe : p.mod.etapas_proc;
        const atividades = etapas.filter(e => !e.tipo || e.tipo === 'Atividade' || e.tipo === 'Aprovação');
        return _card(`
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
            <div style="flex:1">
              <div style="font-weight:600;font-size:14px;margin-bottom:4px">${_esc(p.nome)}</div>
              ${p.area ? `<div style="font-size:12px;color:var(--ink3);margin-bottom:4px">${_esc(p.area)}</div>` : ''}
              <div style="font-size:12px;color:var(--ink3);margin-bottom:6px">${atividades.length} etapa(s) executável(is) · ${_badge(usaToBe ? 'TO BE' : 'AS IS', usaToBe ? '#10b981' : '#3b82f6')}</div>
              <div style="font-size:11px;color:var(--ink3)">${atividades.slice(0,4).map(e => _esc(e.nome)).join(' → ')}${atividades.length > 4 ? ' → …' : ''}</div>
            </div>
            <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">
              <button type="button" class="btn btn-p btn-sm" onclick="wfIniciarDeProcesso('${_esc(p.id)}')">Iniciar direto</button>
              ${isEp ? `<button type="button" class="btn btn-sm" onclick="wfImportarMapeamento('${_esc(p.id)}')">Importar e configurar</button>` : ''}
            </div>
          </div>
        `);
      }).join('');
    } catch (e) {
      el.innerHTML = `<div style="color:var(--red);font-size:14px">${_esc(e.message)}</div>`;
    }
  }

  async function wfIniciarDeProcesso(processoId) {
    const uid = _uid();
    if (!uid) { alert('Usuário não autenticado.'); return; }

    const proc = await _getDoc('processos', processoId);
    if (!proc) { alert('Processo não encontrado.'); return; }

    // Prefere TO BE, cai no AS IS
    const usaToBe = (proc.mod?.etapas_proc_tobe || []).length > 0;
    const todasEtapas = usaToBe ? proc.mod.etapas_proc_tobe : (proc.mod?.etapas_proc || []);

    // Filtra apenas atividades executáveis (exclui eventos de início/fim e comentários)
    const etapasExec = todasEtapas.filter(e => !e.tipo || e.tipo === 'Atividade' || e.tipo === 'Aprovação');

    if (!etapasExec.length) {
      alert('Este processo não possui etapas executáveis. Adicione atividades no mapeamento.');
      return;
    }

    // Carrega config do processo para SLA por etapa
    let configEtapas = {};
    try {
      const configProc = await _getDoc('wf_config_processo', processoId);
      configEtapas = configProc?.etapas ?? {};
    } catch (error_) {
      _wfReportarErroNaoCritico(`configuracao de processo ${processoId}`, error_);
    }

    // Monta snapshot das etapas com os dados do mapeamento
    const snapshotEtapas = etapasExec.map((e, i) => {
      const etapaId = `${processoId}_${e.id || i}`;
      const etapaConf = configEtapas[etapaId] ?? {};
      return {
        id: etapaId,
        nome: e.nome || `Etapa ${i + 1}`,
        tipo: e.tipo || 'Atividade',
        desc: e.desc || null,
        executor: e.executor || null,
        modo: e.modo || 'Manual',
        natureza: e.natureza || null,
        sla_horas: etapaConf.sla_horas ?? 0,
      };
    });

    const titulo = `${proc.nome} — ${new Date().toLocaleDateString('pt-BR')}`;

    try {
      await _wfApiRequest('wfInstancias', '', {
        method: 'POST',
        body: {
          processo_id: processoId,
          processo_nome: proc.nome,
          titulo,
          snapshot_etapas: snapshotEtapas,
          fluxo_origem: usaToBe ? 'tobe' : 'asis',
        },
      });

      alert(`Workflow iniciado! A primeira etapa "${snapshotEtapas[0].nome}" foi criada nas suas tarefas.`);
      wfNavWorkflow('tarefas');
    } catch (e) {
      alert('Erro ao iniciar: ' + e.message);
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // DESIGNER VISUAL DE FLUXO
  // ════════════════════════════════════════════════════════════════════════
  // instância bpmn.js do designer e config dos nós em memória
  let _wfModeler = null;
  const _wfConfigNos = {};  // { [bpmnId]: config }
  let _wfModeloAtual = null;
  let _wfDesignerDirty = false;
  let _wfAutosaveTimer = null;
  let _wfAutosaveEmCurso = false;

  function _wfLimparAutosavePendente() {
    if (_wfAutosaveTimer) {
      clearTimeout(_wfAutosaveTimer);
      _wfAutosaveTimer = null;
    }
  }

  function _wfTemAlteracoesPendentes() {
    return !!_wfDesignerDirty;
  }

  function _wfAtualizarIndicadorSujo(ativo) {
    _wfDesignerDirty = !!ativo;
    const d = document.getElementById('wf-bpmn-dirty');
    if (d) d.style.display = ativo ? 'inline' : 'none';
    const btn = document.getElementById('wf-btn-salvar-modelo');
    if (btn) {
      btn.textContent = ativo ? '💾 Salvar modelo *' : 'Salvar modelo';
      btn.style.borderColor = ativo ? 'var(--amber)' : '';
      btn.style.color = ativo ? 'var(--amber)' : '';
    }
  }

  function _wfAgendarAutosave() {
    if (!_wfModeloAtual || _wfAutosaveEmCurso) return;
    _wfLimparAutosavePendente();
    _wfAutosaveTimer = setTimeout(() => {
      _wfAutosaveTimer = null;
      if (!_wfTemAlteracoesPendentes()) return;
      wfDesignerSalvar({ silent: true, source: 'autosave' }).catch((error_) => {
        _wfReportarErroNaoCritico('falha no autosave do workflow', error_);
        if (typeof globalScope.toast === 'function') globalScope.toast('⚠ Autosave falhou: ' + (error_?.message || error_), 'var(--red)');
      });
    }, 600);
  }

  globalScope.addEventListener('beforeunload', (event) => {
    if (!_wfTemAlteracoesPendentes()) return;
    event.preventDefault();
  });

  function _bpmnTipoToWf(t) {
    if (t === 'bpmn:StartEvent') return 'inicio';
    if (t === 'bpmn:EndEvent') return 'fim';
    if (t === 'bpmn:ExclusiveGateway' || t === 'bpmn:InclusiveGateway' || t === 'bpmn:ParallelGateway') return 'aprovacao';
    return 'tarefa';
  }

  // Extrai canvas.nos + canvas.arestas do bpmn.js para uso pelo motor de execução
  function _wfSyncCanvas() {
    if (!_wfModeler) return { nos: [], arestas: [] };
    const reg = _wfModeler.get('elementRegistry');
    const els = reg.getAll();
    const nos = els
      .filter(e => e.type !== 'label' && e.type !== 'bpmn:SequenceFlow' && e.type !== 'bpmn:Process' && e.type !== 'bpmn:Collaboration' && e.type !== 'bpmn:Participant')
      .map(e => ({
        id: e.id,
        tipo: _bpmnTipoToWf(e.type),
        nome: e.businessObject?.name || e.id,
        x: e.x || 0, y: e.y || 0,
        config: _wfConfigNos[e.id] || _configPadrao(),
      }));
    const arestas = els
      .filter(e => e.type === 'bpmn:SequenceFlow')
      .map(e => {
        return {
          id: e.id,
          origem: e.source?.id,
          destino: e.target?.id,
          acao: e.businessObject?.name || 'avancar',
          label: e.businessObject?.name || 'Avançar',
          condicoes: _wfConfigNos[e.id]?.condicoes || [],
          operador_logico: _wfConfigNos[e.id]?.operador_logico || 'AND',
          padrao: _wfConfigNos[e.id]?.padrao || false,
        };
      });
    return { nos, arestas };
  }

  function _novoModeloVazio() {
    return {
      id: null,
      nome: 'Novo workflow',
      descricao: '',
      status: 'rascunho',
      versao: 1,
      processo_origem_id: null,
      fluxo_origem: null,
      bpmn_xml: _wfBpmnInicial(),
      canvas: { nos: [], arestas: [] },
    };
  }

  function _wfBpmnInicial() {
    return globalScope.BPMN_DEFAULT || `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:omgdc="http://www.omg.org/spec/DD/20100524/DC" xmlns:omgdi="http://www.omg.org/spec/DD/20100524/DI" targetNamespace="http://ep.cage">
  <process id="proc1" isExecutable="true">
    <startEvent id="start" name="Início"/>
    <endEvent id="end" name="Fim"/>
    <sequenceFlow id="f1" sourceRef="start" targetRef="end"/>
  </process>
  <bpmndi:BPMNDiagram id="d1"><bpmndi:BPMNPlane bpmnElement="proc1">
    <bpmndi:BPMNShape bpmnElement="start"><omgdc:Bounds x="160" y="200" width="36" height="36"/></bpmndi:BPMNShape>
    <bpmndi:BPMNShape bpmnElement="end"><omgdc:Bounds x="500" y="200" width="36" height="36"/></bpmndi:BPMNShape>
    <bpmndi:BPMNEdge bpmnElement="f1"><omgdi:waypoint x="196" y="218"/><omgdi:waypoint x="500" y="218"/></bpmndi:BPMNEdge>
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</definitions>`;
  }

  function _wfPrepararCamposCabecalhoDesigner(modelo) {
    const nomeEl = document.getElementById('wf-designer-nome');
    if (nomeEl) {
      nomeEl.value = modelo?.nome || '';
      nomeEl.oninput = () => _wfMarcarDesignerSujo();
    }
    const descEl = document.getElementById('wf-designer-desc');
    if (descEl) {
      descEl.value = modelo?.descricao || '';
      descEl.oninput = () => _wfMarcarDesignerSujo();
    }
  }

  function _wfConfigNosDoBpmn(bpmnXml) {
    const configNos = {};
    const matches = [...String(bpmnXml || '').matchAll(/(userTask|manualTask|serviceTask|exclusiveGateway|inclusiveGateway|parallelGateway)\s+id="([^"]+)"/g)];
    matches.forEach(([, tag, id]) => {
      const cfg = _configPadrao();
      if (tag === 'exclusiveGateway' || tag === 'inclusiveGateway') {
        cfg.acoes = ['aprovar', 'rejeitar'];
      }
      configNos[id] = cfg;
    });
    return configNos;
  }

  function _wfModeloTemDesenho(modelo) {
    return !!(
      (modelo?.bpmn_xml && String(modelo.bpmn_xml).trim())
      || (Array.isArray(modelo?.canvas?.nos) && modelo.canvas.nos.length)
      || (Array.isArray(modelo?.etapas) && modelo.etapas.length)
    );
  }

  function _wfModeloUsaFluxoInicialPadrao(modelo) {
    const bpmnAtual = String(modelo?.bpmn_xml || '').trim();
    if (!bpmnAtual) return false;
    return bpmnAtual === String(_wfBpmnInicial()).trim()
      && !(Array.isArray(modelo?.canvas?.nos) && modelo.canvas.nos.length)
      && !(Array.isArray(modelo?.etapas) && modelo.etapas.length);
  }

  function _wfDadosImportadosDoMapeamento(proc) {
    const usaToBe = (proc?.mod?.etapas_proc_tobe || []).length > 0;
    const todasEtapas = usaToBe ? proc.mod.etapas_proc_tobe : (proc?.mod?.etapas_proc || []);
    const etapasExec = todasEtapas.filter(e => !e.tipo || e.tipo === 'Atividade' || e.tipo === 'Aprovação');
    if (!etapasExec.length) return null;

    const bpmnXmlExistente = usaToBe ? (proc.mod?.bpmnToBe || null) : (proc.mod?.bpmnAsIs || null);
    let bpmnXml;
    const configNos = {};

    if (bpmnXmlExistente) {
      bpmnXml = bpmnXmlExistente;
      Object.assign(configNos, _wfConfigNosDoBpmn(bpmnXml));
    } else {
      const BW = 120, BH = 60, GAP = 50, Y = 100, startX = 60;
      const ids = etapasExec.map((_, i) => `task_${i + 1}`);
      let processXml = '    <startEvent id="start" name="Início"/>\n';
      etapasExec.forEach((e, i) => {
        const tipo = e.tipo === 'Aprovação' ? 'exclusiveGateway' : 'userTask';
        const nomeEtapa = e.nome || `Etapa ${i + 1}`;
        const nomeSeguro = nomeEtapa.replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
        processXml += `    <${tipo} id="${ids[i]}" name="${nomeSeguro}"/>\n`;
      });
      processXml += '    <endEvent id="end" name="Fim"/>\n';
      processXml += `    <sequenceFlow id="f0" sourceRef="start" targetRef="${ids[0]}"/>\n`;
      ids.forEach((id, i) => {
        processXml += `    <sequenceFlow id="f${i + 1}" sourceRef="${id}" targetRef="${ids[i + 1] || 'end'}"/>\n`;
      });
      const allIds = ['start', ...ids, 'end'];
      const startW = 36, startH = 36;
      let diShapes = '';
      allIds.forEach((id, i) => {
        const isEvent = id === 'start' || id === 'end';
        const w = isEvent ? startW : BW;
        const h = isEvent ? startH : BH;
        const x = startX + i * (BW + GAP) + (isEvent ? (BW - startW) / 2 : 0);
        const y = Y + (isEvent ? (BH - startH) / 2 : 0);
        diShapes += `      <bpmndi:BPMNShape bpmnElement="${id}"><omgdc:Bounds x="${x}" y="${y}" width="${w}" height="${h}"/></bpmndi:BPMNShape>\n`;
      });
      let diEdges = '';
      allIds.forEach((id, i) => {
        if (i === allIds.length - 1) return;
        const srcIsEvent = id === 'start' || id === 'end';
        const tgtIsEvent = allIds[i + 1] === 'start' || allIds[i + 1] === 'end';
        const sw = srcIsEvent ? startW : BW;
        const sx = startX + i * (BW + GAP) + (srcIsEvent ? (BW - startW) / 2 : 0);
        const tx = startX + (i + 1) * (BW + GAP) + (tgtIsEvent ? (BW - startW) / 2 : 0);
        diEdges += `      <bpmndi:BPMNEdge bpmnElement="f${i}"><omgdi:waypoint x="${sx + sw}" y="${Y + BH / 2}"/><omgdi:waypoint x="${tx}" y="${Y + BH / 2}"/></bpmndi:BPMNEdge>\n`;
      });
      bpmnXml = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:omgdc="http://www.omg.org/spec/DD/20100524/DC" xmlns:omgdi="http://www.omg.org/spec/DD/20100524/DI" targetNamespace="http://ep.cage">
  <process id="proc1" isExecutable="false">
${processXml}  </process>
  <bpmndi:BPMNDiagram id="d1"><bpmndi:BPMNPlane bpmnElement="proc1">
${diShapes}${diEdges}  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</definitions>`;
      ids.forEach((id, i) => {
        const cfg = _configPadrao();
        cfg.instrucoes = etapasExec[i]?.desc || '';
        cfg.acoes = etapasExec[i]?.tipo === 'Aprovação' ? ['aprovar', 'rejeitar'] : ['avancar'];
        configNos[id] = cfg;
      });
    }

    return {
      fluxo_origem: usaToBe ? 'tobe' : 'asis',
      bpmn_xml: bpmnXml,
      config_nos: configNos,
    };
  }

  // Importa um mapeamento → reutiliza BPMN XML existente (bpmnToBe ou bpmnAsIs) → abre designer
  async function wfImportarMapeamento(processoId) {
    const proc = await _getDoc('processos', processoId);
    if (!proc) { alert('Processo não encontrado.'); return; }
    const importado = _wfDadosImportadosDoMapeamento(proc);
    if (!importado) { alert('Este processo não possui etapas executáveis.'); return; }

    try {
      const id = await _addDoc('wf_processo_modelos', {
        nome: `${proc.nome} (workflow)`,
        descricao: `Importado do mapeamento ${importado.fluxo_origem === 'tobe' ? 'TO BE' : 'AS IS'} de "${proc.nome}".`,
        status: 'rascunho', versao: 1,
        processo_origem_id: processoId,
        fluxo_origem: importado.fluxo_origem,
        bpmn_xml: importado.bpmn_xml,
        config_nos: importado.config_nos,
        canvas: { nos: [], arestas: [] }, // preenchido ao salvar
        criado_por: _uid(),
      });
      await wfAbrirDesigner(id);
    } catch (e) {
      alert('Erro ao importar: ' + e.message);
    }
  }

  function _configPadrao() {
    return {
      papeis: { executor: 'solicitante', revisor: null, aprovador: null, ciente: [] },
      acoes: ['avancar'],
      formulario_id: null,
      sla_horas: 0,
      instrucoes: '',
      exige_parecer: false,
      titulo_notificacao: '',       // template — vazio = usa padrão
      mensagem_notificacao: '',     // template — vazio = usa padrão
      comentario_automatico: '',    // template — criado com autor_uid 'sistema' ao iniciar etapa
      acoes_condicionais: [],       // [{ acao, campo, operador, valor }]
      campos_condicionais: [],      // [{ campo_id, condicoes, operador_logico, acao }]
      // Para arestas (SequenceFlow):
      condicoes: [],                // [{ campo, operador, valor }]
      operador_logico: 'AND',
      padrao: false,
    };
  }

  function _wfStringOuNull(valor) {
    if (valor == null || valor === '') return null;
    const texto = String(valor).trim();
    return texto || null;
  }

  function _wfNormalizarCondicaoPersistencia(condicao) {
    return {
      campo: _wfStringOuNull(condicao?.campo),
      operador: _wfStringOuNull(condicao?.operador) || '=',
      valor: condicao?.valor ?? null,
    };
  }

  function _wfNormalizarConfigNoPersistencia(config) {
    const base = _configPadrao();
    const papeis = config?.papeis || {};
    const acoes = Array.isArray(config?.acoes) ? config.acoes.filter(Boolean) : [];
    return {
      papeis: {
        executor: _wfStringOuNull(papeis.executor) || 'solicitante',
        revisor: _wfStringOuNull(papeis.revisor),
        aprovador: _wfStringOuNull(papeis.aprovador),
        ciente: Array.isArray(papeis.ciente) ? papeis.ciente.map(_wfStringOuNull).filter(Boolean) : [],
      },
      acoes: acoes.length ? Array.from(new Set(acoes)) : base.acoes.slice(),
      formulario_id: _wfStringOuNull(config?.formulario_id),
      sla_horas: Math.max(0, Number(config?.sla_horas) || 0),
      instrucoes: String(config?.instrucoes || '').trim(),
      exige_parecer: !!config?.exige_parecer,
      titulo_notificacao: String(config?.titulo_notificacao || '').trim(),
      mensagem_notificacao: String(config?.mensagem_notificacao || '').trim(),
      comentario_automatico: String(config?.comentario_automatico || '').trim(),
      acoes_condicionais: Array.isArray(config?.acoes_condicionais)
        ? config.acoes_condicionais.map((regra) => ({
          acao: _wfStringOuNull(regra?.acao) || 'avancar',
          campo: _wfStringOuNull(regra?.campo),
          operador: _wfStringOuNull(regra?.operador) || '=',
          valor: regra?.valor ?? null,
        }))
        : [],
      campos_condicionais: Array.isArray(config?.campos_condicionais)
        ? config.campos_condicionais.map((regra) => ({
          campo_id: _wfStringOuNull(regra?.campo_id),
          operador_logico: regra?.operador_logico === 'OR' ? 'OR' : 'AND',
          acao: ['mostrar', 'ocultar', 'obrigatorio', 'opcional'].includes(regra?.acao) ? regra.acao : 'mostrar',
          condicoes: Array.isArray(regra?.condicoes)
            ? regra.condicoes.map(_wfNormalizarCondicaoPersistencia)
            : [],
        }))
        : [],
      condicoes: Array.isArray(config?.condicoes)
        ? config.condicoes.map(_wfNormalizarCondicaoPersistencia)
        : [],
      operador_logico: config?.operador_logico === 'OR' ? 'OR' : 'AND',
      padrao: !!config?.padrao,
      destino_devolucao: _wfStringOuNull(config?.destino_devolucao),
    };
  }

  function _wfNormalizarConfigNosPersistencia(configNos) {
    if (!configNos || typeof configNos !== 'object' || Array.isArray(configNos)) return {};
    return Object.fromEntries(
      Object.entries(configNos).map(([noId, config]) => [String(noId), _wfNormalizarConfigNoPersistencia(config)])
    );
  }

  function _wfNormalizarCanvasPersistencia(canvas) {
    return {
      nos: Array.isArray(canvas?.nos)
        ? canvas.nos.map((no) => ({
          id: _wfStringOuNull(no?.id),
          tipo: _wfStringOuNull(no?.tipo) || 'tarefa',
          nome: String(no?.nome || '').trim(),
          x: Number(no?.x) || 0,
          y: Number(no?.y) || 0,
          config: _wfNormalizarConfigNoPersistencia(no?.config || {}),
        })).filter((no) => no.id)
        : [],
      arestas: Array.isArray(canvas?.arestas)
        ? canvas.arestas.map((aresta) => ({
          id: _wfStringOuNull(aresta?.id),
          origem: _wfStringOuNull(aresta?.origem),
          destino: _wfStringOuNull(aresta?.destino),
          acao: _wfStringOuNull(aresta?.acao) || 'avancar',
          label: String(aresta?.label || aresta?.acao || 'Avançar').trim(),
          condicoes: Array.isArray(aresta?.condicoes)
            ? aresta.condicoes.map(_wfNormalizarCondicaoPersistencia)
            : [],
          operador_logico: aresta?.operador_logico === 'OR' ? 'OR' : 'AND',
          padrao: !!aresta?.padrao,
        })).filter((aresta) => aresta.id && aresta.origem && aresta.destino)
        : [],
    };
  }

  function _wfMontarModeloPersistencia(dadosBase) {
    return {
      nome: String(dadosBase?.nome || '').trim() || 'Novo workflow',
      descricao: String(dadosBase?.descricao || '').trim(),
      status: dadosBase?.status || 'rascunho',
      versao: Math.max(1, Number(dadosBase?.versao) || 1),
      processo_origem_id: _wfStringOuNull(dadosBase?.processo_origem_id),
      processo_origem_nome: _wfStringOuNull(dadosBase?.processo_origem_nome),
      fluxo_origem: _wfStringOuNull(dadosBase?.fluxo_origem),
      bpmn_xml: String(dadosBase?.bpmn_xml || '').trim(),
      config_nos: _wfNormalizarConfigNosPersistencia(dadosBase?.config_nos || {}),
      canvas: _wfNormalizarCanvasPersistencia(dadosBase?.canvas || { nos: [], arestas: [] }),
      criado_por: _wfStringOuNull(dadosBase?.criado_por) || _uid(),
    };
  }

  const _WF_TEMPLATE_CATALOG = [
    { id: 'vazio', nome: 'Em branco', descricao: 'Fluxo vazio para desenhar do zero.' },
    { id: 'aprovacao_binaria', nome: 'Aprovação binária', descricao: 'Sim/Não com caminho de ajuste.' },
    { id: 'triagem_prioridade', nome: 'Triagem por prioridade', descricao: 'Classifica urgente/normal e direciona.' },
    { id: 'aprovacao_com_retrabalho', nome: 'Aprovação com retrabalho', descricao: 'Inclui devolução para correção.' },
  ];

  function _wfTemplateCardHtml() {
    return _WF_TEMPLATE_CATALOG
      .map(t => `<option value="${_esc(t.id)}">${_esc(t.nome)} — ${_esc(t.descricao)}</option>`)
      .join('');
  }

  function _wfBpmnFromTemplate(templateId) {
    if (templateId === 'triagem_prioridade') {
      return `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:omgdc="http://www.omg.org/spec/DD/20100524/DC" xmlns:omgdi="http://www.omg.org/spec/DD/20100524/DI" targetNamespace="http://ep.cage">
  <process id="proc1" isExecutable="false">
    <startEvent id="start" name="Início"/>
    <userTask id="triagem" name="Triagem"/>
    <exclusiveGateway id="gw_prioridade" name="Prioridade?"/>
    <userTask id="atendimento_urgente" name="Atendimento Urgente"/>
    <userTask id="atendimento_normal" name="Atendimento Normal"/>
    <endEvent id="fim" name="Fim"/>
    <sequenceFlow id="f0" sourceRef="start" targetRef="triagem"/>
    <sequenceFlow id="f1" sourceRef="triagem" targetRef="gw_prioridade"/>
    <sequenceFlow id="f2" sourceRef="gw_prioridade" targetRef="atendimento_urgente" name="urgente"/>
    <sequenceFlow id="f3" sourceRef="gw_prioridade" targetRef="atendimento_normal" name="normal"/>
    <sequenceFlow id="f4" sourceRef="atendimento_urgente" targetRef="fim"/>
    <sequenceFlow id="f5" sourceRef="atendimento_normal" targetRef="fim"/>
  </process>
  <bpmndi:BPMNDiagram id="d1"><bpmndi:BPMNPlane bpmnElement="proc1">
    <bpmndi:BPMNShape bpmnElement="start"><omgdc:Bounds x="80" y="202" width="36" height="36"/></bpmndi:BPMNShape>
    <bpmndi:BPMNShape bpmnElement="triagem"><omgdc:Bounds x="180" y="180" width="100" height="80"/></bpmndi:BPMNShape>
    <bpmndi:BPMNShape bpmnElement="gw_prioridade" isMarkerVisible="true"><omgdc:Bounds x="350" y="195" width="50" height="50"/></bpmndi:BPMNShape>
    <bpmndi:BPMNShape bpmnElement="atendimento_urgente"><omgdc:Bounds x="470" y="100" width="100" height="80"/></bpmndi:BPMNShape>
    <bpmndi:BPMNShape bpmnElement="atendimento_normal"><omgdc:Bounds x="470" y="280" width="100" height="80"/></bpmndi:BPMNShape>
    <bpmndi:BPMNShape bpmnElement="fim"><omgdc:Bounds x="650" y="202" width="36" height="36"/></bpmndi:BPMNShape>
    <bpmndi:BPMNEdge bpmnElement="f0"><omgdi:waypoint x="116" y="220"/><omgdi:waypoint x="180" y="220"/></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge bpmnElement="f1"><omgdi:waypoint x="280" y="220"/><omgdi:waypoint x="350" y="220"/></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge bpmnElement="f2"><omgdi:waypoint x="375" y="195"/><omgdi:waypoint x="375" y="140"/><omgdi:waypoint x="470" y="140"/></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge bpmnElement="f3"><omgdi:waypoint x="375" y="245"/><omgdi:waypoint x="375" y="320"/><omgdi:waypoint x="470" y="320"/></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge bpmnElement="f4"><omgdi:waypoint x="570" y="140"/><omgdi:waypoint x="668" y="140"/><omgdi:waypoint x="668" y="202"/></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge bpmnElement="f5"><omgdi:waypoint x="570" y="320"/><omgdi:waypoint x="668" y="320"/><omgdi:waypoint x="668" y="238"/></bpmndi:BPMNEdge>
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</definitions>`;
    }
    if (templateId === 'aprovacao_com_retrabalho') {
      return `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:omgdc="http://www.omg.org/spec/DD/20100524/DC" xmlns:omgdi="http://www.omg.org/spec/DD/20100524/DI" targetNamespace="http://ep.cage">
  <process id="proc1" isExecutable="false">
    <startEvent id="start" name="Início"/>
    <userTask id="elaboracao" name="Elaboração"/>
    <userTask id="revisao" name="Revisão"/>
    <exclusiveGateway id="gw_aprovacao" name="Aprovado?"/>
    <userTask id="ajustes" name="Ajustes"/>
    <userTask id="publicacao" name="Publicação"/>
    <endEvent id="fim" name="Fim"/>
    <sequenceFlow id="f0" sourceRef="start" targetRef="elaboracao"/>
    <sequenceFlow id="f1" sourceRef="elaboracao" targetRef="revisao"/>
    <sequenceFlow id="f2" sourceRef="revisao" targetRef="gw_aprovacao"/>
    <sequenceFlow id="f3" sourceRef="gw_aprovacao" targetRef="publicacao" name="aprovar"/>
    <sequenceFlow id="f4" sourceRef="gw_aprovacao" targetRef="ajustes" name="devolver"/>
    <sequenceFlow id="f5" sourceRef="ajustes" targetRef="revisao" name="reenviar"/>
    <sequenceFlow id="f6" sourceRef="publicacao" targetRef="fim"/>
  </process>
  <bpmndi:BPMNDiagram id="d1"><bpmndi:BPMNPlane bpmnElement="proc1">
    <bpmndi:BPMNShape bpmnElement="start"><omgdc:Bounds x="80" y="202" width="36" height="36"/></bpmndi:BPMNShape>
    <bpmndi:BPMNShape bpmnElement="elaboracao"><omgdc:Bounds x="180" y="180" width="100" height="80"/></bpmndi:BPMNShape>
    <bpmndi:BPMNShape bpmnElement="revisao"><omgdc:Bounds x="350" y="180" width="100" height="80"/></bpmndi:BPMNShape>
    <bpmndi:BPMNShape bpmnElement="gw_aprovacao" isMarkerVisible="true"><omgdc:Bounds x="520" y="195" width="50" height="50"/></bpmndi:BPMNShape>
    <bpmndi:BPMNShape bpmnElement="publicacao"><omgdc:Bounds x="640" y="180" width="100" height="80"/></bpmndi:BPMNShape>
    <bpmndi:BPMNShape bpmnElement="ajustes"><omgdc:Bounds x="520" y="330" width="100" height="80"/></bpmndi:BPMNShape>
    <bpmndi:BPMNShape bpmnElement="fim"><omgdc:Bounds x="820" y="202" width="36" height="36"/></bpmndi:BPMNShape>
    <bpmndi:BPMNEdge bpmnElement="f0"><omgdi:waypoint x="116" y="220"/><omgdi:waypoint x="180" y="220"/></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge bpmnElement="f1"><omgdi:waypoint x="280" y="220"/><omgdi:waypoint x="350" y="220"/></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge bpmnElement="f2"><omgdi:waypoint x="450" y="220"/><omgdi:waypoint x="520" y="220"/></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge bpmnElement="f3"><omgdi:waypoint x="570" y="220"/><omgdi:waypoint x="640" y="220"/></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge bpmnElement="f4"><omgdi:waypoint x="545" y="245"/><omgdi:waypoint x="545" y="330"/></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge bpmnElement="f5"><omgdi:waypoint x="520" y="370"/><omgdi:waypoint x="400" y="370"/><omgdi:waypoint x="400" y="260"/></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge bpmnElement="f6"><omgdi:waypoint x="740" y="220"/><omgdi:waypoint x="820" y="220"/></bpmndi:BPMNEdge>
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</definitions>`;
    }
    return `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:omgdc="http://www.omg.org/spec/DD/20100524/DC" xmlns:omgdi="http://www.omg.org/spec/DD/20100524/DI" targetNamespace="http://ep.cage">
  <process id="proc1" isExecutable="false">
    <startEvent id="start" name="Início"/>
    <userTask id="analise" name="Análise"/>
    <exclusiveGateway id="gw_decisao" name="Aprovado?"/>
    <userTask id="finalizacao" name="Finalização"/>
    <userTask id="devolucao" name="Devolução para ajuste"/>
    <endEvent id="fim" name="Fim"/>
    <sequenceFlow id="f0" sourceRef="start" targetRef="analise"/>
    <sequenceFlow id="f1" sourceRef="analise" targetRef="gw_decisao"/>
    <sequenceFlow id="f2" sourceRef="gw_decisao" targetRef="finalizacao" name="aprovar"/>
    <sequenceFlow id="f3" sourceRef="gw_decisao" targetRef="devolucao" name="devolver"/>
    <sequenceFlow id="f4" sourceRef="finalizacao" targetRef="fim"/>
    <sequenceFlow id="f5" sourceRef="devolucao" targetRef="fim"/>
  </process>
  <bpmndi:BPMNDiagram id="d1"><bpmndi:BPMNPlane bpmnElement="proc1">
    <bpmndi:BPMNShape bpmnElement="start"><omgdc:Bounds x="80" y="202" width="36" height="36"/></bpmndi:BPMNShape>
    <bpmndi:BPMNShape bpmnElement="analise"><omgdc:Bounds x="180" y="180" width="100" height="80"/></bpmndi:BPMNShape>
    <bpmndi:BPMNShape bpmnElement="gw_decisao" isMarkerVisible="true"><omgdc:Bounds x="350" y="195" width="50" height="50"/></bpmndi:BPMNShape>
    <bpmndi:BPMNShape bpmnElement="finalizacao"><omgdc:Bounds x="470" y="100" width="100" height="80"/></bpmndi:BPMNShape>
    <bpmndi:BPMNShape bpmnElement="devolucao"><omgdc:Bounds x="470" y="280" width="100" height="80"/></bpmndi:BPMNShape>
    <bpmndi:BPMNShape bpmnElement="fim"><omgdc:Bounds x="650" y="202" width="36" height="36"/></bpmndi:BPMNShape>
    <bpmndi:BPMNEdge bpmnElement="f0"><omgdi:waypoint x="116" y="220"/><omgdi:waypoint x="180" y="220"/></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge bpmnElement="f1"><omgdi:waypoint x="280" y="220"/><omgdi:waypoint x="350" y="220"/></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge bpmnElement="f2"><omgdi:waypoint x="375" y="195"/><omgdi:waypoint x="375" y="140"/><omgdi:waypoint x="470" y="140"/></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge bpmnElement="f3"><omgdi:waypoint x="375" y="245"/><omgdi:waypoint x="375" y="320"/><omgdi:waypoint x="470" y="320"/></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge bpmnElement="f4"><omgdi:waypoint x="570" y="140"/><omgdi:waypoint x="668" y="140"/><omgdi:waypoint x="668" y="202"/></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge bpmnElement="f5"><omgdi:waypoint x="570" y="320"/><omgdi:waypoint x="668" y="320"/><omgdi:waypoint x="668" y="238"/></bpmndi:BPMNEdge>
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</definitions>`;
  }

  function _wfAjustarTemplateConfigNos(templateId, configNos) {
    if (templateId === 'aprovacao_binaria' || templateId === 'aprovacao_com_retrabalho') {
      if (configNos.gw_decisao) configNos.gw_decisao.acoes = ['aprovar', 'devolver'];
      if (configNos.gw_aprovacao) configNos.gw_aprovacao.acoes = ['aprovar', 'devolver'];
    }
    if (templateId === 'triagem_prioridade' && configNos.gw_prioridade) {
      configNos.gw_prioridade.acoes = ['avancar'];
    }
  }

  async function wfAbrirDesigner(modeloId) {
    const modelo = modeloId ? await _getDoc('wf_processo_modelos', modeloId) : _novoModeloVazio();
    if (!modelo) { alert('Modelo não encontrado.'); return; }

    _wfModeloAtual = modelo;
    // Carrega config dos nós em memória
    Object.keys(_wfConfigNos).forEach(k => delete _wfConfigNos[k]);
    Object.assign(_wfConfigNos, modelo.config_nos ?? {});

    _wfPrepararCamposCabecalhoDesigner(modelo);
    _wfLimparAutosavePendente();
    _wfAtualizarIndicadorSujo(false);

    wfAbrirConfigModelo(modelo.id);
  }

  function _wfInitModeler(modelo) {
    const loadingEl = document.getElementById('wf-bpmn-loading');
    const canvasEl = document.getElementById('wf-bpmn-canvas');

    if (typeof BpmnJS === 'undefined') {
      if (loadingEl) loadingEl.innerHTML = '<div style="text-align:center;padding:2rem"><div style="font-size:28px;margin-bottom:8px">📦</div><div style="font-size:13px;font-weight:600">Editor BPMN não disponível offline</div></div>';
      return;
    }

    if (_wfModeler) {
      try {
        _wfModeler.destroy();
      } catch (error_) {
        _wfReportarErroNaoCritico('destruicao do modeler BPMN', error_);
      }
      _wfModeler = null;
    }
    if (canvasEl) canvasEl.style.display = 'none';
    if (loadingEl) { loadingEl.style.display = ''; loadingEl.innerHTML = '<div class="spin"></div><span>Carregando editor…</span>'; }

    _wfModeler = new BpmnJS({ container: '#wf-bpmn-canvas' });

    _wfModeler.on('commandStack.changed', () => {
      // Apenas sinaliza que há alterações — NÃO agenda autosave,
      // para não interferir com operações em andamento no canvas.
      // O usuário salva manualmente ou o autosave dispara ao alterar campos de config.
      _wfAtualizarIndicadorSujo(true);
    });

    _wfModeler.on('selection.changed', ({ newSelection }) => {
      const el = newSelection.length === 1 ? newSelection[0] : null;
      _wfRenderConfigPanel(el);
    });

    const xml = (modelo?.bpmn_xml && String(modelo.bpmn_xml).trim()) ? modelo.bpmn_xml : _wfBpmnInicial();
    _wfModeler.importXML(xml).then(() => {
      if (loadingEl) loadingEl.style.display = 'none';
      if (canvasEl) canvasEl.style.display = '';
      _wfModeler.get('canvas').zoom('fit-viewport');
    }).catch(err => {
      if (loadingEl) loadingEl.innerHTML = `<div style="color:var(--red);padding:1rem;font-size:13px">Erro: ${_esc(err.message || String(err))}</div>`;
    });
  }

  function _wfTipoConfigElemento(tipo) {
    if (tipo === 'bpmn:SequenceFlow') return 'aresta';
    if (tipo === 'bpmn:ExclusiveGateway' || tipo === 'bpmn:InclusiveGateway') return 'gateway_xor';
    if (tipo === 'bpmn:ParallelGateway') return 'gateway_and';
    if (tipo === 'bpmn:StartEvent') return 'inicio';
    if (tipo === 'bpmn:EndEvent') return 'fim';
    if (tipo === 'bpmn:IntermediateCatchEvent' || tipo === 'bpmn:IntermediateThrowEvent') return 'intermediario';
    if (tipo === 'bpmn:Task' || tipo === 'bpmn:UserTask' || tipo === 'bpmn:ManualTask' || tipo === 'bpmn:ServiceTask') return 'tarefa';
    return null;
  }

  function _wfAlvoOptsPapel(sel) {
    const fixos = {
      '': '— Ninguém —',
      solicitante: 'Próprio solicitante',
      gestor_solicitante: 'Gestor do solicitante',
      gestor_executor: 'Gestor do executor anterior',
      ep: 'Perfil EP',
      gestor: 'Perfil Gestor',
      dono: 'Perfil Dono',
    };
    const fixosHtml = Object.entries(fixos).map(([valor, label]) =>
      `<option value="${valor}"${(sel || '') === valor ? ' selected' : ''}>${_esc(label)}</option>`
    ).join('');
    const grupos = _st.grupos || [];
    const gruposOptions = grupos.map(g => {
      const val = `grupo:${g.id}`;
      return `<option value="${_esc(val)}"${(sel || '') === val ? ' selected' : ''}>${_esc(g.nome || g.id)}</option>`;
    }).join('');
    const gruposHtml = grupos.length
      ? `<optgroup label="Equipe (fila)">${gruposOptions}</optgroup>`
      : '';
    return fixosHtml + gruposHtml;
  }

  function _wfFormOptsNo(cfg) {
    return '<option value="">— Sem formulário —</option>' +
      (_st.formularioModelos || []).map(m =>
        `<option value="${_esc(m.id)}"${cfg.formulario_id === m.id ? ' selected' : ''}>${_esc(m.titulo)}</option>`).join('');
  }

  function _wfRenderPainelAresta(el, painel, id) {
    if (!_wfConfigNos[id]) _wfConfigNos[id] = { condicoes: [], operador_logico: 'AND', padrao: false };
    const cfg = _wfConfigNos[id];
    const origem = _wfNoPorId(el.source?.id || el.businessObject?.sourceRef?.id || '');
    const destino = _wfNoPorId(el.target?.id || el.businessObject?.targetRef?.id || '');
    painel.innerHTML = `
      <div class="wf-guide-panel">
        <div class="wf-guide-head">
          <div>
            <div class="wf-guide-eyebrow">Regra de saída</div>
            <div class="wf-guide-title">${_esc(origem?.nome || 'Etapa')} -> ${_esc(destino?.nome || 'Destino')}</div>
            <div class="wf-guide-sub">Defina quando este caminho deve ser usado depois que a etapa anterior for respondida.</div>
          </div>
          <span class="wf-guide-badge">${cfg.padrao ? 'Saída padrão' : 'Saída condicional'}</span>
        </div>
        <div class="wf-guide-grid">
          <div class="wf-guide-card">
            <div class="wf-guide-card-hd"><div class="wf-guide-card-ttl">Quando seguir por aqui?</div></div>
            <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;margin-bottom:10px">
              <input type="checkbox" id="wf-aresta-padrao-${_esc(id)}" ${cfg.padrao ? 'checked' : ''} onchange="wfDesignerArestaPadrao('${_esc(id)}',this.checked)">
              Usar este caminho quando nenhuma outra regra for atendida
            </label>
            <div id="wf-aresta-conds-wrap-${_esc(id)}" style="${cfg.padrao ? 'opacity:.4;pointer-events:none' : ''}">
              <div class="wf-guide-row" style="margin-bottom:8px">
                <span class="wf-mini-help">As regras abaixo devem ocorrer</span>
                <select class="fi" style="width:auto;padding:2px 6px;font-size:11px" onchange="wfDesignerCampoCfg('${_esc(id)}','operador_logico',this.value)">
                  <option value="AND" ${cfg.operador_logico === 'OR' ? '' : 'selected'}>todas juntas</option>
                  <option value="OR" ${cfg.operador_logico === 'OR' ? 'selected' : ''}>qualquer uma</option>
                </select>
              </div>
              <div id="wf-aresta-conds-${_esc(id)}" style="margin-bottom:8px"></div>
              <button type="button" class="btn btn-sm" onclick="wfDesignerAddCondicao('${_esc(id)}')">+ Adicionar regra</button>
            </div>
          </div>
          <div class="wf-guide-card">
            <div class="wf-guide-card-hd"><div class="wf-guide-card-ttl">Quais respostas existem?</div></div>
            ${_wfCamposOrigemResumoHtml(id)}
          </div>
        </div>
        ${_wfPainelSalvarHtml('Salve para manter esta regra de saída vinculada ao fluxo.')}
      </div>`;
    _wfRenderCondicoes(id);
    _wfRenderAssistenteAresta(id, painel);
    _wfAplicarModoPainel();
  }

  function _wfRenderPainelGatewayXor(el, painel, id, nome) {
    if (!_wfConfigNos[id]) _wfConfigNos[id] = {};
    const tipo = el?.type || '';
    const rotasHtml = (el.outgoing || []).map((saida) => {
      const cfgSaida = _wfConfigNos[saida.id] ?? {};
      const destino = saida.target?.businessObject?.name || saida.target?.id || '?';
      let regra = 'sem regra definida';
      if (cfgSaida.padrao) regra = 'quando nenhuma outra regra bater';
      else if (cfgSaida.condicoes?.length) {
        const separador = (cfgSaida.operador_logico || 'AND') === 'OR' ? ' ou ' : ' e ';
        regra = cfgSaida.condicoes.map(_wfCondicaoLegivel).join(separador);
      }
      return `<div class="wf-route-card"><div class="wf-route-title">Vai para ${_esc(destino)}</div><div class="wf-route-sub">Seguir por este caminho ${_esc(regra)}. Clique na seta correspondente no gráfico para editar a regra.</div></div>`;
    }).join('') || '<div class="wf-guide-note">Este gateway ainda não tem saídas configuradas.</div>';
    painel.innerHTML = `
      <div class="wf-guide-panel">
        <div class="wf-guide-head">
          <div>
            <div class="wf-guide-eyebrow">Decisão do fluxo</div>
            <div class="wf-guide-title">${nome || 'Gateway de decisão'}</div>
            <div class="wf-guide-sub">Aqui você enxerga claramente para onde o fluxo vai dependendo da resposta dada na etapa anterior.</div>
          </div>
          <span class="wf-guide-badge">${tipo === 'bpmn:InclusiveGateway' ? 'Escolhe uma ou mais saídas' : 'Escolhe uma saída'}</span>
        </div>
        <div class="wf-guide-card wf-guide-card-full">
          <div class="wf-guide-card-hd"><div class="wf-guide-card-ttl">Nome da decisão</div></div>
          <input type="text" class="fi" style="margin-top:2px" value="${nome}" oninput="wfDesignerCampoCfg('${_esc(id)}','_nome',this.value)">
        </div>
        <div class="wf-guide-card wf-guide-card-full">
          <div class="wf-guide-card-hd"><div class="wf-guide-card-ttl">Caminhos possíveis</div></div>
          <div class="wf-route-list">${rotasHtml}</div>
        </div>
        <div class="wf-guide-note">A resposta é dada por quem executou a etapa anterior. As opções possíveis vêm dos campos do formulário dessa etapa.</div>
        ${_wfPainelSalvarHtml('Salve para manter o nome e as decisões deste gateway no modelo.')}
      </div>`;
    _wfRenderMapaDecisao(id, painel);
    _wfAplicarModoPainel();
  }

  function _wfRenderPainelGatewayAnd(painel, id, nome) {
    painel.innerHTML = `
      <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--ink3);margin-bottom:8px">Gateway Paralelo (AND)</div>
      <label class="lbl" style="font-size:11px">Nome / rótulo</label>
      <input type="text" class="fi" style="margin-top:2px;margin-bottom:12px" value="${nome}" oninput="wfDesignerAtualizarRotulo('${_esc(id)}',this.value)">
      <div style="font-size:12px;padding:10px;background:var(--surf2);border-radius:6px;color:var(--ink2);line-height:1.5">
        <strong>Como funciona:</strong><br>
        • <strong>Divisão (split):</strong> todas as saídas são ativadas simultaneamente.<br>
        • <strong>Junção (join):</strong> aguarda a conclusão de todos os caminhos paralelos antes de prosseguir.<br>
        Não requer configuração de condições.
      </div>`;
    _wfAplicarModoPainel();
  }

  function _wfRenderPainelInicio(painel, id, nome) {
    if (!_wfConfigNos[id]) _wfConfigNos[id] = {};
    const cfg = _wfConfigNos[id];
    painel.innerHTML = `
      <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--ink3);margin-bottom:8px">Evento de Início</div>
      <label class="lbl" style="font-size:11px">Nome</label>
      <input type="text" class="fi" style="margin-top:2px;margin-bottom:10px" value="${nome}" oninput="wfDesignerAtualizarRotulo('${_esc(id)}',this.value)">
      <label class="lbl" style="font-size:11px">Tipo de disparo</label>
      <select class="fi" style="margin-top:2px;margin-bottom:10px" onchange="wfDesignerCampoCfg('${_esc(id)}','tipo_disparo',this.value)">
        <option value="manual" ${(cfg.tipo_disparo || 'manual') === 'manual' ? 'selected' : ''}>Manual — usuário inicia pelo sistema</option>
        <option value="agendado" ${cfg.tipo_disparo === 'agendado' ? 'selected' : ''}>Agendado — trigger externo / cron</option>
        <option value="evento" ${cfg.tipo_disparo === 'evento' ? 'selected' : ''}>Evento — gerado por outro processo</option>
      </select>
      <label class="lbl" style="font-size:11px">Descrição / orientação ao solicitante</label>
      <textarea class="fi" rows="3" style="margin-top:2px;resize:vertical" placeholder="Descreva quando e como este processo deve ser iniciado…" oninput="wfDesignerCampoCfg('${_esc(id)}','descricao',this.value)">${_esc(cfg.descricao || '')}</textarea>
      ${_wfPainelSalvarHtml('Salve para manter as regras deste evento de início no modelo.')}`;
    _wfAplicarModoPainel();
  }

  function _wfRenderPainelFim(painel, id, nome) {
    if (!_wfConfigNos[id]) _wfConfigNos[id] = {};
    const cfg = _wfConfigNos[id];
    painel.innerHTML = `
      <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--ink3);margin-bottom:8px">Evento de Fim</div>
      <label class="lbl" style="font-size:11px">Nome</label>
      <input type="text" class="fi" style="margin-top:2px;margin-bottom:10px" value="${nome}" oninput="wfDesignerAtualizarRotulo('${_esc(id)}',this.value)">
      <label class="lbl" style="font-size:11px">Tipo</label>
      <select class="fi" style="margin-top:2px;margin-bottom:10px" onchange="wfDesignerCampoCfg('${_esc(id)}','tipo_fim',this.value)">
        <option value="normal" ${(cfg.tipo_fim || 'normal') === 'normal' ? 'selected' : ''}>Normal — processo concluído</option>
        <option value="cancelado" ${cfg.tipo_fim === 'cancelado' ? 'selected' : ''}>Cancelado — processo encerrado sem conclusão</option>
        <option value="erro" ${cfg.tipo_fim === 'erro' ? 'selected' : ''}>Erro — falha no processo</option>
      </select>
      <label class="lbl" style="font-size:11px">Mensagem ao solicitante (opcional)</label>
      <textarea class="fi" rows="2" style="margin-top:2px;margin-bottom:10px;resize:vertical" placeholder="Ex: Sua solicitação foi concluída com sucesso. Use {{processo.titulo}}, {{solicitante.nome}}…" oninput="wfDesignerCampoCfg('${_esc(id)}','mensagem_fim',this.value)">${_esc(cfg.mensagem_fim || '')}</textarea>
      <label class="lbl" style="font-size:11px">Notificar também (além do solicitante)</label>
      <select class="fi" style="margin-top:2px" onchange="wfDesignerCampoCfg('${_esc(id)}','notificar_fim',this.value)">
        <option value="" ${cfg.notificar_fim ? '' : 'selected'}>Somente o solicitante</option>
        <option value="ep" ${cfg.notificar_fim === 'ep' ? 'selected' : ''}>EP também</option>
        <option value="gestor" ${cfg.notificar_fim === 'gestor' ? 'selected' : ''}>Gestor também</option>
        <option value="todos" ${cfg.notificar_fim === 'todos' ? 'selected' : ''}>EP + Gestor + solicitante</option>
      </select>
      ${_wfPainelSalvarHtml('Salve para manter as mensagens e notificações deste evento de fim.')}`;
    _wfAplicarModoPainel();
  }

  function _wfRenderPainelIntermediario(painel, id, nome) {
    if (!_wfConfigNos[id]) _wfConfigNos[id] = {};
    const cfg = _wfConfigNos[id];
    painel.innerHTML = `
      <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--ink3);margin-bottom:8px">Evento Intermediário</div>
      <label class="lbl" style="font-size:11px">Nome</label>
      <input type="text" class="fi" style="margin-top:2px;margin-bottom:10px" value="${nome}" oninput="wfDesignerAtualizarRotulo('${_esc(id)}',this.value)">
      <label class="lbl" style="font-size:11px">Tipo</label>
      <select class="fi" style="margin-top:2px;margin-bottom:10px" onchange="wfDesignerCampoCfg('${_esc(id)}','tipo_evento',this.value)">
        <option value="mensagem" ${(cfg.tipo_evento || 'mensagem') === 'mensagem' ? 'selected' : ''}>Mensagem / notificação</option>
        <option value="timer" ${cfg.tipo_evento === 'timer' ? 'selected' : ''}>Timer / aguardar tempo</option>
        <option value="sinal" ${cfg.tipo_evento === 'sinal' ? 'selected' : ''}>Sinal externo</option>
      </select>
      <label class="lbl" style="font-size:11px">Descrição</label>
      <textarea class="fi" rows="2" style="margin-top:2px;resize:vertical" oninput="wfDesignerCampoCfg('${_esc(id)}','descricao',this.value)">${_esc(cfg.descricao || '')}</textarea>
      ${_wfPainelSalvarHtml('Salve para manter este evento intermediário configurado no fluxo.')}`;
    _wfAplicarModoPainel();
  }

  function _wfRenderPainelTarefa(painel, id, nome) {
    const cfg = _wfConfigNos[id] || _configPadrao();
    _wfConfigNos[id] = cfg;
    const papeis = cfg.papeis ?? {};
    const acoes = cfg.acoes ?? [];
    const formOpts = _wfFormOptsNo(cfg);
    const labelsAcao = globalScope.WF_ACAO_LABELS;
    painel.innerHTML = `
      <div class="wf-guide-panel">
        <div class="wf-guide-head">
          <div>
            <div class="wf-guide-eyebrow">Etapa do fluxo</div>
            <div class="wf-guide-title">${nome || _esc(id)}</div>
            <div class="wf-guide-sub">Defina quem executa, o prazo, o que precisa ser feito e o que acontece depois desta etapa.</div>
          </div>
          <span class="wf-guide-badge">${cfg.exige_parecer ? 'Parecer obrigatório' : 'Execução simples'}</span>
        </div>
        <div class="wf-guide-grid">
          <div class="wf-guide-card">
            <div class="wf-guide-card-hd"><div class="wf-guide-card-ttl">Quem faz esta etapa?</div></div>
            <div class="wf-guide-stack">
              <div class="wf-guide-kv"><div class="wf-guide-k">Responsável principal</div><select class="fi" style="margin-top:4px" onchange="wfDesignerPapel('${_esc(id)}','executor',this.value)">${_wfAlvoOptsPapel(papeis.executor)}</select></div>
              <div class="wf-guide-kv"><div class="wf-guide-k">Prazo</div><input type="number" class="fi" min="0" value="${_esc(String(cfg.sla_horas || 0))}" style="margin-top:4px" oninput="wfDesignerCampoCfg('${_esc(id)}','sla_horas',Number(this.value)||0)"><div class="wf-mini-help">Informe em horas úteis. Use 0 quando não houver prazo.</div></div>
            </div>
          </div>
          <div class="wf-guide-card">
            <div class="wf-guide-card-hd"><div class="wf-guide-card-ttl">O que precisa ser feito?</div></div>
            <div class="wf-guide-stack">
              <div class="wf-guide-kv"><div class="wf-guide-k">Orientação ao responsável</div><textarea class="fi" rows="4" style="resize:vertical;margin-top:4px" oninput="wfDesignerCampoCfg('${_esc(id)}','instrucoes',this.value)">${_esc(cfg.instrucoes || '')}</textarea></div>
              <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer"><input type="checkbox" ${cfg.exige_parecer ? 'checked' : ''} onchange="wfDesignerCampoCfg('${_esc(id)}','exige_parecer',this.checked)"> Exigir justificativa ou parecer nesta etapa</label>
            </div>
          </div>
          <div class="wf-guide-card wf-guide-card-full">
            <div class="wf-guide-card-hd"><div class="wf-guide-card-ttl">Quais respostas esta etapa coleta?</div></div>
            <div class="wf-guide-stack">
              <div class="wf-guide-row">
                <div style="flex:1;min-width:220px"><div class="wf-guide-k">Formulário</div><select class="fi" id="wf-designer-form-${_esc(id)}" style="margin-top:4px" onchange="wfDesignerCampoCfg('${_esc(id)}','formulario_id',this.value||null);_wfAtualizarAcoesFormularioNo('${_esc(id)}')">${formOpts}</select></div>
                <button type="button" class="btn btn-sm" onclick="wfAbrirModalNovoFormulario(null,'designer:${_esc(id)}')">+ Novo formulário</button>
                <button type="button" class="btn btn-sm" id="wf-designer-form-editar-${_esc(id)}" onclick="wfAbrirModalNovoFormulario(document.getElementById('wf-designer-form-${_esc(id)}')?.value || null,'designer:${_esc(id)}')">Editar formulário</button>
              </div>
              ${_wfCamposFormularioResumo(id)}
            </div>
          </div>
          <div class="wf-guide-card wf-guide-card-full">
            <div class="wf-guide-card-hd"><div class="wf-guide-card-ttl">O que pode acontecer depois?</div><div class="wf-guide-card-sub">Marque as ações que o usuário poderá escolher ao concluir esta etapa. Use o gateway para decidir aprovar/avançar por respostas do formulário; <strong>rejeitar</strong> e <strong>devolver</strong> retornam para a etapa anterior.</div></div>
            <div class="wf-guide-row" style="margin-bottom:10px">${[
              { v:'avancar',  desc:'Progride para a próxima etapa do fluxo.' },
              { v:'devolver', desc:'Retorna a uma etapa anterior pedindo correção ou ajuste.' },
            ].map(({v,desc}) => `<label style="display:flex;flex-direction:column;gap:2px;font-size:12px;cursor:pointer;padding:8px 12px;border:1px solid var(--bdr);border-radius:8px;background:var(--surf2);min-width:160px"><span style="display:flex;align-items:center;gap:6px"><input type="checkbox" ${acoes.includes(v) ? 'checked' : ''} onchange="wfDesignerToggleAcao('${_esc(id)}','${v}',this.checked)"> <strong>${_esc(labelsAcao?.[v] || v)}</strong></span><span style="font-size:11px;color:var(--ink3);padding-left:20px">${_esc(desc)}</span></label>`).join('')}</div>
            <div id="wf-destino-devolucao-wrap-${_esc(id)}" style="display:none"></div>
            ${_wfRotasResumoHtml(id)}
          </div>
          <div class="wf-guide-card wf-guide-card-full">
            <div class="wf-guide-card-hd"><div class="wf-guide-card-ttl">Regras desta etapa</div><div class="wf-guide-card-sub">Descreva quando cada ação aparece e quando um campo do formulário deve aparecer.</div></div>
            <div class="wf-guide-grid">
              <div class="wf-guide-card">
                <div class="wf-guide-card-hd"><div class="wf-guide-card-ttl">Quando cada botão aparece</div></div>
                <div id="wf-acoes-cond-${_esc(id)}"></div>
                <div class="wf-logic-actions"><button type="button" class="btn btn-sm" onclick="wfDesignerAddAcaoCond('${_esc(id)}')">+ Nova regra de botão</button></div>
              </div>
              <div class="wf-guide-card">
                <div class="wf-guide-card-hd"><div class="wf-guide-card-ttl">Quando um campo aparece ou fica obrigatório</div></div>
                <div id="wf-campos-cond-${_esc(id)}"></div>
                <div class="wf-logic-actions"><button type="button" class="btn btn-sm" onclick="wfDesignerAddCampoCond('${_esc(id)}')">+ Nova regra de campo</button></div>
              </div>
            </div>
          </div>
          <div class="wf-guide-card wf-guide-card-full" data-wf-advanced="true">
            <div class="wf-guide-card-hd"><div class="wf-guide-card-ttl">Configurações avançadas</div><div class="wf-guide-card-sub">Use apenas quando precisar de revisão, aprovação formal ou mensagens customizadas.</div></div>
            <div class="wf-guide-grid">
              <div class="wf-guide-card">
                <div class="wf-guide-card-hd"><div class="wf-guide-card-ttl">Papéis adicionais</div></div>
                <div class="wf-guide-kv"><div class="wf-guide-k">Revisor</div><select class="fi" style="margin-top:4px" onchange="wfDesignerPapel('${_esc(id)}','revisor',this.value)">${_wfAlvoOptsPapel(papeis.revisor)}</select></div>
                <div class="wf-guide-kv" style="margin-top:10px"><div class="wf-guide-k">Aprovador</div><select class="fi" style="margin-top:4px" onchange="wfDesignerPapel('${_esc(id)}','aprovador',this.value)">${_wfAlvoOptsPapel(papeis.aprovador)}</select></div>
              </div>
              <div class="wf-guide-card">
                <div class="wf-guide-card-hd"><div class="wf-guide-card-ttl">Mensagens automáticas</div></div>
                <div class="wf-guide-kv"><div class="wf-guide-k">Título da notificação</div><input type="text" class="fi" style="margin-top:4px" placeholder="Nova etapa: {{etapa.nome}}" value="${_esc(cfg.titulo_notificacao || '')}" oninput="wfDesignerCampoCfg('${_esc(id)}','titulo_notificacao',this.value)"></div>
                <div class="wf-guide-kv" style="margin-top:10px"><div class="wf-guide-k">Mensagem</div><textarea class="fi" rows="2" style="resize:vertical;margin-top:4px" placeholder='Processo "{{processo.titulo}}" — etapa "{{etapa.nome}}" aguarda sua ação.' oninput="wfDesignerCampoCfg('${_esc(id)}','mensagem_notificacao',this.value)">${_esc(cfg.mensagem_notificacao || '')}</textarea></div>
                <div class="wf-guide-kv" style="margin-top:10px"><div class="wf-guide-k">Comentário automático</div><textarea class="fi" rows="2" style="resize:vertical;margin-top:4px" placeholder="Ex: Etapa {{etapa.nome}} iniciada. Prazo: {{prazo}}." oninput="wfDesignerCampoCfg('${_esc(id)}','comentario_automatico',this.value)">${_esc(cfg.comentario_automatico || '')}</textarea></div>
              </div>
            </div>
          </div>
          ${_wfPainelSalvarHtml('Salve para persistir responsável, formulário, regras e mensagens desta etapa.')}
        </div>
      </div>`;
    _wfAtualizarAcoesFormularioNo(id);
    _wfRenderAcoesCond(id);
    _wfRenderCamposCond(id);
    setTimeout(() => _wfRenderDestinoDevolucao(id), 0);
    _wfAplicarModoPainel();
  }

  // — Painel de configuração do elemento selecionado —
  function _wfRenderConfigPanel(el) {
    const painel = document.getElementById('wf-designer-config');
    if (!painel) return;
    const tipoConfig = _wfTipoConfigElemento(el?.type || '');
    if (!tipoConfig) {
      painel.style.display = 'none';
      return;
    }

    painel.style.display = '';
    const id = el.id;
    const nome = _esc(el.businessObject?.name || '');
    const renderers = {
      aresta: () => _wfRenderPainelAresta(el, painel, id),
      gateway_xor: () => _wfRenderPainelGatewayXor(el, painel, id, nome),
      gateway_and: () => _wfRenderPainelGatewayAnd(painel, id, nome),
      inicio: () => _wfRenderPainelInicio(painel, id, nome),
      fim: () => _wfRenderPainelFim(painel, id, nome),
      intermediario: () => _wfRenderPainelIntermediario(painel, id, nome),
      tarefa: () => _wfRenderPainelTarefa(painel, id, nome),
    };
    renderers[tipoConfig]?.();
  }

  function wfDesignerSetMode(modo) {
    _st.designerModo = modo === 'avancado' ? 'avancado' : 'simples';
    const badge = document.getElementById('wf-designer-mode-badge');
    if (badge) badge.textContent = _st.designerModo === 'avancado' ? 'Modo avançado' : 'Modo simples';
    _wfAplicarModoPainel();
    try {
      if (_wfModeler && _st.designerNoSel) {
        const reg = _wfModeler.get('elementRegistry');
        const el = reg?.get(_st.designerNoSel);
        if (el) _wfRenderConfigPanel(el);
      }
      if (_wfModeler && _st.designerArestaSel) {
        const reg = _wfModeler.get('elementRegistry');
        const el = reg?.get(_st.designerArestaSel);
        if (el) _wfRenderConfigPanel(el);
      }
    } catch (error_) {
      _wfReportarErroNaoCritico('atualizacao do painel do designer', error_);
    }
  }

  function _wfAplicarModoPainel() {
    const painel = document.getElementById('wf-designer-config');
    if (!painel) return;
    const avancado = _st.designerModo === 'avancado';
    painel.querySelectorAll('[data-wf-advanced="true"]').forEach((el) => {
      el.style.display = avancado ? '' : 'none';
    });
    const opLog = painel.querySelector('select[onchange*="operador_logico"]');
    if (!opLog || avancado) return;
    opLog.value = 'AND';
  }

  function _wfCondicaoLegivel(c) {
    if (!c?.campo) return 'sempre';
    const valor = c.valor === '__ANY__' ? 'qualquer valor' : (c.valor || '(vazio)');
    return `${c.campo} ${c.operador || '='} ${valor}`;
  }

  function _wfPapelLegivel(valor) {
    if (!valor) return 'Não definido';
    const labels = globalScope.WF_PAPEL_ALVO_LABELS ?? {
      solicitante: 'Próprio solicitante',
      gestor_solicitante: 'Gestor do solicitante',
      gestor_executor: 'Gestor do executor anterior',
      ep: 'Perfil EP',
      gestor: 'Perfil Gestor',
      dono: 'Perfil Dono',
    };
    return (globalScope.USUARIOS || []).find(u => u.email === valor)?.nome || labels[valor] || valor;
  }

  function _wfNoPorId(noId) {
    if (_wfModeler) {
      const reg = _wfModeler.get('elementRegistry');
      const el = reg?.get(noId);
      if (el) {
        return {
          id: el.id,
          nome: el.businessObject?.name || el.id,
          tipo: _bpmnTipoToWf(el.type),
        };
      }
    }
    return (_wfModeloAtual?.canvas?.nos || []).find(n => n.id === noId) || null;
  }

  function _wfArestasSaida(noId) {
    if (_wfModeler) {
      const reg = _wfModeler.get('elementRegistry');
      const el = reg?.get(noId);
      return (el?.outgoing || []).map(flow => ({
        id: flow.id,
        origem: flow.source?.id,
        destino: flow.target?.id,
        label: flow.businessObject?.name || flow.id,
        acao: flow.businessObject?.name || 'avancar',
      }));
    }
    return (_wfModeloAtual?.canvas?.arestas || []).filter(a => a.origem === noId);
  }

  function _wfResumoResponsavelNo(noId) {
    const cfg = _wfConfigNos[noId] ?? {};
    const papel = cfg.papeis?.executor || cfg.responsavel_papel || '';
    return _wfPapelLegivel(papel);
  }

  function _wfCamposFormularioResumo(noId) {
    const campos = _wfCamposDoFormulario(noId);
    if (!campos.length) return '<div class="wf-guide-note">Nenhum formulário vinculado a esta etapa.</div>';
    return `<div class="wf-form-fields-list">${campos.map((c) => {
      const meta = [];
      if (c.tipo) meta.push(c.tipo);
      if (c.obrigatorio) meta.push('obrigatório');
      if (c.tipo === 'select' && c.opcoes?.length) meta.push(`opções: ${c.opcoes.join(', ')}`);
      return `<div class="wf-form-field-chip"><div class="wf-form-field-name">${_esc(c.label || c.id)}</div><div class="wf-form-field-meta">${_esc(meta.join(' · ') || 'campo')}</div></div>`;
    }).join('')}</div>`;
  }

  function _wfRotasResumoHtml(noId) {
    const arestas = _wfArestasSaida(noId);
    const cfgNo = _wfConfigNos[noId] ?? {};
    const acoesEspeciais = (cfgNo.acoes || []).filter(a => a === 'rejeitar' || a === 'devolver');
    const labelsAcao = globalScope.WF_ACAO_LABELS;
    const avisoEspecial = acoesEspeciais.length
      ? `<div class="wf-guide-note">Os botões <strong>${_esc(acoesEspeciais.map(a => labelsAcao?.[a] || a).join(' e '))}</strong> retornam para a etapa anterior e <strong>não usam</strong> as saídas do gateway.</div>`
      : '';
    if (!arestas.length) return `${avisoEspecial}<div class="wf-guide-note">Esta etapa ainda não tem saída definida no fluxo.</div>`;
    return `${avisoEspecial}<div class="wf-route-list">${arestas.map((a) => {
      const cfgAresta = _wfConfigNos[a.id] ?? {};
      const destino = _wfNoPorId(a.destino);
      const nomeDestino = destino?.nome || a.destino || 'Destino';
      const tituloAcao = labelsAcao?.[a.acao] || a.acao;
      let regra = 'sem condição específica';
      if (cfgAresta.padrao) {
        regra = 'quando nenhuma outra condição for atendida';
      } else if (cfgAresta.condicoes?.length) {
        const separador = (cfgAresta.operador_logico || 'AND') === 'OR' ? ' ou ' : ' e ';
        regra = cfgAresta.condicoes.map(_wfCondicaoLegivel).join(separador);
      }
      return `<div class="wf-route-card"><div class="wf-route-title">${_esc(tituloAcao)} -> ${_esc(nomeDestino)}</div><div class="wf-route-sub">Vai para <strong>${_esc(nomeDestino)}</strong> e depois fica com <strong>${_esc(_wfResumoResponsavelNo(destino?.id || ''))}</strong>. Regra: ${_esc(regra)}.</div></div>`;
    }).join('')}</div>`;
  }

  function _wfCamposOrigemResumoHtml(arestaId) {
    const campos = _wfCamposDaOrigemDaAresta(arestaId);
    if (!campos.length) return '<div class="wf-mini-help">Nenhum campo de resposta foi encontrado na etapa anterior.</div>';
    return campos.map((c) => {
      let opcoes = '';
      if (c.tipo === 'select' && c.opcoes?.length) {
        opcoes = ` Opções: ${c.opcoes.join(', ')}.`;
      } else if (c.tipo === 'checkbox') {
        opcoes = ' Opções: sim, não.';
      }
      return `<div class="wf-mini-help">${_esc(c.label || c.id)}${_esc(opcoes)}</div>`;
    }).join('');
  }

  function _wfPainelSalvarHtml(rotulo) {
    return `
      <div class="wf-guide-row" style="justify-content:space-between;align-items:center;margin-top:16px;padding-top:12px;border-top:1px solid var(--bdr)">
        <div class="wf-mini-help">${_esc(rotulo || 'Revise as alterações e salve o modelo para persistir este card.')}</div>
        <button type="button" class="btn btn-p btn-sm" onclick="wfDesignerSalvar()">Salvar</button>
      </div>`;
  }

  function wfDesignerAtualizarRotulo(noId, valor) {
    try {
      const modeling = _wfModeler?.get('modeling');
      const elementRegistry = _wfModeler?.get('elementRegistry');
      const element = elementRegistry?.get(noId);
      if (modeling && element) {
        modeling.updateLabel(element, valor);
      }
    } catch (error_) {
      _wfReportarErroNaoCritico(`atualizacao de rotulo do elemento ${noId}`, error_);
    }
  }

  function _wfRenderAssistenteAresta(arestaId, painel) {
    const cfg = _wfConfigNos[arestaId] ?? {};
    let frase = 'Sempre seguir por este caminho.';
    if (cfg.padrao) {
      frase = 'Se nenhuma condição for atendida, seguir por este caminho.';
    } else if (cfg.condicoes?.length) {
      const separador = (cfg.operador_logico || 'AND') === 'OR' ? ' OU ' : ' E ';
      frase = `Se ${cfg.condicoes.map(_wfCondicaoLegivel).join(separador)}, seguir por este caminho.`;
    }
    painel.insertAdjacentHTML('beforeend', `
      <div style="margin-top:10px;padding:8px;border-radius:6px;background:var(--surf2);font-size:12px;color:var(--ink2)">
        <strong>Regra em linguagem simples:</strong> ${_esc(frase)}
      </div>`);
  }

  function _wfRenderMapaDecisao(noId, painel) {
    if (!_wfModeler) return;
    try {
      const reg = _wfModeler.get('elementRegistry');
      const el = reg?.get(noId);
      if (!el) return;
      const saidas = (el.outgoing || []).map((s) => {
        const cfg = _wfConfigNos[s.id] ?? {};
        const alvo = s.target?.businessObject?.name || s.target?.id || '?';
        let regra = 'sempre';
        if (cfg.padrao) {
          regra = 'se nenhuma regra anterior';
        } else if (cfg.condicoes?.length) {
          const separador = (cfg.operador_logico || 'AND') === 'OR' ? ' OU ' : ' E ';
          regra = cfg.condicoes.map(_wfCondicaoLegivel).join(separador);
        }
        return `<div style="font-size:12px;color:var(--ink2);margin-bottom:4px">Se <strong>${_esc(regra)}</strong> então ir para <strong>${_esc(alvo)}</strong>.</div>`;
      });
      if (!saidas.length) return;
      painel.insertAdjacentHTML('beforeend', `
        <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--bdr)">
          <div style="font-size:12px;font-weight:600;color:var(--ink2);margin-bottom:6px">Mapa de decisão</div>
          ${saidas.join('')}
        </div>`);
    } catch (error_) {
      _wfReportarErroNaoCritico(`mapa de decisao do elemento ${noId}`, error_);
    }
  }

  function wfDesignerAplicarPreset(noId, presetId) {
    if (!_wfConfigNos[noId]) _wfConfigNos[noId] = _configPadrao();
    const cfg = _wfConfigNos[noId];
    const campos = _wfCamposDoFormulario(noId);
    if (presetId === 'aprovacao_binaria') {
      if (!campos.length) { alert('Vincule um formulário com campo de resposta antes de aplicar este preset.'); return; }
      const campo = campos[0].id || campos[0].label;
      cfg.acoes = Array.from(new Set([...(cfg.acoes || []), 'avancar', 'devolver']));
      cfg.acoes_condicionais = [
        { acao: 'avancar', campo, operador: '=', valor: 'sim' },
        { acao: 'devolver', campo, operador: '=', valor: 'nao' },
      ];
    }
    if (presetId === 'campo_condicional') {
      if (campos.length < 2) { alert('Este preset precisa de ao menos 2 campos no formulário.'); return; }
      const gatilho = campos[0].id || campos[0].label;
      const alvo = campos[1].id || campos[1].label;
      cfg.campos_condicionais = cfg.campos_condicionais || [];
      cfg.campos_condicionais.push({
        campo_id: alvo,
        acao: 'mostrar',
        operador_logico: 'AND',
        condicoes: [{ campo: gatilho, operador: '=', valor: 'nao' }],
      });
    }
    _wfRenderAcoesCond(noId);
    _wfRenderCamposCond(noId);
    _wfMarcarDesignerSujo();
    if (_wfModeler) {
      const reg = _wfModeler.get('elementRegistry');
      const el = reg?.get(noId);
      if (el) _wfRenderConfigPanel(el);
    }
  }

  function _wfSalvarConfigNosImediato() {
    if (!_wfModeloAtual?.id) return;
    const dados = { config_nos: _wfNormalizarConfigNosPersistencia(_wfConfigNos) };
    _updateDoc('wf_processo_modelos', _wfModeloAtual.id, dados).catch((e) => {
      _wfReportarErroNaoCritico('salvar config_nos', e);
      if (typeof globalScope.toast === 'function') globalScope.toast('⚠ Erro ao salvar configuração: ' + (e?.message || e), 'var(--red)');
    });
  }

  function wfDesignerCampoCfg(noId, campo, valor) {
    if (!_wfConfigNos[noId]) _wfConfigNos[noId] = _configPadrao();
    _wfConfigNos[noId][campo] = valor;
    if (campo === '_nome') {
      wfDesignerAtualizarRotulo(noId, valor);
    }
    _wfMarcarDesignerSujo();
    _wfSalvarConfigNosImediato();
  }
  function wfDesignerPapel(noId, papel, valor) {
    if (!_wfConfigNos[noId]) _wfConfigNos[noId] = _configPadrao();
    _wfConfigNos[noId].papeis ??= {};
    _wfConfigNos[noId].papeis[papel] = valor || null;
    _wfMarcarDesignerSujo();
    _wfSalvarConfigNosImediato();
  }
  function wfDesignerToggleAcao(noId, acao, on) {
    if (!_wfConfigNos[noId]) _wfConfigNos[noId] = _configPadrao();
    const set = new Set(_wfConfigNos[noId].acoes || []);
    if (on) set.add(acao); else set.delete(acao);
    _wfConfigNos[noId].acoes = Array.from(set);
    if (acao === 'devolver') _wfRenderDestinoDevolucao(noId);
    _wfRenderAcoesCond(noId);
    _wfMarcarDesignerSujo();
    _wfSalvarConfigNosImediato();
  }

  function _wfNosAnterioresAo(noId) {
    const canvas = _wfModeler ? _wfSyncCanvas() : (_wfModeloAtual?.canvas || { nos: [], arestas: [] });
    const nos = canvas.nos || [];
    const arestas = canvas.arestas || [];
    // BFS reverso: encontra todos os nós que antecedem noId
    const visitados = new Set();
    const fila = [noId];
    while (fila.length) {
      const atual = fila.shift();
      arestas.filter(a => a.destino === atual).forEach(a => {
        if (!visitados.has(a.origem)) { visitados.add(a.origem); fila.push(a.origem); }
      });
    }
    return nos.filter(n => visitados.has(n.id) && n.tipo !== 'inicio' && n.tipo !== 'fim' && n.id !== noId);
  }

  function _wfRenderDestinoDevolucao(noId) {
    const container = document.getElementById(`wf-destino-devolucao-wrap-${noId}`);
    if (!container) return;
    const temDevolver = (_wfConfigNos[noId]?.acoes || []).includes('devolver');
    if (!temDevolver) { container.style.display = 'none'; return; }
    const nosAnt = _wfNosAnterioresAo(noId);
    const atual = _wfConfigNos[noId]?.destino_devolucao || '';
    const opts = nosAnt.length
      ? nosAnt.map(n => `<option value="${_esc(n.id)}"${n.id === atual ? ' selected' : ''}>${_esc(n.nome || n.id)}</option>`).join('')
      : '<option value="" disabled>Nenhuma etapa anterior disponível</option>';
    container.innerHTML = `<div style="margin-top:8px"><label class="lbl">Devolver para qual etapa?</label><select class="fi" style="margin-top:4px" onchange="wfDesignerSetDestinoDevolucao('${_esc(noId)}',this.value)"><option value="">— etapa imediatamente anterior —</option>${opts}</select></div>`;
    container.style.display = '';
  }

  function wfDesignerSetDestinoDevolucao(noId, destinoId) {
    if (!_wfConfigNos[noId]) _wfConfigNos[noId] = _configPadrao();
    _wfConfigNos[noId].destino_devolucao = destinoId || null;
    _wfMarcarDesignerSujo();
    _wfSalvarConfigNosImediato();
  }

  function _wfMarcarDesignerSujo() {
    _wfAtualizarIndicadorSujo(true);
    _wfAgendarAutosave();
  }

  // ── Gateway Condicional — Editor de condições de arestas ──────────────────

  const _WF_OPS_LABELS = ['=','!=','>','<','>=','<=','contém','não contém','vazio','não vazio'];

  function _wfCamposDaOrigemDaAresta(arestaId) {
    if (!_wfModeler) return [];
    try {
      const reg = _wfModeler.get('elementRegistry');
      const aresta = reg?.get(arestaId);
      const origemEl = aresta?.source || reg?.get(aresta?.businessObject?.sourceRef?.id || '');
      if (!origemEl) return [];

      // Caso comum: a seta sai de uma atividade com formulário.
      const camposDiretos = _wfCamposDoFormulario(origemEl.id);
      if (camposDiretos.length) return camposDiretos;

      // Caso gateway: procura recursivamente para trás a primeira atividade com formulário.
      const visitados = new Set();
      const fila = [origemEl];
      while (fila.length) {
        const atual = fila.shift();
        if (!atual || visitados.has(atual.id)) continue;
        visitados.add(atual.id);

        const campos = _wfCamposDoFormulario(atual.id);
        if (campos.length) return campos;

        const incoming = atual.incoming || [];
        incoming.forEach((flow) => {
          const prev = flow?.source || reg?.get(flow?.businessObject?.sourceRef?.id || '');
          if (prev && !visitados.has(prev.id)) fila.push(prev);
        });
      }

      return [];
    } catch (error_) {
      _wfReportarErroNaoCritico(`campos da origem da aresta ${arestaId}`, error_);
      return [];
    }
  }

  function _wfOptsCamposAresta(arestaId, valorAtual) {
    const campos = _wfCamposDaOrigemDaAresta(arestaId);
    const semSelecao = '<option value="">— selecione um campo —</option>';
    if (!campos.length) {
      return semSelecao + '<option value="" disabled>Nenhum campo disponível no formulário da etapa de origem</option>';
    }
    const hasAtual = campos.some(c => (c.id || c.label) === valorAtual);
    const opts = campos.map(c => {
      const val = c.id || c.label;
      return `<option value="${_esc(val)}"${val === valorAtual ? ' selected' : ''}>${_esc(c.label || c.id || val)}</option>`;
    }).join('');
    const legado = valorAtual && !hasAtual
      ? `<option value="${_esc(valorAtual)}" selected>${_esc(valorAtual)} (legado)</option>`
      : '';
    return semSelecao + legado + opts;
  }

  function _wfCampoMetaAresta(arestaId, campoId) {
    const campos = _wfCamposDaOrigemDaAresta(arestaId) || [];
    return campos.find(c => (c.id || c.label) === campoId) || null;
  }

  function _wfCampoMetaNo(noId, campoId) {
    const campos = _wfCamposDoFormulario(noId) || [];
    return campos.find(c => (c.id || c.label) === campoId) || null;
  }

  function _wfOpcoesValorMeta(meta) {
    if (!meta) return [];
    if (Array.isArray(meta.opcoes) && meta.opcoes.length) {
      return meta.opcoes.map(o => String(o || '').trim()).filter(Boolean);
    }
    if (meta.tipo === 'checkbox') return ['sim', 'nao'];
    return [];
  }

  function _wfEditorValorSugestoesHtml({ valorAtual, opcoes, placeholder, selectOnChange, inputOnInput }) {
    const lista = (opcoes || []).map(v => String(v || '').trim()).filter(Boolean);
    if (!lista.length) {
      return `<input type="text" class="fi" style="font-size:11px" placeholder="${_esc(placeholder || 'valor')}" value="${_esc(valorAtual || '')}" oninput="${inputOnInput}">`;
    }
    return `
      <div style="display:grid;gap:6px">
        <select class="fi" style="font-size:11px" onchange="${selectOnChange}">
          <option value="">Escolha um valor sugerido</option>
          ${lista.map(v => `<option value="${_esc(v)}"${String(valorAtual || '') === v ? ' selected' : ''}>${_esc(v)}</option>`).join('')}
        </select>
        <input type="text" class="fi" style="font-size:11px" placeholder="${_esc(placeholder || 'valor')}" value="${_esc(valorAtual || '')}" oninput="${inputOnInput}">
      </div>`;
  }

  function _wfOptsValorAresta(arestaId, campoId, valorAtual) {
    const meta = _wfCampoMetaAresta(arestaId, campoId);
    if (!meta) return null;
    let opcoes = _wfOpcoesValorMeta(meta);
    if (!opcoes.length) return null;

    const base = `<option value="__ANY__"${(!valorAtual || valorAtual === '__ANY__') ? ' selected' : ''}>qualquer valor</option>`;
    const opts = opcoes.map(v => `<option value="${_esc(v)}"${valorAtual === v ? ' selected' : ''}>${_esc(v)}</option>`).join('');
    return base + opts;
  }

  function _wfRenderCondicoes(arestaId) {
    const el = document.getElementById(`wf-aresta-conds-${arestaId}`);
    if (!el) return;
    const conds = _wfConfigNos[arestaId]?.condicoes || [];
    if (!conds.length) {
      el.innerHTML = '<div class="wf-guide-note">Sem regra específica. Este caminho pode ser usado livremente.</div>';
      return;
    }
    el.innerHTML = conds.map((c, i) => {
      const valorOpts = _wfOptsValorAresta(arestaId, c.campo || '', c.valor || '');
      const valorInput = valorOpts
        ? `<select class="fi" style="font-size:11px" onchange="wfDesignerUpdateCondicao('${_esc(arestaId)}',${i},'valor',this.value)">${valorOpts}</select>`
        : `<input type="text" class="fi" placeholder="valor" value="${_esc(c.valor || '')}" style="font-size:11px"
          oninput="wfDesignerUpdateCondicao('${_esc(arestaId)}',${i},'valor',this.value)">`;
      return `
      <div class="wf-logic-card">
        <div class="wf-logic-sentence">Seguir por este caminho quando a resposta for:</div>
        <div class="wf-logic-actions" style="display:grid;grid-template-columns:1fr 1fr 1fr auto;align-items:center">
          <select class="fi" style="font-size:11px" onchange="wfDesignerUpdateCondicao('${_esc(arestaId)}',${i},'campo',this.value)">${_wfOptsCamposAresta(arestaId, c.campo || '')}</select>
          <select class="fi" style="font-size:11px" onchange="wfDesignerUpdateCondicao('${_esc(arestaId)}',${i},'operador',this.value)">${_WF_OPS_LABELS.map(op => `<option value="${_esc(op)}"${c.operador === op ? ' selected' : ''}>${_esc(op)}</option>`).join('')}</select>
          ${valorInput}
          <button type="button" style="background:none;border:none;cursor:pointer;color:#ef4444;font-size:14px;padding:0 4px" onclick="wfDesignerRemoveCondicao('${_esc(arestaId)}',${i})">✕</button>
        </div>
      </div>`;
    }).join('');
  }

  function wfDesignerAddCondicao(arestaId) {
    if (!_wfConfigNos[arestaId]) _wfConfigNos[arestaId] = { condicoes: [], operador_logico: 'AND', padrao: false };
    const condicoes = _wfConfigNos[arestaId].condicoes || [];
    _wfConfigNos[arestaId].condicoes = condicoes;
    condicoes.push({ campo: '', operador: '=', valor: '' });
    _wfRenderCondicoes(arestaId);
    _wfMarcarDesignerSujo();
  }

  function wfDesignerRemoveCondicao(arestaId, idx) {
    const conds = _wfConfigNos[arestaId]?.condicoes;
    if (conds) { conds.splice(idx, 1); _wfRenderCondicoes(arestaId); _wfMarcarDesignerSujo(); }
  }

  function wfDesignerUpdateCondicao(arestaId, idx, chave, valor) {
    const cond = _wfConfigNos[arestaId]?.condicoes?.[idx];
    if (!cond) return;
    cond[chave] = valor;
    if (chave === 'campo') {
      cond.valor = '';
      _wfRenderCondicoes(arestaId);
    }
    _wfMarcarDesignerSujo();
  }

  function wfDesignerArestaPadrao(arestaId, val) {
    if (!_wfConfigNos[arestaId]) _wfConfigNos[arestaId] = {};
    _wfConfigNos[arestaId].padrao = val;
    const wrap = document.getElementById(`wf-aresta-conds-wrap-${arestaId}`);
    if (wrap) { wrap.style.opacity = val ? '.4' : '1'; wrap.style.pointerEvents = val ? 'none' : ''; }
    _wfMarcarDesignerSujo();
  }

  // ── Condições por ação (botões na execução) ───────────────────────────────

  function _wfRenderAcoesCond(noId) {
    const el = document.getElementById(`wf-acoes-cond-${noId}`);
    if (!el) return;
    const lista = _wfConfigNos[noId]?.acoes_condicionais || [];
    const acoes = _wfConfigNos[noId]?.acoes || [];
    if (!lista.length) {
      el.innerHTML = '<div class="wf-guide-note">Todos os botões marcados acima aparecerão normalmente.</div>';
      return;
    }

    const optsCampos = (valorAtual, idx) => {
      const campos = _wfCamposDoFormulario(noId);
      const semSelecao = '<option value="">— selecione um campo —</option>';
      if (!campos.length) {
        return `<select class="fi" style="font-size:11px"
          onchange="wfDesignerAcaoCondUpdate('${_esc(noId)}',${idx},'campo',this.value)">${semSelecao}<option value="" disabled>Nenhum campo disponível no formulário</option></select>`;
      }
      const hasAtual = campos.some(c => (c.id || c.label) === valorAtual);
      const opts = campos.map(c => {
        const val = c.id || c.label;
        return `<option value="${_esc(val)}"${val === valorAtual ? ' selected' : ''}>${_esc(c.label || c.id || val)}</option>`;
      }).join('');
      const legado = valorAtual && !hasAtual
        ? `<option value="${_esc(valorAtual)}" selected>${_esc(valorAtual)} (legado)</option>`
        : '';
      return `<select class="fi" style="font-size:11px"
          onchange="wfDesignerAcaoCondUpdate('${_esc(noId)}',${idx},'campo',this.value)">${semSelecao}${legado}${opts}</select>`;
    };
    const labelsAcao = globalScope.WF_ACAO_LABELS;
    const renderAcaoLabel = (acao) => labelsAcao[acao] || acao || 'ação';
    const renderOperadores = (operadorAtual) => _WF_OPS_LABELS.map(op =>
      `<option value="${_esc(op)}"${(operadorAtual || '=') === op ? ' selected' : ''}>${_esc(op)}</option>`
    ).join('');
    const renderAcoes = (acaoAtual) => acoes.map(a =>
      `<option value="${_esc(a)}"${acaoAtual === a ? ' selected' : ''}>${_esc(renderAcaoLabel(a))}</option>`
    ).join('');

    el.innerHTML = `<div class="wf-logic-list">${lista.map((r, i) => {
      const htmlValor = _wfEditorValorSugestoesHtml({
        valorAtual: r.valor || '',
        opcoes: _wfOpcoesValorMeta(_wfCampoMetaNo(noId, r.campo || '')),
        placeholder: 'escolha uma opção ou digite um valor',
        selectOnChange: `wfDesignerAcaoCondUpdate('${_esc(noId)}',${i},'valor',this.value)`,
        inputOnInput: `wfDesignerAcaoCondUpdate('${_esc(noId)}',${i},'valor',this.value)`,
      });
      return `
      <div class="wf-logic-card">
        <div class="wf-logic-sentence">Mostrar o botão <strong>${_esc(renderAcaoLabel(r.acao))}</strong> quando:</div>
        <div class="wf-logic-actions" style="display:grid;grid-template-columns:1fr 1fr 1fr auto;align-items:center">
          ${optsCampos(r.campo || '', i)}
          <select class="fi" style="font-size:11px" onchange="wfDesignerAcaoCondUpdate('${_esc(noId)}',${i},'operador',this.value)">${renderOperadores(r.operador)}</select>
          ${htmlValor}
          <button type="button" style="background:none;border:none;cursor:pointer;color:#ef4444;font-size:14px;padding:0 4px" onclick="wfDesignerAcaoCondRemove('${_esc(noId)}',${i})">✕</button>
        </div>
        <div class="wf-logic-actions"><select class="fi" style="font-size:11px;max-width:220px" onchange="wfDesignerAcaoCondUpdate('${_esc(noId)}',${i},'acao',this.value)">${renderAcoes(r.acao)}</select></div>
      </div>
    `;
    }).join('')}</div>`;
  }

  function wfDesignerAddAcaoCond(noId) {
    if (!_wfConfigNos[noId]) _wfConfigNos[noId] = _configPadrao();
    const acoes = _wfConfigNos[noId].acoes || ['avancar'];
    const regras = _wfConfigNos[noId].acoes_condicionais || [];
    _wfConfigNos[noId].acoes_condicionais = regras;
    regras.push({ acao: acoes[0] || 'avancar', campo: '', operador: '=', valor: '' });
    _wfRenderAcoesCond(noId);
    _wfMarcarDesignerSujo();
  }

  function wfDesignerAcaoCondRemove(noId, idx) {
    _wfConfigNos[noId]?.acoes_condicionais?.splice(idx, 1);
    _wfRenderAcoesCond(noId);
    _wfMarcarDesignerSujo();
  }

  function wfDesignerAcaoCondUpdate(noId, idx, chave, valor) {
    const reg = _wfConfigNos[noId]?.acoes_condicionais?.[idx];
    if (!reg) return;
    reg[chave] = valor;
    if (chave === 'campo') {
      reg.valor = '';
      _wfRenderAcoesCond(noId);
    }
    _wfMarcarDesignerSujo();
  }

  // ── Campos Condicionais — Editor de visibilidade/obrigatoriedade ──────────

  // Retorna os campos do formulário vinculado ao nó (para usar nos selects de campos condicionais)
  function _wfCamposDoFormulario(noId) {
    const formularioId = _wfConfigNos[noId]?.formulario_id;
    if (!formularioId) return [];
    const form = (_st.formularioModelos || []).find(f => f.id === formularioId);
    return form?.campos || [];
  }

  function _wfOptsCampos(noId, valorAtual) {
    const campos = _wfCamposDoFormulario(noId);
    if (!campos.length) {
      // sem formulário vinculado: mantém input livre como fallback
      return null;
    }
    const semSelecao = `<option value="">— selecione um campo —</option>`;
    const opts = campos.map(c =>
      `<option value="${_esc(c.id || c.label)}"${(c.id || c.label) === valorAtual ? ' selected' : ''}>${_esc(c.label || c.id)}</option>`
    ).join('');
    return semSelecao + opts;
  }

  function _wfRenderCamposCond(noId) {
    const el = document.getElementById(`wf-campos-cond-${noId}`);
    if (!el) return;
    const lista = _wfConfigNos[noId]?.campos_condicionais || [];
    if (!lista.length) {
      el.innerHTML = '<div class="wf-guide-note">Todos os campos do formulário seguem o comportamento padrão.</div>';
      return;
    }
    const optsAfetado = (valorAtual) => {
      const opts = _wfOptsCampos(noId, valorAtual);
      if (opts !== null) {
        return `<select class="fi" style="flex:1;min-width:100px;font-size:11px"
          onchange="wfDesignerCampoCondUpdate('${_esc(noId)}',__IDX__,'campo_id',this.value)">${opts}</select>`;
      }
      return `<input type="text" class="fi" value="${_esc(valorAtual || '')}" placeholder="id_do_campo" style="flex:1;min-width:80px;font-size:11px"
        oninput="wfDesignerCampoCondUpdate('${_esc(noId)}',__IDX__,'campo_id',this.value)">`;
    };
    const renderCampoCondAcao = (acao) => {
      if (acao === 'mostrar') return 'Mostrar';
      if (acao === 'ocultar') return 'Ocultar';
      if (acao === 'obrigatorio') return 'Tornar obrigatório';
      return 'Tornar opcional';
    };
    el.innerHTML = `<div class="wf-logic-list">${lista.map((cc, i) => {
      const opcoesAcao = ['mostrar', 'ocultar', 'obrigatorio', 'opcional']
        .map(a => `<option value="${a}"${cc.acao === a ? ' selected' : ''}>${a}</option>`)
        .join('');
      return `
      <div class="wf-logic-card">
        <div class="wf-logic-sentence">${renderCampoCondAcao(cc.acao)} o campo:</div>
        <div class="wf-logic-actions">
          ${optsAfetado(cc.campo_id || '').replaceAll('__IDX__', String(i))}
          <select class="fi" style="width:auto;font-size:11px" onchange="wfDesignerCampoCondUpdate('${_esc(noId)}',${i},'acao',this.value)">${opcoesAcao}</select>
          <select class="fi" style="width:auto;font-size:11px" onchange="wfDesignerCampoCondUpdate('${_esc(noId)}',${i},'operador_logico',this.value)"><option value="AND"${(cc.operador_logico || 'AND') === 'AND' ? ' selected' : ''}>se todas as regras ocorrerem</option><option value="OR"${cc.operador_logico === 'OR' ? ' selected' : ''}>se qualquer regra ocorrer</option></select>
          <button type="button" style="background:none;border:none;cursor:pointer;color:#ef4444" onclick="wfDesignerCampoCondRemove('${_esc(noId)}',${i})">✕</button>
        </div>
        <div id="wf-campo-cond-conds-${_esc(noId)}-${i}" style="margin-bottom:4px"></div>
        <button type="button" class="btn btn-sm" style="font-size:10px" onclick="wfDesignerCampoCondAddCond('${_esc(noId)}',${i})">+ Adicionar condição</button>
      </div>`;
    }).join('')}</div>`;
    lista.forEach((_, i) => _wfRenderCampoCondConds(noId, i));
  }

  function _wfRenderCampoCondConds(noId, ccIdx) {
    const el = document.getElementById(`wf-campo-cond-conds-${noId}-${ccIdx}`);
    if (!el) return;
    const conds = _wfConfigNos[noId]?.campos_condicionais?.[ccIdx]?.condicoes || [];
    if (!conds.length) { el.innerHTML = '<div class="wf-mini-help">Ainda não há condição cadastrada.</div>'; return; }
    const temOpts = _wfOptsCampos(noId, '') !== null;
    el.innerHTML = conds.map((c, i) => {
      const campoInput = temOpts
        ? `<select class="fi" style="font-size:11px"
            onchange="wfDesignerCampoCondCond('${_esc(noId)}',${ccIdx},${i},'campo',this.value)">
            ${_wfOptsCampos(noId, c.campo || '')}
           </select>`
        : `<input type="text" class="fi" placeholder="campo" value="${_esc(c.campo || '')}" style="font-size:11px"
            oninput="wfDesignerCampoCondCond('${_esc(noId)}',${ccIdx},${i},'campo',this.value)">`;
      return `
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:4px;margin-bottom:4px">
          ${campoInput}
          <select class="fi" style="font-size:11px"
            onchange="wfDesignerCampoCondCond('${_esc(noId)}',${ccIdx},${i},'operador',this.value)">
            ${_WF_OPS_LABELS.map(op => `<option value="${_esc(op)}"${c.operador === op ? ' selected' : ''}>${_esc(op)}</option>`).join('')}
          </select>
          ${_wfEditorValorSugestoesHtml({
            valorAtual: c.valor || '',
            opcoes: _wfOpcoesValorMeta(_wfCampoMetaNo(noId, c.campo || '')),
            placeholder: 'escolha uma opção ou digite um valor',
            selectOnChange: `wfDesignerCampoCondCond('${_esc(noId)}',${ccIdx},${i},'valor',this.value)`,
            inputOnInput: `wfDesignerCampoCondCond('${_esc(noId)}',${ccIdx},${i},'valor',this.value)`,
          })}
          <button type="button" style="background:none;border:none;cursor:pointer;color:#ef4444;font-size:14px;padding:0 4px"
            onclick="wfDesignerCampoCondRemoveCond('${_esc(noId)}',${ccIdx},${i})">✕</button>
        </div>`;
    }).join('');
  }

  function wfDesignerAddCampoCond(noId) {
    if (!_wfConfigNos[noId]) _wfConfigNos[noId] = _configPadrao();
    const camposCondicionais = _wfConfigNos[noId].campos_condicionais || [];
    _wfConfigNos[noId].campos_condicionais = camposCondicionais;
    camposCondicionais.push({ campo_id: '', acao: 'mostrar', condicoes: [], operador_logico: 'AND' });
    _wfRenderCamposCond(noId);
    _wfMarcarDesignerSujo();
  }

  function wfDesignerCampoCondRemove(noId, idx) {
    _wfConfigNos[noId]?.campos_condicionais?.splice(idx, 1);
    _wfRenderCamposCond(noId);
    _wfMarcarDesignerSujo();
  }

  function wfDesignerCampoCondUpdate(noId, idx, chave, valor) {
    const cc = _wfConfigNos[noId]?.campos_condicionais?.[idx];
    if (cc) { cc[chave] = valor; _wfMarcarDesignerSujo(); }
  }

  function wfDesignerCampoCondAddCond(noId, ccIdx) {
    const cc = _wfConfigNos[noId]?.campos_condicionais?.[ccIdx];
    if (!cc) return;
    const condicoes = cc.condicoes || [];
    cc.condicoes = condicoes;
    condicoes.push({ campo: '', operador: '=', valor: '' });
    _wfRenderCampoCondConds(noId, ccIdx);
    _wfMarcarDesignerSujo();
  }

  function wfDesignerCampoCondRemoveCond(noId, ccIdx, condIdx) {
    _wfConfigNos[noId]?.campos_condicionais?.[ccIdx]?.condicoes?.splice(condIdx, 1);
    _wfRenderCampoCondConds(noId, ccIdx);
    _wfMarcarDesignerSujo();
  }

  function wfDesignerCampoCondCond(noId, ccIdx, condIdx, chave, valor) {
    const c = _wfConfigNos[noId]?.campos_condicionais?.[ccIdx]?.condicoes?.[condIdx];
    if (!c) return;
    c[chave] = valor;
    if (chave === 'campo') {
      c.valor = '';
      _wfRenderCampoCondConds(noId, ccIdx);
    }
    _wfMarcarDesignerSujo();
  }

  // ── Avaliação de campos condicionais (exposta para renderer de formulários) ─

  function _avaliarCamposCondicionais(camposCondicionais, dadosForm) {
    const res = {};
    (camposCondicionais || []).forEach(cc => {
      const passa = _avaliarCondicoes(cc.condicoes, cc.operador_logico, dadosForm);
      if (!res[cc.campo_id]) res[cc.campo_id] = { visivel: true, obrigatorio: false };
      switch (cc.acao) {
        case 'mostrar':      res[cc.campo_id].visivel     =  passa; break;
        case 'ocultar':      res[cc.campo_id].visivel     = !passa; break;
        case 'obrigatorio':  res[cc.campo_id].obrigatorio =  passa; break;
        case 'opcional':     res[cc.campo_id].obrigatorio = !passa; break;
      }
    });
    return res;
  }

  async function wfDesignerSalvar(opts = {}) {
    if (!_wfModeloAtual) return;
    const silent = !!opts.silent;
    try {
      _wfAutosaveEmCurso = true;
      let xml = _wfModeloAtual.bpmn_xml || '';
      let canvas = _wfModeloAtual.canvas || { nos: [], arestas: [] };
      if (_wfModeler) {
        ({ xml } = await _wfModeler.saveXML({ format: true }));
        canvas = _wfSyncCanvas();
      }
      const nome = document.getElementById('wf-designer-nome')?.value.trim() || _wfModeloAtual.nome;
      const descricao = document.getElementById('wf-designer-desc')?.value.trim() || '';
      const dados = _wfMontarModeloPersistencia({
        nome, descricao,
        status: _wfModeloAtual.status || 'rascunho',
        versao: _wfModeloAtual.versao || 1,
        processo_origem_id: _wfModeloAtual.processo_origem_id || null,
        processo_origem_nome: _wfModeloAtual.processo_origem_nome || null,
        fluxo_origem: _wfModeloAtual.fluxo_origem || null,
        bpmn_xml: xml,
        config_nos: _wfConfigNos,
        canvas,
        criado_por: _wfModeloAtual.criado_por || _uid(),
      });
      if (_wfModeloAtual.id) {
        await _updateDoc('wf_processo_modelos', _wfModeloAtual.id, dados);
      } else {
        _wfModeloAtual.id = await _addDoc('wf_processo_modelos', dados);
      }
      Object.assign(_wfModeloAtual, dados);
      _wfLimparAutosavePendente();
      _wfAtualizarIndicadorSujo(false);
      if (!silent && typeof globalScope.toast === 'function') globalScope.toast('✓ Workflow salvo');
    } catch (e) {
      if (!silent) alert('Erro ao salvar: ' + e.message);
    } finally {
      _wfAutosaveEmCurso = false;
    }
  }

  async function wfDesignerPublicar() {
    await wfPublicarModelo();
  }

  function _wfValidarModeloPublicacao(modelo) {
    const erros = [];
    const avisos = [];
    const autoFixes = [];
    const canvas = (_wfModeloAtual?.id && modelo?.id === _wfModeloAtual?.id && _wfModeler)
      ? _wfSyncCanvas()
      : (modelo?.canvas || { nos: [], arestas: [] });
    const cfgNos = (modelo?.id === _wfModeloAtual?.id) ? _wfConfigNos : (modelo?.config_nos ?? {});
    const nos = canvas.nos || [];
    const arestas = canvas.arestas || [];
    const inicios = nos.filter(n => n.tipo === 'inicio');
    const fins = nos.filter(n => n.tipo === 'fim');

    if (!inicios.length) erros.push('Adicione um evento de início.');
    if (!fins.length) erros.push('Adicione um evento de fim.');
    if (!arestas.length) erros.push('Adicione ao menos uma conexão entre etapas.');

    nos.filter(n => n.tipo === 'aprovacao').forEach((g) => {
      const saidas = arestas.filter(a => a.origem === g.id);
      if (saidas.length < 2) erros.push(`Gateway "${g.nome || g.id}" precisa de pelo menos duas saídas.`);
      const padrao = saidas.filter(a => cfgNos[a.id]?.padrao);
      if (!padrao.length && saidas.length) {
        avisos.push(`Gateway "${g.nome || g.id}" sem saída padrão.`);
        autoFixes.push({ tipo: 'gateway_default', gatewayId: g.id, arestaId: saidas[0].id });
      }
      if (padrao.length > 1) erros.push(`Gateway "${g.nome || g.id}" possui mais de uma saída padrão.`);
    });

    nos.filter(n => n.tipo === 'tarefa').forEach((n) => {
      const cfg = cfgNos[n.id] || _configPadrao();
      (cfg.acoes ?? []).forEach((acao) => {
        const prox = _proximoNoExecutavel(canvas, n.id, acao, {});
        if (!prox) erros.push(`A ação "${acao}" da etapa "${n.nome || n.id}" não possui destino válido.`);
      });
    });

    return { ok: !erros.length, erros, avisos, autoFixes, canvas };
  }

  function wfDesignerAplicarAutoFixPublicacao() {
    if (!_wfModeloAtual) return;
    const v = _wfValidarModeloPublicacao(_wfModeloAtual);
    const fix = v.autoFixes.find(f => f.tipo === 'gateway_default');
    if (!fix) { alert('Nenhuma correção automática disponível.'); return; }
    if (!_wfConfigNos[fix.arestaId]) _wfConfigNos[fix.arestaId] = _configPadrao();
    _wfConfigNos[fix.arestaId].padrao = true;
    _wfMarcarDesignerSujo();
    alert('Correção aplicada: saída padrão criada no gateway.');
    if (_wfModeler) {
      const reg = _wfModeler.get('elementRegistry');
      const el = reg?.get(fix.gatewayId);
      if (el) _wfRenderConfigPanel(el);
    }
  }

  // Mantém stubs das funções antigas expostas para não quebrar chamadas inline
  function wfDesignerRemoverArestaSel() {
    if (!(_wfModeler && _st.designerArestaSel)) return;
    try {
      const elementRegistry = _wfModeler.get('elementRegistry');
      const modeling = _wfModeler.get('modeling');
      const element = elementRegistry?.get(_st.designerArestaSel);
      if (!(modeling && element)) return;
      modeling.removeElements([element]);
      delete _wfConfigNos[_st.designerArestaSel];
      _st.designerArestaSel = null;
      _wfMarcarDesignerSujo();
      _wfRenderConfigPanel(null);
    } catch (error_) {
      _wfReportarErroNaoCritico('remocao da aresta selecionada', error_);
    }
  }

  function _wfMembrosGrupoTexto(grupo, usuarios) {
    const emails = grupo.membros_email || [];
    if (emails.length === 0) return '<em style="color:var(--ink3)">Sem membros</em>';
    return emails.map((email) => {
      const u = usuarios.find(x => x.email === email);
      return _esc(u ? (u.nome || email) : email);
    }).join(', ');
  }

  function _wfAcoesGrupoHtml(grupo, isEp) {
    if (!isEp) return '';
    const grupoId = _esc(grupo._id || grupo.id);
    return `
          <div style="display:flex;gap:6px;margin-top:10px">
            <button type="button" class="btn btn-sm" onclick="wfAbrirModalGrupo('${grupoId}')">Editar</button>
            <button type="button" class="btn btn-sm" style="color:var(--red,#dc2626)" onclick="wfExcluirGrupo('${grupoId}')">Excluir</button>
          </div>`;
  }

  function _wfAtualizarResumoEquipeAtribuicao(grupos, grupoId, membrosDiv) {
    if (!membrosDiv) return;
    const grupo = grupos.find(x => x.id === grupoId);
    if (!grupo) {
      membrosDiv.classList.remove('vis');
      return;
    }
    const nomes = (grupo.membros_email || []).map((email) => {
      const u = (globalScope.USUARIOS || []).find(x => x.email === email);
      return _esc(u?.nome || email);
    });
    if (nomes.length === 0) {
      membrosDiv.innerHTML = 'Nenhum membro cadastrado nesta equipe.';
      membrosDiv.classList.add('vis');
      return;
    }
    const sufixo = nomes.length > 1 ? 's' : '';
    membrosDiv.innerHTML = `<strong>${nomes.length} membro${sufixo}:</strong> ${nomes.join(', ')}`;
    membrosDiv.classList.add('vis');
  }

  function _wfOpcoesGruposAtribuicao(grupos) {
    if (!grupos.length) return '<option value="">— nenhuma equipe cadastrada —</option>';
    const opcoes = grupos.map(g => `<option value="${_esc(g.id)}">${_esc(g.nome)}</option>`).join('');
    return `<option value="">— selecione uma equipe —</option>${opcoes}`;
  }

  // — Coleta perfis que precisam de atribuição explícita ao iniciar —
  // Retorna array de strings únicas, ex: ['ep', 'gestor']
  // Abre modal de vinculação de equipe; chama callback({ grupo_id, grupo_nome }) ou null se cancelado
  async function _wfAbrirModalAtribuicao(nomeModelo, callback) {
    const el = document.getElementById('wf-modal-atribuicao');
    if (!el) { callback({}); return; }
    const titulo = document.getElementById('wf-modal-atrib-titulo');
    if (titulo) titulo.textContent = `Vincular equipe — ${_esc(nomeModelo)}`;

    const sel = document.getElementById('wf-atrib-sel-equipe');
    const membrosDiv = document.getElementById('wf-atrib-equipe-membros');
    if (sel) sel.innerHTML = '<option value="">— carregando… —</option>';

    const { getDocs, collection, query, orderBy } = globalScope.fb();
    const snap = await getDocs(query(collection(_db(), 'wf_grupos'), orderBy('nome')));
    const grupos = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (sel) {
      sel.innerHTML = _wfOpcoesGruposAtribuicao(grupos);
      sel.onchange = () => _wfAtualizarResumoEquipeAtribuicao(grupos, sel.value, membrosDiv);
    }

    el.style.display = 'flex';
    el._atribCallback = callback;
    el._atribGrupos = grupos;
  }

  function wfConfirmarAtribuicao() {
    const el = document.getElementById('wf-modal-atribuicao');
    if (!el) return;
    const sel = document.getElementById('wf-atrib-sel-equipe');
    const grupos = el._atribGrupos || [];
    const grupoId = sel?.value || null;
    const grupo = grupos.find(g => g.id === grupoId) || null;
    const payload = {};
    if (grupoId) {
      payload.grupo_id = grupoId;
      payload.grupo_nome = grupo?.nome || grupoId;
    }
    el.style.display = 'none';
    if (typeof el._atribCallback === 'function') {
      el._atribCallback(payload);
    }
  }

  function wfCancelarAtribuicao() {
    const el = document.getElementById('wf-modal-atribuicao');
    if (!el) return;
    el.style.display = 'none';
    if (typeof el._atribCallback === 'function') el._atribCallback(null);
  }

  // — Iniciar uma instância a partir de um modelo do designer —
  async function wfIniciarDeModelo(modeloId) {
    const uid = _uid();
    if (!uid) { alert('Usuário não autenticado.'); return; }
    const modelo = await _getDoc('wf_processo_modelos', modeloId);
    if (!modelo) { alert('Modelo não encontrado.'); return; }
    const nos = modelo.canvas?.nos || [];
    const inicio = nos.find(n => n.tipo === 'inicio');
    if (!inicio) { alert('Modelo sem nó de início.'); return; }
    // primeiro nó executável após o início
    const primeira = _proximoNoExecutavel(modelo.canvas, inicio.id, null);
    if (!primeira) { alert('Modelo sem etapa após o início.'); return; }

    _wfAbrirModalAtribuicao(modelo.nome, async (vinculo) => {
      if (vinculo === null) return;
      try {
        const titulo = `${modelo.nome} — ${new Date().toLocaleDateString('pt-BR')}`;
        await _wfApiRequest('wfInstancias', '', {
          method: 'POST',
          body: {
            processo_modelo_id: modelo.id,
            titulo,
            grupo_id: vinculo.grupo_id || null,
            grupo_nome: vinculo.grupo_nome || null,
          },
        });
        alert(`Workflow iniciado! Etapa "${primeira.nome}" criada.`);
        wfNavWorkflow(globalScope.isSolicitante?.() ? 'instancias' : 'tarefas');
      } catch (e) {
        alert('Erro ao iniciar: ' + e.message);
      }
    });
  }

  // ── Motor de Regras ───────────────────────────────────────────────────────

  // Mapa de operadores — definido uma vez, sem recriação a cada chamada
  const _WF_OPS = {
    '=':           (a, b) => String(a ?? '') === String(b ?? ''),
    '!=':          (a, b) => String(a ?? '') !== String(b ?? ''),
    '>':           (a, b) => Number(a) > Number(b),
    '<':           (a, b) => Number(a) < Number(b),
    '>=':          (a, b) => Number(a) >= Number(b),
    '<=':          (a, b) => Number(a) <= Number(b),
    'contém':      (a, b) => String(a ?? '').toLowerCase().includes(String(b ?? '').toLowerCase()),
    'não contém':  (a, b) => !String(a ?? '').toLowerCase().includes(String(b ?? '').toLowerCase()),
    'vazio':       (a)    => a === null || a === undefined || String(a).trim() === '',
    'não vazio':   (a)    => a !== null && a !== undefined && String(a).trim() !== '',
  };

  function _avaliarCondicaoObj(cond, dados) {
    if (!cond?.campo) return true;
    if (cond.valor === '__ANY__') return true;
    const fn = _WF_OPS[cond?.operador];
    if (!fn) return true;
    try { return fn(dados[cond.campo], cond.valor); } catch { return true; }
  }

  function _avaliarCondicoes(condicoes, operadorLogico, dados) {
    if (!(condicoes?.length)) return true;
    const isOR = (operadorLogico || 'AND').toUpperCase() === 'OR';
    return isOR
      ? condicoes.some(c  => _avaliarCondicaoObj(c, dados))
      : condicoes.every(c => _avaliarCondicaoObj(c, dados));
  }

  // Mantém compatibilidade com strings legacy ("campo op valor")
  function _avaliarCondicao(condicao, dados) {
    if (!condicao?.trim()) return true;
    try {
      const m = condicao.trim().match(/^(\w+)\s*(==|!=|>=|<=|>|<)\s*(\S.*)/);
      if (!m) return true;
      const [, campo, op, valorRaw] = m;
      const valorStr = valorRaw.trimEnd().replace(/^['"]|['"]$/g, '');
      // Normaliza: == vira =
      const opNorm = op === '==' ? '=' : op;
      const fn = _WF_OPS[opNorm];
      if (!fn) return true;
      const valorNumero = Number(valorStr);
      const valComp = Number.isNaN(valorNumero) ? valorStr : valorNumero;
      return fn(dados[campo], valComp);
    } catch { return true; }
  }

  function _wfNomeUsuario(uid, vazio = '—') {
    if (!uid) return vazio;
    if (uid === 'sistema') return '⚙ Sistema';
    const u = (globalScope.USUARIOS || []).find(x => x.uid === uid || x.id === uid);
    return u?.nome || u?.email || uid;
  }

  function _proximoNo(canvas, noId, acao, dados = {}) {
    const arestas = canvas.arestas || [];
    const nos = canvas.nos || [];
    const candidatas = arestas.filter(a =>
      a.origem === noId && (acao == null || a.acao === acao || !a.acao)
    );
    const padrão = candidatas.find(a => a.padrao);
    const condicionais = candidatas.filter(a => !a.padrao);
    const arestaCondicional = condicionais.find((arestaAtual) => {
      if (arestaAtual.condicoes?.length) {
        return _avaliarCondicoes(arestaAtual.condicoes, arestaAtual.operador_logico, dados);
      }
      return _avaliarCondicao(arestaAtual.condicao, dados);
    });
    let aresta = arestaCondicional || padrão || null;
    if (acao != null && aresta == null) {
      aresta = arestas.find(a => a.origem === noId) || null;
    }
    if (aresta == null) return null;
    const destino = nos.find(n => n.id === aresta.destino);
    if (!destino) return null;
    if (destino.tipo === 'inicio') return _proximoNo(canvas, destino.id, null, dados);
    return destino;
  }

  function _proximoNoExecutavel(canvas, noId, acao, dados = {}) {
    const visitados = new Set();
    let atualId = noId;
    let acaoAtual = acao;

    while (atualId && !visitados.has(atualId)) {
      visitados.add(atualId);
      const prox = _proximoNo(canvas, atualId, acaoAtual, dados);
      if (!prox) return null;
      if (prox.tipo === 'fim') return prox;
      if (prox.tipo !== 'aprovacao') return prox;
      atualId = prox.id;
      acaoAtual = null;
    }
    return null;
  }

  // ── Template Engine ───────────────────────────────────────────────────────

  function _interpolarTemplate(tmpl, ctx) {
    const template = tmpl ?? '';
    return template.replace(/\{\{([\w.]+)\}\}/g, (_, chave) => {
      const val = chave.split('.').reduce((o, k) => (o != null ? o[k] : ''), ctx);
      return val == null ? '' : String(val);
    });
  }

  // ── Histórico ─────────────────────────────────────────────────────────────
  async function wfAbrirHistorico(instanciaId, titulo, status) {
    _st.instanciaAtual = { id: instanciaId, titulo, status };
    document.getElementById('wf-hist-titulo').textContent = titulo;

    const statusLabels = { em_andamento:'Em andamento', concluido:'Concluído', cancelado:'Cancelado' };
    const statusCores = { em_andamento:'#3b82f6', concluido:'#10b981', cancelado:'#ef4444' };

    const podeCancelar = status === 'em_andamento' && (globalScope.isEP?.() || globalScope.isGestor?.());
    document.getElementById('wf-hist-btn-cancelar').style.display = podeCancelar ? '' : 'none';
    const podeExcluir = globalScope.isEP?.();
    const btnExcluir = document.getElementById('wf-hist-btn-excluir');
    if (btnExcluir) btnExcluir.style.display = podeExcluir ? '' : 'none';

    document.getElementById('wf-hist-resumo').innerHTML =
      `<div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">
        <div><div style="font-size:11px;color:var(--ink3)">Status</div>${_badge(statusLabels[status] || status, statusCores[status] || '#6b7280')}</div>
        <div><div style="font-size:11px;color:var(--ink3)">ID</div><div style="font-size:12px;font-family:monospace">${_esc(instanciaId)}</div></div>
      </div>`;

    const tl = document.getElementById('wf-hist-timeline');
    tl.innerHTML = '<div style="color:var(--ink3);font-size:14px">Carregando…</div>';
    try {
      const eventos = (await _wfApiRequest('wfInstanciaItem', `/${encodeURIComponent(instanciaId)}/historico`)).sort((a, b) => {
        const ta = a._criado_em?.seconds ?? (a._criado_em ? a._criado_em.getTime() / 1000 : 0);
        const tb = b._criado_em?.seconds ?? (b._criado_em ? b._criado_em.getTime() / 1000 : 0);
        return ta - tb;
      });
      const ACAO_LABELS = globalScope.WF_ACAO_LABELS;
      const ACAO_COR = globalScope.WF_ACAO_COR;
      const PAPEL_LABELS = globalScope.WF_PAPEL_LABELS;
      tl.innerHTML = eventos.length ? eventos.map(h => {
        let ts = '—';
        if (h._criado_em?.toDate) ts = h._criado_em.toDate().toLocaleString('pt-BR');
        else if (h._criado_em?.seconds) ts = new Date(h._criado_em.seconds * 1000).toLocaleString('pt-BR');
        const d = h.dados ?? {};
        const usuario = _wfNomeUsuario(h.usuario_uid, null);
        const acaoBadge = d.acao ? _badge(ACAO_LABELS?.[d.acao] || d.acao, ACAO_COR?.[d.acao] || '#6b7280') : '';
        const papelTxt = d.papel ? `<span style="font-size:11px;color:var(--ink3)"> · ${_esc(PAPEL_LABELS?.[d.papel] || d.papel)}</span>` : '';
        const parecer = d.parecer ? `<div style="font-size:12px;color:var(--ink2);margin-top:4px;font-style:italic">"${_esc(d.parecer)}"</div>` : '';
        const usuarioTxt = usuario ? ` · ${_esc(usuario)}` : '';
        return `<div style="position:relative;margin-bottom:16px;padding-left:16px">
          <div style="position:absolute;left:-5px;top:4px;width:10px;height:10px;border-radius:50%;background:var(--blue);border:2px solid #fff;box-shadow:0 0 0 2px var(--blue)"></div>
          <div style="font-size:11px;color:var(--ink3)">${_esc(ts)}${usuarioTxt}${papelTxt}</div>
          <div style="font-size:13px;color:var(--ink);display:flex;align-items:center;gap:8px;flex-wrap:wrap">${_esc(h.descricao || h.tipo_evento)} ${acaoBadge}</div>
          ${parecer}
        </div>`;
      }).join('') : '<div style="color:var(--ink3);font-size:14px">Nenhum evento registrado.</div>';
    } catch (e) {
      tl.innerHTML = `<div style="color:var(--red);font-size:14px">${_esc(e.message)}</div>`;
    }

    // Comentários agrupados por etapa
    const elComentPorEtapa = document.getElementById('wf-hist-comentarios-por-etapa');
    if (elComentPorEtapa) {
      try {
        const todosComentarios = await _wfBuscarComentarios({ instanciaId });

        if (todosComentarios.length === 0) {
          elComentPorEtapa.innerHTML = '<div style="color:var(--ink3);font-size:13px">Nenhum comentário registrado.</div>';
        } else {
          // Agrupa por etapa_nome (ou etapa_id)
          const grupos = {};
          const ordemGrupos = [];
          todosComentarios.forEach(c => {
            const chave = c.etapa_nome || c.etapa_id || 'Sem etapa';
            if (grupos[chave] == null) { grupos[chave] = []; ordemGrupos.push(chave); }
            grupos[chave].push(c);
          });
          elComentPorEtapa.innerHTML = ordemGrupos.map(chave => {
            const divGrupo = document.createElement('div');
            divGrupo.style.cssText = 'margin-bottom:20px';
            const titulo = document.createElement('div');
            titulo.style.cssText = 'font-size:12px;font-weight:600;color:var(--blue);margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px';
            titulo.textContent = chave;
            const corpo = document.createElement('div');
            _renderThreadComentarios(grupos[chave], corpo, false);
            divGrupo.appendChild(titulo);
            divGrupo.appendChild(corpo);
            return divGrupo.outerHTML;
          }).join('');
        }
      } catch (e) {
        console.warn('[WF] Falha ao carregar comentários por etapa:', e?.message || e);
        elComentPorEtapa.innerHTML = '';
      }
    }

    wfNavWorkflow('historico');
  }

  async function wfConfirmarCancelar(instanciaId) {
    const motivo = prompt('Motivo do cancelamento:');
    if (motivo === null) return;
    await _wfApiRequest('wfInstanciaItem', `/${encodeURIComponent(instanciaId)}/cancelar`, {
      method: 'POST',
      body: { motivo },
    });
    wfCarregarInstancias();
  }

  async function wfCancelarInstancia() {
    if (!_st.instanciaAtual) return;
    await wfConfirmarCancelar(_st.instanciaAtual.id);
    wfNavWorkflow('instancias');
  }

  async function wfExcluirInstancia(instanciaId) {
    if (!confirm('Excluir este processo? O histórico será preservado para auditoria.')) return;
    try {
      await _wfApiRequest('wfInstanciaItem', `/${encodeURIComponent(instanciaId)}/excluir`, {
        method: 'POST',
      });
      wfNavWorkflow(_st.painelAtual === 'historico' ? 'instancias' : (_st.painelAtual || 'instancias'));
      wfCarregarInstancias();
      if (_st.painelAtual === 'solicitacoes') wfCarregarSolicitacoes();
    } catch (e) {
      alert('Erro ao excluir: ' + e.message);
    }
  }

  function wfExcluirInstanciaAtual() {
    const instancia = _st.instanciaAtual;
    if (!instancia?.id) return;
    wfExcluirInstancia(instancia.id);
  }

  // ── Formulários ───────────────────────────────────────────────────────────
  async function wfCarregarFormularios() {
    const el = document.getElementById('wf-lista-formularios');
    if (!el) return;
    el.innerHTML = '<div style="color:var(--ink3);font-size:14px">Carregando…</div>';
    try {
      const modelos = await _getAll('wf_formulario_modelos');
      _st.formularioModelos = modelos;
      if (!modelos.length) {
        el.innerHTML = '<div style="color:var(--ink3);font-size:14px">Nenhum formulário cadastrado. Clique em "+ Formulário" para criar.</div>';
        return;
      }
      el.innerHTML = modelos.map(m => _card(`
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
          <div style="flex:1">
            <div style="font-weight:600;font-size:14px;margin-bottom:4px">${_esc(m.titulo)}</div>
            <div style="font-size:12px;color:var(--ink3)">${(m.campos || []).length} campo(s) · versão ${_esc(String(m.versao || 1))}</div>
          </div>
          <button type="button" class="btn btn-sm" onclick="wfAbrirModalNovoFormulario('${_esc(m.id)}')">Editar</button>
        </div>
      `)).join('');
    } catch (e) {
      el.innerHTML = `<div style="color:var(--red);font-size:14px">${_esc(e.message)}</div>`;
    }
  }

  const _tiposCampo = [
    { v: 'texto',    l: 'Texto curto' },
    { v: 'textarea', l: 'Texto longo' },
    { v: 'numero',   l: 'Número' },
    { v: 'data',     l: 'Data' },
    { v: 'select',   l: 'Lista de opções' },
    { v: 'checkbox', l: 'Caixa de seleção' },
  ];

  async function wfAbrirModalNovoFormulario(formularioId) {
    _st.formularioOrigem = arguments.length > 1 ? arguments[1] : null;
    let schema = null;
    if (formularioId) {
      schema = await _getDoc('wf_formulario_modelos', formularioId);
    }
    _st.formularioAtual = schema || { id: null, titulo: '', campos: [], versao: 1 };
    _st.formularioCampos = structuredClone(_st.formularioAtual.campos || []);

    const overlay = document.getElementById('wf-modal-formulario');
    if (!overlay) return;

    document.getElementById('wf-modal-form-titulo').value = _st.formularioAtual.titulo || '';
    _wfRenderizarCamposEditor();
    overlay.style.display = 'flex';
  }

  const _tipoLabels = { texto:'Texto', numero:'Número', data:'Data', select:'Seleção', textarea:'Texto longo', checkbox:'Sim/Não', arquivo:'Arquivo' };

  function _wfRenderizarCamposEditor() {
    const el = document.getElementById('wf-modal-form-campos');
    if (!el) return;
    if (!_st.formularioCampos.length) {
      el.innerHTML = `<div class="wf-fields-empty"><span class="wf-fields-empty-icon">📋</span>Nenhum campo adicionado ainda.<br><span style="font-size:12px">Clique em "+ Adicionar campo" para começar.</span></div>`;
      return;
    }
    el.innerHTML = _st.formularioCampos.map((c, i) => {
      const tipoLabel = _tipoLabels[c.tipo] || c.tipo;
      return `
      <div class="wf-field-card">
        <div class="wf-field-card-hd">
          <span class="wf-field-card-drag" title="Reordenar">⠿</span>
          <span class="wf-field-card-label">${_esc(c.label || 'Campo sem nome')}</span>
          <span class="wf-field-type-badge">${_esc(tipoLabel)}</span>
          <div class="wf-field-card-actions">
            ${i > 0 ? `<button type="button" class="wf-field-action-btn" onclick="_wfMoverCampo(${i},-1)" title="Mover para cima">↑</button>` : ''}
            ${i < _st.formularioCampos.length - 1 ? `<button type="button" class="wf-field-action-btn" onclick="_wfMoverCampo(${i},1)" title="Mover para baixo">↓</button>` : ''}
            <button type="button" class="wf-field-action-btn del" onclick="_wfRemoverCampo(${i})" title="Remover campo">✕</button>
          </div>
        </div>
        <div class="wf-field-card-body">
          <div class="wf-field-col">
            <label class="lbl" for="wf-campo-label-${i}">Nome do campo</label>
            <input type="text" class="fi" id="wf-campo-label-${i}" value="${_esc(c.label)}" placeholder="Ex.: Nome completo" oninput="_wfAtualizarCampo(${i},'label',this.value)">
          </div>
          <div class="wf-field-col">
            <label class="lbl" for="wf-campo-tipo-${i}">Tipo de resposta</label>
            <select class="fi" id="wf-campo-tipo-${i}" onchange="_wfAtualizarCampo(${i},'tipo',this.value)">
              ${_tiposCampo.map(t => `<option value="${_esc(t.v)}"${c.tipo===t.v?' selected':''}>${_esc(t.l)}</option>`).join('')}
            </select>
          </div>
          ${(c.tipo === 'select' || c.tipo === 'checkbox') ? `
          <div class="wf-field-col wf-field-card-full">
            <label class="lbl">${c.tipo === 'checkbox' ? 'Opções de marcação' : 'Opções de seleção'} <span style="font-weight:400;text-transform:none;letter-spacing:0">(uma por linha)</span></label>
            <textarea class="fi" rows="3" placeholder="Opção 1&#10;Opção 2&#10;Opção 3" oninput="_wfAtualizarCampo(${i},'_opcoesTexto',this.value)">${_esc((c.opcoes||[]).join('\n'))}</textarea>
          </div>` : ''}
        </div>
        <label class="wf-field-required">
          <input type="checkbox" ${c.obrigatorio?'checked':''} onchange="_wfAtualizarCampo(${i},'obrigatorio',this.checked)">
          Preenchimento obrigatório
        </label>
      </div>`;
    }).join('');
  }

  function _wfAtualizarCampo(idx, campo, valor) {
    if (!_st.formularioCampos[idx]) return;
    if (campo === '_opcoesTexto') {
      _st.formularioCampos[idx].opcoes = valor.split('\n').map(s => s.trim()).filter(Boolean);
    } else {
      _st.formularioCampos[idx][campo] = valor;
    }
    // Re-renderiza apenas se mudou o tipo (para mostrar/ocultar campo de opções)
    if (campo === 'tipo') _wfRenderizarCamposEditor();
  }

  function _wfAdicionarCampo() {
    _st.formularioCampos.push({
      id: `campo_${Date.now()}`,
      label: '',
      tipo: 'texto',
      obrigatorio: false,
      opcoes: [],
    });
    _wfRenderizarCamposEditor();
  }

  function _wfRemoverCampo(idx) {
    _st.formularioCampos.splice(idx, 1);
    _wfRenderizarCamposEditor();
  }

  function _wfMoverCampo(idx, dir) {
    const alvo = idx + dir;
    if (alvo < 0 || alvo >= _st.formularioCampos.length) return;
    const tmp = _st.formularioCampos[idx];
    _st.formularioCampos[idx] = _st.formularioCampos[alvo];
    _st.formularioCampos[alvo] = tmp;
    _wfRenderizarCamposEditor();
  }

  function wfFecharModalFormulario() {
    const overlay = document.getElementById('wf-modal-formulario');
    if (overlay) overlay.style.display = 'none';
    _st.formularioOrigem = null;
  }

  function _wfAtualizarSelectFormularioEtapa(formularioSelecionadoId) {
    const sel = document.getElementById('wf-etapa-form');
    if (!sel) return;
    const valorAtual = formularioSelecionadoId || sel.value || '';
    sel.innerHTML = '<option value="">— Sem formulário —</option>'
      + (_st.formularioModelos || []).map(m => `<option value="${_esc(m.id)}">${_esc(m.titulo || m.nome)}</option>`).join('');
    if (valorAtual) sel.value = valorAtual;
    _wfAtualizarAcoesFormularioEtapa();
  }

  function _wfAtualizarAcoesFormularioEtapa() {
    const sel = document.getElementById('wf-etapa-form');
    const btnEditar = document.getElementById('wf-etapa-form-editar');
    if (!btnEditar) return;
    const formularioId = sel?.value || '';
    btnEditar.disabled = !formularioId;
  }

  function _wfAtualizarSelectFormularioNo(noId, formularioSelecionadoId) {
    const sel = document.getElementById(`wf-designer-form-${noId}`);
    if (!sel) return;
    const valorAntes = sel.value || '';
    const valorAtual = formularioSelecionadoId || valorAntes || '';
    sel.innerHTML = '<option value="">— Sem formulário —</option>'
      + (_st.formularioModelos || []).map(m => `<option value="${_esc(m.id)}">${_esc(m.titulo || m.nome)}</option>`).join('');
    if (valorAtual) sel.value = valorAtual;
    const valorDepois = sel.value || '';
    if (valorDepois !== valorAntes) wfDesignerCampoCfg(noId, 'formulario_id', valorDepois || null);
    _wfAtualizarAcoesFormularioNo(noId);
  }

  function _wfAtualizarAcoesFormularioNo(noId) {
    const sel = document.getElementById(`wf-designer-form-${noId}`);
    const btnEditar = document.getElementById(`wf-designer-form-editar-${noId}`);
    if (!btnEditar) return;
    btnEditar.disabled = !(sel?.value || '');
  }

  async function wfSalvarFormulario() {
    const titulo = document.getElementById('wf-modal-form-titulo').value.trim();
    if (!titulo) { alert('Informe o título do formulário.'); return; }

    const campos = _st.formularioCampos.map(c => ({
      id: c.id || `campo_${Date.now()}`,
      label: c.label || '',
      tipo: c.tipo || 'texto',
      obrigatorio: !!c.obrigatorio,
      opcoes: c.opcoes || [],
    }));

    try {
      const schema = _st.formularioAtual;
      let formularioSalvoId = schema.id || null;
      if (schema.id) {
        await _updateDoc('wf_formulario_modelos', schema.id, {
          titulo,
          campos,
          versao: (schema.versao || 1) + 1,
        });
      } else {
        formularioSalvoId = await _addDoc('wf_formulario_modelos', {
          titulo,
          campos,
          versao: 1,
        });
      }

      try {
        _st.formularioModelos = await _getAll('wf_formulario_modelos');
      } catch (error_) {
        _wfReportarErroNaoCritico('atualizacao da lista de modelos de formulario', error_);
      }

      if (_st.formularioOrigem === 'etapa') {
        _wfAtualizarSelectFormularioEtapa(formularioSalvoId || schema.id || '');
      } else if (_st.formularioOrigem?.startsWith('designer:')) {
        const noId = _st.formularioOrigem.slice('designer:'.length);
        _wfAtualizarSelectFormularioNo(noId, formularioSalvoId || schema.id || '');
      }

      wfFecharModalFormulario();
      wfCarregarFormularios();
    } catch (e) {
      alert('Erro ao salvar formulário: ' + e.message);
    }
  }

  // ── P3: Thread de comentários ─────────────────────────────────────────────

  // Renderiza thread de comentários em um elemento — reutilizado no painel de execução
  function _renderThreadComentarios(comentarios, containerEl, interativo = true) {
    const raizes = comentarios.filter(c => !c.respondendo_a);
    const respostasPor = {};
    comentarios.filter(c => c.respondendo_a).forEach(c => {
      if (!respostasPor[c.respondendo_a]) respostasPor[c.respondendo_a] = [];
      respostasPor[c.respondendo_a].push(c);
    });
    const renderComentario = (c, nivel = 0) => {
      const ts = c._criado_em?.seconds
        ? new Date(c._criado_em.seconds * 1000).toLocaleString('pt-BR') : '—';
      const respostas = respostasPor[c.id] || [];
      const indent = nivel > 0 ? 'border-left:3px solid var(--bdr);margin-left:20px;padding-left:12px;' : '';
      return `
        <div style="${indent}margin-bottom:10px" data-comentario-id="${_esc(c.id)}">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
            <span style="font-weight:600;font-size:13px">${_esc(_wfNomeUsuario(c.autor_uid))}</span>
            <span style="font-size:11px;color:var(--ink3)">${ts}</span>
            ${interativo && nivel === 0 ? `<button type="button" class="btn btn-sm" style="margin-left:auto;font-size:11px;padding:2px 8px"
              onclick="wfResponderComentario('${_esc(c.id)}','${_esc(_wfNomeUsuario(c.autor_uid))}')">Responder</button>` : ''}
          </div>
          <div style="font-size:13px;color:var(--ink);white-space:pre-wrap">${_esc(c.texto)}</div>
          ${respostas.map(r => renderComentario(r, nivel + 1)).join('')}
        </div>`;
    };
    containerEl.innerHTML = raizes.length
      ? raizes.map(c => renderComentario(c)).join('')
      : '<div style="color:var(--ink3);font-size:13px">Nenhum comentário.</div>';
  }

  async function wfCarregarComentarios(tarefaId) {
    const el = document.getElementById('wf-exec-comentarios');
    if (!el) return;
    el.innerHTML = '<div style="color:var(--ink3);font-size:13px">Carregando comentários…</div>';
    try {
      const comentarios = await _wfBuscarComentarios({ tarefaId });
      _renderThreadComentarios(comentarios, el, true);
    } catch (e) {
      el.innerHTML = `<div style="color:#ef4444;font-size:13px">Erro: ${_esc(e.message)}</div>`;
    }
  }

  function wfResponderComentario(comentarioId, nomeAutor) {
    _st._respondendoA = comentarioId;
    const area = document.getElementById('wf-exec-comentario-texto');
    if (area) { area.placeholder = `Respondendo a ${nomeAutor}…`; area.focus(); }
    const badge = document.getElementById('wf-exec-respondendo-badge');
    if (badge) {
      badge.style.display = 'flex';
      const span = badge.querySelector('span');
      if (span) span.textContent = `↩ Respondendo a ${nomeAutor}`;
    }
  }

  function wfCancelarResposta() {
    _st._respondendoA = null;
    const area = document.getElementById('wf-exec-comentario-texto');
    if (area) area.placeholder = 'Escreva um comentário sobre esta etapa…';
    const badge = document.getElementById('wf-exec-respondendo-badge');
    if (badge) badge.style.display = 'none';
  }

  async function wfEnviarComentario() {
    if (!_st.tarefaAtual?.id) return;
    const area = document.getElementById('wf-exec-comentario-texto');
    const texto = area?.value?.trim();
    if (!texto) return;
    try {
      await _wfApiRequest('wfComentarios', '', {
        method: 'POST',
        body: {
          tarefa_id: _st.tarefaAtual.id,
          instancia_id: _st.tarefaAtual.instancia_id,
          etapa_id: _st.tarefaAtual.etapa_modelo_id || null,
          etapa_nome: _st.tarefaAtual.etapa_nome || null,
          texto,
          respondendo_a: _st._respondendoA || null,
        },
      });
      area.value = '';
      wfCancelarResposta();
      await wfCarregarComentarios(_st.tarefaAtual.id);
    } catch (e) {
      alert('Erro ao enviar comentário: ' + e.message);
    }
  }

  // ── P3: Exportação do histórico ────────────────────────────────────────────

  async function wfExportarHistoricoCSV() {
    if (!_st.instanciaAtual?.id) return;
    try {
      const { where } = globalScope.fb();
      const eventos = (await _getAll('wf_historico_workflows',
        where('instancia_id', '==', _st.instanciaAtual.id),
      )).sort((a, b) => (a._criado_em?.seconds ?? 0) - (b._criado_em?.seconds ?? 0));

      const comentariosCSV = await _wfBuscarComentarios({ instanciaId: _st.instanciaAtual.id });

      const esc = v => `"${String(v ?? '').replaceAll('"', '""')}"`;
      const linhas = [
        ['Data/Hora', 'Tipo', 'Usuário', 'Etapa', 'Ação', 'Parecer', 'Descrição/Comentário'].map(esc).join(','),
        ...eventos.map(h => {
          const ts = h._criado_em?.seconds
            ? new Date(h._criado_em.seconds * 1000).toLocaleString('pt-BR') : '';
          const d = h.dados ?? {};
          return [ts, h.tipo_evento, _wfNomeUsuario(h.usuario_uid, ''), h.etapa_id || '',
            d.acao || '', d.parecer || '', h.descricao || ''].map(esc).join(',');
        }),
        ...comentariosCSV.map(c => {
          const seconds = c.criado_em?.seconds ?? c._criado_em?.seconds ?? 0;
          const ts = seconds
            ? new Date(seconds * 1000).toLocaleString('pt-BR') : '';
          return [ts, 'comentario', _wfNomeUsuario(c.autor_uid, ''), c.etapa_nome || c.etapa_id || '',
            '', '', c.texto || ''].map(esc).join(',');
        }),
      ];
      const bom = '﻿'; // BOM para Excel reconhecer UTF-8
      const blob = new Blob([bom + linhas.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `historico_${_st.instanciaAtual.id}_${new Date().toISOString().slice(0,10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert('Erro ao exportar: ' + e.message);
    }
  }

  async function wfExportarHistoricoPDF() {
    if (!_st.instanciaAtual?.id) return;
    try {
      const { where } = globalScope.fb();
      const [eventos, comentarios] = await Promise.all([
        _getAll('wf_historico_workflows', where('instancia_id', '==', _st.instanciaAtual.id)),
        _wfBuscarComentarios({ instanciaId: _st.instanciaAtual.id }),
      ]);
      eventos.sort((a, b) => (a._criado_em?.seconds ?? 0) - (b._criado_em?.seconds ?? 0));
      comentarios.sort((a, b) => (a.criado_em?.seconds ?? a._criado_em?.seconds ?? 0) - (b.criado_em?.seconds ?? b._criado_em?.seconds ?? 0));

      const esc = v => String(v ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
      const ts = s => s?.seconds ? new Date(s.seconds * 1000).toLocaleString('pt-BR') : '—';

      const linhasEventos = eventos.map(h => {
        const d = h.dados ?? {};
        return `<tr>
          <td>${esc(ts(h._criado_em))}</td>
          <td>${esc(h.tipo_evento)}</td>
          <td>${esc(_wfNomeUsuario(h.usuario_uid))}</td>
          <td>${esc(h.descricao || '')}</td>
          <td>${esc(d.acao || '')}</td>
          <td>${esc(d.parecer || '')}</td>
        </tr>`;
      }).join('');

      // Agrupa comentários por etapa para o PDF
      const gruposComent = {};
      const ordemGrupos = [];
      comentarios.forEach(c => {
        const chave = c.etapa_nome || c.etapa_id || 'Sem etapa';
        if (gruposComent[chave] == null) { gruposComent[chave] = []; ordemGrupos.push(chave); }
        gruposComent[chave].push(c);
      });
      const secaoComentarios = ordemGrupos.length ? `<h2>Comentários por etapa</h2>` + ordemGrupos.map(chave => {
        const linhas = gruposComent[chave].map(c => {
          const indent = c.respondendo_a ? 'padding-left:20px;color:#555' : '';
          return `<tr><td style="${indent}">${esc(ts(c.criado_em || c._criado_em))}</td><td style="${indent}">${esc(_wfNomeUsuario(c.autor_uid))}</td><td style="${indent}">${esc(c.texto)}</td></tr>`;
        }).join('');
        return `<h3 style="font-size:11px;color:#3b82f6;text-transform:uppercase;margin:12px 0 4px">${esc(chave)}</h3>
        <table><thead><tr><th>Data/Hora</th><th>Autor</th><th>Comentário</th></tr></thead><tbody>${linhas}</tbody></table>`;
      }).join('') : '';

      const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
        <title>Histórico — ${esc(_st.instanciaAtual.titulo || _st.instanciaAtual.id)}</title>
        <style>
          body { font-family: Arial, sans-serif; font-size: 12px; color: #111; padding: 24px; }
          h1 { font-size: 16px; margin-bottom: 4px; }
          .sub { color: #666; font-size: 11px; margin-bottom: 20px; }
          table { border-collapse: collapse; width: 100%; margin-bottom: 24px; }
          th { background: #f3f4f6; text-align: left; padding: 6px 8px; font-size: 11px; border-bottom: 2px solid #e5e7eb; }
          td { padding: 5px 8px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
          h2 { font-size: 13px; margin: 20px 0 8px; }
          h3 { font-size: 11px; }
          @media print { body { padding: 0; } }
        </style>
      </head><body>
        <h1>Histórico do Processo</h1>
        <div class="sub">${esc(_st.instanciaAtual.titulo || _st.instanciaAtual.id)} · Exportado em ${new Date().toLocaleString('pt-BR')}</div>
        <h2>Eventos</h2>
        <table><thead><tr><th>Data/Hora</th><th>Evento</th><th>Usuário</th><th>Descrição</th><th>Ação</th><th>Parecer</th></tr></thead>
        <tbody>${linhasEventos}</tbody></table>
        ${secaoComentarios}
      </body></html>`;

      const win = window.open('', '_blank');
      if (!win) { alert('Permita pop-ups para exportar PDF.'); return; }
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const pdfUrl = URL.createObjectURL(blob);
      win.location.replace(pdfUrl);
      win.onload = () => {
        win.focus();
        win.print();
        URL.revokeObjectURL(pdfUrl);
      };
    } catch (e) {
      alert('Erro ao gerar PDF: ' + e.message);
    }
  }

  // ── P3: Delegação de tarefa ───────────────────────────────────────────────

  async function wfExcluirTarefa(tarefaId) {
    if (!confirm('Excluir esta tarefa permanentemente? Esta ação não pode ser desfeita.')) return;
    try {
      await _wfApiRequest('wfTarefas', `/${encodeURIComponent(tarefaId)}/excluir`, {
        method: 'POST',
      });
      wfCarregarTarefas();
    } catch (e) {
      alert('Erro ao excluir tarefa: ' + e.message);
    }
  }

  function wfAbrirDelegacao(tarefaId) {
    _st._delegacaoTarefaId = tarefaId;
    const modal = document.getElementById('wf-modal-delegacao');
    if (!modal) return;
    const sel = document.getElementById('wf-delegacao-usuario');
    if (sel) {
      const usuarios = globalScope.USUARIOS || [];
      sel.innerHTML = `<option value="">— Selecione —</option>` +
        usuarios.filter(u => u.uid || u.id).map(u =>
          `<option value="${_esc(u.uid || u.id)}">${_esc(u.nome || u.email || u.uid || u.id)}</option>`
        ).join('');
    }
    document.getElementById('wf-delegacao-motivo').value = '';
    modal.style.display = 'flex';
  }

  function wfFecharDelegacao() {
    const modal = document.getElementById('wf-modal-delegacao');
    if (modal) modal.style.display = 'none';
    _st._delegacaoTarefaId = null;
  }

  async function wfConfirmarDelegacao() {
    const tarefaId = _st._delegacaoTarefaId;
    if (!tarefaId) return;
    const novoUid = document.getElementById('wf-delegacao-usuario')?.value;
    const motivo = document.getElementById('wf-delegacao-motivo')?.value || '';
    if (!novoUid) { alert('Selecione um usuário.'); return; }
    try {
      await _wfApiRequest('wfTarefas', `/${encodeURIComponent(tarefaId)}/delegar`, {
        method: 'POST',
        body: {
          novo_responsavel_uid: novoUid,
          motivo,
        },
      });
      wfFecharDelegacao();
      wfCarregarTarefas();
    } catch (e) {
      alert('Erro ao delegar: ' + e.message);
    }
  }

  // ── P3: Suspender / Retomar instância ────────────────────────────────────

  async function wfSuspenderInstancia(instanciaId) {
    if (!confirm('Suspender este processo? Ele poderá ser retomado depois.')) return;
    try {
      await _wfApiRequest('wfInstanciaItem', `/${encodeURIComponent(instanciaId)}/suspender`, {
        method: 'POST',
      });
      wfCarregarInstancias();
    } catch (e) {
      alert('Erro ao suspender: ' + e.message);
    }
  }

  async function wfRetomarInstancia(instanciaId) {
    if (!confirm('Retomar este processo?')) return;
    try {
      await _wfApiRequest('wfInstanciaItem', `/${encodeURIComponent(instanciaId)}/retomar`, {
        method: 'POST',
      });
      wfCarregarInstancias();
    } catch (e) {
      alert('Erro ao retomar: ' + e.message);
    }
  }

  // ── P3: Marcar todas as notificações como lidas ───────────────────────────

  async function wfMarcarTodasLidas() {
    try {
      await _wfApiRequest('wfNotificacoes', '/marcar-todas-lidas', { method: 'POST' });
      _wfRenderNotifPanel();
    } catch (e) {
      alert('Erro: ' + e.message);
    }
  }

  // ── P3: Dashboard de métricas ─────────────────────────────────────────────

  // ── Aba Equipes ──────────────────────────────────────────────────────────────

  // Cache de usuários com uid (coleção usuarios/{uid})
  async function _wfCarregarUsersComUid() {
    if (_st._usersComUid) return _st._usersComUid;
    try {
      const { collection, getDocs } = globalScope.fb();
      const snap = await getDocs(collection(_db(), 'usuarios'));
      _st._usersComUid = [];
      snap.forEach(d => _st._usersComUid.push({ uid: d.id, ...d.data() }));
    } catch (error_) {
      _wfReportarErroNaoCritico('carregamento de usuarios com uid', error_);
      _st._usersComUid = [];
    }
    return _st._usersComUid;
  }

  function wfEquipesAba(aba) {
    ['grupos','usuarios'].forEach(s => {
      const sec = document.getElementById(`wf-equipes-sec-${s}`);
      if (sec) sec.style.display = s === aba ? '' : 'none';
      const btn = document.getElementById(`wf-equipes-tab-${s}`);
      if (btn) btn.style.fontWeight = s === aba ? '700' : '';
    });
    if (aba === 'grupos') wfCarregarGrupos();
    else wfCarregarEquipesUsuarios();
  }

  async function wfCarregarEquipes() {
    wfEquipesAba('grupos');
  }

  // ── Grupos: listagem ─────────────────────────────────────────────────────────

  async function wfCarregarGrupos() {
    const el = document.getElementById('wf-lista-grupos');
    if (!el) return;
    el.innerHTML = '<div style="color:var(--ink3);font-size:14px">Carregando…</div>';
    const isEp = globalScope.isEP?.();
    try {
      const [grupos] = await Promise.all([_getAll('wf_grupos'), _wfCarregarUsersComUid()]);
      if (!grupos.length) {
        el.innerHTML = '<div style="color:var(--ink3);font-size:14px">Nenhum grupo cadastrado.</div>';
        return;
      }
      const usuarios = globalScope.USUARIOS || [];
      el.innerHTML = grupos.map(g => {
        const emails = g.membros_email || [];
        const membros = _wfMembrosGrupoTexto(g, usuarios);
        const acoes = _wfAcoesGrupoHtml(g, isEp);
        return `<div style="background:var(--surf2);border-radius:10px;padding:16px">
          <div style="font-weight:600;font-size:14px;margin-bottom:4px">${_esc(g.nome || '(sem nome)')}</div>
          ${g.descricao ? `<div style="font-size:12px;color:var(--ink3);margin-bottom:8px">${_esc(g.descricao)}</div>` : ''}
          <div style="font-size:12px;color:var(--ink3)"><strong>${emails.length} membro(s):</strong> ${membros}</div>
          ${acoes}
        </div>`;
      }).join('');
    } catch (e) {
      el.innerHTML = `<div style="color:var(--red,#dc2626);font-size:13px">Erro: ${_esc(e.message)}</div>`;
    }
  }

  // ── Grupos: modal criar/editar ───────────────────────────────────────────────

  async function wfAbrirModalGrupo(grupoId) {
    _st._grupoEditandoId = grupoId || null;
    const modal = document.getElementById('wf-modal-grupo');
    if (!modal) return;
    document.getElementById('wf-modal-grupo-titulo').textContent = grupoId ? 'Editar grupo' : 'Novo grupo';
    document.getElementById('wf-grupo-nome').value = '';
    document.getElementById('wf-grupo-descricao').value = '';
    modal.style.display = 'flex';

    // USUARIOS é a fonte correta — identificados por email (não uid)
    const membrosEl = document.getElementById('wf-grupo-membros-lista');
    const usuarios = (globalScope.USUARIOS || [])
      .filter(u => u.email && (u.nome || u.email))
      .sort((a, b) => (a.nome || a.email).localeCompare(b.nome || b.email));

    const PERFIL_LABEL = { ep:'EP', dono:'Dono', gestor:'Gestor', solicitante:'Solicitante', gerente_projeto:'Gerente' };
    if (usuarios.length === 0) {
      membrosEl.innerHTML = '<div style="color:var(--ink3);font-size:12px;padding:8px">Nenhum usuário cadastrado.</div>';
    } else {
      membrosEl.innerHTML = usuarios.map(u => {
        const email = _esc(u.email);
        const nome = _esc(u.nome || u.email);
        const perfil = u.perfil ? `<span class="wf-member-chip-perfil">${_esc(PERFIL_LABEL[u.perfil] || u.perfil)}</span>` : '';
        return `<label class="wf-member-chip">
          <input type="checkbox" class="wf-grupo-membro-cb" value="${email}">
          <span class="wf-member-chip-name">${nome}</span>
          ${perfil}
        </label>`;
      }).join('');
    }

    if (grupoId) {
      const g = await _getDoc('wf_grupos', grupoId);
      if (g) {
        document.getElementById('wf-grupo-nome').value = g.nome || '';
        document.getElementById('wf-grupo-descricao').value = g.descricao || '';
        // suporta membros_email (novo) e membros_uid legado (emails também eram guardados como uid em alguns casos)
        const membrosAtuais = g.membros_email || g.membros_uid || [];
        membrosAtuais.forEach(val => {
          const cb = membrosEl.querySelector(`input[value="${CSS.escape(val)}"]`);
          if (cb) cb.checked = true;
        });
      }
    }
  }

  function wfFecharModalGrupo() {
    const modal = document.getElementById('wf-modal-grupo');
    if (modal) modal.style.display = 'none';
    _st._grupoEditandoId = null;
  }

  async function wfSalvarGrupo() {
    const nome = document.getElementById('wf-grupo-nome')?.value?.trim();
    if (!nome) { alert('Informe o nome do grupo.'); return; }
    const descricao = document.getElementById('wf-grupo-descricao')?.value?.trim() || '';
    const membros_email = [...document.querySelectorAll('.wf-grupo-membro-cb:checked')].map(cb => cb.value);
    const payload = { nome, descricao, membros_email };
    try {
      const id = _st._grupoEditandoId;
      if (id) {
        await _updateDoc('wf_grupos', id, payload);
      } else {
        await _addDoc('wf_grupos', payload);
      }
      wfFecharModalGrupo();
      wfCarregarGrupos();
      // Invalida cache de grupos para próxima carga de tarefas
      _st.meusGrupos = null;
      if (typeof globalScope.toast === 'function') globalScope.toast('✓ Grupo salvo');
    } catch (e) {
      alert('Erro ao salvar grupo: ' + e.message);
    }
  }

  async function wfExcluirGrupo(grupoId) {
    if (!confirm('Excluir este grupo? Esta ação não pode ser desfeita.')) return;
    try {
      await _deleteDoc('wf_grupos', grupoId);
      _st.meusGrupos = null;
      _st._usersComUid = null;
      wfCarregarGrupos();
      if (typeof globalScope.toast === 'function') globalScope.toast('Grupo excluído');
    } catch (e) {
      alert('Erro ao excluir grupo: ' + e.message);
    }
  }

  // ── Usuários: listagem com grupos ────────────────────────────────────────────

  async function wfCarregarEquipesUsuarios() {
    const el = document.getElementById('wf-lista-equipes-usuarios');
    if (!el) return;
    el.innerHTML = '<div style="color:var(--ink3);font-size:14px">Carregando…</div>';
    try {
      // USUARIOS é a fonte correta — carregado de config/usuarios via fbLoad()
      const usuarios = (globalScope.USUARIOS || []).filter(u => u.email);
      const grupos = await _getAll('wf_grupos');
      const LABELS = globalScope.PERFIL_LABELS;

      if (usuarios.length === 0) {
        el.innerHTML = '<div style="color:var(--ink3);font-size:14px">Nenhum usuário encontrado. Verifique se o sistema está carregado.</div>';
        return;
      }
      const rows = usuarios
        .sort((a, b) => (a.nome || a.email).localeCompare(b.nome || b.email))
        .map(u => {
          const perfisFallback = u.perfis || (u.perfil ? [u.perfil] : []);
          const perfis = globalScope.getPerfisUsuario
            ? globalScope.getPerfisUsuario(u)
            : perfisFallback;
          const perfilStr = _esc(perfis.map(p => LABELS[p] || p).join(', ') || '—');
          const gruposNomes = grupos
            .filter(g => (g.membros_email || g.membros_uid || []).includes(u.email))
            .map(g => _esc(g.nome)).join(', ') || '—';
          return `<tr style="border-bottom:1px solid var(--bdr)">
            <td style="padding:8px 10px;font-size:13px">${_esc(u.nome || u.email)}</td>
            <td style="padding:8px 10px;font-size:12px;color:var(--ink3)">${_esc(u.email)}</td>
            <td style="padding:8px 10px;font-size:12px">${perfilStr}</td>
            <td style="padding:8px 10px;font-size:12px">${gruposNomes}</td>
          </tr>`;
        }).join('');
      el.innerHTML = `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">
        <thead><tr style="border-bottom:2px solid var(--bdr)">
          <th style="text-align:left;padding:8px 10px;font-size:12px;color:var(--ink3);white-space:nowrap">Nome</th>
          <th style="text-align:left;padding:8px 10px;font-size:12px;color:var(--ink3);white-space:nowrap">E-mail</th>
          <th style="text-align:left;padding:8px 10px;font-size:12px;color:var(--ink3);white-space:nowrap">Perfil</th>
          <th style="text-align:left;padding:8px 10px;font-size:12px;color:var(--ink3);white-space:nowrap">Grupos</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
    } catch (e) {
      el.innerHTML = `<div style="color:var(--red,#dc2626);font-size:13px">Erro: ${_esc(e.message)}</div>`;
    }
  }

  async function wfCarregarSolicitacoes() {
    const el = document.getElementById('wf-lista-solicitacoes');
    if (!el) return;
    el.innerHTML = '<div style="color:var(--ink3);font-size:14px">Carregando…</div>';
    try {
      const uid = _uid();
      if (!uid) { el.innerHTML = '<div style="color:var(--ink3);font-size:14px">Usuário não autenticado.</div>'; return; }
      const { where } = globalScope.fb();
      const instancias = await _getAll('wf_instancia_processos', where('solicitante_uid', '==', uid));
      const instanciasAtivas = instancias.filter(i => !i.excluida);
      if (!instanciasAtivas.length) {
        el.innerHTML = '<div style="color:var(--ink3);font-size:14px">Você ainda não iniciou nenhum processo.</div>';
        return;
      }
      const STATUS_COR = globalScope.WF_STATUS_INSTANCIA_COR || { em_andamento:'#3b82f6', concluido:'#10b981', cancelado:'#ef4444', suspenso:'#f59e0b' };
      const STATUS_LABELS = globalScope.WF_STATUS_INSTANCIA_LABELS || { em_andamento:'Em Andamento', concluido:'Concluído', cancelado:'Cancelado', suspenso:'Suspenso' };
      instanciasAtivas.sort((a, b) => (b._criado_em?.seconds || 0) - (a._criado_em?.seconds || 0));
      el.innerHTML = instanciasAtivas.map(inst => {
        const cor = STATUS_COR[inst.status] || '#6b7280';
        const label = STATUS_LABELS[inst.status] || (inst.status || '');
        const criado = inst._criado_em?.toDate ? inst._criado_em.toDate().toLocaleDateString('pt-BR') : '—';
        return _card(`
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
            <div style="flex:1">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
                <div style="font-weight:600;font-size:14px">${_esc(inst.titulo || inst.processo_nome || inst.id)}</div>
                ${_badge(label, cor)}
              </div>
              ${inst.etapa_atual_nome ? `<div style="font-size:12px;color:var(--ink3)">Etapa atual: <strong>${_esc(inst.etapa_atual_nome)}</strong></div>` : ''}
              ${inst.responsavel_atual_nome ? `<div style="font-size:12px;color:var(--ink3)">Com: ${_esc(inst.responsavel_atual_nome)}</div>` : ''}
              <div style="font-size:11px;color:var(--ink3);margin-top:4px">Iniciado em ${criado}</div>
            </div>
            <button type="button" class="btn btn-sm" onclick="wfAbrirHistorico('${_esc(inst.id)}')">Histórico</button>
          </div>
        `);
      }).join('');
    } catch (e) {
      el.innerHTML = `<div style="color:var(--red);font-size:14px">${_esc(e.message)}</div>`;
    }
  }

  // ── Modelagem: lista de modelos ───────────────────────────────────────────
  async function wfCarregarModelos() {
    const el = document.getElementById('wf-lista-modelos');
    if (!el) return;
    el.innerHTML = '<div style="color:var(--ink3);font-size:14px">Carregando…</div>';
    try {
      const modelos = await _getAll('wf_processo_modelos');
      if (!modelos.length) {
        el.innerHTML = '<div style="color:var(--ink3);font-size:14px">Nenhum modelo criado. Clique em "+ Novo modelo" para começar.</div>';
        return;
      }
      const STATUS_COR = globalScope.WF_STATUS_PROCESSO_MODELO_COR || { rascunho:'#f59e0b', publicado:'#10b981', arquivado:'#6b7280' };
      const STATUS_LABELS = globalScope.WF_STATUS_PROCESSO_MODELO_LABELS || { rascunho:'Rascunho', publicado:'Publicado', arquivado:'Arquivado' };
      el.innerHTML = modelos.map(m => {
        const cor = STATUS_COR[m.status] || '#6b7280';
        const label = STATUS_LABELS[m.status] || (m.status || '');
        const etapas = m.etapas || m.canvas?.nos?.filter(n => n.tipo !== 'inicio' && n.tipo !== 'fim') || [];
        return _card(`
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
            <div style="flex:1">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
                <div style="font-weight:600;font-size:14px">${_esc(m.nome)}</div>
                ${_badge(label, cor)}
              </div>
              ${m.descricao ? `<div style="font-size:12px;color:var(--ink3);margin-bottom:4px">${_esc(m.descricao)}</div>` : ''}
              <div style="font-size:11px;color:var(--ink3)">${etapas.length} etapa(s)</div>
            </div>
            <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">
              <button type="button" class="btn btn-sm" onclick="wfAbrirConfigModelo('${_esc(m.id)}')">Editar</button>
              ${m.status === 'publicado' ? '' : `<button type="button" class="btn btn-p btn-sm" onclick="_wfPublicarModeloId('${_esc(m.id)}')">Publicar</button>`}
              <button type="button" class="btn btn-r btn-sm" onclick="wfExcluirModelo('${_esc(m.id)}')">Excluir</button>
            </div>
          </div>
        `);
      }).join('');
    } catch (e) {
      el.innerHTML = `<div style="color:var(--red);font-size:14px">${_esc(e.message)}</div>`;
    }
  }

  async function wfAbrirModalNovoModelo() {
    _wfAbrirModalDinamico('wf-modal-novo-modelo', `
      <div class="modal-hd"><span>Novo modelo de workflow</span><button type="button" class="modal-x" onclick="_wfFecharModalDinamico('wf-modal-novo-modelo')">✕</button></div>
      <div class="modal-bd">
        <label class="lbl">Nome do modelo</label>
        <input id="wf-new-model-name" class="fi" style="margin-top:4px;margin-bottom:10px" placeholder="Ex.: Aprovação de Documento">
        <label class="lbl">Template institucional</label>
        <select id="wf-new-model-template" class="fi" style="margin-top:4px">${_wfTemplateCardHtml()}</select>
      </div>
      <div class="modal-ft">
        <button type="button" class="btn btn-p" onclick="wfConfirmarNovoModelo()">Criar</button>
        <button type="button" class="btn" onclick="_wfFecharModalDinamico('wf-modal-novo-modelo')">Cancelar</button>
      </div>
    `);
  }

  async function wfConfirmarNovoModelo() {
    const nome = (document.getElementById('wf-new-model-name')?.value || '').trim();
    const templateId = document.getElementById('wf-new-model-template')?.value || 'vazio';
    if (!nome) { alert('Informe o nome do modelo.'); return; }
    try {
      const payload = {
        nome,
        descricao: '',
        status: 'rascunho',
        versao: 1,
        bpmn_xml: _wfBpmnInicial(),
      };
      if (templateId !== 'vazio') {
        const bpmnXml = _wfBpmnFromTemplate(templateId);
        payload.bpmn_xml = bpmnXml;
        payload.config_nos = _wfConfigNosDoBpmn(bpmnXml);
        _wfAjustarTemplateConfigNos(templateId, payload.config_nos);
      }
      const id = await _addDoc('wf_processo_modelos', payload);
      _wfFecharModalDinamico('wf-modal-novo-modelo');
      await wfAbrirConfigModelo(id);
    } catch (e) {
      alert('Erro ao criar modelo: ' + e.message);
    }
  }

  async function wfExcluirModelo(modeloId) {
    if (!modeloId) return;
    if (!confirm('Excluir este modelo? Esta ação não pode ser desfeita.')) return;
    try {
      const { where } = globalScope.fb();
      const instancias = await _getAll('wf_instancia_processos', where('modelo_id', '==', modeloId));
      const emUso = instancias.filter(i => !i.excluida && i.status !== 'cancelado');
      if (emUso.length) {
        alert('Este modelo possui instâncias ativas e não pode ser excluído.');
        return;
      }
      await _deleteDoc('wf_processo_modelos', modeloId);
      if (_wfModeloAtual?.id === modeloId) {
        _wfModeloAtual = null;
        wfNavWorkflow('modelagem');
      }
      wfCarregarModelos();
    } catch (e) {
      alert('Erro ao excluir modelo: ' + e.message);
    }
  }

  async function wfAbrirConfigModelo(modeloId) {
    // Salva alterações pendentes do modelo anterior antes de trocar
    if (_wfTemAlteracoesPendentes() && _wfModeloAtual) {
      await wfDesignerSalvar({ silent: true }).catch(() => {});
    }
    const [modelo] = await Promise.all([
      _getDoc('wf_processo_modelos', modeloId),
      _getAll('wf_grupos').then(g => { _st.grupos = g; }).catch(() => {}),
      _st.formularioModelos.length ? Promise.resolve() : _getAll('wf_formulario_modelos').then(f => { _st.formularioModelos = f; }).catch(() => {}),
    ]);
    if (!modelo) { alert('Modelo não encontrado.'); return; }
    _wfModeloAtual = modelo;
    // Sempre sincroniza _wfConfigNos com o modelo carregado do Firestore
    Object.keys(_wfConfigNos).forEach(k => delete _wfConfigNos[k]);
    Object.assign(_wfConfigNos, modelo.config_nos ?? {});
    _wfPrepararCamposCabecalhoDesigner(modelo);
    _wfLimparAutosavePendente();
    _wfAtualizarIndicadorSujo(false);
    const tituloEl = document.getElementById('wf-config-titulo');
    if (tituloEl) tituloEl.textContent = modelo.nome;
    const statusEl = document.getElementById('wf-config-status-badge');
    if (statusEl) {
      const cor = globalScope.WF_STATUS_PROCESSO_MODELO_COR?.[modelo.status] || '#6b7280';
      const label = globalScope.WF_STATUS_PROCESSO_MODELO_LABELS?.[modelo.status] || (modelo.status || '');
      statusEl.textContent = label;
      statusEl.style.background = cor + '22';
      statusEl.style.color = cor;
    }
    const pubBtn = document.getElementById('wf-btn-publicar');
    if (pubBtn) pubBtn.style.display = modelo.status === 'rascunho' ? '' : 'none';
    _wfRenderArqInfo(modelo);
    wfNavWorkflow('config-modelo');
    setTimeout(() => _wfInitModeler(modelo), 0);
  }


  function _wfRenderArqInfo(modelo) {
    const el = document.getElementById('wf-config-arq-info');
    if (!el) return;
    if (modelo.processo_origem_id && modelo.processo_origem_nome) {
      el.textContent = modelo.processo_origem_nome;
    } else {
      el.textContent = 'Nenhum processo vinculado.';
    }
  }

  async function wfAbrirModalVincularArquitetura() {
    const processos = await _getAll('processos').catch(() => []);
    const opts = processos.map(p => `<option value="${_esc(p.id)}">${_esc(p.nome)}</option>`).join('');
    _wfAbrirModalDinamico('wf-modal-arq', `
      <div class="modal-hd"><span>Vincular processo mapeado</span><button type="button" class="modal-x" onclick="_wfFecharModalDinamico('wf-modal-arq')">✕</button></div>
      <div class="modal-bd">
        <label class="lbl">Processo</label>
        <select class="fi" id="wf-arq-sel" style="margin-top:4px;width:100%"><option value="">Selecione…</option>${opts}</select>
      </div>
      <div class="modal-ft">
        <button type="button" class="btn btn-p" onclick="_wfSalvarVinculoArq()">Vincular</button>
        <button type="button" class="btn" onclick="_wfFecharModalDinamico('wf-modal-arq')">Cancelar</button>
      </div>
    `);
  }

  async function _wfSalvarVinculoArq() {
    if (!_wfModeloAtual) return;
    const sel = document.getElementById('wf-arq-sel');
    const id = sel?.value;
    if (!id) { alert('Selecione um processo.'); return; }
    const opt = sel?.options?.[sel.selectedIndex];
    const nome = opt?.textContent || id;
    const updates = { processo_origem_id: id, processo_origem_nome: nome };

    // Se o modelo ainda está em branco, importa automaticamente o BPMN do processo vinculado.
    if (!_wfModeloTemDesenho(_wfModeloAtual) || _wfModeloUsaFluxoInicialPadrao(_wfModeloAtual)) {
      const proc = await _getDoc('processos', id).catch(() => null);
      const importado = proc ? _wfDadosImportadosDoMapeamento(proc) : null;
      if (importado) {
        updates.bpmn_xml = importado.bpmn_xml;
        updates.fluxo_origem = importado.fluxo_origem;
        updates.config_nos = importado.config_nos;
      }
    }

    await _updateDoc('wf_processo_modelos', _wfModeloAtual.id, updates);
    Object.assign(_wfModeloAtual, updates);
    if (updates.config_nos) {
      Object.keys(_wfConfigNos).forEach(k => delete _wfConfigNos[k]);
      Object.assign(_wfConfigNos, updates.config_nos);
      _wfInitModeler(_wfModeloAtual);
    }
    _wfFecharModalDinamico('wf-modal-arq');
    _wfRenderArqInfo(_wfModeloAtual);
  }

  function _wfAbrirModalDinamico(id, html) {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      el.className = 'modal-overlay';
      el.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:2600;display:flex;align-items:flex-start;justify-content:center;padding-top:48px';
      document.body.appendChild(el);
    }
    el.innerHTML = `<div class="modal" style="max-width:640px;width:min(96vw,640px);max-height:88vh;display:flex;flex-direction:column;background:var(--surf,#fff);border:1px solid var(--bdr,#dcd9cf);border-radius:12px;box-shadow:var(--sh2,0 8px 28px rgba(0,0,0,.25));overflow:hidden">${html}</div>`;
    el.style.display = 'flex';
  }

  function _wfFecharModalDinamico(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }

  async function wfPublicarModelo() {
    if (!_wfModeloAtual) return;
    if (_wfModeler) await wfDesignerSalvar();
    const validacao = _wfValidarModeloPublicacao(_wfModeloAtual);
    if (!validacao.ok) {
      alert('Não foi possível publicar:\n\n- ' + validacao.erros.join('\n- '));
      return;
    }
    if (validacao.avisos.length) {
      const confirmar = confirm('Avisos encontrados:\n\n- ' + validacao.avisos.join('\n- ') + '\n\nDeseja continuar mesmo assim?');
      if (!confirmar) return;
    }
    if (!confirm(`Publicar o modelo "${_wfModeloAtual.nome}"? Após publicado ele estará disponível para iniciar processos.`)) return;
    try {
      await _updateDoc('wf_processo_modelos', _wfModeloAtual.id, { status: 'publicado' });
      _wfModeloAtual.status = 'publicado';
      const statusEl = document.getElementById('wf-config-status-badge');
      if (statusEl) { statusEl.textContent = 'Publicado'; statusEl.style.background = '#10b98122'; statusEl.style.color = '#10b981'; }
      const pubBtn = document.getElementById('wf-btn-publicar');
      if (pubBtn) pubBtn.style.display = 'none';
      alert('Modelo publicado com sucesso!');
    } catch (e) {
      alert('Erro ao publicar: ' + e.message);
    }
  }

  async function _wfPublicarModeloId(modeloId) {
    if (!confirm('Publicar este modelo?')) return;
    try {
      const modelo = await _getDoc('wf_processo_modelos', modeloId);
      if (!modelo) { alert('Modelo não encontrado.'); return; }
      const validacao = _wfValidarModeloPublicacao(modelo);
      if (!validacao.ok) {
        alert('Não foi possível publicar:\n\n- ' + validacao.erros.join('\n- '));
        return;
      }
      await _updateDoc('wf_processo_modelos', modeloId, { status: 'publicado' });
      wfCarregarModelos();
    } catch (e) {
      alert('Erro ao publicar: ' + e.message);
    }
  }

  function _wfCamposModeloParaSimulacao(modelo) {
    const out = {};
    const cfgNos = modelo?.id === _wfModeloAtual?.id ? _wfConfigNos : (modelo?.config_nos ?? {});
    const registrarCampo = (condicao) => {
      if (condicao?.campo == null || out[condicao.campo]) return;
      out[condicao.campo] = { id: condicao.campo, label: condicao.campo, tipo: 'texto', opcoes: [] };
    };
    for (const id of Object.keys(cfgNos)) {
      const cfg = cfgNos[id] ?? {};
      (cfg.condicoes ?? []).forEach(registrarCampo);
      (cfg.acoes_condicionais ?? []).forEach(c => registrarCampo({ campo: c.campo }));
      (cfg.campos_condicionais ?? []).forEach((campoCondicional) => {
        (campoCondicional.condicoes ?? []).forEach(registrarCampo);
      });
      const form = (_st.formularioModelos || []).find(f => f.id === cfg.formulario_id);
      for (const campo of (form?.campos || [])) {
        const fid = campo.id || campo.label;
        if (!fid) continue;
        out[fid] = {
          id: fid,
          label: campo.label || fid,
          tipo: campo.tipo || 'texto',
          opcoes: campo.opcoes || [],
        };
      }
    }
    return Object.values(out);
  }

  function _wfCampoHtmlSimulacao(campo) {
    const options = campo.tipo === 'select' && campo.opcoes?.length
      ? `<select class="fi" data-sim-campo="${_esc(campo.id)}" style="margin-top:4px;width:100%">
              <option value="">(vazio)</option>
              ${campo.opcoes.map(o => `<option value="${_esc(o)}">${_esc(o)}</option>`).join('')}
            </select>`
      : `<input class="fi" data-sim-campo="${_esc(campo.id)}" style="margin-top:4px;width:100%" placeholder="Valor de ${_esc(campo.label)}">`;
    return `<div style="margin-bottom:12px"><label class="lbl" style="font-size:12px">${_esc(campo.label)}</label>${options}</div>`;
  }

  function _wfAcaoHtmlSimulacao(no) {
    const cfg = _wfConfigNos[no.id] ?? {};
    const acoes = cfg.acoes?.length ? cfg.acoes : ['avancar'];
    const labelsAcao = globalScope.WF_ACAO_LABELS;
    const opcoesAcao = acoes.map(a => `<option value="${_esc(a)}">${_esc(labelsAcao?.[a] || a)}</option>`).join('');
    return `<div style="margin-bottom:12px"><label class="lbl" style="font-size:12px">Ação escolhida na etapa ${_esc(no.nome || no.id)}</label>
      <select class="fi" data-sim-acao="${_esc(no.id)}" style="margin-top:4px;width:100%">${opcoesAcao}</select></div>`;
  }

  function wfDesignerSimular() {
    if (!_wfModeloAtual) { alert('Abra um modelo antes de simular.'); return; }
    const canvas = _wfModeler ? _wfSyncCanvas() : (_wfModeloAtual.canvas || { nos: [], arestas: [] });
    const campos = _wfCamposModeloParaSimulacao(_wfModeloAtual);
    const nosExecutaveis = (canvas.nos || []).filter(n => n.tipo === 'tarefa' || n.tipo === 'aprovacao');
    const camposHtml = [
      ...(campos.length ? campos.map(_wfCampoHtmlSimulacao) : ['<div style="color:var(--ink3);font-size:13px">Nenhum campo condicional identificado no modelo.</div>']),
      ...nosExecutaveis.map(_wfAcaoHtmlSimulacao),
    ].join('');

    const camposEl = document.getElementById('wf-sim-campos');
    const resultEl = document.getElementById('wf-sim-resultado');
    if (camposEl) camposEl.innerHTML = camposHtml;
    if (resultEl) resultEl.innerHTML = '';
    const modal = document.getElementById('wf-modal-simulacao');
    if (modal) modal.style.display = 'flex';
  }

  function wfExecutarSimulacao() {
    if (!_wfModeloAtual) return;
    const canvas = _wfModeler ? _wfSyncCanvas() : (_wfModeloAtual.canvas || { nos: [], arestas: [] });
    const dados = {};
    document.querySelectorAll('#wf-sim-campos [data-sim-campo]').forEach((el) => {
      dados[el.dataset.simCampo] = el.value || '';
    });
    const acoesPorNo = {};
    document.querySelectorAll('#wf-sim-campos [data-sim-acao]').forEach((el) => {
      acoesPorNo[el.dataset.simAcao] = el.value || 'avancar';
    });

    const caminho = [];
    const explicacao = [];
    const visitados = new Set();
    const inicio = (canvas.nos || []).find(n => n.tipo === 'inicio');
    if (!inicio) {
      const resultEl0 = document.getElementById('wf-sim-resultado');
      if (resultEl0) resultEl0.innerHTML = '<div style="color:var(--red);font-size:13px">Modelo sem evento de início.</div>';
      return;
    }

    let atual = _proximoNoExecutavel(canvas, inicio.id, null, dados);
    while (atual && !visitados.has(atual.id) && caminho.length < 80) {
      caminho.push(atual);
      visitados.add(atual.id);
      if (atual.tipo === 'fim') break;
      const acao = acoesPorNo[atual.id] || 'avancar';
      const prox = _proximoNoExecutavel(canvas, atual.id, acao, dados);
      explicacao.push(`Na etapa "${atual.nome || atual.id}", ação "${acao}" levou para "${prox?.nome || prox?.id || 'fim'}".`);
      atual = prox;
    }

    const resultEl = document.getElementById('wf-sim-resultado');
    if (!resultEl) return;
    if (!caminho.length) { resultEl.innerHTML = '<div style="color:var(--ink3);font-size:13px">Nenhum caminho encontrado.</div>'; return; }
    const ICONE = globalScope.WF_TIPO_ETAPA_ICONE || { tarefa:'📋', aprovacao:'✅' };
    resultEl.innerHTML = `
      <div style="font-size:12px;font-weight:600;text-transform:uppercase;color:var(--ink3);margin-bottom:8px">Caminho simulado</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">
        ${caminho.map((e, i) => `
          ${i > 0 ? '<span style="color:var(--ink3)">→</span>' : ''}
          <span style="background:var(--blue-l);border:1px solid var(--blue-b);border-radius:20px;padding:4px 12px;font-size:12px">${ICONE[e.tipo]||'📋'} ${_esc(e.nome||e.label||e.id)}</span>
        `).join('')}
      </div>
      <div style="margin-top:10px;padding:10px;border-radius:8px;background:var(--surf2)">
        <div style="font-size:12px;font-weight:600;color:var(--ink2);margin-bottom:6px">Explicação da decisão</div>
        ${explicacao.length ? explicacao.map(t => `<div style="font-size:12px;color:var(--ink2);margin-bottom:4px">• ${_esc(t)}</div>`).join('') : '<div style="font-size:12px;color:var(--ink3)">Sem decisões intermediárias.</div>'}
      </div>
    `;
  }

  // ── Iniciar processo: wfIniciarProcesso e wfExibirDetalhesModelo ──────────
  async function wfIniciarProcesso() {
    const sel = document.getElementById('wf-np-modelo');
    const id = sel?.value;
    if (!id) { alert('Selecione um processo para iniciar.'); return; }
    await wfIniciarDeModelo(id);
  }

  async function wfExibirDetalhesModelo() {
    const sel = document.getElementById('wf-np-modelo');
    const det = document.getElementById('wf-np-detalhes');
    if (!det) return;
    const id = sel?.value;
    if (!id) { det.style.display = 'none'; return; }
    try {
      const m = await _getDoc('wf_processo_modelos', id);
      if (!m) { det.style.display = 'none'; return; }
      const etapas = m.canvas?.nos?.filter(n => n.tipo !== 'inicio' && n.tipo !== 'fim') || [];
      const descricaoHtml = m.descricao
        ? `<p style="margin:6px 0 0;font-size:12px;color:var(--ink3)">${_esc(m.descricao)}</p>`
        : '';
      det.innerHTML = `<strong>${_esc(m.nome)}</strong>${descricaoHtml}<p style="margin:6px 0 0;font-size:11px;color:var(--ink3)">${etapas.length} etapa(s)</p>`;
      det.style.display = '';
    } catch { det.style.display = 'none'; }
  }

  // ── Modal de formulário de abertura do processo ───────────────────────────
  let _wfInicioFormCallback = null;

  function wfCancelarInicioForm() {
    const modal = document.getElementById('wf-modal-inicio-form');
    if (modal) modal.style.display = 'none';
    _wfInicioFormCallback = null;
  }

  async function wfConfirmarInicioForm() {
    const formEl = document.getElementById('wf-inicio-form-campos');
    if (!formEl || !_wfInicioFormCallback) return;
    // Coleta dados do formulário renderizado
    const campos = formEl.querySelectorAll('[data-campo-id]');
    const dados = {};
    for (const grupo of campos) {
      const id = grupo.dataset.campoId;
      const input = grupo.querySelector(`#wf-campo-${id}`);
      if (!input) continue;
      dados[id] = input.type === 'checkbox' ? input.checked : input.value.trim();
    }
    const modal = document.getElementById('wf-modal-inicio-form');
    if (modal) modal.style.display = 'none';
    _wfInicioFormCallback(dados);
    _wfInicioFormCallback = null;
  }

  // ── Visão Admin — todas as tarefas ───────────────────────────────────────
  let _adminTarefasCache = null;

  async function wfCarregarAdminTarefas() {
    const tbody = document.getElementById('wf-admin-tabela-body');
    const contador = document.getElementById('wf-admin-contador');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" style="padding:20px;text-align:center;color:var(--ink3)">Carregando…</td></tr>';
    try {
      const status = document.getElementById('wf-admin-filtro-status')?.value || '';
      const qs = status ? `?admin=true&status=${encodeURIComponent(status)}` : '?admin=true';
      _adminTarefasCache = await _wfApiRequest('wfTarefas', qs);
      _wfAdminRenderTabela(_adminTarefasCache, contador, tbody);
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6" style="padding:20px;text-align:center;color:var(--red)">${_esc(err?.message || 'Erro ao carregar tarefas.')}</td></tr>`;
    }
  }

  function wfAdminRecarregar() {
    _adminTarefasCache = null;
    wfCarregarAdminTarefas();
  }

  function wfAdminFiltrar() {
    if (!_adminTarefasCache) return;
    const tbody = document.getElementById('wf-admin-tabela-body');
    const contador = document.getElementById('wf-admin-contador');
    const q = (document.getElementById('wf-admin-filtro-texto')?.value || '').toLowerCase();
    const filtrado = q
      ? _adminTarefasCache.filter(t =>
          (t.processo_nome || '').toLowerCase().includes(q) ||
          (t.etapa_nome || '').toLowerCase().includes(q) ||
          (t._responsavel_nome || '').toLowerCase().includes(q) ||
          (t._responsavel_email || '').toLowerCase().includes(q)
        )
      : _adminTarefasCache;
    _wfAdminRenderTabela(filtrado, contador, tbody);
  }

  function _wfAdminRenderTabela(tarefas, contador, tbody) {
    if (contador) contador.textContent = `${tarefas.length} tarefa${tarefas.length !== 1 ? 's' : ''}`;
    if (!tarefas.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="padding:20px;text-align:center;color:var(--ink3)">Nenhuma tarefa encontrada.</td></tr>';
      return;
    }
    const statusLabel = { pendente: 'Pendente', em_execucao: 'Em execução', vencida: 'Vencida' };
    const statusCor = { pendente: '#3b82f6', em_execucao: '#f59e0b', vencida: '#ef4444' };
    tbody.innerHTML = tarefas.map((t, i) => {
      const prazoTs = t.prazo?._seconds ? t.prazo._seconds * 1000 : (t.prazo ? new Date(t.prazo).getTime() : null);
      const prazoStr = prazoTs ? new Date(prazoTs).toLocaleDateString('pt-BR') : '—';
      const vencida = prazoTs && prazoTs < Date.now();
      const cor = statusCor[t.status] || '#6b7280';
      const lbl = statusLabel[t.status] || t.status;
      const bg = i % 2 === 0 ? 'transparent' : 'var(--surf)';
      return `<tr style="background:${bg};border-bottom:1px solid var(--bdr)">
        <td style="padding:8px 10px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${_esc(t.processo_nome || '')}">${_esc(t.processo_nome || t.instancia_id || '—')}</td>
        <td style="padding:8px 10px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(t.etapa_nome || t.etapa_modelo_id || '—')}</td>
        <td style="padding:8px 10px">
          <div style="font-weight:600">${_esc(t._responsavel_nome || '—')}</div>
          ${t._responsavel_email ? `<div style="font-size:11px;color:var(--ink3)">${_esc(t._responsavel_email)}</div>` : ''}
          ${!t.responsavel_uid ? `<span style="font-size:10px;background:#fef3c7;color:#92400e;padding:1px 5px;border-radius:3px">${_esc(t.papel_alvo || 'sem responsável')}</span>` : ''}
        </td>
        <td style="padding:8px 10px"><span style="background:${cor};color:#fff;font-size:11px;padding:2px 7px;border-radius:10px">${_esc(lbl)}</span></td>
        <td style="padding:8px 10px;color:${vencida ? '#ef4444' : 'inherit'};font-weight:${vencida ? '600' : 'normal'}">${prazoStr}${vencida ? ' ⚠' : ''}</td>
        <td style="padding:8px 10px;white-space:nowrap">
          <button type="button" class="btn btn-sm" onclick="wfAbrirTarefa('${_esc(t.id)}')">Ver</button>
          <button type="button" class="btn btn-r btn-sm" onclick="wfExcluirTarefa('${_esc(t.id)}')">Excluir</button>
        </td>
      </tr>`;
    }).join('');
  }

  // ── Exposição global ──────────────────────────────────────────────────────
  Object.assign(globalScope, {
    rWorkflow,
    wfNavWorkflow,
    wfCarregarTarefas,
    wfAbrirTarefa,
    wfAssumirTarefa,
    wfConcluirTarefa,
    wfAnexarArquivos,
    wfRemoverAnexo,
    wfCarregarInstancias,
    wfCarregarProcessosMapeados,
    wfCarregarIniciar,
    wfCarregarSolicitacoes,
    wfIniciarAba,
    wfCarregarTemplatesPublicados,
    wfIniciarDeProcesso,
    wfIniciarDeModelo,
    wfConfirmarAtribuicao,
    wfCancelarAtribuicao,
    // Designer
    wfImportarMapeamento,
    wfAbrirDesigner,
    wfDesignerSetMode,
    wfDesignerAplicarAutoFixPublicacao,
    wfDesignerAplicarPreset,
    wfDesignerRemoverArestaSel,
    wfDesignerCampoCfg,
    wfDesignerPapel,
    wfDesignerToggleAcao,
    wfDesignerSetDestinoDevolucao,
    wfDesignerAddAcaoCond,
    wfDesignerAcaoCondRemove,
    wfDesignerAcaoCondUpdate,
    wfDesignerAddCondicao,
    wfDesignerRemoveCondicao,
    wfDesignerUpdateCondicao,
    wfDesignerArestaPadrao,
    wfDesignerAddCampoCond,
    wfDesignerCampoCondRemove,
    wfDesignerCampoCondUpdate,
    wfDesignerCampoCondAddCond,
    wfDesignerCampoCondRemoveCond,
    wfDesignerCampoCondCond,
    _avaliarCamposCondicionais,
    wfDesignerSalvar,
    wfDesignerPublicar,
    wfAbrirHistorico,
    wfCancelarInstancia,
    wfExcluirInstancia,
    wfExcluirInstanciaAtual,
    wfConfirmarCancelar,
    wfCarregarComentarios,
    wfResponderComentario,
    wfCancelarResposta,
    wfEnviarComentario,
    wfExportarHistoricoCSV,
    wfExportarHistoricoPDF,
    wfMarcarNotifLida,
    wfMarcarTodasLidas,
    wfExcluirTarefa,
    wfAbrirDelegacao,
    wfFecharDelegacao,
    wfConfirmarDelegacao,
    wfSuspenderInstancia,
    wfRetomarInstancia,
    wfCarregarEquipes,
    wfEquipesAba,
    wfCarregarGrupos,
    wfAbrirModalGrupo,
    wfFecharModalGrupo,
    wfSalvarGrupo,
    wfExcluirGrupo,
    wfCarregarEquipesUsuarios,
    // Admin
    wfCarregarAdminTarefas,
    wfAdminRecarregar,
    wfAdminFiltrar,
    // Formulários
    wfCarregarFormularios,
    wfAbrirModalNovoFormulario,
    wfFecharModalFormulario,
    wfSalvarFormulario,
    _wfAtualizarAcoesFormularioEtapa,
    _wfAtualizarAcoesFormularioNo,
    _wfAdicionarCampo,
    _wfRenderizarCamposEditor,
    _wfAtualizarCampo,
    _wfRemoverCampo,
    _wfMoverCampo,
    // Modelagem nova
    wfCarregarModelos,
    wfAbrirModalNovoModelo,
    wfConfirmarNovoModelo,
    wfExcluirModelo,
    wfAbrirConfigModelo,
    wfPublicarModelo,
    _wfPublicarModeloId,
    wfAbrirModalVincularArquitetura,
    _wfSalvarVinculoArq,
    _wfFecharModalDinamico,
    wfDesignerSimular,
    wfExecutarSimulacao,
    // Iniciar processo (novo)
    wfIniciarProcesso,
    wfExibirDetalhesModelo,
    // Formulário de abertura
    wfCancelarInicioForm,
    wfConfirmarInicioForm,
    _st,
  });

  // Tecla Delete remove o nó/aresta selecionado no designer
  document.addEventListener('keydown', (evt) => {
    if (_st.painelAtual !== 'config-modelo' && _st.painelAtual !== 'designer') return;
    if (evt.key !== 'Delete' && evt.key !== 'Backspace') return;
    const tag = (evt.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if (_st.designerArestaSel) { evt.preventDefault(); wfDesignerRemoverArestaSel(); }
    else if (_st.designerNoSel) { evt.preventDefault(); _designerRemoverNo(_st.designerNoSel); }
  });

})(globalThis);
