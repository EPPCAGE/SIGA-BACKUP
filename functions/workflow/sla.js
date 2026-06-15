'use strict';

/**
 * Cálculo de SLA em horas úteis.
 * Considera: segunda a sexta, 08h–18h (horário de Brasília, UTC-3).
 * Feriados nacionais fixos do ano corrente são excluídos.
 *
 * Todas as comparações de hora/dia usam a hora local de Brasília (UTC-3).
 * O Brasil não adota horário de verão desde 2019, portanto o offset é fixo.
 */

const HORA_INICIO = 8;
const HORA_FIM = 18;
const HORAS_UTEIS_DIA = HORA_FIM - HORA_INICIO;
const ALERTA_HORAS_ANTES = 2;

// UTC-3 fixo (Brasil parou horário de verão em 2019)
const BRASIL_OFFSET_MS = -3 * 60 * 60 * 1000;

// Feriados nacionais fixos (MM-DD)
const FERIADOS_FIXOS = new Set([
  '01-01', // Confraternização Universal
  '04-21', // Tiradentes
  '05-01', // Dia do Trabalho
  '09-07', // Independência
  '10-12', // Nossa Senhora Aparecida
  '11-02', // Finados
  '11-15', // Proclamação da República
  '11-20', // Consciência Negra
  '12-25', // Natal
]);

/**
 * Converte um Date UTC para um "Date" cujos métodos getUTC* retornam a hora
 * local de Brasília. Usando essa convenção, getUTCHours() = hora em Brasília.
 */
function _brasilDate(data) {
  return new Date(data.getTime() + BRASIL_OFFSET_MS);
}

/**
 * Cria um Date UTC correspondente a hora:min:00 no mesmo dia-calendário de
 * Brasília que `data`.
 */
function _setBrasilHora(data, hora, min = 0) {
  const bd = _brasilDate(data);
  bd.setUTCHours(hora, min, 0, 0);
  return new Date(bd.getTime() - BRASIL_OFFSET_MS);
}

function _ehFeriado(data) {
  const bd = _brasilDate(data);
  const mmdd = `${String(bd.getUTCMonth() + 1).padStart(2, '0')}-${String(bd.getUTCDate()).padStart(2, '0')}`;
  return FERIADOS_FIXOS.has(mmdd);
}

function _ehDiaUtil(data) {
  const dia = _brasilDate(data).getUTCDay(); // 0=dom, 6=sab
  return dia !== 0 && dia !== 6 && !_ehFeriado(data);
}

/**
 * Avança `data` para o próximo minuto dentro do expediente útil de Brasília.
 * Se já está no expediente, retorna o mesmo instante.
 */
function _proxHorarioUtil(data) {
  let d = new Date(data);

  // Garante que estamos num dia útil
  while (!_ehDiaUtil(d)) {
    d = _setBrasilHora(d, HORA_INICIO);
    // Avança para o dia seguinte (soma 24h em UTC, depois ajusta a hora)
    d = new Date(d.getTime() + 24 * 60 * 60 * 1000);
    d = _setBrasilHora(d, HORA_INICIO);
  }

  const h = _brasilDate(d).getUTCHours();
  if (h < HORA_INICIO) {
    d = _setBrasilHora(d, HORA_INICIO);
  } else if (h >= HORA_FIM) {
    // Próximo dia útil às HORA_INICIO
    d = new Date(d.getTime() + 24 * 60 * 60 * 1000);
    d = _setBrasilHora(d, HORA_INICIO);
    while (!_ehDiaUtil(d)) {
      d = new Date(d.getTime() + 24 * 60 * 60 * 1000);
      d = _setBrasilHora(d, HORA_INICIO);
    }
  }
  return d;
}

/**
 * Adiciona `horas` horas úteis a `dataInicio` (Date JS, em UTC).
 * @param {Date} dataInicio
 * @param {number} horas
 * @returns {Date}
 */
function adicionarHorasUteis(dataInicio, horas) {
  if (horas <= 0) return dataInicio;

  let minutosRestantes = horas * 60;
  let atual = _proxHorarioUtil(new Date(dataInicio));

  while (minutosRestantes > 0) {
    const fimDoDia = _setBrasilHora(atual, HORA_FIM);
    const minutosAteOFim = Math.max(0, (fimDoDia - atual) / 60000);

    if (minutosRestantes <= minutosAteOFim) {
      atual = new Date(atual.getTime() + minutosRestantes * 60000);
      minutosRestantes = 0;
    } else {
      minutosRestantes -= minutosAteOFim;
      // Próximo dia útil
      let prox = new Date(atual.getTime() + 24 * 60 * 60 * 1000);
      prox = _setBrasilHora(prox, HORA_INICIO);
      while (!_ehDiaUtil(prox)) {
        prox = new Date(prox.getTime() + 24 * 60 * 60 * 1000);
        prox = _setBrasilHora(prox, HORA_INICIO);
      }
      atual = prox;
    }
  }

  return atual;
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
  const base = criado_em instanceof Date
    ? criado_em
    : (typeof criado_em.toDate === 'function'
      ? criado_em.toDate()
      : new Date(criado_em._seconds * 1000));
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
  const prazoRaw = tarefa.prazo;
  const prazo = prazoRaw instanceof Date
    ? prazoRaw
    : (typeof prazoRaw.toDate === 'function'
      ? prazoRaw.toDate()
      : new Date(prazoRaw._seconds * 1000));
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
