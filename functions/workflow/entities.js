'use strict';

/**
 * Validação e criação de entidades do módulo de workflow.
 * Todas as funções criam objetos limpos (sem prototype pollution).
 */

const { Timestamp, FieldValue } = require('firebase-admin/firestore');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function agora() {
  return Timestamp.now();
}

function _requerido(obj, campo) {
  if (obj[campo] == null || obj[campo] === '') {
    throw Object.assign(new Error(`Campo obrigatório ausente: ${campo}`), { code: 'CAMPO_OBRIGATORIO', status: 400 });
  }
}

// Remove prototype pollution e valores indefinidos, preservando Timestamps e FieldValues
function fsClean(obj) {
  if (obj === null || obj === undefined) return obj;
  if (obj instanceof Timestamp) return obj;
  // FieldValue sentinels (serverTimestamp, arrayUnion, etc.)
  if (obj && typeof obj === 'object' && typeof obj.isEqual === 'function' && obj.constructor && obj.constructor.name !== 'Object') return obj;
  if (Array.isArray(obj)) return obj.map(fsClean);
  if (obj && typeof obj === 'object' && obj.constructor === Object) {
    const out = {};
    for (const k of Object.keys(obj)) {
      if (obj[k] !== undefined) out[k] = fsClean(obj[k]);
    }
    return out;
  }
  return obj;
}

// ---------------------------------------------------------------------------
// Enums (mantidos no servidor para validação independente do cliente)
// ---------------------------------------------------------------------------

const STATUS_MODELO = ['rascunho', 'publicado', 'arquivado'];
const TIPO_ETAPA = ['inicio', 'tarefa', 'aprovacao', 'fim'];
const RESPONSAVEL_TIPO = ['perfil', 'usuario_especifico', 'solicitante'];
const STATUS_INSTANCIA = ['em_andamento', 'concluido', 'cancelado', 'suspenso'];
const STATUS_TAREFA = ['pendente', 'em_execucao', 'concluida', 'cancelada', 'vencida'];
const TIPO_CAMPO = ['texto', 'textarea', 'numero', 'data', 'select', 'checkbox', 'anexo'];
const CONDICAO_TRANSICAO = ['sempre', 'aprovado', 'rejeitado'];
const TIPO_NOTIFICACAO = ['tarefa_criada', 'prazo_proximo', 'tarefa_vencida', 'tarefa_concluida', 'tarefa_delegada'];
const FLUXO_ORIGEM = new Set(['asis', 'tobe']);
const ACAO_WORKFLOW = ['avancar', 'concluir', 'aprovar', 'rejeitar', 'devolver', 'solicitar_ajuste'];
const PAPEL_WORKFLOW = ['executor', 'revisor', 'aprovador'];
const TIPO_EVENTO = [
  'instancia_criada', 'instancia_ativada', 'tarefa_criada', 'tarefa_assumida', 'tarefa_iniciada', 'tarefa_concluida',
  'tarefa_delegada', 'tarefa_excluida', 'etapa_avancada', 'instancia_concluida', 'instancia_cancelada',
  'instancia_excluida_logica', 'sla_alerta', 'sla_vencido',
];

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function _stringOuNull(valor) {
  if (valor == null || valor === '') return null;
  return String(valor).trim() || null;
}

function _listaStrings(valores) {
  if (!Array.isArray(valores)) return [];
  return valores.map((valor) => _stringOuNull(valor)).filter(Boolean);
}

function _normalizarCondicao(condicao = {}) {
  return fsClean({
    campo: _stringOuNull(condicao.campo),
    operador: _stringOuNull(condicao.operador) || '=',
    valor: condicao.valor ?? null,
  });
}

function _normalizarPapeisWorkflow(papeis = {}) {
  const normalizado = {
    executor: 'solicitante',
    revisor: null,
    aprovador: null,
    ciente: [],
  };
  PAPEL_WORKFLOW.forEach((papel) => {
    normalizado[papel] = _stringOuNull(papeis[papel]) || normalizado[papel];
  });
  normalizado.ciente = _listaStrings(papeis.ciente);
  return fsClean(normalizado);
}

