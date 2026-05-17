(function initAutoLogout(globalScope){
  const INACTIVITY_MS   = 30 * 60 * 1000; // 30 min até logout
  const INACTIVITY_WARN = 60 * 1000;       // aviso 60s antes
  const INACT_EVENTS = ['mousemove','mousedown','keydown','touchstart','scroll','click','input','wheel','pointermove'];

  let _inactTimer    = null;
  let _inactWarnTimer = null;
  let _inactInterval = null;

  function _showInactivityWarning(){
    const w = document.getElementById('inactivity-warning');
    if(!w) return;
    let secs = 60;
    const el = document.getElementById('inactivity-countdown');
    if(el) el.textContent = secs;
    w.style.display = 'flex';
    _inactInterval = setInterval(()=>{
      secs--;
      if(el) el.textContent = secs;
      if(secs <= 0) clearInterval(_inactInterval);
    }, 1000);
  }

  function _resetInactivityTimer(){
    clearTimeout(_inactTimer);
    clearTimeout(_inactWarnTimer);
    clearInterval(_inactInterval);
    const w = document.getElementById('inactivity-warning');
    if(w) w.style.display = 'none';
    _inactWarnTimer = setTimeout(_showInactivityWarning, INACTIVITY_MS - INACTIVITY_WARN);
    _inactTimer     = setTimeout(_doInactivityLogout,    INACTIVITY_MS);
  }

  async function _doInactivityLogout(){
    _stopInactivityWatch();
    if(typeof globalScope.toast === 'function') globalScope.toast('Sessão encerrada por inatividade.', 'var(--amber)');
    if(typeof globalScope.doLogout === 'function') await globalScope.doLogout();
  }

  function _onVisibilityChange(){
    if(document.visibilityState === 'visible') _resetInactivityTimer();
  }

  function _startInactivityWatch(){
    INACT_EVENTS.forEach(e => document.addEventListener(e, _resetInactivityTimer, {passive: true}));
    document.addEventListener('visibilitychange', _onVisibilityChange);
    window.addEventListener('focus', _resetInactivityTimer);
    _resetInactivityTimer();
  }

  function _stopInactivityWatch(){
    INACT_EVENTS.forEach(e => document.removeEventListener(e, _resetInactivityTimer));
    document.removeEventListener('visibilitychange', _onVisibilityChange);
    window.removeEventListener('focus', _resetInactivityTimer);
    clearTimeout(_inactTimer);
    clearTimeout(_inactWarnTimer);
    clearInterval(_inactInterval);
    const w = document.getElementById('inactivity-warning');
    if(w) w.style.display = 'none';
  }

  globalScope._resetInactivityTimer  = _resetInactivityTimer;
  globalScope._startInactivityWatch  = _startInactivityWatch;
  globalScope._stopInactivityWatch   = _stopInactivityWatch;
  globalScope._keepSessionAlive      = _resetInactivityTimer;
})(globalThis);
