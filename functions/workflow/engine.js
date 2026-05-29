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
  };

  // -------------------------------------------------------------------------
  // Helpers internos
  // -------------------------------------------------------------------------

  async function _buscarDoc(colRef, id, erro) {
    const snap = await colRef.doc(id).get();
    if (!snap.exists) lancarErro(erro, `Documento ${id} não encontrado`);
    return { id: snap.id, ...snap.data() };
  }

  async function _registrarHistorico(instancia_id, tipo_evento, usuario_uid, etapa_id, tarefa_id, descricao, dados) {
    const entry = criarHistoricoWorkflow({ instancia_id, tipo_evento, usuario_uid, etapa_id, tarefa_id, descricao, dados });
    const ref = await col.historico.add(entry);
    return ref.id;
  }

  /**
   * Resolve o UID do responsável por uma etapa.
   * - 'solicitante': usa o UID do solicitante da instância
   * - 'perfil': em Fase 1, usa o primeiro usuário com aquele perfil (ou o EP)
   * - 'usuario_especifico': usa o UID configurado diretamente
   */
  async function _resolverResponsavel(etapa, instancia) {
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

  async function _criarTarefa(instancia, etapa) {
    const responsavelUid = await _resolverResponsavel(etapa, instancia);
    const prazo = calcularPrazo(agora(), etapa.sla_horas);

    const tarefaData = criarTarefaWorkflow({
      instancia_id: instancia.id,
      etapa_modelo_id: etapa.id,
      responsavel_uid: responsavelUid,
      prazo,
    });

    const ref = await col.tarefas.add(tarefaData);
    const tarefa = { id: ref.id, ...tarefaData };

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
  async function iniciarInstancia({ processo_modelo_id, titulo, solicitante_uid }) {
    const modelo = await _buscarDoc(col.modelos, processo_modelo_id, ERRO.MODELO_NAO_ENCONTRADO);
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
    });

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
      { processo_modelo_id, versao: modelo.versao },
    );

    // Busca etapa inicial e cria a primeira tarefa
    const etapaInicial = await _buscarDoc(col.etapas, modelo.etapa_inicial, ERRO.ETAPA_NAO_ENCONTRADA);
    await col.instancias.doc(instancia.id).update({ etapa_atual_id: etapaInicial.id });
    instancia.etapa_atual_id = etapaInicial.id;

    await _criarTarefa(instancia, etapaInicial);

    return instancia;
  }

  /**
   * Marca tarefa como em execução (usuário abriu a tela).
   */
  async function iniciarTarefa({ tarefa_id, usuario_uid }) {
    const tarefa = await _buscarDoc(col.tarefas, tarefa_id, ERRO.TAREFA_NAO_ENCONTRADA);
    if (tarefa.responsavel_uid !== usuario_uid) lancarErro(ERRO.SEM_PERMISSAO, 'Tarefa pertence a outro usuário.');
    if (!['pendente'].includes(tarefa.status)) return tarefa; // idempotente

    await col.tarefas.doc(tarefa_id).update({ status: 'em_execucao', iniciado_em: agora() });
    const instancia = await _buscarDoc(col.instancias, tarefa.instancia_id, ERRO.INSTANCIA_NAO_ENCONTRADA);

    await _registrarHistorico(
      tarefa.instancia_id, 'tarefa_iniciada', usuario_uid,
      tarefa.etapa_modelo_id, tarefa_id,
      `Tarefa iniciada pelo responsável.`, {},
    );

    return { ...tarefa, status: 'em_execucao' };
  }

  /**
   * Conclui uma tarefa, valida o formulário e avança o fluxo.
   */
  async function concluirTarefa({ tarefa_id, usuario_uid, acao, observacao = '', dados_formulario = {} }) {
    const tarefa = await _buscarDoc(col.tarefas, tarefa_id, ERRO.TAREFA_NAO_ENCONTRADA);

    if (tarefa.responsavel_uid !== usuario_uid) lancarErro(ERRO.SEM_PERMISSAO, 'Tarefa pertence a outro usuário.');
    if (['concluida', 'cancelada'].includes(tarefa.status)) lancarErro(ERRO.TAREFA_JA_CONCLUIDA, 'Tarefa já foi concluída.');

    const instancia = await _buscarDoc(col.instancias, tarefa.instancia_id, ERRO.INSTANCIA_NAO_ENCONTRADA);
    if (instancia.status !== 'em_andamento') lancarErro(ERRO.INSTANCIA_NAO_ATIVA, 'Instância não está ativa.');

    const etapa = await _buscarDoc(col.etapas, tarefa.etapa_modelo_id, ERRO.ETAPA_NAO_ENCONTRADA);

    // Valida campos obrigatórios do formulário
    if (etapa.formulario_modelo_id) {
      const form = await _buscarDoc(col.formularios, etapa.formulario_modelo_id, { code: 'FORMULARIO_NAO_ENCONTRADO', status: 404 });
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

    const proxEtapa = await _buscarDoc(col.etapas, transicao.etapa_destino_id, ERRO.ETAPA_NAO_ENCONTRADA);

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
  async function cancelarInstancia({ instancia_id, usuario_uid, motivo = '' }) {
    const instancia = await _buscarDoc(col.instancias, instancia_id, ERRO.INSTANCIA_NAO_ENCONTRADA);
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

  return { iniciarInstancia, iniciarTarefa, concluirTarefa, cancelarInstancia, processarSla };
}

module.exports = { makeEngine };
