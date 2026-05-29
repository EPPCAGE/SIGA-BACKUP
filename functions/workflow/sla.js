'use strict';

/**
 * Cálculo de SLA em horas úteis.
 * Considera: segunda a sexta, 08h–18h (horário de Brasília).
 * Feriados nacionais fixos do ano corrente são excluídos.
 */

const HORA_INICIO = 8;
const HORA_FIM = 18;
const HORAS_UTEIS_DIA = HORA_FIM - HORA_INICIO;
const ALERTA_HORAS_ANTES = 2;

// Feriados nacionais fixos (MM-DD)
const FERIADOS_FIXOS = new Set([
  '01-01', '04-21', '05-01', '09-07',
  '10-12', '11-02', '11-15', '11-20', '12-25',
]);

function _ehFeriado(data) {
  const mmdd = `${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`;
  return FERIADOS_FIXOS.has(mmdd);
}

function _ehDiaUtil(data) {
  const dia = data.getDay(); // 0=dom, 6=sab
  return dia !== 0 && dia !== 6 && !_ehFeriado(data);
}

/**
 * Adiciona `horas` horas úteis a `dataInicio` (Date JS).
 * @param {Date} dataInicio
 * @param {number} horas
 * @returns {Date}
 */
function adicionarHorasUteis(dataInicio, horas) {
  if (horas <= 0) return dataInicio;

  // Trabalha em minutos para precisão
  let minutosRestantes = horas * 60;
  let atual = new Date(dataInicio.getTime());

  // Avança para o próximo horário útil se fora do expediente
  atual = _proxHorarioUtil(atual);

  while (minutosRestantes > 0) {
    const fimDoDia = new Date(atual);
    fimDoDia.setHours(HORA_FIM, 0, 0, 0);

    const minutosAteOFim = Math.max(0, (fimDoDia - atual) / 60000);

    if (minutosRestantes <= minutosAteOFim) {
      atual = new Date(atual.getTime() + minutosRestantes * 60000);
      minutosRestantes = 0;
    } else {
      minutosRestantes -= minutosAteOFim;
      // Vai para o próximo dia útil
      atual.setDate(atual.getDate() + 1);
      atual.setHours(HORA_INICIO, 0, 0, 0);
      while (!_ehDiaUtil(atual)) {
        atual.setDate(atual.getDate() + 1);
      }
    }
  }

  return atual;
}

function _proxHorarioUtil(data) {
  const d = new Date(data.getTime());

  // Avança para dia útil se necessário
  while (!_ehDiaUtil(d)) {
    d.setDate(d.getDate() + 1);
    d.setHours(HORA_INICIO, 0, 0, 0);
  }

  const h = d.getHours();
  if (h < HORA_INICIO) {
    d.setHours(HORA_INICIO, 0, 0, 0);
  } else if (h >= HORA_FIM) {
    d.setDate(d.getDate() + 1);
    d.setHours(HORA_INICIO, 0, 0, 0);
    while (!_ehDiaUtil(d)) {
      d.setDate(d.getDate() + 1);
    }
  }
  return d;
}

/**
 * Calcula o prazo de uma tarefa a partir do momento de criação.
 * @param {Date|import('firebase-admin/firestore').Timestamp} criado_em
 * @param {number} sla_horas
 * @returns {import('firebase-admin/firestore').Timestamp|null}
 */
function calcularPrazo(criado_em, sla_horas) {
  if (!sla_horas || sla_horas <= 0) return null;

  const { Timestamp } = require('firebase-admin/firestore');
  const base = criado_em instanceof Date ? criado_em : criado_em.toDate();
  const prazo = adicionarHorasUteis(base, sla_horas);
  return Timestamp.fromDate(prazo);
}

/**
 * Retorna o status de SLA de uma tarefa.
 * @param {object} tarefa - TarefaWorkflow
 * @returns {'sem_sla'|'no_prazo'|'vencendo'|'vencido'}
 */
function calcularStatusSla(tarefa) {
  if (!tarefa.prazo) return 'sem_sla';

  const agora = new Date();
  const prazo = tarefa.prazo instanceof Date ? tarefa.prazo : tarefa.prazo.toDate();
  const alertaMs = ALERTA_HORAS_ANTES * 60 * 60 * 1000;

  if (agora > prazo) return 'vencido';
  if (agora >= new Date(prazo.getTime() - alertaMs)) return 'vencendo';
  return 'no_prazo';
}

/**
 * Verifica se uma tarefa deve receber alerta de prazo próximo.
 * @param {object} tarefa
 * @returns {boolean}
 */
function deveEmitirAlertaSla(tarefa) {
  if (!tarefa.prazo) return false;
  if (['concluida', 'cancelada', 'vencida'].includes(tarefa.status)) return false;
  return calcularStatusSla(tarefa) === 'vencendo';
}

module.exports = { calcularPrazo, calcularStatusSla, deveEmitirAlertaSla, adicionarHorasUteis };