function _normalizarConfigNo(config = {}) {
  const acoes = Array.isArray(config.acoes)
    ? config.acoes.filter((acao) => ACAO_WORKFLOW.includes(acao))
    : [];
  return fsClean({
    papeis: _normalizarPapeisWorkflow(config.papeis || {}),
    acoes: acoes.length ? Array.from(new Set(acoes)) : ['avancar'],
    formulario_id: _stringOuNull(config.formulario_id),
    sla_horas: Math.max(0, Number(config.sla_horas) || 0),
    instrucoes: String(config.instrucoes || '').trim(),
    exige_parecer: Boolean(config.exige_parecer),
    titulo_notificacao: String(config.titulo_notificacao || '').trim(),
    mensagem_notificacao: String(config.mensagem_notificacao || '').trim(),
    comentario_automatico: String(config.comentario_automatico || '').trim(),
    acoes_condicionais: Array.isArray(config.acoes_condicionais)
      ? config.acoes_condicionais.map((regra) => fsClean({
        acao: ACAO_WORKFLOW.includes(regra?.acao) ? regra.acao : 'avancar',
        campo: _stringOuNull(regra?.campo),
        operador: _stringOuNull(regra?.operador) || '=',
        valor: regra?.valor ?? null,
      }))
      : [],
    campos_condicionais: Array.isArray(config.campos_condicionais)
      ? config.campos_condicionais.map((regra) => fsClean({
        campo_id: _stringOuNull(regra?.campo_id),
        operador_logico: regra?.operador_logico === 'OR' ? 'OR' : 'AND',
        acao: ['mostrar', 'ocultar', 'obrigatorio', 'opcional'].includes(regra?.acao) ? regra.acao : 'mostrar',
        condicoes: Array.isArray(regra?.condicoes) ? regra.condicoes.map(_normalizarCondicao) : [],
      }))
      : [],
    condicoes: Array.isArray(config.condicoes) ? config.condicoes.map(_normalizarCondicao) : [],
    operador_logico: config.operador_logico === 'OR' ? 'OR' : 'AND',
    padrao: Boolean(config.padrao),
    destino_devolucao: _stringOuNull(config.destino_devolucao),
    // Campos do nó de início
    tipo_disparo: _stringOuNull(config.tipo_disparo),
    agendado_padrao: _stringOuNull(config.agendado_padrao),
    descricao: String(config.descricao || '').trim(),
    // Campos do nó de fim
    tipo_fim: _stringOuNull(config.tipo_fim),
    mensagem_fim: String(config.mensagem_fim || '').trim(),
    notificar_fim: _stringOuNull(config.notificar_fim),
  });
}

function _normalizarConfigNos(configNos = {}) {
  if (!configNos || typeof configNos !== 'object' || Array.isArray(configNos)) return {};
  return fsClean(Object.fromEntries(
    Object.entries(configNos).map(([noId, config]) => [String(noId), _normalizarConfigNo(config)])
  ));
}

function _normalizarCanvas(canvas = {}) {
  const nos = Array.isArray(canvas?.nos)
    ? canvas.nos.map((no) => fsClean({
      id: _stringOuNull(no?.id),
      nome: String(no?.nome || '').trim(),
      tipo: TIPO_ETAPA.includes(no?.tipo) ? no.tipo : 'tarefa',
      x: Number(no?.x) || 0,
      y: Number(no?.y) || 0,
      config: _normalizarConfigNo(no?.config || {}),
    })).filter((no) => no.id)
    : [];
  const arestas = Array.isArray(canvas?.arestas)
    ? canvas.arestas.map((aresta) => fsClean({
      id: _stringOuNull(aresta?.id),
      origem: _stringOuNull(aresta?.origem),
      destino: _stringOuNull(aresta?.destino),
      acao: _stringOuNull(aresta?.acao),
      label: String(aresta?.label || '').trim(),
      condicao: _stringOuNull(aresta?.condicao),
      condicoes: Array.isArray(aresta?.condicoes) ? aresta.condicoes.map(_normalizarCondicao) : [],
      operador_logico: aresta?.operador_logico === 'OR' ? 'OR' : 'AND',
      padrao: Boolean(aresta?.padrao),
    })).filter((aresta) => aresta.origem && aresta.destino)
    : [];
  return fsClean({ nos, arestas });
}

