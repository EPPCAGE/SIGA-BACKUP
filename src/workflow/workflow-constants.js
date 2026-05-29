(function initWorkflowConstants(globalScope) {
  'use strict';

  const STATUS_PROCESSO_MODELO = Object.freeze({
    RASCUNHO: 'rascunho',
    PUBLICADO: 'publicado',
    ARQUIVADO: 'arquivado',
  });

  const STATUS_PROCESSO_MODELO_LABELS = Object.freeze({
    rascunho: 'Rascunho',
    publicado: 'Publicado',
    arquivado: 'Arquivado',
  });

  const STATUS_PROCESSO_MODELO_COR = Object.freeze({
    rascunho: '#f59e0b',
    publicado: '#10b981',
    arquivado: '#6b7280',
  });

  const TIPO_ETAPA = Object.freeze({
    INICIO: 'inicio',
    TAREFA: 'tarefa',
    APROVACAO: 'aprovacao',
    FIM: 'fim',
  });

  const TIPO_ETAPA_LABELS = Object.freeze({
    inicio: 'Início',
    tarefa: 'Tarefa',
    aprovacao: 'Aprovação',
    fim: 'Fim',
  });

  const TIPO_ETAPA_ICONE = Object.freeze({
    inicio: '▶',
    tarefa: '📋',
    aprovacao: '✅',
    fim: '⏹',
  });

  const RESPONSAVEL_TIPO = Object.freeze({
    PERFIL: 'perfil',
    USUARIO_ESPECIFICO: 'usuario_especifico',
    SOLICITANTE: 'solicitante',
  });

  const RESPONSAVEL_TIPO_LABELS = Object.freeze({
    perfil: 'Perfil do sistema',
    usuario_especifico: 'Usuário específico',
    solicitante: 'Próprio solicitante',
  });

  const STATUS_INSTANCIA = Object.freeze({
    EM_ANDAMENTO: 'em_andamento',
    CONCLUIDO: 'concluido',
    CANCELADO: 'cancelado',
    SUSPENSO: 'suspenso',
  });

  const STATUS_INSTANCIA_LABELS = Object.freeze({
    em_andamento: 'Em Andamento',
    concluido: 'Concluído',
    cancelado: 'Cancelado',
    suspenso: 'Suspenso',
  });

  const STATUS_INSTANCIA_COR = Object.freeze({
    em_andamento: '#3b82f6',
    concluido: '#10b981',
    cancelado: '#ef4444',
    suspenso: '#f59e0b',
  });

  const STATUS_TAREFA = Object.freeze({
    PENDENTE: 'pendente',
    EM_EXECUCAO: 'em_execucao',
    CONCLUIDA: 'concluida',
    CANCELADA: 'cancelada',
    VENCIDA: 'vencida',
  });

  const STATUS_TAREFA_LABELS = Object.freeze({
    pendente: 'Pendente',
    em_execucao: 'Em Execução',
    concluida: 'Concluída',
    cancelada: 'Cancelada',
    vencida: 'Vencida',
  });

  const STATUS_TAREFA_COR = Object.freeze({
    pendente: '#f59e0b',
    em_execucao: '#3b82f6',
    concluida: '#10b981',
    cancelada: '#6b7280',
    vencida: '#ef4444',
  });

  const STATUS_SLA = Object.freeze({
    SEM_SLA: 'sem_sla',
    NO_PRAZO: 'no_prazo',
    VENCENDO: 'vencendo',
    VENCIDO: 'vencido',
  });

  const STATUS_SLA_LABELS = Object.freeze({
    sem_sla: 'Sem SLA',
    no_prazo: 'No Prazo',
    vencendo: 'Vencendo',
    vencido: 'Vencido',
  });

  const STATUS_SLA_COR = Object.freeze({
    sem_sla: '#6b7280',
    no_prazo: '#10b981',
    vencendo: '#f59e0b',
    vencido: '#ef4444',
  });

  const TIPO_CAMPO_FORMULARIO = Object.freeze({
    TEXTO: 'texto',
    TEXTAREA: 'textarea',
    NUMERO: 'numero',
    DATA: 'data',
    SELECT: 'select',
    CHECKBOX: 'checkbox',
    ANEXO: 'anexo',
  });

  const TIPO_CAMPO_FORMULARIO_LABELS = Object.freeze({
    texto: 'Texto curto',
    textarea: 'Texto longo',
    numero: 'Número',
    data: 'Data',
    select: 'Seleção',
    checkbox: 'Caixa de seleção',
    anexo: 'Anexo',
  });

  const TIPO_EVENTO_HISTORICO = Object.freeze({
    INSTANCIA_CRIADA: 'instancia_criada',
    TAREFA_CRIADA: 'tarefa_criada',
    TAREFA_INICIADA: 'tarefa_iniciada',
    TAREFA_CONCLUIDA: 'tarefa_concluida',
    ETAPA_AVANCADA: 'etapa_avancada',
    INSTANCIA_CONCLUIDA: 'instancia_concluida',
    INSTANCIA_CANCELADA: 'instancia_cancelada',
    SLA_ALERTA: 'sla_alerta',
    SLA_VENCIDO: 'sla_vencido',
  });

  const TIPO_EVENTO_HISTORICO_LABELS = Object.freeze({
    instancia_criada: 'Processo iniciado',
    tarefa_criada: 'Tarefa criada',
    tarefa_iniciada: 'Tarefa iniciada',
    tarefa_concluida: 'Tarefa concluída',
    etapa_avancada: 'Etapa avançada',
    instancia_concluida: 'Processo concluído',
    instancia_cancelada: 'Processo cancelado',
    sla_alerta: 'Alerta de prazo',
    sla_vencido: 'Prazo vencido',
  });

  const TIPO_NOTIFICACAO = Object.freeze({
    TAREFA_CRIADA: 'tarefa_criada',
    PRAZO_PROXIMO: 'prazo_proximo',
    TAREFA_VENCIDA: 'tarefa_vencida',
    TAREFA_CONCLUIDA: 'tarefa_concluida',
  });

  const CONDICAO_TRANSICAO = Object.freeze({
    SEMPRE: 'sempre',
    APROVADO: 'aprovado',
    REJEITADO: 'rejeitado',
  });

  // Ações que podem ser tomadas numa etapa e que rotulam as transições
  const ACAO = Object.freeze({
    AVANCAR: 'avancar',
    CONCLUIR: 'concluir',
    APROVAR: 'aprovar',
    REJEITAR: 'rejeitar',
    DEVOLVER: 'devolver',
    SOLICITAR_AJUSTE: 'solicitar_ajuste',
  });

  const ACAO_LABELS = Object.freeze({
    avancar: 'Avançar',
    concluir: 'Concluir',
    aprovar: 'Aprovar',
    rejeitar: 'Rejeitar',
    devolver: 'Devolver',
    solicitar_ajuste: 'Solicitar ajuste',
  });

  const ACAO_COR = Object.freeze({
    avancar: '#3b82f6',
    concluir: '#10b981',
    aprovar: '#10b981',
    rejeitar: '#ef4444',
    devolver: '#f59e0b',
    solicitar_ajuste: '#8b5cf6',
  });

  // Papéis por etapa
  const PAPEL = Object.freeze({
    EXECUTOR: 'executor',
    REVISOR: 'revisor',
    APROVADOR: 'aprovador',
  });

  const PAPEL_LABELS = Object.freeze({
    executor: 'Executor',
    revisor: 'Revisor',
    aprovador: 'Aprovador',
  });

  // Valores possíveis para atribuição de um papel
  const PAPEL_ALVO_LABELS = Object.freeze({
    solicitante: 'Próprio solicitante',
    ep: 'Perfil EP',
    gestor: 'Perfil Gestor',
    dono: 'Perfil Dono',
  });

  // Horas antes do prazo para emitir alerta de SLA
  const SLA_ALERTA_HORAS = 2;

  Object.assign(globalScope, {
    WF_STATUS_PROCESSO_MODELO: STATUS_PROCESSO_MODELO,
    WF_STATUS_PROCESSO_MODELO_LABELS: STATUS_PROCESSO_MODELO_LABELS,
    WF_STATUS_PROCESSO_MODELO_COR: STATUS_PROCESSO_MODELO_COR,
    WF_TIPO_ETAPA: TIPO_ETAPA,
    WF_TIPO_ETAPA_LABELS: TIPO_ETAPA_LABELS,
    WF_TIPO_ETAPA_ICONE: TIPO_ETAPA_ICONE,
    WF_RESPONSAVEL_TIPO: RESPONSAVEL_TIPO,
    WF_RESPONSAVEL_TIPO_LABELS: RESPONSAVEL_TIPO_LABELS,
    WF_STATUS_INSTANCIA: STATUS_INSTANCIA,
    WF_STATUS_INSTANCIA_LABELS: STATUS_INSTANCIA_LABELS,
    WF_STATUS_INSTANCIA_COR: STATUS_INSTANCIA_COR,
    WF_STATUS_TAREFA: STATUS_TAREFA,
    WF_STATUS_TAREFA_LABELS: STATUS_TAREFA_LABELS,
    WF_STATUS_TAREFA_COR: STATUS_TAREFA_COR,
    WF_STATUS_SLA: STATUS_SLA,
    WF_STATUS_SLA_LABELS: STATUS_SLA_LABELS,
    WF_STATUS_SLA_COR: STATUS_SLA_COR,
    WF_TIPO_CAMPO: TIPO_CAMPO_FORMULARIO,
    WF_TIPO_CAMPO_LABELS: TIPO_CAMPO_FORMULARIO_LABELS,
    WF_TIPO_EVENTO: TIPO_EVENTO_HISTORICO,
    WF_TIPO_EVENTO_LABELS: TIPO_EVENTO_HISTORICO_LABELS,
    WF_TIPO_NOTIFICACAO: TIPO_NOTIFICACAO,
    WF_CONDICAO_TRANSICAO: CONDICAO_TRANSICAO,
    WF_ACAO: ACAO,
    WF_ACAO_LABELS: ACAO_LABELS,
    WF_ACAO_COR: ACAO_COR,
    WF_PAPEL: PAPEL,
    WF_PAPEL_LABELS: PAPEL_LABELS,
    WF_PAPEL_ALVO_LABELS: PAPEL_ALVO_LABELS,
    WF_SLA_ALERTA_HORAS: SLA_ALERTA_HORAS,
  });
})(globalThis);
