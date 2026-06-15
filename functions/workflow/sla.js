'use strict';

/**
 * Cálculo de SLA em horas úteis.
 * Considera: segunda a sexta, 09h–12h e 13h–18h (horário de Brasília, UTC-3).
 * Almoço (12h–13h) não é contabilizado como hora útil.
 * Feriados nacionais fixos e móveis são excluídos.
 *
 * Feriados considerados:
 *   Nacionais fixos: 1/1, 21/4, 1/5, 7/9, 12/10, 2/11, 15/11, 20/11, 25/12
 *   Nacionais móveis: Sexta-feira Santa, Carnaval (2ª e 3ª), Corpus Christi
 *   Estaduais RS: 20/9 (Revolução Farroupilha)
 *   Municipais Porto Alegre: 2/2 (N. Sra. dos Navegantes — Lei 3.033/1967)
 *
 * Todas as comparações de hora/dia usam a hora local de Brasília (UTC-3).
 * O Brasil não adota horário de verão desde 2019, portanto o offset é fixo.
 */

const HORA_INICIO = 9;
const HORA_FIM = 18;
const ALMOCO_INICIO = 12;
const ALMOCO_FIM = 13;
const ALERTA_HORAS_ANTES = 2;

// UTC-3 fixo (Brasil parou horário de verão em 2019)
const BRASIL_OFFSET_MS = -3 * 60 * 60 * 1000;

// ── Feriados fixos (MM-DD) ────────────────────────────────────────────────────

// Nacionais
const FERIADOS_NACIONAIS = new Set([
  '01-01', // Confraternização Universal
  '04-21', // Tiradentes
  '05-01', // Dia do Trabalho
  '09-07', // Independência do Brasil
  '10-12', // Nossa Senhora Aparecida
  '11-02', // Finados
  '11-15', // Proclamação da República
  '11-20', // Consciência Negra (Lei 14.759/2023)
  '12-25', // Natal
]);

// Estaduais — Rio Grande do Sul
const FERIADOS_RS = new Set([
  '09-20', // Revolução Farroupilha / Dia do Gaúcho
]);

// Municipais — Porto Alegre
const FERIADOS_POA = new Set([
  '02-02', // Nossa Senhora dos Navegantes (Lei Municipal 3.033/1967)
]);

const FERIADOS_FIXOS = new Set([
  ...FERIADOS_NACIONAIS,
  ...FERIADOS_RS,
  ...FERIADOS_POA,
]);

// ── Cache de feriados móveis por ano ─────────────────────────────────────────
const _cacheFeriadosMoveis = new Map(); // ano → Set<'MM-DD'>

/**
 * Algoritmo de Butcher/Anonymous para calcular a Páscoa (Gregoriano).
 * Retorna Date UTC à meia-noite do dia da Páscoa.
 */
function _calcularPascoa(ano) {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31); // 1-based
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(ano, mes - 1, dia));
}

function _mmdd(data) {
  return `${String(data.getUTCMonth() + 1).padStart(2, '0')}-${String(data.getUTCDate()).padStart(2, '0')}`;
}

function _feriadosMoveis(ano) {
  if (_cacheFeriadosMoveis.has(ano)) return _cacheFeriadosMoveis.get(ano);

  const pascoa = _calcularPascoa(ano);
  const DIA = 86400000; // 1 dia em ms

  const moveis = new Set([
    _mmdd(new Date(pascoa.getTime() - 48 * DIA)), // Carnaval — segunda-feira
    _mmdd(new Date(pascoa.getTime() - 47 * DIA)), // Carnaval — terça-feira
    _mmdd(new Date(pascoa.getTime() -  2 * DIA)), // Sexta-feira Santa
    _mmdd(pascoa),                                 // Páscoa (domingo, só por completude)
    _mmdd(new Date(pascoa.getTime() + 60 * DIA)), // Corpus Christi
  ]);

  _cacheFeriadosMoveis.set(ano, moveis);
  return moveis;
}

// ── Helpers de fuso horário ───────────────────────────────────────────────────

