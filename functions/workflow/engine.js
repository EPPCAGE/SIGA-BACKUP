'use strict';

/**
 * Engine de workflow — máquina de estados finita, Fase 1 (sequencial).
 *
 * Integração com processos existentes:
 * - ProcessoModelo referencia um processo da coleção `arquitetura` via `arquitetura_id`
 * - EtapaModelo pode referenciar uma etapa/atividade já mapeada via `etapa_arquitetura_id`
 * - Ao iniciar uma instância, os dados do processo mapeado são copiados como snapshot
 *   para garantir imutabilidade histórica
 */

const { FieldValue } = require('firebase-admin/firestore');
const {
  criarInstanciaProcesso,
  criarInstanciaProcessoMapeado,
  criarTarefaWorkflow,
  criarHistoricoWorkflow,
  fsClean,
  agora,
} = require('./entities');
const { calcularPrazo } = require('./sla');
const { makeNotificacoes } = require('./notifications');

const ERRO = {
  MODELO_NAO_ENCONTRADO: { code: 'MODELO_NAO_ENCONTRADO', status: 404 },
  MODELO_NAO_PUBLICADO: { code: 'MODELO_NAO_PUBLICADO', status: 422 },
  ETAPA_NAO_ENCONTRADA: { code: 'ETAPA_NAO_ENCONTRADA', status: 404 },
  TRANSICAO_NAO_ENCONTRADA: { code: 'TRANSICAO_NAO_ENCONTRADA', status: 422 },
  ACAO_INVALIDA: { code: 'ACAO_INVALIDA', status: 422 },
  TAREFA_NAO_ENCONTRADA: { code: 'TAREFA_NAO_ENCONTRADA', status: 404 },
  SEM_PERMISSAO: { code: 'SEM_PERMISSAO', status: 403 },
  TAREFA_JA_CONCLUIDA: { code: 'TAREFA_JA_CONCLUIDA', status: 422 },
  CAMPO_OBRIGATORIO: { code: 'CAMPO_OBRIGATORIO', status: 400 },
  INSTANCIA_NAO_ENCONTRADA: { code: 'INSTANCIA_NAO_ENCONTRADA', status: 404 },
  INSTANCIA_NAO_ATIVA: { code: 'INSTANCIA_NAO_ATIVA', status: 422 },
};

function lancarErro(tipo, mensagem) {
  throw Object.assign(new Error(mensagem || tipo.code), tipo);
}

async function buscarDoc(colRef, id, erro) {
  const snap = await colRef.doc(id).get();
  if (!snap.exists) lancarErro(erro, `Documento ${id} não encontrado`);
  return { id: snap.id, ...snap.data() };
}

async function resolverResponsavel(etapa, instancia) {
  if (etapa.responsavel_tipo === 'solicitante') {
    return instancia.solicitante_uid;
  }
  if (etapa.responsavel_tipo === 'usuario_especifico') {
    return etapa.responsavel_valor;
  }
  // 'perfil' — retorna o valor do perfil; o frontend resolve o usuário real
  // Em Fase 1, aceita o perfil como responsavel_uid e o frontend filtra
  return etapa.responsavel_valor || instancia.solicitante_uid;
}

function _modeloUsaCanvas(modelo) {
  return Array.isArray(modelo?.canvas?.nos) && modelo.canvas.nos.length > 0;
}

function _etapaCanvasExecutavel(no) {
  return ['tarefa', 'aprovacao'].includes(no?.tipo);
}

function _configNo(modeloOuInstancia, noId) {
  return modeloOuInstancia?.config_nos?.[noId]
    || modeloOuInstancia?.canvas?.nos?.find((no) => no.id === noId)?.config
    || {};
}

function _noCanvasPorId(canvas, noId) {
  return (canvas?.nos || []).find((no) => no.id === noId) || null;
}

function _avaliarCondicaoCanvas(condicao = {}, dados = {}) {
  if (!condicao.campo) return true;
  const valorAtual = dados?.[condicao.campo];
  const valorEsperado = condicao.valor;
  switch (condicao.operador) {
    case '!=': return valorAtual !== valorEsperado;
    case '>': return Number(valorAtual) > Number(valorEsperado);
    case '<': return Number(valorAtual) < Number(valorEsperado);
    case '>=': return Number(valorAtual) >= Number(valorEsperado);
    case '<=': return Number(valorAtual) <= Number(valorEsperado);
    case 'contém': return String(valorAtual || '').includes(String(valorEsperado || ''));
    case 'não contém': return !String(valorAtual || '').includes(String(valorEsperado || ''));
    case 'vazio': return valorAtual == null || valorAtual === '';
    case 'não vazio': return !(valorAtual == null || valorAtual === '');
    case '=':
    default:
      return valorAtual === valorEsperado;
  }
}

function _avaliarCondicoesCanvas(condicoes = [], operadorLogico = 'AND', dados = {}) {
  if (!Array.isArray(condicoes) || !condicoes.length) return true;
  if (operadorLogico === 'OR') return condicoes.some((condicao) => _avaliarCondicaoCanvas(condicao, dados));
  return condicoes.every((condicao) => _avaliarCondicaoCanvas(condicao, dados));
}

/**
 * @param {import('firebase-admin/firestore').Firestore} db
 */
