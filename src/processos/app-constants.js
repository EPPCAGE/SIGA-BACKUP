(function initAppConstants(globalScope){
  globalScope.PERFIL_LABELS = {
    ep: globalScope.ORG_CONFIG.epProfileLabel,
    dono: 'Processos',
    gestor: 'Gestor / Adjunto',
    gerente_projeto: 'Projetos',
    solicitante: 'Solicitante',
  };

  globalScope.PERFIL_COR = {
    ep: '#1A5DC8',
    dono: '#0A7060',
    gestor: '#A85C00',
    gerente_projeto: '#7c3aed',
    solicitante: '#0891b2',
  };

  globalScope.PERFIL = Object.freeze({
    EP: 'ep',
    DONO: 'dono',
    GESTOR: 'gestor',
    GERENTE_PROJETO: 'gerente_projeto',
    SOLICITANTE: 'solicitante',
  });

  globalScope.STATUS_ENTREGA = Object.freeze({
    EM_DIA: 'em_dia',
    COM_ATRASO: 'com_atraso',
    SEM_PRAZO: 'sem_prazo',
  });

  globalScope.STATUS_PLANO = Object.freeze({
    PENDENTE: 'pendente',
    EM_ANDAMENTO: 'em_andamento',
    CONCLUIDO: 'concluido',
    CANCELADO: 'cancelado',
    PAUSADO: 'pausado',
  });

  globalScope.MATURIDADE_LABELS = Object.freeze([
    '',
    'Inicial',
    'Gerenciado',
    'Padronizado',
    'Quantitativo',
    'Otimizado',
  ]);

  globalScope.REUNIAO_TIPOS = Object.freeze({
    reuniao_entendimento: 'Reunião de entendimento',
    reuniao_valid_asis: 'Validação AS IS',
    reuniao_valid_tobe: 'Validação TO BE',
    elaboracao_asis: 'Elaboração AS IS',
    elaboracao_tobe: 'Elaboração TO BE',
    reuniao_complement: 'Complementação',
    reuniao_apresentacao: 'Aprovação pelo Gestor',
    acompanhamento: 'Acompanhamento',
    outra: 'Outra reunião',
  });
})(globalThis);
