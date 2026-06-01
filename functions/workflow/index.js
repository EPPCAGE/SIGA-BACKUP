'use strict';

/**
 * Cloud Functions — Módulo de Workflow
 *
 * Expõe endpoints REST autenticados e job agendado de SLA.
 * Integra com a infraestrutura existente: mesma verificação de token,
 * mesmo CORS, mesmo padrão de resposta do sistema SIGA 2.0.
 */

const { onRequest, onSchedule } = require('firebase-functions/v2/https');
const { onSchedule: onScheduleV2 } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');

// Admin já inicializado no functions/index.js principal — reaproveita
const db = admin.firestore();

const { makeEngine } = require('./engine');
const {
  criarProcessoModelo,
  criarEtapaModelo,
  criarTransicaoFluxo,
  criarFormularioModelo,
  normalizarProcessoModeloDoc,
  fsClean,
} = require('./entities');
const { listarTarefasAbertasUsuario } = require('./task-listing');
const { handleWfTarefasRoute } = require('./task-routes');
const { handleWfInstanciasRoute, handleWfInstanciaItemRoute } = require('./instance-routes');
const { handleWfNotificacoesRoute } = require('./notification-routes');
const { handleWfComentariosRoute } = require('./comment-routes');

const CORS_ORIGINS = new Set(['https://eppcage.com.br', 'https://sigaepp.web.app', 'https://sigaepp.firebaseapp.com']);

// Reutiliza verificação de token do sistema existente
async function verificarToken(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : req.body?._token;
  if (!token) throw Object.assign(new Error('Token ausente'), { status: 401 });
  const decoded = await admin.auth().verifyIdToken(token);
  return decoded;
}

