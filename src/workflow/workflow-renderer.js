(function initWorkflowRenderer(globalScope) {
  'use strict';

  function _escWith(esc, value) {
    return typeof esc === 'function' ? esc(value) : String(value ?? '');
  }

  const _NOTIF_ICONE = {
    tarefa_criada:   { icon: '📋', cor: '#3b82f6' },
    tarefa_concluida:{ icon: '✅', cor: '#10b981' },
    tarefa_delegada: { icon: '🔁', cor: '#f59e0b' },
    tarefa_vencida:  { icon: '⚠️', cor: '#ef4444' },
    prazo_proximo:   { icon: '⏰', cor: '#f97316' },
  };

  function renderNotificacoes(notifs, esc) {
    if (!notifs.length) {
      return '<div style="color:var(--ink3);font-size:14px;padding:16px 0">Nenhuma notificação.</div>';
    }
    return notifs.map(n => {
      const meta = _NOTIF_ICONE[n.tipo] || { icon: '🔔', cor: '#6b7280' };
      const ts = (n.criado_em?._seconds ?? n.criado_em?.seconds ?? n._criado_em?.seconds)
        ? new Date((n.criado_em?._seconds ?? n.criado_em?.seconds ?? n._criado_em?.seconds) * 1000).toLocaleString('pt-BR')
        : '—';
      const bg = n.lida ? 'var(--bg)' : '#eff6ff';
      const borderLeft = n.lida ? '3px solid var(--bdr)' : `3px solid ${meta.cor}`;
      const id = _escWith(esc, n.id);
      const instanciaId = _escWith(esc, n.instancia_id || '');
      const titulo = _escWith(esc, n.titulo || '');
      return `<div style="background:${bg};border:1px solid var(--bdr);border-left:${borderLeft};border-radius:8px;padding:12px 14px;margin-bottom:8px;cursor:pointer;display:flex;gap:12px;align-items:flex-start"
        onclick="wfMarcarNotifLida('${id}','${instanciaId}','${titulo}','${instanciaId}')">
        <div style="font-size:20px;flex-shrink:0;line-height:1.3">${meta.icon}</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:${n.lida ? '400' : '700'};font-size:13px;color:var(--ink)">${_escWith(esc, n.titulo || '')}</div>
          <div style="font-size:12px;color:var(--ink2);margin-top:3px;line-height:1.5">${_escWith(esc, n.mensagem || '')}</div>
          <div style="font-size:11px;color:var(--ink3);margin-top:5px">${ts}${n.lida ? '' : ' · <strong style="color:' + meta.cor + '">Não lida</strong>'}</div>
        </div>
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
        ? `<button type="button" class="btn btn-p btn-sm" onclick="wfAssumirEAbrirTarefa('${id}')">Acessar</button>
          <button type="button" class="btn btn-sm" onclick="wfAssumirTarefa('${id}')">Só assumir</button>`
        : `<button type="button" class="btn btn-p btn-sm" onclick="wfAbrirTarefa('${id}')">Acessar</button>
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
    const { esc, badge, podeGerenciar, isEp, statusLabels, statusCores } = opts;
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
      const agendadoPara = i.agendado_para
        ? (typeof i.agendado_para.toDate === 'function' ? i.agendado_para.toDate() : new Date(i.agendado_para._seconds * 1000))
        : null;
      const agendadoHtml = agendadoPara
        ? `<div style="font-size:12px;color:#8b5cf6;margin-top:4px;margin-bottom:4px">🗓 Agendado para: <strong>${agendadoPara.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</strong></div>`
        : '';
      const btnAtivar = i.status === 'agendado' && isEp
        ? `<button type="button" class="btn btn-sm" onclick="wfAtivarInstanciaAgora('${id}')" style="background:var(--violet,#8b5cf6);color:#fff;border-color:transparent">▶ Ativar agora</button>`
        : '';

      return `<div class="card" style="padding:16px">
        <div style="font-weight:600;font-size:14px;margin-bottom:4px">${titulo}</div>
        ${i.etapa_atual_id && i.status === 'em_andamento' ? `<div style="font-size:12px;color:var(--ink3);margin-bottom:6px">Etapa atual: <strong>${_escWith(esc, etapas.find(e => e.id === i.etapa_atual_id)?.nome || i.etapa_atual_id)}</strong></div>` : ''}
        ${badge(statusLabels[i.status] || i.status, statusCores[i.status] || '#6b7280')}
        ${agendadoHtml}
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
          <button type="button" class="btn btn-sm" onclick="wfAbrirHistorico('${id}','${titulo}','${status}')">Ver histórico</button>
          ${btnAtivar}
          ${i.status === 'em_andamento' && podeGerenciar ? `<button type="button" class="btn btn-sm" onclick="wfSuspenderInstancia('${id}')">Suspender</button>` : ''}
          ${i.status === 'suspenso' && podeGerenciar ? `<button type="button" class="btn btn-p btn-sm" onclick="wfRetomarInstancia('${id}')">Retomar</button>` : ''}
          ${(i.status === 'em_andamento' || i.status === 'agendado') && podeGerenciar ? `<button type="button" class="btn btn-r btn-sm" onclick="wfConfirmarCancelar('${id}')">Cancelar</button>` : ''}
          ${(i.status === 'cancelado' && podeGerenciar) || isEp ? `<button type="button" class="btn btn-r btn-sm" onclick="wfExcluirInstancia('${id}')">🗑 Excluir</button>` : ''}
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
