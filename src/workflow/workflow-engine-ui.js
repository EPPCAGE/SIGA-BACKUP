(function initWorkflowUI(globalScope) {
  'use strict';

  // ── Estado interno do módulo ──────────────────────────────────────────────
  const _st = {
    painelAtual: 'tarefas',
    modeloAtual: null,
    instanciaAtual: null,
    tarefaAtual: null,
    etapasModelo: [],
    formsDisponiveis: [],
    arquiteturaDisponivel: [],
    camposFormulario: [],
  };

  // ── Helpers Firestore ─────────────────────────────────────────────────────
  function _db() { return globalScope.fb().db; }

  function _col(nome) {
    const { collection } = globalScope.fb();
    return collection(_db(), nome);
  }

  function _docRef(colNome, id) {
    const { doc } = globalScope.fb();
    return globalScope.fb().doc(_db(), colNome, id);
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
    return typeof globalScope.esc === 'function' ? globalScope.esc(v) : String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function _badge(texto, cor) {
    return `<span style="padding:2px 10px;border-radius:999px;font-size:11px;font-weight:600;background:${cor}22;color:${cor}">${_esc(texto)}</span>`;
  }

  function _slaInfo(tarefa) {
    if (!tarefa.prazo) return '';
    const prazo = tarefa.prazo?.toDate ? tarefa.prazo.toDate() : new Date(tarefa.prazo.seconds * 1000);
    const agora = new Date();
    const diff = prazo - agora;
    const alerta = 2 * 3600 * 1000;
    let cor, label;
    if (diff < 0) { cor = '#ef4444'; label = 'Vencido'; }
    else if (diff < alerta) { cor = '#f59e0b'; label = 'Vencendo'; }
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
  const _paineis = [
    'tarefas','instancias','iniciar','modelagem',
    'config-modelo','formularios','executar','historico',
  ];

  function wfNavWorkflow(painel) {
    _st.painelAtual = painel;
    _paineis.forEach(p => {
      const el = document.getElementById(`wf-painel-${p}`);
      if (el) el.style.display = 'none';
    });
    const alvo = document.getElementById(`wf-painel-${painel}`);
    if (alvo) alvo.style.display = '';

    // Destaca tab ativa
    ['tarefas','instancias','modelagem','formularios'].forEach(t => {
      const btn = document.getElementById(`wf-tab-${t}`);
      if (btn) btn.style.fontWeight = t === painel ? '700' : '';
    });

    const carregadores = {
      tarefas: wfCarregarTarefas,
      instancias: wfCarregarInstancias,
      iniciar: wfCarregarModelosIniciar,
      modelagem: wfCarregarModelos,
      formularios: wfCarregarFormularios,
    };
    carregadores[painel]?.();
  }

  // ── Função de entrada (chamada pela função go() do sistema) ───────────────
  function rWorkflow() {
    wfNavWorkflow(_st.painelAtual || 'tarefas');
  }

  // ── Tarefas ───────────────────────────────────────────────────────────────
  async function wfCarregarTarefas() {
    const el = document.getElementById('wf-lista-tarefas');
    if (!el) return;
    el.innerHTML = '<div style="color:var(--ink3);font-size:14px">Carregando…</div>';
    try {
      const uid = globalScope.usuarioLogado?.uid;
      const { where, orderBy } = globalScope.fb();
      const tarefas = await _getAll('wf_tarefa_workflows',
        where('responsavel_uid', '==', uid),
        where('status', 'in', ['pendente', 'em_execucao', 'vencida']),
      );
      if (!tarefas.length) {
        el.innerHTML = '<div style="color:var(--ink3);font-size:14px">Nenhuma tarefa pendente.</div>';
        return;
      }
      el.innerHTML = tarefas.map(t => _card(`
        <div style="font-weight:600;font-size:14px;margin-bottom:4px">${_esc(t.etapa_modelo_id)}</div>
        <div style="font-size:12px;color:var(--ink3);margin-bottom:6px">${_esc(t.instancia_id)}</div>
        ${_badge(WF_STATUS_TAREFA_LABELS[t.status] || t.status, WF_STATUS_TAREFA_COR[t.status] || '#6b7280')}
        ${_slaInfo(t)}
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

    // Marca em execução
    await _updateDoc('wf_tarefa_workflows', tarefaId, { status: 'em_execucao', iniciado_em: new Date() });

    document.getElementById('wf-exec-titulo').textContent = tarefa.etapa_modelo_id;
    document.getElementById('wf-exec-obs').value = '';
    document.getElementById('wf-exec-formulario').innerHTML = '';

    // Carrega formulário da etapa se existir
    const etapa = await _getDoc('wf_etapa_modelos', tarefa.etapa_modelo_id).catch(() => null);
    if (etapa?.instrucoes) {
      const div = document.getElementById('wf-exec-instrucoes');
      div.textContent = etapa.instrucoes;
      div.style.display = '';
    }

    if (etapa?.formulario_modelo_id) {
      const schema = await _getDoc('wf_formulario_modelos', etapa.formulario_modelo_id).catch(() => null);
      if (schema) {
        _st.tarefaAtual._campos = schema.campos;
        const formEl = globalScope.wfRenderizarFormulario(schema, tarefa.dados_formulario || {});
        document.getElementById('wf-exec-formulario').appendChild(formEl);
      }
    }

    // Carrega transições para montar os botões de ação
    const { where } = globalScope.fb();
    const instancia = await _getDoc('wf_instancia_processos', tarefa.instancia_id);
    const transicoes = instancia
      ? await _getAll('wf_transicao_fluxos',
          where('processo_modelo_id', '==', instancia.processo_modelo_id),
          where('etapa_origem_id', '==', tarefa.etapa_modelo_id))
      : [];

    const acoesEl = document.getElementById('wf-exec-acoes');
    if (transicoes.length) {
      acoesEl.innerHTML = transicoes.map(t =>
        `<button type="button" class="btn btn-p" onclick="wfConcluirTarefa('${_esc(t.label || t.condicao)}')">${_esc(t.label || t.condicao)}</button>`
      ).join('') + `<button type="button" class="btn" onclick="wfNavWorkflow('tarefas')">Cancelar</button>`;
    } else {
      acoesEl.innerHTML = `
        <button type="button" class="btn btn-p" onclick="wfConcluirTarefa('Concluído')">Concluir</button>
        <button type="button" class="btn" onclick="wfNavWorkflow('tarefas')">Cancelar</button>`;
    }

    wfNavWorkflow('executar');
  }

  async function wfConcluirTarefa(acao) {
    if (!_st.tarefaAtual) return;
    const obs = document.getElementById('wf-exec-obs').value.trim();
    const dadosFormulario = {};

    const formContainer = document.querySelector('#wf-exec-formulario .wf-form');
    if (formContainer && _st.tarefaAtual._campos) {
      const resultado = globalScope.wfColetarDadosFormulario(formContainer, _st.tarefaAtual._campos);
      if (!resultado.valido) return;
      Object.assign(dadosFormulario, resultado.dados);
    }

    try {
      const tarefa = _st.tarefaAtual;
      await _updateDoc('wf_tarefa_workflows', tarefa.id, {
        status: 'concluida',
        acao_tomada: acao,
        observacao: obs,
        dados_formulario: dadosFormulario,
        concluido_em: new Date(),
      });

      // Atualiza dados consolidados e avança etapa
      const instancia = await _getDoc('wf_instancia_processos', tarefa.instancia_id);
      if (instancia) {
        const merged = { ...(instancia.dados_consolidados || {}), ...dadosFormulario };
        await _updateDoc('wf_instancia_processos', tarefa.instancia_id, { dados_consolidados: merged });
        await _avancarFluxo(instancia, tarefa.etapa_modelo_id, acao);
      }

      await _registrarHistorico(tarefa.instancia_id, 'tarefa_concluida', globalScope.usuarioLogado?.uid,
        tarefa.etapa_modelo_id, tarefa.id,
        `Tarefa concluída com ação "${acao}".`,
        { acao_tomada: acao, observacao: obs });

      wfNavWorkflow('tarefas');
    } catch (e) {
      alert('Erro ao concluir tarefa: ' + e.message);
    }
  }

  async function _avancarFluxo(instancia, etapaOrigemId, acao) {
    const { where } = globalScope.fb();
    const transicoes = await _getAll('wf_transicao_fluxos',
      where('processo_modelo_id', '==', instancia.processo_modelo_id),
      where('etapa_origem_id', '==', etapaOrigemId),
    );
    const transicao = transicoes.find(t => t.condicao === 'sempre' || t.label === acao);
    if (!transicao) return;

    const proxEtapa = await _getDoc('wf_etapa_modelos', transicao.etapa_destino_id);
    if (!proxEtapa) return;

    await _updateDoc('wf_instancia_processos', instancia.id, { etapa_atual_id: proxEtapa.id });
    await _registrarHistorico(instancia.id, 'etapa_avancada', null, proxEtapa.id, null,
      `Etapa avançada para "${proxEtapa.nome}".`, {});

    if (proxEtapa.tipo === 'fim') {
      await _updateDoc('wf_instancia_processos', instancia.id, { status: 'concluido', concluido_em: new Date() });
      await _registrarHistorico(instancia.id, 'instancia_concluida', null, null, null, 'Processo concluído.', {});
    } else {
      await _criarTarefa({ ...instancia, etapa_atual_id: proxEtapa.id }, proxEtapa);
    }
  }

  async function _criarTarefa(instancia, etapa) {
    const responsavel = etapa.responsavel_tipo === 'solicitante'
      ? instancia.solicitante_uid
      : (etapa.responsavel_valor || instancia.solicitante_uid);

    const prazo = etapa.sla_horas > 0
      ? new Date(Date.now() + etapa.sla_horas * 3600000)
      : null;

    const tarefaId = await _addDoc('wf_tarefa_workflows', {
      instancia_id: instancia.id,
      etapa_modelo_id: etapa.id,
      responsavel_uid: responsavel,
      status: 'pendente',
      prazo,
      dados_formulario: {},
      acao_tomada: null,
      observacao: null,
    });

    await _registrarHistorico(instancia.id, 'tarefa_criada', null, etapa.id, tarefaId,
      `Tarefa "${etapa.nome}" criada.`, { responsavel_uid: responsavel });

    // Notificação interna
    await _addDoc('wf_notificacoes', {
      destinatario_uid: responsavel,
      tipo: 'tarefa_criada',
      titulo: `Nova tarefa: ${etapa.nome}`,
      mensagem: `Processo "${instancia.titulo}" — etapa "${etapa.nome}" aguarda sua ação.`,
      instancia_id: instancia.id,
      tarefa_id: tarefaId,
      lida: false,
    });
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
      const uid = globalScope.usuarioLogado?.uid;
      const { where, orderBy } = globalScope.fb();
      const instancias = await _getAll('wf_instancia_processos',
        where('solicitante_uid', '==', uid),
        orderBy('iniciado_em', 'desc'),
      );
      if (!instancias.length) { el.innerHTML = '<div style="color:var(--ink3);font-size:14px">Nenhum processo ativo.</div>'; return; }
      el.innerHTML = instancias.map(i => _card(`
        <div style="font-weight:600;font-size:14px;margin-bottom:4px">${_esc(i.titulo || i.id)}</div>
        <div style="font-size:12px;color:var(--ink3);margin-bottom:6px">Etapa: ${_esc(i.etapa_atual_id || '—')}</div>
        ${_badge(WF_STATUS_INSTANCIA_LABELS[i.status] || i.status, WF_STATUS_INSTANCIA_COR[i.status] || '#6b7280')}
        <div style="margin-top:10px">
          <button type="button" class="btn btn-sm" onclick="wfAbrirHistorico('${_esc(i.id)}','${_esc(i.titulo || i.id)}','${_esc(i.status)}')">Histórico</button>
        </div>
      `)).join('');
    } catch (e) {
      el.innerHTML = `<div style="color:var(--red);font-size:14px">${_esc(e.message)}</div>`;
    }
  }

  // ── Histórico ─────────────────────────────────────────────────────────────
  async function wfAbrirHistorico(instanciaId, titulo, status) {
    _st.instanciaAtual = { id: instanciaId, titulo, status };
    document.getElementById('wf-hist-titulo').textContent = titulo;
    const podeCancelar = ['em_andamento', 'suspenso'].includes(status) && globalScope.isEP?.();
    document.getElementById('wf-hist-btn-cancelar').style.display = podeCancelar ? '' : 'none';
    document.getElementById('wf-hist-resumo').innerHTML =
      `<div style="display:flex;gap:12px;align-items:center">
        <div><div style="font-size:11px;color:var(--ink3)">Status</div>${_badge(WF_STATUS_INSTANCIA_LABELS[status] || status, WF_STATUS_INSTANCIA_COR[status] || '#6b7280')}</div>
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
        const data = h._criado_em?.toDate
          ? h._criado_em.toDate().toLocaleString('pt-BR')
          : (h.ocorrido_em?.seconds ? new Date(h.ocorrido_em.seconds * 1000).toLocaleString('pt-BR') : '—');
        return `<div style="position:relative;margin-bottom:16px;padding-left:16px">
          <div style="position:absolute;left:-5px;top:4px;width:10px;height:10px;border-radius:50%;background:var(--blue);border:2px solid #fff;box-shadow:0 0 0 2px var(--blue)"></div>
          <div style="font-size:11px;color:var(--ink3)">${_esc(data)}</div>
          <div style="font-size:13px;color:var(--ink)">${_esc(h.descricao || WF_TIPO_EVENTO_LABELS[h.tipo_evento] || h.tipo_evento)}</div>
        </div>`;
      }).join('') : '<div style="color:var(--ink3);font-size:14px">Nenhum evento.</div>';
    } catch (e) {
      tl.innerHTML = `<div style="color:var(--red);font-size:14px">${_esc(e.message)}</div>`;
    }
    wfNavWorkflow('historico');
  }

  async function wfCancelarInstancia() {
    if (!_st.instanciaAtual) return;
    const motivo = prompt('Motivo do cancelamento:');
    if (motivo === null) return;
    await _updateDoc('wf_instancia_processos', _st.instanciaAtual.id, { status: 'cancelado', concluido_em: new Date() });
    await _registrarHistorico(_st.instanciaAtual.id, 'instancia_cancelada', globalScope.usuarioLogado?.uid,
      null, null, `Processo cancelado. Motivo: ${motivo}`, { motivo });
    wfNavWorkflow('instancias');
  }

  // ── Iniciar Processo ──────────────────────────────────────────────────────
  async function wfCarregarModelosIniciar() {
    const sel = document.getElementById('wf-np-modelo');
    if (!sel) return;
    try {
      const { where } = globalScope.fb();
      const modelos = await _getAll('wf_processo_modelos', where('status', '==', 'publicado'));
      sel.innerHTML = '<option value="">Selecione o processo a iniciar…</option>';
      modelos.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.nome;
        opt.dataset.desc = m.descricao || '';
        sel.appendChild(opt);
      });
      _st._modelosCache = modelos;
    } catch (e) { console.error('[WF] Erro ao carregar modelos:', e); }
  }

  function wfExibirDetalhesModelo() {
    const sel = document.getElementById('wf-np-modelo');
    const div = document.getElementById('wf-np-detalhes');
    const opt = sel.options[sel.selectedIndex];
    if (!opt.value) { div.style.display = 'none'; return; }
    div.textContent = opt.dataset.desc || 'Sem descrição.';
    div.style.display = '';
  }

  async function wfIniciarProcesso() {
    const modeloId = document.getElementById('wf-np-modelo').value;
    const titulo = document.getElementById('wf-np-titulo').value.trim();
    if (!modeloId) { alert('Selecione um processo.'); return; }
    try {
      const modelo = await _getDoc('wf_processo_modelos', modeloId);
      if (!modelo) throw new Error('Modelo não encontrado.');
      if (!modelo.etapa_inicial) throw new Error('O modelo não possui etapa inicial definida. Configure as etapas antes de iniciar.');

      // Carrega snapshot do processo na arquitetura (se vinculado)
      let snapshotProcesso = null;
      if (modelo.arquitetura_id) {
        const arq = await _getDoc('arquitetura', modelo.arquitetura_id).catch(() => null);
        if (arq) snapshotProcesso = { id: arq.id, nome: arq.nome || arq.titulo || '', codigo: arq.codigo || null };
      }

      const uid = globalScope.usuarioLogado?.uid;
      const instanciaId = await _addDoc('wf_instancia_processos', {
        processo_modelo_id: modeloId,
        processo_modelo_versao: modelo.versao || 1,
        titulo: titulo || `${modelo.nome} — ${new Date().toLocaleDateString('pt-BR')}`,
        status: 'em_andamento',
        etapa_atual_id: modelo.etapa_inicial,
        solicitante_uid: uid,
        dados_consolidados: {},
        concluido_em: null,
        ...(snapshotProcesso ? { snapshot_processo: snapshotProcesso } : {}),
      });

      await _registrarHistorico(instanciaId, 'instancia_criada', uid, null, null,
        `Processo "${modelo.nome}" iniciado.`, { processo_modelo_id: modeloId });

      const etapaInicial = await _getDoc('wf_etapa_modelos', modelo.etapa_inicial);
      if (etapaInicial) {
        await _criarTarefa({ id: instanciaId, titulo: titulo || modelo.nome, processo_modelo_id: modeloId, solicitante_uid: uid }, etapaInicial);
      }

      alert('Processo iniciado com sucesso!');
      wfNavWorkflow('tarefas');
    } catch (e) {
      alert('Erro ao iniciar: ' + e.message);
    }
  }

  // ── Modelagem ─────────────────────────────────────────────────────────────
  async function wfCarregarModelos() {
    const el = document.getElementById('wf-lista-modelos');
    if (!el) return;
    el.innerHTML = '<div style="color:var(--ink3);font-size:14px">Carregando…</div>';
    try {
      const modelos = await _getAll('wf_processo_modelos');
      if (!modelos.length) { el.innerHTML = '<div style="color:var(--ink3);font-size:14px">Nenhum modelo.</div>'; return; }
      el.innerHTML = modelos.map(m => _card(`
        <div style="font-weight:600;font-size:14px;margin-bottom:4px">${_esc(m.nome)}</div>
        <div style="font-size:12px;color:var(--ink3);margin-bottom:8px">${_esc(m.descricao || 'Sem descrição')}</div>
        ${_badge(WF_STATUS_PROCESSO_MODELO_LABELS[m.status] || m.status, WF_STATUS_PROCESSO_MODELO_COR[m.status] || '#6b7280')}
        <span style="font-size:11px;color:var(--ink3);margin-left:6px">v${m.versao || 1}</span>
        <div style="margin-top:10px">
          <button type="button" class="btn btn-p btn-sm" onclick="wfAbrirConfigModelo('${_esc(m.id)}')">Configurar</button>
        </div>
      `)).join('');
    } catch (e) {
      el.innerHTML = `<div style="color:var(--red);font-size:14px">${_esc(e.message)}</div>`;
    }
  }

  function wfAbrirModalNovoModelo() {
    const nome = prompt('Nome do processo:');
    if (!nome) return;
    const descricao = prompt('Descrição (opcional):') || '';
    _addDoc('wf_processo_modelos', {
      nome: nome.trim(), descricao: descricao.trim(),
      versao: 1, status: 'rascunho', etapa_inicial: null,
      criado_por: globalScope.usuarioLogado?.uid,
      perfis_permitidos: ['ep', 'gestor', 'dono'],
    }).then(id => {
      alert(`Modelo criado! Agora configure as etapas.`);
      wfAbrirConfigModelo(id);
    }).catch(e => alert('Erro: ' + e.message));
  }

  async function wfAbrirConfigModelo(modeloId) {
    const modelo = await _getDoc('wf_processo_modelos', modeloId);
    if (!modelo) { alert('Modelo não encontrado.'); return; }
    _st.modeloAtual = modelo;

    document.getElementById('wf-config-titulo').textContent = modelo.nome;
    const badge = document.getElementById('wf-config-status-badge');
    badge.textContent = WF_STATUS_PROCESSO_MODELO_LABELS[modelo.status] || modelo.status;
    badge.style.background = (WF_STATUS_PROCESSO_MODELO_COR[modelo.status] || '#6b7280') + '22';
    badge.style.color = WF_STATUS_PROCESSO_MODELO_COR[modelo.status] || '#6b7280';

    const btnPub = document.getElementById('wf-btn-publicar');
    btnPub.style.display = modelo.status === 'rascunho' ? '' : 'none';

    if (modelo.arquitetura_id) {
      const arq = await _getDoc('arquitetura', modelo.arquitetura_id).catch(() => null);
      document.getElementById('wf-config-arq-info').innerHTML =
        arq ? `<strong>${_esc(arq.codigo ? arq.codigo + ' — ' : '')}${_esc(arq.nome || arq.titulo || modelo.arquitetura_id)}</strong>` : _esc(modelo.arquitetura_id);
    } else {
      document.getElementById('wf-config-arq-info').textContent = 'Nenhum processo vinculado.';
    }

    await _renderizarEtapas(modeloId);
    await _renderizarTransicoes(modeloId);
    wfNavWorkflow('config-modelo');
  }

  async function _renderizarEtapas(modeloId) {
    const el = document.getElementById('wf-config-etapas');
    const { where, orderBy } = globalScope.fb();
    const etapas = await _getAll('wf_etapa_modelos',
      where('processo_modelo_id', '==', modeloId),
      orderBy('ordem'),
    );
    _st.etapasModelo = etapas;
    if (!etapas.length) { el.innerHTML = '<div style="color:var(--ink3);font-size:13px">Nenhuma etapa. Adicione a primeira etapa.</div>'; return; }
    el.innerHTML = etapas.map((e, i) => `
      <div style="display:flex;align-items:center;gap:10px;background:var(--surf2);border:1px solid var(--bdr);border-radius:8px;padding:10px 14px;margin-bottom:6px">
        <div style="width:26px;height:26px;background:var(--blue);color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0">${i + 1}</div>
        <div style="flex:1">
          <div style="font-weight:600;font-size:13px">${_esc(WF_TIPO_ETAPA_ICONE[e.tipo] || '')} ${_esc(e.nome)}</div>
          <div style="font-size:11px;color:var(--ink3)">${_esc(WF_TIPO_ETAPA_LABELS[e.tipo] || e.tipo)} · ${_esc(WF_RESPONSAVEL_TIPO_LABELS[e.responsavel_tipo] || e.responsavel_tipo)} · SLA: ${e.sla_horas ? e.sla_horas + 'h' : 'sem prazo'}</div>
        </div>
        ${i === 0 ? `<button type="button" class="btn btn-sm" onclick="_wfDefinirEtapaInicial('${_esc(e.id)}')">Definir como início</button>` : ''}
      </div>
    `).join('');
  }

  async function _renderizarTransicoes(modeloId) {
    const el = document.getElementById('wf-config-transicoes');
    const { where } = globalScope.fb();
    const trans = await _getAll('wf_transicao_fluxos', where('processo_modelo_id', '==', modeloId));
    if (!trans.length) { el.textContent = 'Nenhuma transição configurada.'; return; }
    el.innerHTML = trans.map(t => `
      <div style="background:var(--surf2);border:1px solid var(--bdr);border-radius:6px;padding:8px 12px;margin-bottom:6px;font-size:13px">
        <strong>${_esc(t.etapa_origem_id)}</strong> → <strong>${_esc(t.etapa_destino_id)}</strong>
        <span style="color:var(--ink3)"> (${_esc(t.label || t.condicao)})</span>
      </div>
    `).join('');
  }

  async function _wfDefinirEtapaInicial(etapaId) {
    if (!_st.modeloAtual) return;
    await _updateDoc('wf_processo_modelos', _st.modeloAtual.id, { etapa_inicial: etapaId });
    _st.modeloAtual.etapa_inicial = etapaId;
    alert('Etapa inicial definida!');
  }

  async function wfPublicarModelo() {
    if (!_st.modeloAtual) return;
    if (!_st.modeloAtual.etapa_inicial) { alert('Defina a etapa inicial antes de publicar.'); return; }
    if (!confirm('Publicar este modelo? Ficará disponível para iniciar processos.')) return;
    const novaVersao = (_st.modeloAtual.versao || 1) + 1;
    await _updateDoc('wf_processo_modelos', _st.modeloAtual.id, { status: 'publicado', versao: novaVersao });
    alert('Modelo publicado!');
    wfAbrirConfigModelo(_st.modeloAtual.id);
  }

  // ── Modal: Etapa ──────────────────────────────────────────────────────────
  async function wfAbrirModalEtapa() {
    if (!_st.modeloAtual) return;
    // Carrega formulários disponíveis
    const forms = await _getAll('wf_formulario_modelos').catch(() => []);
    _st.formsDisponiveis = forms;

    const formsOpts = forms.map(f => `<option value="${_esc(f.id)}">${_esc(f.titulo)}</option>`).join('');

    const html = `
      <div class="modal-overlay" onclick="if(event.target===this)this.remove()">
        <div class="modal" style="max-width:480px">
          <div class="modal-hd"><span>Nova Etapa</span><button class="modal-x" onclick="this.closest('.modal-overlay').remove()">×</button></div>
          <div class="modal-bd" style="display:flex;flex-direction:column;gap:12px">
            <div><label class="lbl">Nome *</label><input id="_wf-me-nome" class="fi" style="width:100%;margin-top:4px" placeholder="Ex: Análise do Gestor"></div>
            <div><label class="lbl">Tipo</label>
              <select id="_wf-me-tipo" class="fi" style="width:100%;margin-top:4px">
                <option value="tarefa">Tarefa</option>
                <option value="aprovacao">Aprovação</option>
                <option value="inicio">Início</option>
                <option value="fim">Fim</option>
              </select>
            </div>
            <div><label class="lbl">Responsável</label>
              <select id="_wf-me-resp-tipo" class="fi" style="width:100%;margin-top:4px" onchange="document.getElementById('_wf-me-resp-val-grp').style.display=this.value!=='solicitante'?'':'none'">
                <option value="solicitante">Próprio solicitante</option>
                <option value="perfil">Perfil do sistema</option>
                <option value="usuario_especifico">Usuário específico</option>
              </select>
            </div>
            <div id="_wf-me-resp-val-grp" style="display:none">
              <label class="lbl">Valor (perfil ou UID)</label>
              <input id="_wf-me-resp-val" class="fi" style="width:100%;margin-top:4px" placeholder="ep, gestor, dono…">
            </div>
            <div><label class="lbl">SLA (horas úteis, 0 = sem prazo)</label><input id="_wf-me-sla" type="number" min="0" value="0" class="fi" style="width:100%;margin-top:4px"></div>
            <div><label class="lbl">Formulário dinâmico</label>
              <select id="_wf-me-form" class="fi" style="width:100%;margin-top:4px">
                <option value="">Nenhum</option>${formsOpts}
              </select>
            </div>
            <div><label class="lbl">Instruções para o responsável</label><textarea id="_wf-me-instrucoes" class="fi" rows="2" style="width:100%;margin-top:4px"></textarea></div>
          </div>
          <div class="modal-ft">
            <button type="button" class="btn" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
            <button type="button" class="btn btn-p" onclick="wfSalvarEtapa()">Salvar</button>
          </div>
        </div>
      </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
  }

  async function wfSalvarEtapa() {
    if (!_st.modeloAtual) return;
    const nome = document.getElementById('_wf-me-nome')?.value.trim();
    if (!nome) { alert('Informe o nome da etapa.'); return; }
    const payload = {
      processo_modelo_id: _st.modeloAtual.id,
      nome,
      tipo: document.getElementById('_wf-me-tipo').value,
      responsavel_tipo: document.getElementById('_wf-me-resp-tipo').value,
      responsavel_valor: document.getElementById('_wf-me-resp-val')?.value.trim() || null,
      sla_horas: parseInt(document.getElementById('_wf-me-sla').value) || 0,
      formulario_modelo_id: document.getElementById('_wf-me-form').value || null,
      instrucoes: document.getElementById('_wf-me-instrucoes').value.trim(),
      ordem: _st.etapasModelo.length + 1,
    };
    await _addDoc('wf_etapa_modelos', payload);
    document.querySelector('.modal-overlay')?.remove();
    await _renderizarEtapas(_st.modeloAtual.id);
  }

  // ── Modal: Transição ──────────────────────────────────────────────────────
  function wfAbrirModalTransicao() {
    if (!_st.modeloAtual || !_st.etapasModelo.length) {
      alert('Adicione etapas antes de configurar transições.'); return;
    }
    const opts = _st.etapasModelo.map(e =>
      `<option value="${_esc(e.id)}">${_esc(e.nome)} (${_esc(e.tipo)})</option>`).join('');
    const html = `
      <div class="modal-overlay" onclick="if(event.target===this)this.remove()">
        <div class="modal" style="max-width:400px">
          <div class="modal-hd"><span>Nova Transição</span><button class="modal-x" onclick="this.closest('.modal-overlay').remove()">×</button></div>
          <div class="modal-bd" style="display:flex;flex-direction:column;gap:12px">
            <div><label class="lbl">Etapa de origem</label><select id="_wf-mt-orig" class="fi" style="width:100%;margin-top:4px">${opts}</select></div>
            <div><label class="lbl">Etapa de destino</label><select id="_wf-mt-dest" class="fi" style="width:100%;margin-top:4px">${opts}</select></div>
            <div><label class="lbl">Condição</label>
              <select id="_wf-mt-cond" class="fi" style="width:100%;margin-top:4px">
                <option value="sempre">Sempre (avança automático)</option>
                <option value="aprovado">Aprovado</option>
                <option value="rejeitado">Rejeitado</option>
              </select>
            </div>
            <div><label class="lbl">Label do botão</label><input id="_wf-mt-label" class="fi" style="width:100%;margin-top:4px" value="Avançar"></div>
          </div>
          <div class="modal-ft">
            <button type="button" class="btn" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
            <button type="button" class="btn btn-p" onclick="wfSalvarTransicao()">Salvar</button>
          </div>
        </div>
      </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
  }

  async function wfSalvarTransicao() {
    if (!_st.modeloAtual) return;
    const payload = {
      processo_modelo_id: _st.modeloAtual.id,
      etapa_origem_id: document.getElementById('_wf-mt-orig').value,
      etapa_destino_id: document.getElementById('_wf-mt-dest').value,
      condicao: document.getElementById('_wf-mt-cond').value,
      label: document.getElementById('_wf-mt-label').value.trim() || 'Avançar',
    };
    await _addDoc('wf_transicao_fluxos', payload);
    document.querySelector('.modal-overlay')?.remove();
    await _renderizarTransicoes(_st.modeloAtual.id);
  }

  // ── Modal: Vincular Arquitetura ───────────────────────────────────────────
  async function wfAbrirModalVincularArquitetura() {
    if (!_st.arquiteturaDisponivel.length) {
      const { orderBy } = globalScope.fb();
      _st.arquiteturaDisponivel = await _getAll('arquitetura', orderBy('nome')).catch(() => []);
    }
    const opts = _st.arquiteturaDisponivel.map(p =>
      `<option value="${_esc(p.id)}" data-nome="${_esc(p.nome || p.titulo || '')}" data-nivel="${_esc(p.nivel || '')}">${_esc(p.codigo ? p.codigo + ' — ' : '')}${_esc(p.nome || p.titulo || p.id)}</option>`
    ).join('');

    const html = `
      <div class="modal-overlay" onclick="if(event.target===this)this.remove()">
        <div class="modal" style="max-width:480px">
          <div class="modal-hd"><span>Vincular Processo Mapeado</span><button class="modal-x" onclick="this.closest('.modal-overlay').remove()">×</button></div>
          <div class="modal-bd">
            <p style="font-size:13px;color:var(--ink3);margin-bottom:12px">Selecione um processo já modelado na arquitetura institucional.</p>
            <select id="_wf-arq-sel" class="fi" style="width:100%"
              onchange="const o=this.options[this.selectedIndex];document.getElementById('_wf-arq-prev').textContent=o.value?(o.dataset.nome+' (nível: '+o.dataset.nivel+')'):'';document.getElementById('_wf-arq-prev').style.display=o.value?'':'none'">
              <option value="">Selecione…</option>${opts}
            </select>
            <div id="_wf-arq-prev" style="display:none;background:var(--surf2);border:1px solid var(--bdr);border-radius:6px;padding:10px;font-size:13px;margin-top:8px"></div>
          </div>
          <div class="modal-ft">
            <button type="button" class="btn" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
            <button type="button" class="btn btn-p" onclick="wfVincularArquitetura()">Vincular</button>
          </div>
        </div>
      </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
  }

  async function wfVincularArquitetura() {
    const sel = document.getElementById('_wf-arq-sel');
    if (!sel.value || !_st.modeloAtual) return;
    await _updateDoc('wf_processo_modelos', _st.modeloAtual.id, { arquitetura_id: sel.value });
    _st.modeloAtual.arquitetura_id = sel.value;
    const opt = sel.options[sel.selectedIndex];
    document.getElementById('wf-config-arq-info').innerHTML = `<strong>${_esc(opt.textContent)}</strong>`;
    document.querySelector('.modal-overlay')?.remove();
  }

  // ── Formulários ───────────────────────────────────────────────────────────
  async function wfCarregarFormularios() {
    const el = document.getElementById('wf-lista-formularios');
    if (!el) return;
    el.innerHTML = '<div style="color:var(--ink3);font-size:14px">Carregando…</div>';
    try {
      const forms = await _getAll('wf_formulario_modelos');
      _st.formsDisponiveis = forms;
      if (!forms.length) { el.innerHTML = '<div style="color:var(--ink3);font-size:14px">Nenhum formulário.</div>'; return; }
      el.innerHTML = forms.map(f => _card(`
        <div style="font-weight:600;font-size:14px;margin-bottom:4px">${_esc(f.titulo)}</div>
        <div style="font-size:12px;color:var(--ink3)">${(f.campos || []).length} campo(s) · v${f.versao || 1}</div>
      `)).join('');
    } catch (e) {
      el.innerHTML = `<div style="color:var(--red);font-size:14px">${_esc(e.message)}</div>`;
    }
  }

  async function wfAbrirModalNovoFormulario() {
    _st.camposFormulario = [];
    const html = `
      <div class="modal-overlay" onclick="if(event.target===this)this.remove()" id="_wf-form-modal">
        <div class="modal" style="max-width:640px">
          <div class="modal-hd"><span>Novo Formulário</span><button class="modal-x" onclick="this.closest('.modal-overlay').remove()">×</button></div>
          <div class="modal-bd">
            <div style="margin-bottom:12px"><label class="lbl">Título *</label><input id="_wf-mf-titulo" class="fi" style="width:100%;margin-top:4px"></div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
              <strong style="font-size:13px">Campos</strong>
              <button type="button" class="btn btn-sm btn-p" onclick="_wfAdicionarCampo()">+ Campo</button>
            </div>
            <div id="_wf-mf-campos"></div>
          </div>
          <div class="modal-ft">
            <button type="button" class="btn" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
            <button type="button" class="btn btn-p" onclick="wfSalvarFormulario()">Salvar</button>
          </div>
        </div>
      </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
  }

  function _wfAdicionarCampo() {
    _st.camposFormulario.push({ id: `campo_${Date.now()}`, tipo: 'texto', label: '', obrigatorio: false });
    _wfRenderizarCamposEditor();
  }

  function _wfRenderizarCamposEditor() {
    const el = document.getElementById('_wf-mf-campos');
    if (!el) return;
    el.innerHTML = _st.camposFormulario.map((c, i) => `
      <div style="border:1px solid var(--bdr);border-radius:8px;padding:10px;margin-bottom:8px;background:var(--surf2)">
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
          <div style="flex:1;min-width:110px"><label class="lbl" style="font-size:11px">ID (snake_case)</label>
            <input class="fi" style="width:100%;margin-top:3px" value="${_esc(c.id)}"
              oninput="_st.camposFormulario[${i}].id=this.value"></div>
          <div style="flex:2;min-width:140px"><label class="lbl" style="font-size:11px">Label</label>
            <input class="fi" style="width:100%;margin-top:3px" value="${_esc(c.label)}"
              oninput="_st.camposFormulario[${i}].label=this.value"></div>
          <div style="flex:1;min-width:100px"><label class="lbl" style="font-size:11px">Tipo</label>
            <select class="fi" style="width:100%;margin-top:3px"
              onchange="_st.camposFormulario[${i}].tipo=this.value;_wfRenderizarCamposEditor()">
              ${Object.entries(WF_TIPO_CAMPO_LABELS).map(([v, l]) =>
                `<option value="${_esc(v)}"${c.tipo===v?' selected':''}>${_esc(l)}</option>`).join('')}
            </select>
          </div>
          <label style="display:flex;align-items:center;gap:4px;font-size:12px;padding-bottom:4px">
            <input type="checkbox" ${c.obrigatorio?'checked':''}
              onchange="_st.camposFormulario[${i}].obrigatorio=this.checked"> Obrig.
          </label>
          <button class="btn btn-r btn-sm" style="padding-bottom:4px"
            onclick="_st.camposFormulario.splice(${i},1);_wfRenderizarCamposEditor()">✕</button>
        </div>
        ${c.tipo==='select'?`<div style="margin-top:8px"><label class="lbl" style="font-size:11px">Opções (uma por linha)</label>
          <textarea class="fi" rows="3" style="width:100%;margin-top:3px"
            oninput="_st.camposFormulario[${i}].opcoes=this.value.split('\\n').filter(Boolean)"
          >${(c.opcoes||[]).join('\n')}</textarea></div>`:''}
      </div>`).join('');
  }

  async function wfSalvarFormulario() {
    const titulo = document.getElementById('_wf-mf-titulo')?.value.trim();
    if (!titulo) { alert('Informe o título.'); return; }
    if (!_st.camposFormulario.length) { alert('Adicione ao menos um campo.'); return; }
    await _addDoc('wf_formulario_modelos', {
      titulo,
      campos: _st.camposFormulario,
      versao: 1,
      criado_por: globalScope.usuarioLogado?.uid,
    });
    document.querySelector('#_wf-form-modal')?.remove();
    await wfCarregarFormularios();
  }

  // ── Exposição global ──────────────────────────────────────────────────────
  Object.assign(globalScope, {
    rWorkflow,
    wfNavWorkflow,
    wfCarregarTarefas,
    wfAbrirTarefa,
    wfConcluirTarefa,
    wfCarregarInstancias,
    wfAbrirHistorico,
    wfCancelarInstancia,
    wfCarregarModelosIniciar,
    wfExibirDetalhesModelo,
    wfIniciarProcesso,
    wfCarregarModelos,
    wfAbrirModalNovoModelo,
    wfAbrirConfigModelo,
    wfPublicarModelo,
    wfAbrirModalEtapa,
    wfSalvarEtapa,
    wfAbrirModalTransicao,
    wfSalvarTransicao,
    wfAbrirModalVincularArquitetura,
    wfVincularArquitetura,
    wfCarregarFormularios,
    wfAbrirModalNovoFormulario,
    wfSalvarFormulario,
    _wfDefinirEtapaInicial,
    _wfAdicionarCampo,
    _wfRenderizarCamposEditor,
    _st: _st,
  });

})(globalThis);