function makeEngine(db) {
  const notif = makeNotificacoes(db);


  const col = {
    modelos: db.collection('wf_processo_modelos'),
    etapas: db.collection('wf_etapa_modelos'),
    transicoes: db.collection('wf_transicao_fluxos'),
    formularios: db.collection('wf_formulario_modelos'),
    instancias: db.collection('wf_instancia_processos'),
    tarefas: db.collection('wf_tarefa_workflows'),
    historico: db.collection('wf_historico_workflows'),
    arquitetura: db.collection('arquitetura'),
    usuariosConfig: db.doc('config/usuarios'),
    grupos: db.collection('wf_grupos'),
  };

  // -------------------------------------------------------------------------
  // Helpers internos
  // -------------------------------------------------------------------------

  async function _registrarHistorico(instancia_id, tipo_evento, usuario_uid, etapa_id, tarefa_id, descricao, dados) {
    const entry = criarHistoricoWorkflow({ instancia_id, tipo_evento, usuario_uid, etapa_id, tarefa_id, descricao, dados });
    const ref = await col.historico.add(entry);
    return ref.id;
  }

  let _usuariosCache = null;

  async function _carregarUsuariosConfig() {
    if (_usuariosCache) return _usuariosCache;
    const snap = await col.usuariosConfig.get();
    const raw = snap.exists ? snap.data()?.data : [];
    _usuariosCache = typeof raw === 'string' ? JSON.parse(raw) : (Array.isArray(raw) ? raw : []);
    return _usuariosCache;
  }

  async function _resolverUidPorEmail(email) {
    if (!email || !String(email).includes('@')) return null;
    const usuarios = await _carregarUsuariosConfig();
    const usuario = usuarios.find((item) => String(item?.email || '').toLowerCase() === String(email).toLowerCase());
    return usuario?.uid || null;
  }

  async function _buscarUsuarioPorUid(uid) {
    if (!uid) return null;
    const usuarios = await _carregarUsuariosConfig();
    return usuarios.find((item) => item?.uid === uid || item?.id === uid) || null;
  }

  function _uidAtribuido(instancia, papel) {
    const valor = instancia?.atribuicoes?.[papel];
    if (!valor) return null;
    if (typeof valor === 'string') return valor;
    return valor.para || valor.uid || null;
  }

  async function _usuarioPertenceAoGrupo(grupoId, email) {
    if (!(grupoId && email)) return false;
    const grupo = await buscarDoc(col.grupos, grupoId, { code: 'GRUPO_NAO_ENCONTRADO', status: 404 });
    return Array.isArray(grupo.membros_email) && grupo.membros_email.includes(email);
  }

  async function _usuarioPodeExecutarTarefa(tarefa, usuario) {
    if (!usuario?.uid) return false;
    if (tarefa.responsavel_uid) return tarefa.responsavel_uid === usuario.uid;
    if (tarefa.grupo_id) return _usuarioPertenceAoGrupo(tarefa.grupo_id, usuario.email);
    if (!tarefa.papel_alvo) return true;
    if (tarefa.papel_alvo === usuario.email) return true;
    return tarefa.papel_alvo === usuario.perfil;
  }

  function _usuarioPodeGerenciarWorkflow(usuario) {
    return ['ep', 'gestor'].includes(String(usuario?.perfil || '').trim());
  }

  function _garantirPermissaoGestaoWorkflow(usuario, mensagem = 'Usuário não pode gerenciar esta operação de workflow.') {
    if (_usuarioPodeGerenciarWorkflow(usuario)) return;
    lancarErro(ERRO.SEM_PERMISSAO, mensagem);
  }

  function _garantirPermissaoDelegacao(tarefa, usuario) {
    if (tarefa?.responsavel_uid && tarefa.responsavel_uid === usuario?.uid) return;
    if (_usuarioPodeGerenciarWorkflow(usuario)) return;
    lancarErro(ERRO.SEM_PERMISSAO, 'Usuário não pode delegar esta tarefa.');
  }

  async function _atribuirTarefaSeNecessario(tarefa, usuario, opts = {}) {
    if (tarefa.responsavel_uid) return { ...tarefa, assumida: false };
    const isEp = usuario?.perfil === 'ep';
    const permitido = isEp || await _usuarioPodeExecutarTarefa(tarefa, usuario);
    if (!permitido) {
      lancarErro(ERRO.SEM_PERMISSAO, 'Usuário não pode assumir ou executar esta tarefa.');
    }
    const patch = {
      responsavel_uid: usuario.uid,
      assumida_em: agora(),
      assumida_por_uid: usuario.uid,
    };
    if (tarefa.status === 'pendente') {
      patch.status = 'em_execucao';
      patch.iniciado_em = tarefa.iniciado_em || agora();
    }
    await col.tarefas.doc(tarefa.id).update(patch);
    await _registrarHistorico(
      tarefa.instancia_id,
      opts.evento || 'tarefa_iniciada',
      usuario.uid,
      tarefa.etapa_modelo_id,
      tarefa.id,
      opts.mensagem || 'Tarefa assumida para execução.',
      { assumida_por_uid: usuario.uid, ...(opts.detalhes || {}) },
    );
    return { ...tarefa, ...patch, assumida: true };
  }

  async function _resolverDestinoTarefaCanvas(papelAlvo, instancia) {
    const alvo = String(papelAlvo || 'solicitante').trim();
    if (!alvo || alvo === 'solicitante') {
      return { responsavel_uid: instancia.solicitante_uid, papel_alvo: 'solicitante', grupo_id: null };
    }
    if (alvo.startsWith('grupo:')) {
      return { responsavel_uid: null, papel_alvo: alvo, grupo_id: alvo.slice(6) || null };
    }
    if (['ep', 'gestor', 'dono'].includes(alvo)) {
      return { responsavel_uid: null, papel_alvo: alvo, grupo_id: null };
    }
    if (alvo === 'gestor_solicitante') {
      const usuario = await _buscarUsuarioPorUid(instancia.solicitante_uid);
      const uid = usuario?.gestor_uid || usuario?.gestor || null;
      // If gestor not configured, fall back to generic 'gestor' queue so the task is visible
      return { responsavel_uid: uid, papel_alvo: uid ? alvo : 'gestor', grupo_id: null };
    }
    if (alvo === 'gestor_executor') {
      const usuario = await _buscarUsuarioPorUid(instancia.ultimo_executor_uid);
      const uid = usuario?.gestor_uid || usuario?.gestor || null;
      return { responsavel_uid: uid, papel_alvo: uid ? alvo : 'gestor', grupo_id: null };
    }
    if (alvo.includes('@')) {
      const uid = await _resolverUidPorEmail(alvo);
      return { responsavel_uid: uid, papel_alvo: alvo, grupo_id: null };
    }
    return { responsavel_uid: alvo, papel_alvo: alvo, grupo_id: null };
  }

  async function _resolverUidNotificacaoCanvas(papelAlvo, instancia, dadosBase = {}) {
    const alvo = String(papelAlvo || '').trim();
    if (!alvo) return null;
    if (alvo === 'solicitante') return instancia.solicitante_uid || null;
    if (['ep', 'gestor', 'dono'].includes(alvo)) return _uidAtribuido(instancia, alvo);
    if (alvo === 'gestor_solicitante') {
      const usuario = await _buscarUsuarioPorUid(instancia.solicitante_uid);
      return usuario?.gestor_uid || usuario?.gestor || null;
    }
    if (alvo === 'gestor_executor') {
      const usuario = await _buscarUsuarioPorUid(instancia.ultimo_executor_uid);
      return usuario?.gestor_uid || usuario?.gestor || null;
    }
    if (alvo.startsWith('campo:')) {
      const valor = dadosBase[alvo.slice(6)];
      if (!valor) return null;
      if (String(valor).includes('@')) return _resolverUidPorEmail(valor);
      return String(valor);
    }
    if (alvo.startsWith('grupo:')) return null;
    if (alvo.includes('@')) return _resolverUidPorEmail(alvo);
    return alvo;
  }

  async function _notificarCientesCanvas(instancia, no) {
    const cfg = _configNo(instancia, no.id);
    const cientes = Array.isArray(cfg.papeis?.ciente) ? cfg.papeis.ciente : [];
    if (!cientes.length) return;
    const destinatarios = new Set();
    for (const papelCiente of cientes) {
      const uid = await _resolverUidNotificacaoCanvas(papelCiente, instancia, instancia.dados_consolidados || {});
      if (uid) destinatarios.add(uid);
    }
    for (const uid of destinatarios) {
      await notif.cienciaEtapa({ destinatario_uid: uid, instancia, etapa: { id: no.id, nome: no.nome || no.id } });
    }
  }

  function _proximoNoCanvas(canvas, noId, acao, dados = {}) {
    const arestas = (canvas?.arestas || []).filter((aresta) => aresta.origem === noId);

    // Para devolver: se não há aresta explícita, usa destino_devolucao da config do nó
    if (acao === 'devolver' || acao === 'rejeitar') {
      const arestasRetorno = arestas.filter(a => a.acao === acao || a.acao === 'devolver' || a.acao === 'rejeitar');
      if (!arestasRetorno.length) {
        const nos = canvas?.nos || [];
        const noAtual = nos.find(n => n.id === noId);
        const destinoId = noAtual?.config?.destino_devolucao;
        if (destinoId) return _noCanvasPorId(canvas, destinoId);
        // fallback: primeiro nó executável anterior (penúltimo no caminho de chegada)
        const chegadas = arestas.filter(a => !a.acao || a.acao === 'avancar' || a.acao === 'aprovar');
        const origens = (canvas?.arestas || []).filter(a => a.destino === noId);
        const anterior = origens.find(a => {
          const n = _noCanvasPorId(canvas, a.origem);
          return n && n.tipo !== 'inicio' && n.tipo !== 'gateway_xor' && n.tipo !== 'gateway_and';
        }) || origens[0];
        return anterior ? _noCanvasPorId(canvas, anterior.origem) : null;
      }
      const pool = arestasRetorno;
      const correspondentes = pool.filter(a => _avaliarCondicoesCanvas(a.condicoes, a.operador_logico, dados));
      const escolhida = correspondentes[0] || pool.find(a => a.padrao) || pool[0] || null;
      return escolhida ? _noCanvasPorId(canvas, escolhida.destino) : null;
    }

    if (!arestas.length) return null;
    const candidatas = arestas.filter((aresta) => {
      if (!acao) return true;
      return aresta.acao === acao || aresta.label === acao || (!aresta.acao && !aresta.label);
    });
    const pool = candidatas.length ? candidatas : arestas;
    const correspondentes = pool.filter((aresta) => _avaliarCondicoesCanvas(aresta.condicoes, aresta.operador_logico, dados));
    const escolhida = correspondentes[0] || pool.find((aresta) => aresta.padrao) || pool[0] || null;
    return escolhida ? _noCanvasPorId(canvas, escolhida.destino) : null;
  }

  function _proximoNoExecutavelCanvas(canvas, noId, acao, dados = {}) {
    let atual = _proximoNoCanvas(canvas, noId, acao, dados);
    while (atual && !_etapaCanvasExecutavel(atual) && atual.tipo !== 'fim') {
      atual = _proximoNoCanvas(canvas, atual.id, null, dados);
    }
    return atual;
  }

  function _acaoPermitidaNoCanvas(instancia, tarefa, acao, dados = {}) {
    const base = (Array.isArray(tarefa.acoes_disponiveis) && tarefa.acoes_disponiveis.length
      ? tarefa.acoes_disponiveis
      : ['avancar']).map(_normalizarAcao);
    if (!base.includes(_normalizarAcao(acao))) return false;
    if (acao === 'devolver' || acao === 'rejeitar') {
      const arestas = (instancia.canvas?.arestas || []).filter((aresta) => aresta.origem === tarefa.etapa_modelo_id);
      const regrasAresta = arestas.filter((aresta) => aresta.acao === acao);
      if (!regrasAresta.length) return true;
      return regrasAresta.some((aresta) => _avaliarCondicoesCanvas(aresta.condicoes, aresta.operador_logico, dados))
        || regrasAresta.some((aresta) => aresta.padrao);
    }
    return true;
  }

  function _acoesPorPapelCanvas(cfg = {}, papel = 'executor') {
    const acoesNo = Array.isArray(cfg.acoes) && cfg.acoes.length ? cfg.acoes : ['avancar'];
    if (papel === 'revisor') return ['avancar'];
    if (papel === 'aprovador') {
      const acoesAprovador = acoesNo.filter((acaoItem) => acaoItem !== 'avancar');
      return acoesAprovador.length ? acoesAprovador : ['aprovar', 'rejeitar'];
    }
    return acoesNo;
  }


  async function _criarTarefaCanvas(instancia, modelo, no) {
    const cfg = _configNo(modelo, no.id);
    const papelAlvo = cfg.papeis?.executor || 'solicitante';
    const destino = await _resolverDestinoTarefaCanvas(papelAlvo, instancia);
    const prazo = calcularPrazo(agora(), cfg.sla_horas);
    const tarefaData = fsClean({
      instancia_id: instancia.id,
      etapa_modelo_id: no.id,
      etapa_nome: no.nome || no.id,
      etapa_tipo: no.tipo || 'tarefa',
      processo_nome: instancia.titulo,
      processo_id: instancia.processo_modelo_id,
      responsavel_uid: destino.responsavel_uid || null,
      papel_alvo: destino.papel_alvo || null,
      papel_responsavel: 'executor',
      grupo_id: destino.grupo_id || null,
      status: 'pendente',
      prazo: prazo || null,
      criado_em: agora(),
      iniciado_em: null,
      concluido_em: null,
      dados_formulario: {},
      acao_tomada: null,
      observacao: null,
      parecer: null,
      exige_parecer: !!cfg.exige_parecer,
      formulario_id: cfg.formulario_id || null,
      acoes_disponiveis: _acoesPorPapelCanvas(cfg, 'executor'),
      instrucoes: String(cfg.instrucoes || '').trim(),
      anexos: [],
    });

    const ref = await col.tarefas.add(tarefaData);
    const tarefa = { id: ref.id, ...tarefaData };

    await _registrarHistorico(
      instancia.id, 'tarefa_criada', null,
      no.id, tarefa.id,
      `Tarefa "${no.nome || no.id}" criada para ${destino.papel_alvo || destino.responsavel_uid || 'fila livre'}.`,
      { tarefa_id: tarefa.id, responsavel_uid: destino.responsavel_uid || null, papel_alvo: destino.papel_alvo || null, grupo_id: destino.grupo_id || null },
    );

    if (destino.responsavel_uid) {
      await notif.tarefaCriada({ destinatario_uid: destino.responsavel_uid, instancia, tarefa, etapa: { id: no.id, nome: no.nome || no.id } });
    }

    return tarefa;
  }

  function _avaliarCamposCondicionaisCanvas(camposCondicionais = [], dadosForm = {}) {
    const resultado = {};
    (camposCondicionais || []).forEach((campoCondicional) => {
      const campoId = String(campoCondicional?.campo_id || '').trim();
      if (!campoId) return;
      const passa = _avaliarCondicoesCanvas(campoCondicional.condicoes, campoCondicional.operador_logico, dadosForm);
      if (!resultado[campoId]) resultado[campoId] = { visivel: true, obrigatorio: false };
      switch (campoCondicional.acao) {
        case 'mostrar':
          resultado[campoId].visivel = passa;
          break;
        case 'ocultar':
          resultado[campoId].visivel = !passa;
          break;
        case 'obrigatorio':
          resultado[campoId].obrigatorio = passa;
          break;
        case 'opcional':
          resultado[campoId].obrigatorio = !passa;
          break;
        default:
          break;
      }
    });
    return resultado;
  }

  async function _validarFormularioTarefaCanvas(instancia, tarefa, dados_formulario = {}) {
    if (!tarefa.formulario_id) return;
    const form = await buscarDoc(col.formularios, tarefa.formulario_id, { code: 'FORMULARIO_NAO_ENCONTRADO', status: 404 });
    const cfgNo = _configNo(instancia, tarefa.etapa_modelo_id);
    const estadoCampos = _avaliarCamposCondicionaisCanvas(cfgNo.campos_condicionais, dados_formulario);
    const camposObrigatorios = (form.campos || []).filter((campo) => {
      const estado = estadoCampos[campo.id] || { visivel: true, obrigatorio: false };
      if (!estado.visivel) return false;
      if (estado.obrigatorio) return true;
      return !!campo.obrigatorio;
    });
    const faltando = camposObrigatorios.filter((campo) => {
      const valor = dados_formulario[campo.id];
      return valor == null || valor === '';
    });
    if (faltando.length > 0) {
      lancarErro(ERRO.CAMPO_OBRIGATORIO, `Campos obrigatórios não preenchidos: ${faltando.map((campo) => campo.label).join(', ')}`);
    }
  }

  async function _avancarFluxoCanvas(instancia, tarefa, acao) {
    // Usa o canvas do modelo publicado atual, não o snapshot da instância,
    // pois o snapshot pode estar desatualizado se o modelo foi editado após o início.
    const modelo = await col.modelos.doc(instancia.processo_modelo_id).get();
    const modeloData = modelo.exists ? { id: modelo.id, ...modelo.data() } : null;
    const canvas = (modeloData && _modeloUsaCanvas(modeloData))
      ? modeloData.canvas
      : (instancia.canvas || { nos: [], arestas: [] });

    const noAtual = _noCanvasPorId(canvas, tarefa.etapa_modelo_id);
    if (!noAtual) lancarErro(ERRO.ETAPA_NAO_ENCONTRADA, `Nó ${tarefa.etapa_modelo_id} não encontrado no canvas.`);

    const proximoNo = _proximoNoExecutavelCanvas(canvas, noAtual.id, acao, instancia.dados_consolidados || {});
    if (!proximoNo || proximoNo.tipo === 'fim') {
      await col.instancias.doc(instancia.id).update({ status: 'concluido', concluido_em: agora(), no_atual_id: null, etapa_atual_id: null });
      await _registrarHistorico(instancia.id, 'instancia_concluida', null, null, null, 'Processo concluído.', {});
      await notif.instanciaConcluida({ instancia: { ...instancia, id: instancia.id } });
      return;
    }

    await col.instancias.doc(instancia.id).update({ no_atual_id: proximoNo.id, etapa_atual_id: proximoNo.id });
    await _registrarHistorico(instancia.id, 'etapa_avancada', null, proximoNo.id, null, `Fluxo avançou para "${proximoNo.nome || proximoNo.id}".`, { de: noAtual.id, para: proximoNo.id, acao: acao || null });
    const modeloParaConfig = modeloData || instancia;
    await _criarTarefaCanvas({ ...instancia, etapa_atual_id: proximoNo.id }, modeloParaConfig, proximoNo);
  }

  async function _criarTarefa(instancia, etapa) {
    const responsavelUid = await resolverResponsavel(etapa, instancia);
    const prazo = calcularPrazo(agora(), etapa.sla_horas);

    const tarefaData = criarTarefaWorkflow({
      instancia_id: instancia.id,
      etapa_modelo_id: etapa.id,
      responsavel_uid: responsavelUid,
      prazo,
    });

    const ref = await col.tarefas.add(tarefaData);
    const tarefa = { id: ref.id, ...tarefaData };

    if (instancia.processo_id || instancia.processo_modelo_id) {
      await col.tarefas.doc(tarefa.id).update({ processo_id: instancia.processo_id || instancia.processo_modelo_id });
      tarefa.processo_id = instancia.processo_id || instancia.processo_modelo_id;
    }

    await _registrarHistorico(
      instancia.id, 'tarefa_criada', null,
      etapa.id, tarefa.id,
      `Tarefa "${etapa.nome}" criada para ${responsavelUid}.`,
      { tarefa_id: tarefa.id, responsavel_uid: responsavelUid },
    );

    await notif.tarefaCriada({ destinatario_uid: responsavelUid, instancia, tarefa, etapa });

    return tarefa;
  }

  // -------------------------------------------------------------------------
  // API pública da engine
  // -------------------------------------------------------------------------

  /**
   * Inicia uma nova instância de processo a partir de um modelo publicado.
   *
   * Integração: carrega o snapshot do processo da coleção `arquitetura`
   * e salva junto à instância para preservar o contexto histórico.
   */
  async function iniciarInstancia({ processo_modelo_id, titulo, solicitante_uid, grupo_id = null, grupo_nome = null }) {
    const modelo = await buscarDoc(col.modelos, processo_modelo_id, ERRO.MODELO_NAO_ENCONTRADO);
    if (modelo.status !== 'publicado') lancarErro(ERRO.MODELO_NAO_PUBLICADO, 'O modelo precisa estar publicado para iniciar instâncias.');

    // Carrega snapshot do processo da arquitetura (se vinculado)
    let snapshotArquitetura = null;
    if (modelo.arquitetura_id) {
      const arquSnap = await col.arquitetura.doc(modelo.arquitetura_id).get();
      if (arquSnap.exists) snapshotArquitetura = { id: arquSnap.id, ...arquSnap.data() };
    }

    const instanciaData = criarInstanciaProcesso({
      processo_modelo_id,
      processo_modelo_versao: modelo.versao,
      titulo: titulo || `${modelo.nome} — ${new Date().toLocaleDateString('pt-BR')}`,
      solicitante_uid,
      grupo_id,
      grupo_nome,
    });
    if (_modeloUsaCanvas(modelo)) {
      instanciaData.canvas = fsClean(modelo.canvas || { nos: [], arestas: [] });
      instanciaData.config_nos = fsClean(modelo.config_nos || {});
      instanciaData.snapshot_etapas = (modelo.canvas?.nos || [])
        .filter((no) => _etapaCanvasExecutavel(no))
        .map((no) => ({ id: no.id, nome: no.nome || no.id, tipo: no.tipo }));
      instanciaData.no_atual_id = null;
    }

    // Embedda snapshot do processo mapeado para contexto imutável
    if (snapshotArquitetura) {
      instanciaData.snapshot_processo = fsClean({
        id: snapshotArquitetura.id,
        nome: snapshotArquitetura.nome || snapshotArquitetura.titulo || '',
        nivel: snapshotArquitetura.nivel || null,
        codigo: snapshotArquitetura.codigo || null,
      });
    }

    const instRef = await col.instancias.add(instanciaData);
    const instancia = { id: instRef.id, ...instanciaData };

    await _registrarHistorico(
      instancia.id, 'instancia_criada', solicitante_uid,
      null, null,
      `Instância do processo "${modelo.nome}" criada.`,
      { processo_modelo_id, versao: modelo.versao, grupo_id: grupo_id || null, grupo_nome: grupo_nome || null },
    );

    if (_modeloUsaCanvas(modelo)) {
      const inicio = (modelo.canvas?.nos || []).find((no) => no.tipo === 'inicio');
      if (!inicio) lancarErro(ERRO.ETAPA_NAO_ENCONTRADA, 'Modelo canvas sem nó de início.');
      const primeiroNo = _proximoNoExecutavelCanvas(modelo.canvas, inicio.id, null, {});
      if (!primeiroNo) lancarErro(ERRO.TRANSICAO_NAO_ENCONTRADA, 'Modelo canvas sem etapa executável após o início.');
      await col.instancias.doc(instancia.id).update({ etapa_atual_id: primeiroNo.id, no_atual_id: primeiroNo.id });
      instancia.etapa_atual_id = primeiroNo.id;
      instancia.no_atual_id = primeiroNo.id;
      await _notificarCientesCanvas(instancia, primeiroNo);
      await _criarTarefaCanvas(instancia, modelo, primeiroNo);
      return instancia;
    }

    // Busca etapa inicial e cria a primeira tarefa
    const etapaInicial = await buscarDoc(col.etapas, modelo.etapa_inicial, ERRO.ETAPA_NAO_ENCONTRADA);
    await col.instancias.doc(instancia.id).update({ etapa_atual_id: etapaInicial.id });
    instancia.etapa_atual_id = etapaInicial.id;

    await _criarTarefa(instancia, etapaInicial);

    return instancia;
  }

  async function iniciarInstanciaMapeada({ processo_id, processo_nome, titulo, solicitante_uid, snapshot_etapas = [], fluxo_origem = null }) {
    const instanciaData = criarInstanciaProcessoMapeado({
      processo_id,
      processo_nome,
      titulo,
      solicitante_uid,
      snapshot_etapas,
      fluxo_origem,
    });
    if (!instanciaData.snapshot_etapas.length) {
      lancarErro(ERRO.ETAPA_NAO_ENCONTRADA, 'Processo mapeado sem etapas executáveis.');
    }

    const instRef = await col.instancias.add(instanciaData);
    const instancia = { id: instRef.id, ...instanciaData };

    await _registrarHistorico(
      instancia.id, 'instancia_criada', solicitante_uid,
      null, null,
      `Workflow iniciado a partir do processo "${processo_nome}" (${fluxo_origem || 'mapeado'}).`,
      { processo_id, fluxo_origem: fluxo_origem || null },
    );

    await _criarTarefa(instancia, instanciaData.snapshot_etapas[0]);

    return instancia;
  }

  /**
   * Marca tarefa como em execução (usuário abriu a tela).
   */
  async function iniciarTarefa({ tarefa_id, usuario_uid, usuario_email = null, usuario_perfil = null }) {
    const tarefa = await buscarDoc(col.tarefas, tarefa_id, ERRO.TAREFA_NAO_ENCONTRADA);
    const usuario = { uid: usuario_uid, email: usuario_email, perfil: usuario_perfil };
    const tarefaAtual = await _atribuirTarefaSeNecessario(tarefa, usuario);
    if (!['pendente'].includes(tarefaAtual.status)) return tarefaAtual; // idempotente

    await col.tarefas.doc(tarefa_id).update({ status: 'em_execucao', iniciado_em: agora() });
    await _registrarHistorico(
      tarefaAtual.instancia_id, 'tarefa_iniciada', usuario_uid,
      tarefaAtual.etapa_modelo_id, tarefa_id,
      `Tarefa iniciada pelo responsável.`, {},
    );

    return { ...tarefaAtual, status: 'em_execucao' };
  }

  async function assumirTarefa({ tarefa_id, usuario_uid, usuario_email = null, usuario_perfil = null }) {
    const tarefa = await buscarDoc(col.tarefas, tarefa_id, ERRO.TAREFA_NAO_ENCONTRADA);
    if (tarefa.responsavel_uid && tarefa.responsavel_uid !== usuario_uid) {
      lancarErro(ERRO.SEM_PERMISSAO, 'Tarefa já foi assumida por outro usuário.');
    }
    const usuario = { uid: usuario_uid, email: usuario_email, perfil: usuario_perfil };
    const tarefaAtual = await _atribuirTarefaSeNecessario(tarefa, usuario, {
      evento: 'tarefa_assumida',
      mensagem: 'Tarefa assumida da fila.',
    });
    return { ...tarefaAtual, status: tarefaAtual.status || 'em_execucao' };
  }

  /**
   * Conclui uma tarefa, valida o formulário e avança o fluxo.
   */
  const _ACAO_NORMALIZAR = { concluir: 'avancar', aprovar: 'avancar', solicitar_ajuste: 'devolver' };

  function _normalizarAcao(acao) {
    return _ACAO_NORMALIZAR[acao] || acao || 'avancar';
  }

  async function concluirTarefa({ tarefa_id, usuario_uid, usuario_email = null, usuario_perfil = null, acao, observacao = '', dados_formulario = {}, anexos = [] }) {
    const tarefa = await buscarDoc(col.tarefas, tarefa_id, ERRO.TAREFA_NAO_ENCONTRADA);
    const usuario = { uid: usuario_uid, email: usuario_email, perfil: usuario_perfil };
    const tarefaAtual = await _atribuirTarefaSeNecessario(tarefa, usuario);

    if (['concluida', 'cancelada'].includes(tarefa.status)) lancarErro(ERRO.TAREFA_JA_CONCLUIDA, 'Tarefa já foi concluída.');

    const instancia = await buscarDoc(col.instancias, tarefaAtual.instancia_id, ERRO.INSTANCIA_NAO_ENCONTRADA);
    if (instancia.status !== 'em_andamento') lancarErro(ERRO.INSTANCIA_NAO_ATIVA, 'Instância não está ativa.');

    if (_modeloUsaCanvas(instancia)) {
      const dadosMesclados = { ...instancia.dados_consolidados, ...dados_formulario };
      const acaoFinal = _normalizarAcao(acao ?? tarefaAtual.acoes_disponiveis?.[0] ?? 'avancar');
      if (!_acaoPermitidaNoCanvas(instancia, tarefaAtual, acaoFinal, dadosMesclados)) {
        lancarErro(ERRO.ACAO_INVALIDA, `Ação "${acaoFinal}" não está disponível para esta tarefa.`);
      }
      const exigeParecer = tarefaAtual.exige_parecer || acaoFinal === 'rejeitar' || acaoFinal === 'devolver';
      if (exigeParecer && !String(observacao || '').trim()) {
        lancarErro(ERRO.CAMPO_OBRIGATORIO, 'É obrigatório informar um parecer/justificativa para esta ação.');
      }
      await _validarFormularioTarefaCanvas(instancia, tarefaAtual, dados_formulario);
      await col.tarefas.doc(tarefa_id).update(fsClean({
        status: 'concluida',
        acao_tomada: acaoFinal,
        observacao: observacao || null,
        parecer: observacao || null,
        dados_formulario,
        anexos: Array.isArray(anexos) ? anexos : [],
        concluido_em: agora(),
      }));

      const mergedDados = dadosMesclados;
      const patchInstancia = { dados_consolidados: mergedDados };
      if (tarefaAtual.papel_responsavel === 'executor') {
        patchInstancia.ultimo_executor_uid = usuario_uid;
      }
      await col.instancias.doc(instancia.id).update(patchInstancia);

      await _registrarHistorico(
        instancia.id, 'tarefa_concluida', usuario_uid,
        tarefaAtual.etapa_modelo_id, tarefa_id,
        `Tarefa "${tarefaAtual.etapa_nome || tarefaAtual.etapa_modelo_id}" concluída com ação "${acaoFinal || 'Concluído'}".`,
        { acao_tomada: acaoFinal, observacao, dados_formulario, papel_responsavel: tarefaAtual.papel_responsavel || null },
      );

      await _avancarFluxoCanvas({ ...instancia, dados_consolidados: mergedDados }, tarefaAtual, acaoFinal);
      return { ok: true };
    }

    const etapa = await buscarDoc(col.etapas, tarefaAtual.etapa_modelo_id, ERRO.ETAPA_NAO_ENCONTRADA);

    // Valida campos obrigatórios do formulário
    if (etapa.formulario_modelo_id) {
      const form = await buscarDoc(col.formularios, etapa.formulario_modelo_id, { code: 'FORMULARIO_NAO_ENCONTRADO', status: 404 });
      const camposObrigatorios = (form.campos || []).filter(c => c.obrigatorio);
      const faltando = camposObrigatorios.filter(c => {
        const v = dados_formulario[c.id];
        return v == null || v === '';
      });
      if (faltando.length > 0) {
        lancarErro(ERRO.CAMPO_OBRIGATORIO, `Campos obrigatórios não preenchidos: ${faltando.map(c => c.label).join(', ')}`);
      }
    }

    // Atualiza tarefa
    await col.tarefas.doc(tarefa_id).update(fsClean({
      status: 'concluida',
      acao_tomada: acao || null,
      observacao: observacao || null,
      dados_formulario,
        anexos: Array.isArray(anexos) ? anexos : [],
      concluido_em: agora(),
    }));

    // Merge nos dados consolidados da instância
    const mergedDados = { ...instancia.dados_consolidados, ...dados_formulario };
    await col.instancias.doc(instancia.id).update({ dados_consolidados: mergedDados });

    await _registrarHistorico(
      instancia.id, 'tarefa_concluida', usuario_uid,
      etapa.id, tarefa_id,
      `Tarefa "${etapa.nome}" concluída com ação "${acao || 'Concluído'}".`,
      { acao_tomada: acao, observacao, dados_formulario },
    );

    // Avança fluxo
    const instanciaAtualizada = { ...instancia, dados_consolidados: mergedDados };
    await _avancarFluxo(instanciaAtualizada, etapa, acao);

    return { ok: true };
  }

  async function _avancarFluxo(instancia, etapaAtual, acao) {
    const transSnap = await col.transicoes
      .where('processo_modelo_id', '==', instancia.processo_modelo_id)
      .where('etapa_origem_id', '==', etapaAtual.id)
      .get();

    if (transSnap.empty) lancarErro(ERRO.TRANSICAO_NAO_ENCONTRADA, `Nenhuma transição definida para etapa ${etapaAtual.id}`);

    const transicoes = transSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const transicao = transicoes.find(t =>
      t.condicao === 'sempre' || t.label === acao,
    );

    if (!transicao) lancarErro(ERRO.TRANSICAO_NAO_ENCONTRADA, `Transição para ação "${acao}" não encontrada.`);

    const proxEtapa = await buscarDoc(col.etapas, transicao.etapa_destino_id, ERRO.ETAPA_NAO_ENCONTRADA);

    await col.instancias.doc(instancia.id).update({ etapa_atual_id: proxEtapa.id });

    await _registrarHistorico(
      instancia.id, 'etapa_avancada', null,
      proxEtapa.id, null,
      `Fluxo avançou de "${etapaAtual.nome}" para "${proxEtapa.nome}".`,
      { de: etapaAtual.id, para: proxEtapa.id },
    );

    if (proxEtapa.tipo === 'fim') {
      await col.instancias.doc(instancia.id).update({
        status: 'concluido',
        concluido_em: agora(),
      });
      await _registrarHistorico(
        instancia.id, 'instancia_concluida', null,
        proxEtapa.id, null,
        `Processo concluído.`, {},
      );
      await notif.instanciaConcluida({ instancia: { ...instancia, id: instancia.id } });
    } else {
      const instanciaAtualizada = { ...instancia, etapa_atual_id: proxEtapa.id };
      await _criarTarefa(instanciaAtualizada, proxEtapa);
    }
  }

  /**
   * Cancela uma instância (EP ou gestor).
   */
  async function cancelarInstancia({ instancia_id, usuario_uid, usuario_email = null, usuario_perfil = null, motivo = '' }) {
    _garantirPermissaoGestaoWorkflow({ uid: usuario_uid, email: usuario_email, perfil: usuario_perfil }, 'Usuário não pode cancelar esta instância.');
    const instancia = await buscarDoc(col.instancias, instancia_id, ERRO.INSTANCIA_NAO_ENCONTRADA);
    if (!['em_andamento', 'suspenso'].includes(instancia.status)) {
      lancarErro(ERRO.INSTANCIA_NAO_ATIVA, 'Instância não pode ser cancelada neste status.');
    }

    await col.instancias.doc(instancia_id).update({ status: 'cancelado', concluido_em: agora() });

    // Cancela tarefas pendentes
    const tarefasSnap = await col.tarefas
      .where('instancia_id', '==', instancia_id)
      .where('status', 'in', ['pendente', 'em_execucao'])
      .get();

    const batch = db.batch();
    tarefasSnap.docs.forEach(d => batch.update(d.ref, { status: 'cancelada', concluido_em: agora() }));
    await batch.commit();

    await _registrarHistorico(
      instancia_id, 'instancia_cancelada', usuario_uid,
      null, null,
      `Instância cancelada. Motivo: ${motivo || 'não informado'}.`,
      { motivo },
    );

    return { ok: true };
  }

  async function suspenderInstancia({ instancia_id, usuario_uid, usuario_email = null, usuario_perfil = null }) {
    _garantirPermissaoGestaoWorkflow({ uid: usuario_uid, email: usuario_email, perfil: usuario_perfil }, 'Usuário não pode suspender esta instância.');
    const instancia = await buscarDoc(col.instancias, instancia_id, ERRO.INSTANCIA_NAO_ENCONTRADA);
    if (instancia.status !== 'em_andamento') {
      lancarErro(ERRO.INSTANCIA_NAO_ATIVA, 'Instância não pode ser suspensa neste status.');
    }

    await col.instancias.doc(instancia_id).update({ status: 'suspenso', suspenso_em: agora() });
    await _registrarHistorico(instancia_id, 'instancia_suspensa', usuario_uid, null, null, 'Processo suspenso.', {});
    return { ok: true };
  }

  async function retomarInstancia({ instancia_id, usuario_uid, usuario_email = null, usuario_perfil = null }) {
    _garantirPermissaoGestaoWorkflow({ uid: usuario_uid, email: usuario_email, perfil: usuario_perfil }, 'Usuário não pode retomar esta instância.');
    const instancia = await buscarDoc(col.instancias, instancia_id, ERRO.INSTANCIA_NAO_ENCONTRADA);
    if (instancia.status !== 'suspenso') {
      lancarErro(ERRO.INSTANCIA_NAO_ATIVA, 'Instância não pode ser retomada neste status.');
    }

    await col.instancias.doc(instancia_id).update({ status: 'em_andamento', suspenso_em: null });
    await _registrarHistorico(instancia_id, 'instancia_retomada', usuario_uid, null, null, 'Processo retomado.', {});
    return { ok: true };
  }

  async function excluirInstanciaLogica({ instancia_id, usuario_uid, usuario_email = null, usuario_perfil = null }) {
    _garantirPermissaoGestaoWorkflow({ uid: usuario_uid, email: usuario_email, perfil: usuario_perfil }, 'Usuário não pode excluir esta instância.');
    const instancia = await buscarDoc(col.instancias, instancia_id, ERRO.INSTANCIA_NAO_ENCONTRADA);
    if (instancia.status !== 'cancelado' && usuario_perfil !== 'ep') {
      lancarErro(ERRO.INSTANCIA_NAO_ATIVA, 'Instância precisa estar cancelada para exclusão. Apenas EP pode excluir instâncias ativas.');
    }

    await col.instancias.doc(instancia_id).update({
      excluida: true,
      excluida_em: agora(),
      excluida_por_uid: usuario_uid,
    });
    await _registrarHistorico(
      instancia_id, 'instancia_excluida_logica', usuario_uid,
      null, null,
      'Instância removida da listagem (exclusão lógica).',
      {},
    );
    return { ok: true };
  }

  async function delegarTarefa({ tarefa_id, usuario_uid, usuario_email = null, usuario_perfil = null, novo_responsavel_uid, motivo = '' }) {
    const tarefa = await buscarDoc(col.tarefas, tarefa_id, ERRO.TAREFA_NAO_ENCONTRADA);
    if (['concluida', 'cancelada'].includes(tarefa.status)) {
      lancarErro(ERRO.TAREFA_JA_CONCLUIDA, 'Tarefa já foi concluída.');
    }
    _garantirPermissaoDelegacao(tarefa, { uid: usuario_uid, email: usuario_email, perfil: usuario_perfil });

    await col.tarefas.doc(tarefa_id).update(fsClean({
      responsavel_uid: novo_responsavel_uid,
      status: 'pendente',
      iniciado_em: null,
    }));

    const tarefaAtualizada = { ...tarefa, id: tarefa_id, responsavel_uid: novo_responsavel_uid, status: 'pendente', iniciado_em: null };
    await notif.tarefaDelegada({
      destinatario_uid: novo_responsavel_uid,
      tarefa: tarefaAtualizada,
      motivo,
    });
    await _registrarHistorico(
      tarefa.instancia_id, 'tarefa_delegada', usuario_uid,
      tarefa.etapa_modelo_id, tarefa_id,
      `Tarefa delegada para usuário ${novo_responsavel_uid}.${motivo ? ` Motivo: ${motivo}` : ''}`,
      { novoResponsavel: novo_responsavel_uid, motivo },
    );

    return { ok: true };
  }

  async function puxarTarefa({ tarefa_id, usuario_uid, usuario_email = null, usuario_perfil = null }) {
    if (usuario_perfil !== 'ep') lancarErro(ERRO.SEM_PERMISSAO, 'Apenas o perfil EP pode puxar tarefas.');
    const tarefa = await buscarDoc(col.tarefas, tarefa_id, ERRO.TAREFA_NAO_ENCONTRADA);
    if (['concluida', 'cancelada'].includes(tarefa.status)) lancarErro(ERRO.TAREFA_JA_CONCLUIDA, 'Tarefa já encerrada.');

    const anteriorUid = tarefa.responsavel_uid || null;
    const adminNome = usuario_email || 'o administrador';

    const patch = {
      responsavel_uid: usuario_uid,
      papel_alvo: usuario_email || usuario_uid,
      assumida_em: agora(),
      assumida_por_uid: usuario_uid,
      status: tarefa.status === 'pendente' ? 'em_execucao' : tarefa.status,
      iniciado_em: tarefa.iniciado_em || agora(),
    };
    await col.tarefas.doc(tarefa_id).update(patch);
    await _registrarHistorico(
      tarefa.instancia_id, 'tarefa_delegada', usuario_uid,
      tarefa.etapa_modelo_id, tarefa_id,
      `Tarefa puxada pelo administrador (EP).`,
      { novo_responsavel_uid: usuario_uid, anterior_responsavel_uid: anteriorUid },
    );

    // Avisa o responsável anterior que a tarefa foi retirada
    if (anteriorUid && anteriorUid !== usuario_uid) {
      await notif.tarefaRetirada({ destinatario_uid: anteriorUid, tarefa, retirada_por_nome: adminNome }).catch(() => {});
    }

    return { ok: true, tarefa_id };
  }

  async function excluirTarefa({ tarefa_id, usuario_uid, usuario_email = null, usuario_perfil = null }) {
    _garantirPermissaoGestaoWorkflow({ uid: usuario_uid, email: usuario_email, perfil: usuario_perfil }, 'Usuário não pode excluir esta tarefa.');
    const tarefa = await buscarDoc(col.tarefas, tarefa_id, ERRO.TAREFA_NAO_ENCONTRADA);
    await col.tarefas.doc(tarefa_id).delete();

    if (tarefa.instancia_id) {
      await _registrarHistorico(
        tarefa.instancia_id, 'tarefa_excluida', usuario_uid,
        tarefa.etapa_modelo_id || null, tarefa_id,
        `Tarefa "${tarefa.etapa_nome || tarefa_id}" excluída manualmente.`,
        {},
      );
    }

    return { ok: true };
  }

  /**
   * Job agendado: verifica SLAs e emite alertas/vencimentos.
   */
  async function processarSla() {
    const agora_ = new Date();
    const alertaLimite = new Date(agora_.getTime() + 2 * 60 * 60 * 1000);

    // Tarefas que vencerão em até 2h (alerta)
    const alertaSnap = await col.tarefas
      .where('status', 'in', ['pendente', 'em_execucao'])
      .where('prazo', '<=', alertaLimite)
      .where('prazo', '>', agora_)
      .get();

    for (const doc of alertaSnap.docs) {
      const tarefa = { id: doc.id, ...doc.data() };
      const instancia = await col.instancias.doc(tarefa.instancia_id).get();
      const etapa = await col.etapas.doc(tarefa.etapa_modelo_id).get();
      if (!instancia.exists || !etapa.exists) continue;
      const instData = { id: instancia.id, ...instancia.data() };
      const etapaData = { id: etapa.id, ...etapa.data() };

      await notif.prazoProximo({ destinatario_uid: tarefa.responsavel_uid, instancia: instData, tarefa, etapa: etapaData });
      await _registrarHistorico(tarefa.instancia_id, 'sla_alerta', null, tarefa.etapa_modelo_id, tarefa.id, `Alerta de prazo: tarefa "${etapaData.nome}" vence em breve.`, {});
    }

    // Tarefas vencidas
    const vencidasSnap = await col.tarefas
      .where('status', 'in', ['pendente', 'em_execucao'])
      .where('prazo', '<', agora_)
      .get();

    for (const doc of vencidasSnap.docs) {
      const tarefa = { id: doc.id, ...doc.data() };
      await doc.ref.update({ status: 'vencida' });

      const instancia = await col.instancias.doc(tarefa.instancia_id).get();
      const etapa = await col.etapas.doc(tarefa.etapa_modelo_id).get();
      if (!instancia.exists || !etapa.exists) continue;
      const instData = { id: instancia.id, ...instancia.data() };
      const etapaData = { id: etapa.id, ...etapa.data() };

      await notif.tarefaVencida({ destinatario_uid: tarefa.responsavel_uid, instancia: instData, tarefa, etapa: etapaData });
      await _registrarHistorico(tarefa.instancia_id, 'sla_vencido', null, tarefa.etapa_modelo_id, tarefa.id, `Tarefa "${etapaData.nome}" venceu o prazo.`, {});
    }

    return { alertas: alertaSnap.size, vencidas: vencidasSnap.size };
  }

  return {
    iniciarInstancia,
    iniciarInstanciaMapeada,
    assumirTarefa,
    iniciarTarefa,
    concluirTarefa,
    delegarTarefa,
    puxarTarefa,
    excluirTarefa,
    cancelarInstancia,
    suspenderInstancia,
    retomarInstancia,
    excluirInstanciaLogica,
    processarSla,
  };
}

module.exports = { makeEngine };
