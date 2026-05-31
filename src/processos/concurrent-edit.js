(function initConcurrentEdit(globalScope){
  globalScope._fbLoadedAt    = 0;
  globalScope._fbDataReady   = false;

  // Estado compartilhado — espelhado no padrão do módulo de projetos
  const _fbState = {
    saving:        false,  // true durante fbSaveAll; snapshots são pausados
    pendingRender: false,  // true se chegou update remoto enquanto salvava
    ownSaveGrace:  false,  // true por 3s após save próprio; suprime banner falso-positivo
    listenersStarted: false,
    unsubscribers: [],
    pollTimer: null
  };
  globalScope._fbState = _fbState;

  // ── Re-render após receber dados remotos ──────────────────────────────────
  // Usa _renderCurrentPage (definida em processos.html) para atualizar
  // qualquer página que o usuário estiver vendo, não só a lista de processos.
  function _cloudRender(){
    if(_fbState.saving){ _fbState.pendingRender = true; return; }
    if(typeof globalScope._renderCurrentPage === 'function'){
      globalScope._renderCurrentPage();
    } else if(typeof globalScope.renderProcs === 'function'){
      globalScope.renderProcs();
    }
  }

  // ── Polling: fallback para redes que bloqueiam WebSocket (proxies corp.) ──
  // Lê apenas o sentinel last_modified (1 doc) e recarrega todas as coleções
  // somente se outro usuário tiver salvo após o nosso último carregamento.
  const POLL_INTERVAL_MS = 30000;

  // Mesma lista de coleções do onSnapshot; usada no fallback de polling
  const POLL_COLLECTIONS = [
    {repo: 'processosRepository',   fn: '_replaceProcessos'},
    {repo: 'kpisRepository',        fn: '_replaceKpis'},
    {repo: 'publicacoesRepository', fn: '_replacePublicacoes'},
    {repo: 'solicitacoesRepository',fn: '_replaceSolicitacoes'},
    {repo: 'planoRepository',       fn: '_replacePlano'},
    {repo: 'trilhasRepository',     fn: '_replaceTrilhas'},
    {repo: 'planoMetasRepository',  fn: '_replaceMetas'},
  ];

  function _wrapSnapDoc(docEntry){
    return {
      data: function(){ return docEntry.data; }
    };
  }

  function _makeFakeSnapshot(colSnap){
    return {
      forEach: function(cb){
        for(const docEntry of colSnap.docs){
          cb(_wrapSnapDoc(docEntry));
        }
      }
    };
  }

  async function _pollOnce(){
    if(!globalScope.fbReady?.()) return;
    if(!globalScope._fbDataReady) return;
    if(_fbState.saving) return;
    try {
      const snap = await globalScope.configRepository.get('last_modified');
      if(!snap.exists()) return;
      const d = snap.data();
      const ts  = d?.ts  || 0;
      const by  = d?.by  || '';
      // Só recarrega se a mudança é de outro usuário e mais nova que nosso estado
      if(ts <= (globalScope._fbLoadedAt || 0)) return;
      if(by && by === (globalScope.usuarioLogado?.email || '')) return;

      // Recarrega todas as coleções monitoradas
      for(const item of POLL_COLLECTIONS){
        const repo = globalScope[item.repo];
        const replaceFn = globalScope[item.fn];
        if(!repo || typeof replaceFn !== 'function') continue;
        try {
          const colSnap = await repo.list();
          if(!colSnap.empty){
            // list() retorna d.data como objeto; adapta para o formato forEach esperado
            const fakeSnap = _makeFakeSnapshot(colSnap);
            replaceFn(fakeSnap);
          }
        } catch(colErr){ console.warn('_pollOnce (' + item.repo + '):', colErr.message); }
      }

      globalScope._fbLoadedAt = ts;
      _cloudRender();
    } catch(e){
      console.warn('_pollOnce:', e.message);
    }
  }

  function _startPolling(){
    if(_fbState.pollTimer) return;
    _fbState.pollTimer = setInterval(_pollOnce, POLL_INTERVAL_MS);
  }

  // ── Listeners em tempo real (mesmo padrão de projFbStartRealtime) ─────────
  function _fbWatchExternalChanges(){
    if(!globalScope.fbReady?.()) return;
    if(_fbState.listenersStarted) return;

    _fbState.listenersStarted = true;

    // Tenta onSnapshot (WebSocket); inicia polling como fallback garantido
    try {
      const {onSnapshot} = globalScope.fb();
      if(onSnapshot){
        // Coleções com listener dedicado
        const watched = [
          {repo: 'processosRepository',   fn: '_replaceProcessos'},
          {repo: 'kpisRepository',        fn: '_replaceKpis'},
          {repo: 'publicacoesRepository', fn: '_replacePublicacoes'},
          {repo: 'solicitacoesRepository',fn: '_replaceSolicitacoes'},
          {repo: 'planoRepository',       fn: '_replacePlano'},
          {repo: 'trilhasRepository',     fn: '_replaceTrilhas'},
          {repo: 'planoMetasRepository',  fn: '_replaceMetas'},
        ];
        watched.forEach(function(item){
          const repo = globalScope[item.repo];
          if(!repo) return;
          _fbState.unsubscribers.push(
            onSnapshot(
              repo.colRef(),
              function(snap){
                if(!globalScope._fbDataReady) return;
                if(_fbState.saving){ _fbState.pendingRender = true; return; }
                if(typeof globalScope[item.fn] === 'function') globalScope[item.fn](snap);
                _cloudRender();
              },
              function(err){ console.warn('_fbWatchExternalChanges (' + item.repo + '):', err.message); }
            )
          );
        });
      }
    } catch(e){
      console.warn('_fbWatchExternalChanges: onSnapshot indisponível —', e.message);
    }

    // Polling sempre ativo como garantia (30s)
    _startPolling();
  }

  // ── Funções de compatibilidade (banner mantido para erros manuais) ─────────
  function _fbShowConcurrentBanner(byEmail){
    const banner = document.getElementById('concurrent-banner');
    if(!banner) return;
    const msg = document.getElementById('concurrent-msg');
    if(msg) msg.textContent = 'Dados foram modificados por ' + (byEmail || 'outro dispositivo') + '.';
    banner.style.display = 'flex';
  }

  function _fbDismissBanner(){
    const banner = document.getElementById('concurrent-banner');
    if(banner) banner.style.display = 'none';
    globalScope._fbLoadedAt = Date.now();
  }

  async function _fbReloadData(){
    const banner = document.getElementById('concurrent-banner');
    if(banner) banner.style.display = 'none';
    clearTimeout(globalScope._fbSaveTimer);
    if(typeof globalScope.toast === 'function') globalScope.toast('Recarregando dados do servidor…', 'var(--blue)');
    try {
      if(typeof globalScope.fbLoad === 'function') await globalScope.fbLoad();
      globalScope._fbLoadedAt = Date.now();
      const pAtivo = document.querySelector('.page.on');
      if(pAtivo){
        const id = pAtivo.id.replace('page-', '');
        if(typeof globalScope.go === 'function') globalScope.go(id, document.getElementById('nb-' + id) || null);
      }
      if(typeof globalScope.toast === 'function') globalScope.toast('✓ Dados recarregados do servidor', 'var(--teal)');
    } catch(e){
      if(typeof globalScope.toast === 'function') globalScope.toast('⚠ Erro ao recarregar: ' + e.message, 'var(--red)');
    }
  }

  globalScope._fbShowConcurrentBanner = _fbShowConcurrentBanner;
  globalScope._fbDismissBanner        = _fbDismissBanner;
  globalScope._fbReloadData           = _fbReloadData;
  globalScope._fbWatchExternalChanges = _fbWatchExternalChanges;
})(globalThis);