function setCors(res, req) {
  const origin = req.headers.origin;
  if (CORS_ORIGINS.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

function erro(res, code, mensagem, status = 500) {
  res.status(status).json({ erro: code, mensagem });
}

async function handler(req, res, fn) {
  setCors(res, req);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  try {
    const user = await verificarToken(req);
    await fn(req, res, user);
  } catch (e) {
    const status = e.status || (e.code === 'auth/id-token-expired' ? 401 : 500);
    erro(res, e.code || 'ERRO_INTERNO', e.message, status);
  }
}

// ---------------------------------------------------------------------------
// Helpers de coleção
// ---------------------------------------------------------------------------
const col = {
  modelos: db.collection('wf_processo_modelos'),
  etapas: db.collection('wf_etapa_modelos'),
  transicoes: db.collection('wf_transicao_fluxos'),
  formularios: db.collection('wf_formulario_modelos'),
  instancias: db.collection('wf_instancia_processos'),
  tarefas: db.collection('wf_tarefa_workflows'),
  historico: db.collection('wf_historico_workflows'),
  comentarios: db.collection('wf_comentarios'),
  notificacoes: db.collection('wf_notificacoes'),
  grupos: db.collection('wf_grupos'),
  arquitetura: db.collection('arquitetura'),
};

const engine = makeEngine(db);

function perfisPermitidos(perfil, ...perfisValidos) {
  if (!perfisValidos.includes(perfil)) {
    throw Object.assign(new Error('Sem permissão'), { code: 'SEM_PERMISSAO', status: 403 });
  }
}

// ---------------------------------------------------------------------------
// Endpoints

/**
 * GET  /wf/processos-modelo
 * POST /wf/processos-modelo
 * Integração: lista processos da coleção `arquitetura` disponíveis para vinculação
 */
exports.wfProcessosModelo = onRequest({ region: 'us-central1', cors: false }, async (req, res) => {
  await handler(req, res, async (req, res, user) => {
    const perfil = user.perfil || 'dono';

    if (req.method === 'GET') {
      let q = col.modelos.orderBy('atualizado_em', 'desc');
      if (!['ep', 'gestor'].includes(perfil)) {
        q = q.where('status', '==', 'publicado');
      }
      const snap = await q.limit(100).get();
      res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      return;
    }

    if (req.method === 'POST') {
      perfisPermitidos(perfil, 'ep', 'gestor');
      const data = criarProcessoModelo({ ...req.body, criado_por: user.uid });
      const ref = await col.modelos.add({ ...data, atualizado_em: data.criado_em });
      res.status(201).json({ id: ref.id, ...data });
      return;
    }

    res.status(405).json({ erro: 'METODO_NAO_PERMITIDO' });
  });
});

/**
 * GET /wf/arquitetura-processos
 * Lista processos da coleção `arquitetura` existentes para vinculação ao modelo
 */
exports.wfArquiteturaProcessos = onRequest({ region: 'us-central1', cors: false }, async (req, res) => {
  await handler(req, res, async (req, res, user) => {
    if (req.method !== 'GET') { res.status(405).end(); return; }
    const snap = await col.arquitetura.orderBy('nome').limit(200).get();
    res.json(snap.docs.map(d => ({
      id: d.id,
      nome: d.data().nome || d.data().titulo || '',
      nivel: d.data().nivel || null,
      codigo: d.data().codigo || null,
      pai_id: d.data().pai_id || null,
    })));
  });
});

/**
 * PUT  /wf/processos-modelo/:id
 * POST /wf/processos-modelo/:id/publicar
 * DELETE /wf/processos-modelo/:id
 */
exports.wfProcessoModeloItem = onRequest({ region: 'us-central1', cors: false }, async (req, res) => {
  await handler(req, res, async (req, res, user) => {
    const perfil = user.perfil || 'dono';
    const segments = req.path.split('/').filter(Boolean);
    const id = segments[0];
    const acao = segments[1]; // 'publicar' ou undefined

    if (!id) { res.status(400).json({ erro: 'ID_AUSENTE' }); return; }

    if (req.method === 'GET') {
      const snap = await col.modelos.doc(id).get();
      if (!snap.exists) { res.status(404).json({ erro: 'NAO_ENCONTRADO' }); return; }
      res.json({ id: snap.id, ...snap.data() });
      return;
    }

    if (req.method === 'PUT') {
      perfisPermitidos(perfil, 'ep', 'gestor');
      const { Timestamp } = require('firebase-admin/firestore');
      const snap = await col.modelos.doc(id).get();
      if (!snap.exists) { res.status(404).json({ erro: 'NAO_ENCONTRADO' }); return; }
      const atual = snap.data();
      const normalizado = normalizarProcessoModeloDoc({
        ...atual,
        ...req.body,
        criado_por: atual.criado_por || user.uid,
      });
      await col.modelos.doc(id).update(fsClean({
        ...normalizado,
        criado_em: atual.criado_em || null,
        atualizado_em: Timestamp.now(),
      }));
      res.json({ ok: true });
      return;
    }

    if (req.method === 'POST' && acao === 'publicar') {
      perfisPermitidos(perfil, 'ep');
      const snap = await col.modelos.doc(id).get();
      if (!snap.exists) { res.status(404).json({ erro: 'NAO_ENCONTRADO' }); return; }
      const atual = snap.data();
      const novaVersao = (atual.versao || 1) + 1;
      const { Timestamp } = require('firebase-admin/firestore');
      await col.modelos.doc(id).update({ status: 'publicado', versao: novaVersao, atualizado_em: Timestamp.now() });
      res.json({ ok: true, versao: novaVersao });
      return;
    }

    if (req.method === 'DELETE') {
      perfisPermitidos(perfil, 'ep');
      const { Timestamp } = require('firebase-admin/firestore');
      await col.modelos.doc(id).update({ status: 'arquivado', atualizado_em: Timestamp.now() });
      res.json({ ok: true });
      return;
    }

    res.status(405).end();
  });
});

/**
 * GET /wf/processos-modelo/:id/etapas
 * POST /wf/processos-modelo/:id/etapas
 */
exports.wfEtapas = onRequest({ region: 'us-central1', cors: false }, async (req, res) => {
  await handler(req, res, async (req, res, user) => {
    const perfil = user.perfil || 'dono';
    const modeloId = req.path.split('/').find(Boolean);

    if (req.method === 'GET') {
      const snap = await col.etapas.where('processo_modelo_id', '==', modeloId).orderBy('ordem').get();
      res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      return;
    }

    if (req.method === 'POST') {
      perfisPermitidos(perfil, 'ep', 'gestor');
      const data = criarEtapaModelo({ ...req.body, processo_modelo_id: modeloId });
      const ref = await col.etapas.add(data);
      res.status(201).json({ id: ref.id, ...data });
      return;
    }

    res.status(405).end();
  });
});

/**
 * GET /wf/processos-modelo/:modeloId/transicoes
 * POST /wf/processos-modelo/:modeloId/transicoes
 */
exports.wfTransicoes = onRequest({ region: 'us-central1', cors: false }, async (req, res) => {
  await handler(req, res, async (req, res, user) => {
    const perfil = user.perfil || 'dono';
    const modeloId = req.path.split('/').find(Boolean);

    if (req.method === 'GET') {
      const snap = await col.transicoes.where('processo_modelo_id', '==', modeloId).get();
      res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      return;
    }

    if (req.method === 'POST') {
      perfisPermitidos(perfil, 'ep', 'gestor');
      const data = criarTransicaoFluxo({ ...req.body, processo_modelo_id: modeloId });
      const ref = await col.transicoes.add(data);
      res.status(201).json({ id: ref.id, ...data });
      return;
    }

    res.status(405).end();
  });
});

/**
 * GET /wf/formularios-modelo
 * POST /wf/formularios-modelo
 */
exports.wfFormularios = onRequest({ region: 'us-central1', cors: false }, async (req, res) => {
  await handler(req, res, async (req, res, user) => {
    const perfil = user.perfil || 'dono';

    if (req.method === 'GET') {
      const snap = await col.formularios.orderBy('criado_em', 'desc').limit(100).get();
      res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      return;
    }

    if (req.method === 'POST') {
      perfisPermitidos(perfil, 'ep', 'gestor');
      const data = criarFormularioModelo({ ...req.body, criado_por: user.uid });
      const ref = await col.formularios.add(data);
      res.status(201).json({ id: ref.id, ...data });
      return;
    }

    res.status(405).end();
  });
});

/**
 * GET  /wf/instancias
 * POST /wf/instancias
 */
exports.wfInstancias = onRequest({ region: 'us-central1', cors: false }, async (req, res) => {
  await handler(req, res, async (req, res, user) => {
    await handleWfInstanciasRoute({ req, res, user, instanciasCol: col.instancias, engine });
  });
});

/**
 * GET  /wf/instancias/:id
 * POST /wf/instancias/:id/cancelar
 * GET  /wf/instancias/:id/historico
 */
exports.wfInstanciaItem = onRequest({ region: 'us-central1', cors: false }, async (req, res) => {
  await handler(req, res, async (req, res, user) => {
    await handleWfInstanciaItemRoute({
      req,
      res,
      user,
      instanciasCol: col.instancias,
      historicoCol: col.historico,
      engine,
    });
  });
});

/**
 * GET  /wf/tarefas
 * GET  /wf/tarefas/:id
 * POST /wf/tarefas/:id/assumir
 * POST /wf/tarefas/:id/iniciar
 * POST /wf/tarefas/:id/concluir
 */
exports.wfTarefas = onRequest({ region: 'us-central1', cors: false }, async (req, res) => {
  await handler(req, res, async (req, res, user) => {
    await handleWfTarefasRoute({
      req,
      res,
      user,
      tarefasCol: col.tarefas,
      gruposCol: col.grupos,
      engine,
      listarTarefasAbertasUsuario,
    });
  });
});

/**
 * GET  /wf/notificacoes
 * POST /wf/notificacoes/:id/marcar-lida
 * POST /wf/notificacoes/marcar-todas-lidas
 */
exports.wfNotificacoes = onRequest({ region: 'us-central1', cors: false }, async (req, res) => {
  await handler(req, res, async (req, res, user) => {
    await handleWfNotificacoesRoute({ req, res, user, notificacoesCol: col.notificacoes, db });
  });
});

/**
 * GET  /wf/comentarios?tarefa_id=:id
 * GET  /wf/comentarios?instancia_id=:id
 * POST /wf/comentarios
 */
exports.wfComentarios = onRequest({ region: 'us-central1', cors: false }, async (req, res) => {
  await handler(req, res, async (req, res, user) => {
    await handleWfComentariosRoute({
      req,
      res,
      user,
      comentariosCol: col.comentarios,
      nowFactory: () => admin.firestore.Timestamp.now(),
    });
  });
});

/**
 * Job agendado — processamento de SLA (a cada 30 minutos)
 */
exports.wfSlaJob = onScheduleV2({
  schedule: 'every 30 minutes',
  region: 'us-central1',
  timeZone: 'America/Sao_Paulo',
}, async () => {
  const resultado = await engine.processarSla();
  console.log('[wfSlaJob]', resultado);
});