function normalizarProcessoModeloDoc(data = {}, opts = {}) {
  const { forCreate = false } = opts;
  const nome = String(data.nome || '').trim();
  const criadoPor = _stringOuNull(data.criado_por);
  if (!nome) throw Object.assign(new Error('Campo obrigatório ausente: nome'), { code: 'CAMPO_OBRIGATORIO', status: 400 });
  if (forCreate && !criadoPor) throw Object.assign(new Error('Campo obrigatório ausente: criado_por'), { code: 'CAMPO_OBRIGATORIO', status: 400 });
  const status = STATUS_MODELO.includes(data.status) ? data.status : 'rascunho';
  const fluxoOrigem = _stringOuNull(data.fluxo_origem);
  if (fluxoOrigem && !FLUXO_ORIGEM.includes(fluxoOrigem)) {
    throw Object.assign(new Error(`fluxo_origem inválido: ${fluxoOrigem}`), { code: 'TIPO_INVALIDO', status: 400 });
  }

  return fsClean({
    nome,
    descricao: String(data.descricao || '').trim(),
    versao: Math.max(1, Number(data.versao) || 1),
    status,
    etapa_inicial: _stringOuNull(data.etapa_inicial),
    criado_por: criadoPor,
    perfis_permitidos: _listaStrings(data.perfis_permitidos),
    processo_origem_id: _stringOuNull(data.processo_origem_id),
    processo_origem_nome: _stringOuNull(data.processo_origem_nome),
    fluxo_origem: fluxoOrigem,
    bpmn_xml: String(data.bpmn_xml || '').trim(),
    config_nos: _normalizarConfigNos(data.config_nos),
    canvas: _normalizarCanvas(data.canvas),
  });
}

function criarProcessoModelo({ nome, descricao, criado_por, perfis_permitidos = [] }) {
  return fsClean({
    ...normalizarProcessoModeloDoc({ nome, descricao, criado_por, perfis_permitidos }, { forCreate: true }),
    criado_em: agora(),
    atualizado_em: agora(),
  });
}

function criarEtapaModelo({
  processo_modelo_id, nome, descricao = '', ordem,
  tipo, formulario_modelo_id = null,
  responsavel_tipo, responsavel_valor = null,
  sla_horas = 0, instrucoes = '',
}) {
  _requerido({ processo_modelo_id }, 'processo_modelo_id');
  _requerido({ nome }, 'nome');
  if (!TIPO_ETAPA.includes(tipo)) throw Object.assign(new Error(`tipo inválido: ${tipo}`), { code: 'TIPO_INVALIDO', status: 400 });
  if (!RESPONSAVEL_TIPO.includes(responsavel_tipo)) throw Object.assign(new Error(`responsavel_tipo inválido`), { code: 'TIPO_INVALIDO', status: 400 });

  return fsClean({
    processo_modelo_id,
    nome: String(nome).trim(),
    descricao: String(descricao).trim(),
    ordem: Number(ordem) || 1,
    tipo,
    formulario_modelo_id: formulario_modelo_id || null,
    responsavel_tipo,
    responsavel_valor: responsavel_valor || null,
    sla_horas: Math.max(0, Number(sla_horas) || 0),
    instrucoes: String(instrucoes).trim(),
  });
}

