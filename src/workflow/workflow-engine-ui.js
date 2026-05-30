(function initWorkflowUI(globalScope) {
  'use strict';

  // ── Estado interno do módulo ──────────────────────────────────────────────
  const _st = {
    painelAtual: 'tarefas',
    instanciaAtual: null,
    tarefaAtual: null,
    formularioAtual: null,
    formularioCampos: [],
    configProcessoId: null,
    configProcessoEtapas: [],
    formularioModelos: [],
    // Designer visual
    designerModelo: null,
    designerNoSel: null,
    designerArestaSel: null,
    designerDrag: null,
    iniciarAba: 'mapeamento',
    // Paginação
    tarefasCursor: null,      // último doc do Firestore para paginação
    instanciasCursor: null,
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

  async function _getAll(colNome, ...queryConstraints) {
    const { getDocs, query } = globalScope.fb();
    const q = queryConstraints.length
      ? query(_col(colNome), ...queryConstraints)
      : _col(colNome);
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  async function _getDoc(colNome, id) {
    const { getDoc } = globalScope.fb();
    const snap = await getDoc(_docRef(colNome, id));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() };
  }

  async function _addDoc(colNome, dados) {
    const { addDoc } = globalScope.fb();
    const ref = await addDoc(_col(colNome), { ...dados, _criado_em: new Date() });
    return ref.id;
  }

  async function _updateDoc(colNome, id, dados) {
    const { updateDoc } = globalScope.fb();
    await updateDoc(_docRef(colNome, id), { ...dados, _atualizado_em: new Date() });
  }

  async function _setDoc(colNome, id, dados) {
    const { setDoc } = globalScope.fb();
    await setDoc(_docRef(colNome, id), { ...dados, _atualizado_em: new Date() }, { merge: true });
  }

  async function _deleteDoc(colNome, id) {
    const { deleteDoc } = globalScope.fb();
    await deleteDoc(_docRef(colNome, id));
  }

  // ── Helpers de UI ─────────────────────────────────────────────────────────
  function _esc(v) {
    return typeof globalScope.esc === 'function'
      ? globalScope.esc(v)
      : String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
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

  // ── Navegação interna do módulo ───────────────────────────────────────────
  const _paineis = ['tarefas','instancias','iniciar','executar','historico','formularios','config-processo','designer','notificacoes','dashboard'];

  function wfNavWorkflow(painel) {
    _st.painelAtual = painel;
    _paineis.forEach(p => {
      const el = document.getElementById(`wf-painel-${p}`);
      if (el) el.style.display = 'none';
    });
    const alvo = document.getElementById(`wf-painel-${painel}`);
    if (alvo) alvo.style.display = '';

    const tabIds = ['tarefas','instancias','iniciar','formularios','designer'];
    tabIds.forEach(t => {
      const btn = document.getElementById(`wf-tab-${t}`);
      if (btn) btn.style.fontWeight = t === painel ? '700' : '';
    });

    const carregadores = {
      tarefas: wfCarregarTarefas,
      instancias: wfCarregarInstancias,
      iniciar: wfCarregarIniciar,
      formularios: wfCarregarFormularios,
      notificacoes: _wfRenderNotifPanel,
      dashboard: wfCarregarDashboard,
    };
    carregadores[painel]?.();
  }

  // P2.1 — Badge de notificações não lidas no botão do módulo
  let _unsubNotifs = null;

  function _wfIniciarBadge() {
    const uid = _uid();
    if (!uid || _unsubNotifs) return;
    const { onSnapshot, where, query, collection, or } = globalScope.fb();
    const isEP = globalScope.isEP?.();
    // EP também recebe notificações de escalada SLA
    const constraints = isEP && or
      ? [or(where('destinatario_uid', '==', uid), where('destinatario_uid', '==', 'ep_escalada')), where('lida', '==', false)]
      : [where('destinatario_uid', '==', uid), where('lida', '==', false)];
    const q = query(collection(_db(), 'wf_notificacoes'), ...constraints);
    _unsubNotifs = onSnapshot(q, snap => {
      const count = snap.size;
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
        _st._notifCount = count;
        if (_st.painelAtual === 'notificacoes') _wfRenderNotifPanel();
      } else {
        badge?.remove();
        _st._notifCount = 0;
      }
    }, () => {}); // ignora erros de permissão silenciosamente
  }

  async function _wfRenderNotifPanel() {
    const el = document.getElementById('wf-notif-lista');
    if (!el || _st.painelAtual !== 'notificacoes') return;
    const uid = _uid();
    if (!uid) return;
    el.innerHTML = '<div style="color:var(--ink3);font-size:14px">Carregando…</div>';
    try {
      const { where, limit, query, collection, getDocs } = globalScope.fb();
      const q = query(
        collection(_db(), 'wf_notificacoes'),
        where('destinatario_uid', '==', uid),
        limit(50),
      );
      const snap = await getDocs(q);
      let notifs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      notifs.sort((a, b) => {
        const ta = a._criado_em?.seconds ?? 0;
        const tb = b._criado_em?.seconds ?? 0;
        return tb - ta;
      });
      if (!notifs.length) {
        el.innerHTML = '<div style="color:var(--ink3);font-size:14px;padding:16px 0">Nenhuma notificação.</div>';
        return;
      }
      el.innerHTML = notifs.map(n => {
        const ts = n._criado_em?.seconds
          ? new Date(n._criado_em.seconds * 1000).toLocaleString('pt-BR')
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
      await _updateDoc('wf_notificacoes', notifId, { lida: true });
      if (instanciaId) wfAbrirHistorico(instanciaId, titulo || instanciaId, '');
      else wfNavWorkflow('notificacoes');
    } catch { wfNavWorkflow('notificacoes'); }
  }

  function rWorkflow() {
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

  // ── Tarefas ───────────────────────────────────────────────────────────────
  async function wfCarregarTarefas(acrescentar = false) {
    const el = document.getElementById('wf-lista-tarefas');
    if (!el) return;
    if (!acrescentar) { el.innerHTML = '<div style="color:var(--ink3);font-size:14px">Carregando…</div>'; _st.tarefasCursor = null; }
    try {
      const uid = _uid();
      if (!uid) { el.innerHTML = '<div style="color:var(--ink3);font-size:14px">Usuário não autenticado.</div>'; return; }
      const { where, limit, startAfter, query, collection, getDocs } = globalScope.fb();
      const db = _db();

      // Monta query paginada para tarefas próprias
      const baseConstraints = [
        where('responsavel_uid', '==', uid),
        where('status', 'in', ['pendente','em_execucao']),
        limit(_WF_PAGE),
      ];
      if (_st.tarefasCursor) baseConstraints.push(startAfter(_st.tarefasCursor));
      const snap = await getDocs(query(collection(db, 'wf_tarefa_workflows'), ...baseConstraints));
      _st.tarefasCursor = snap.docs[snap.docs.length - 1] || null;
      const minhas = snap.docs.map(d => ({ id: d.id, ...d.data() }));

      // Tarefas abertas por perfil (sem paginação — geralmente pequeno)
      const perfil = globalScope.usuarioLogado?.perfil;
      let porPerfil = [];
      if (perfil && !acrescentar) {
        try {
          const abertas = await _getAll('wf_tarefa_workflows',
            where('papel_alvo', '==', perfil),
            where('status', 'in', ['pendente','em_execucao']),
          );
          porPerfil = abertas.filter(t => !t.responsavel_uid);
        } catch (_e) { /* índice opcional */ }
      }

      const mapa = {};
      if (acrescentar) {
        // Preserva itens já renderizados do perfil e acrescenta novos
        el.querySelectorAll('[data-tarefa-id]').forEach(el2 => { mapa[el2.dataset.tarefaId] = true; });
      }
      [...minhas, ...porPerfil].forEach(t => { mapa[t.id] = t; });
      const tarefas = Object.values(mapa).filter(t => typeof t === 'object');

      if (!tarefas.length) {
        el.innerHTML = '<div style="color:var(--ink3);font-size:14px">Nenhuma tarefa pendente.</div>';
        return;
      }
      const statusLabels = { pendente:'Pendente', em_execucao:'Em execução', concluida:'Concluída', vencida:'Vencida' };
      const statusCores = { pendente:'#3b82f6', em_execucao:'#f59e0b', concluida:'#10b981', vencida:'#ef4444' };
      const perfilAtual = globalScope.usuarioLogado?.perfil;
      const podeGerenciar = perfilAtual === 'ep' || perfilAtual === 'gestor';

      // Filtro client-side
      const filtroStatus = document.getElementById('wf-filtro-tarefa-status')?.value || '';
      const filtroTexto = (document.getElementById('wf-filtro-tarefa-texto')?.value || '').toLowerCase();
      const tarefasFiltradas = tarefas.filter(t => {
        if (filtroStatus && t.status !== filtroStatus) return false;
        if (filtroTexto && !(t.etapa_nome || '').toLowerCase().includes(filtroTexto)
          && !(t.processo_nome || '').toLowerCase().includes(filtroTexto)) return false;
        return true;
      });

      if (!tarefasFiltradas.length) {
        el.innerHTML = '<div style="color:var(--ink3);font-size:14px">Nenhuma tarefa encontrada.</div>';
        return;
      }
      const cards = tarefasFiltradas.map(t => `<div data-tarefa-id="${_esc(t.id)}">${_card(`
        <div style="font-weight:600;font-size:14px;margin-bottom:4px">${_esc(t.etapa_nome || t.etapa_modelo_id)}${t.sla_vencido ? ' <span style="background:#ef4444;color:#fff;font-size:9px;padding:1px 5px;border-radius:4px;vertical-align:middle">SLA VENCIDO</span>' : ''}</div>
        <div style="font-size:12px;color:var(--ink3);margin-bottom:6px">${_esc(t.processo_nome || t.instancia_id)}</div>
        ${_badge(statusLabels[t.status] || t.status, statusCores[t.status] || '#6b7280')}
        ${_slaInfo(t)}
        ${t.etapa_desc ? `<div style="font-size:12px;color:var(--ink2);margin-top:6px">${_esc(t.etapa_desc)}</div>` : ''}
        <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">
          <button type="button" class="btn btn-p btn-sm" onclick="wfAbrirTarefa('${_esc(t.id)}')">Abrir</button>
          <button type="button" class="btn btn-sm" onclick="wfAbrirDelegacao('${_esc(t.id)}')">Delegar</button>
          ${podeGerenciar ? `<button type="button" class="btn btn-r btn-sm" onclick="wfExcluirTarefa('${_esc(t.id)}')">Excluir</button>` : ''}
        </div>
      `)}</div>`).join('');

      const temMais = snap.docs.length === _WF_PAGE;
      el.innerHTML = cards + (temMais
        ? `<div style="text-align:center;margin-top:12px"><button type="button" class="btn btn-sm" onclick="wfCarregarTarefas(true)">Carregar mais</button></div>`
        : '');
    } catch (e) {
      el.innerHTML = `<div style="color:var(--red);font-size:14px">${_esc(e.message)}</div>`;
    }
  }

  async function wfAbrirTarefa(tarefaId) {
    const tarefa = await _getDoc('wf_tarefa_workflows', tarefaId);
    if (!tarefa) { alert('Tarefa não encontrada.'); return; }
    _st.tarefaAtual = tarefa;

    if (tarefa.status === 'pendente') {
      const patch = { status: 'em_execucao', iniciado_em: new Date() };
      // Assume a tarefa se estava aberta por perfil
      if (!tarefa.responsavel_uid) { patch.responsavel_uid = _uid(); tarefa.responsavel_uid = _uid(); }
      await _updateDoc('wf_tarefa_workflows', tarefaId, patch);
    }

    document.getElementById('wf-exec-titulo').textContent = tarefa.etapa_nome || tarefa.etapa_modelo_id;
    document.getElementById('wf-exec-obs').value = '';
    document.getElementById('wf-exec-formulario').innerHTML = '';

    // Instrucoes / descrição da etapa do mapeamento
    const instrDiv = document.getElementById('wf-exec-instrucoes');
    if (tarefa.etapa_desc) {
      instrDiv.textContent = tarefa.etapa_desc;
      instrDiv.style.display = '';
    } else {
      instrDiv.style.display = 'none';
    }

    // Dados já coletados nas etapas anteriores
    const instancia = await _getDoc('wf_instancia_processos', tarefa.instancia_id);
    const dadosAntEl = document.getElementById('wf-exec-dados-anteriores');
    const dadosAntConteudo = document.getElementById('wf-exec-dados-anteriores-conteudo');
    const dados = instancia?.dados_consolidados || {};
    const dadosEntradas = Object.entries(dados).filter(([, v]) => v !== undefined && v !== '');
    if (dadosEntradas.length) {
      dadosAntConteudo.innerHTML = dadosEntradas.map(([k, v]) =>
        `<div style="font-size:12px;margin-bottom:4px"><strong>${_esc(k)}:</strong> ${_esc(String(v))}</div>`
      ).join('');
      dadosAntEl.style.display = '';
    } else {
      dadosAntEl.style.display = 'none';
    }

    // Progresso do fluxo
    const etapas = instancia?.snapshot_etapas || [];
    const idxAtual = etapas.findIndex(e => e.id === tarefa.etapa_modelo_id);
    document.getElementById('wf-exec-progresso').innerHTML = etapas.length > 1
      ? `<div style="font-size:12px;color:var(--ink3);margin-bottom:12px">Etapa ${idxAtual + 1} de ${etapas.length}: <strong>${_esc(tarefa.etapa_nome || tarefa.etapa_modelo_id)}</strong></div>
         <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:16px">${etapas.map((e, i) => {
           const ativa = i === idxAtual;
           const concluida = i < idxAtual;
           const bg = concluida ? '#10b981' : ativa ? '#3b82f6' : 'var(--bdr)';
           return `<div style="height:4px;flex:1;border-radius:2px;background:${bg}" title="${_esc(e.nome)}"></div>`;
         }).join('')}</div>`
      : '';

    // Papel do usuário nessa etapa
    const papelEl = document.getElementById('wf-exec-papel');
    if (papelEl) {
      const labels = globalScope.WF_PAPEL_LABELS || {};
      papelEl.innerHTML = tarefa.papel_responsavel
        ? `Seu papel: ${_badge(labels[tarefa.papel_responsavel] || tarefa.papel_responsavel, '#6366f1')}`
        : '';
    }

    // Carrega formulário: do nó (tarefa.formulario_id) ou da config do processo
    const formContainer = document.getElementById('wf-exec-formulario');
    try {
      let formularioId = tarefa.formulario_id || null;
      if (!formularioId) {
        const configProc = await _getDoc('wf_config_processo', tarefa.processo_id);
        formularioId = configProc?.etapas?.[tarefa.etapa_modelo_id]?.formulario_id || null;
      }
      if (formularioId) {
        const schema = await _getDoc('wf_formulario_modelos', formularioId);
        if (schema) {
          if (typeof globalScope.wfRenderizarFormulario === 'function') {
            const valoresIniciais = tarefa.dados_formulario || {};
            const formEl = globalScope.wfRenderizarFormulario(schema, valoresIniciais);
            formContainer.appendChild(formEl);
            _st.tarefaAtual._campos = schema.campos || [];
          } else {
            formContainer.innerHTML = '<p class="text-danger small">Módulo de formulários não carregado. Recarregue a página ou contate o suporte.</p>';
          }
        }
      }
    } catch (_e) {
      // formulário opcional — falha silenciosa
    }

    // Indica obrigatoriedade de parecer
    const parecerHint = document.getElementById('wf-exec-parecer-hint');
    if (parecerHint) parecerHint.style.display = tarefa.exige_parecer ? '' : 'none';

    // Botões de ação baseados nas ações disponíveis do papel
    const acoesEl = document.getElementById('wf-exec-acoes');
    const acoes = (tarefa.acoes_disponiveis && tarefa.acoes_disponiveis.length)
      ? tarefa.acoes_disponiveis
      : (proxEtapaLegado(instancia, tarefa) ? ['avancar'] : ['concluir']);
    const ACAO_LABELS = globalScope.WF_ACAO_LABELS || {};
    const ACAO_COR = globalScope.WF_ACAO_COR || {};
    const btnClasse = (a) => a === 'rejeitar' ? 'btn btn-r'
      : a === 'aprovar' || a === 'avancar' || a === 'concluir' ? 'btn btn-p' : 'btn';
    acoesEl.innerHTML = acoes.map(a => {
      const cor = ACAO_COR[a];
      const style = (a === 'devolver' || a === 'solicitar_ajuste') && cor
        ? ` style="background:${cor};color:#fff;border-color:${cor}"` : '';
      return `<button type="button" class="${btnClasse(a)}"${style} onclick="wfConcluirTarefa('${a}')">${_esc(ACAO_LABELS[a] || a)}</button>`;
    }).join('') + `<button type="button" class="btn" onclick="wfNavWorkflow('tarefas')">Cancelar</button>`;

    // Inicializa lista de anexos (carrega os já existentes na tarefa)
    _st._anexosTarefa = (tarefa.anexos || []).slice();
    _wfRenderAnexos();

    // Carrega comentários desta etapa
    wfCancelarResposta();
    wfCarregarComentarios(tarefa.id);

    wfNavWorkflow('executar');
  }

  function _wfRenderAnexos() {
    const lista = document.getElementById('wf-exec-anexos-lista');
    if (!lista) return;
    const anexos = _st._anexosTarefa || [];
    if (!anexos.length) { lista.innerHTML = '<div style="font-size:12px;color:var(--ink3)">Nenhum anexo.</div>'; return; }
    lista.innerHTML = anexos.map((a, i) => `
      <div style="display:flex;align-items:center;gap:8px;font-size:12px;padding:5px 8px;background:var(--surf2);border-radius:6px;margin-bottom:4px">
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">📎 <a href="${_esc(a.url)}" target="_blank" rel="noopener noreferrer" style="color:var(--blue)">${_esc(a.nome)}</a></span>
        <span style="color:var(--ink3);flex-shrink:0">${_esc(a.tamanho || '')}</span>
        <button type="button" onclick="wfRemoverAnexo(${i})" style="background:none;border:none;cursor:pointer;color:var(--ink4);font-size:13px;padding:0 2px" aria-label="Remover anexo">✕</button>
      </div>`).join('');
  }

  async function wfAnexarArquivos(input) {
    const files = Array.from(input.files || []);
    if (!files.length) return;
    const { storage, storageRef, uploadBytes, getDownloadURL } = globalThis._fb || {};
    if (!storage) { alert('Armazenamento não disponível.'); return; }
    const prog = document.getElementById('wf-exec-anexo-progresso');
    for (const file of files) {
      if (prog) prog.textContent = `Enviando ${file.name}…`;
      try {
        const path = `workflow/${_st.tarefaAtual.instancia_id}/${_st.tarefaAtual.id}/${Date.now()}_${file.name}`;
        const sref = storageRef(storage, path);
        await uploadBytes(sref, file);
        const url = await getDownloadURL(sref);
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
    const { storage, storageRef: sRef, deleteObject } = globalThis._fb || {};
    if (storage && anexo.path) {
      try { await deleteObject(sRef(storage, anexo.path)); } catch (_e) { /* arquivo pode já não existir */ }
    }
    _st._anexosTarefa.splice(idx, 1);
    _wfRenderAnexos();
  }

  function proxEtapaLegado(instancia, tarefa) {
    const etapas = instancia?.snapshot_etapas || [];
    const idx = etapas.findIndex(e => e.id === tarefa.etapa_modelo_id);
    return etapas[idx + 1] || null;
  }

  async function wfConcluirTarefa(acao) {
    if (!_st.tarefaAtual) return;
    const tarefa = _st.tarefaAtual;
    acao = acao || (tarefa.acoes_disponiveis && tarefa.acoes_disponiveis[0]) || 'avancar';
    const obs = (document.getElementById('wf-exec-obs')?.value || '').trim();
    const dadosForm = {};

    // Parecer obrigatório?
    const exigeParecer = tarefa.exige_parecer || acao === 'rejeitar' || acao === 'devolver';
    if (exigeParecer && !obs) {
      alert('É obrigatório informar um parecer/justificativa para esta ação.');
      return;
    }

    // Coleta campos do formulário se existir (só em ações de avanço/aprovação)
    const formContainer = document.querySelector('#wf-exec-formulario .wf-form');
    if (formContainer && _st.tarefaAtual._campos && acao !== 'rejeitar') {
      const resultado = globalScope.wfColetarDadosFormulario(formContainer, _st.tarefaAtual._campos);
      if (!resultado.valido) return;
      Object.assign(dadosForm, resultado.dados);
    }

    try {
      await _updateDoc('wf_tarefa_workflows', tarefa.id, {
        status: 'concluida',
        observacao: obs,
        parecer: obs || null,
        acao_tomada: acao,
        dados_formulario: dadosForm,
        anexos: _st._anexosTarefa || [],
        concluido_em: new Date(),
      });

      const instancia = await _getDoc('wf_instancia_processos', tarefa.instancia_id);
      if (instancia) {
        const merged = { ...(instancia.dados_consolidados || {}), ...dadosForm };
        await _updateDoc('wf_instancia_processos', tarefa.instancia_id, {
          dados_consolidados: merged,
          ultimo_executor_uid: _uid(),
        });
        if (instancia.canvas) {
          await _avancarFluxoCanvas(instancia, tarefa.etapa_modelo_id, acao);
        } else {
          await _avancarFluxo(instancia, tarefa.etapa_modelo_id, acao);
        }

        // P1.3 — Notifica o solicitante quando uma etapa é concluída por outro usuário
        if (instancia.solicitante_uid && instancia.solicitante_uid !== _uid()) {
          const ACAO_LABELS2 = globalScope.WF_ACAO_LABELS || {};
          await _addDoc('wf_notificacoes', {
            destinatario_uid: instancia.solicitante_uid,
            tipo: 'etapa_concluida',
            titulo: `Etapa concluída: ${tarefa.etapa_nome}`,
            mensagem: `A etapa "${tarefa.etapa_nome}" do processo "${tarefa.processo_nome}" foi ${ACAO_LABELS2[acao] || acao}.`,
            instancia_id: tarefa.instancia_id,
            tarefa_id: tarefa.id,
            lida: false,
          });
        }
      }

      const ACAO_LABELS = globalScope.WF_ACAO_LABELS || {};
      await _registrarHistorico(tarefa.instancia_id, 'tarefa_concluida', _uid(),
        tarefa.etapa_modelo_id, tarefa.id,
        `Etapa "${tarefa.etapa_nome || tarefa.etapa_modelo_id}" — ${ACAO_LABELS[acao] || acao}.`,
        { acao, papel: tarefa.papel_responsavel || null, parecer: obs || null });

      wfNavWorkflow('tarefas');
    } catch (e) {
      alert('Erro ao concluir tarefa: ' + e.message);
    }
  }

  // Resolve um valor de papel para um uid (ou null)
  function _resolverPapel(valorPapel, instancia, dadosForm) {
    if (!valorPapel) return null;
    // Perfis fixos
    if (valorPapel === 'solicitante') return instancia.solicitante_uid || null;
    if (['ep','gestor','dono'].includes(valorPapel)) {
      // Atribuição específica registrada ao iniciar a instância tem prioridade
      if (instancia.atribuicoes?.[valorPapel]) return instancia.atribuicoes[valorPapel];
      const perfil = globalScope.usuarioLogado?.perfil;
      return perfil === valorPapel ? _uid() : null;
    }
    // Dinâmico: gestor_solicitante
    if (valorPapel === 'gestor_solicitante') {
      const uid = instancia.solicitante_uid;
      if (!uid) return null;
      const u = (globalScope.USUARIOS || []).find(x => x.uid === uid || x.id === uid);
      return u?.gestor_uid || u?.gestor || null;
    }
    // Dinâmico: gestor_executor — gestor de quem executou a etapa anterior
    if (valorPapel === 'gestor_executor') {
      const executorUid = instancia.ultimo_executor_uid;
      if (!executorUid) return null;
      const u = (globalScope.USUARIOS || []).find(x => x.uid === executorUid || x.id === executorUid);
      return u?.gestor_uid || u?.gestor || null;
    }
    // Dinâmico: campo:NOME_DO_CAMPO
    if (valorPapel.startsWith('campo:')) {
      const campo = valorPapel.slice(6);
      return (dadosForm || instancia.dados_consolidados || {})[campo] || null;
    }
    // Dinâmico: grupo:GRUPO_ID  → null (qualquer membro do grupo assume)
    if (valorPapel.startsWith('grupo:')) return null;
    // assume UID direto
    return valorPapel;
  }

  // Cria as tarefas de um nó do canvas, uma por papel preenchido
  async function _criarTarefasDoNo(instancia, no) {
    const cfg = no.config || {};
    const papeis = cfg.papeis || {};
    const acoesNo = cfg.acoes && cfg.acoes.length ? cfg.acoes : ['avancar'];
    const prazo = cfg.sla_horas > 0 ? new Date(Date.now() + cfg.sla_horas * 3600000) : null;

    const mapaPapelAcoes = {
      executor: acoesNo,
      revisor: ['avancar'],
      aprovador: acoesNo.filter(a => a !== 'avancar').length ? acoesNo.filter(a => a !== 'avancar') : ['aprovar','rejeitar'],
    };

    const criados = [];
    const prazoStr = prazo ? prazo.toLocaleDateString('pt-BR') : 'sem prazo';
    const ctxNotif = {
      processo: {
        titulo: instancia.titulo,
        id: instancia.id,
        numero: instancia.numero || instancia.id.slice(-6).toUpperCase(),
      },
      etapa: { nome: no.nome },
      solicitante: { nome: (globalScope.USUARIOS || []).find(u => u.uid === instancia.solicitante_uid)?.nome || '' },
      prazo: prazoStr,
    };
    const tituloNotif = _interpolarTemplate(no.config?.titulo_notificacao || 'Nova etapa: {{etapa.nome}}', ctxNotif);
    const msgNotif = _interpolarTemplate(
      no.config?.mensagem_notificacao || 'Processo "{{processo.titulo}}" — etapa "{{etapa.nome}}" aguarda sua ação.',
      ctxNotif,
    );

    for (const papel of ['executor','revisor','aprovador']) {
      const valor = papeis[papel];
      if (!valor) continue;
      const uidResp = _resolverPapel(valor, instancia, {});
      const acoesDisp = mapaPapelAcoes[papel];
      const tarefaId = await _addDoc('wf_tarefa_workflows', {
        instancia_id: instancia.id,
        processo_nome: instancia.titulo,
        processo_id: instancia.processo_id || null,
        etapa_modelo_id: no.id,
        etapa_nome: no.nome,
        etapa_desc: cfg.instrucoes || null,
        etapa_tipo: no.tipo,
        responsavel_uid: uidResp,        // pode ser null → assumível por perfil
        papel_responsavel: papel,
        papel_alvo: valor,               // 'ep'|'gestor'|'solicitante'|uid
        acoes_disponiveis: acoesDisp,
        acao_tomada: null,
        parecer: null,
        exige_parecer: !!cfg.exige_parecer,
        formulario_id: cfg.formulario_id || null,
        status: 'pendente',
        prazo,
        dados_formulario: {},
        observacao: null,
      });
      const papelAlvo = valor.startsWith('grupo:') ? valor : (uidResp ? uidResp : valor);
      if (uidResp) {
        await _addDoc('wf_notificacoes', {
          destinatario_uid: uidResp,
          tipo: 'tarefa_criada',
          titulo: tituloNotif,
          mensagem: msgNotif,
          instancia_id: instancia.id,
          tarefa_id: tarefaId,
          lida: false,
        });
      }
      criados.push(tarefaId);
    }
    // Notificações para grupos: busca membros e notifica cada um
    for (const tarefaId of criados) {
      const tarefaDoc = await _getDoc('wf_tarefa_workflows', tarefaId);
      const papelAlvoTarefa = tarefaDoc?.papel_alvo || '';
      if (papelAlvoTarefa.startsWith('grupo:')) {
        const grupoId = papelAlvoTarefa.slice(6);
        try {
          const grupo = await _getDoc('wf_grupos', grupoId);
          for (const membroUid of (grupo?.membros_uid || [])) {
            await _addDoc('wf_notificacoes', {
              destinatario_uid: membroUid,
              tipo: 'tarefa_criada',
              titulo: tituloNotif,
              mensagem: msgNotif,
              instancia_id: instancia.id,
              tarefa_id: tarefaId,
              lida: false,
            });
          }
        } catch (_e) { /* grupo não encontrado — ignora */ }
      }
    }

    // Comentário automático: cria no primeiro tarefa criada (se configurado)
    if (cfg.comentario_automatico && criados.length) {
      const textoAuto = _interpolarTemplate(cfg.comentario_automatico, ctxNotif);
      if (textoAuto.trim()) {
        await _addDoc('wf_comentarios', {
          tarefa_id: criados[0],
          instancia_id: instancia.id,
          etapa_id: no.id,
          etapa_nome: no.nome,
          autor_uid: 'sistema',
          texto: textoAuto,
          respondendo_a: null,
        });
      }
    }

    // cientes
    const cientes = papeis.ciente || [];
    for (const c of cientes) {
      const uidC = _resolverPapel(c, instancia, {});
      if (uidC) {
        await _addDoc('wf_notificacoes', {
          destinatario_uid: uidC,
          tipo: 'tarefa_criada',
          titulo: `Ciência: ${no.nome}`,
          mensagem: `Processo "${instancia.titulo}" chegou à etapa "${no.nome}".`,
          instancia_id: instancia.id,
          lida: false,
        });
      }
    }
    // Nenhum papel configurado: cria tarefa de executor para o solicitante via o mesmo caminho
    if (!criados.length) {
      papeis.executor = 'solicitante';
      const uidResp = _resolverPapel('solicitante', instancia, {});
      const tarefaId = await _addDoc('wf_tarefa_workflows', {
        instancia_id: instancia.id,
        processo_nome: instancia.titulo,
        processo_id: instancia.processo_id || null,
        etapa_modelo_id: no.id,
        etapa_nome: no.nome,
        etapa_desc: cfg.instrucoes || null,
        etapa_tipo: no.tipo,
        responsavel_uid: uidResp,
        papel_responsavel: 'executor',
        papel_alvo: 'solicitante',
        acoes_disponiveis: acoesNo,
        acao_tomada: null, parecer: null,
        exige_parecer: !!cfg.exige_parecer,
        formulario_id: cfg.formulario_id || null,
        status: 'pendente', prazo, dados_formulario: {}, observacao: null,
      });
      if (uidResp) {
        await _addDoc('wf_notificacoes', {
          destinatario_uid: uidResp,
          tipo: 'tarefa_criada',
          titulo: tituloNotif,
          mensagem: msgNotif,
          instancia_id: instancia.id,
          tarefa_id: tarefaId,
          lida: false,
        });
      }
      criados.push(tarefaId);
    }
    return criados;
  }

  // Avança fluxo baseado no canvas do modelo
  async function _avancarFluxoCanvas(instancia, noOrigemId, acao) {
    const canvas = instancia.canvas;

    // Rejeitar/devolver: retorna ao nó anterior (aresta de entrada em noOrigemId)
    if (acao === 'rejeitar' || acao === 'devolver') {
      const arestas = canvas.arestas || [];
      const nos = canvas.nos || [];
      const arestaEntrada = arestas.find(a => a.destino === noOrigemId);
      const noAnterior = arestaEntrada ? nos.find(n => n.id === arestaEntrada.origem) : null;
      if (noAnterior && noAnterior.tipo !== 'inicio') {
        await _updateDoc('wf_instancia_processos', instancia.id, { no_atual_id: noAnterior.id, etapa_atual_id: noAnterior.id });
        await _criarTarefasDoNo(instancia, noAnterior);
        await _registrarHistorico(instancia.id, 'etapa_retornada', _uid(), noAnterior.id, null,
          `Etapa devolvida para "${noAnterior.nome}".`, { acao });
        return;
      }
    }

    const prox = _proximoNo(canvas, noOrigemId, acao, instancia.dados_consolidados || {});
    if (!prox || prox.tipo === 'fim') {
      await _updateDoc('wf_instancia_processos', instancia.id, {
        status: 'concluido', concluido_em: new Date(), no_atual_id: null, etapa_atual_id: null,
      });
      await _registrarHistorico(instancia.id, 'instancia_concluida', null, null, null, 'Processo concluído.', {});
      return;
    }
    await _updateDoc('wf_instancia_processos', instancia.id, { no_atual_id: prox.id, etapa_atual_id: prox.id });
    await _criarTarefasDoNo(instancia, prox);
    await _registrarHistorico(instancia.id, 'etapa_avancada', null, prox.id, null,
      `Avançou para etapa "${prox.nome}".`, { acao });
  }

  // Avança para a próxima etapa do snapshot sequencial
  async function _avancarFluxo(instancia, etapaOrigemId, acao) {
    const etapas = instancia.snapshot_etapas || [];
    const idx = etapas.findIndex(e => e.id === etapaOrigemId);

    // Rejeitar/devolver: retorna à etapa anterior
    if (acao === 'rejeitar' || acao === 'devolver') {
      const etapaAnterior = idx > 0 ? etapas[idx - 1] : null;
      if (etapaAnterior) {
        await _updateDoc('wf_instancia_processos', instancia.id, { etapa_atual_id: etapaAnterior.id });
        await _criarTarefa(instancia, etapaAnterior);
        await _registrarHistorico(instancia.id, 'etapa_retornada', _uid(), etapaAnterior.id, null,
          `Etapa devolvida para "${etapaAnterior.nome}".`, { acao });
        return;
      }
    }

    const proxEtapa = etapas[idx + 1];
    if (!proxEtapa) {
      // Última etapa — conclui o processo
      await _updateDoc('wf_instancia_processos', instancia.id, {
        status: 'concluido', concluido_em: new Date(), etapa_atual_id: null,
      });
      await _registrarHistorico(instancia.id, 'instancia_concluida', null, null, null, 'Processo concluído.', {});
      return;
    }

    await _updateDoc('wf_instancia_processos', instancia.id, { etapa_atual_id: proxEtapa.id });
    await _criarTarefa(instancia, proxEtapa);
    await _registrarHistorico(instancia.id, 'etapa_avancada', null, proxEtapa.id, null,
      `Avançou para etapa "${proxEtapa.nome}".`, {});
  }

  async function _criarTarefa(instancia, etapa) {
    const uid = instancia.solicitante_uid;
    const prazo = etapa.sla_horas > 0
      ? new Date(Date.now() + etapa.sla_horas * 3600000)
      : null;

    const tarefaId = await _addDoc('wf_tarefa_workflows', {
      instancia_id: instancia.id,
      processo_nome: instancia.titulo,
      processo_id: instancia.processo_id,
      etapa_modelo_id: etapa.id,
      etapa_nome: etapa.nome,
      etapa_desc: etapa.desc || null,
      etapa_tipo: etapa.tipo || 'Atividade',
      responsavel_uid: uid,
      status: 'pendente',
      prazo,
      dados_formulario: {},
      observacao: null,
    });

    await _addDoc('wf_notificacoes', {
      destinatario_uid: uid,
      tipo: 'tarefa_criada',
      titulo: `Nova etapa: ${etapa.nome}`,
      mensagem: `Processo "${instancia.titulo}" — etapa "${etapa.nome}" aguarda sua ação.`,
      instancia_id: instancia.id,
      tarefa_id: tarefaId,
      lida: false,
    });

    return tarefaId;
  }

  async function _registrarHistorico(instanciaId, tipo, usuarioUid, etapaId, tarefaId, descricao, dados) {
    await _addDoc('wf_historico_workflows', {
      instancia_id: instanciaId,
      tipo_evento: tipo,
      usuario_uid: usuarioUid || null,
      etapa_id: etapaId || null,
      tarefa_id: tarefaId || null,
      descricao,
      dados: dados || {},
    });
  }

  // ── Instâncias ────────────────────────────────────────────────────────────
  async function wfCarregarInstancias(acrescentar = false) {
    const el = document.getElementById('wf-lista-instancias');
    if (!el) return;
    if (!acrescentar) { el.innerHTML = '<div style="color:var(--ink3);font-size:14px">Carregando…</div>'; _st.instanciasCursor = null; }
    try {
      const uid = _uid();
      if (!uid) { el.innerHTML = '<div style="color:var(--ink3);font-size:14px">Usuário não autenticado.</div>'; return; }
      const { where, limit, startAfter, query, collection, getDocs } = globalScope.fb();
      const db = _db();

      const constraints = [where('solicitante_uid', '==', uid), limit(_WF_PAGE)];
      if (_st.instanciasCursor) constraints.push(startAfter(_st.instanciasCursor));
      const snap = await getDocs(query(collection(db, 'wf_instancia_processos'), ...constraints));
      _st.instanciasCursor = snap.docs[snap.docs.length - 1] || null;

      let instancias = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      instancias.sort((a, b) => {
        const ta = a._criado_em?.seconds ?? (a._criado_em ? a._criado_em.getTime() / 1000 : 0);
        const tb = b._criado_em?.seconds ?? (b._criado_em ? b._criado_em.getTime() / 1000 : 0);
        return tb - ta;
      });

      // Filtro client-side
      const filtroInstStatus = document.getElementById('wf-filtro-inst-status')?.value || '';
      const filtroInstTexto = (document.getElementById('wf-filtro-inst-texto')?.value || '').toLowerCase();
      const instanciasFiltradas = instancias.filter(i => {
        if (filtroInstStatus && i.status !== filtroInstStatus) return false;
        if (filtroInstTexto && !(i.titulo || '').toLowerCase().includes(filtroInstTexto)) return false;
        return true;
      });

      if (!instanciasFiltradas.length && !acrescentar) {
        el.innerHTML = '<div style="color:var(--ink3);font-size:14px">Nenhum processo encontrado.</div>';
        return;
      }
      const statusLabels = { em_andamento:'Em andamento', concluido:'Concluído', cancelado:'Cancelado', suspenso:'Suspenso' };
      const statusCores = { em_andamento:'#3b82f6', concluido:'#10b981', cancelado:'#ef4444', suspenso:'#f59e0b' };
      const podeGerenciar = globalScope.isEP?.() || globalScope.isGestor?.();
      const cards = instanciasFiltradas.map(i => {
        const etapas = i.snapshot_etapas || [];
        const idxAtual = etapas.findIndex(e => e.id === i.etapa_atual_id);
        const pct = etapas.length > 1 && idxAtual >= 0
          ? Math.round((idxAtual / (etapas.length - 1)) * 100)
          : (i.status === 'concluido' ? 100 : 0);
        return _card(`
          <div style="font-weight:600;font-size:14px;margin-bottom:4px">${_esc(i.titulo)}</div>
          ${i.etapa_atual_id && i.status === 'em_andamento' ? `<div style="font-size:12px;color:var(--ink3);margin-bottom:6px">Etapa atual: <strong>${_esc(etapas.find(e => e.id === i.etapa_atual_id)?.nome || i.etapa_atual_id)}</strong></div>` : ''}
          ${_badge(statusLabels[i.status] || i.status, statusCores[i.status] || '#6b7280')}
          ${etapas.length > 1 && i.status === 'em_andamento' ? `
          <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:10px;align-items:center">
            ${etapas.map((e, idx) => {
              const concluida = idx < idxAtual;
              const ativa = idx === idxAtual;
              const bg = concluida ? '#10b981' : ativa ? '#3b82f6' : 'var(--bdr)';
              return `<div style="height:4px;flex:1;border-radius:2px;background:${bg}" title="${_esc(e.nome)}"></div>`;
            }).join('')}
          </div>
          <div style="font-size:11px;color:var(--ink3);margin-top:4px">${pct}% concluído</div>` : ''}
          <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">
            <button type="button" class="btn btn-sm" onclick="wfAbrirHistorico('${_esc(i.id)}','${_esc(i.titulo)}','${_esc(i.status)}')">Ver histórico</button>
            ${i.status === 'em_andamento' && podeGerenciar ? `<button type="button" class="btn btn-sm" onclick="wfSuspenderInstancia('${_esc(i.id)}')">Suspender</button>` : ''}
            ${i.status === 'suspenso' && podeGerenciar ? `<button type="button" class="btn btn-p btn-sm" onclick="wfRetomarInstancia('${_esc(i.id)}')">Retomar</button>` : ''}
            ${i.status === 'em_andamento' && podeGerenciar ? `<button type="button" class="btn btn-r btn-sm" onclick="wfConfirmarCancelar('${_esc(i.id)}')">Cancelar</button>` : ''}
          </div>
        `);
      }).join('');

      const temMais = snap.docs.length === _WF_PAGE;
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

  function wfCarregarIniciar() {
    const sol = globalScope.isSolicitante?.() || globalScope.usuarioLogado?.perfil === 'solicitante';
    // Solicitante só vê templates publicados, nunca mapeamentos brutos
    const tabMapeamento = document.getElementById('wf-iniciar-tab-mapeamento');
    if (tabMapeamento) tabMapeamento.style.display = sol ? 'none' : '';
    wfIniciarAba(sol ? 'templates' : (_st.iniciarAba || 'mapeamento'));
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
              ${isEp ? `<button type="button" class="btn btn-sm" onclick="wfConfigurarProcesso('${_esc(p.id)}')">Formulários/SLA</button>` : ''}
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
      configEtapas = configProc?.etapas || {};
    } catch (_e) { /* segue sem config */ }

    // Monta snapshot das etapas com os dados do mapeamento
    const snapshotEtapas = etapasExec.map((e, i) => {
      const etapaId = `${processoId}_${e.id || i}`;
      const etapaConf = configEtapas[etapaId] || {};
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
      const instanciaId = await _addDoc('wf_instancia_processos', {
        processo_id: processoId,
        processo_nome: proc.nome,
        titulo,
        status: 'em_andamento',
        etapa_atual_id: snapshotEtapas[0].id,
        solicitante_uid: uid,
        snapshot_etapas: snapshotEtapas,
        fluxo_origem: usaToBe ? 'tobe' : 'asis',
        dados_consolidados: {},
        concluido_em: null,
      });

      await _registrarHistorico(instanciaId, 'instancia_criada', uid, null, null,
        `Workflow iniciado a partir do processo "${proc.nome}" (${usaToBe ? 'TO BE' : 'AS IS'}).`,
        { processo_id: processoId });

      // Cria a primeira tarefa
      await _criarTarefa(
        { id: instanciaId, titulo, processo_id: processoId, solicitante_uid: uid, snapshot_etapas: snapshotEtapas },
        snapshotEtapas[0],
      );

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
        const cfgAresta = _wfConfigNos[e.id] || {};
        return {
          id: e.id,
          origem: e.source?.id,
          destino: e.target?.id,
          acao: e.businessObject?.name || 'avancar',
          label: e.businessObject?.name || 'Avançar',
          condicoes: cfgAresta.condicoes || [],
          operador_logico: cfgAresta.operador_logico || 'AND',
          padrao: cfgAresta.padrao || false,
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
      canvas: { nos: [], arestas: [] },
    };
  }

  // Importa um mapeamento → reutiliza BPMN XML existente (bpmnToBe ou bpmnAsIs) → abre designer
  async function wfImportarMapeamento(processoId) {
    const proc = await _getDoc('processos', processoId);
    if (!proc) { alert('Processo não encontrado.'); return; }
    const usaToBe = (proc.mod?.etapas_proc_tobe || []).length > 0;
    const todasEtapas = usaToBe ? proc.mod.etapas_proc_tobe : (proc.mod?.etapas_proc || []);
    const etapasExec = todasEtapas.filter(e => !e.tipo || e.tipo === 'Atividade' || e.tipo === 'Aprovação');
    if (!etapasExec.length) { alert('Este processo não possui etapas executáveis.'); return; }

    // Reutiliza o BPMN XML já desenhado no módulo de mapeamento
    const bpmnXmlExistente = usaToBe ? (proc.mod?.bpmnToBe || null) : (proc.mod?.bpmnAsIs || null);

    let bpmnXml;
    const configNos = {};

    if (bpmnXmlExistente) {
      // Usa o XML do mapeamento diretamente — preserva o layout e gateways originais
      bpmnXml = bpmnXmlExistente;
      // Extrai IDs de tasks/gateways do XML para criar config_nos com defaults
      const matches = [...bpmnXml.matchAll(/(?:userTask|manualTask|serviceTask|exclusiveGateway|inclusiveGateway|parallelGateway)\s+id="([^"]+)"/g)];
      matches.forEach(([, id]) => {
        const cfg = _configPadrao();
        // Gateways recebem ações de aprovação por padrão
        if (bpmnXml.includes(`exclusiveGateway id="${id}"`) || bpmnXml.includes(`inclusiveGateway id="${id}"`)) {
          cfg.acoes = ['aprovar', 'rejeitar'];
        }
        configNos[id] = cfg;
      });
    } else {
      // Fallback: processo sem BPMN desenhado — gera layout linear simples
      const BW = 120, BH = 60, GAP = 50, Y = 100, startX = 60;
      const ids = etapasExec.map((_, i) => `task_${i + 1}`);
      let processXml = '    <startEvent id="start" name="Início"/>\n';
      etapasExec.forEach((e, i) => {
        const tipo = e.tipo === 'Aprovação' ? 'exclusiveGateway' : 'userTask';
        processXml += `    <${tipo} id="${ids[i]}" name="${(e.nome || `Etapa ${i+1}`).replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}"/>\n`;
      });
      processXml += '    <endEvent id="end" name="Fim"/>\n';
      processXml += `    <sequenceFlow id="f0" sourceRef="start" targetRef="${ids[0]}"/>\n`;
      ids.forEach((id, i) => {
        processXml += `    <sequenceFlow id="f${i+1}" sourceRef="${id}" targetRef="${ids[i+1] || 'end'}"/>\n`;
      });
      const allIds = ['start', ...ids, 'end'];
      const startW = 36, startH = 36;
      let diShapes = '';
      allIds.forEach((id, i) => {
        const isEvent = id === 'start' || id === 'end';
        const w = isEvent ? startW : BW, h = isEvent ? startH : BH;
        const x = startX + i * (BW + GAP) + (isEvent ? (BW - startW) / 2 : 0);
        const y = Y + (isEvent ? (BH - startH) / 2 : 0);
        diShapes += `      <bpmndi:BPMNShape bpmnElement="${id}"><omgdc:Bounds x="${x}" y="${y}" width="${w}" height="${h}"/></bpmndi:BPMNShape>\n`;
      });
      let diEdges = '';
      allIds.forEach((id, i) => {
        if (i === allIds.length - 1) return;
        const srcIsEvent = id === 'start' || id === 'end';
        const tgtIsEvent = allIds[i+1] === 'start' || allIds[i+1] === 'end';
        const sw = srcIsEvent ? startW : BW;
        const sx = startX + i * (BW + GAP) + (srcIsEvent ? (BW - startW) / 2 : 0);
        const tx = startX + (i+1) * (BW + GAP) + (tgtIsEvent ? (BW - startW) / 2 : 0);
        diEdges += `      <bpmndi:BPMNEdge bpmnElement="f${i}"><omgdi:waypoint x="${sx + sw}" y="${Y + BH/2}"/><omgdi:waypoint x="${tx}" y="${Y + BH/2}"/></bpmndi:BPMNEdge>\n`;
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
        cfg.acoes = etapasExec[i]?.tipo === 'Aprovação' ? ['aprovar','rejeitar'] : ['avancar'];
        configNos[id] = cfg;
      });
    }

    try {
      const id = await _addDoc('wf_processo_modelos', {
        nome: `${proc.nome} (workflow)`,
        descricao: `Importado do mapeamento ${usaToBe ? 'TO BE' : 'AS IS'} de "${proc.nome}".`,
        status: 'rascunho', versao: 1,
        processo_origem_id: processoId,
        fluxo_origem: usaToBe ? 'tobe' : 'asis',
        bpmn_xml: bpmnXml,
        config_nos: configNos,
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
      campos_condicionais: [],      // [{ campo_id, condicoes, operador_logico, acao }]
      // Para arestas (SequenceFlow):
      condicoes: [],                // [{ campo, operador, valor }]
      operador_logico: 'AND',
      padrao: false,
    };
  }

  async function wfAbrirDesigner(modeloId) {
    const modelo = modeloId ? await _getDoc('wf_processo_modelos', modeloId) : _novoModeloVazio();
    if (!modelo) { alert('Modelo não encontrado.'); return; }

    _wfModeloAtual = modelo;
    // Carrega config dos nós em memória
    Object.keys(_wfConfigNos).forEach(k => delete _wfConfigNos[k]);
    Object.assign(_wfConfigNos, modelo.config_nos || {});

    if (!_st.formularioModelos.length) {
      try { _st.formularioModelos = await _getAll('wf_formulario_modelos'); } catch (_e) { /* */ }
    }

    const nomeEl = document.getElementById('wf-designer-nome');
    if (nomeEl) nomeEl.value = modelo.nome || '';
    const descEl = document.getElementById('wf-designer-desc');
    if (descEl) descEl.value = modelo.descricao || '';
    const dirtyEl = document.getElementById('wf-bpmn-dirty');
    if (dirtyEl) dirtyEl.style.display = 'none';

    wfNavWorkflow('designer');
    setTimeout(() => _wfInitModeler(modelo), 150);
  }

  function _wfInitModeler(modelo) {
    const loadingEl = document.getElementById('wf-bpmn-loading');
    const canvasEl = document.getElementById('wf-bpmn-canvas');
    const wrapEl = canvasEl?.parentElement || null;

    if (typeof BpmnJS === 'undefined') {
      if (loadingEl) loadingEl.innerHTML = '<div style="text-align:center;padding:2rem"><div style="font-size:28px;margin-bottom:8px">📦</div><div style="font-size:13px;font-weight:600">Editor BPMN não disponível offline</div></div>';
      return;
    }

    if (_wfModeler) { try { _wfModeler.destroy(); } catch (_e) {} _wfModeler = null; }
    if (wrapEl) wrapEl.style.display = 'none';
    if (loadingEl) { loadingEl.style.display = ''; loadingEl.innerHTML = '<div class="spin"></div><span>Carregando editor…</span>'; }

    _wfModeler = new BpmnJS({ container: '#wf-bpmn-canvas' });

    _wfModeler.on('commandStack.changed', () => {
      const d = document.getElementById('wf-bpmn-dirty');
      if (d) d.style.display = 'inline';
    });

    _wfModeler.on('selection.changed', ({ newSelection }) => {
      const el = newSelection.length === 1 ? newSelection[0] : null;
      _wfRenderConfigPanel(el);
    });

    const xml = modelo.bpmn_xml || (typeof BPMN_DEFAULT !== 'undefined' ? BPMN_DEFAULT : '');
    _wfModeler.importXML(xml).then(() => {
      if (loadingEl) loadingEl.style.display = 'none';
      if (wrapEl) wrapEl.style.display = '';
      _wfModeler.get('canvas').zoom('fit-viewport');
    }).catch(err => {
      if (loadingEl) loadingEl.innerHTML = `<div style="color:var(--red);padding:1rem;font-size:13px">Erro: ${_esc(err.message || String(err))}</div>`;
    });
  }

  // — Painel de configuração do elemento selecionado —
  function _wfRenderConfigPanel(el) {
    const painel = document.getElementById('wf-designer-config');
    if (!painel) return;

    // Só configura tasks (não sequence flows, labels, start/end events)
    const configuravel = el && (
      el.type === 'bpmn:Task' || el.type === 'bpmn:UserTask' ||
      el.type === 'bpmn:ManualTask' || el.type === 'bpmn:ServiceTask' ||
      el.type === 'bpmn:ExclusiveGateway' || el.type === 'bpmn:InclusiveGateway' ||
      el.type === 'bpmn:SequenceFlow'
    );

    if (!configuravel) { painel.style.display = 'none'; return; }

    // ── SequenceFlow: editor de condições de gateway ──────────────────────────
    if (el.type === 'bpmn:SequenceFlow') {
      painel.style.display = '';
      const id = el.id;
      if (!_wfConfigNos[id]) _wfConfigNos[id] = { condicoes: [], operador_logico: 'AND', padrao: false };
      const cfg = _wfConfigNos[id];
      painel.innerHTML = `
        <div style="font-weight:600;font-size:13px;margin-bottom:10px;color:var(--ink)">
          Gateway: ${_esc(el.businessObject?.name || id)}
        </div>
        <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;margin-bottom:10px">
          <input type="checkbox" id="wf-aresta-padrao-${_esc(id)}" ${cfg.padrao ? 'checked' : ''}
            onchange="wfDesignerArestaPadrao('${_esc(id)}',this.checked)">
          Saída padrão (else — usada quando nenhuma condição bater)
        </label>
        <div id="wf-aresta-conds-wrap-${_esc(id)}" style="${cfg.padrao ? 'opacity:.4;pointer-events:none' : ''}">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <span style="font-size:12px;font-weight:600;color:var(--ink2)">Condições</span>
            <select class="fi" style="width:auto;padding:2px 6px;font-size:11px"
              onchange="wfDesignerCampoCfg('${_esc(id)}','operador_logico',this.value)">
              <option value="AND" ${cfg.operador_logico !== 'OR' ? 'selected' : ''}>Todas (AND)</option>
              <option value="OR"  ${cfg.operador_logico === 'OR'  ? 'selected' : ''}>Qualquer (OR)</option>
            </select>
          </div>
          <div id="wf-aresta-conds-${_esc(id)}" style="margin-bottom:8px"></div>
          <button type="button" class="btn btn-sm" onclick="wfDesignerAddCondicao('${_esc(id)}')">+ Condição</button>
        </div>`;
      _wfRenderCondicoes(id);
      return;
    }

    painel.style.display = '';

    const id = el.id;
    const cfg = _wfConfigNos[id] || _configPadrao();
    _wfConfigNos[id] = cfg;
    const papeis = cfg.papeis || {};
    const acoes = cfg.acoes || [];

    const alvoOpts = (sel) => {
      const fixos = {
        '':                   '— Ninguém —',
        'solicitante':        'Próprio solicitante',
        'gestor_solicitante': 'Gestor do solicitante',
        'gestor_executor':    'Gestor do executor anterior',
        'ep':                 'Perfil EP',
        'gestor':             'Perfil Gestor',
        'dono':               'Perfil Dono',
      };
      const usuarios = (globalScope.USUARIOS || []).filter(u => u.uid || u.id);
      return Object.entries(fixos).map(([v, l]) =>
        `<option value="${v}"${(sel || '') === v ? ' selected' : ''}>${_esc(l)}</option>`
      ).join('') + (usuarios.length ? `<optgroup label="Usuário específico">${
        usuarios.map(u => {
          const uid = u.uid || u.id;
          return `<option value="${_esc(uid)}"${(sel || '') === uid ? ' selected' : ''}>${_esc(u.nome || u.email || uid)}</option>`;
        }).join('')
      }</optgroup>` : '');
    };
    const formOpts = '<option value="">— Sem formulário —</option>' +
      (_st.formularioModelos || []).map(m =>
        `<option value="${_esc(m.id)}"${cfg.formulario_id === m.id ? ' selected' : ''}>${_esc(m.titulo)}</option>`).join('');
    const acaoChk = (a, l) =>
      `<label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer">
        <input type="checkbox" ${acoes.includes(a) ? 'checked' : ''} onchange="wfDesignerToggleAcao('${_esc(id)}','${a}',this.checked)"> ${_esc(l)}</label>`;

    painel.innerHTML = `
      <div style="font-weight:600;font-size:13px;margin-bottom:10px;color:var(--ink)">${_esc(el.businessObject?.name || id)}</div>
      <div style="font-size:12px;font-weight:600;color:var(--ink2);margin-bottom:6px">Papéis</div>
      <label class="lbl" style="font-size:11px">Executor</label>
      <select class="fi" style="margin-top:2px;margin-bottom:8px" onchange="wfDesignerPapel('${_esc(id)}','executor',this.value)">${alvoOpts(papeis.executor)}</select>
      <label class="lbl" style="font-size:11px">Revisor</label>
      <select class="fi" style="margin-top:2px;margin-bottom:8px" onchange="wfDesignerPapel('${_esc(id)}','revisor',this.value)">${alvoOpts(papeis.revisor)}</select>
      <label class="lbl" style="font-size:11px">Aprovador</label>
      <select class="fi" style="margin-top:2px;margin-bottom:12px" onchange="wfDesignerPapel('${_esc(id)}','aprovador',this.value)">${alvoOpts(papeis.aprovador)}</select>
      <div style="font-size:12px;font-weight:600;color:var(--ink2);margin-bottom:6px">Ações disponíveis</div>
      <div style="display:flex;flex-direction:column;gap:4px;margin-bottom:12px">
        ${acaoChk('avancar','Avançar')}${acaoChk('aprovar','Aprovar')}
        ${acaoChk('rejeitar','Rejeitar')}${acaoChk('devolver','Devolver')}
        ${acaoChk('solicitar_ajuste','Solicitar ajuste')}
      </div>
      <label class="lbl" style="font-size:11px">Formulário dinâmico</label>
      <select class="fi" style="margin-top:2px;margin-bottom:8px" onchange="wfDesignerCampoCfg('${_esc(id)}','formulario_id',this.value||null)">${formOpts}</select>
      <label class="lbl" style="font-size:11px">SLA (horas úteis · 0 = sem prazo)</label>
      <input type="number" class="fi" min="0" value="${_esc(String(cfg.sla_horas || 0))}" style="margin-top:2px;margin-bottom:8px" oninput="wfDesignerCampoCfg('${_esc(id)}','sla_horas',Number(this.value)||0)">
      <label class="lbl" style="font-size:11px">Instruções</label>
      <textarea class="fi" rows="3" style="margin-top:2px;margin-bottom:8px;resize:vertical" oninput="wfDesignerCampoCfg('${_esc(id)}','instrucoes',this.value)">${_esc(cfg.instrucoes || '')}</textarea>
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer">
        <input type="checkbox" ${cfg.exige_parecer ? 'checked' : ''} onchange="wfDesignerCampoCfg('${_esc(id)}','exige_parecer',this.checked)"> Exige parecer obrigatório</label>
      <div style="margin-top:16px;border-top:1px solid var(--bdr);padding-top:12px">
        <div style="font-size:12px;font-weight:600;color:var(--ink2);margin-bottom:6px">Campos condicionais</div>
        <div id="wf-campos-cond-${_esc(id)}" style="margin-bottom:8px"></div>
        <button type="button" class="btn btn-sm" onclick="wfDesignerAddCampoCond('${_esc(id)}')">+ Condição de campo</button>
      </div>
      <div style="margin-top:12px;border-top:1px solid var(--bdr);padding-top:12px">
        <div style="font-size:12px;font-weight:600;color:var(--ink2);margin-bottom:4px">Notificação customizada</div>
        <label class="lbl" style="font-size:11px">Título (use {{etapa.nome}}, {{processo.titulo}})</label>
        <input type="text" class="fi" style="margin-top:2px;margin-bottom:6px" placeholder="Nova etapa: {{etapa.nome}}"
          value="${_esc(cfg.titulo_notificacao || '')}"
          oninput="wfDesignerCampoCfg('${_esc(id)}','titulo_notificacao',this.value)">
        <label class="lbl" style="font-size:11px">Mensagem</label>
        <textarea class="fi" rows="2" style="margin-top:2px;resize:vertical"
          placeholder='Processo "{{processo.titulo}}" — etapa "{{etapa.nome}}" aguarda sua ação.'
          oninput="wfDesignerCampoCfg('${_esc(id)}','mensagem_notificacao',this.value)">${_esc(cfg.mensagem_notificacao || '')}</textarea>
      </div>
      <div style="margin-top:12px;border-top:1px solid var(--bdr);padding-top:12px">
        <div style="font-size:12px;font-weight:600;color:var(--ink2);margin-bottom:4px">Comentário automático</div>
        <div style="font-size:11px;color:var(--ink3);margin-bottom:6px">Criado automaticamente com autor "Sistema" ao iniciar a etapa. Use variáveis: {{processo.titulo}}, {{etapa.nome}}, {{prazo}}, {{solicitante.nome}}</div>
        <textarea class="fi" rows="2" style="margin-top:2px;resize:vertical"
          placeholder="Ex: Etapa {{etapa.nome}} iniciada. Prazo: {{prazo}}."
          oninput="wfDesignerCampoCfg('${_esc(id)}','comentario_automatico',this.value)">${_esc(cfg.comentario_automatico || '')}</textarea>
      </div>`;
    _wfRenderCamposCond(id);
  }

  function wfDesignerCampoCfg(noId, campo, valor) {
    if (!_wfConfigNos[noId]) _wfConfigNos[noId] = _configPadrao();
    _wfConfigNos[noId][campo] = valor;
  }
  function wfDesignerPapel(noId, papel, valor) {
    if (!_wfConfigNos[noId]) _wfConfigNos[noId] = _configPadrao();
    _wfConfigNos[noId].papeis = _wfConfigNos[noId].papeis || {};
    _wfConfigNos[noId].papeis[papel] = valor || null;
  }
  function wfDesignerToggleAcao(noId, acao, on) {
    if (!_wfConfigNos[noId]) _wfConfigNos[noId] = _configPadrao();
    const set = new Set(_wfConfigNos[noId].acoes || []);
    if (on) set.add(acao); else set.delete(acao);
    _wfConfigNos[noId].acoes = Array.from(set);
  }

  // ── Gateway Condicional — Editor de condições de arestas ──────────────────

  const _WF_OPS_LABELS = ['=','!=','>','<','>=','<=','contém','não contém','vazio','não vazio'];

  function _wfRenderCondicoes(arestaId) {
    const el = document.getElementById(`wf-aresta-conds-${arestaId}`);
    if (!el) return;
    const conds = _wfConfigNos[arestaId]?.condicoes || [];
    if (!conds.length) {
      el.innerHTML = '<div style="font-size:12px;color:var(--ink3)">Sem condições — saída livre.</div>';
      return;
    }
    el.innerHTML = conds.map((c, i) => `
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:4px;margin-bottom:6px;align-items:center">
        <input type="text" class="fi" placeholder="campo" value="${_esc(c.campo || '')}" style="font-size:11px"
          oninput="wfDesignerUpdateCondicao('${_esc(arestaId)}',${i},'campo',this.value)">
        <select class="fi" style="font-size:11px"
          onchange="wfDesignerUpdateCondicao('${_esc(arestaId)}',${i},'operador',this.value)">
          ${_WF_OPS_LABELS.map(op => `<option value="${_esc(op)}"${c.operador === op ? ' selected' : ''}>${_esc(op)}</option>`).join('')}
        </select>
        <input type="text" class="fi" placeholder="valor" value="${_esc(c.valor || '')}" style="font-size:11px"
          oninput="wfDesignerUpdateCondicao('${_esc(arestaId)}',${i},'valor',this.value)">
        <button type="button" style="background:none;border:none;cursor:pointer;color:#ef4444;font-size:14px;padding:0 4px"
          onclick="wfDesignerRemoveCondicao('${_esc(arestaId)}',${i})">✕</button>
      </div>`).join('');
  }

  function wfDesignerAddCondicao(arestaId) {
    if (!_wfConfigNos[arestaId]) _wfConfigNos[arestaId] = { condicoes: [], operador_logico: 'AND', padrao: false };
    (_wfConfigNos[arestaId].condicoes = _wfConfigNos[arestaId].condicoes || []).push({ campo: '', operador: '=', valor: '' });
    _wfRenderCondicoes(arestaId);
  }

  function wfDesignerRemoveCondicao(arestaId, idx) {
    const conds = _wfConfigNos[arestaId]?.condicoes;
    if (conds) { conds.splice(idx, 1); _wfRenderCondicoes(arestaId); }
  }

  function wfDesignerUpdateCondicao(arestaId, idx, chave, valor) {
    const cond = _wfConfigNos[arestaId]?.condicoes?.[idx];
    if (cond) cond[chave] = valor;
  }

  function wfDesignerArestaPadrao(arestaId, val) {
    if (!_wfConfigNos[arestaId]) _wfConfigNos[arestaId] = {};
    _wfConfigNos[arestaId].padrao = val;
    const wrap = document.getElementById(`wf-aresta-conds-wrap-${arestaId}`);
    if (wrap) { wrap.style.opacity = val ? '.4' : '1'; wrap.style.pointerEvents = val ? 'none' : ''; }
  }

  // ── Campos Condicionais — Editor de visibilidade/obrigatoriedade ──────────

  function _wfRenderCamposCond(noId) {
    const el = document.getElementById(`wf-campos-cond-${noId}`);
    if (!el) return;
    const lista = _wfConfigNos[noId]?.campos_condicionais || [];
    if (!lista.length) {
      el.innerHTML = '<div style="font-size:12px;color:var(--ink3)">Sem condições de campo.</div>';
      return;
    }
    el.innerHTML = lista.map((cc, i) => `
      <div style="background:var(--surf2);border-radius:6px;padding:8px;margin-bottom:8px;font-size:12px">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;flex-wrap:wrap">
          <span style="font-weight:600">Campo:</span>
          <input type="text" class="fi" value="${_esc(cc.campo_id || '')}" placeholder="id_do_campo" style="flex:1;min-width:80px;font-size:11px"
            oninput="wfDesignerCampoCondUpdate('${_esc(noId)}',${i},'campo_id',this.value)">
          <select class="fi" style="width:auto;font-size:11px"
            onchange="wfDesignerCampoCondUpdate('${_esc(noId)}',${i},'acao',this.value)">
            ${['mostrar','ocultar','obrigatorio','opcional'].map(a =>
              `<option value="${a}"${cc.acao === a ? ' selected' : ''}>${a}</option>`).join('')}
          </select>
          <span>SE</span>
          <select class="fi" style="width:auto;font-size:11px"
            onchange="wfDesignerCampoCondUpdate('${_esc(noId)}',${i},'operador_logico',this.value)">
            <option value="AND"${(cc.operador_logico || 'AND') === 'AND' ? ' selected' : ''}>AND</option>
            <option value="OR"${cc.operador_logico === 'OR' ? ' selected' : ''}>OR</option>
          </select>
          <button type="button" style="background:none;border:none;cursor:pointer;color:#ef4444"
            onclick="wfDesignerCampoCondRemove('${_esc(noId)}',${i})">✕</button>
        </div>
        <div id="wf-campo-cond-conds-${_esc(noId)}-${i}" style="margin-bottom:4px"></div>
        <button type="button" class="btn btn-sm" style="font-size:10px"
          onclick="wfDesignerCampoCondAddCond('${_esc(noId)}',${i})">+ condição</button>
      </div>`).join('');
    lista.forEach((_, i) => _wfRenderCampoCondConds(noId, i));
  }

  function _wfRenderCampoCondConds(noId, ccIdx) {
    const el = document.getElementById(`wf-campo-cond-conds-${noId}-${ccIdx}`);
    if (!el) return;
    const conds = _wfConfigNos[noId]?.campos_condicionais?.[ccIdx]?.condicoes || [];
    if (!conds.length) { el.innerHTML = '<div style="font-size:11px;color:var(--ink3)">Sem condições.</div>'; return; }
    el.innerHTML = conds.map((c, i) => `
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:4px;margin-bottom:4px">
        <input type="text" class="fi" placeholder="campo" value="${_esc(c.campo || '')}" style="font-size:11px"
          oninput="wfDesignerCampoCondCond('${_esc(noId)}',${ccIdx},${i},'campo',this.value)">
        <select class="fi" style="font-size:11px"
          onchange="wfDesignerCampoCondCond('${_esc(noId)}',${ccIdx},${i},'operador',this.value)">
          ${_WF_OPS_LABELS.map(op => `<option value="${_esc(op)}"${c.operador === op ? ' selected' : ''}>${_esc(op)}</option>`).join('')}
        </select>
        <input type="text" class="fi" placeholder="valor" value="${_esc(c.valor || '')}" style="font-size:11px"
          oninput="wfDesignerCampoCondCond('${_esc(noId)}',${ccIdx},${i},'valor',this.value)">
        <button type="button" style="background:none;border:none;cursor:pointer;color:#ef4444;font-size:14px;padding:0 4px"
          onclick="wfDesignerCampoCondRemoveCond('${_esc(noId)}',${ccIdx},${i})">✕</button>
      </div>`).join('');
  }

  function wfDesignerAddCampoCond(noId) {
    if (!_wfConfigNos[noId]) _wfConfigNos[noId] = _configPadrao();
    (_wfConfigNos[noId].campos_condicionais = _wfConfigNos[noId].campos_condicionais || [])
      .push({ campo_id: '', acao: 'mostrar', condicoes: [], operador_logico: 'AND' });
    _wfRenderCamposCond(noId);
  }

  function wfDesignerCampoCondRemove(noId, idx) {
    _wfConfigNos[noId]?.campos_condicionais?.splice(idx, 1);
    _wfRenderCamposCond(noId);
  }

  function wfDesignerCampoCondUpdate(noId, idx, chave, valor) {
    const cc = _wfConfigNos[noId]?.campos_condicionais?.[idx];
    if (cc) cc[chave] = valor;
  }

  function wfDesignerCampoCondAddCond(noId, ccIdx) {
    const cc = _wfConfigNos[noId]?.campos_condicionais?.[ccIdx];
    if (cc) { (cc.condicoes = cc.condicoes || []).push({ campo: '', operador: '=', valor: '' }); _wfRenderCampoCondConds(noId, ccIdx); }
  }

  function wfDesignerCampoCondRemoveCond(noId, ccIdx, condIdx) {
    _wfConfigNos[noId]?.campos_condicionais?.[ccIdx]?.condicoes?.splice(condIdx, 1);
    _wfRenderCampoCondConds(noId, ccIdx);
  }

  function wfDesignerCampoCondCond(noId, ccIdx, condIdx, chave, valor) {
    const c = _wfConfigNos[noId]?.campos_condicionais?.[ccIdx]?.condicoes?.[condIdx];
    if (c) c[chave] = valor;
  }

  // ── Avaliação de campos condicionais (exposta para renderer de formulários) ─

  function _avaliarCamposCondicionais(camposCondicionais, dadosForm) {
    const res = {};
    (camposCondicionais || []).forEach(cc => {
      const passa = _avaliarCondicoes(cc.condicoes, cc.operador_logico, dadosForm || {});
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

  async function wfDesignerSalvar() {
    if (!_wfModeler || !_wfModeloAtual) return;
    try {
      const { xml } = await _wfModeler.saveXML({ format: true });
      const canvas = _wfSyncCanvas();
      const nome = document.getElementById('wf-designer-nome')?.value.trim() || _wfModeloAtual.nome;
      const descricao = document.getElementById('wf-designer-desc')?.value.trim() || '';
      const dados = {
        nome, descricao,
        status: _wfModeloAtual.status || 'rascunho',
        versao: _wfModeloAtual.versao || 1,
        processo_origem_id: _wfModeloAtual.processo_origem_id || null,
        fluxo_origem: _wfModeloAtual.fluxo_origem || null,
        bpmn_xml: xml,
        config_nos: _wfConfigNos,
        canvas,
        criado_por: _wfModeloAtual.criado_por || _uid(),
      };
      if (_wfModeloAtual.id) {
        await _updateDoc('wf_processo_modelos', _wfModeloAtual.id, dados);
      } else {
        _wfModeloAtual.id = await _addDoc('wf_processo_modelos', dados);
      }
      Object.assign(_wfModeloAtual, dados);
      const dirtyEl = document.getElementById('wf-bpmn-dirty');
      if (dirtyEl) dirtyEl.style.display = 'none';
      if (typeof globalScope.toast === 'function') globalScope.toast('✓ Workflow salvo');
    } catch (e) {
      alert('Erro ao salvar: ' + e.message);
    }
  }

  async function wfDesignerPublicar() {
    if (!_wfModeler || !_wfModeloAtual) return;
    const canvas = _wfSyncCanvas();
    if (!canvas.nos.some(n => n.tipo === 'inicio')) { alert('O fluxo precisa de um evento de início.'); return; }
    if (!canvas.nos.some(n => n.tipo === 'fim')) { alert('O fluxo precisa de um evento de fim.'); return; }
    if (!canvas.arestas.length) { alert('O fluxo precisa de ao menos uma conexão.'); return; }
    _wfModeloAtual.status = 'publicado';
    await wfDesignerSalvar();
    if (typeof globalScope.toast === 'function') globalScope.toast('✓ Workflow publicado!');
    else alert('Workflow publicado!');
    wfNavWorkflow('iniciar');
  }

  // Mantém stubs das funções antigas expostas para não quebrar chamadas inline
  function wfDesignerCampoNo() {}
  function wfDesignerRemoverArestaSel() {}

  // — Coleta perfis que precisam de atribuição explícita ao iniciar —
  // Retorna array de strings únicas, ex: ['ep', 'gestor']
  function _wfPerfisParaAtribuir(nos) {
    const PERFIS_ATRIBUIVEIS = ['ep', 'dono', 'gestor'];
    const encontrados = new Set();
    (nos || []).forEach(n => {
      const p = n.config?.papeis || {};
      ['executor','revisor','aprovador'].forEach(papel => {
        if (p[papel] && PERFIS_ATRIBUIVEIS.includes(p[papel])) encontrados.add(p[papel]);
      });
    });
    return [...encontrados];
  }

  // Abre modal de atribuição; chama callback(atribuicoes) ou null se cancelado
  function _wfAbrirModalAtribuicao(perfisNecessarios, nomeModelo, callback) {
    const el = document.getElementById('wf-modal-atribuicao');
    if (!el) { callback({}); return; }
    const lista = document.getElementById('wf-modal-atrib-lista');
    const titulo = document.getElementById('wf-modal-atrib-titulo');
    if (titulo) titulo.textContent = `Atribuir responsáveis — ${_esc(nomeModelo)}`;

    const PERFIL_LABELS_LOCAL = { ep: 'Equipe de Processos (EP)', dono: 'Dono do Processo', gestor: 'Gestor / Adjunto' };
    const usuariosFiltrados = (globalScope.USUARIOS || []).filter(u => u.uid && u.nome);

    lista.innerHTML = perfisNecessarios.map(perf => {
      const opts = usuariosFiltrados
        .filter(u => {
          const p = globalScope.getPerfisUsuario ? globalScope.getPerfisUsuario(u) : (u.perfis || (u.perfil ? [u.perfil] : []));
          return p.includes(perf);
        })
        .map(u => `<option value="${_esc(u.uid)}">${_esc(u.nome)}</option>`)
        .join('');
      return `<div style="margin-bottom:14px">
        <label class="lbl" style="display:block;margin-bottom:4px">${_esc(PERFIL_LABELS_LOCAL[perf] || perf)}</label>
        <select class="fi" id="wf-atrib-sel-${_esc(perf)}">${opts || '<option value="">— nenhum usuário com este perfil —</option>'}</select>
      </div>`;
    }).join('');

    el.style.display = 'flex';
    // armazena callback no elemento para uso no confirmar/cancelar
    el._atribCallback = callback;
    el._atribPerfis = perfisNecessarios;
  }

  function wfConfirmarAtribuicao() {
    const el = document.getElementById('wf-modal-atribuicao');
    if (!el) return;
    const perfis = el._atribPerfis || [];
    const atribuicoes = {};
    for (const perf of perfis) {
      const sel = document.getElementById(`wf-atrib-sel-${perf}`);
      if (sel?.value) atribuicoes[perf] = sel.value;
    }
    el.style.display = 'none';
    if (typeof el._atribCallback === 'function') el._atribCallback(atribuicoes);
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
    const primeira = _proximoNo(modelo.canvas, inicio.id, null);
    if (!primeira) { alert('Modelo sem etapa após o início.'); return; }

    // Verifica se há perfis que precisam de atribuição explícita
    const perfisNecessarios = _wfPerfisParaAtribuir(nos);

    const _prosseguir = async (atribuicoes) => {
      if (atribuicoes === null) return; // cancelado
      const titulo = `${modelo.nome} — ${new Date().toLocaleDateString('pt-BR')}`;
      try {
        const anoAtual = new Date().getFullYear();
        const instanciaId = await _addDoc('wf_instancia_processos', {
          processo_id: modelo.processo_origem_id || null,
          modelo_id: modelo.id,
          processo_nome: modelo.nome,
          titulo,
          numero: `${anoAtual}-${Date.now().toString().slice(-6)}`,
          status: 'em_andamento',
          no_atual_id: primeira.id,
          etapa_atual_id: primeira.id,
          solicitante_uid: uid,
          ultimo_executor_uid: null,
          atribuicoes: Object.keys(atribuicoes).length ? atribuicoes : null,
          canvas: modelo.canvas,
          snapshot_etapas: nos.filter(n => n.tipo === 'tarefa' || n.tipo === 'aprovacao')
            .map(n => ({ id: n.id, nome: n.nome, tipo: n.tipo })),
          dados_consolidados: {},
          concluido_em: null,
        });
        await _registrarHistorico(instanciaId, 'instancia_criada', uid, null, null,
          `Workflow "${modelo.nome}" iniciado a partir de template.`, { modelo_id: modelo.id });
        const instObj = { id: instanciaId, titulo, processo_id: modelo.processo_origem_id, solicitante_uid: uid, atribuicoes };
        await _criarTarefasDoNo(instObj, primeira);
        alert(`Workflow iniciado! Etapa "${primeira.nome}" criada.`);
        wfNavWorkflow(globalScope.isSolicitante?.() ? 'instancias' : 'tarefas');
      } catch (e) {
        alert('Erro ao iniciar: ' + e.message);
      }
    };

    if (perfisNecessarios.length) {
      _wfAbrirModalAtribuicao(perfisNecessarios, modelo.nome, _prosseguir);
    } else {
      _prosseguir({});
    }
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
    if (!cond || !cond.campo) return true;
    const fn = _WF_OPS[cond.operador];
    if (!fn) return true;
    try { return fn(dados[cond.campo], cond.valor); } catch { return true; }
  }

  function _avaliarCondicoes(condicoes, operadorLogico, dados) {
    if (!condicoes || !condicoes.length) return true;
    const isOR = (operadorLogico || 'AND').toUpperCase() === 'OR';
    return isOR
      ? condicoes.some(c  => _avaliarCondicaoObj(c, dados))
      : condicoes.every(c => _avaliarCondicaoObj(c, dados));
  }

  // Mantém compatibilidade com strings legacy ("campo op valor")
  function _avaliarCondicao(condicao, dados) {
    if (!condicao || !condicao.trim()) return true;
    try {
      const m = condicao.trim().match(/^(\w+)\s*(==|!=|>=|<=|>|<)\s*(\S.*)/);
      if (!m) return true;
      const [, campo, op, valorRaw] = m;
      const valorStr = valorRaw.trimEnd().replace(/^['"]|['"]$/g, '');
      // Normaliza: == vira =
      const opNorm = op === '==' ? '=' : op;
      const fn = _WF_OPS[opNorm];
      if (!fn) return true;
      const valComp = isNaN(valorStr) ? valorStr : Number(valorStr);
      return fn(dados[campo], valComp);
    } catch { return true; }
  }

  function _proximoNo(canvas, noId, acao, dados = {}) {
    const arestas = canvas.arestas || [];
    const nos = canvas.nos || [];
    const candidatas = arestas.filter(a =>
      a.origem === noId && (acao == null || a.acao === acao || !a.acao)
    );
    const padrão = candidatas.find(a => a.padrao);
    const condicionais = candidatas.filter(a => !a.padrao);
    const aresta = condicionais.find(a =>
      a.condicoes && a.condicoes.length
        ? _avaliarCondicoes(a.condicoes, a.operador_logico, dados)
        : _avaliarCondicao(a.condicao, dados)
    ) || padrão || (acao != null ? arestas.find(a => a.origem === noId) : null);
    if (!aresta) return null;
    const destino = nos.find(n => n.id === aresta.destino);
    if (!destino) return null;
    if (destino.tipo === 'inicio') return _proximoNo(canvas, destino.id, null, dados);
    return destino;
  }

  // ── Template Engine ───────────────────────────────────────────────────────

  function _interpolarTemplate(tmpl, ctx) {
    if (!tmpl) return '';
    return tmpl.replace(/\{\{([\w.]+)\}\}/g, (_, chave) => {
      const val = chave.split('.').reduce((o, k) => (o != null ? o[k] : ''), ctx);
      return val != null ? String(val) : '';
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

    document.getElementById('wf-hist-resumo').innerHTML =
      `<div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">
        <div><div style="font-size:11px;color:var(--ink3)">Status</div>${_badge(statusLabels[status] || status, statusCores[status] || '#6b7280')}</div>
        <div><div style="font-size:11px;color:var(--ink3)">ID</div><div style="font-size:12px;font-family:monospace">${_esc(instanciaId)}</div></div>
      </div>`;

    const tl = document.getElementById('wf-hist-timeline');
    tl.innerHTML = '<div style="color:var(--ink3);font-size:14px">Carregando…</div>';
    try {
      const { where } = globalScope.fb();
      const eventos = (await _getAll('wf_historico_workflows',
        where('instancia_id', '==', instanciaId),
      )).sort((a, b) => {
        const ta = a._criado_em?.seconds ?? (a._criado_em ? a._criado_em.getTime() / 1000 : 0);
        const tb = b._criado_em?.seconds ?? (b._criado_em ? b._criado_em.getTime() / 1000 : 0);
        return ta - tb;
      });
      const ACAO_LABELS = globalScope.WF_ACAO_LABELS || {};
      const ACAO_COR = globalScope.WF_ACAO_COR || {};
      const PAPEL_LABELS = globalScope.WF_PAPEL_LABELS || {};
      const nomeUsuario = (uid) => {
        if (!uid) return null;
        const u = (globalScope.USUARIOS || []).find(x => x.uid === uid || x.id === uid);
        return u?.nome || u?.email || uid;
      };
      tl.innerHTML = eventos.length ? eventos.map(h => {
        const ts = h._criado_em?.toDate
          ? h._criado_em.toDate().toLocaleString('pt-BR')
          : (h._criado_em?.seconds ? new Date(h._criado_em.seconds * 1000).toLocaleString('pt-BR') : '—');
        const d = h.dados || {};
        const usuario = nomeUsuario(h.usuario_uid);
        const acaoBadge = d.acao ? _badge(ACAO_LABELS[d.acao] || d.acao, ACAO_COR[d.acao] || '#6b7280') : '';
        const papelTxt = d.papel ? `<span style="font-size:11px;color:var(--ink3)"> · ${_esc(PAPEL_LABELS[d.papel] || d.papel)}</span>` : '';
        const parecer = d.parecer ? `<div style="font-size:12px;color:var(--ink2);margin-top:4px;font-style:italic">"${_esc(d.parecer)}"</div>` : '';
        return `<div style="position:relative;margin-bottom:16px;padding-left:16px">
          <div style="position:absolute;left:-5px;top:4px;width:10px;height:10px;border-radius:50%;background:var(--blue);border:2px solid #fff;box-shadow:0 0 0 2px var(--blue)"></div>
          <div style="font-size:11px;color:var(--ink3)">${_esc(ts)}${usuario ? ` · ${_esc(usuario)}` : ''}${papelTxt}</div>
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
        const { where: whereC } = globalScope.fb();
        const todosComentarios = (await _getAll('wf_comentarios',
          whereC('instancia_id', '==', instanciaId),
        )).sort((a, b) => (a._criado_em?.seconds ?? 0) - (b._criado_em?.seconds ?? 0));

        if (!todosComentarios.length) {
          elComentPorEtapa.innerHTML = '<div style="color:var(--ink3);font-size:13px">Nenhum comentário registrado.</div>';
        } else {
          // Agrupa por etapa_nome (ou etapa_id)
          const grupos = {};
          const ordemGrupos = [];
          todosComentarios.forEach(c => {
            const chave = c.etapa_nome || c.etapa_id || 'Sem etapa';
            if (!grupos[chave]) { grupos[chave] = []; ordemGrupos.push(chave); }
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
      } catch (_e) {
        elComentPorEtapa.innerHTML = '';
      }
    }

    wfNavWorkflow('historico');
  }

  async function wfConfirmarCancelar(instanciaId) {
    const motivo = prompt('Motivo do cancelamento:');
    if (motivo === null) return;
    const { where, writeBatch, doc } = globalScope.fb();

    // Cancela tarefas abertas da instância em batch
    const tarefasAbertas = await _getAll('wf_tarefa_workflows',
      where('instancia_id', '==', instanciaId),
      where('status', '==', 'pendente'),
    );
    if (tarefasAbertas.length) {
      const batch = writeBatch(_db());
      tarefasAbertas.forEach(t => {
        batch.update(doc(_db(), 'wf_tarefa_workflows', t.id), {
          status: 'cancelada',
          cancelada_em: new Date(),
        });
      });
      await batch.commit();
    }

    await _updateDoc('wf_instancia_processos', instanciaId, { status: 'cancelado', concluido_em: new Date() });
    await _registrarHistorico(instanciaId, 'instancia_cancelada', _uid(),
      null, null, `Processo cancelado. Motivo: ${motivo}`, { motivo, tarefas_canceladas: tarefasAbertas.length });
    wfCarregarInstancias();
  }

  async function wfCancelarInstancia() {
    if (!_st.instanciaAtual) return;
    await wfConfirmarCancelar(_st.instanciaAtual.id);
    wfNavWorkflow('instancias');
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
    let schema = null;
    if (formularioId) {
      schema = await _getDoc('wf_formulario_modelos', formularioId);
    }
    _st.formularioAtual = schema || { id: null, titulo: '', campos: [], versao: 1 };
    _st.formularioCampos = JSON.parse(JSON.stringify(_st.formularioAtual.campos || []));

    const overlay = document.getElementById('wf-modal-formulario');
    if (!overlay) return;

    document.getElementById('wf-modal-form-titulo').value = _st.formularioAtual.titulo || '';
    _wfRenderizarCamposEditor();
    overlay.style.display = 'flex';
  }

  function _wfRenderizarCamposEditor() {
    const el = document.getElementById('wf-modal-form-campos');
    if (!el) return;
    if (!_st.formularioCampos.length) {
      el.innerHTML = '<div style="color:var(--ink3);font-size:13px;margin-bottom:8px">Nenhum campo adicionado ainda.</div>';
      return;
    }
    el.innerHTML = _st.formularioCampos.map((c, i) => `
      <div style="border:1px solid var(--bdr);border-radius:8px;padding:12px;margin-bottom:10px;background:var(--bg2)">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px">
          <span style="font-size:13px;font-weight:600">${_esc(c.label || 'Campo ' + (i+1))}</span>
          <div style="display:flex;gap:4px">
            ${i > 0 ? `<button type="button" class="btn btn-sm" onclick="_wfMoverCampo(${i},-1)" title="Mover para cima">↑</button>` : ''}
            ${i < _st.formularioCampos.length - 1 ? `<button type="button" class="btn btn-sm" onclick="_wfMoverCampo(${i},1)" title="Mover para baixo">↓</button>` : ''}
            <button type="button" class="btn btn-r btn-sm" onclick="_wfRemoverCampo(${i})">✕</button>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div>
            <label class="lbl" style="font-size:11px">Label</label>
            <input type="text" class="fi" value="${_esc(c.label)}" oninput="_wfAtualizarCampo(${i},'label',this.value)" style="margin-top:2px">
          </div>
          <div>
            <label class="lbl" style="font-size:11px">Tipo</label>
            <select class="fi" onchange="_wfAtualizarCampo(${i},'tipo',this.value)" style="margin-top:2px">
              ${_tiposCampo.map(t => `<option value="${t.v}"${c.tipo===t.v?' selected':''}>${_esc(t.l)}</option>`).join('')}
            </select>
          </div>
        </div>
        ${c.tipo === 'select' ? `
        <div style="margin-top:8px">
          <label class="lbl" style="font-size:11px">Opções (uma por linha)</label>
          <textarea class="fi" rows="3" oninput="_wfAtualizarCampo(${i},'_opcoesTexto',this.value)" style="margin-top:2px;resize:vertical">${_esc((c.opcoes||[]).join('\n'))}</textarea>
        </div>` : ''}
        <div style="margin-top:8px">
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer">
            <input type="checkbox" ${c.obrigatorio?'checked':''} onchange="_wfAtualizarCampo(${i},'obrigatorio',this.checked)">
            Campo obrigatório
          </label>
        </div>
      </div>
    `).join('');
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
      if (schema.id) {
        await _updateDoc('wf_formulario_modelos', schema.id, {
          titulo,
          campos,
          versao: (schema.versao || 1) + 1,
        });
      } else {
        await _addDoc('wf_formulario_modelos', {
          titulo,
          campos,
          versao: 1,
        });
      }
      wfFecharModalFormulario();
      wfCarregarFormularios();
    } catch (e) {
      alert('Erro ao salvar formulário: ' + e.message);
    }
  }

  // ── Configurar Processo ───────────────────────────────────────────────────
  async function wfConfigurarProcesso(processoId) {
    const proc = await _getDoc('processos', processoId);
    if (!proc) { alert('Processo não encontrado.'); return; }

    const usaToBe = (proc.mod?.etapas_proc_tobe || []).length > 0;
    const todasEtapas = usaToBe ? proc.mod.etapas_proc_tobe : (proc.mod?.etapas_proc || []);
    const atividades = todasEtapas.filter(e => !e.tipo || e.tipo === 'Atividade' || e.tipo === 'Aprovação');

    _st.configProcessoId = processoId;
    _st.configProcessoEtapas = atividades.map((e, i) => ({
      id: `${processoId}_${e.id || i}`,
      nome: e.nome || `Etapa ${i + 1}`,
    }));

    // Carrega config salva
    let configSalva = {};
    try {
      const doc = await _getDoc('wf_config_processo', processoId);
      configSalva = doc?.etapas || {};
    } catch (_e) { /* sem config prévia */ }

    // Carrega modelos de formulário
    if (!_st.formularioModelos.length) {
      _st.formularioModelos = await _getAll('wf_formulario_modelos');
    }

    // Título
    const tituloEl = document.getElementById('wf-config-proc-titulo');
    if (tituloEl) tituloEl.textContent = proc.nome;

    // Renderiza etapas
    const etapasEl = document.getElementById('wf-config-proc-etapas');
    if (etapasEl) {
      const opcoesFormulario = _st.formularioModelos.map(m =>
        `<option value="${_esc(m.id)}">${_esc(m.titulo)}</option>`
      ).join('');

      etapasEl.innerHTML = _st.configProcessoEtapas.map(etapa => {
        const conf = configSalva[etapa.id] || {};
        return `
          <div style="border:1px solid var(--bdr);border-radius:8px;padding:14px;margin-bottom:10px">
            <div style="font-weight:600;font-size:14px;margin-bottom:10px">${_esc(etapa.nome)}</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
              <div>
                <label class="lbl" style="font-size:11px">Formulário</label>
                <select class="fi" id="wf-conf-form-${_esc(etapa.id)}" style="margin-top:4px">
                  <option value="">— Sem formulário —</option>
                  ${opcoesFormulario}
                </select>
              </div>
              <div>
                <label class="lbl" style="font-size:11px">SLA (horas)</label>
                <input type="number" class="fi" id="wf-conf-sla-${_esc(etapa.id)}" min="0" value="${_esc(String(conf.sla_horas ?? 0))}" style="margin-top:4px">
              </div>
            </div>
          </div>
        `;
      }).join('');

      // Preenche selects com valor salvo
      _st.configProcessoEtapas.forEach(etapa => {
        const conf = configSalva[etapa.id] || {};
        const sel = document.getElementById(`wf-conf-form-${etapa.id}`);
        if (sel && conf.formulario_id) sel.value = conf.formulario_id;
      });
    }

    wfNavWorkflow('config-processo');
  }

  async function wfSalvarConfigProcesso() {
    if (!_st.configProcessoId) return;

    const etapas = {};
    _st.configProcessoEtapas.forEach(etapa => {
      const sel = document.getElementById(`wf-conf-form-${etapa.id}`);
      const slaEl = document.getElementById(`wf-conf-sla-${etapa.id}`);
      etapas[etapa.id] = {
        formulario_id: sel?.value || null,
        sla_horas: Number(slaEl?.value || 0),
      };
    });

    try {
      await _setDoc('wf_config_processo', _st.configProcessoId, {
        processo_id: _st.configProcessoId,
        etapas,
      });
      alert('Configuração salva com sucesso.');
      wfNavWorkflow('iniciar');
    } catch (e) {
      alert('Erro ao salvar configuração: ' + e.message);
    }
  }

  // ── P3: Thread de comentários ─────────────────────────────────────────────

  // Renderiza thread de comentários em um elemento — reutilizado no painel de execução
  function _renderThreadComentarios(comentarios, containerEl, interativo = true) {
    const nomeUsuario = (uid) => {
      if (!uid) return '—';
      if (uid === 'sistema') return '⚙ Sistema';
      const u = (globalScope.USUARIOS || []).find(x => x.uid === uid || x.id === uid);
      return u?.nome || u?.email || uid;
    };
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
            <span style="font-weight:600;font-size:13px">${_esc(nomeUsuario(c.autor_uid))}</span>
            <span style="font-size:11px;color:var(--ink3)">${ts}</span>
            ${interativo && nivel === 0 ? `<button type="button" class="btn btn-sm" style="margin-left:auto;font-size:11px;padding:2px 8px"
              onclick="wfResponderComentario('${_esc(c.id)}','${_esc(nomeUsuario(c.autor_uid))}')">Responder</button>` : ''}
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
      const { where } = globalScope.fb();
      const comentarios = (await _getAll('wf_comentarios',
        where('tarefa_id', '==', tarefaId),
      )).sort((a, b) => (a._criado_em?.seconds ?? 0) - (b._criado_em?.seconds ?? 0));
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
      await _addDoc('wf_comentarios', {
        tarefa_id: _st.tarefaAtual.id,
        instancia_id: _st.tarefaAtual.instancia_id,
        etapa_id: _st.tarefaAtual.etapa_modelo_id || null,
        etapa_nome: _st.tarefaAtual.etapa_nome || null,
        autor_uid: _uid(),
        texto,
        respondendo_a: _st._respondendoA || null,
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

      const nomeUsuario = (uid) => {
        if (!uid) return '';
        const u = (globalScope.USUARIOS || []).find(x => x.uid === uid || x.id === uid);
        return u?.nome || u?.email || uid;
      };

      const { where: whereC } = globalScope.fb();
      const comentariosCSV = (await _getAll('wf_comentarios',
        whereC('instancia_id', '==', _st.instanciaAtual.id),
      )).sort((a, b) => (a._criado_em?.seconds ?? 0) - (b._criado_em?.seconds ?? 0));

      const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const linhas = [
        ['Data/Hora', 'Tipo', 'Usuário', 'Etapa', 'Ação', 'Parecer', 'Descrição/Comentário'].map(esc).join(','),
        ...eventos.map(h => {
          const ts = h._criado_em?.seconds
            ? new Date(h._criado_em.seconds * 1000).toLocaleString('pt-BR') : '';
          const d = h.dados || {};
          return [ts, h.tipo_evento, nomeUsuario(h.usuario_uid), h.etapa_id || '',
            d.acao || '', d.parecer || '', h.descricao || ''].map(esc).join(',');
        }),
        ...comentariosCSV.map(c => {
          const ts = c._criado_em?.seconds
            ? new Date(c._criado_em.seconds * 1000).toLocaleString('pt-BR') : '';
          return [ts, 'comentario', nomeUsuario(c.autor_uid), c.etapa_nome || c.etapa_id || '',
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
        _getAll('wf_comentarios', where('instancia_id', '==', _st.instanciaAtual.id)),
      ]);
      eventos.sort((a, b) => (a._criado_em?.seconds ?? 0) - (b._criado_em?.seconds ?? 0));
      comentarios.sort((a, b) => (a._criado_em?.seconds ?? 0) - (b._criado_em?.seconds ?? 0));

      const nomeUsuario = (uid) => {
        if (!uid) return '—';
        if (uid === 'sistema') return '⚙ Sistema';
        const u = (globalScope.USUARIOS || []).find(x => x.uid === uid || x.id === uid);
        return u?.nome || u?.email || uid;
      };
      const esc = v => String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const ts = s => s?.seconds ? new Date(s.seconds * 1000).toLocaleString('pt-BR') : '—';

      const linhasEventos = eventos.map(h => {
        const d = h.dados || {};
        return `<tr>
          <td>${esc(ts(h._criado_em))}</td>
          <td>${esc(h.tipo_evento)}</td>
          <td>${esc(nomeUsuario(h.usuario_uid))}</td>
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
        if (!gruposComent[chave]) { gruposComent[chave] = []; ordemGrupos.push(chave); }
        gruposComent[chave].push(c);
      });
      const secaoComentarios = ordemGrupos.length ? `<h2>Comentários por etapa</h2>` + ordemGrupos.map(chave => {
        const linhas = gruposComent[chave].map(c => {
          const indent = c.respondendo_a ? 'padding-left:20px;color:#555' : '';
          return `<tr><td style="${indent}">${esc(ts(c._criado_em))}</td><td style="${indent}">${esc(nomeUsuario(c.autor_uid))}</td><td style="${indent}">${esc(c.texto)}</td></tr>`;
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
      win.document.write(html);
      win.document.close();
      win.onload = () => { win.focus(); win.print(); };
    } catch (e) {
      alert('Erro ao gerar PDF: ' + e.message);
    }
  }

  // ── P3: Delegação de tarefa ───────────────────────────────────────────────

  async function wfExcluirTarefa(tarefaId) {
    if (!confirm('Excluir esta tarefa permanentemente? Esta ação não pode ser desfeita.')) return;
    try {
      const tarefa = await _getDoc('wf_tarefa_workflows', tarefaId);
      await _deleteDoc('wf_tarefa_workflows', tarefaId);
      if (tarefa?.instancia_id) {
        await _registrarHistorico(tarefa.instancia_id, 'tarefa_excluida', _uid(),
          tarefa.etapa_modelo_id || null, tarefaId,
          `Tarefa "${tarefa.etapa_nome || tarefaId}" excluída manualmente.`, {});
      }
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
      await _updateDoc('wf_tarefa_workflows', tarefaId, {
        responsavel_uid: novoUid,
        status: 'pendente',
        iniciado_em: null,
      });
      // Notifica o novo responsável
      const tarefa = await _getDoc('wf_tarefa_workflows', tarefaId);
      if (tarefa) {
        await _addDoc('wf_notificacoes', {
          destinatario_uid: novoUid,
          tipo: 'tarefa_delegada',
          titulo: `Tarefa delegada: ${tarefa.etapa_nome}`,
          mensagem: `A tarefa "${tarefa.etapa_nome}" do processo "${tarefa.processo_nome}" foi delegada a você.${motivo ? ` Motivo: ${motivo}` : ''}`,
          instancia_id: tarefa.instancia_id,
          tarefa_id: tarefaId,
          lida: false,
        });
        await _registrarHistorico(tarefa.instancia_id, 'tarefa_delegada', _uid(),
          tarefa.etapa_modelo_id, tarefaId,
          `Tarefa delegada para usuário ${novoUid}.${motivo ? ` Motivo: ${motivo}` : ''}`,
          { novoResponsavel: novoUid, motivo });
      }
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
      await _updateDoc('wf_instancia_processos', instanciaId, { status: 'suspenso', suspenso_em: new Date() });
      await _registrarHistorico(instanciaId, 'instancia_suspensa', _uid(), null, null, 'Processo suspenso.', {});
      wfCarregarInstancias();
    } catch (e) {
      alert('Erro ao suspender: ' + e.message);
    }
  }

  async function wfRetomarInstancia(instanciaId) {
    if (!confirm('Retomar este processo?')) return;
    try {
      await _updateDoc('wf_instancia_processos', instanciaId, { status: 'em_andamento', suspenso_em: null });
      await _registrarHistorico(instanciaId, 'instancia_retomada', _uid(), null, null, 'Processo retomado.', {});
      wfCarregarInstancias();
    } catch (e) {
      alert('Erro ao retomar: ' + e.message);
    }
  }

  // ── P3: Marcar todas as notificações como lidas ───────────────────────────

  async function wfMarcarTodasLidas() {
    const uid = _uid();
    if (!uid) return;
    try {
      const { where, query, collection, getDocs, writeBatch, doc } = globalScope.fb();
      const q = query(
        collection(_db(), 'wf_notificacoes'),
        where('destinatario_uid', '==', uid),
        where('lida', '==', false),
      );
      const snap = await getDocs(q);
      if (snap.empty) return;
      const batch = writeBatch(_db());
      snap.docs.forEach(d => batch.update(doc(_db(), 'wf_notificacoes', d.id), { lida: true }));
      await batch.commit();
      _wfRenderNotifPanel();
    } catch (e) {
      alert('Erro: ' + e.message);
    }
  }

  // ── P3: Dashboard de métricas ─────────────────────────────────────────────

  async function wfCarregarDashboard() {
    const el = document.getElementById('wf-dashboard-conteudo');
    if (!el) return;
    el.innerHTML = '<div style="color:var(--ink3);font-size:14px">Carregando…</div>';
    const uid = _uid();
    if (!uid) return;
    try {
      const { where, query, collection, getDocs } = globalScope.fb();
      const db = _db();

      const [snapMinhas, snapTarefas, snapSlaVencido] = await Promise.all([
        getDocs(query(collection(db, 'wf_instancia_processos'), where('solicitante_uid', '==', uid))),
        getDocs(query(collection(db, 'wf_tarefa_workflows'), where('responsavel_uid', '==', uid))),
        getDocs(query(collection(db, 'wf_tarefa_workflows'),
          where('responsavel_uid', '==', uid),
          where('sla_vencido', '==', true),
        )),
      ]);

      const instancias = snapMinhas.docs.map(d => d.data());
      const tarefas = snapTarefas.docs.map(d => d.data());

      const totalInst = instancias.length;
      const ativas = instancias.filter(i => i.status === 'em_andamento').length;
      const concluidas = instancias.filter(i => i.status === 'concluido').length;
      const canceladas = instancias.filter(i => i.status === 'cancelado').length;
      const suspensas = instancias.filter(i => i.status === 'suspenso').length;

      const tarefasPendentes = tarefas.filter(t => t.status === 'pendente' || t.status === 'em_execucao').length;
      const tarefasConcluidas = tarefas.filter(t => t.status === 'concluida').length;
      const tarefasVencidas = snapSlaVencido.size;

      // Tempo médio de conclusão (instâncias concluídas com datas)
      const temposMed = instancias
        .filter(i => i.status === 'concluido' && i._criado_em && i.concluido_em)
        .map(i => {
          const inicio = i._criado_em?.seconds ? i._criado_em.seconds * 1000 : new Date(i._criado_em).getTime();
          const fim = i.concluido_em?.seconds ? i.concluido_em.seconds * 1000 : new Date(i.concluido_em).getTime();
          return (fim - inicio) / 3600000; // horas
        });
      const tempoMedH = temposMed.length
        ? (temposMed.reduce((a, b) => a + b, 0) / temposMed.length).toFixed(1)
        : null;

      const kpi = (label, valor, cor = 'var(--ink)') =>
        `<div style="background:var(--surf2);border-radius:10px;padding:16px 20px;text-align:center">
          <div style="font-size:28px;font-weight:700;color:${cor}">${valor}</div>
          <div style="font-size:12px;color:var(--ink3);margin-top:4px">${label}</div>
        </div>`;

      el.innerHTML = `
        <div style="margin-bottom:20px">
          <div style="font-size:13px;font-weight:600;color:var(--ink3);margin-bottom:10px;text-transform:uppercase;letter-spacing:.05em">Meus Processos</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px">
            ${kpi('Total', totalInst)}
            ${kpi('Em andamento', ativas, '#3b82f6')}
            ${kpi('Concluídos', concluidas, '#10b981')}
            ${kpi('Suspensos', suspensas, '#f59e0b')}
            ${kpi('Cancelados', canceladas, '#ef4444')}
            ${tempoMedH ? kpi('Tempo médio (h)', tempoMedH) : ''}
          </div>
        </div>
        <div>
          <div style="font-size:13px;font-weight:600;color:var(--ink3);margin-bottom:10px;text-transform:uppercase;letter-spacing:.05em">Minhas Tarefas</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px">
            ${kpi('Pendentes', tarefasPendentes, '#3b82f6')}
            ${kpi('Concluídas', tarefasConcluidas, '#10b981')}
            ${kpi('SLA Vencido', tarefasVencidas, '#ef4444')}
          </div>
        </div>
      `;
    } catch (e) {
      el.innerHTML = `<div style="color:#ef4444;font-size:13px">Erro ao carregar métricas: ${_esc(e.message)}</div>`;
    }
  }

  // ── Exposição global ──────────────────────────────────────────────────────
  Object.assign(globalScope, {
    rWorkflow,
    wfNavWorkflow,
    wfCarregarTarefas,
    wfAbrirTarefa,
    wfConcluirTarefa,
    wfAnexarArquivos,
    wfRemoverAnexo,
    wfCarregarInstancias,
    wfCarregarProcessosMapeados,
    wfCarregarIniciar,
    wfIniciarAba,
    wfCarregarTemplatesPublicados,
    wfIniciarDeProcesso,
    wfIniciarDeModelo,
    wfConfirmarAtribuicao,
    wfCancelarAtribuicao,
    // Designer
    wfImportarMapeamento,
    wfAbrirDesigner,
    wfDesignerRemoverArestaSel,
    wfDesignerCampoNo,
    wfDesignerCampoCfg,
    wfDesignerPapel,
    wfDesignerToggleAcao,
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
    wfCarregarDashboard,
    // Formulários
    wfCarregarFormularios,
    wfAbrirModalNovoFormulario,
    wfFecharModalFormulario,
    wfSalvarFormulario,
    _wfAdicionarCampo,
    _wfRenderizarCamposEditor,
    _wfAtualizarCampo,
    _wfRemoverCampo,
    _wfMoverCampo,
    // Config processo
    wfConfigurarProcesso,
    wfSalvarConfigProcesso,
    _st,
  });

  // Tecla Delete remove o nó/aresta selecionado no designer
  document.addEventListener('keydown', (evt) => {
    if (_st.painelAtual !== 'designer') return;
    if (evt.key !== 'Delete' && evt.key !== 'Backspace') return;
    const tag = (evt.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if (_st.designerArestaSel) { evt.preventDefault(); wfDesignerRemoverArestaSel(); }
    else if (_st.designerNoSel) { evt.preventDefault(); _designerRemoverNo(_st.designerNoSel); }
  });

})(globalThis);
