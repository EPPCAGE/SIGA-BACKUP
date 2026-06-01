'use strict';

async function _listarDocsConsulta(queryRef) {
  const snap = await queryRef.get();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function handleWfNotificacoesRoute({ req, res, user, notificacoesCol, db }) {
  const segments = req.path.split('/').filter(Boolean);
  const id = segments[0];
  const acao = segments[1];
  const perfil = user?.perfil || null;

  if (req.method === 'GET') {
    const consultas = [
      _listarDocsConsulta(
        notificacoesCol
          .where('destinatario_uid', '==', user.uid)
          .orderBy('criado_em', 'desc')
          .limit(30)
      ),
    ];

    if (perfil === 'ep') {
      consultas.push(
        _listarDocsConsulta(
          notificacoesCol
            .where('destinatario_uid', '==', 'ep_escalada')
            .orderBy('criado_em', 'desc')
            .limit(30)
        )
      );
    }

    const resultados = await Promise.all(consultas);
    const notificacoes = new Map();
    resultados.flat().forEach((item) => notificacoes.set(item.id, item));
    const lista = Array.from(notificacoes.values()).sort((left, right) => {
      const leftSeconds = left.criado_em?.seconds ?? left._criado_em?.seconds ?? 0;
      const rightSeconds = right.criado_em?.seconds ?? right._criado_em?.seconds ?? 0;
      return rightSeconds - leftSeconds;
    });
    res.json(lista.slice(0, 50));
    return;
  }

  if (req.method === 'POST' && id === 'marcar-todas-lidas') {
    const consultas = [
      notificacoesCol
        .where('destinatario_uid', '==', user.uid)
        .where('lida', '==', false)
        .get(),
    ];
    if (perfil === 'ep') {
      consultas.push(
        notificacoesCol
          .where('destinatario_uid', '==', 'ep_escalada')
          .where('lida', '==', false)
          .get()
      );
    }
    const resultados = await Promise.all(consultas);
    const batch = db.batch();
    const refs = new Map();
    resultados.forEach((snap) => {
      snap.docs.forEach((doc) => refs.set(doc.id, doc.ref));
    });
    refs.forEach((ref) => batch.update(ref, { lida: true }));
    await batch.commit();
    res.json({ ok: true, marcadas: refs.size });
    return;
  }

  if (req.method === 'POST' && acao === 'marcar-lida') {
    await notificacoesCol.doc(id).update({ lida: true });
    res.json({ ok: true });
    return;
  }

  res.status(405).end();
}

module.exports = { handleWfNotificacoesRoute };