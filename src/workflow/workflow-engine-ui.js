(function initWorkflowUI(globalScope) {
  'use strict';

  // ── Estado interno do módulo ──────────────────────────────────────────────
  const _st = {
    painelAtual: 'tarefas',
    instanciaAtual: null,
    tarefaAtual: null,
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
  const _paineis = ['tarefas','instancias','iniciar','executar','historico'];

  function wfNavWorkflow(painel) {
    _st.painelAtual = painel;
    _paineis.forEach(p => {
      const el = document.getElementById(`wf-painel-${p}`);
      if (el) el.style.display = 'none';
    });
    const alvo = document.getElementById(`wf-painel-${painel}`);
    if (alvo) alvo.style.display = '';

    const tabIds = ['tarefas','instancias','iniciar'];
    tabIds.forEach(t => {
      const btn = document.getElementById(`wf-tab-${t}`);
      if (btn) btn.style.fontWeight = t === painel ? '700' : '';
    });

    const carregadores = {
      tarefas: wfCarregarTarefas,
      instancias: wfCarregarInstancias,
      iniciar: wfCarregarProcessosMapeados,
    };
    carregadores[painel]?.();
  }

  function rWorkflow() {
    wfNavWorkflow(_st.painelAtual || 'tarefas');
  }

  // ── Tarefas ───────────────────────────────────────────────────────────────
  async function wfCarregarTarefas() {
    const el = document.getElementById('wf-lista-tarefas');
    if (!el) return;
    el.innerHTML = '<div style="color:var(--ink3);font-size:14px">Carregando…</div>';
    try {
      const uid = _uid();
      if (!uid) { el.innerHTML = '<div style="color:var(--ink3);font-size:14px">Usuário não autenticado.</div>'; return; }
      const { where } = globalScope.fb();
      const tarefas = await _getAll('wf_tarefa_workflows',
        where('responsavel_uid', '==', uid),
        where('status', 'in', ['pendente','em_execucao']),
      );
      if (!tarefas.length) {
        el.innerHTML = '<div style="color:var(--ink3);font-size:14px">Nenhuma tarefa pendente.</div>';
        return;
      }
      const statusLabels = { pendente:'Pendente', em_execucao:'Em execução', concluida:'Concluída', vencida:'Vencida' };
      const statusCores = { pendente:'#3b82f6', em_execucao:'#f59e0b', concluida:'#10b981', vencida:'#ef4444' };
      el.innerHTML = tarefas.map(t => _card(`
        <div style="font-weight:600;font-size:14px;margin-bottom:4px">${_esc(t.etapa_nome || t.etapa_modelo_id)}</div>
        <div style="font-size:12px;color:var(--ink3);margin-bottom:6px">${_esc(t.processo_nome || t.instancia_id)}</div>
        ${_badge(statusLabels[t.status] || t.status, statusCores[t.status] || '#6b7280')}
        ${_slaInfo(t)}
        ${t.etapa_desc ? `<div style="font-size:12px;color:var(--ink2);margin-top:6px">${_esc(t.etapa_desc)}</div>` : ''}
        <div style="margin-top:10px">
          <button type="button" class="btn btn-p btn-sm" onclick="wfAbrirTarefa('${_esc(t.id)}')">Abrir tarefa</button>
        </div>
      `)).join('');
    } catch (e) {
      el.innerHTML = `<div style="color:var(--red);font-size:14px">${_esc(e.message)}</div>`;
    }
  }

  async function wfAbrirTarefa(tarefaId) {
    const tarefa = await _getDoc('wf_tarefa_workflows', tarefaId);
    if (!tarefa) { alert('Tarefa não encontrada.'); return; }
    _st.tarefaAtual = tarefa;

    if (tarefa.status === 'pendente') {
      await _updateDoc('wf_tarefa_workflows', tarefaId, { status: 'em_execucao', iniciado_em: new Date() });
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

    // Botões de ação: próxima etapa ou concluir
    const acoesEl = document.getElementById('wf-exec-acoes');
    const etapaAtual = etapas[idxAtual];
    const proxEtapa = etapas[idxAtual + 1];
    if (proxEtapa) {
      acoesEl.innerHTML = `
        <button type="button" class="btn btn-p" onclick="wfConcluirTarefa()">Avançar → ${_esc(proxEtapa.nome)}</button>
        <button type="button" class="btn" onclick="wfNavWorkflow('tarefas')">Cancelar</button>`;
    } else {
      acoesEl.innerHTML = `
        <button type="button" class="btn btn-p" onclick="wfConcluirTarefa()">Concluir processo</button>
        <button type="button" class="btn" onclick="wfNavWorkflow('tarefas')">Cancelar</button>`;
    }

    wfNavWorkflow('executar');
  }

  async function wfConcluirTarefa() {
    if (!_st.tarefaAtual) return;
    const obs = document.getElementById('wf-exec-obs').value.trim();
    const dadosForm = {};

    // Coleta campos do formulário se existir
    const formContainer = document.querySelector('#wf-exec-formulario .wf-form');
    if (formContainer && _st.tarefaAtual._campos) {
      const resultado = globalScope.wfColetarDadosFormulario(formContainer, _st.tarefaAtual._campos);
      if (!resultado.valido) return;
      Object.assign(dadosForm, resultado.dados);
    }

    try {
      const tarefa = _st.tarefaAtual;
      await _updateDoc('wf_tarefa_workflows', tarefa.id, {
        status: 'concluida',
        observacao: obs,
        dados_formulario: dadosForm,
        concluido_em: new Date(),
      });

      const instancia = await _getDoc('wf_instancia_processos', tarefa.instancia_id);
      if (instancia) {
        const merged = { ...(instancia.dados_consolidados || {}), ...dadosForm };
        await _updateDoc('wf_instancia_processos', tarefa.instancia_id, { dados_consolidados: merged });
        await _avancarFluxo(instancia, tarefa.etapa_modelo_id, obs);
      }

      await _registrarHistorico(tarefa.instancia_id, 'tarefa_concluida', _uid(),
        tarefa.etapa_modelo_id, tarefa.id, `Etapa "${tarefa.etapa_nome || tarefa.etapa_modelo_id}" concluída.`, { observacao: obs });

      wfNavWorkflow('tarefas');
    } catch (e) {
      alert('Erro ao concluir tarefa: ' + e.message);
    }
  }

  // Avança para a próxima etapa do snapshot sequencial
  async function _avancarFluxo(instancia, etapaOrigemId) {
    const etapas = instancia.snapshot_etapas || [];
    const idx = etapas.findIndex(e => e.id === etapaOrigemId);
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
  async function wfCarregarInstancias() {
    const el = document.getElementById('wf-lista-instancias');
    if (!el) return;
    el.innerHTML = '<div style="color:var(--ink3);font-size:14px">Carregando…</div>';
    try {
      const uid = _uid();
      if (!uid) { el.innerHTML = '<div style="color:var(--ink3);font-size:14px">Usuário não autenticado.</div>'; return; }
      const { where, orderBy } = globalScope.fb();
      const instancias = await _getAll('wf_instancia_processos',
        where('solicitante_uid', '==', uid),
        orderBy('_criado_em', 'desc'),
      );
      if (!instancias.length) {
        el.innerHTML = '<div style="color:var(--ink3);font-size:14px">Nenhum processo iniciado ainda.</div>';
        return;
      }
      const statusLabels = { em_andamento:'Em andamento', concluido:'Concluído', cancelado:'Cancelado' };
      const statusCores = { em_andamento:'#3b82f6', concluido:'#10b981', cancelado:'#ef4444' };
      el.innerHTML = instancias.map(i => {
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
          <div style="margin-top:10px">
            <button type="button" class="btn btn-sm" onclick="wfAbrirHistorico('${_esc(i.id)}','${_esc(i.titulo)}','${_esc(i.status)}')">Ver histórico</button>
            ${i.status === 'em_andamento' && globalScope.isEP?.() ? `<button type="button" class="btn btn-r btn-sm" style="margin-left:6px" onclick="wfConfirmarCancelar('${_esc(i.id)}')">Cancelar</button>` : ''}
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
            <button type="button" class="btn btn-p btn-sm" style="flex-shrink:0" onclick="wfIniciarDeProcesso('${_esc(p.id)}')">Iniciar</button>
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

    // Monta snapshot das etapas com os dados do mapeamento
    const snapshotEtapas = etapasExec.map((e, i) => ({
      id: `${processoId}_${e.id || i}`,
      nome: e.nome || `Etapa ${i + 1}`,
      tipo: e.tipo || 'Atividade',
      desc: e.desc || null,
      executor: e.executor || null,
      modo: e.modo || 'Manual',
      natureza: e.natureza || null,
      sla_horas: 0,  // sem SLA por padrão — pode ser configurado futuramente
    }));

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
      const { where, orderBy } = globalScope.fb();
      const eventos = await _getAll('wf_historico_workflows',
        where('instancia_id', '==', instanciaId),
        orderBy('_criado_em', 'asc'),
      );
      tl.innerHTML = eventos.length ? eventos.map(h => {
        const ts = h._criado_em?.toDate
          ? h._criado_em.toDate().toLocaleString('pt-BR')
          : (h._criado_em?.seconds ? new Date(h._criado_em.seconds * 1000).toLocaleString('pt-BR') : '—');
        return `<div style="position:relative;margin-bottom:16px;padding-left:16px">
          <div style="position:absolute;left:-5px;top:4px;width:10px;height:10px;border-radius:50%;background:var(--blue);border:2px solid #fff;box-shadow:0 0 0 2px var(--blue)"></div>
          <div style="font-size:11px;color:var(--ink3)">${_esc(ts)}</div>
          <div style="font-size:13px;color:var(--ink)">${_esc(h.descricao || h.tipo_evento)}</div>
        </div>`;
      }).join('') : '<div style="color:var(--ink3);font-size:14px">Nenhum evento registrado.</div>';
    } catch (e) {
      tl.innerHTML = `<div style="color:var(--red);font-size:14px">${_esc(e.message)}</div>`;
    }
    wfNavWorkflow('historico');
  }

  async function wfConfirmarCancelar(instanciaId) {
    const motivo = prompt('Motivo do cancelamento:');
    if (motivo === null) return;
    await _updateDoc('wf_instancia_processos', instanciaId, { status: 'cancelado', concluido_em: new Date() });
    await _registrarHistorico(instanciaId, 'instancia_cancelada', _uid(),
      null, null, `Processo cancelado. Motivo: ${motivo}`, { motivo });
    wfCarregarInstancias();
  }

  async function wfCancelarInstancia() {
    if (!_st.instanciaAtual) return;
    await wfConfirmarCancelar(_st.instanciaAtual.id);
    wfNavWorkflow('instancias');
  }

  // ── Exposição global ──────────────────────────────────────────────────────
  Object.assign(globalScope, {
    rWorkflow,
    wfNavWorkflow,
    wfCarregarTarefas,
    wfAbrirTarefa,
    wfConcluirTarefa,
    wfCarregarInstancias,
    wfCarregarProcessosMapeados,
    wfIniciarDeProcesso,
    wfAbrirHistorico,
    wfCancelarInstancia,
    wfConfirmarCancelar,
    _st,
  });

})(globalThis);
