(function initWorkflowRenderer(globalScope) {
  'use strict';

  function _escWith(esc, value) {
    return typeof esc === 'function' ? esc(value) : String(value ?? '');
  }

  function renderNotificacoes(notifs, esc) {
    if (!notifs.length) {
      return '<div style="color:var(--ink3);font-size:14px;padding:16px 0">Nenhuma notificação.</div>';
    }
    return notifs.map(n => {
      const ts = n._criado_em?.seconds
        ? new Date(n._criado_em.seconds * 1000).toLocaleString('pt-BR')
        : '-';
      const bg = n.lida ? 'var(--bg)' : 'var(--blue-soft,#eff6ff)';
      const id = _escWith(esc, n.id);
      const instancia = _escWith(esc, n.instancia_id || '');
      const titulo = _escWith(esc, n.titulo || '');
      return `<div style="background:${bg};border:1px solid var(--bdr);border-radius:8px;padding:12px 14px;margin-bottom:8px;cursor:pointer"
        onclick="wfMarcarNotifLida('${id}','${instancia}','${titulo}','${instancia}')">
        <div style="font-weight:600;font-size:13px">${_escWith(esc, n.titulo || '')}</div>
        <div style="font-size:12px;color:var(--ink2);margin-top:2px">${_escWith(esc, n.mensagem || '')}</div>
        <div style="font-size:11px;color:var(--ink3);margin-top:4px">${ts}</div>
      </div>`;
    }).join('');
  }

  function renderTarefasCards(tarefasFiltradas, opts) {
    const { esc, badge, slaInfo, statusLabels, statusCores, podeGerenciar } = opts;
    return tarefasFiltradas.map(t => {
      const eFila = t._eFila || (!t.responsavel_uid && !!t.grupo_id);
      const eDisponivel = !t.responsavel_uid && !t.grupo_id;
      let badgeFila = '';
      if (eFila) {
        badgeFila = `${badge('👥 Fila: ' + (t._nomeGrupo || t.grupo_id), '#1e3a5f')} `;
      } else if (eDisponivel) {
        badgeFila = `${badge('📋 Disponivel', '#4b5563')} `;
      }
      const id = _escWith(esc, t.id);
      const botoesAcao = (eFila || eDisponivel)
        ? `<button type="button" class="btn btn-p btn-sm" onclick="wfAssumirTarefa('${id}')">Assumir</button>`
        : `<button type="button" class="btn btn-p btn-sm" onclick="wfAbrirTarefa('${id}')">Abrir</button>
          <button type="button" class="btn btn-sm" onclick="wfAbrirDelegacao('${id}')">Delegar</button>`;

      return `<div data-tarefa-id="${id}"><div class="card" style="padding:16px">
        <div style="font-weight:600;font-size:14px;margin-bottom:4px">${_escWith(esc, t.etapa_nome || t.etapa_modelo_id)}${t.sla_vencido ? ' <span style="background:#ef4444;color:#fff;font-size:9px;padding:1px 5px;border-radius:4px;vertical-align:middle">SLA VENCIDO</span>' : ''}</div>
        <div style="font-size:12px;color:var(--ink3);margin-bottom:6px">${_escWith(esc, t.processo_nome || t.instancia_id)}</div>
        ${badge(statusLabels[t.status] || t.status, statusCores[t.status] || '#6b7280')} ${badgeFila}
        ${slaInfo(t)}
        ${t.etapa_desc ? `<div style="font-size:12px;color:var(--ink2);margin-top:6px">${_escWith(esc, t.etapa_desc)}</div>` : ''}
        <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">
          ${botoesAcao}
          ${podeGerenciar ? `<button type="button" class="btn btn-r btn-sm" onclick="wfExcluirTarefa('${id}')">Excluir</button>` : ''}
        </div>
      </div></div>`;
    }).join('');
  }

  function renderInstanciasCards(instanciasFiltradas, opts) {
    const { esc, badge, podeGerenciar, statusLabels, statusCores } = opts;
    return instanciasFiltradas.map(i => {
      const etapas = i.snapshot_etapas || [];
      const idxAtual = etapas.findIndex(e => e.id === i.etapa_atual_id);
      let pct = 0;
      if (etapas.length > 1 && idxAtual >= 0) {
        pct = Math.round((idxAtual / (etapas.length - 1)) * 100);
      } else if (i.status === 'concluido') {
        pct = 100;
      }
      const id = _escWith(esc, i.id);
      const titulo = _escWith(esc, i.titulo);
      const status = _escWith(esc, i.status);

      return `<div class="card" style="padding:16px">
        <div style="font-weight:600;font-size:14px;margin-bottom:4px">${titulo}</div>
        ${i.etapa_atual_id && i.status === 'em_andamento' ? `<div style="font-size:12px;color:var(--ink3);margin-bottom:6px">Etapa atual: <strong>${_escWith(esc, etapas.find(e => e.id === i.etapa_atual_id)?.nome || i.etapa_atual_id)}</strong></div>` : ''}
        ${badge(statusLabels[i.status] || i.status, statusCores[i.status] || '#6b7280')}
        ${etapas.length > 1 && i.status === 'em_andamento' ? `
        <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:10px;align-items:center">
          ${etapas.map((e, idx) => {
            const concluida = idx < idxAtual;
            const ativa = idx === idxAtual;
            let bg = 'var(--bdr)';
            if (concluida) bg = '#10b981';
            else if (ativa) bg = '#3b82f6';
            return `<div style="height:4px;flex:1;border-radius:2px;background:${bg}" title="${_escWith(esc, e.nome)}"></div>`;
          }).join('')}
        </div>
        <div style="font-size:11px;color:var(--ink3);margin-top:4px">${pct}% concluido</div>` : ''}
        <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">
          <button type="button" class="btn btn-sm" onclick="wfAbrirHistorico('${id}','${titulo}','${status}')">Ver historico</button>
          ${i.status === 'em_andamento' && podeGerenciar ? `<button type="button" class="btn btn-sm" onclick="wfSuspenderInstancia('${id}')">Suspender</button>` : ''}
          ${i.status === 'suspenso' && podeGerenciar ? `<button type="button" class="btn btn-p btn-sm" onclick="wfRetomarInstancia('${id}')">Retomar</button>` : ''}
          ${i.status === 'em_andamento' && podeGerenciar ? `<button type="button" class="btn btn-r btn-sm" onclick="wfConfirmarCancelar('${id}')">Cancelar</button>` : ''}
          ${i.status === 'cancelado' && podeGerenciar ? `<button type="button" class="btn btn-r btn-sm" onclick="wfExcluirInstancia('${id}')">🗑 Excluir</button>` : ''}
        </div>
      </div>`;
    }).join('');
  }

  globalScope.wfWorkflowRenderer = {
    renderNotificacoes,
    renderTarefasCards,
    renderInstanciasCards,
  };
})(globalThis);
