'use strict';

async function handleWfInstanciasRoute({ req, res, user, instanciasCol, engine }) {
  if (req.method === 'GET') {
    const snap = await instanciasCol
      .where('solicitante_uid', '==', user.uid)
      .orderBy('criado_em', 'desc')
      .limit(50)
      .get();
    res.json(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    return;
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const instancia = body.processo_modelo_id
      ? await engine.iniciarInstancia({
        processo_modelo_id: body.processo_modelo_id,
        titulo: body.titulo,
        solicitante_uid: user.uid,
        grupo_id: body.grupo_id || null,
        grupo_nome: body.grupo_nome || null,
        agendado_para: body.agendado_para || null,
      })
      : await engine.iniciarInstanciaMapeada({
        processo_id: body.processo_id,
        processo_nome: body.processo_nome,
        titulo: body.titulo,
        solicitante_uid: user.uid,
        snapshot_etapas: body.snapshot_etapas || [],
        fluxo_origem: body.fluxo_origem || null,
      });
    res.status(201).json(instancia);
    return;
  }

  res.status(405).end();
}

async function handleWfInstanciaItemRoute({ req, res, user, instanciasCol, historicoCol, engine }) {
  const segments = req.path.split('/').filter(Boolean);
  const id = segments[0];
  const acao = segments[1];

  if (req.method === 'GET' && !acao) {
    const snap = await instanciasCol.doc(id).get();
    if (!snap.exists) {
      res.status(404).json({ erro: 'NAO_ENCONTRADO' });
      return;
    }
    res.json({ id: snap.id, ...snap.data() });
    return;
  }

  if (req.method === 'GET' && acao === 'historico') {
    const snap = await historicoCol
      .where('instancia_id', '==', id)
      .orderBy('ocorrido_em', 'asc')
      .get();
    res.json(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    return;
  }

  if (req.method === 'POST' && acao === 'cancelar') {
    const result = await engine.cancelarInstancia({
      instancia_id: id,
      usuario_uid: user.uid,
      usuario_email: user.email || null,
      usuario_perfil: user.perfil || null,
      motivo: req.body?.motivo || '',
    });
    res.json(result);
    return;
  }

  if (req.method === 'POST' && acao === 'suspender') {
    const result = await engine.suspenderInstancia({
      instancia_id: id,
      usuario_uid: user.uid,
      usuario_email: user.email || null,
      usuario_perfil: user.perfil || null,
    });
    res.json(result);
    return;
  }

  if (req.method === 'POST' && acao === 'retomar') {
    const result = await engine.retomarInstancia({
      instancia_id: id,
      usuario_uid: user.uid,
      usuario_email: user.email || null,
      usuario_perfil: user.perfil || null,
    });
    res.json(result);
    return;
  }

  if (req.method === 'POST' && acao === 'excluir') {
    const result = await engine.excluirInstanciaLogica({
      instancia_id: id,
      usuario_uid: user.uid,
      usuario_email: user.email || null,
      usuario_perfil: user.perfil || null,
    });
    res.json(result);
    return;
  }

  res.status(405).end();
}

module.exports = {
  handleWfInstanciasRoute,
  handleWfInstanciaItemRoute,
};