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

// Remove prototype pollution e valores indefinidos
function fsClean(obj) {
  return JSON.parse(JSON.stringify(obj));
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
const TIPO_NOTIFICACAO = ['tarefa_criada', 'prazo_proximo', 'tarefa_vencida', 'tarefa_concluida'];
const TIPO_EVENTO = [
  'instancia_criada', 'tarefa_criada', 'tarefa_iniciada', 'tarefa_concluida',
  'etapa_avancada', 'instancia_concluida', 'instancia_cancelada', 'sla_alerta', 'sla_vencido',
];

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function criarProcessoModelo({ nome, descricao, criado_por, perfis_permitidos = [] }) {
  _requerido({ nome, criado_por }, 'nome');
  _requerido({ nome, criado_por }, 'criado_por');

  return fsClean({
    nome: String(nome).trim(),
    descricao: descricao ? String(descricao).trim() : '',
    versao: 1,
    status: 'rascunho',
    etapa_inicial: null,
    criado_por,
    perfis_permitidos: Array.isArray(perfis_permitidos) ? perfis_permitidos : [],
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

function criarInstanciaProcesso({ processo_modelo_id, processo_modelo_versao, titulo, solicitante_uid }) {
  _requerido({ processo_modelo_id }, 'processo_modelo_id');
  _requerido({ solicitante_uid }, 'solicitante_uid');

  return fsClean({
    processo_modelo_id,
    processo_modelo_versao: Number(processo_modelo_versao) || 1,
    titulo: titulo ? String(titulo).trim() : `Processo ${new Date().toLocaleDateString('pt-BR')}`,
    status: 'em_andamento',
    etapa_atual_id: null,
    solicitante_uid,
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
  criarProcessoModelo,
  criarEtapaModelo,
  criarTransicaoFluxo,
  criarFormularioModelo,
  criarInstanciaProcesso,
  criarTarefaWorkflow,
  criarHistoricoWorkflow,
  criarNotificacao,
  fsClean,
  agora,
};