/**
 * Converte um Date UTC para um "Date" cujos métodos getUTC* retornam a hora
 * local de Brasília (UTC-3). Convenção: getUTCHours() = hora em Brasília.
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

// ── Verificação de dia útil ───────────────────────────────────────────────────

function _ehFeriado(data) {
  const bd = _brasilDate(data);
  const ano = bd.getUTCFullYear();
  const chave = _mmdd(bd);
  return FERIADOS_FIXOS.has(chave) || _feriadosMoveis(ano).has(chave);
}

function _ehDiaUtil(data) {
  const dia = _brasilDate(data).getUTCDay(); // 0=dom, 6=sab
  return dia !== 0 && dia !== 6 && !_ehFeriado(data);
}

// ── Lógica de avanço ─────────────────────────────────────────────────────────

const DIA_MS = 24 * 60 * 60 * 1000;

/** Avança `d` um dia (UTC) e posiciona no início do expediente de Brasília. */
function _avancarDia(d) {
  return _setBrasilHora(new Date(d.getTime() + DIA_MS), HORA_INICIO);
}

/**
 * Avança `data` para o próximo instante dentro do expediente útil de Brasília.
 * Pula almoço (12h–13h), fora do expediente e dias não úteis.
 */
function _proxHorarioUtil(data) {
  let d = new Date(data);
  const h = _brasilDate(d).getUTCHours();

  if (h >= HORA_FIM) {
    d = _avancarDia(d);
  } else if (h >= ALMOCO_INICIO && h < ALMOCO_FIM) {
    d = _setBrasilHora(d, ALMOCO_FIM); // pula almoço
  } else if (h < HORA_INICIO) {
    d = _setBrasilHora(d, HORA_INICIO);
  }

  while (!_ehDiaUtil(d)) {
    d = _avancarDia(d);
  }

  return d;
}

/**
 * Adiciona `horas` horas úteis a `dataInicio` (Date JS, em UTC).
 * O dia tem dois blocos úteis: 09h–12h (3h) e 13h–18h (5h) = 8h/dia.
 * @param {Date} dataInicio
 * @param {number} horas
 * @returns {Date}
 */
function adicionarHorasUteis(dataInicio, horas) {
  if (horas <= 0) return dataInicio;

  let minutosRestantes = horas * 60;
  let atual = _proxHorarioUtil(new Date(dataInicio));

  while (minutosRestantes > 0) {
    const h = _brasilDate(atual).getUTCHours();

    // Próximo ponto de pausa: almoço (se ainda na manhã) ou fim do dia
    const proximoPonto = h < ALMOCO_INICIO
      ? _setBrasilHora(atual, ALMOCO_INICIO)
      : _setBrasilHora(atual, HORA_FIM);

    const minutosAteProximo = Math.max(0, (proximoPonto - atual) / 60000);

    if (minutosRestantes <= minutosAteProximo) {
      atual = new Date(atual.getTime() + minutosRestantes * 60000);
      minutosRestantes = 0;
    } else {
      minutosRestantes -= minutosAteProximo;
      if (h < ALMOCO_INICIO) {
        // Chegou no almoço — retoma às 13h
        atual = _setBrasilHora(atual, ALMOCO_FIM);
      } else {
        // Fim do dia — avança para próximo dia útil às 09h
        let prox = _avancarDia(atual);
        while (!_ehDiaUtil(prox)) prox = _avancarDia(prox);
        atual = prox;
      }
    }
  }

  return atual;
}

// ── Cálculo de prazo e status ─────────────────────────────────────────────────

/**
 * Calcula o prazo de uma tarefa a partir do momento de criação.
 * @param {Date|import('firebase-admin/firestore').Timestamp} criado_em
 * @param {number} sla_horas
 * @returns {import('firebase-admin/firestore').Timestamp|null}
 */
function calcularPrazo(criado_em, sla_horas) {
  if (!sla_horas || sla_horas <= 0) return null;

  const { Timestamp } = require('firebase-admin/firestore');
  let base;
  if (criado_em instanceof Date) base = criado_em;
  else if (typeof criado_em.toDate === 'function') base = criado_em.toDate();
  else base = new Date(criado_em._seconds * 1000);
  const prazo = adicionarHorasUteis(base, sla_horas);
  return Timestamp.fromDate(prazo);
}

/**
 * Retorna o status de SLA de uma tarefa.
 * @param {object} tarefa
 * @returns {'sem_sla'|'no_prazo'|'vencendo'|'vencido'}
 */
function calcularStatusSla(tarefa) {
  if (!tarefa.prazo) return 'sem_sla';

  const agora = new Date();
  const prazoRaw = tarefa.prazo;
  let prazo;
  if (prazoRaw instanceof Date) prazo = prazoRaw;
  else if (typeof prazoRaw.toDate === 'function') prazo = prazoRaw.toDate();
  else prazo = new Date(prazoRaw._seconds * 1000);
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
