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

  // Tarefas direcionadas a gestor_solicitante/gestor_executor sem UID resolvido
  // aparecem para gestors e eps (fila de fallback)
  if (['ep', 'gestor'].includes(perfil)) {
    for (const papelEspecial of ['gestor_solicitante', 'gestor_executor']) {
      consultasTarefas.push(
        tarefasCol
          .where('papel_alvo', '==', papelEspecial)
          .where('responsavel_uid', '==', null)
          .where('status', 'in', statusAbertos)
          .limit(50)
          .get()
      );
    }
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

async function listarTodasTarefasAbertas({ tarefasCol, usuariosConfig, statusFiltro, processoBusca, paginaSize = 200 }) {
  const statusAbertos = statusFiltro ? [statusFiltro] : ['pendente', 'em_execucao'];
  const snap = await tarefasCol
    .where('status', 'in', statusAbertos)
    .orderBy('criado_em', 'asc')
    .limit(paginaSize)
    .get();

  const usuarios = usuariosConfig ? (usuariosConfig.data()?.data || []) : [];
  const mapUsuarios = {};
  const usuariosArr = typeof usuarios === 'string' ? JSON.parse(usuarios) : (Array.isArray(usuarios) ? usuarios : []);
  usuariosArr.forEach(u => { if (u?.uid) mapUsuarios[u.uid] = u; });

  const tarefas = snap.docs.map(doc => {
    const d = { id: doc.id, ...doc.data() };
    const responsavel = d.responsavel_uid ? mapUsuarios[d.responsavel_uid] : null;
    d._responsavel_nome = responsavel?.nome || responsavel?.email || d.papel_alvo || '—';
    d._responsavel_email = responsavel?.email || null;
    return d;
  });

  if (processoBusca) {
    const q = processoBusca.toLowerCase();
    return tarefas.filter(t =>
      (t.processo_nome || '').toLowerCase().includes(q) ||
      (t.etapa_nome || '').toLowerCase().includes(q) ||
      (t._responsavel_nome || '').toLowerCase().includes(q)
    );
  }

  return tarefas;
}

module.exports = { listarTarefasAbertasUsuario, listarTodasTarefasAbertas };