function criarTransicaoFluxo({
  processo_modelo_id, etapa_origem_id, etapa_destino_id,
  condicao = 'sempre', label = 'Avançar',
}) {
  _requerido({ processo_modelo_id }, 'processo_modelo_id');
  _requerido({ etapa_origem_id }, 'etapa_origem_id');
  _requerido({ etapa_destino_id }, 'etapa_destino_id');
  if (!CONDICAO_TRANSICAO.includes(condicao)) throw Object.assign(new Error(`condicao inválida: ${condicao}`), { code: 'CONDICAO_INVALIDA', status: 400 });

  return fsClean({
    processo_modelo_id,
    etapa_origem_id,
    etapa_destino_id,
    condicao,
    label: String(label).trim(),
  });
}

function validarCampoSchema(campo) {
  if (!campo.id || !/^[a-z_][a-z0-9_]*$/.test(campo.id)) {
    throw Object.assign(new Error(`campo.id inválido: "${campo.id}". Use snake_case.`), { code: 'CAMPO_ID_INVALIDO', status: 400 });
  }
  if (!campo.label) throw Object.assign(new Error(`campo.label obrigatório`), { code: 'CAMPO_OBRIGATORIO', status: 400 });
  if (!TIPO_CAMPO.includes(campo.tipo)) throw Object.assign(new Error(`campo.tipo inválido: ${campo.tipo}`), { code: 'TIPO_INVALIDO', status: 400 });
  if (campo.tipo === 'select' && (!Array.isArray(campo.opcoes) || campo.opcoes.length === 0)) {
    throw Object.assign(new Error(`Campo select requer "opcoes" não vazia`), { code: 'CAMPO_INVALIDO', status: 400 });
  }
}

function criarFormularioModelo({ titulo, campos, criado_por }) {
  _requerido({ titulo }, 'titulo');
  _requerido({ criado_por }, 'criado_por');
  if (!Array.isArray(campos) || campos.length === 0) {
    throw Object.assign(new Error('Formulário requer ao menos um campo'), { code: 'CAMPO_OBRIGATORIO', status: 400 });
  }

  const ids = new Set();
  campos.forEach(c => {
    validarCampoSchema(c);
    if (ids.has(c.id)) throw Object.assign(new Error(`id de campo duplicado: ${c.id}`), { code: 'ID_DUPLICADO', status: 400 });
    ids.add(c.id);
  });

  return fsClean({
    titulo: String(titulo).trim(),
    campos,
    versao: 1,
    criado_por,
    criado_em: agora(),
  });
}

function criarInstanciaProcesso({ processo_modelo_id, processo_modelo_versao, titulo, solicitante_uid, grupo_id = null, grupo_nome = null, agendado_para = null }) {
  _requerido({ processo_modelo_id }, 'processo_modelo_id');
  _requerido({ solicitante_uid }, 'solicitante_uid');

  const statusInicial = agendado_para ? 'agendado' : 'em_andamento';
  let agendado_para_ts = null;
  if (agendado_para) {
    const d = agendado_para instanceof Date ? agendado_para : new Date(agendado_para);
    agendado_para_ts = Timestamp.fromDate(d);
  }
  return fsClean({
    processo_modelo_id,
    processo_modelo_versao: Number(processo_modelo_versao) || 1,
    titulo: titulo ? String(titulo).trim() : `Processo ${new Date().toLocaleDateString('pt-BR')}`,
    status: statusInicial,
    etapa_atual_id: null,
    solicitante_uid,
    grupo_id: _stringOuNull(grupo_id),
    grupo_nome: _stringOuNull(grupo_nome),
    dados_consolidados: {},
    iniciado_em: agendado_para ? null : agora(),
    concluido_em: null,
    prazo_geral: null,
    agendado_para: agendado_para_ts,
  });
}

