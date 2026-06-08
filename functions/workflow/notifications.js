'use strict';

const { criarNotificacao } = require('./entities');

function makeNotificacoes(db) {
  const col = db.collection('wf_notificacoes');

  async function _salvar(payload) {
    const doc = await col.add(payload);
    return doc.id;
  }

  async function tarefaCriada({ destinatario_uid, instancia, tarefa, etapa }) {
    return _salvar(criarNotificacao({
      destinatario_uid,
      tipo: 'tarefa_criada',
      titulo: `Nova tarefa: ${etapa.nome}`,
      mensagem: `Uma nova tarefa do processo "${instancia.titulo}" foi atribuída a você. Prazo: ${tarefa.prazo ? new Date(tarefa.prazo.toDate()).toLocaleString('pt-BR') : 'sem prazo definido'}.`,
      instancia_id: instancia.id,
      tarefa_id: tarefa.id,
    }));
  }

  async function tarefaConcluida({ destinatario_uid, instancia, tarefa, concluida_por_nome = null }) {
    const por = concluida_por_nome ? ` por ${concluida_por_nome}` : '';
    return _salvar(criarNotificacao({
      destinatario_uid,
      tipo: 'tarefa_concluida',
      titulo: `Etapa concluída: ${tarefa.etapa_nome}`,
      mensagem: `A etapa "${tarefa.etapa_nome}" do processo "${instancia.titulo || tarefa.processo_nome}" foi concluída${por}.`,
      instancia_id: instancia.id || tarefa.instancia_id,
      tarefa_id: tarefa.id,
    }));
  }

  async function prazoProximo({ destinatario_uid, instancia, tarefa, etapa }) {
    return _salvar(criarNotificacao({
      destinatario_uid,
      tipo: 'prazo_proximo',
      titulo: `Prazo se encerrando: ${etapa.nome}`,
      mensagem: `A tarefa "${etapa.nome}" no processo "${instancia.titulo}" vence em menos de 2 horas.`,
      instancia_id: instancia.id,
      tarefa_id: tarefa.id,
    }));
  }

  async function tarefaVencida({ destinatario_uid, instancia, tarefa, etapa }) {
    return _salvar(criarNotificacao({
      destinatario_uid,
      tipo: 'tarefa_vencida',
      titulo: `Tarefa vencida: ${etapa.nome}`,
      mensagem: `A tarefa "${etapa.nome}" no processo "${instancia.titulo}" ultrapassou o prazo sem ser concluída.`,
      instancia_id: instancia.id,
      tarefa_id: tarefa.id,
    }));
  }

  async function cienciaEtapa({ destinatario_uid, instancia, etapa }) {
    return _salvar(criarNotificacao({
      destinatario_uid,
      tipo: 'tarefa_criada',
      titulo: `Ciência: ${etapa.nome}`,
      mensagem: `Processo "${instancia.titulo}" chegou à etapa "${etapa.nome}".`,
      instancia_id: instancia.id,
    }));
  }

  async function instanciaConcluida({ instancia }) {
    return _salvar(criarNotificacao({
      destinatario_uid: instancia.solicitante_uid,
      tipo: 'tarefa_concluida',
      titulo: `Processo concluído`,
      mensagem: `O processo "${instancia.titulo}" foi concluído com sucesso.`,
      instancia_id: instancia.id,
    }));
  }

  async function tarefaDelegada({ destinatario_uid, tarefa, motivo = '' }) {
    return _salvar(criarNotificacao({
      destinatario_uid,
      tipo: 'tarefa_delegada',
      titulo: `Tarefa delegada: ${tarefa.etapa_nome}`,
      mensagem: `A tarefa "${tarefa.etapa_nome}" do processo "${tarefa.processo_nome}" foi delegada a você.${motivo ? ` Motivo: ${motivo}` : ''}`,
      instancia_id: tarefa.instancia_id,
      tarefa_id: tarefa.id,
    }));
  }

  async function tarefaRetirada({ destinatario_uid, tarefa, retirada_por_nome = 'o administrador' }) {
    return _salvar(criarNotificacao({
      destinatario_uid,
      tipo: 'tarefa_delegada',
      titulo: `Tarefa reatribuída: ${tarefa.etapa_nome}`,
      mensagem: `A tarefa "${tarefa.etapa_nome}" do processo "${tarefa.processo_nome}" foi retirada da sua fila por ${retirada_por_nome} e reatribuída a outro responsável.`,
      instancia_id: tarefa.instancia_id,
      tarefa_id: tarefa.id,
    }));
  }

  return { tarefaCriada, tarefaConcluida, prazoProximo, tarefaVencida, cienciaEtapa, instanciaConcluida, tarefaDelegada, tarefaRetirada };
}

module.exports = { makeNotificacoes };
