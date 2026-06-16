(function initWorkflowUiContract(globalScope) {
  'use strict';

  const REQUIRED_IDS = Object.freeze([
    'wf-tab-tarefas',
    'wf-tab-instancias',
    'wf-tab-solicitacoes',
    'wf-tab-modelagem',
    'wf-tab-formularios',
    'wf-tab-equipes',
    'wf-painel-tarefas',
    'wf-painel-instancias',
    'wf-painel-solicitacoes',
    'wf-painel-iniciar',
    'wf-painel-modelagem',
    'wf-painel-config-modelo',
    'wf-painel-formularios',
    'wf-painel-notificacoes',
    'wf-painel-equipes',
    'wf-painel-executar',
    'wf-painel-historico',
    'wf-lista-tarefas',
    'wf-lista-instancias',
    'wf-lista-solicitacoes',
    'wf-lista-modelos',
    'wf-lista-formularios',
    'wf-lista-grupos',
    'wf-lista-equipes-usuarios',
    'wf-notif-lista',
    'wf-modal-formulario',
    'wf-modal-grupo',
    'wf-modal-delegacao',
    'wf-modal-inicio-form',
    'wf-modal-simulacao',
  ]);

  function validateWorkflowUiContract(options) {
    const opts = options || {};
    const strict = opts.strict === true;
    const missing = REQUIRED_IDS.filter(id => !document.getElementById(id));
    if (!missing.length) return { ok: true, missing: [] };

    const msg = `[WF][UI-CONTRACT] IDs ausentes: ${missing.join(', ')}`;
    if (strict) {
      throw new Error(msg);
    }
    console.warn(msg);
    return { ok: false, missing };
  }

  globalScope.WF_UI_REQUIRED_IDS = REQUIRED_IDS;
  globalScope.wfValidateWorkflowUIContract = validateWorkflowUiContract;
})(globalThis);