function criarInstanciaProcessoMapeado({ processo_id, processo_nome, titulo, solicitante_uid, snapshot_etapas = [], fluxo_origem = null }) {
  _requerido({ processo_id }, 'processo_id');
  _requerido({ processo_nome }, 'processo_nome');
  _requerido({ solicitante_uid }, 'solicitante_uid');

  const etapas = Array.isArray(snapshot_etapas)
    ? snapshot_etapas
      .map((etapa, index) => fsClean({
        id: _stringOuNull(etapa?.id) || `${processo_id}_${index}`,
        nome: String(etapa?.nome || `Etapa ${index + 1}`).trim(),
        tipo: _stringOuNull(etapa?.tipo) || 'Atividade',
        desc: _stringOuNull(etapa?.desc),
        executor: _stringOuNull(etapa?.executor),
        modo: _stringOuNull(etapa?.modo) || 'Manual',
        natureza: _stringOuNull(etapa?.natureza),
        sla_horas: Math.max(0, Number(etapa?.sla_horas) || 0),
      }))
      .filter((etapa) => etapa.id)
    : [];

  return fsClean({
    processo_id: _stringOuNull(processo_id),
    processo_nome: String(processo_nome).trim(),
    titulo: titulo ? String(titulo).trim() : `Processo ${new Date().toLocaleDateString('pt-BR')}`,
    status: 'em_andamento',
    etapa_atual_id: etapas[0]?.id || null,
    solicitante_uid,
    snapshot_etapas: etapas,
    fluxo_origem: FLUXO_ORIGEM.includes(fluxo_origem) ? fluxo_origem : null,
    dados_consolidados: {},
    iniciado_em: agora(),
    concluido_em: null,
    prazo_geral: null,
  });
}

function criarTarefaWorkflow({ instancia_id, etapa_modelo_id, responsavel_uid, prazo }) {
  _requerido({ instancia_id }, 'instancia_id');
  _requerido({ etapa_modelo_id }, 'etapa_modelo_id');
  _requerido({ responsavel_uid }, 'responsavel_uid');

  return fsClean({
    instancia_id,
    etapa_modelo_id,
    responsavel_uid,
    status: 'pendente',
    prazo: prazo || null,
    criado_em: agora(),
    iniciado_em: null,
    concluido_em: null,
    dados_formulario: {},
    acao_tomada: null,
    observacao: null,
  });
}

function criarHistoricoWorkflow({ instancia_id, tipo_evento, usuario_uid = null, etapa_id = null, tarefa_id = null, descricao, dados = {} }) {
  _requerido({ instancia_id }, 'instancia_id');
  if (!TIPO_EVENTO.includes(tipo_evento)) throw Object.assign(new Error(`tipo_evento inválido: ${tipo_evento}`), { code: 'TIPO_INVALIDO', status: 400 });

  return fsClean({
    instancia_id,
    tipo_evento,
    usuario_uid: usuario_uid || null,
    etapa_id: etapa_id || null,
    tarefa_id: tarefa_id || null,
    descricao: String(descricao).trim(),
    dados,
    ocorrido_em: agora(),
  });
}

function criarNotificacao({ destinatario_uid, tipo, titulo, mensagem, instancia_id, tarefa_id = null }) {
  _requerido({ destinatario_uid }, 'destinatario_uid');
  if (!TIPO_NOTIFICACAO.includes(tipo)) throw Object.assign(new Error(`tipo de notificação inválido: ${tipo}`), { code: 'TIPO_INVALIDO', status: 400 });

  return fsClean({
    destinatario_uid,
    tipo,
    titulo: String(titulo).trim(),
    mensagem: String(mensagem).trim(),
    instancia_id: instancia_id || null,
    tarefa_id: tarefa_id || null,
    lida: false,
    criado_em: agora(),
  });
}

module.exports = {
  STATUS_MODELO,
  TIPO_ETAPA,
  RESPONSAVEL_TIPO,
  STATUS_INSTANCIA,
  STATUS_TAREFA,
  TIPO_CAMPO,
  CONDICAO_TRANSICAO,
  TIPO_NOTIFICACAO,
  TIPO_EVENTO,
  ACAO_WORKFLOW,
  PAPEL_WORKFLOW,
  criarProcessoModelo,
  normalizarProcessoModeloDoc,
  criarEtapaModelo,
  criarTransicaoFluxo,
  criarFormularioModelo,
  criarInstanciaProcesso,
  criarInstanciaProcessoMapeado,
  criarTarefaWorkflow,
  criarHistoricoWorkflow,
  criarNotificacao,
  fsClean,
  agora,
};
