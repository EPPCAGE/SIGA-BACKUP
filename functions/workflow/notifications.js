'use strict';

const { criarNotificacao } = require('./entities');

/**
 * Dispara notificações internas (coleção wf_notificacoes).
 * Integra com EmailJS via Firestore trigger (mesmo padrão do sistema existente).
 */

/**
 * @param {import('firebase-admin/firestore').Firestore} db
 */
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

  async function instanciaConcluida({ instancia }) {
    return _salvar(criarNotificacao({
      destinatario_uid: instancia.solicitante_uid,
      tipo: 'tarefa_concluida',
      titulo: `Processo concluído`,
      mensagem: `O processo "${instancia.titulo}" foi concluído com sucesso.`,
      instancia_id: instancia.id,
    }));
  }

  return { tarefaCriada, prazoProximo, tarefaVencida, instanciaConcluida };
}

module.exports = { makeNotificacoes };
