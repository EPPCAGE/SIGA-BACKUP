'use strict';

async function handleWfTarefasRoute({ req, res, user, tarefasCol, gruposCol, engine, listarTarefasAbertasUsuario }) {
  const segments = req.path.split('/').filter(Boolean);
  const id = segments[0];
  const acao = segments[1];

  if (req.method === 'GET' && !id) {
    const tarefas = await listarTarefasAbertasUsuario({
      tarefasCol,
      gruposCol,
      user,
    });
    res.json(tarefas);
    return;
  }

  if (req.method === 'GET' && id && !acao) {
    const snap = await tarefasCol.doc(id).get();
    if (!snap.exists) {
      res.status(404).json({ erro: 'NAO_ENCONTRADO' });
      return;
    }
    res.json({ id: snap.id, ...snap.data() });
    return;
  }

  if (req.method === 'POST' && acao === 'assumir') {
    const result = await engine.assumirTarefa({
      tarefa_id: id,
      usuario_uid: user.uid,
      usuario_email: user.email || null,
      usuario_perfil: user.perfil || null,
    });
    res.json(result);
    return;
  }

  if (req.method === 'POST' && acao === 'iniciar') {
    const result = await engine.iniciarTarefa({
      tarefa_id: id,
      usuario_uid: user.uid,
      usuario_email: user.email || null,
      usuario_perfil: user.perfil || null,
    });
    res.json(result);
    return;
  }

  if (req.method === 'POST' && acao === 'concluir') {
    const { acao: acaoTarefa, observacao, dados_formulario, anexos } = req.body || {};
    const result = await engine.concluirTarefa({
      tarefa_id: id,
      usuario_uid: user.uid,
      usuario_email: user.email || null,
      usuario_perfil: user.perfil || null,
      acao: acaoTarefa,
      observacao,
      dados_formulario: dados_formulario || {},
      anexos: Array.isArray(anexos) ? anexos : [],
    });
    res.json(result);
    return;
  }

  if (req.method === 'POST' && acao === 'delegar') {
    const result = await engine.delegarTarefa({
      tarefa_id: id,
      usuario_uid: user.uid,
      usuario_email: user.email || null,
      usuario_perfil: user.perfil || null,
      novo_responsavel_uid: req.body?.novo_responsavel_uid || null,
      motivo: req.body?.motivo || '',
    });
    res.json(result);
    return;
  }

  if (req.method === 'POST' && acao === 'excluir') {
    const result = await engine.excluirTarefa({
      tarefa_id: id,
      usuario_uid: user.uid,
      usuario_email: user.email || null,
      usuario_perfil: user.perfil || null,
    });
    res.json(result);
    return;
  }

  res.status(405).end();
}

module.exports = { handleWfTarefasRoute };