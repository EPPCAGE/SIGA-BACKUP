'use strict';

async function handleWfComentariosRoute({ req, res, user, comentariosCol, nowFactory }) {
  if (req.method === 'GET') {
    const tarefaId = String(req.query?.tarefa_id || '').trim();
    const instanciaId = String(req.query?.instancia_id || '').trim();

    if (!tarefaId && !instanciaId) {
      res.status(400).json({ erro: 'FILTRO_OBRIGATORIO' });
      return;
    }

    let queryRef = comentariosCol;
    if (tarefaId) {
      queryRef = queryRef.where('tarefa_id', '==', tarefaId);
    }
    if (instanciaId) {
      queryRef = queryRef.where('instancia_id', '==', instanciaId);
    }

    const snap = await queryRef.get();
    const comentarios = snap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .sort((left, right) => {
        const leftSeconds = left.criado_em?.seconds ?? left._criado_em?.seconds ?? 0;
        const rightSeconds = right.criado_em?.seconds ?? right._criado_em?.seconds ?? 0;
        return leftSeconds - rightSeconds;
      });
    res.json(comentarios);
    return;
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const tarefaId = String(body.tarefa_id || '').trim();
    const instanciaId = String(body.instancia_id || '').trim();
    const texto = String(body.texto || '').trim();
    if (!tarefaId || !instanciaId || !texto) {
      res.status(400).json({ erro: 'CAMPO_OBRIGATORIO' });
      return;
    }

    const createdAt = nowFactory();
    const doc = {
      tarefa_id: tarefaId,
      instancia_id: instanciaId,
      etapa_id: body.etapa_id || null,
      etapa_nome: body.etapa_nome || null,
      autor_uid: user.uid,
      texto,
      respondendo_a: body.respondendo_a || null,
      criado_em: createdAt,
      _criado_em: createdAt,
    };

    const ref = await comentariosCol.add(doc);
    res.status(201).json({ id: ref.id, ...doc });
    return;
  }

  res.status(405).end();
}

module.exports = { handleWfComentariosRoute };