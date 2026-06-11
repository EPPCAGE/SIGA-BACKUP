'use strict';

async function handleWfTarefasRoute({ req, res, user, tarefasCol, gruposCol, usuariosConfigDoc, adminAuth, engine, listarTarefasAbertasUsuario, listarTodasTarefasAbertas }) {
  const segments = req.path.split('/').filter(Boolean);
  const id = segments[0];
  const acao = segments[1];

  if (req.method === 'GET' && !id) {
    if (req.query.admin === 'true') {
      if (user?.perfil !== 'ep') {
        res.status(403).json({ erro: 'SEM_PERMISSAO' });
        return;
      }
      const usuariosSnap = usuariosConfigDoc ? await usuariosConfigDoc.get() : null;
      const tarefas = await listarTodasTarefasAbertas({
        tarefasCol,
        usuariosConfig: usuariosSnap,
        statusFiltro: req.query.status || null,
        processoBusca: req.query.q || null,
      });
      res.json(tarefas);
      return;
    }
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

  if (req.method === 'GET' && id && acao === 'candidatos-delegacao') {
    const result = await engine.candidatosDelegacao({ tarefa_id: id });
    res.json(result);
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
    let gestorSolicitanteUid = req.body?.gestor_solicitante_uid || null;
    // Aceita email no campo e resolve para UID via Firebase Auth.
    if (gestorSolicitanteUid && String(gestorSolicitanteUid).includes('@') && adminAuth) {
      try {
        const record = await adminAuth.getUserByEmail(gestorSolicitanteUid);
        gestorSolicitanteUid = record.uid;
      } catch (_) { /* mantém valor original */ }
    }
    const result = await engine.concluirTarefa({
      tarefa_id: id,
      usuario_uid: user.uid,
      usuario_email: user.email || null,
      usuario_perfil: user.perfil || null,
      acao: acaoTarefa,
      observacao,
      dados_formulario: dados_formulario || {},
      anexos: Array.isArray(anexos) ? anexos : [],
      gestor_solicitante_uid: gestorSolicitanteUid,
    });
    res.json(result);
    return;
  }

  if (req.method === 'POST' && acao === 'delegar') {
    let novoUid = req.body?.novo_responsavel_uid || null;
    // Se o frontend enviou um email em vez de UID, resolve via Firebase Auth
    if (novoUid && String(novoUid).includes('@') && adminAuth) {
      try {
        const record = await adminAuth.getUserByEmail(novoUid);
        novoUid = record.uid;
      } catch (_) { /* mantém email — backend aceitará como está */ }
    }
    const result = await engine.delegarTarefa({
      tarefa_id: id,
      usuario_uid: user.uid,
      usuario_email: user.email || null,
      usuario_perfil: user.perfil || null,
      novo_responsavel_uid: novoUid,
      motivo: req.body?.motivo || '',
    });
    res.json(result);
    return;
  }

  if (req.method === 'POST' && acao === 'puxar') {
    if (user?.perfil !== 'ep') {
      res.status(403).json({ erro: 'SEM_PERMISSAO' });
      return;
    }
    const result = await engine.puxarTarefa({
      tarefa_id: id,
      usuario_uid: user.uid,
      usuario_email: user.email || null,
      usuario_perfil: user.perfil || null,
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