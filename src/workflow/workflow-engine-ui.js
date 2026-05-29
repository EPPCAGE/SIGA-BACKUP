(function initWorkflowUI(globalScope) {
  'use strict';

  // ── Estado interno do módulo ──────────────────────────────────────────────
  const _st = {
    painelAtual: 'tarefas',
    instanciaAtual: null,
    tarefaAtual: null,
    formularioAtual: null,       // schema sendo editado no modal de formulário
    formularioCampos: [],        // campos do formulário sendo editado
    configProcessoId: null,      // processo sendo configurado
    configProcessoEtapas: [],    // etapas do processo sendo configurado
    formularioModelos: [],       // cache dos modelos carregados
    // Designer visual
    designerModelo: null,        // wf_processo_modelos sendo editado { id, nome, ..., canvas:{nos,arestas} }
    designerNoSel: null,         // id do nó selecionado
    designerArestaSel: null,     // id da aresta selecionada
    designerDrag: null,          // estado do arraste em curso
    iniciarAba: 'mapeamento',    // aba ativa da tela iniciar
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
  const _paineis = ['tarefas','instancias','iniciar','executar','historico','formularios','config-processo','designer'];

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
      const minhas = await _getAll('wf_tarefa_workflows',
        where('responsavel_uid', '==', uid),
        where('status', 'in', ['pendente','em_execucao']),
      );
      // Tarefas em aberto por perfil (responsavel_uid null) que o usuário pode assumir
      const perfil = globalScope.usuarioLogado?.perfil;
      let porPerfil = [];
      if (perfil) {
        try {
          const abertas = await _getAll('wf_tarefa_workflows',
            where('papel_alvo', '==', perfil),
            where('status', 'in', ['pendente','em_execucao']),
          );
          porPerfil = abertas.filter(t => !t.responsavel_uid);
        } catch (_e) { /* índice opcional */ }
      }
      const mapa = {};
      [...minhas, ...porPerfil].forEach(t => { mapa[t.id] = t; });
      const tarefas = Object.values(mapa);
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
        if (schema && typeof globalScope.wfRenderizarFormulario === 'function') {
          const valoresIniciais = tarefa.dados_formulario || {};
          const formEl = globalScope.wfRenderizarFormulario(schema, valoresIniciais);
          formContainer.appendChild(formEl);
          _st.tarefaAtual._campos = schema.campos || [];
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

    wfNavWorkflow('executar');
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
        concluido_em: new Date(),
      });

      const instancia = await _getDoc('wf_instancia_processos', tarefa.instancia_id);
      if (instancia) {
        const merged = { ...(instancia.dados_consolidados || {}), ...dadosForm };
        await _updateDoc('wf_instancia_processos', tarefa.instancia_id, { dados_consolidados: merged });
        if (instancia.canvas) {
          await _avancarFluxoCanvas(instancia, tarefa.etapa_modelo_id, acao);
        } else {
          await _avancarFluxo(instancia, tarefa.etapa_modelo_id);
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
  function _resolverPapel(valorPapel, instancia) {
    if (!valorPapel) return null;
    if (valorPapel === 'solicitante') return instancia.solicitante_uid || null;
    if (valorPapel === 'ep' || valorPapel === 'gestor' || valorPapel === 'dono') {
      const perfil = globalScope.usuarioLogado?.perfil;
      // Quando configurado por perfil, atribui ao usuário logado se o perfil coincidir;
      // caso contrário, mantém em aberto (qualquer usuário do perfil poderá assumir).
      return perfil === valorPapel ? _uid() : null;
    }
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
    for (const papel of ['executor','revisor','aprovador']) {
      const valor = papeis[papel];
      if (!valor) continue;
      const uidResp = _resolverPapel(valor, instancia);
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
      if (uidResp) {
        await _addDoc('wf_notificacoes', {
          destinatario_uid: uidResp,
          tipo: 'tarefa_criada',
          titulo: `Nova etapa: ${no.nome}`,
          mensagem: `Processo "${instancia.titulo}" — etapa "${no.nome}" aguarda sua ação.`,
          instancia_id: instancia.id,
          tarefa_id: tarefaId,
          lida: false,
        });
      }
      criados.push(tarefaId);
    }
    // cientes
    const cientes = papeis.ciente || [];
    for (const c of cientes) {
      const uidC = _resolverPapel(c, instancia);
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
      const uidResp = _resolverPapel('solicitante', instancia);
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
          titulo: `Nova etapa: ${no.nome}`,
          mensagem: `Processo "${instancia.titulo}" — etapa "${no.nome}" aguarda sua ação.`,
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
    const prox = _proximoNo(canvas, noOrigemId, acao);
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
    wfIniciarAba(_st.iniciarAba || 'mapeamento');
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
      .map(e => ({
        id: e.id,
        origem: e.source?.id,
        destino: e.target?.id,
        acao: e.businessObject?.name || 'avancar',
        label: e.businessObject?.name || 'Avançar',
      }));
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

  // Importa um mapeamento → gera BPMN XML → cria wf_processo_modelos rascunho → abre designer
  async function wfImportarMapeamento(processoId) {
    const proc = await _getDoc('processos', processoId);
    if (!proc) { alert('Processo não encontrado.'); return; }
    const usaToBe = (proc.mod?.etapas_proc_tobe || []).length > 0;
    const todasEtapas = usaToBe ? proc.mod.etapas_proc_tobe : (proc.mod?.etapas_proc || []);
    const etapasExec = todasEtapas.filter(e => !e.tipo || e.tipo === 'Atividade' || e.tipo === 'Aprovação');
    if (!etapasExec.length) { alert('Este processo não possui etapas executáveis.'); return; }

    // Gera BPMN XML com layout horizontal
    const BW = 120, BH = 60, GAP = 50, Y = 100, startX = 60;
    const ids = etapasExec.map((_, i) => `task_${i + 1}`);
    let processXml = '<startEvent id="start" name="Início"/>\n';
    etapasExec.forEach((e, i) => {
      const tipo = e.tipo === 'Aprovação' ? 'exclusiveGateway' : 'userTask';
      processXml += `    <${tipo} id="${ids[i]}" name="${(e.nome || `Etapa ${i+1}`).replace(/"/g, '&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}"/>\n`;
    });
    processXml += '    <endEvent id="end" name="Fim"/>\n';
    // sequence flows
    processXml += `    <sequenceFlow id="f0" sourceRef="start" targetRef="${ids[0]}"/>\n`;
    ids.forEach((id, i) => {
      const next = ids[i + 1] || 'end';
      processXml += `    <sequenceFlow id="f${i+1}" sourceRef="${id}" targetRef="${next}"/>\n`;
    });

    // DI (posições)
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
      const srcId = id, tgtId = allIds[i + 1];
      const srcIsEvent = srcId === 'start' || srcId === 'end';
      const tgtIsEvent = tgtId === 'start' || tgtId === 'end';
      const sw = srcIsEvent ? startW : BW, sx = startX + i * (BW + GAP) + (srcIsEvent ? (BW - startW) / 2 : 0);
      const tx = startX + (i+1) * (BW + GAP) + (tgtIsEvent ? (BW - startW) / 2 : 0);
      diEdges += `      <bpmndi:BPMNEdge bpmnElement="f${i}"><omgdi:waypoint x="${sx + sw}" y="${Y + BH/2}"/><omgdi:waypoint x="${tx}" y="${Y + BH/2}"/></bpmndi:BPMNEdge>\n`;
    });

    const bpmnXml = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:omgdc="http://www.omg.org/spec/DD/20100524/DC" xmlns:omgdi="http://www.omg.org/spec/DD/20100524/DI" targetNamespace="http://ep.cage">
  <process id="proc1" isExecutable="false">
    ${processXml}  </process>
  <bpmndi:BPMNDiagram id="d1"><bpmndi:BPMNPlane bpmnElement="proc1">
${diShapes}${diEdges}  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</definitions>`;

    // config_nos com defaults
    const configNos = {};
    etapasExec.forEach((e, i) => {
      const cfg = _configPadrao();
      cfg.instrucoes = e.desc || '';
      cfg.acoes = e.tipo === 'Aprovação' ? ['aprovar','rejeitar'] : ['avancar'];
      configNos[ids[i]] = cfg;
    });

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
      el.type === 'bpmn:ExclusiveGateway' || el.type === 'bpmn:InclusiveGateway'
    );

    if (!configuravel) { painel.style.display = 'none'; return; }
    painel.style.display = '';

    const id = el.id;
    const cfg = _wfConfigNos[id] || _configPadrao();
    _wfConfigNos[id] = cfg;
    const papeis = cfg.papeis || {};
    const acoes = cfg.acoes || [];

    const alvoOpts = (sel) => {
      const opts = { '': '— Ninguém —', solicitante: 'Próprio solicitante', ep: 'Perfil EP', gestor: 'Perfil Gestor', dono: 'Perfil Dono' };
      return Object.entries(opts).map(([v, l]) =>
        `<option value="${v}"${(sel || '') === v ? ' selected' : ''}>${_esc(l)}</option>`).join('');
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
        <input type="checkbox" ${cfg.exige_parecer ? 'checked' : ''} onchange="wfDesignerCampoCfg('${_esc(id)}','exige_parecer',this.checked)"> Exige parecer obrigatório</label>`;
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

  // — Iniciar uma instância a partir de um modelo do designer —
  async function wfIniciarDeModelo(modeloId) {
    const uid = _uid();
    if (!uid) { alert('Usuário não autenticado.'); return; }
    const modelo = await _getDoc('wf_processo_modelos', modeloId);
    if (!modelo) { alert('Modelo não encontrado.'); return; }
    const nos = modelo.canvas?.nos || [];
    const arestas = modelo.canvas?.arestas || [];
    const inicio = nos.find(n => n.tipo === 'inicio');
    if (!inicio) { alert('Modelo sem nó de início.'); return; }
    // primeiro nó executável após o início
    const primeira = _proximoNo(modelo.canvas, inicio.id, null);
    if (!primeira) { alert('Modelo sem etapa após o início.'); return; }

    const titulo = `${modelo.nome} — ${new Date().toLocaleDateString('pt-BR')}`;
    try {
      const instanciaId = await _addDoc('wf_instancia_processos', {
        processo_id: modelo.processo_origem_id || null,
        modelo_id: modelo.id,
        processo_nome: modelo.nome,
        titulo,
        status: 'em_andamento',
        no_atual_id: primeira.id,
        etapa_atual_id: primeira.id,
        solicitante_uid: uid,
        canvas: modelo.canvas,        // snapshot do fluxo
        snapshot_etapas: nos.filter(n => n.tipo === 'tarefa' || n.tipo === 'aprovacao')
          .map(n => ({ id: n.id, nome: n.nome, tipo: n.tipo })),
        dados_consolidados: {},
        concluido_em: null,
      });
      await _registrarHistorico(instanciaId, 'instancia_criada', uid, null, null,
        `Workflow "${modelo.nome}" iniciado a partir de template.`, { modelo_id: modelo.id });
      await _criarTarefasDoNo({ id: instanciaId, titulo, processo_id: modelo.processo_origem_id, solicitante_uid: uid }, primeira);
      alert(`Workflow iniciado! Etapa "${primeira.nome}" criada.`);
      wfNavWorkflow('tarefas');
    } catch (e) {
      alert('Erro ao iniciar: ' + e.message);
    }
  }

  // Resolve o nó destino a partir de um nó, seguindo arestas (pulando início)
  function _proximoNo(canvas, noId, acao) {
    const arestas = canvas.arestas || [];
    const nos = canvas.nos || [];
    // arestas que partem de noId; se acao informada, filtra; senão pega a primeira
    const candidatas = arestas.filter(a => a.origem === noId && (acao == null || a.acao === acao));
    const aresta = candidatas[0] || (acao != null ? arestas.find(a => a.origem === noId) : null);
    if (!aresta) return null;
    const destino = nos.find(n => n.id === aresta.destino);
    if (!destino) return null;
    // se destino for início (não deveria), segue adiante
    if (destino.tipo === 'inicio') return _proximoNo(canvas, destino.id, null);
    return destino;
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

  // ── Exposição global ──────────────────────────────────────────────────────
  Object.assign(globalScope, {
    rWorkflow,
    wfNavWorkflow,
    wfCarregarTarefas,
    wfAbrirTarefa,
    wfConcluirTarefa,
    wfCarregarInstancias,
    wfCarregarProcessosMapeados,
    wfCarregarIniciar,
    wfIniciarAba,
    wfCarregarTemplatesPublicados,
    wfIniciarDeProcesso,
    wfIniciarDeModelo,
    // Designer
    wfImportarMapeamento,
    wfAbrirDesigner,
    wfDesignerRemoverArestaSel,
    wfDesignerCampoNo,
    wfDesignerCampoCfg,
    wfDesignerPapel,
    wfDesignerToggleAcao,
    wfDesignerSalvar,
    wfDesignerPublicar,
    wfAbrirHistorico,
    wfCancelarInstancia,
    wfConfirmarCancelar,
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
