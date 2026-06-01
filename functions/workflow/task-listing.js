'use strict';

function _prazoMillis(tarefa) {
  return tarefa?.prazo?.toMillis?.()
    || (tarefa?.prazo?._seconds ? tarefa.prazo._seconds * 1000 : null)
    || Number.MAX_SAFE_INTEGER;
}

async function listarTarefasAbertasUsuario({ tarefasCol, gruposCol, user }) {
  const statusAbertos = ['pendente', 'em_execucao'];
  const perfil = user?.perfil || 'dono';
  const consultasTarefas = [
    tarefasCol
      .where('responsavel_uid', '==', user.uid)
      .where('status', 'in', statusAbertos)
      .limit(50)
      .get(),
  ];

  if (user?.email) {
    consultasTarefas.push(
      tarefasCol
        .where('papel_alvo', '==', user.email)
        .where('status', 'in', statusAbertos)
        .limit(50)
        .get()
    );
  }

  if (['ep', 'gestor', 'dono'].includes(perfil)) {
    consultasTarefas.push(
      tarefasCol
        .where('papel_alvo', '==', perfil)
        .where('status', 'in', statusAbertos)
        .limit(50)
        .get()
    );
  }

  const gruposSnap = user?.email
    ? await gruposCol.where('membros_email', 'array-contains', user.email).limit(20).get()
    : { docs: [] };

  const resultados = await Promise.all(consultasTarefas);
  const tarefas = new Map();

  resultados.forEach((snap) => {
    snap.docs.forEach((doc) => tarefas.set(doc.id, { id: doc.id, ...doc.data() }));
  });

  for (const grupoDoc of gruposSnap.docs) {
    const tarefasGrupo = await tarefasCol
      .where('grupo_id', '==', grupoDoc.id)
      .where('status', 'in', statusAbertos)
      .limit(50)
      .get();
    tarefasGrupo.docs.forEach((doc) => {
      tarefas.set(doc.id, {
        id: doc.id,
        ...doc.data(),
        _nomeGrupo: grupoDoc.data().nome || grupoDoc.id,
      });
    });
  }

  return Array.from(tarefas.values())
    .sort((left, right) => _prazoMillis(left) - _prazoMillis(right))
    .slice(0, 100);
}

module.exports = { listarTarefasAbertasUsuario };