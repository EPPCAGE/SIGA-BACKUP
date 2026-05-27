// ═══════════════════════════════════════════════════════════════════
// MÓDULO DE PROJETOS — CAGE-RS
// scripts.js contém apenas a lógica do módulo de projetos.
// Dependências compartilhadas de autenticação/sessão ficam em projetos.shared.js.
// ═══════════════════════════════════════════════════════════════════

let _projScheduleWriteContext = false;
function projApplyOrgBranding(){
  const noreplySuggestion = document.getElementById('proj-ejs-noreply-suggestion');
  if(noreplySuggestion) noreplySuggestion.textContent = ORG_CONFIG.noreplySuggestion;
  const subjectExample = document.getElementById('proj-ejs-subject-example');
  if(subjectExample) subjectExample.textContent = ORG_CONFIG.notificationFromName+' — Tarefa pendente: {{processo}}';
  const bodyExample = document.getElementById('proj-ejs-body-example');
  if(bodyExample){
    bodyExample.textContent = [
      'Olá, {{to_name}}.',
      '',
      'Você tem uma nova tarefa pendente no sistema '+ORG_CONFIG.systemBrand+':',
      '',
      'Processo: {{processo}}',
      'Ação necessária: {{acao}}',
      'Prazo: {{prazo}}',
      'Enviado por: {{from_name}}',
      '',
      'Acesse o sistema para realizar a ação:',
      '{{link}}',
      '',
      '---',
      ORG_CONFIG.automaticEmailFooter,
      'Não responda este e-mail.'
    ].join('\n');
  }
}
projApplyOrgBranding();
function projCanWriteAll(){ return isEP(); }
function projProjetosVinculadosUsuario(u = usuarioLogado){
  return Array.isArray(u?.projetos_vinculados) ? u.projetos_vinculados.map(id => String(id)) : [];
}
function projIsLinkedManager(projectId = _projCurrentId, u = usuarioLogado){
  return isGerenteProjeto() && projProjetosVinculadosUsuario(u).includes(String(projectId || ''));
}
function projCanWriteExec(){ return isEP(); }
function projCanWriteSchedule(projectId = _projCurrentId){ return isEP() || projIsLinkedManager(projectId); }
function projCanViewOnly(){ return !isEP(); }
function projEnsureWriteAll(msg='Apenas EPP pode editar esta seção do módulo de projetos.'){
  if(projCanWriteAll()) return true;
  projToast(msg, '#d97706');
  return false;
}
function projEnsureWriteExec(msg='Apenas EPP pode executar esta ação.'){
  if(projCanWriteExec()) return true;
  projToast(msg, '#d97706');
  return false;
}
function projEnsureWriteSchedule(msg='O perfil Projetos só pode editar o cronograma dos projetos vinculados.'){
  if(projCanWriteSchedule()) return true;
  projToast(msg, '#d97706');
  return false;
}
function projWithScheduleWrite(fn){
  if(!projEnsureWriteSchedule()) return;
  _projScheduleWriteContext = true;
  try { return fn(); }
  finally { _projScheduleWriteContext = false; }
}

function projLocalDateKey(date = new Date()){
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function projCloneScheduleTasks(tarefas){
  return JSON.parse(JSON.stringify(tarefas || []));
}

function projScheduleTasksCount(tarefas){
  return (tarefas || []).reduce((acc, t) => acc + 1 + projScheduleTasksCount(t.subtarefas || []), 0);
}

function projScheduleHasTasks(proj){
  return Array.isArray(proj?.execucao?.tarefas) && proj.execucao.tarefas.length > 0;
}

function projEnsureScheduleBackupBag(exec){
  if(!exec.cron_backups || Array.isArray(exec.cron_backups) || typeof exec.cron_backups !== 'object') exec.cron_backups = {};
  return exec.cron_backups;
}

function projPruneScheduleBackups(backups){
  const keys = Object.keys(backups || {}).sort((a, b) => a.localeCompare(b));
  while(keys.length > PROJ_SCHEDULE_BACKUP_MAX_DAYS){
    delete backups[keys.shift()];
  }
}

function projEnsureProjectDailyScheduleBackup(proj, dateKey = projLocalDateKey()){
  if(!projScheduleHasTasks(proj)) return false;
  if(!proj.execucao) proj.execucao = {};
  const backups = projEnsureScheduleBackupBag(proj.execucao);
  if(backups[dateKey]) return false;
  backups[dateKey] = {
    data: dateKey,
    criado_em: new Date().toISOString(),
    tarefas: projCloneScheduleTasks(proj.execucao.tarefas)
  };
  projPruneScheduleBackups(backups);
  return true;
}

function projPersistDailyScheduleBackups(){
  if(fbReady()){
    if(isEP()) projFbAutoSave('projetos').catch(()=>{});
    else if(_projCurrentId && projCanWriteSchedule(_projCurrentId)) projFbSaveCurrentScheduleProject().catch(e=>console.warn('projPersistDailyScheduleBackups:', e.message));
    return;
  }
  try { localStorage.setItem(PROJ_STORAGE_KEY, JSON.stringify(PROJETOS||[])); } catch(_e){}
}

function projEnsureDailyScheduleBackups(options = {}){
  const dateKey = options.dateKey || projLocalDateKey();
  let changed = false;
  (PROJETOS || []).forEach(proj => {
    if(projEnsureProjectDailyScheduleBackup(proj, dateKey)) changed = true;
  });
  if(changed && options.persist !== false) projPersistDailyScheduleBackups();
  return changed;
}

function projEnsureCurrentScheduleBackupBeforeMutation(proj){
  return projEnsureProjectDailyScheduleBackup(proj);
}

function _fsCleanArray(v, insideArray){
  const arr = v.map(item => _fsClean(item, true));
  return insideArray ? { items: arr } : arr;
}

function _fsCanCleanObject(v){
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function _fsCleanKeyAllowed(k, value){
  return !['__proto__', 'constructor', 'prototype'].includes(k) && value !== undefined;
}

function _fsCleanObject(v){
  if(!_fsCanCleanObject(v)) return null;
  const r = {};
  for(const k of Object.keys(v)){
    if(!_fsCleanKeyAllowed(k, v[k])) continue;
    Object.defineProperty(r, k, {
      value: _fsClean(v[k], false),
      enumerable: true,
      writable: true,
      configurable: true
    });
  }
  return r;
}

function _fsCleanScalar(v){
  if(typeof v === 'number') return Number.isFinite(v) ? v : null;
  if(typeof v === 'function' || typeof v === 'symbol') return null;
  return v;
}

function _fsClean(v, insideArray){
  if(v===null||v===undefined) return null;
  if(v instanceof Date) return v;
  if(Array.isArray(v)) return _fsCleanArray(v, insideArray);
  if(typeof v==='object') return _fsCleanObject(v);
  return _fsCleanScalar(v);
}

let PROJETOS = [];
let PROGRAMAS = [];
let _projCurrentId = null; // ID do projeto em visualização
let _projCurrentPage = 'inicio';
let _projCurrentWorkflowTab = null;
let _projScheduleBackupLastDate = projLocalDateKey();
let _projReunioesCalendarMonth = null;
let _progCurrentId = null; // ID do programa em visualização
const PROJ_STORAGE_KEY = 'cagePROJETOS_v6';
const PROG_STORAGE_KEY = 'cagePROGRAMAS_v6';
const PROJ_SCHEDULE_BACKUP_MAX_DAYS = 14;

// ── Fases do workflow ────────────────────────────────────────────
const PROJ_FASES = [
  { id:'aprovacao',   label:'Aprovação',          short:'Aprovação'   },
  { id:'ideacao',     label:'Ideação',             short:'Ideação'     },
  { id:'planejamento',label:'Planejamento',        short:'Planejamento'},
  { id:'execucao',    label:'Execução/Monit.',     short:'Execução'    },
  { id:'conclusao',   label:'Conclusão',           short:'Conclusão'   },
];
const FASE_IDX = Object.fromEntries(PROJ_FASES.map((f,i)=>[f.id,i]));

let PROJ_MACROS = [
  '[Gestão] Gestão estratégica','[Gestão] Comunicação e relacionamento institucional',
  '[Finalístico] Orientação e suporte à tomada de decisão','[Finalístico] Contabilidade',
  '[Finalístico] Transparência e estímulo ao controle social','[Finalístico] Controle',
  '[Finalístico] Auditoria','[Finalístico] Promoção da integridade e prevenção à corrupção',
  '[Apoio] Gestão de dados e informações','[Apoio] Gestão administrativa',
  '[Apoio] Gestão de TIC','[Apoio] Gestão de pessoas'
];
let PROJ_OBJETIVOS = [
  '[Resultados] Colaborar para a implementação de políticas públicas efetivas',
  '[Resultados] Aperfeiçoar a transparência pública e fomentar o controle social',
  '[Resultados] Promover a integridade pública e privada e fortalecer a prevenção à corrupção',
  '[Resultados] Otimizar a utilização dos recursos públicos',
  '[Articulação] Aprimorar o assessoramento aos gestores públicos',
  '[Articulação] Fortalecer a credibilidade e a imagem da CAGE',
  '[Processos] Desenvolver modelo de controle baseado em riscos e orientado pela utilização de dados',
  '[Processos] Sistematizar e implementar modelo de avaliação de políticas públicas',
  '[Processos] Reestruturar as ações de transparência, com foco no cidadão',
  '[Processos] Qualificar a informação contábil',
  '[Processos] Otimizar a contribuição da auditoria para o aprimoramento da gestão pública estadual',
  '[Processos] Promover a cultura de integridade na Administração Pública',
  '[Processos] Otimizar os processos de trabalho, com foco em eficiência operacional e automação',
  '[Aprendizado] Gerir as pessoas com foco na estratégia',
  '[Aprendizado] Aperfeiçoar a governança organizacional e fortalecer a cultura de colaboração e inovação',
  '[Aprendizado] Promover uma comunicação interna mais efetiva',
  '[Aprendizado] Assegurar serviços de TIC para suportar os processos e a estratégia'
];
const PROJ_FB = Object.freeze({
  colProjetos: 'projPROJETOS',
  colProgramas: 'projPROGRAMAS',
  cfgCol: 'config',
  cfgMacrosId: 'projPROJ_MACROS',
  cfgObjetivosId: 'proj_objetivos'
});
const _projFbState = {loaded:false, loading:false, saveTimer:null, listenersStarted:false, unsubscribers:[], saving:false, pendingRender:false};

function projRepositoryFor(col){
  if(col === PROJ_FB.colProjetos) return projetosRepository;
  if(col === PROJ_FB.colProgramas) return programasRepository;
  return FirestoreRepositories.collection(col);
}

function projApplyDataSet(data){
  PROJETOS = Array.isArray(data?.projetos) ? data.projetos.map(function(p){return projFixDefaults(p);}) : [];
  PROGRAMAS = Array.isArray(data?.programas) ? data.programas.map(function(pg){return progFixDefaults(pg);}) : [];
  if(Array.isArray(data?.macros)) PROJ_MACROS = data.macros;
  if(Array.isArray(data?.objetivos)) PROJ_OBJETIVOS = data.objetivos;
}

async function projFetchDefaultData(){
  try{
    const res = await fetch('projetos-default.json', {cache:'no-store'});
    if(!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data?.projetos) ? data : null;
  }catch(e){
    console.warn('projFetchDefaultData:', e.message);
    return null;
  }
}

function projLoadListas(){
  if(fbReady()) return;
  try{
    const m=localStorage.getItem('cagePROJ_MACROS_v6');if(m)PROJ_MACROS=JSON.parse(m);
    const o=localStorage.getItem('cage_objetivos_v6');if(o)PROJ_OBJETIVOS=JSON.parse(o);
  }catch(e){}
}
function projSaveListas(){
  if(!projEnsureWriteAll('Apenas EPP pode editar Macroprocessos e Objetivos Estratégicos.')) return false;
  if(!fbReady()){
    localStorage.setItem('cagePROJ_MACROS_v6',JSON.stringify(PROJ_MACROS));
    localStorage.setItem('cage_objetivos_v6',JSON.stringify(PROJ_OBJETIVOS));
  }
  projFbAutoSave('listas');
  return true;
}

async function projFbSyncCollection(col, items){
  await FirestoreRepositories.syncCollection(projRepositoryFor(col), items, _fsClean, 400);
}

async function projFbSaveCurrentScheduleProject(){
  if(!fbReady()) throw new Error('Firebase indisponível.');
  const proj = (PROJETOS||[]).find(p => String(p.id) === String(_projCurrentId));
  if(!proj) throw new Error('Projeto não encontrado.');
  const exec = proj.execucao || {};
  await projetosRepository.set(proj.id, _fsClean({
    percentual: proj.percentual || 0,
    execucao: {
      planner_link: exec.planner_link || '',
      percentual: exec.percentual || proj.percentual || 0,
      tarefas: exec.tarefas || [],
      cron_backups: exec.cron_backups || {},
      cron_mode: exec.cron_mode || 'planner',
      pct_mode: exec.pct_mode || 'manual'
    }
  }), { merge: true });
}

async function projFbSaveAll(options){
  const includeConfig = !options || options.includeConfig !== false;
  if(!fbReady()) throw new Error('Firebase indisponível.');
  _projFbState.saving = true;
  try{
    await projFbSyncCollection(PROJ_FB.colProjetos, PROJETOS||[]);
    await projFbSyncCollection(PROJ_FB.colProgramas, PROGRAMAS||[]);
    if(includeConfig){
      await configRepository.set(PROJ_FB.cfgMacrosId, {data: JSON.stringify(PROJ_MACROS||[])});
      await configRepository.set(PROJ_FB.cfgObjetivosId, {data: JSON.stringify(PROJ_OBJETIVOS||[])});
    }
    try{
      localStorage.setItem(PROJ_STORAGE_KEY, JSON.stringify(PROJETOS||[]));
      localStorage.setItem(PROG_STORAGE_KEY, JSON.stringify(PROGRAMAS||[]));
      localStorage.setItem('cagePROJ_MACROS_v6', JSON.stringify(PROJ_MACROS||[]));
      localStorage.setItem('cage_objetivos_v6', JSON.stringify(PROJ_OBJETIVOS||[]));
    }catch(_e){}
  } finally {
    _projFbState.saving = false;
    if(_projFbState.pendingRender){
      _projFbState.pendingRender = false;
      projRenderCurrentPage();
    }
  }
}

function projFbAutoSave(label){
  if(!fbReady()) return Promise.resolve();
  clearTimeout(_projFbState.saveTimer);
  _projFbState.saving = true;
  return new Promise((resolve, reject)=>{
    _projFbState.saveTimer = setTimeout(()=>{
    projFbSaveAll({includeConfig: label === 'listas' || label === 'importar'}).catch(e=>{
      console.warn('projFbAutoSave('+label+'):', e.message);
      try { projToast('Erro ao salvar na nuvem: ' + e.message, '#dc2626'); } catch(_e){}
      _projFbState.saving = false;
      reject(e);
    }).then(resolve);
    }, 500);
  });
}

function projRenderCurrentPage(){
  const active = document.querySelector('.proj-nav-btn.on');
  const page = _projCurrentPage || (active ? (active.id||'').replace('pnb-','') : 'inicio');
  if(document.getElementById('proj-shell')?.classList.contains('on')){
    if(page === 'detalhe' && _projCurrentId){
      projAbrirDetalhe(_projCurrentId, false, true);
      return;
    }
    const btn = document.getElementById('pnb-' + page) || active || document.getElementById('pnb-inicio');
    projGo(page || 'inicio', btn);
  }
}

function projCacheCloudState(){
  try{
    localStorage.setItem(PROJ_STORAGE_KEY, JSON.stringify(PROJETOS||[]));
    localStorage.setItem(PROG_STORAGE_KEY, JSON.stringify(PROGRAMAS||[]));
    localStorage.setItem('cagePROJ_MACROS_v6', JSON.stringify(PROJ_MACROS||[]));
    localStorage.setItem('cage_objetivos_v6', JSON.stringify(PROJ_OBJETIVOS||[]));
  }catch(_e){}
}

function projCloudRender(){
  _projFbState.loaded = true;
  projEnsureDailyScheduleBackups();
  projCacheCloudState();
  if(_projFbState.saving){
    _projFbState.pendingRender = true;
    return;
  }
  projRenderCurrentPage();
}

function projFbStartRealtime(){
  if(!fbReady() || _projFbState.listenersStarted) return;
  const {onSnapshot} = fb();
  if(!onSnapshot) return;
  _projFbState.listenersStarted = true;
  _projFbState.unsubscribers = [
    onSnapshot(projetosRepository.colRef(), snap => {
      if(_projFbState.saving){ _projFbState.pendingRender = true; return; }
      PROJETOS = [];
      snap.forEach(d => PROJETOS.push(projFixDefaults(d.data())));
      projCloudRender();
    }, e => console.warn('proj projetos snapshot:', e.message)),
    onSnapshot(programasRepository.colRef(), snap => {
      if(_projFbState.saving){ _projFbState.pendingRender = true; return; }
      PROGRAMAS = [];
      snap.forEach(d => PROGRAMAS.push(progFixDefaults(d.data())));
      projCloudRender();
    }, e => console.warn('proj programas snapshot:', e.message)),
    onSnapshot(configRepository.ref(PROJ_FB.cfgMacrosId), snap => {
      if(_projFbState.saving){ _projFbState.pendingRender = true; return; }
      if(snap.exists() && typeof snap.data()?.data === 'string'){
        try{ PROJ_MACROS = JSON.parse(snap.data().data); }catch(_e){}
        projCloudRender();
      }
    }, e => console.warn('proj macros snapshot:', e.message)),
    onSnapshot(configRepository.ref(PROJ_FB.cfgObjetivosId), snap => {
      if(_projFbState.saving){ _projFbState.pendingRender = true; return; }
      if(snap.exists() && typeof snap.data()?.data === 'string'){
        try{ PROJ_OBJETIVOS = JSON.parse(snap.data().data); }catch(_e){}
        projCloudRender();
      }
    }, e => console.warn('proj objetivos snapshot:', e.message))
  ];
}

async function projFbSeedIfEmpty(pSnap, gSnap){
  if(!pSnap.empty || !gSnap.empty) return false;
  const defaultData = await projFetchDefaultData();
  if(defaultData){
    projApplyDataSet(defaultData);
    await projFbSaveAll();
    return true;
  }
  if((PROJETOS||[]).length || (PROGRAMAS||[]).length){
    await projFbSaveAll();
    return true;
  }
  return false;
}

function projFbApplyCollectionSnaps(pSnap, gSnap){
  if(!pSnap.empty){
    PROJETOS = [];
    pSnap.docs.forEach(d=>PROJETOS.push(projFixDefaults(d.data)));
  }
  if(!gSnap.empty){
    PROGRAMAS = [];
    gSnap.docs.forEach(d=>PROGRAMAS.push(progFixDefaults(d.data)));
  }
}

async function projFbLoadConfigDoc(cfgId, currentData, applyData){
  const snap = await configRepository.get(cfgId);
  if(snap.exists() && typeof snap.data()?.data === 'string'){
    try{ applyData(JSON.parse(snap.data().data)); }catch(_e){}
    return;
  }
  await configRepository.set(cfgId, {data: JSON.stringify(currentData||[])});
}

async function projFbLoadOnce(){
  if(!fbReady() || _projFbState.loaded || _projFbState.loading) return;
  _projFbState.loading = true;
  try{
    const [pSnap, gSnap] = await Promise.all([
      projetosRepository.list(),
      programasRepository.list()
    ]);

    // Fallback/migração: se a nuvem estiver vazia, semeia pela base padrão versionada.
    const seeded = await projFbSeedIfEmpty(pSnap, gSnap);
    if(!seeded) projFbApplyCollectionSnaps(pSnap, gSnap);
    await Promise.all([
      projFbLoadConfigDoc(PROJ_FB.cfgMacrosId, PROJ_MACROS, data => { PROJ_MACROS = data; }),
      projFbLoadConfigDoc(PROJ_FB.cfgObjetivosId, PROJ_OBJETIVOS, data => { PROJ_OBJETIVOS = data; })
    ]);

    projFbStartRealtime();

    projCloudRender();
  } catch(e){ console.warn('projFbLoadOnce:', e.message); }
  finally { _projFbState.loading = false; }
}


// ── Persistência ─────────────────────────────────────────────────
function projLoad() {
  if(fbReady()){
    if(!_projFbState.loaded) projFbLoadOnce().catch(e=>console.warn('projLoad/fb:',e.message));
    PROJETOS = (PROJETOS||[]).map(p => projFixDefaults(p));
    PROGRAMAS = (PROGRAMAS||[]).map(pg => progFixDefaults(pg));
    if(_projFbState.loaded) projEnsureDailyScheduleBackups();
    return;
  }
  try {
    const raw = localStorage.getItem(PROJ_STORAGE_KEY);
    PROJETOS = raw ? JSON.parse(raw) : [];
  } catch(e) {
    PROJETOS = [];
  }
  // Ensure each project has proper structure
  PROJETOS = PROJETOS.map(p => projFixDefaults(p));
  projEnsureDailyScheduleBackups();
  // Load programas and lists too
  progLoad();
  projLoadListas();
  projFbLoadOnce().catch(e=>console.warn('projLoad/fb:',e.message));
}

function projSave() {
  if(usuarioLogado && !isEP() && !_projScheduleWriteContext){
    projToast('Seu perfil tem acesso somente de visualização no SIGA Projetos.', '#d97706');
    return false;
  }
  if(usuarioLogado && !isEP() && _projScheduleWriteContext){
    if(fbReady()){
      projFbSaveCurrentScheduleProject().catch(e => {
        console.warn('projFbSaveCurrentScheduleProject:', e.message);
        try { projToast('Erro ao salvar cronograma na nuvem: ' + e.message, '#dc2626'); } catch(_e){}
      });
      return true;
    }
    try {
      localStorage.setItem(PROJ_STORAGE_KEY, JSON.stringify(PROJETOS));
      return true;
    } catch(e) {
      projToast('Erro ao salvar cronograma.', 'var(--red)');
      return false;
    }
  }
  if(fbReady()){
    projFbAutoSave('projetos').catch(()=>{});
    return true;
  }
  try {
    localStorage.setItem(PROJ_STORAGE_KEY, JSON.stringify(PROJETOS));
    projFbAutoSave('projetos');
    return true;
  } catch(e) {
    projToast('Erro ao salvar dados.', 'var(--red)');
    return false;
  }
}

// ── Persistência de Programas ───────────────────────────────────
setInterval(() => {
  const today = projLocalDateKey();
  if(today === _projScheduleBackupLastDate) return;
  _projScheduleBackupLastDate = today;
  projLoad();
  if(projEnsureDailyScheduleBackups() && _projCurrentId && _projCurrentWorkflowTab === 'execucao') {
    projDetalheTab('execucao', document.querySelector('#proj-detalhe-tabs .proj-tab:nth-child(4)'));
  }
}, 60000);

function progLoad() {
  if(fbReady()){
    if(!_projFbState.loaded) projFbLoadOnce().catch(e=>console.warn('progLoad/fb:',e.message));
    PROGRAMAS = (PROGRAMAS||[]).map(pg => progFixDefaults(pg));
    return;
  }
  try {
    const raw = localStorage.getItem(PROG_STORAGE_KEY);
    PROGRAMAS = raw ? JSON.parse(raw) : [];
  } catch(e) {
    PROGRAMAS = [];
  }
  PROGRAMAS = PROGRAMAS.map(pg => progFixDefaults(pg));
}

function progSave() {
  if(usuarioLogado && !isEP()){
    projToast('Apenas EPP pode editar programas.', '#d97706');
    return false;
  }
  if(fbReady()){
    projFbAutoSave('programas').catch(()=>{});
    return true;
  }
  try {
    localStorage.setItem(PROG_STORAGE_KEY, JSON.stringify(PROGRAMAS));
    projFbAutoSave('programas');
    return true;
  } catch(e) {
    projToast('Erro ao salvar programas.', 'var(--red)');
    return false;
  }
}

function progFixDefaults(pg) {
  const now = new Date().toISOString().split('T')[0];
  return {
    id: pg.id || Date.now(),
    nome: pg.nome || 'Sem nome',
    descricao: pg.descricao || '',
    gerente: pg.gerente || '',
    patrocinador: pg.patrocinador || '',
    status: pg.status || 'ativo', // ativo | concluido | cancelado
    dt_criacao: pg.dt_criacao || now
  };
}

// Calcula percentual médio dos projetos do programa (ponderado igualmente)
function progPercentualMedio(programaId) {
  const projs = PROJETOS.filter(p => String(p.programa_id) === String(programaId));
  if(projs.length === 0) return 0;
  const soma = projs.reduce((acc, p) => acc + (p.percentual||0), 0);
  return Math.round(soma / projs.length);
}

function projFixDefaults(p) {
  const now = new Date().toISOString().split('T')[0];
  return {
    id: p.id || Date.now(),
    nome: p.nome || 'Sem nome',
    gerente: p.gerente || '',
    gerente_substituto: p.gerente_substituto || '',
    descricao: p.descricao || '',
    dt_inicio: p.dt_inicio || '',
    dt_fim: p.dt_fim || '',
    patrocinador: p.patrocinador || '',
    fonte: p.fonte || '',
    fase_atual: p.fase_atual || 'aprovacao',
    status: p.status || 'ativo', // ativo | concluido | cancelado
    percentual: p.percentual || 0,
    status_report_obs: p.status_report_obs || '',
    icone_url: p.icone_url || '',
    icone_emoji: p.icone_emoji || '📁',
    divisao: p.divisao || '',
    dt_criacao: p.dt_criacao || now,
    programa_id: p.programa_id || null,
    macroprocessos: p.macroprocessos || [],
    objetivos_estrategicos: p.objetivos_estrategicos || [],
    // Dados de cada fase
    aprovacao: p.aprovacao || {
      motivo_inicio: '', aprovado: false, dt_aprovacao: '', obs: ''
    },
    ideacao: p.ideacao || {
      descricao:'', objetivo_smart:'', beneficios:'',
      requisitos:'', premissas:'', restricoes:'',
      entregas_macro:'', riscos_canvas:'', equipe:'',
      partes_interessadas:'', objetivo_estrategico:'',
      custos:'', resultados_esperados:'', acoes_imediatas:''
    },
    planejamento: p.planejamento || {
      eap_html: '', eap_link: '', riscos: [], planner_link: ''
    },
    execucao: p.execucao || {
      planner_link: '',
      percentual: p.percentual || 0,
      reunioes: []
    },
    conclusao: p.conclusao || {
      tipo: '', // 'sucesso' | 'cancelamento'
      dt_conclusao: '',
      link_termo_aceite: '',
      historia: '',
      links_noticias: ''
    }
  };
}

// ── Navegação interna do módulo de projetos ──────────────────────
function projGo(pageId, btnEl) {
  _projCurrentPage = pageId || 'inicio';
  // Hide all pages
  document.querySelectorAll('.proj-page').forEach(p => p.classList.remove('on'));
  // Deactivate all nav buttons
  document.querySelectorAll('.proj-nav-btn').forEach(b => b.classList.remove('on'));
  // Show target page
  const page = document.getElementById('proj-page-' + pageId);
  if(page) page.classList.add('on');
  if(btnEl) btnEl.classList.add('on');
  // Render page
  switch(pageId) {
    case 'inicio':    projRenderInicio(); break;
    case 'portfolio': projRenderPortfolio(); break;
    case 'concluidos': projRenderConcluidos(); break;
    case 'programas': progRenderPage(); break;
    case 'estrategia': projRenderEstrategiaPage(); break;
    case 'reunioes':  projRenderReunioesPage(); break;
    case 'usuarios':  projRenderUsuariosPage(); break;
    case 'status-report': projRenderStatusReport(); break;
    case 'ppe':       projRenderPpePage(); break;
    case 'indicadores': projRenderIndicadoresPage(); break;
    case 'novo':      projRenderNovo(); break;
  }
}

// ── Sidebar toggle ────────────────────────────────────────────────
function toggleProjSidebar() {
  const aside = document.getElementById('proj-aside');
  const toggle = document.getElementById('proj-sidebar-toggle');
  aside.classList.toggle('collapsed');
  const isCollapsed = aside.classList.contains('collapsed');
  toggle.textContent = isCollapsed ? '▶' : '◀';
  toggle.style.left = isCollapsed ? '0px' : '240px';
  toggle.style.left = isCollapsed ? '0px' : '240px';
}

// ── Toast ──────────────────────────────────────────────────────────
function projToast(msg, color) {
  const el = document.createElement('div');
  el.className = 'proj-toast';
  el.textContent = msg;
  if(color) el.style.background = color;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// ── Utilitários ────────────────────────────────────────────────────
function projEsc(s) {
  return String(s||'')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

function projSafeHtml(html) {
  const value = String(html || '');
  if(globalThis.DOMPurify && typeof globalThis.DOMPurify.sanitize === 'function') {
    return globalThis.DOMPurify.sanitize(value, {
      ADD_ATTR: [
        'target',
        'onclick', 'onchange', 'oninput', 'onblur', 'onkeydown',
        'onmousedown', 'ontouchstart', 'ondblclick',
        'onmouseover', 'onmouseout',
        'ondragstart', 'ondragover', 'ondragend', 'ondrop'
      ],
      FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'base'],
      FORBID_ATTR: ['srcdoc'],
      ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|data):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i
    });
  }
  return projEsc(value);
}

function projSetSafeHtml(el, html) {
  if(!el) return;
  el.innerHTML = projSafeHtml(html);
}

function projAppendSafeHtml(el, position, html) {
  if(!el) return;
  el.insertAdjacentHTML(position, projSafeHtml(html));
}

function projNormKey(s) {
  return String(s||'').trim().toLowerCase();
}

function projUserDisplayName(u) {
  return String(u?.nome || u?.name || u?.email || '').trim();
}

function projUserInitials(label) {
  const parts = String(label||'').trim().split(/\s+/).filter(Boolean);
  if(!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length-1][0] : '')).toUpperCase();
}

function projUsersLinkedToProject(projectId) {
  const id = String(projectId || '');
  return (USUARIOS||[]).filter(u => projProjetosVinculadosUsuario(u).includes(id))
    .slice()
    .sort((a,b) => projUserDisplayName(a).localeCompare(projUserDisplayName(b), 'pt-BR'));
}

function projFindProjectUserByResponsibleValue(projectId, value) {
  const key = projNormKey(value);
  if(!key) return null;
  return projUsersLinkedToProject(projectId).find(u => {
    const nome = projNormKey(projUserDisplayName(u));
    const email = projNormKey(u.email);
    return key === nome || key === email || key === `${nome} <${email}>`;
  }) || null;
}

function projResponsibleLabel(t) {
  const email = projNormKey(t?.responsavel_email);
  if(email) {
    const u = (USUARIOS||[]).find(x => projNormKey(x.email) === email);
    if(u) return projUserDisplayName(u);
  }
  return String(t?.responsavel || '').trim();
}

function projUserByResponsibleText(value) {
  const key = projNormKey(value);
  if(!key) return null;
  return (USUARIOS||[]).find(u => projNormKey(projUserDisplayName(u)) === key || projNormKey(u.email) === key) || null;
}

function projProjectResponsibleOptions(projectId) {
  const users = projUsersLinkedToProject(projectId);
  if(!users.length) return '';
  return `<datalist id="proj-responsaveis-options">${users.map(u => {
    const name = projUserDisplayName(u);
    return `<option value="${projEsc(name)}" label="${projEsc(u.email||'')}"></option>`;
  }).join('')}</datalist>`;
}

function projFaseLabel(id) {
  const f = PROJ_FASES.find(f=>f.id===id);
  return f ? f.label : id;
}

function projFaseBadgeClass(status, fase) {
  if(status === 'concluido') return 'lb-concluido';
  if(status === 'cancelado') return 'lb-cancelado';
  if(fase === 'execucao') return 'lb-execucao';
  if(fase === 'planejamento') return 'lb-planejamento';
  return 'lb-ideacao';
}

function projFaseText(p) {
  if(p.status === 'concluido') return 'Concluído';
  if(p.status === 'cancelado') return 'Cancelado';
  return projFaseLabel(p.fase_atual);
}

function projGetMesAtual() {
  const now = new Date();
  return { mes: now.getMonth(), ano: now.getFullYear() };
}

function projFormatDate(iso) {
  if(!iso) return '';
  const parts = iso.split('-');
  if(parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return iso;
}

// ── CONFIRMAÇÃO DUPLA ─────────────────────────────────────────────
function projParseIsoDate(iso) {
  const parts = String(iso||'').split('-').map(Number);
  if(parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null;
  return { ano: parts[0], mes: parts[1] - 1, dia: parts[2] };
}

function projIsoInMonth(iso, monthValue) {
  const d = projParseIsoDate(iso);
  if(!d || !monthValue) return false;
  const parts = monthValue.split('-').map(Number);
  return d.ano === parts[0] && d.mes === parts[1] - 1;
}

function projMonthValue(date) {
  const d = date || new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2,'0');
}

function projMonthFirstDay(date) {
  return projMonthValue(date) + '-01';
}

function projMonthLabel(monthValue) {
  if(!monthValue) return '';
  const parts = monthValue.split('-').map(Number);
  const d = new Date(parts[0], parts[1] - 1, 1);
  const txt = d.toLocaleDateString('pt-BR', {month:'long', year:'numeric'});
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}

function projIconHtml(p, cls) {
  const klass = cls || 'proj-mini-icon';
  if(p && p.icone_url) return `<span class="${klass}"><img src="${projEsc(p.icone_url)}" alt=""></span>`;
  return `<span class="${klass}">${projEsc((p && p.icone_emoji) || '📁')}</span>`;
}

function projConfirmar(msg, onConfirm) {
  const dialog = document.getElementById('modal-confirm');
  const msgEl = document.getElementById('modal-confirm-msg');
  const okBtn = document.getElementById('modal-confirm-ok');
  if(!dialog || !msgEl || !okBtn) {
    if(confirm(msg)) onConfirm();
    return;
  }
  msgEl.textContent = msg;
  dialog.style.display = 'flex';
  globalThis._projConfirmAction = onConfirm;
}

function _confirmarSim() {
  const dialog = document.getElementById('modal-confirm');
  const action = globalThis._projConfirmAction;
  globalThis._projConfirmAction = null;
  if(dialog) dialog.style.display = 'none';
  if(typeof action === 'function') action();
}

function _confirmarNao() {
  const dialog = document.getElementById('modal-confirm');
  globalThis._projConfirmAction = null;
  if(dialog) dialog.style.display = 'none';
}

// ════════════════════════════════════════════════════════════════════
// PÁGINA: INÍCIO (Dashboard)
// ════════════════════════════════════════════════════════════════════
function projRenderPainelGeral() {
  projLoad();
  projRenderDashV9();
}

function projAtrasoStatusProjeto(p) {
  const atrasadas = projTarefasAtrasadasProjeto(p);
  if(!atrasadas.length) return { cls:'ok', label:'Em dia' };

  const hoje = new Date();
  hoje.setHours(0,0,0,0);
  let maxDias = 0;
  atrasadas.forEach(t => {
    const d = projParseIsoDate(t.dt_fim);
    if(!d) return;
    const venc = new Date(d.ano, d.mes, d.dia);
    venc.setHours(0,0,0,0);
    const dias = Math.max(0, Math.floor((hoje - venc) / 86400000));
    if(dias > maxDias) maxDias = dias;
  });

  if(maxDias > 30) return { cls:'danger', label:'Tarefa atrasada ha mais de 30 dias' };
  return { cls:'warn', label:'Tarefa atrasada ate 30 dias' };
}

function projRenderInicio() {
  projLoad();
  const now = new Date();
  const dateStr = now.toLocaleDateString('pt-BR', {weekday:'long',year:'numeric',month:'long',day:'numeric'});
  const dateEl = document.getElementById('proj-dash-date');
  if(dateEl) dateEl.textContent = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);

  const ativos = PROJETOS.filter(p=>p.status==='ativo');
  const emExecucao = ativos.filter(p=>p.fase_atual==='execucao');
  const emIdeacaoPlan = ativos.filter(p=>p.fase_atual==='ideacao'||p.fase_atual==='planejamento'||p.fase_atual==='aprovacao');
  const concluidos = PROJETOS.filter(p=>p.status==='concluido');

  // ── PROGRESS MAP ──
  const lpContainer = document.getElementById('proj-launchpad-container');
  if(lpContainer) {
    const allProjects = PROJETOS.filter(p => p.status==='ativo');
    let laneOrder;
    try { laneOrder = JSON.parse(localStorage.getItem('proj_lane_order')||'null'); } catch(e) { laneOrder = null; }
    let ordered = [];
    if(laneOrder && Array.isArray(laneOrder)) {
      laneOrder.forEach(id => { const p = allProjects.find(x => String(x.id)===String(id)); if(p) ordered.push(p); });
      allProjects.forEach(p => { if(!ordered.find(x=>String(x.id)===String(p.id))) ordered.push(p); });
    } else {
      ordered = allProjects.slice();
    }

    // Build lanes
    const gridSegs = Array.from({length:10},()=>'<div class="proj-launchpad-lane-grid-seg"></div>').join('');
    let lanesHTML = '';
    ordered.forEach((p, idx) => {
      const pct = p.percentual || 0;
      const emoji = projEsc(p.icone_emoji || '📋');
      const pid = projEsc(String(p.id));
      const atrasoStatus = projAtrasoStatusProjeto(p);
      lanesHTML += `
        <div class="proj-launchpad-lane" id="proj-lane-${pid}" data-id="${pid}" data-idx="${idx}">
          <div class="proj-launchpad-lane-grid">${gridSegs}</div>
          <div class="proj-rocket" id="proj-rocket-${pid}"
               data-id="${pid}" data-pct="${pct}"
               style="left:${projRocketLeftStyle(pct)}"
               onmousedown="projRocketUnifiedDrag(event,'${pid}')"
               ontouchstart="projRocketUnifiedDrag(event,'${pid}')"
               ondblclick="projAbrirDetalhe('${pid}')">
            <div class="proj-rocket-icon">
              ${p.icone_url ? `<img src="${projEsc(p.icone_url)}" style="width:100%;height:100%;object-fit:cover;border-radius:9px">` : emoji}
            </div>
            <div class="proj-rocket-label">
              <span class="proj-rocket-status-flag ${atrasoStatus.cls}" title="${projEsc(atrasoStatus.label)}"></span>
              <div class="proj-rocket-name" title="${projEsc(p.nome)}">${projEsc(p.nome)}</div>
              <div class="proj-rocket-mgr">${projEsc(p.gerente||'')}</div>
              <div class="proj-rocket-pct">${pct}%</div>
              <div class="proj-rocket-bar"><div class="proj-rocket-bar-fill" style="width:${pct}%"></div></div>
            </div>
          </div>
        </div>`;
    });

    // Build axis — tick marks + labels at absolute % positions
    let axisInner = '';
    for(let i = 0; i <= 10; i++) {
      const pct = i * 10;
      axisInner += `<div class="proj-launchpad-axis-tick" style="left:${pct}%"></div>`;
      axisInner += `<div class="proj-launchpad-axis-lbl" style="left:${pct}%">${pct}%</div>`;
    }

    projSetSafeHtml(lpContainer, `
      <div class="proj-launchpad-wrap">
        <div class="proj-launchpad-grid-bg"></div>
        <div class="proj-launchpad-glow"></div>
        <div class="proj-launchpad-header">
          <div class="proj-launchpad-title">
            <div class="proj-launchpad-title-icon">
              <svg viewBox="0 0 16 16" fill="none" width="12" height="12"><path d="M8 1v14M1 8h14M3 3l10 10M13 3L3 13" stroke="rgba(56,180,130,.7)" stroke-width="1.2" stroke-linecap="round"/></svg>
            </div>
            Mapa de Progresso
          </div>
          <div class="proj-launchpad-legend">
            <span><span class="proj-launchpad-legend-key"></span> Arraste na horizontal para ajustar %</span>
            <span>Arraste na vertical para reordenar</span>
            <span>Duplo-clique para abrir</span>
          </div>
        </div>
        <div class="proj-launchpad-body">
          <div class="proj-launchpad-track" id="proj-launchpad-track">
            <div class="proj-launchpad-lanes" id="proj-launchpad-lanes">
              ${lanesHTML}
            </div>
            <div class="proj-launchpad-progress-line"></div>
            <div class="proj-launchpad-axis">${axisInner}</div>
          </div>
        </div>
      </div>
    `);
    requestAnimationFrame(() => {
      projFitLaunchpadRockets();
      projBindLaunchpadResize();
    });
  }

  // 2. Painéis executivos v9
  projRenderDashV9();

  // 3. Reuniões do mês
  projRenderReunioesDoMes();
  projAtualizarBadgeReunioes();

  // 4. Estatísticas
  const statsRow = document.getElementById('proj-stats-row');
  if(statsRow) projSetSafeHtml(statsRow, `
    <div class="proj-stat s-amber">
      <div class="proj-stat-n">${emIdeacaoPlan.length}</div>
      <div class="proj-stat-l">Ideação / Planejamento</div>
      <div class="proj-stat-icon" style="background:#fff8e8">💡</div>
    </div>
    <div class="proj-stat s-teal">
      <div class="proj-stat-n">${emExecucao.length}</div>
      <div class="proj-stat-l">Em Execução</div>
      <div class="proj-stat-icon" style="background:var(--teal-l)">⚡</div>
    </div>
    <div class="proj-stat s-green">
      <div class="proj-stat-n">${concluidos.length}</div>
      <div class="proj-stat-l">Concluídos</div>
      <div class="proj-stat-icon" style="background:#e6f9f0">✅</div>
    </div>
  `);
}

// ── UNIFIED DRAG: detects horizontal vs vertical intent ──
let _rocketDrag = null;
let _projLaunchpadResizeObserver = null;
function projDragPoint(ev) {
  const point = ev.touches ? ev.touches[0] : ev.changedTouches ? ev.changedTouches[0] : ev;
  return { x: point.clientX, y: point.clientY };
}
function projRocketLeftStyle(pct) {
  return Number(pct) <= 0 ? '4px' : `calc(${pct}% - 22px)`;
}
function projRocketApplyPct(rocket, laneRect, pct) {
  const icon = rocket.querySelector('.proj-rocket-icon');
  const iconWidth = icon ? icon.offsetWidth : 40;
  const pctX = (pct / 100) * laneRect.width;
  rocket.style.left = Math.max(0, pctX - iconWidth / 2) + 'px';
}
function projResizeLaunchpadLabels(track, rockets) {
  const DEFAULT_LABEL_WIDTH = 320;
  const MIN_LABEL_WIDTH = 210;
  const ICON_LABEL_GAP = 10;
  const RIGHT_PAD = 8;
  let labelWidth = DEFAULT_LABEL_WIDTH;
  rockets.forEach(rocket => {
    const lane = rocket.closest('.proj-launchpad-lane');
    if(!lane) return;
    const icon = rocket.querySelector('.proj-rocket-icon');
    const iconWidth = icon ? icon.offsetWidth : 40;
    const laneWidth = lane.getBoundingClientRect().width;
    const pct = Math.max(0, Math.min(100, Number.parseInt(rocket.dataset.pct, 10) || 0));
    const pctX = (pct / 100) * laneWidth;
    const available = laneWidth - pctX - iconWidth / 2 - ICON_LABEL_GAP - RIGHT_PAD;
    labelWidth = Math.min(labelWidth, Math.floor(available));
  });
  track.style.setProperty('--proj-rocket-label-width', Math.max(MIN_LABEL_WIDTH, labelWidth) + 'px');
}
function projFitLaunchpadRockets() {
  const track = document.getElementById('proj-launchpad-track');
  const rockets = Array.from(document.querySelectorAll('.proj-rocket'));
  if(!track || !rockets.length) return;
  projResizeLaunchpadLabels(track, rockets);
  rockets.forEach(rocket => {
    const lane = rocket.closest('.proj-launchpad-lane');
    if(!lane) return;
    const pct = Math.max(0, Math.min(100, Number.parseInt(rocket.dataset.pct, 10) || 0));
    projRocketApplyPct(rocket, lane.getBoundingClientRect(), pct);
  });
}
function projBindLaunchpadResize() {
  const track = document.getElementById('proj-launchpad-track');
  if(!track || typeof ResizeObserver === 'undefined') return;
  if(_projLaunchpadResizeObserver) _projLaunchpadResizeObserver.disconnect();
  _projLaunchpadResizeObserver = new ResizeObserver(() => projFitLaunchpadRockets());
  _projLaunchpadResizeObserver.observe(track);
}
function projRocketSetPct(rocket, laneRect, clientX) {
  let relX = clientX - laneRect.left;
  relX = Math.max(0, Math.min(relX, laneRect.width));
  const pct = Math.round((relX / laneRect.width) * 100);
  rocket.dataset.pct = String(pct);
  const pctEl = rocket.querySelector('.proj-rocket-pct');
  if(pctEl) pctEl.textContent = pct + '%';
  const barFill = rocket.querySelector('.proj-rocket-bar-fill');
  if(barFill) barFill.style.width = pct + '%';
  projFitLaunchpadRockets();
}
function projRocketMarkDropLane(lanes, dragLaneEl, clientY) {
  lanes.forEach(l => { l.classList.remove('lane-drop-above','lane-drop-below'); });
  lanes.forEach(lane => {
    if(lane === dragLaneEl) return;
    const r = lane.getBoundingClientRect();
    if(clientY >= r.top && clientY <= r.bottom) {
      lane.classList.add(clientY < r.top + r.height / 2 ? 'lane-drop-above' : 'lane-drop-below');
    }
  });
}
function projFindLaneDropIndex(lanes, dragLaneEl, clientY) {
  const dragIdx = lanes.indexOf(dragLaneEl);
  for(let i = 0; i < lanes.length; i++) {
    if(i === dragIdx) continue;
    const r = lanes[i].getBoundingClientRect();
    if(clientY < r.top || clientY > r.bottom) continue;
    const target = clientY < r.top + r.height / 2 ? i : i + 1;
    return target > dragIdx ? target - 1 : target;
  }
  return dragIdx;
}
function projSaveRocketPct(projId, rocket) {
  const newPct = Number.parseInt(rocket.dataset.pct, 10) || 0;
  projLoad();
  const proj = PROJETOS.find(p => String(p.id) === String(projId));
  if(!proj) return;
  proj.percentual = newPct;
  if(!proj.execucao) proj.execucao = { planner_link:'', percentual:0, reunioes:[] };
  proj.execucao.percentual = newPct;
  projSave();
  projToast(`${proj.nome}: ${newPct}%`, 'var(--blue)');
}
function projApplyLaneOrder(lanesContainer, dragLaneEl, targetIdx) {
  lanesContainer.removeChild(dragLaneEl);
  const updatedLanes = Array.from(lanesContainer.querySelectorAll('.proj-launchpad-lane'));
  if(targetIdx >= updatedLanes.length) lanesContainer.appendChild(dragLaneEl);
  else lanesContainer.insertBefore(dragLaneEl, updatedLanes[targetIdx]);
  const finalLanes = Array.from(lanesContainer.querySelectorAll('.proj-launchpad-lane'));
  const order = finalLanes.map(l => l.dataset.id);
  try { localStorage.setItem('proj_lane_order', JSON.stringify(order)); } catch(e){}
  projToast('Ordem atualizada','#0e7490');
}
function projRocketUnifiedDrag(e, projId) {
  e.preventDefault();
  e.stopPropagation();
  const lane = document.getElementById('proj-lane-' + projId);
  const rocket = document.getElementById('proj-rocket-' + projId);
  const lanesContainer = document.getElementById('proj-launchpad-lanes');
  if(!lane || !rocket || !lanesContainer) return;

  const start = projDragPoint(e);
  const startX = start.x;
  const startY = start.y;
  const THRESHOLD = 6;
  let mode = null;

  const laneRect = lane.getBoundingClientRect();
  let dragLaneEl = lane;

  function onMove(ev) {
    ev.preventDefault();
    const {x: cx, y: cy} = projDragPoint(ev);
    const dx = cx - startX;
    const dy = cy - startY;

    if(!mode) {
      if(Math.abs(dx) < THRESHOLD && Math.abs(dy) < THRESHOLD) return;
      mode = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';
      if(mode === 'h') {
        rocket.classList.add('dragging');
      } else {
        dragLaneEl.classList.add('lane-dragging');
      }
    }

    if(mode === 'h') {
      projRocketSetPct(rocket, laneRect, cx);
    } else {
      dragLaneEl.style.transform = `translateY(${dy}px)`;
      const lanes = Array.from(lanesContainer.querySelectorAll('.proj-launchpad-lane'));
      projRocketMarkDropLane(lanes, dragLaneEl, cy);
    }
  }

  function onEnd(ev) {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onEnd);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend', onEnd);

    if(mode === 'h') {
      rocket.classList.remove('dragging');
      projSaveRocketPct(projId, rocket);
    } else if(mode === 'v') {
      dragLaneEl.classList.remove('lane-dragging');
      dragLaneEl.style.transform = '';
      const cy = projDragPoint(ev).y;
      const lanes = Array.from(lanesContainer.querySelectorAll('.proj-launchpad-lane'));
      const dragIdx = lanes.indexOf(dragLaneEl);
      lanes.forEach(l => { l.classList.remove('lane-drop-above','lane-drop-below'); });
      const targetIdx = projFindLaneDropIndex(lanes, dragLaneEl, cy);
      if(targetIdx !== dragIdx) {
        projApplyLaneOrder(lanesContainer, dragLaneEl, targetIdx);
      }
    }
    mode = null;
  }

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onEnd);
  document.addEventListener('touchmove', onMove, {passive:false});
  document.addEventListener('touchend', onEnd);
}

function projRenderReunioesDoMes() {
  const reunEl = document.getElementById('proj-dash-reunioes');
  if(!reunEl) return;
  const { mes, ano } = projGetMesAtual();
  const todas = [];
  PROJETOS.forEach(p => {
    const reunioes = p.execucao?.reunioes || [];
    reunioes.forEach(r => {
      // Include if month matches or no date set (for current month)
      const isCurrentMonth = !r.data || (() => {
        const d = projParseIsoDate(r.data);
        return d && d.mes === mes && d.ano === ano;
      })();
      if(isCurrentMonth) {
        todas.push({ ...r, _projeto_nome: p.nome, _projeto_id: p.id, _projeto: p });
      }
    });
  });

  if(todas.length === 0) {
    projSetSafeHtml(reunEl, '<div style="text-align:center;padding:1.2rem;color:#b0b8cc;font-size:13px">Nenhuma reunião agendada este mês</div>');
    return;
  }

  todas.sort((a,b) => (a.data || '9999-12-31').localeCompare(b.data || '9999-12-31') || String(a.nome||'').localeCompare(String(b.nome||''), 'pt-BR'));
  projSetSafeHtml(reunEl, todas.map(r => `
    <div class="proj-reunion-item ${r.realizada ? 'proj-reunion-done' : ''}" id="reunion-item-${projEsc(r.id)}">
      <div class="proj-reunion-check ${r.realizada ? 'done' : ''}" onclick="projToggleReuniao('${projEsc(r._projeto_id)}','${projEsc(r.id)}')">
        ${r.realizada ? '<svg viewBox="0 0 12 12" fill="none" width="10" height="10"><path d="M2 6l3 3 5-5" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' : ''}
      </div>
      <div style="flex:1;min-width:0">
        <div class="proj-reunion-text">${projEsc(r.nome)}</div>
        <div class="proj-reunion-proj" style="margin-top:2px">${projIconHtml(r._projeto)} ${projEsc(r._projeto_nome)}</div>
      </div>
      ${r.data ? `<div class="proj-reunion-date">${projFormatDate(r.data)}</div>` : ''}
    </div>
  `).join(''));
}

function projToggleReuniao(projetoId, reuniaoId) {
  if(!projEnsureWriteAll('Apenas EPP pode alterar reuniões.')) return;
  projLoad();
  const proj = PROJETOS.find(p => String(p.id) === String(projetoId));
  if(!proj) return;
  const reunioes = proj.execucao?.reunioes || [];
  const r = reunioes.find(r => String(r.id) === String(reuniaoId));
  if(r) {
    r.realizada = !r.realizada;
    projSave();
    projRenderReunioesDoMes();
    projAtualizarBadgeReunioes();
  }
}

function projAtualizarBadgeReunioes() {
}

// ════════════════════════════════════════════════════════════════════
// PÁGINA: PORTFÓLIO
// ════════════════════════════════════════════════════════════════════
function projRenderProjItem(p) {
  const pid = projEsc(String(p.id));
  return `
    <div class="proj-list-item" onclick="projAbrirDetalhe('${pid}')">
      <div class="proj-list-icon">
        ${p.icone_url ? `<img src="${projEsc(p.icone_url)}" alt="ícone">` : `<span style="font-size:20px">${projEsc(p.icone_emoji || '📁')}</span>`}
      </div>
      <div>
        <div class="proj-list-name">${projEsc(p.nome)}</div>
        <div class="proj-list-meta">
          <span>👤 ${projEsc(p.gerente)||'—'}</span>
          ${p.dt_inicio ? `<span>📅 ${projFormatDate(p.dt_inicio)}</span>` : ''}
          ${p.patrocinador ? `<span>📝 ${projEsc(p.patrocinador)}</span>` : ''}
        </div>
        <div style="margin-top:5px">
          <div class="proj-prog-bar" style="width:160px;display:inline-block">
            <div class="proj-prog-fill" style="width:${p.percentual||0}%"></div>
          </div>
          <span style="font-size:11px;color:var(--ink3);margin-left:6px">${p.percentual||0}%</span>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
        <span class="proj-list-badge ${projFaseBadgeClass(p.status,p.fase_atual)}">${projFaseText(p)}</span>
        <button type="button" class="proj-btn" style="font-size:11px;padding:3px 9px" onclick="event.stopPropagation();projTrocarIcone('${pid}')">🎨</button>
        <button type="button" class="proj-btn danger" style="font-size:11px;padding:3px 9px" onclick="event.stopPropagation();projExcluir('${pid}')">Excluir</button>
      </div>
    </div>
  `;
}

function projRenderPortfolio() {
  projLoad();
  const el = document.getElementById('proj-portfolio-content');
  if(!el) return;

  const ativos = PROJETOS.filter(p=>p.status==='ativo');
  const concluidos = PROJETOS.filter(p=>p.status==='concluido' || p.status==='cancelado');

  if(ativos.length === 0) {
    projSetSafeHtml(el, '<div style="text-align:center;padding:3rem;color:#b0b8cc"><div style="font-size:40px;margin-bottom:12px">📋</div><div style="font-size:15px;font-weight:600;margin-bottom:6px">Nenhum projeto em andamento</div><div style="font-size:13px">Clique em "Novo Projeto" para começar.</div></div>');
  } else {
    // Show only active projects - grouped by program
    let html = '';
    progLoad();
    const programasAtivos = PROGRAMAS.filter(pg => pg.status !== 'cancelado');

    if(programasAtivos.length > 0) {
      html += '<div style="font-family:\'Syne\',sans-serif;font-size:13px;font-weight:700;color:#1a2540;margin-bottom:.8rem;display:flex;align-items:center;gap:8px"><svg viewBox="0 0 16 16" fill="none" width="15" height="15"><path d="M2 4h12M2 8h12M2 12h8" stroke="var(--blue)" stroke-width="1.5" stroke-linecap="round"/><circle cx="13" cy="12" r="1.5" stroke="var(--blue)" stroke-width="1.4"/></svg>Programas</div>';
      programasAtivos.forEach(pg => {
        const projs = ativos.filter(p => String(p.programa_id) === String(pg.id));
        if(projs.length === 0) return;
        const pct = progPercentualMedio(pg.id);
        html += `
          <div style="border:1.5px solid #d5deed;border-radius:12px;background:#f8faff;padding:1rem;margin-bottom:1.2rem">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.8rem;gap:12px;cursor:pointer" onclick="progAbrirDetalhe('${pg.id}')">
              <div style="flex:1;min-width:0">
                <div style="font-family:'Syne',sans-serif;font-size:14px;font-weight:700;color:#1a2540;display:flex;align-items:center;gap:8px">
                  📂 ${projEsc(pg.nome)}
                  <span class="proj-list-badge" style="background:var(--blue-l);color:var(--blue)">Ativo</span>
                </div>
                ${pg.descricao ? `<div style="font-size:12px;color:#6b7385;margin-top:3px">${projEsc(pg.descricao)}</div>` : ''}
                <div style="font-size:11px;color:var(--ink3);margin-top:4px">${projs.length} projeto${projs.length>1?'s':''} · ${pct}% médio</div>
              </div>
              <div class="proj-prog-bar" style="width:140px"><div class="proj-prog-fill" style="width:${pct}%"></div></div>
            </div>
            <div style="padding-left:8px">${projs.map(projRenderProjItem).join('')}</div>
          </div>`;
      });
    }

    const soltos = ativos.filter(p => !p.programa_id);
    if(soltos.length > 0) {
      html += '<div style="font-family:\'Syne\',sans-serif;font-size:13px;font-weight:700;color:#1a2540;margin:1.5rem 0 .8rem">Projetos sem programa</div>';
      html += soltos.map(projRenderProjItem).join('');
    }
    projSetSafeHtml(el, html);
  }

  // Link to concluded projects
  if(concluidos.length > 0) {
    projAppendSafeHtml(el, 'beforeend', `
      <div style="margin-top:2rem;padding-top:1.4rem;border-top:2px solid #eaecf3;text-align:center">
        <button type="button" class="proj-btn" style="font-size:13px;padding:8px 20px" onclick="projGo('concluidos')">
          🏆 Ver Projetos Concluídos (${concluidos.length})
        </button>
      </div>`);
  }
}

function projRenderConcluidos() {
  projLoad();
  const el = document.getElementById('proj-concluidos-content');
  if(!el) return;
  const concluidos = PROJETOS.filter(p=>p.status==='concluido');
  const cancelados = PROJETOS.filter(p=>p.status==='cancelado');
  let html = '';
  if(concluidos.length > 0) {
    html += '<div style="margin-bottom:1.6rem"><div style="font-family:\'Syne\',sans-serif;font-size:12px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:.7rem;padding:.5rem 0;border-bottom:2px solid #eaecf3">Concluídos com Sucesso <span style="color:var(--teal)">(' + concluidos.length + ')</span></div>';
    html += concluidos.map(projRenderProjItem).join('');
    html += '</div>';
  }
  if(cancelados.length > 0) {
    html += '<div style="margin-bottom:1.6rem"><div style="font-family:\'Syne\',sans-serif;font-size:12px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:.7rem;padding:.5rem 0;border-bottom:2px solid #eaecf3">Cancelados <span style="color:#b91c1c">(' + cancelados.length + ')</span></div>';
    html += cancelados.map(projRenderProjItem).join('');
    html += '</div>';
  }
  if(concluidos.length === 0 && cancelados.length === 0) {
    html = '<div style="text-align:center;padding:3rem;color:#b0b8cc;font-size:13px">Nenhum projeto concluído ou cancelado.</div>';
  }
  el.textContent = '';
  projAppendSafeHtml(el, 'beforeend', html);
}

// ════════════════════════════════════════════════════════════════════
// PÁGINA: REUNIÕES
// ════════════════════════════════════════════════════════════════════
function projTaskResponsibleKey(t) {
  const email = projNormKey(t?.responsavel_email);
  if(email) return 'u:'+email;
  const user = projUserByResponsibleText(t?.responsavel);
  return user && user.email ? 'u:'+projNormKey(user.email) : 't:'+projNormKey(t?.responsavel);
}

function projAllResponsibleTasks() {
  const today = new Date().toISOString().slice(0,10);
  const rows = [];
  (PROJETOS||[]).filter(p => p.status !== 'cancelado').forEach(p => {
    projFlattenTasks(p.execucao?.tarefas || []).forEach(t => {
      const label = projResponsibleLabel(t);
      if(!label) return;
      rows.push({
        key: projTaskResponsibleKey(t),
        label,
        email: projNormKey(t.responsavel_email),
        projectId: String(p.id),
        projectName: p.nome || 'Projeto sem nome',
        project: p,
        task: t,
        overdue: !t.concluida && t.dt_fim && t.dt_fim < today
      });
    });
  });
  return rows;
}

function projUsuariosFilterOptions(rows) {
  const map = new Map();
  (USUARIOS||[]).forEach(u => {
    const label = projUserDisplayName(u);
    const email = projNormKey(u.email);
    if(label) map.set('u:'+(email || projNormKey(label)), {key:'u:'+(email || projNormKey(label)), label, detail:u.email||'Usuário cadastrado'});
  });
  rows.forEach(r => {
    if(!map.has(r.key)) map.set(r.key, {key:r.key, label:r.label, detail:r.email || 'Texto livre'});
  });
  return Array.from(map.values()).sort((a,b) => a.label.localeCompare(b.label, 'pt-BR'));
}

function projUsuariosAgg(rows) {
  const map = new Map();
  rows.forEach(r => {
    const item = map.get(r.key) || {key:r.key, label:r.label, total:0, overdue:0, done:0};
    item.total += 1;
    if(r.overdue) item.overdue += 1;
    if(r.task.concluida) item.done += 1;
    map.set(r.key, item);
  });
  return Array.from(map.values()).sort((a,b) => b.overdue - a.overdue || b.total - a.total || a.label.localeCompare(b.label, 'pt-BR'));
}

function projUsuariosBars(title, rows, field) {
  const max = Math.max(1, ...rows.map(r => r[field] || 0));
  const body = rows.length ? rows.slice(0,10).map(r => {
    const val = r[field] || 0;
    const width = Math.max(3, Math.round((val / max) * 100));
    return `<div class="proj-user-bar-row"><span title="${projEsc(r.label)}">${projEsc(r.label)}</span><div class="proj-user-bar"><div style="width:${width}%"></div></div><strong>${val}</strong></div>`;
  }).join('') : '<div style="font-size:12px;color:var(--ink3)">Nenhum dado para exibir.</div>';
  return `<div class="proj-v9-chart-card"><div class="proj-card-t">${projEsc(title)}</div><div class="proj-user-bars">${body}</div></div>`;
}

function projRenderUsuariosPage() {
  projLoad();
  const el = document.getElementById('proj-usuarios-content');
  if(!el) return;
  const allRows = projAllResponsibleTasks();
  const selectedResponsible = document.getElementById('proj-user-filter-resp')?.value || '';
  const selectedProject = document.getElementById('proj-user-filter-proj')?.value || '';
  const rows = allRows.filter(r => (!selectedResponsible || r.key === selectedResponsible) && (!selectedProject || r.projectId === selectedProject));
  const agg = projUsuariosAgg(rows);
  const filters = projUsuariosFilterOptions(allRows);
  const projectOpts = (PROJETOS||[]).filter(p => p.status !== 'cancelado').slice().sort((a,b)=>(a.nome||'').localeCompare(b.nome||'', 'pt-BR'));
  const overdue = rows.filter(r => r.overdue);
  const done = rows.filter(r => r.task.concluida);
  const table = rows.length ? `<table class="proj-v9-table"><thead><tr><th>Responsável</th><th>Projeto</th><th>Tarefa</th><th>Fim Prev.</th><th>Status</th><th>%</th></tr></thead><tbody>${rows.map(r => `<tr class="${r.overdue?'proj-user-row-overdue':''}"><td><span class="proj-user-avatar">${projEsc(projUserInitials(r.label))}</span>${projEsc(r.label)}</td><td>${projEsc(r.projectName)}</td><td>${r.task._parentName ? `<span style="color:var(--ink3)">${projEsc(r.task._parentName)} / </span>` : ''}${projEsc(r.task.nome||'Tarefa sem nome')}</td><td>${projEsc(projFormatDate(r.task.dt_fim))}</td><td>${r.overdue ? '<span class="risk-heat risk-alto">Atrasada</span>' : (r.task.concluida ? '<span class="risk-heat risk-baixo">Concluída</span>' : '<span class="risk-heat risk-medio">Em andamento</span>')}</td><td>${Number(r.task.conclusao||0)}%</td></tr>`).join('')}</tbody></table>` : '<div class="proj-v9-chart-card" style="font-size:12px;color:var(--ink3)">Nenhuma tarefa com responsável nos filtros atuais.</div>';
  projSetSafeHtml(el, `
    <div class="proj-v9-filter-card">
      <div class="proj-card-t">Filtros</div>
      <div class="proj-v9-filter-grid">
        <div class="proj-fg" style="margin:0"><label class="proj-fl">Responsável</label><select class="proj-fi" id="proj-user-filter-resp" onchange="projRenderUsuariosPage()"><option value="">Todos</option>${filters.map(f => `<option value="${projEsc(f.key)}" ${selectedResponsible===f.key?'selected':''}>${projEsc(f.label)}${f.detail?` · ${projEsc(f.detail)}`:''}</option>`).join('')}</select></div>
        <div class="proj-fg" style="margin:0"><label class="proj-fl">Projeto</label><select class="proj-fi" id="proj-user-filter-proj" onchange="projRenderUsuariosPage()"><option value="">Todos</option>${projectOpts.map(p => `<option value="${projEsc(String(p.id))}" ${selectedProject===String(p.id)?'selected':''}>${projEsc(p.nome||'Projeto sem nome')}</option>`).join('')}</select></div>
      </div>
    </div>
    <div class="proj-user-summary">
      <div><strong>${rows.length}</strong><span>Tarefas vinculadas</span></div>
      <div><strong>${overdue.length}</strong><span>Atrasadas</span></div>
      <div><strong>${done.length}</strong><span>Concluídas</span></div>
      <div><strong>${agg.length}</strong><span>Responsáveis</span></div>
    </div>
    <div class="proj-v9-chart-grid">
      ${projUsuariosBars('Tarefas por responsável', agg, 'total')}
      ${projUsuariosBars('Atrasadas por responsável', agg.filter(r => r.overdue > 0), 'overdue')}
    </div>
    <div class="proj-v9-chart-card">
      <div class="proj-card-t">Tarefas vinculadas</div>
      ${table}
    </div>
  `);
}

const PROJ_PPE_FIRST_YEAR = 2026;
const PROJ_PPE_FIRST_QUARTER = 3;
const PROJ_PPE_LAST_YEAR = 2040;
const PROJ_PPE_LAST_QUARTER = 4;
let _projPpeCycle = null;

function projPpeCycleKey(year, quarter) {
  return `${year}Q${quarter}`;
}

function projPpeCycleLabel(cycleKey) {
  const parsed = projPpeParseCycle(cycleKey);
  return parsed ? `${parsed.quarter}º Tri ${parsed.year}` : '3º Tri 2026';
}

function projPpeParseCycle(cycleKey) {
  const match = String(cycleKey || '').match(/^(\d{4})Q([1-4])$/);
  if(!match) return null;
  return { year: Number.parseInt(match[1], 10), quarter: Number.parseInt(match[2], 10) };
}

function projPpeCycleIndex(cycleKey) {
  const parsed = projPpeParseCycle(cycleKey);
  if(!parsed) return -1;
  return (parsed.year * 4) + parsed.quarter;
}

function projPpeCycles() {
  const cycles = [];
  for(let year = PROJ_PPE_FIRST_YEAR; year <= PROJ_PPE_LAST_YEAR; year++) {
    const startQ = year === PROJ_PPE_FIRST_YEAR ? PROJ_PPE_FIRST_QUARTER : 1;
    for(let quarter = startQ; quarter <= PROJ_PPE_LAST_QUARTER; quarter++) {
      cycles.push({ key: projPpeCycleKey(year, quarter), year, quarter, label: `${quarter}º Tri ${year}` });
    }
  }
  return cycles;
}

function projPpeClampCycle(cycleKey) {
  const cycles = projPpeCycles();
  const idx = cycles.findIndex(c => c.key === cycleKey);
  if(idx >= 0) return cycleKey;
  const parsed = projPpeParseCycle(cycleKey);
  if(!parsed) return cycles[0].key;
  return projPpeCycleIndex(cycleKey) < projPpeCycleIndex(cycles[0].key) ? cycles[0].key : cycles[cycles.length - 1].key;
}

function projPpeCurrentBrazilParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: 'numeric'
  }).formatToParts(date);
  return {
    year: Number(parts.find(p => p.type === 'year')?.value || date.getFullYear()),
    month: Number(parts.find(p => p.type === 'month')?.value || (date.getMonth() + 1))
  };
}

function projPpeDefaultCycle(date = new Date()) {
  const parts = projPpeCurrentBrazilParts(date);
  const currentQuarter = Math.floor((parts.month - 1) / 3) + 1;
  let quarter = currentQuarter + 1;
  let year = parts.year;
  if(quarter > 4) {
    quarter = 1;
    year += 1;
  }
  return projPpeClampCycle(projPpeCycleKey(year, quarter));
}

function projPpeSelectedCycle() {
  if(!_projPpeCycle) _projPpeCycle = projPpeDefaultCycle();
  _projPpeCycle = projPpeClampCycle(_projPpeCycle);
  return _projPpeCycle;
}

function projPpeMoveCycle(direction) {
  projSavePpeFromForm(projPpeSelectedCycle());
  const cycles = projPpeCycles();
  const idx = cycles.findIndex(c => c.key === projPpeSelectedCycle());
  const next = Math.max(0, Math.min(cycles.length - 1, idx + direction));
  _projPpeCycle = cycles[next].key;
  projRenderPpePage();
}

function projPpeSelectCycle(value) {
  projSavePpeFromForm(projPpeSelectedCycle());
  _projPpeCycle = projPpeClampCycle(value);
  projRenderPpePage();
}

function projPpeEntry(project, cycleKey) {
  const map = project?.ppe_ciclos;
  if(!map || typeof map !== 'object' || Array.isArray(map)) return { texto: '' };
  const entry = map[cycleKey];
  if(typeof entry === 'string') return { texto: entry };
  return entry && typeof entry === 'object' ? entry : { texto: '' };
}

function projPpeText(project, cycleKey) {
  return String(projPpeEntry(project, cycleKey).texto || '');
}

function projSetPpeText(project, cycleKey, value) {
  if(!project.ppe_ciclos || typeof project.ppe_ciclos !== 'object' || Array.isArray(project.ppe_ciclos)) project.ppe_ciclos = {};
  project.ppe_ciclos[cycleKey] = {
    texto: String(value || ''),
    atualizado_em: new Date().toISOString(),
    atualizado_por: projUserDisplayName(typeof usuarioLogado !== 'undefined' ? usuarioLogado : null) || ''
  };
}

function projFinishPpeCloudSave() {
  _projFbState.saving = false;
  if(_projFbState.pendingRender) {
    _projFbState.pendingRender = false;
    projRenderCurrentPage();
  }
}

async function projPersistPpeProjects(projects, silent) {
  const targets = (projects || []).filter(Boolean);
  if(!targets.length) return true;
  if(!fbReady()) {
    const saved = projSave();
    if(saved && !silent) projToast('Meta PPE salva.');
    return saved;
  }
  _projFbState.saving = true;
  try {
    await Promise.all(targets.map(project => projetosRepository.set(project.id, _fsClean({
      ppe_ciclos: project.ppe_ciclos || {}
    }), { merge: true })));
    try {
      localStorage.setItem(PROJ_STORAGE_KEY, JSON.stringify(PROJETOS || []));
    } catch(e) {
      console.warn('projPersistPpeProjects/cache:', e.message);
    }
    if(!silent) projToast('Meta PPE salva.');
    return true;
  } catch(e) {
    console.warn('projPersistPpeProjects:', e.message);
    if(!silent) projToast('Erro ao salvar meta PPE na nuvem: ' + e.message, '#dc2626');
    return false;
  } finally {
    projFinishPpeCloudSave();
  }
}

function projPpeActiveProjects() {
  return (PROJETOS || [])
    .filter(p => p.status === 'ativo')
    .slice()
    .sort((a, b) => {
      const programCompare = projProgramaNome(a).localeCompare(projProgramaNome(b), 'pt-BR');
      return programCompare || String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR');
    });
}

function projRenderPpePage() {
  projLoad();
  const el = document.getElementById('proj-ppe-content');
  if(!el) return;
  if(!projCanWriteExec()) {
    projSetSafeHtml(el, '<div class="proj-ib proj-ib-amber">A aba PPE é exclusiva para usuários EPP. Usuários com acesso apenas de visualização não podem editar ou gerar este relatório.</div>');
    return;
  }
  const cycle = projPpeSelectedCycle();
  const cycles = projPpeCycles();
  const cycleIdx = cycles.findIndex(c => c.key === cycle);
  const ativos = projPpeActiveProjects();
  const preenchidos = ativos.filter(p => projPpeText(p, cycle).trim()).length;
  projSetSafeHtml(el, `
    <div class="proj-ppe-toolbar">
      <div>
        <div class="proj-ppe-title">Metas PPE do próximo ciclo</div>
        <div class="proj-ppe-subtitle">Textos salvos por trimestre para compor o relatório à Coordenação de Gestão Estratégica.</div>
      </div>
      <div class="proj-ppe-cycle">
        <button type="button" class="proj-ppe-arrow" ${cycleIdx <= 0 ? 'disabled' : ''} onclick="projPpeMoveCycle(-1)" title="Ciclo anterior">‹</button>
        <select class="proj-ppe-select" aria-label="Selecionar ciclo PPE" onchange="projPpeSelectCycle(this.value)">
          ${cycles.map(c => `<option value="${projEsc(c.key)}" ${c.key === cycle ? 'selected' : ''}>${projEsc(c.label)}</option>`).join('')}
        </select>
        <button type="button" class="proj-ppe-arrow" ${cycleIdx >= cycles.length - 1 ? 'disabled' : ''} onclick="projPpeMoveCycle(1)" title="Próximo ciclo">›</button>
      </div>
    </div>
    <div class="proj-ppe-summary">
      <div><strong>${ativos.length}</strong><span>Projetos ativos</span></div>
      <div><strong>${preenchidos}</strong><span>Com metas indicadas</span></div>
      <div><strong>${projEsc(projPpeCycleLabel(cycle))}</strong><span>Ciclo selecionado</span></div>
    </div>
    ${ativos.length ? `<div class="proj-ppe-list">
      ${ativos.map(p => `
        <div class="proj-ppe-card">
          <div class="proj-ppe-card-head">
            ${projIconHtml(p, 'proj-status-icon')}
            <div>
              <div class="proj-ppe-project">${projEsc(p.nome || 'Projeto')}</div>
              <div class="proj-ppe-meta">Programa: ${projEsc(projProgramaNome(p))} · Gerente: ${projEsc(p.gerente || 'Não informado')} · ${p.percentual || 0}%</div>
            </div>
          </div>
          <textarea class="proj-fi proj-ppe-text" data-proj-id="${projEsc(String(p.id))}" rows="4" placeholder="Indique as atividades/metas deste projeto para o PPE no ciclo selecionado..." onchange="projSalvarPpeTexto('${projEsc(String(p.id))}', '${projEsc(cycle)}', this.value)">${projEsc(projPpeText(p, cycle))}</textarea>
        </div>
      `).join('')}
    </div>` : '<div style="text-align:center;padding:2rem;color:#b0b8cc;font-size:13px">Nenhum projeto ativo encontrado.</div>'}
  `);
}

function projSalvarPpeTexto(projId, cycleKey, value, silent) {
  if(!projCanWriteExec()) {
    if(!silent) projToast('Somente EPP pode editar as metas PPE.', '#d97706');
    return;
  }
  const safeCycle = projPpeClampCycle(cycleKey);
  projLoad();
  const proj = PROJETOS.find(p => String(p.id) === String(projId));
  if(!proj) return;
  projSetPpeText(proj, safeCycle, value);
  projPersistPpeProjects([proj], silent).catch(() => {});
}

function projSavePpeFromForm(cycleKey = projPpeSelectedCycle()) {
  if(!projCanWriteExec()) return;
  let changed = false;
  const changedProjects = [];
  const safeCycle = projPpeClampCycle(cycleKey);
  document.querySelectorAll('.proj-ppe-text[data-proj-id]').forEach(txt => {
    const proj = PROJETOS.find(p => String(p.id) === String(txt.dataset.projId));
    if(!proj) return;
    const current = projPpeText(proj, safeCycle);
    if(current !== txt.value) {
      projSetPpeText(proj, safeCycle, txt.value);
      changedProjects.push(proj);
      changed = true;
    }
  });
  if(changed) projPersistPpeProjects(changedProjects, true).catch(() => {});
}

function projExportPpePDF() {
  if(!projEnsureWriteExec('Somente EPP pode gerar o relatório PPE.')) return;
  projLoad();
  const cycle = projPpeSelectedCycle();
  projSavePpeFromForm(cycle);
  const blob = new Blob([projBuildPpeReportHTML(cycle)], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank');
  if(!w) {
    projToast('Permita pop-ups para exportar o PDF.', '#d97706');
    URL.revokeObjectURL(url);
  }
}

function projBuildPpeReportHTML(cycleKey) {
  const cycle = projPpeClampCycle(cycleKey);
  const label = projPpeCycleLabel(cycle);
  const data = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const reportLogo = new URL(PROJ_CAGE_REPORT_LOGO, window.location.href).href;
  const ativos = projPpeActiveProjects();
  const rows = ativos
    .map(p => ({ p, texto: projPpeText(p, cycle).trim() }))
    .filter(row => row.texto);
  const groups = {};
  rows.forEach(row => {
    const program = projProgramaNome(row.p);
    if(!groups[program]) groups[program] = [];
    groups[program].push(row);
  });
  const groupsHtml = Object.entries(groups).map(([program, items]) => `
    <section class="ppe-program">
      <h2>${projEsc(program)}</h2>
      ${items.map(({p, texto}) => `
        <article class="ppe-card">
          <div>
            <h3>${projEsc(p.nome || 'Projeto')}</h3>
            <div class="ppe-sub">Gerente: ${projEsc(p.gerente || 'Não informado')} · Patrocinador: ${projEsc(p.patrocinador || 'Não informado')} · Conclusão: ${p.percentual || 0}%</div>
          </div>
          <div class="ppe-note"><span>Metas/atividades indicadas para o PPE</span><p>${projEsc(texto).replace(/\n/g, '<br>')}</p></div>
        </article>
      `).join('')}
    </section>
  `).join('');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Relatório PPE - ${projEsc(label)}</title><style>:root{--blue:#005a9c;--teal:#00bfb3;--ink:#172033;--muted:#5f6b80}@page{size:A4;margin:13mm}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:var(--ink);margin:0;background:#fff}.ppe-cover{display:flex;align-items:center;justify-content:space-between;gap:22px;padding:18px 20px;margin-bottom:18px;border:1px solid #d8e6f5;border-left:8px solid var(--blue);background:linear-gradient(90deg,#f5fbff,#fff)}.ppe-logo{width:185px;max-height:72px;object-fit:contain}.ppe-kicker{font-size:10px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--blue)}h1{margin:4px 0;font-size:27px;color:#0f2746}.ppe-meta{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.ppe-date{font-size:12px;color:var(--muted)}.ppe-ref{font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--blue);border:1px solid #cfe0f4;background:#f8fbff;border-radius:999px;padding:3px 9px}.ppe-intro{border:1px solid #d9e5f5;border-radius:10px;background:#f8fbff;padding:12px 14px;margin-bottom:16px;font-size:12px;line-height:1.5;color:#334155}.ppe-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px}.ppe-chip{border:1px solid #d9e5f5;border-radius:8px;padding:9px 12px;font-size:12px;background:#f8fbff}.ppe-chip strong{font-size:20px;color:var(--blue);display:block}.ppe-program{margin-top:20px}.ppe-program h2{font-size:16px;color:var(--blue);border-bottom:2px solid var(--teal);padding-bottom:5px;margin:0 0 12px}.ppe-card{border:1px solid #d9e2ef;border-radius:10px;padding:14px;margin-bottom:12px;break-inside:avoid;background:#fff}h3{font-size:15px;margin:0;color:#0f2746}.ppe-sub{font-size:10.5px;color:#6b7588;margin-top:3px}.ppe-note{margin-top:10px;border-left:3px solid #f59e0b;padding-left:12px}.ppe-note span{display:block;font-size:9px;color:var(--blue);font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px}.ppe-note p{font-size:12px;line-height:1.5;margin:0;color:#334155}.ppe-empty{padding:14px;border:1px dashed #d0d7e8;border-radius:10px;color:#5f6b80;font-size:12px}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body><header class="ppe-cover"><div><div class="ppe-kicker">CAGE-RS · Escritório de Projetos e Processos</div><h1>Relatório de Metas PPE</h1><div class="ppe-meta"><span class="ppe-date">Emitido em ${data}</span><span class="ppe-ref">${projEsc(label)}</span></div></div><img class="ppe-logo" src="${reportLogo}" alt="CAGE"></header><section class="ppe-intro">Relatório gerado a partir do SIGA para indicar à Coordenação de Gestão Estratégica as atividades e metas de projetos propostas para o Prêmio de Produtividade e Eficiência no ciclo selecionado.</section><div class="ppe-summary"><div class="ppe-chip"><strong>${ativos.length}</strong>Projetos ativos</div><div class="ppe-chip"><strong>${rows.length}</strong>Projetos com metas PPE</div><div class="ppe-chip"><strong>${projEsc(label)}</strong>Ciclo</div></div>${groupsHtml || '<div class="ppe-empty">Nenhuma meta PPE foi indicada para este ciclo.</div>'}<script>setTimeout(function(){window.print();},450);<\/script></body></html>`;
}

function projRenderStatusReport() {
  projLoad();
  const el = document.getElementById('proj-status-report-content');
  if(!el) return;
  const ativos = PROJETOS.filter(p => p.status === 'ativo');
  if(!ativos.length) {
    projSetSafeHtml(el, '<div style="text-align:center;padding:2rem;color:#b0b8cc;font-size:13px">Nenhum projeto em andamento encontrado.</div>');
    return;
  }
  projSetSafeHtml(el, `
    <div class="proj-ib proj-ib-blue">Preencha a observação livre de cada projeto. Esse texto será exibido ao lado do projeto no PDF do Relatório Executivo.</div>
    <div class="proj-status-grid">
      ${ativos.map(p => `
        <div class="proj-status-card">
          <div class="proj-status-head">
            ${projIconHtml(p, 'proj-status-icon')}
            <div>
              <div class="proj-status-name">${projEsc(p.nome)}</div>
              <div class="proj-status-meta">Patrocinador: ${projEsc(p.patrocinador||'Não informado')} · Gerente: ${projEsc(p.gerente||'Não informado')}</div>
            </div>
            <div class="proj-status-pct">${p.percentual||0}%</div>
          </div>
          <div class="proj-status-bar"><div style="width:${Math.max(0,Math.min(100,p.percentual||0))}%"></div></div>
          <div class="proj-g2" style="margin-top:.7rem">
            <div style="font-size:11.5px;color:#5f6b80">
              <strong>Gerente substituto:</strong> ${projEsc(p.gerente_substituto||'Não informado')}
            </div>
            <div style="font-size:11.5px;color:#5f6b80">
              <strong>Fase atual:</strong> ${projEsc(projFaseText(p))}
            </div>
          </div>
          <div class="proj-fg" style="margin:.8rem 0 0">
            <label class="proj-fl" for="sr-obs-${projEsc(String(p.id))}">Texto livre para o Relatório Executivo</label>
            <textarea class="proj-fi proj-status-note" id="sr-obs-${projEsc(String(p.id))}" data-proj-id="${projEsc(String(p.id))}" rows="3" placeholder="Digite aqui o comentário executivo deste projeto..." onchange="projSalvarStatusReportObs('${projEsc(String(p.id))}',this.value)">${projEsc(p.status_report_obs||'')}</textarea>
          </div>
        </div>
      `).join('')}
    </div>
  `);
}

function projSalvarStatusReportObs(projId, value, silent) {
  if(!projCanWriteExec()){ if(!silent) projToast('Somente EPP pode salvar relatório executivo.','#d97706'); return; }
  projLoad();
  const proj = PROJETOS.find(p => String(p.id) === String(projId));
  if(!proj) return;
  proj.status_report_obs = value || '';
  projSave();
  if(!silent) projToast('Observação salva.');
}

function projSaveStatusReportFromForm() {
  let changed = false;
  document.querySelectorAll('.proj-status-note[data-proj-id]').forEach(txt => {
    const proj = PROJETOS.find(p => String(p.id) === String(txt.dataset.projId));
    if(proj && proj.status_report_obs !== txt.value) {
      proj.status_report_obs = txt.value;
      changed = true;
    }
  });
  if(changed) projSave();
}

function projExportStatusReportPDF() {
  projLoad();
  projSaveStatusReportFromForm();
  const blob = new Blob([projBuildStatusReportHTML()], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank');
  if(!w) { projToast('Permita pop-ups para exportar o PDF.', '#d97706'); URL.revokeObjectURL(url); return; }
}

async function projExportStatusReportImagem() {
  projLoad();
  projSaveStatusReportFromForm();
  try {
    await projDownloadStatusReportPNG();
    projToast('Imagem do Relatório Executivo gerada.', '#00a89a');
  } catch(err) {
    console.error(err);
    projToast('Nao foi possivel gerar a imagem PNG.', '#dc2626');
  }
}

function projCanvasRoundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function projCanvasTextWidth(ctx, text, maxWidth) {
  let value = String(text || '');
  while(value.length && ctx.measureText(value).width > maxWidth) value = value.slice(0, -1);
  return value.length < String(text || '').length ? `${value}...` : value;
}

function projCanvasWrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  words.forEach(word => {
    const test = line ? `${line} ${word}` : word;
    if(ctx.measureText(test).width <= maxWidth) line = test;
    else {
      if(line) lines.push(line);
      line = word;
    }
  });
  if(line) lines.push(line);
  const limited = maxLines ? lines.slice(0, maxLines) : lines;
  if(maxLines && lines.length > maxLines && limited.length) {
    let last = limited[limited.length - 1];
    while(last.length && ctx.measureText(`${last}...`).width > maxWidth) last = last.slice(0, -1);
    limited[limited.length - 1] = `${last}...`;
  }
  limited.forEach((ln, i) => ctx.fillText(ln, x, y + (i * lineHeight)));
  return limited.length * lineHeight;
}

function projLoadCanvasImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function projRelatorioExecutivoRef(date) {
  const base = date || new Date();
  const ref = new Date(base.getFullYear(), base.getMonth() - 1, 1);
  return `${String(ref.getMonth() + 1).padStart(2, '0')}/${ref.getFullYear()}`;
}

async function projDownloadStatusReportPNG() {
  progLoad();
  const ativos = PROJETOS.filter(p => p.status === 'ativo');
  const concluidos = PROJETOS.filter(p => p.status === 'concluido');
  const media = ativos.length ? Math.round(ativos.reduce((a,p)=>a+(Number(p.percentual ?? p.execucao?.percentual ?? 0)),0)/ativos.length) : 0;
  const ref = projRelatorioExecutivoRef();
  const totalProjetos = ativos.length + concluidos.length;
  const concluidoPct = totalProjetos ? (concluidos.length / totalProjetos) * 100 : 0;
  const projetos = ativos.slice().sort((a,b)=>Number(b.percentual ?? b.execucao?.percentual ?? 0)-Number(a.percentual ?? a.execucao?.percentual ?? 0));
  const grupos = {};
  ativos.forEach(p => { const g = projProgramaNome(p); if(!grupos[g]) grupos[g] = []; grupos[g].push(p); });
  const detailHeight = Object.values(grupos).reduce((sum, items) => {
    return sum + 56 + items.reduce((projectSum, p) => {
      const indicatorLines = (p.execucao?.indicadores || []).length;
      const overdueLines = projTarefasAtrasadasProjeto(p).length;
      const noteLines = Math.min(5, Math.max(2, Math.ceil(String(p.status_report_obs || '').length / 92)));
      return projectSum + 154 + (indicatorLines * 18) + (Math.min(4, overdueLines) * 18) + (noteLines * 18);
    }, 0);
  }, 0);
  const w = 1200;
  const rowH = 48;
  const doneRows = Math.max(1, concluidos.length);
  const contentH = 500 + (projetos.length * rowH) + 90 + (doneRows * 30) + detailHeight + 100;
  const h = Math.min(Math.ceil(contentH * 1.35) + 2400, 30000);
  const scale = h > 15000 ? 1 : 2;
  const reportLogo = await projLoadCanvasImage(new URL(PROJ_CAGE_REPORT_LOGO, window.location.href).href).catch(() => null);
  const canvas = document.createElement('canvas');
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#f6fbff';
  ctx.fillRect(0, 0, w, 170);
  ctx.fillStyle = '#005a9c';
  ctx.fillRect(0, 0, 10, 170);
  ctx.fillStyle = '#005a9c';
  ctx.font = '700 13px Arial';
  ctx.fillText('CAGE-RS \u00b7 ESCRIT\u00d3RIO DE PROJETOS E PROCESSOS', 42, 54);
  ctx.fillStyle = '#0f2746';
  ctx.font = '800 34px Arial';
  ctx.fillText('Relatório Executivo de Projetos', 42, 96);
  ctx.fillStyle = '#5f6b80';
  ctx.font = '16px Arial';
  ctx.fillText(`Emitido em ${new Date().toLocaleDateString('pt-BR')}`, 42, 124);
  ctx.fillStyle = '#005a9c';
  ctx.font = '700 14px Arial';
  ctx.fillText(`ref. ${ref}`, 42, 150);
  if(reportLogo) {
    const maxLogoW = 360;
    const maxLogoH = 92;
    const ratio = Math.min(maxLogoW / reportLogo.width, maxLogoH / reportLogo.height);
    const logoW = reportLogo.width * ratio;
    const logoH = reportLogo.height * ratio;
    ctx.drawImage(reportLogo, 1128 - logoW, 44, logoW, logoH);
  }
  ctx.fillStyle = '#00a89a';
  ctx.font = '800 18px Arial';
  ctx.fillText('Resumo Gr\u00e1fico', 42, 218);
  ctx.fillStyle = '#0f2746';
  ctx.font = '800 26px Arial';
  ctx.fillText('Vis\u00e3o imediata do portf\u00f3lio', 42, 252);
  const drawRing = (x, y, r, parts, center, labelLines) => {
    ctx.lineWidth = 18;
    ctx.strokeStyle = '#e7edf5';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    let start = -Math.PI / 2;
    parts.forEach(part => {
      const value = Math.max(0, Math.min(100, Number(part.value) || 0));
      if(value <= 0) return;
      const end = start + (Math.PI * 2 * value / 100);
      ctx.strokeStyle = part.color;
      ctx.beginPath();
      ctx.arc(x, y, r, start, end);
      ctx.stroke();
      start = end;
    });
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y, r - 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#005a9c';
    ctx.font = '800 27px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(center, x, y - 10);
    ctx.fillStyle = '#5f6b80';
    ctx.font = '11px Arial';
    labelLines.forEach((line, idx) => ctx.fillText(line, x, y + 14 + (idx * 13)));
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
  };
  drawRing(100, 348, 58, [
    { value: 100 - concluidoPct, color: '#005a9c' },
    { value: concluidoPct, color: '#00a89a' }
  ], String(totalProjetos), ['PROJETOS']);
  drawRing(300, 348, 58, [{ value: media, color: '#00bfb3' }], `${media}%`, ['M\u00c9DIA DE', 'CONCLUS\u00c3O']);
  ctx.fillStyle = '#005a9c';
  ctx.beginPath();
  ctx.arc(62, 440, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#00a89a';
  ctx.beginPath();
  ctx.arc(210, 440, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#334155';
  ctx.font = '13px Arial';
  ctx.fillText('Em andamento', 76, 444);
  ctx.fillText('Conclu\u00eddos', 224, 444);
  let y = 490;
  projCanvasRoundRect(ctx, 42, y, 1116, projetos.length * rowH + 64, 14);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = '#d9e5f5';
  ctx.stroke();
  ctx.fillStyle = '#0f2746';
  ctx.font = '800 17px Arial';
  ctx.fillText('Projetos por conclus\u00e3o', 70, y + 34);
  projetos.forEach((p, idx) => {
    const py = y + 66 + (idx * rowH);
    const pct = Math.max(0, Math.min(100, Number(p.percentual ?? p.execucao?.percentual ?? 0)));
    ctx.fillStyle = '#172033';
    ctx.font = '15px Arial';
    ctx.fillText(projCanvasTextWidth(ctx, p.nome, 420), 70, py);
    ctx.fillStyle = '#e7edf5';
    projCanvasRoundRect(ctx, 520, py - 11, 220, 12, 6);
    ctx.fill();
    ctx.fillStyle = '#005a9c';
    projCanvasRoundRect(ctx, 520, py - 11, Math.max(2, pct * 2.2), 12, 6);
    ctx.fill();
    ctx.fillStyle = '#005a9c';
    ctx.font = '800 15px Arial';
    ctx.fillText(`${pct}%`, 770, py);
    ctx.fillStyle = '#5f6b80';
    ctx.font = '12px Arial';
    ctx.fillText(projCanvasTextWidth(ctx, p.gerente || 'Gerente nao informado', 260), 840, py);
  });
  y += projetos.length * rowH + 92;
  projCanvasRoundRect(ctx, 42, y, 1116, doneRows * 32 + 58, 14);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = '#d9e5f5';
  ctx.stroke();
  ctx.fillStyle = '#0f2746';
  ctx.font = '800 17px Arial';
  ctx.fillText('Projetos conclu\u00eddos', 70, y + 34);
  if(concluidos.length) {
    concluidos.forEach((p, idx) => {
      const py = y + 66 + (idx * 32);
      ctx.fillStyle = '#00a89a';
      ctx.beginPath();
      ctx.arc(78, py - 5, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#334155';
      ctx.font = '14px Arial';
      ctx.fillText(projCanvasTextWidth(ctx, p.nome, 990), 94, py);
    });
  } else {
    ctx.fillStyle = '#5f6b80';
    ctx.font = '14px Arial';
    ctx.fillText('Nenhum projeto concluido registrado.', 70, y + 66);
  }
  y += doneRows * 32 + 106;
  Object.entries(grupos).forEach(([programa, items]) => {
    ctx.fillStyle = '#005a9c';
    ctx.font = '800 20px Arial';
    ctx.fillText(programa, 42, y);
    ctx.fillStyle = '#00bfb3';
    ctx.fillRect(42, y + 12, 1116, 3);
    y += 34;
    items.forEach(p => {
      const pct = Math.max(0, Math.min(100, Number(p.percentual ?? p.execucao?.percentual ?? 0)));
      const indicadores = p.execucao?.indicadores || [];
      const atrasadas = projTarefasAtrasadasProjeto(p);
      const noteLines = Math.min(5, Math.max(2, Math.ceil(String(p.status_report_obs || '').length / 92)));
      const cardH = 154 + (indicadores.length * 18) + (Math.min(4, atrasadas.length) * 18) + (noteLines * 18);
      projCanvasRoundRect(ctx, 42, y, 1116, cardH, 14);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = '#d9e5f5';
      ctx.stroke();
      ctx.fillStyle = '#0f2746';
      ctx.font = '800 18px Arial';
      ctx.fillText(projCanvasTextWidth(ctx, p.nome, 520), 70, y + 34);
      ctx.fillStyle = '#00a89a';
      ctx.font = '800 28px Arial';
      ctx.fillText(`${pct}%`, 600, y + 36);
      ctx.fillStyle = '#e7edf5';
      projCanvasRoundRect(ctx, 70, y + 54, 560, 9, 5);
      ctx.fill();
      ctx.fillStyle = '#005a9c';
      projCanvasRoundRect(ctx, 70, y + 54, Math.max(2, pct * 5.6), 9, 5);
      ctx.fill();
      ctx.fillStyle = '#005a9c';
      ctx.font = '800 11px Arial';
      ctx.fillText('PATROCINADOR', 70, y + 88);
      ctx.fillText('GERENTE', 310, y + 88);
      ctx.fillText('GERENTE SUBSTITUTO', 550, y + 88);
      ctx.fillStyle = '#334155';
      ctx.font = '13px Arial';
      ctx.fillText(projCanvasTextWidth(ctx, p.patrocinador || 'Nao informado', 200), 70, y + 108);
      ctx.fillText(projCanvasTextWidth(ctx, p.gerente || 'Nao informado', 200), 310, y + 108);
      ctx.fillText(projCanvasTextWidth(ctx, p.gerente_substituto || 'Nao informado', 200), 550, y + 108);
      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(760, y + 24, 4, Math.max(82, noteLines * 18 + 20));
      ctx.fillStyle = '#005a9c';
      ctx.font = '800 11px Arial';
      ctx.fillText('SUMARIO EXECUTIVO', 778, y + 34);
      ctx.fillStyle = '#334155';
      ctx.font = '13px Arial';
      projCanvasWrapText(ctx, p.status_report_obs || 'Sem sumario executivo registrado.', 778, y + 56, 330, 18, noteLines);
      let infoY = y + 136;
      if(indicadores.length) {
        ctx.fillStyle = '#005a9c';
        ctx.font = '800 11px Arial';
        ctx.fillText('INDICADORES', 70, infoY);
        ctx.fillStyle = '#334155';
        ctx.font = '12px Arial';
        indicadores.forEach(ind => {
          infoY += 18;
          const meta = projIndicadorValor(ind,'meta');
          const atual = projIndicadorValor(ind,'resultado');
          const ating = meta ? (atual / meta) * 100 : 0;
          ctx.fillText(projCanvasTextWidth(ctx, `${ind.nome || 'Indicador'}: ${atual}/${meta} (${projPctFmt(ating)})`, 520), 70, infoY);
        });
      }
      if(atrasadas.length) {
        infoY += 22;
        ctx.fillStyle = '#b45309';
        ctx.font = '800 11px Arial';
        ctx.fillText('TAREFAS ATRASADAS', 70, infoY);
        ctx.fillStyle = '#334155';
        ctx.font = '12px Arial';
        atrasadas.slice(0,4).forEach(t => {
          infoY += 18;
          ctx.fillText(projCanvasTextWidth(ctx, `${t._parentName ? `${t._parentName} / ` : ''}${t.nome} - ${projFormatDate(t.dt_fim)}`, 640), 70, infoY);
        });
      }
      y += cardH + 18;
    });
    y += 28;
  });
  const finalH = Math.min(h, Math.ceil(y + 100));
  const out = document.createElement('canvas');
  out.width = canvas.width;
  out.height = finalH * scale;
  const outCtx = out.getContext('2d');
  outCtx.fillStyle = '#ffffff';
  outCtx.fillRect(0, 0, out.width, out.height);
  outCtx.drawImage(canvas, 0, 0);
  const a = document.createElement('a');
  a.download = `Relatorio_Executivo_Projetos_Email_${new Date().toISOString().slice(0,10)}.png`;
  a.href = out.toDataURL('image/png');
  a.click();
}

function projQuarterValue(date) {
  const d = date || new Date();
  return d.getFullYear() + '-T' + (Math.floor(d.getMonth() / 3) + 1);
}
function projQuarterLabel(value) {
  const m = String(value||'').match(/^(\d{4})-T([1-4])$/);
  return m ? (m[2] + 'º Trimestre de ' + m[1]) : 'Trimestre';
}
function projQuarterRange(value) {
  const m = String(value||'').match(/^(\d{4})-T([1-4])$/);
  const ano = m ? Number(m[1]) : new Date().getFullYear();
  const tri = m ? Number(m[2]) : Math.floor(new Date().getMonth()/3)+1;
  const startMonth = (tri - 1) * 3;
  return { start:new Date(ano,startMonth,1), end:new Date(ano,startMonth+3,0), months:[0,1,2].map(i => { const v = new Date(ano,startMonth+i,1).toISOString().slice(0,7); return {value:v,label:projMonthLabel(v)}; }) };
}
function projQuarterOptionsHtml() {
  const selected = projQuarterValue();
  let html = '';
  for(let y=2026; y<=new Date().getFullYear()+1; y++) {
    for(let q=1; q<=4; q++) {
      if(y===2026 && q<2) continue;
      const v = y + '-T' + q;
      html += `<option value="${v}" ${v===selected?'selected':''}>${projQuarterLabel(v)}</option>`;
    }
  }
  return html;
}
function projExportReunioesRealizadasPDF() {
  projLoad();
  const quarterValue = document.getElementById('greuniao-rel-tri')?.value || projQuarterValue();
  const label = projQuarterLabel(quarterValue);
  const range = projQuarterRange(quarterValue);
  const reunioes = [];
  PROJETOS.forEach(p => {
    (p.execucao?.reunioes||[]).forEach(r => {
      if(!r.data) return;
      const d = new Date(r.data + 'T00:00:00');
      if(d >= range.start && d <= range.end) reunioes.push({ ...r, _projeto:p });
    });
  });
  const mesesHtml = range.months.map(month => {
    const items = reunioes.filter(r => projIsoInMonth(r.data, month.value)).sort((a,b)=>(a.data||'').localeCompare(b.data||''));
    const rows = items.map(r => `<tr><td>${projFormatDate(r.data)}</td><td>${projEsc(r._projeto.nome)}</td><td>${projEsc(r.nome)}</td><td>${r.realizada?'Concluída':'Planejada'}</td><td>${projEsc(r.participantes||'')}</td><td>${projEsc(r.observacoes||'')}</td></tr>`).join('');
    return `<section class="month"><h2>${projEsc(month.label)}</h2>${items.length ? `<table><thead><tr><th>Data</th><th>Projeto</th><th>Reunião</th><th>Status</th><th>Participantes</th><th>Observações</th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="empty">Nenhuma reunião planejada ou concluída neste mês.</div>'}</section>`;
  }).join('');
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Relatório Trimestral de Reuniões</title><style>:root{--blue:#005a9c;--teal:#00bfb3}@page{size:A4;margin:14mm}body{font-family:Arial,Helvetica,sans-serif;color:#1a2540}.head{border-left:8px solid var(--blue);padding:14px 18px;background:#f0f6ff;margin-bottom:16px}.k{font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:#00a89a;font-weight:700}h1{margin:4px 0;color:var(--blue);font-size:24px}.sub{font-size:12px;color:#5f6b80}.month{margin-top:18px;break-inside:avoid}.month h2{font-size:15px;color:var(--blue);border-bottom:2px solid var(--teal);padding-bottom:5px}table{width:100%;border-collapse:collapse;font-size:11.5px}th{background:var(--blue);color:#fff;text-align:left;padding:8px}td{border-bottom:1px solid #d9e2ef;padding:7px;vertical-align:top}tr:nth-child(even) td{background:#f8fbff}.empty{padding:12px;border:1px solid #d9e2ef;border-radius:8px;color:#5f6b80;font-size:12px}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body><div class="head"><div class="k">CAGE-RS · Escritório de Projetos e Processos</div><h1>Relatório Trimestral de Reuniões</h1><div class="sub">${projEsc(label)} · ${reunioes.length} reunião(ões) planejada(s) ou concluída(s)</div></div>${mesesHtml}<script>setTimeout(function(){window.print();},350);</script></body></html>`;
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank');
  if(!w) { projToast('Permita pop-ups para exportar o PDF.', '#d97706'); URL.revokeObjectURL(url); return; }
}

function projAddMonths(date, months) {
  const d = date || new Date();
  return new Date(d.getFullYear(), d.getMonth() + (months||0), 1);
}

function projAutoAddReunioesTipo(tipo, monthOffset) {
  if(!projEnsureWriteAll('Apenas EPP pode criar reuniões automáticas.')) return;
  projLoad();
  const target = projAddMonths(new Date(), monthOffset || 0);
  const mn = projMonthLabel(projMonthValue(target));
  _projReunioesCalendarMonth = projMonthValue(target);
  const dataStatus = projMonthFirstDay(target);
  const isCronograma = tipo === 'cronograma';
  const baseNome = isCronograma ? 'Acompanhamento de Cronograma' : 'Reuniao de Status Patrocinador';
  const nome = baseNome + ' - ' + mn;
  let count = 0;
  let jaExiste = 0;
  PROJETOS.forEach(function(proj){
    if(proj.status === 'concluido' || proj.status === 'cancelado') return;
    if(!proj.execucao) proj.execucao = {planner_link:'',percentual:0,reunioes:[]};
    if(!proj.execucao.reunioes) proj.execucao.reunioes = [];
    let ja = proj.execucao.reunioes.some(function(r){
      return r.nome === nome || (r.auto && r.auto_tipo === tipo && r.data === dataStatus);
    });
    if(ja){ jaExiste++; return; }
    proj.execucao.reunioes.push({
      id: 'r' + Date.now() + '_' + tipo + '_' + proj.id,
      nome: nome,
      data: dataStatus,
      participantes: isCronograma ? (proj.gerente||'') : ((proj.gerente||'') + (proj.patrocinador ? ', ' + proj.patrocinador : '')),
      observacoes: isCronograma ? 'Reuniao mensal de acompanhamento do cronograma' : 'Reuniao mensal de acompanhamento com o patrocinador',
      realizada: false,
      auto: true,
      auto_tipo: tipo
    });
    count++;
  });
  projSave();
  if(count > 0) projToast(count + ' reuniao(oes) criada(s) para ' + mn + '!');
  else if(jaExiste > 0) projToast('Todas as reunioes do periodo ja existem.','#d97706');
  else projToast('Nenhum projeto ativo encontrado.','#d97706');
  projAtualizarBadgeReunioes();
  projGo('reunioes', document.getElementById('pnb-reunioes'));
}

function projAutoAddReunioesCronogramaTodos(monthOffset) {
  projAutoAddReunioesTipo('cronograma', monthOffset || 0);
}

function projColetarReunioesGlobal() {
  const todas = [];
  PROJETOS.forEach(function(p){
    (p.execucao?.reunioes || []).forEach(function(r){
      todas.push({ ...r, _projeto:p });
    });
  });
  return todas;
}

function projRenderReunioesCalendar(container) {
  const monthValue = _projReunioesCalendarMonth || document.getElementById('proj-cal-reuniao-mes')?.value || projMonthValue();
  const parts = monthValue.split('-').map(Number);
  const ano = parts[0];
  const mesIndex = (parts[1] || 1) - 1;
  const first = new Date(ano, mesIndex, 1);
  const daysInMonth = new Date(ano, mesIndex + 1, 0).getDate();
  const startOffset = first.getDay();
  const reunioes = projColetarReunioesGlobal().filter(r => r.data && projIsoInMonth(r.data, monthValue));
  const byDay = {};
  reunioes.forEach(r => {
    const day = Number.parseInt(String(r.data).slice(8,10), 10);
    if(!byDay[day]) byDay[day] = [];
    byDay[day].push(r);
  });

  const section = document.createElement('div');
  section.className = 'proj-form-section proj-meeting-calendar-section';
  section.style.marginBottom = '1rem';

  // Title — static SVG + text
  const titleDiv = document.createElement('div');
  titleDiv.className = 'proj-form-section-title';
  projSetSafeHtml(titleDiv, '<svg viewBox="0 0 16 16" fill="none" width="14" height="14"><rect x="1.5" y="3" width="13" height="11.5" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M5 1.5v3M11 1.5v3M1.5 6.5h13" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>');
  titleDiv.appendChild(document.createTextNode(' Calendário de Reuniões'));
  section.appendChild(titleDiv);

  // Toolbar
  const toolbar = document.createElement('div');
  toolbar.className = 'proj-meeting-cal-toolbar';
  const toolInfo = document.createElement('div');
  const calTitle = document.createElement('div');
  calTitle.className = 'proj-meeting-cal-title';
  calTitle.textContent = projMonthLabel(monthValue);
  const calSub = document.createElement('div');
  calSub.className = 'proj-meeting-cal-sub';
  calSub.textContent = reunioes.length + ' reunião(ões) no mês selecionado';
  toolInfo.append(calTitle, calSub);
  const monthInput = document.createElement('input');
  monthInput.type = 'month'; monthInput.className = 'proj-fi';
  monthInput.id = 'proj-cal-reuniao-mes'; monthInput.value = monthValue;
  monthInput.style.maxWidth = '170px';
  monthInput.addEventListener('change', () => {
    _projReunioesCalendarMonth = monthInput.value || projMonthValue();
    projRenderReunioesPage();
  });
  toolbar.append(toolInfo, monthInput);
  section.appendChild(toolbar);

  // Weekday headers — static text
  const weekdaysDiv = document.createElement('div');
  weekdaysDiv.className = 'proj-meeting-cal-weekdays';
  ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].forEach(d => {
    const s = document.createElement('span'); s.textContent = d; weekdaysDiv.appendChild(s);
  });
  section.appendChild(weekdaysDiv);

  // Grid
  const grid = document.createElement('div');
  grid.className = 'proj-meeting-cal-grid';
  for(let i = 0; i < startOffset; i++){
    const empty = document.createElement('div');
    empty.className = 'proj-meeting-cal-cell empty';
    grid.appendChild(empty);
  }
  for(let day = 1; day <= daysInMonth; day++){
    const items = byDay[day] || [];
    const dateValue = monthValue + '-' + String(day).padStart(2,'0');
    const cell = document.createElement('div');
    cell.className = 'proj-meeting-cal-cell';
    cell.addEventListener('dragover', ev => projMeetingCalendarDragOver(ev));
    cell.addEventListener('drop', ev => projDropReuniaoCalendar(ev, dateValue));
    const dayEl = document.createElement('div');
    dayEl.className = 'proj-meeting-cal-day'; dayEl.textContent = day;
    cell.appendChild(dayEl);
    items.slice(0,5).forEach(r => {
      const pId = String(r._projeto.id);
      const rId = String(r.id);
      const meetItem = document.createElement('div');
      meetItem.className = 'proj-meeting-cal-item' + (r.realizada ? ' done' : '');
      meetItem.draggable = true;
      meetItem.title = r._projeto.nome + ' - ' + r.nome;
      meetItem.addEventListener('dragstart', ev => projDragReuniaoCalendar(ev, pId, rId));
      // Icon
      const iconSpan = document.createElement('span');
      iconSpan.className = 'proj-mini-icon';
      if(r._projeto.icone_url){
        const img = document.createElement('img'); img.src = r._projeto.icone_url; img.alt = '';
        iconSpan.appendChild(img);
      } else {
        iconSpan.textContent = r._projeto.icone_emoji || '📁';
      }
      const nameSpan = document.createElement('span');
      nameSpan.textContent = r.nome;
      meetItem.append(iconSpan, nameSpan);
      cell.appendChild(meetItem);
    });
    if(items.length > 5){
      const more = document.createElement('div');
      more.className = 'proj-meeting-cal-more';
      more.textContent = '+' + (items.length - 5) + ' reunião(ões)';
      cell.appendChild(more);
    }
    grid.appendChild(cell);
  }
  section.appendChild(grid);
  container.appendChild(section);
}

function projDragReuniaoCalendar(ev, projetoId, reuniaoId) {
  if(!ev?.dataTransfer) return;
  ev.dataTransfer.effectAllowed = 'move';
  ev.dataTransfer.setData('text/plain', JSON.stringify({ projetoId, reuniaoId }));
}

function projMeetingCalendarDragOver(ev) {
  ev.preventDefault();
  if(ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
}

function projDropReuniaoCalendar(ev, novaData) {
  ev.preventDefault();
  if(!projEnsureWriteAll('Apenas EPP pode alterar reuniões.')) return;
  let payload = null;
  try { payload = JSON.parse(ev.dataTransfer.getData('text/plain') || '{}'); } catch(e) { payload = null; }
  if(!payload?.projetoId || !payload?.reuniaoId || !novaData) return;
  projLoad();
  const proj = PROJETOS.find(p => String(p.id) === String(payload.projetoId));
  const reuniao = proj?.execucao?.reunioes?.find(r => String(r.id) === String(payload.reuniaoId));
  if(!reuniao) return;
  reuniao.data = novaData;
  _projReunioesCalendarMonth = novaData.slice(0, 7);
  projSave();
  projToast('Data da reunião atualizada.');
  projRenderReunioesPage();
  if(typeof projAtualizarBadgeReunioes === 'function') projAtualizarBadgeReunioes();
}

function projRenderReunioesPage() {
  projLoad();
  const el = document.getElementById('proj-reunioes-content');
  if(!el) return;

  // Static form only — no user data in this string
  projSetSafeHtml(el, `
    <div class="proj-form-section" style="margin-bottom:1rem">
      <div class="proj-form-section-title">
        <svg viewBox="0 0 16 16" fill="none" width="14" height="14"><path d="M3 2.5h10v11H3z" stroke="currentColor" stroke-width="1.4"/><path d="M5.5 6h5M5.5 8.5h5M5.5 11h3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
        Relatório Trimestral de Reuniões
      </div>
      <div style="display:flex;align-items:flex-end;gap:10px;flex-wrap:wrap">
        <div class="proj-fg" style="margin:0;min-width:180px">
          <label class="proj-fl" for="greuniao-rel-tri">Trimestre</label>
          <select class="proj-fi" id="greuniao-rel-tri">${projQuarterOptionsHtml()}</select>
        </div>
        <button type="button" class="proj-btn primary" onclick="projExportReunioesRealizadasPDF()">Gerar relatório PDF</button>
      </div>
    </div>
    <div class="proj-form-section" style="margin-bottom:1rem">
      <div class="proj-form-section-title" style="cursor:pointer" onclick="var f=document.getElementById('proj-reuniao-form-fields');f.style.display=f.style.display==='none'?'block':'none'">
        <svg viewBox="0 0 16 16" fill="none" width="14" height="14"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.4"/><path d="M8 5v6M5 8h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        Nova Reunião
      </div>
      <div id="proj-reuniao-form-fields" style="display:none">
      <div class="proj-g2" style="margin-bottom:.7rem">
        <div class="proj-fg" style="margin:0">
          <label class="proj-fl">Projeto<span>*</span></label>
          <select class="proj-fi" id="greuniao-proj">
            <option value="">Selecione...</option>
          </select>
        </div>
        <div class="proj-fg" style="margin:0">
          <label class="proj-fl">Nome da Reunião<span>*</span></label>
          <input type="text" class="proj-fi" id="greuniao-nome" placeholder="Nome da reunião">
        </div>
      </div>
      <div class="proj-g3" style="margin-bottom:.7rem">
        <div class="proj-fg" style="margin:0"><label class="proj-fl">Data (opcional)</label><input type="date" class="proj-fi" id="greuniao-data"></div>
        <div class="proj-fg" style="margin:0"><label class="proj-fl">Participantes (opcional)</label><input type="text" class="proj-fi" id="greuniao-part" placeholder="Participantes"></div>
        <div class="proj-fg" style="margin:0"><label class="proj-fl">Observações (opcional)</label><input type="text" class="proj-fi" id="greuniao-obs" placeholder="Observações"></div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="proj-btn" style="font-size:11px;padding:5px 12px" onclick="projAutoAddReunioesStatusTodos()">📅 Criar Status Patrocinador (mês)</button>
          <button type="button" class="proj-btn" style="font-size:11px;padding:5px 12px" onclick="projAutoAddReunioesTipo('status',1)">📅 Criar Status Patrocinador (mês seguinte)</button>
          <button type="button" class="proj-btn" style="font-size:11px;padding:5px 12px" onclick="projAutoAddReunioesCronogramaTodos(0)">📅 Criar Reunião de Acompanhamento do Cronogama (mês)</button>
          <button type="button" class="proj-btn" style="font-size:11px;padding:5px 12px" onclick="projAutoAddReunioesCronogramaTodos(1)">📅 Criar Reunião de Acompanhamento do Cronogama (mês seguinte)</button>
          <button type="button" class="proj-btn" style="font-size:11px;padding:5px 12px" onclick="projDeduplicarReunioesGlobal()">🧹 Excluir Duplicadas — Todos os projetos</button>
        </div>
        <button type="button" class="proj-btn primary" onclick="projAdicionarReuniaoGlobal()">Adicionar Reunião</button>
      </div>
      </div>
    </div>
  `);

  // Calendar built entirely via DOM (user data via textContent/title/addEventListener)
  const calDiv = document.createElement('div');
  projRenderReunioesCalendar(calDiv);
  el.prepend(calDiv.firstElementChild || calDiv);

  // Populate project select options safely via DOM
  const sel = document.getElementById('greuniao-proj');
  if(sel) {
    PROJETOS.filter(p => p.status === 'ativo').forEach(p => {
      const opt = document.createElement('option');
      opt.value = String(p.id);
      opt.textContent = p.nome;
      sel.appendChild(opt);
    });
  }

  // Build meeting cards via DOM (avoids XSS in innerHTML with user data)
  const listFrag = document.createDocumentFragment();
  let hasAny = false;
  const calSvg = '<svg viewBox="0 0 16 16" fill="none" width="14" height="14"><rect x="1" y="3" width="14" height="12" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M5 1v4M11 1v4M1 7h14" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
  PROJETOS.forEach(p => {
    const reunioes = p.execucao?.reunioes || [];
    if(reunioes.length === 0) return;
    const pendentes = reunioes.filter(r => !r.realizada);
    const pId = String(p.id);
    if(pendentes.length === 0 && reunioes.length > 0) {
      hasAny = true;
      const card = document.createElement('div');
      card.className = 'proj-card'; card.style.marginBottom = '1rem';
      const hd = document.createElement('div');
      hd.className = 'proj-card-t'; hd.style.cursor = 'pointer';
      projSetSafeHtml(hd, calSvg);
      hd.addEventListener('click', () => projGoReunioesProj(pId));
      const link = document.createElement('a');
      link.href = 'javascript:void(0)';
      link.style.cssText = 'color:var(--blue);text-decoration:underline';
      link.textContent = p.nome;
      const badge = document.createElement('span');
      badge.style.cssText = 'font-size:10.5px;font-weight:400;color:#16a34a;margin-left:4px';
      badge.textContent = '✓ Todas as reuniões realizadas';
      hd.append(link, badge); card.appendChild(hd);
      listFrag.appendChild(card);
      return;
    }
    if(pendentes.length === 0) return;
    hasAny = true;
    const card = document.createElement('div');
    card.className = 'proj-card'; card.style.marginBottom = '1rem';
    const hd = document.createElement('div');
    hd.className = 'proj-card-t'; hd.style.cursor = 'pointer';
    projSetSafeHtml(hd, calSvg);
    hd.addEventListener('click', () => projGoReunioesProj(pId));
    const link = document.createElement('a');
    link.href = 'javascript:void(0)';
    link.style.cssText = 'color:var(--blue);text-decoration:underline';
    link.textContent = p.nome;
    const cnt = document.createElement('span');
    cnt.style.cssText = 'font-size:10.5px;font-weight:400;color:#d97706;margin-left:4px';
    cnt.textContent = '(' + pendentes.length + ' pendente' + (pendentes.length > 1 ? 's' : '') + ')';
    hd.append(link, cnt); card.appendChild(hd);
    pendentes.forEach(r => {
      const rId = String(r.id);
      const item = document.createElement('div');
      item.className = 'proj-reunion-item';
      item.style.cssText = 'display:grid;grid-template-columns:auto 1fr auto auto auto;align-items:center;gap:8px;padding:.6rem 0;border-bottom:1px solid var(--bdr)';
      const chk = document.createElement('div');
      chk.className = 'proj-reunion-check';
      chk.addEventListener('click', () => projToggleReuniaoPage(pId, rId));
      const content = document.createElement('div');
      const txtEl = document.createElement('div');
      txtEl.className = 'proj-reunion-text'; txtEl.textContent = r.nome;
      content.appendChild(txtEl);
      if(r.data || r.participantes) {
        const meta = document.createElement('div');
        meta.style.cssText = 'font-size:11px;color:var(--ink3);margin-top:2px';
        if(r.data) meta.appendChild(document.createTextNode('📅 ' + projFormatDate(r.data) + (r.participantes ? ' · ' : '')));
        if(r.participantes) meta.appendChild(document.createTextNode('👥 ' + r.participantes));
        content.appendChild(meta);
      }
      if(r.observacoes) {
        const obs = document.createElement('div');
        obs.style.cssText = 'font-size:11px;color:var(--ink3)';
        obs.textContent = '📝 ' + r.observacoes;
        content.appendChild(obs);
      }
      const pendBadge = document.createElement('span');
      pendBadge.style.cssText = 'font-size:10px;padding:2px 7px;border-radius:5px;background:var(--blue-l);color:var(--blue)';
      pendBadge.textContent = 'Pendente';
      const editBtn = document.createElement('button');
      editBtn.type = 'button'; editBtn.className = 'proj-btn';
      editBtn.style.cssText = 'font-size:11px;padding:3px 8px'; editBtn.textContent = '✏️';
      editBtn.addEventListener('click', () => projEditarReuniaoModal(pId, rId));
      const delBtn = document.createElement('button');
      delBtn.type = 'button'; delBtn.className = 'proj-btn danger';
      delBtn.style.cssText = 'font-size:11px;padding:3px 8px'; delBtn.textContent = '✕';
      delBtn.addEventListener('click', () => projExcluirReuniao(pId, rId));
      item.append(chk, content, pendBadge, editBtn, delBtn);
      card.appendChild(item);
    });
    listFrag.appendChild(card);
  });

  if(!hasAny) {
    const empty = document.createElement('div');
    empty.style.cssText = 'text-align:center;padding:2rem;font-size:13px;color:var(--ink4)';
    empty.textContent = 'Nenhuma reunião registrada ainda. Adicione uma acima.';
    listFrag.appendChild(empty);
  }
  el.appendChild(listFrag);
}

// ── Sub-página de reuniões de um projeto específico ──
function projGoReunioesProj(projId) {
  projLoad();
  const proj = PROJETOS.find(p => String(p.id) === String(projId));
  if(!proj) return;
  const reunioes = proj.execucao?.reunioes || [];
  const pendentes = reunioes.filter(r => !r.realizada);
  const realizadas = reunioes.filter(r => r.realizada);

  const el = document.getElementById('proj-reunioes-content');
  if(!el) return;

  let html = `
    <div style="margin-bottom:1rem">
      <button type="button" class="proj-btn" style="font-size:12px;padding:5px 12px" onclick="projGo('reunioes',document.getElementById('pnb-reunioes'))">← Voltar para Reuniões</button>
    </div>
    <h3 style="font-size:16px;font-weight:700;color:#1a2233;margin-bottom:1rem">${projEsc(proj.nome)} — Reuniões</h3>
  `;

  // Pendentes
  if(pendentes.length > 0) {
    html += `<div class="proj-card" style="margin-bottom:1rem">
      <div class="proj-card-t" style="color:#d97706">
        <svg viewBox="0 0 16 16" fill="none" width="14" height="14"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.4"/><path d="M8 5v4M8 11h.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        Reuniões Pendentes (${pendentes.length})
      </div>`;
    pendentes.forEach(r => {
      html += projRenderReuniaoItem(proj.id, r, false);
    });
    html += `</div>`;
  } else {
    html += `<div style="padding:1rem;color:#16a34a;font-size:13px;background:#f0fdf4;border-radius:8px;margin-bottom:1rem">✓ Nenhuma reunião pendente neste projeto.</div>`;
  }

  // Realizadas — spoiler
  if(realizadas.length > 0) {
    html += `
      <div class="proj-card" style="margin-bottom:1rem">
        <div class="proj-card-t" style="cursor:pointer;user-select:none" onclick="var c=document.getElementById('proj-reunioes-passadas-${projId}');var a=document.getElementById('proj-reunioes-arrow-${projId}');if(c.style.display==='none'){c.style.display='block';a.textContent='▼'}else{c.style.display='none';a.textContent='▶'}">
          <svg viewBox="0 0 16 16" fill="none" width="14" height="14"><path d="M2 6l3 3 5-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span id="proj-reunioes-arrow-${projId}" style="font-size:10px;margin-right:4px">▶</span> Ver reuniões passadas (${realizadas.length})
        </div>
        <div id="proj-reunioes-passadas-${projId}" style="display:none">`;
    realizadas.forEach(r => {
      html += projRenderReuniaoItem(proj.id, r, true);
    });
    html += `</div></div>`;
  }

  projSetSafeHtml(el, html);
}

// ── Helper: render a single reunião item ──
function projRenderReuniaoItem(projId, r, isDone) {
  const pid = projEsc(String(projId));
  return `
    <div class="proj-reunion-item ${isDone?'proj-reunion-done':''}" style="display:grid;grid-template-columns:auto 1fr auto auto auto;align-items:center;gap:8px;padding:.6rem 0;border-bottom:1px solid #eaecf3">
      <div class="proj-reunion-check ${isDone?'done':''}" onclick="projToggleReuniaoPage('${pid}','${projEsc(r.id)}')">
        ${isDone ? '<svg viewBox="0 0 12 12" fill="none" width="10" height="10"><path d="M2 6l3 3 5-5" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' : ''}
      </div>
      <div>
        <div class="proj-reunion-text">${projEsc(r.nome)}</div>
        <div style="font-size:11px;color:var(--ink3);margin-top:2px">
          ${r.data ? '📅 '+projFormatDate(r.data) + (r.participantes?' · ':'') : ''}
          ${r.participantes ? '👥 '+projEsc(r.participantes) : ''}
        </div>
        ${r.observacoes ? `<div style="font-size:11px;color:var(--ink3)">📝 ${projEsc(r.observacoes)}</div>` : ''}
      </div>
      <span style="font-size:10px;padding:2px 7px;border-radius:5px;${isDone?'background:var(--teal-l);color:var(--teal)':'background:var(--blue-l);color:var(--blue)'}">${isDone?'Realizada':'Pendente'}</span>
      <button type="button" class="proj-btn" style="font-size:11px;padding:3px 8px" onclick="projEditarReuniaoModal('${pid}','${projEsc(r.id)}')">✏️</button>
      <button type="button" class="proj-btn danger" style="font-size:11px;padding:3px 8px" onclick="projExcluirReuniao('${pid}','${projEsc(r.id)}')">✕</button>
    </div>
  `;
}

function projAdicionarReuniaoGlobal() {
  if(!projEnsureWriteAll('Apenas EPP pode criar reuniões.')) return;
  const projId = document.getElementById('greuniao-proj')?.value;
  const nome = document.getElementById('greuniao-nome')?.value.trim();
  if(!projId) { projToast('Selecione um projeto.', '#d97706'); return; }
  if(!nome)   { projToast('Informe o nome da reunião.', '#d97706'); return; }
  projLoad();
  const proj = PROJETOS.find(p => String(p.id) === String(projId));
  if(!proj) return;
  if(!proj.execucao) proj.execucao = { planner_link:'', percentual:0, reunioes:[] };
  if(!proj.execucao.reunioes) proj.execucao.reunioes = [];
  proj.execucao.reunioes.push({
    id: 'r' + Date.now(),
    nome,
    data: document.getElementById('greuniao-data')?.value || '',
    participantes: document.getElementById('greuniao-part')?.value.trim() || '',
    observacoes: document.getElementById('greuniao-obs')?.value.trim() || '',
    realizada: false
  });
  projSave();
  projToast('Reunião adicionada!');
  projAtualizarBadgeReunioes();
  projRenderReunioesPage();
}

function projEditarReuniaoModal(projetoId, reuniaoId) {
  if(!projEnsureWriteAll('Apenas EPP pode editar reuniões.')) return;
  projLoad();
  const proj = PROJETOS.find(p => String(p.id) === String(projetoId));
  if(!proj) return;
  const r = (proj.execucao?.reunioes||[]).find(r => String(r.id) === String(reuniaoId));
  if(!r) return;

  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:99999;display:flex;align-items:center;justify-content:center;padding:1rem';
  projSetSafeHtml(modal, `
    <div style="background:#fff;border-radius:16px;padding:1.6rem;width:100%;max-width:480px;box-shadow:0 16px 48px rgba(0,0,0,.2)">
      <div style="font-family:'Syne',sans-serif;font-size:15px;font-weight:700;color:#1a2540;margin-bottom:1.2rem">Editar Reunião</div>
      <div class="proj-fg"><label class="proj-fl">Nome<span>*</span></label>
        <input type="text" class="proj-fi" id="edit-r-nome" value="${projEsc(r.nome)}"></div>
      <div class="proj-g2">
        <div class="proj-fg"><label class="proj-fl">Data</label>
          <input type="date" class="proj-fi" id="edit-r-data" value="${projEsc(r.data||'')}"></div>
        <div class="proj-fg"><label class="proj-fl">Participantes</label>
          <input type="text" class="proj-fi" id="edit-r-part" value="${projEsc(r.participantes||'')}"></div>
      </div>
      <div class="proj-fg"><label class="proj-fl">Observações</label>
        <input type="text" class="proj-fi" id="edit-r-obs" value="${projEsc(r.observacoes||'')}"></div>
      <div class="proj-btn-row">
        <button type="button" class="proj-btn" onclick="this.closest('[style*=fixed]').remove()">Cancelar</button>
        <button type="button" class="proj-btn primary" onclick="projSalvarEdicaoReuniao('${projEsc(String(projetoId))}','${projEsc(String(reuniaoId))}',this)">Salvar</button>
      </div>
    </div>
  `);
  document.body.appendChild(modal);
}

function projSalvarEdicaoReuniao(projetoId, reuniaoId, btn) {
  if(!projEnsureWriteAll('Apenas EPP pode editar reuniões.')) return;
  const nome = document.getElementById('edit-r-nome')?.value.trim();
  if(!nome) { projToast('Informe o nome.','#d97706'); return; }
  projLoad();
  const proj = PROJETOS.find(p => String(p.id) === String(projetoId));
  if(!proj) return;
  const r = (proj.execucao?.reunioes||[]).find(r => String(r.id) === String(reuniaoId));
  if(!r) return;
  r.nome = nome;
  r.data = document.getElementById('edit-r-data')?.value || '';
  r.participantes = document.getElementById('edit-r-part')?.value.trim() || '';
  r.observacoes = document.getElementById('edit-r-obs')?.value.trim() || '';
  projSave();
  projToast('Reunião atualizada!');
  projAtualizarBadgeReunioes();
  btn.closest('[style*=fixed]').remove();
  projRenderReunioesPage();
}


function projToggleReuniaoPage(projetoId, reuniaoId) {
  projToggleReuniao(projetoId, reuniaoId);
  projRenderReunioesPage();
}

function projExcluirReuniao(projetoId, reuniaoId) {
  if(!projEnsureWriteAll('Apenas EPP pode excluir reuniões.')) return;
  projConfirmar('Tem certeza que deseja excluir esta reunião?\n\nEsta ação não pode ser desfeita.', () => {
    projLoad();
    const proj = PROJETOS.find(p => String(p.id) === String(projetoId));
    if(!proj) return;
    proj.execucao.reunioes = (proj.execucao.reunioes||[]).filter(r => String(r.id) !== String(reuniaoId));
    projSave();
    projRenderReunioesPage();
    projAtualizarBadgeReunioes();
    projToast('Reunião excluída.');
  });
}

// ════════════════════════════════════════════════════════════════════
// CRIAR PROJETO
// ════════════════════════════════════════════════════════════════════
function projRenderNovo() {
  // Just reset the form fields
  ['pnovo-nome','pnovo-gerente','pnovo-desc','pnovo-inicio','pnovo-fim','pnovo-patrocinador'].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.value = '';
  });
  const sel = document.getElementById('pnovo-fonte');
  if(sel) sel.value = '';
  // Populate program dropdown
  progLoad();
  const progSel = document.getElementById('pnovo-programa');
  if(progSel) {
    const ativos = PROGRAMAS.filter(pg => pg.status === 'ativo');
    projSetSafeHtml(progSel, '<option value="">Sem programa</option>' +
      ativos.map(pg => `<option value="${projEsc(String(pg.id))}">${projEsc(pg.nome)}</option>`).join(''));
    progSel.value = '';
  }
}

function projCriar() {
  if(!projEnsureWriteAll()) return;
  const nome = document.getElementById('pnovo-nome')?.value.trim();
  const gerente = document.getElementById('pnovo-gerente')?.value.trim();
  if(!nome) { projToast('Informe o nome do projeto.', '#d97706'); return; }
  if(!gerente) { projToast('Informe o gerente do projeto.', '#d97706'); return; }

  projLoad();
  const programaIdRaw = document.getElementById('pnovo-programa')?.value || '';
  const novo = projFixDefaults({
    id: Date.now(),
    nome,
    gerente,
    descricao: document.getElementById('pnovo-desc')?.value.trim()||'',
    dt_inicio: document.getElementById('pnovo-inicio')?.value||'',
    dt_fim: document.getElementById('pnovo-fim')?.value||'',
    patrocinador: document.getElementById('pnovo-patrocinador')?.value.trim()||'',
    fonte: document.getElementById('pnovo-fonte')?.value||'',
    fase_atual: 'aprovacao',
    status: 'ativo',
    percentual: 0,
    programa_id: programaIdRaw ? Number(programaIdRaw) : null,
    dt_criacao: new Date().toISOString().split('T')[0]
  });
  PROJETOS.push(novo);
  projSave();
  projToast('Projeto "' + nome + '" criado com sucesso!');
  projAbrirDetalhe(novo.id);
}

// ════════════════════════════════════════════════════════════════════
// EXCLUIR PROJETO
// ════════════════════════════════════════════════════════════════════
function projExcluir(id) {
  if(!projEnsureWriteAll()) return;
  const proj = PROJETOS.find(p => String(p.id) === String(id));
  if(!proj) return;
  projConfirmar(`Excluir o projeto "${proj.nome}"?\n\nAtenção: esta ação é irreversível e apagará todos os dados do projeto.`, () => {
    projConfirmar('Confirme novamente: EXCLUIR permanentemente o projeto "' + proj.nome + '"?', () => {
      projLoad();
      PROJETOS = PROJETOS.filter(p => String(p.id) !== String(id));
      projSave();
      projToast('Projeto excluído.');
      projGo('portfolio', document.getElementById('pnb-portfolio'));
    });
  });
}

// ════════════════════════════════════════════════════════════════════
// DETALHE DO PROJETO
// ════════════════════════════════════════════════════════════════════
function projAbrirDetalhe(id, forceWorkflow, preserveWorkflowTab) {
  projLoad();
  const sameProject = String(_projCurrentId || '') === String(id);
  _projCurrentId = String(id);
  _projCurrentPage = 'detalhe';
  const proj = PROJETOS.find(p => String(p.id) === String(id));
  if(!proj) { projToast('Projeto não encontrado.', '#b91c1c'); return; }
  if(!preserveWorkflowTab || !sameProject) {
    _projCurrentWorkflowTab = proj.fase_atual || 'aprovacao';
  }

  document.querySelectorAll('.proj-page').forEach(p => p.classList.remove('on'));
  document.querySelectorAll('.proj-nav-btn').forEach(b => b.classList.remove('on'));
  document.getElementById('proj-page-detalhe').classList.add('on');

  // For concluded/cancelled projects, show memorial by default unless forced
  if(!forceWorkflow && (proj.status === 'concluido' || proj.status === 'cancelado')) {
    projRenderMemorial(proj);
  } else {
    projRenderDetalhe(proj);
  }
}

function projRenderDetalhe(p) {
  const el = document.getElementById('proj-detalhe-content');
  if(!el) return;

  const faseIdx = FASE_IDX[p.fase_atual] || 0;

  // Build workflow indicator
  const workflow = PROJ_FASES.map((f, i) => {
    let dotClass = '';
    if(i < faseIdx) dotClass = 'done';
    else if(i === faseIdx) dotClass = 'active';
    return `
      <div class="proj-wf-step ${dotClass}">
        <div class="proj-wf-dot ${dotClass}">${dotClass==='done'?'✓':i+1}</div>
        <div class="proj-wf-label ${dotClass==='active'?'active':''}">${f.short}</div>
      </div>
    `;
  }).join('');

  // Build tabs based on current phase
  const tabs = PROJ_FASES.map((f,i) => `
    <div class="proj-tab ${i===0?'on':''}" onclick="projDetalheTab('${f.id}',this)">${f.label}</div>
  `).join('');

  projSetSafeHtml(el, `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:1.4rem;flex-wrap:wrap">
      <button type="button" class="proj-btn" style="font-size:12px;padding:5px 11px" onclick="projGo('portfolio',document.getElementById('pnb-portfolio'))">← Portfólio</button>
      <div style="font-size:28px;cursor:pointer;padding:2px 6px;border-radius:8px;border:1px dashed transparent;transition:all .2s" title="Alterar ícone" onclick="projShowEmojiPicker(${JSON.stringify(String(p.id))})" onmouseover="this.style.borderColor='#1A5DC8';this.style.background='#ebf1fc'" onmouseout="this.style.borderColor='transparent';this.style.background='none'">${p.icone_url ? '<img src="'+projEsc(p.icone_url)+'" style="width:32px;height:32px;object-fit:cover;border-radius:6px">' : projEsc(p.icone_emoji || '📁')}</div>
      <div style="flex:1">
        <div style="font-family:'Syne',sans-serif;font-size:19px;font-weight:700;color:#1a2540">${projEsc(p.nome)}</div>
        <div style="font-size:12px;color:var(--ink3);margin-top:2px">Gerente: ${projEsc(p.gerente)} ${p.patrocinador ? '· Patrocinador: '+projEsc(p.patrocinador) : ''}</div>
      </div>
      <span class="proj-list-badge ${projFaseBadgeClass(p.status,p.fase_atual)}" style="font-size:12px;padding:4px 12px">${projFaseText(p)}</span>
      ${p.status==='ativo' ? '<span id="proj-fase-buttons" data-pid="' + projEsc(String(p.id)) + '"></span>' : ''}
    </div>

    <!-- Workflow -->
    <div class="proj-card" style="margin-bottom:1.2rem">
      <div class="proj-workflow">${workflow}</div>
    </div>

    <!-- Tabs das fases -->
    <div class="proj-tabs" id="proj-detalhe-tabs">${tabs}</div>
    <div id="proj-detalhe-tab-content"></div>
  `);

  // Populate fase buttons (avoid nested template literals)
  let faseBtn = document.getElementById('proj-fase-buttons');
  if(faseBtn) {
    const pid = faseBtn.dataset.pid;
    let fIdx = FASE_IDX[p.fase_atual] || 0;
    faseBtn.replaceChildren();
    if(fIdx > 0){ const b=document.createElement('button'); b.type='button'; b.className='proj-btn'; b.style.cssText='font-size:12px;padding:5px 11px;margin-right:6px'; b.textContent='← Regredir Fase'; b.onclick=()=>projRegredirFase(pid); faseBtn.appendChild(b);}
    if(fIdx < PROJ_FASES.length - 1){ const b=document.createElement('button'); b.type='button'; b.className='proj-btn'; b.style.cssText='font-size:12px;padding:5px 11px'; b.textContent='Avançar Fase →'; b.onclick=()=>projAvancarFase(pid); faseBtn.appendChild(b);}
  }
  // Render first tab
  let faseToOpen = _projCurrentWorkflowTab || p.fase_atual || 'aprovacao';
  let tabIdx = {aprovacao:0, ideacao:1, planejamento:2, execucao:3, conclusao:4};
  let tIdx = tabIdx[faseToOpen] || 0;
  let tabEls = el.querySelectorAll('#proj-detalhe-tabs .proj-tab');
  projDetalheTab(faseToOpen, tabEls[tIdx] || tabEls[0]);
}

function projDetalheTab(faseId, tabEl) {
  _projCurrentWorkflowTab = faseId;
  document.querySelectorAll('#proj-detalhe-tabs .proj-tab').forEach(t => t.classList.remove('on'));
  if(tabEl) tabEl.classList.add('on');
  const proj = PROJETOS.find(p => String(p.id) === _projCurrentId);
  if(!proj) return;
  const content = document.getElementById('proj-detalhe-tab-content');
  if(!content) return;

  switch(faseId) {
    case 'aprovacao':    projSetSafeHtml(content, projTabAprovacao(proj)); setTimeout(projPopulateVinculacoes,50); break;
    case 'ideacao':      projSetSafeHtml(content, projTabIdeacao(proj)); break;
    case 'planejamento': projSetSafeHtml(content, projTabPlanejamento(proj)); break;
    case 'execucao':     projSetSafeHtml(content, projTabExecucao(proj)); break;
    case 'conclusao':    projSetSafeHtml(content, projTabConclusao(proj)); break;
  }
  projApplyProjectReadonly(faseId);
}

function projApplyProjectReadonly(faseId){
  if(isEP()) return;
  const content = document.getElementById('proj-detalhe-tab-content');
  if(!content) return;
  const controls = content.querySelectorAll('input, textarea, select, button');
  controls.forEach(el => {
    if(el.tagName === 'A') return;
    el.disabled = true;
    el.dataset.projReadonly = '1';
  });
  if(faseId === 'execucao' && projCanWriteSchedule()){
    const cron = content.querySelector('#exec-cronograma-section');
    if(cron){
      cron.querySelectorAll('input, textarea, select, button').forEach(el => {
        if(el.dataset.derivedDisabled) return;
        el.disabled = false;
        delete el.dataset.projReadonly;
      });
    }
  }
  if(!content.querySelector('.proj-readonly-banner')){
    const msg = projIsLinkedManager()
      ? 'Visualização geral. Este projeto está vinculado ao seu perfil Projetos; você pode editar apenas o cronograma.'
      : 'Seu perfil tem acesso apenas de visualização no SIGA Projetos.';
    projAppendSafeHtml(content, 'afterbegin', `<div class="proj-readonly-banner">${projEsc(msg)}</div>`);
  }
}

// ── ABA: APROVAÇÃO ───────────────────────────────────────────────
function projTabAprovacao(p) {
  const a = p.aprovacao || {};
  return `
    <div class="proj-form-section">
      <div class="proj-form-section-title">
        <svg viewBox="0 0 16 16" fill="none" width="14" height="14"><circle cx="8" cy="5" r="3" stroke="currentColor" stroke-width="1.4"/><path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
        Dados Oficiais do Projeto
      </div>
      <div class="proj-ib proj-ib-teal">
        É nesta fase que se oficializam os dados do projeto. Atualize aqui o nome, gerente, patrocinador e demais informações formais.
      </div>
      <div class="proj-g2">
        <div class="proj-fg">
          <label class="proj-fl">Nome do Projeto<span>*</span></label>
          <input type="text" class="proj-fi" id="aprov-nome" value="${projEsc(p.nome||'')}" onchange="projSalvarAprovacao()">
        </div>
        <div class="proj-fg">
          <label class="proj-fl">Gerente do Projeto</label>
          <input type="text" class="proj-fi" id="aprov-gerente" value="${projEsc(p.gerente||'')}" onchange="projSalvarAprovacao()">
        </div>
        <div class="proj-fg">
          <label class="proj-fl">Gerente Substituto</label>
          <input type="text" class="proj-fi" id="aprov-gerente-sub" value="${projEsc(p.gerente_substituto||'')}" onchange="projSalvarAprovacao()">
        </div>
        <div class="proj-fg">
          <label class="proj-fl">Divisão (opcional)</label>
          <select class="proj-fi" id="aprov-divisao" onchange="projSalvarAprovacao()">
            <option value="" ${!p.divisao?'selected':''}>— Nenhuma —</option>
            <option value="GAB" ${p.divisao==='GAB'?'selected':''}>GAB</option>
            <option value="DCO" ${p.divisao==='DCO'?'selected':''}>DCO</option>
            <option value="DAUD" ${p.divisao==='DAUD'?'selected':''}>DAUD</option>
            <option value="DCON" ${p.divisao==='DCON'?'selected':''}>DCON</option>
            <option value="DTTI" ${p.divisao==='DTTI'?'selected':''}>DTTI</option>
            <option value="DIE" ${p.divisao==='DIE'?'selected':''}>DIE</option>
          </select>
        </div>
      </div>
      <div class="proj-g3">
        <div class="proj-fg">
          <label class="proj-fl">Patrocinador</label>
          <input type="text" class="proj-fi" id="aprov-patrocinador" value="${projEsc(p.patrocinador||'')}" onchange="projSalvarAprovacao()">
        </div>
        <div class="proj-fg">
          <label class="proj-fl">Data de Início Prevista</label>
          <input type="date" class="proj-fi" id="aprov-inicio" value="${projEsc(p.dt_inicio||'')}" autocomplete="off" onkeydown="if(event.key==='Enter'){event.preventDefault();}" onchange="projSalvarAprovacao()">
        </div>
        <div class="proj-fg">
          <label class="proj-fl">Data de Fim Prevista</label>
          <input type="date" class="proj-fi" id="aprov-fim" value="${projEsc(p.dt_fim||'')}" autocomplete="off" onkeydown="if(event.key==='Enter'){event.preventDefault();}" onchange="projSalvarAprovacao()">
        </div>
      </div>
      <div class="proj-g2">
        <div class="proj-fg">
          <label class="proj-fl">Fonte do Projeto</label>
          <select class="proj-fi" id="aprov-fonte" onchange="projSalvarAprovacao()">
            <option value="">Selecione...</option>
            <option value="Gestão" ${p.fonte==='Gestão'?'selected':''}>Gestão</option>
            <option value="Proposição da Equipe" ${p.fonte==='Proposição da Equipe'?'selected':''}>Proposição da Equipe</option>
          </select>
        </div>
        <div class="proj-fg">
          <label class="proj-fl">Programa <span style="opacity:.5;font-size:10px;font-weight:400">(opcional)</span></label>
          <select class="proj-fi" id="aprov-programa" onchange="projSalvarAprovacao()">
            <option value="">Sem programa</option>
            ${(PROGRAMAS||[]).filter(pg=>pg.status!=='cancelado').map(pg=>`<option value="${projEsc(String(pg.id))}" ${String(p.programa_id)===String(pg.id)?'selected':''}>${projEsc(pg.nome)}</option>`).join('')}
          </select>
        </div>
      </div>
    </div>

    <div class="proj-form-section">
      <div class="proj-form-section-title">🔗 Vinculações Estratégicas</div>
      <div class="proj-fg">
        <label class="proj-fl">Macroprocessos da Cadeia de Valor</label>
        <div id="aprov-macro-list" style="margin-bottom:6px"></div>
        <div style="display:flex;gap:6px">
          <select class="proj-fi" id="aprov-macro-sel" style="flex:1"><option value="">Selecione...</option></select>
          <button type="button" class="proj-btn primary" style="font-size:11px;padding:4px 10px;white-space:nowrap" onclick="projAddMacro()">+ Adicionar</button>
        </div>
        <div style="margin-top:6px;display:flex;gap:6px">
          <input type="text" class="proj-fi" id="aprov-macro-novo" placeholder="Ou digite um novo..." style="flex:1;font-size:12px">
          <button type="button" class="proj-btn" style="font-size:11px;padding:4px 10px;white-space:nowrap" onclick="projAddMacroNovo()">+ Novo</button>
        </div>
      </div>
      <div class="proj-fg">
        <label class="proj-fl">Objetivos Estratégicos</label>
        <div id="aprov-obj-list" style="margin-bottom:6px"></div>
        <div style="display:flex;gap:6px">
          <select class="proj-fi" id="aprov-obj-sel" style="flex:1"><option value="">Selecione...</option></select>
          <button type="button" class="proj-btn primary" style="font-size:11px;padding:4px 10px;white-space:nowrap" onclick="projAddObj()">+ Adicionar</button>
        </div>
        <div style="margin-top:6px;display:flex;gap:6px">
          <input type="text" class="proj-fi" id="aprov-obj-novo" placeholder="Ou digite um novo..." style="flex:1;font-size:12px">
          <button type="button" class="proj-btn" style="font-size:11px;padding:4px 10px;white-space:nowrap" onclick="projAddObjNovo()">+ Novo</button>
        </div>
      </div>
    </div>

    <div class="proj-form-section">
      <div class="proj-form-section-title">
        <svg viewBox="0 0 16 16" fill="none" width="14" height="14"><path d="M3 2h10a1 1 0 011 1v10a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" stroke-width="1.4"/><path d="M5 8l2 2 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Aprovação pelo CGP
      </div>
      <div class="proj-ib proj-ib-blue">
        A aprovação formal é feita fora do sistema pelo Comitê Gestor de Projetos (CGP). Aqui registra-se apenas a referência a essa deliberação.
      </div>
      <div class="proj-g2">
        <div class="proj-fg">
          <label class="proj-fl">Status de Aprovação</label>
          <select class="proj-fi" id="aprov-ok" onchange="projSalvarAprovacao()">
            <option value="false" ${!a.aprovado?'selected':''}>Aguardando aprovação</option>
            <option value="true" ${a.aprovado?'selected':''}>Aprovado pelo CGP</option>
          </select>
        </div>

      </div>
      <div class="proj-fg">
        <label class="proj-fl">Motivo de Início / Justificativa</label>
        <textarea class="proj-fi" id="aprov-motivo" rows="3" placeholder="Descreva os motivos que levaram à proposição e abertura deste projeto..." onchange="projSalvarAprovacao()">${projEsc(a.motivo_inicio||'')}</textarea>
      </div>
      <div class="proj-fg">
        <label class="proj-fl">Observações</label>
        <textarea class="proj-fi" id="aprov-obs" rows="2" placeholder="Observações sobre a aprovação..." onchange="projSalvarAprovacao()">${projEsc(a.obs||'')}</textarea>
      </div>
      <div class="proj-btn-row">
        <button type="button" class="proj-btn teal" onclick="projSalvarAprovacao()">💾 Salvar</button>
      </div>
    </div>
  `;
}


function projSalvarAprovacao() {
  if(!projEnsureWriteAll()) return;
  projLoad();
  const proj = PROJETOS.find(p => String(p.id) === _projCurrentId);
  if(!proj) return;
  // Save project metadata (editable from this tab)
  const newNome = document.getElementById('aprov-nome')?.value.trim();
  if(newNome) proj.nome = newNome;
  proj.gerente = document.getElementById('aprov-gerente')?.value.trim() || proj.gerente;
  proj.gerente_substituto = document.getElementById('aprov-gerente-sub')?.value.trim() || '';
  proj.patrocinador = document.getElementById('aprov-patrocinador')?.value.trim() || proj.patrocinador;
  proj.dt_inicio = document.getElementById('aprov-inicio')?.value || proj.dt_inicio;
  proj.dt_fim = document.getElementById('aprov-fim')?.value || proj.dt_fim;
  proj.fonte = document.getElementById('aprov-fonte')?.value || proj.fonte;
  proj.divisao = document.getElementById('aprov-divisao')?.value || '';
  const progIdRaw = document.getElementById('aprov-programa')?.value;
  if(progIdRaw !== undefined) {
    proj.programa_id = progIdRaw ? Number(progIdRaw) : null;
  }
  proj.aprovacao = {
    motivo_inicio: document.getElementById('aprov-motivo')?.value || '',
    aprovado: document.getElementById('aprov-ok')?.value === 'true',
    deliberacao: document.getElementById('aprov-deliberacao')?.value || '',
    dt_aprovacao: document.getElementById('aprov-deliberacao')?.value || '', // backward compat
    obs: document.getElementById('aprov-obs')?.value || ''
  };
  projSave();
  // Refresh the page header to show updated name
  projAbrirDetalhe(_projCurrentId, true);
  projToast('Dados salvos!');
}

function projAddMacro(){if(!projEnsureWriteAll())return;let s=document.getElementById('aprov-macro-sel');if(!s||!s.value){projToast('Selecione um macroprocesso.','#d97706');return;}projLoad();let p=PROJETOS.find(function(x){return String(x.id)===_projCurrentId;});if(!p)return;if(!p.macroprocessos)p.macroprocessos=[];if(p.macroprocessos.indexOf(s.value)>=0){projToast('Já vinculado.','#d97706');return;}p.macroprocessos.push(s.value);projSave();projPopulateVinculacoes();}
function projRemoverMacro(i){if(!projEnsureWriteAll())return;projLoad();let p=PROJETOS.find(function(x){return String(x.id)===_projCurrentId;});if(!p||!p.macroprocessos)return;p.macroprocessos.splice(i,1);projSave();projPopulateVinculacoes();}
function projAddObj(){if(!projEnsureWriteAll())return;let s=document.getElementById('aprov-obj-sel');if(!s||!s.value){projToast('Selecione um objetivo.','#d97706');return;}projLoad();let p=PROJETOS.find(function(x){return String(x.id)===_projCurrentId;});if(!p)return;if(!p.objetivos_estrategicos)p.objetivos_estrategicos=[];if(p.objetivos_estrategicos.indexOf(s.value)>=0){projToast('Já vinculado.','#d97706');return;}p.objetivos_estrategicos.push(s.value);projSave();projPopulateVinculacoes();}
function projRemoverObj(i){if(!projEnsureWriteAll())return;projLoad();let p=PROJETOS.find(function(x){return String(x.id)===_projCurrentId;});if(!p||!p.objetivos_estrategicos)return;p.objetivos_estrategicos.splice(i,1);projSave();projPopulateVinculacoes();}

// ── ABA: IDEAÇÃO (Canvas) ────────────────────────────────────────
function projTabIdeacao(p) {
  const ide = p.ideacao || {};
  const canvasMode = ide.canvas_mode || 'manual';
  return `
    <!-- Link para Canvas externo -->
    <div class="proj-form-section" style="margin-bottom:1rem">
      <div class="proj-form-section-title">
        <svg viewBox="0 0 16 16" fill="none" width="14" height="14"><path d="M6 3H3v10h10v-3M10 3h3v3M7 9l6-6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Link para Canvas (externo)
      </div>
      <div class="proj-fg">
        <label class="proj-fl">Link para o Canvas do projeto (PDF, PPT, etc.)</label>
        <input type="url" class="proj-fi" id="canvas-link" value="${projEsc(ide.canvas_link||'')}" placeholder="https://..." onchange="projSalvarIdeacao()">
        ${ide.canvas_link ? `<div style="margin-top:5px"><a href="${projEsc(ide.canvas_link)}" target="_blank" class="proj-btn" style="font-size:11.5px;padding:4px 10px;text-decoration:none;display:inline-block">🔗 Abrir Canvas externo</a></div>` : ''}
      </div>
    </div>

    <!-- Slider: Canvas Manual / HTML Importado -->
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:1rem;padding:.6rem 1rem;background:#f8f9fb;border-radius:10px;border:1px solid #e5e8ef">
      <span style="font-size:12px;font-weight:600;color:${canvasMode==='manual'?'var(--blue)':'var(--ink3)'}">Canvas Manual</span>
      <label style="position:relative;width:44px;height:24px;cursor:pointer">
        <input type="checkbox" id="canvas-mode-toggle" ${canvasMode==='html'?'checked':''} onchange="projToggleCanvasMode()" style="opacity:0;width:0;height:0">
        <span style="position:absolute;inset:0;background:${canvasMode==='html'?'var(--blue)':'#ccc'};border-radius:24px;transition:.3s"></span>
        <span style="position:absolute;top:2px;left:${canvasMode==='html'?'22px':'2px'};width:20px;height:20px;background:#fff;border-radius:50%;transition:.3s;box-shadow:0 1px 3px rgba(0,0,0,.2)"></span>
      </label>
      <span style="font-size:12px;font-weight:600;color:${canvasMode==='html'?'var(--blue)':'var(--ink3)'}">HTML Importado</span>
    </div>

    <!-- Canvas HTML mode -->
    <div id="canvas-html-mode" style="display:${canvasMode==='html'?'block':'none'}">
      <div class="proj-form-section">
        <div class="proj-form-section-title">Canvas HTML Importado</div>
        <div class="proj-ib proj-ib-teal">Cole aqui o código HTML do Canvas de Ideação. O sistema renderizará abaixo.</div>
        <div class="proj-fg">
          <label class="proj-fl">Código HTML do Canvas</label>
          <textarea class="proj-fi" id="canvas-html-code" rows="5" placeholder="Cole o HTML aqui..." onchange="projSalvarIdeacao()">${projEsc(ide.canvas_html||'')}</textarea>
        </div>
        ${ide.canvas_html ? `
          <div class="proj-eap-embed">
            <div style="padding:.6rem .8rem;background:var(--teal-l);border-bottom:1px solid #e5e8ef;font-size:11px;font-weight:600;color:var(--teal)">Pré-visualização do Canvas</div>
            <iframe sandbox="allow-scripts" srcdoc="${(ide.canvas_html||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;')}" style="width:100%;min-height:200px;border:none;display:block"></iframe>
          </div>
        ` : ''}
      </div>
      <div class="proj-btn-row" style="margin-top:1rem">
        <button type="button" class="proj-btn teal" onclick="projSalvarIdeacao()">💾 Salvar</button>
      </div>
    </div>

    <!-- Canvas Manual mode -->
    <div id="canvas-manual-mode" style="display:${canvasMode==='manual'?'block':'none'}">
    <div class="proj-canvas-wrap">
      <div class="proj-canvas-header">
        <div class="proj-canvas-title">Canvas Ideação de Projetos</div>
        <div style="font-size:12px;color:rgba(255,255,255,.6)">Nome do Projeto: ${projEsc(p.nome)}</div>
      </div>
      <div class="proj-canvas-grid">
        <!-- Col 1: Por que fazer? -->
        <div class="proj-canvas-col">
          <div class="proj-canvas-col-header" style="background:var(--teal-l);color:var(--teal)">Por que fazer?</div>
          ${projCanvasCell(1,'DESCRIÇÃO','O que é o projeto?','canvas-descricao',ide.descricao||'')}
          ${projCanvasCell(2,'OBJETIVO SMART','Específico, mensurável, alcançável, realista e temporal','canvas-objetivo_smart',ide.objetivo_smart||'')}
          ${projCanvasCell(3,'BENEFÍCIOS','O que o projeto vai gerar?','canvas-beneficios',ide.beneficios||'')}
        </div>
        <!-- Col 2: O que deve ter? -->
        <div class="proj-canvas-col">
          <div class="proj-canvas-col-header" style="background:var(--blue-l);color:var(--blue)">O que deve ter?</div>
          ${projCanvasCell(4,'REQUISITOS','O que é imprescindível?','canvas-requisitos',ide.requisitos||'')}
          ${projCanvasCell(5,'PREMISSAS','Quais as suposições do que deve acontecer?','canvas-premissas',ide.premissas||'')}
          ${projCanvasCell(6,'RESTRIÇÕES','Quais as limitações do projeto?','canvas-restricoes',ide.restricoes||'')}
        </div>
        <!-- Col 3: Como será feito? -->
        <div class="proj-canvas-col">
          <div class="proj-canvas-col-header" style="background:#fff8e8;color:#b45309">Como será feito?</div>
          ${projCanvasCell(7,'ENTREGAS MACRO','O que será entregue pelo projeto?','canvas-entregas_macro',ide.entregas_macro||'')}
          ${projCanvasCell(8,'RISCOS','O que tem mais probabilidade de acontecer?','canvas-riscos_canvas',ide.riscos_canvas||'')}
          ${projCanvasCell(9,'EQUIPE','Quem participa do projeto?','canvas-equipe',ide.equipe||'')}
          ${projCanvasCell(10,'PARTES INTERESSADAS','Quem são os interessados ou podem ter impacto no projeto?','canvas-partes_interessadas',ide.partes_interessadas||'')}
        </div>
        <!-- Col 4: Quais resultados trará? -->
        <div class="proj-canvas-col">
          <div class="proj-canvas-col-header" style="background:#f3e8ff;color:#6b21a8">Quais resultados trará?</div>
          ${projCanvasObjetivoCell(p)}
          ${projCanvasCell(12,'CUSTOS','Qual a estimativa de custo? Há recurso disponível?','canvas-custos',ide.custos||'')}
          ${projCanvasCell(13,'RESULTADOS ESPERADOS','Quais resultados/indicadores serão gerados?','canvas-resultados_esperados',ide.resultados_esperados||'')}
          ${projCanvasCell(14,'AÇÕES IMEDIATAS','O que já pode ser implantado?','canvas-acoes_imediatas',ide.acoes_imediatas||'')}
        </div>
      </div>
    </div>
    <div class="proj-btn-row" style="margin-top:1rem">
      <button type="button" class="proj-btn teal" onclick="projSalvarIdeacao()">💾 Salvar Canvas</button>
    </div>
    </div>
  `;
}

function projToggleCanvasMode() {
  const toggle = document.getElementById('canvas-mode-toggle');
  const newMode = toggle && toggle.checked ? 'html' : 'manual';
  // Save mode preference
  projLoad();
  const proj = PROJETOS.find(p => String(p.id) === _projCurrentId);
  if(proj) {
    if(!proj.ideacao) proj.ideacao = {};
    proj.ideacao.canvas_mode = newMode;
    projSave();
  }
  // Re-render tab
  projDetalheTab('ideacao', document.querySelector('#proj-detalhe-tabs .proj-tab:nth-child(2)'));
}

function projCanvasCell(num, label, sub, fieldId, value) {
  return `
    <div class="proj-canvas-cell">
      <div class="proj-canvas-cell-num">${num}</div>
      <div class="proj-canvas-cell-label">${label}</div>
      <div class="proj-canvas-cell-sub">${sub}</div>
      <textarea id="${fieldId}" rows="4" placeholder="..." onchange="projSalvarIdeacao()">${projEsc(value)}</textarea>
    </div>
  `;
}

function projCanvasObjetivosSelecionados(p) {
  projNormalizeStrategyLists();
  const values = projMultiValues(p?.objetivos_estrategicos, p?.ideacao?.objetivo_estrategico)
    .map(v => projCanonicalStrategyValue(v, PROJ_OBJETIVOS))
    .filter(Boolean);
  return [...new Set(values)];
}

function projCanvasObjetivoCell(p) {
  const selected = projCanvasObjetivosSelecionados(p);
  const options = [...new Set([...(PROJ_OBJETIVOS || []), ...selected])]
    .filter(Boolean)
    .filter(o => !selected.includes(o))
    .map(o => `<option value="${projEsc(o)}">${projEsc(o)}</option>`)
    .join('');
  const selectedHtml = selected.length
    ? selected.map((o,i)=>`<div class="proj-canvas-oe-chip"><span>${projEsc(o)}</span><button type="button" onclick="projCanvasRemoverObj(${i})" aria-label="Remover objetivo estratégico">×</button></div>`).join('')
    : '<div class="proj-canvas-oe-empty">Nenhum OE vinculado.</div>';
  return `
    <div class="proj-canvas-cell proj-canvas-cell-oe">
      <div class="proj-canvas-cell-num">11</div>
      <div class="proj-canvas-cell-label">OBJETIVO ESTRATÉGICO</div>
      <div class="proj-canvas-cell-sub">Vincule o projeto a um ou mais objetivos estratégicos</div>
      <div id="canvas-objetivo_estrategico-list" class="proj-canvas-oe-list">${selectedHtml}</div>
      <div class="proj-canvas-oe-add">
        <select id="canvas-objetivo_estrategico-sel" class="proj-fi">
          <option value="">Selecione...</option>${options}
        </select>
        <button type="button" class="proj-btn primary" onclick="projCanvasAddObj()">+ Adicionar</button>
      </div>
    </div>
  `;
}

function projSyncIdeacaoObjetivos(proj) {
  if(!proj) return;
  if(!proj.ideacao) proj.ideacao = {};
  proj.objetivos_estrategicos = [...new Set((proj.objetivos_estrategicos || [])
    .map(v => projCanonicalStrategyValue(v, PROJ_OBJETIVOS))
    .filter(Boolean))];
  proj.ideacao.objetivo_estrategico = proj.objetivos_estrategicos.join('\n');
}

function projRerenderIdeacaoTab() {
  projDetalheTab('ideacao', document.querySelector('#proj-detalhe-tabs .proj-tab:nth-child(2)'));
}

function projCanvasAddObj() {
  if(!projEnsureWriteAll()) return;
  const s = document.getElementById('canvas-objetivo_estrategico-sel');
  if(!s || !s.value) { projToast('Selecione um objetivo.', '#d97706'); return; }
  projLoad();
  const p = PROJETOS.find(x => String(x.id) === _projCurrentId);
  if(!p) return;
  if(!p.objetivos_estrategicos) p.objetivos_estrategicos = [];
  const value = projCanonicalStrategyValue(s.value, PROJ_OBJETIVOS);
  if(p.objetivos_estrategicos.map(v => projCanonicalStrategyValue(v, PROJ_OBJETIVOS)).includes(value)) {
    projToast('Já vinculado.', '#d97706');
    return;
  }
  p.objetivos_estrategicos.push(value);
  projSyncIdeacaoObjetivos(p);
  projSave();
  projRerenderIdeacaoTab();
}

function projCanvasRemoverObj(i) {
  if(!projEnsureWriteAll()) return;
  projLoad();
  const p = PROJETOS.find(x => String(x.id) === _projCurrentId);
  if(!p || !p.objetivos_estrategicos) return;
  p.objetivos_estrategicos.splice(i, 1);
  projSyncIdeacaoObjetivos(p);
  projSave();
  projRerenderIdeacaoTab();
}

function projSalvarIdeacao() {
  if(!projEnsureWriteAll()) return;
  projLoad();
  const proj = PROJETOS.find(p => String(p.id) === _projCurrentId);
  if(!proj) return;
  const fields = ['descricao','objetivo_smart','beneficios','requisitos','premissas','restricoes',
    'entregas_macro','riscos_canvas','equipe','partes_interessadas',
    'custos','resultados_esperados','acoes_imediatas'];
  if(!proj.ideacao) proj.ideacao = {};
  fields.forEach(f => {
    const el = document.getElementById('canvas-'+f);
    if(el) proj.ideacao[f] = el.value;
  });
  if(document.getElementById('canvas-objetivo_estrategico-list')) projSyncIdeacaoObjetivos(proj);
  // Save HTML canvas and link
  const htmlCodeEl = document.getElementById('canvas-html-code');
  if(htmlCodeEl) proj.ideacao.canvas_html = htmlCodeEl.value;
  const linkEl = document.getElementById('canvas-link');
  if(linkEl) proj.ideacao.canvas_link = linkEl.value;
  const modeToggle = document.getElementById('canvas-mode-toggle');
  if(modeToggle) proj.ideacao.canvas_mode = modeToggle.checked ? 'html' : 'manual';
  projSave();
  projToast('Canvas salvo!');
}

// ── ABA: PLANEJAMENTO ────────────────────────────────────────────
function projTabPlanejamento(p) {
  const plan = p.planejamento || {};
  const riscos = plan.riscos || [];

  const eapMode = plan.eap_mode || 'html'; // 'html' or 'link'
  const eapSubMode = plan.eap_sub_mode || 'texto'; // 'upload' or 'texto'

  return `
    <div class="proj-form-section">
      <div class="proj-form-section-title">
        <svg viewBox="0 0 16 16" fill="none" width="14" height="14"><rect x="1" y="2" width="14" height="14" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M1 6h14M5 2v4M11 2v4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
        EAP — Estrutura Analítica do Projeto
      </div>

      <!-- Slider: EAP Nova em HTML / Link para EAP antiga -->
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:1rem;padding:.6rem 1rem;background:#f8f9fb;border-radius:10px;border:1px solid #e5e8ef">
        <span style="font-size:12px;font-weight:600;color:${eapMode==='html'?'var(--blue)':'var(--ink3)'}">EAP Nova em HTML</span>
        <label style="position:relative;width:44px;height:24px;cursor:pointer">
          <input type="checkbox" id="eap-mode-toggle" ${eapMode==='link'?'checked':''} onchange="projToggleEapMode()" style="opacity:0;width:0;height:0">
          <span style="position:absolute;inset:0;background:${eapMode==='link'?'var(--blue)':'#ccc'};border-radius:24px;transition:.3s"></span>
          <span style="position:absolute;top:2px;left:${eapMode==='link'?'22px':'2px'};width:20px;height:20px;background:#fff;border-radius:50%;transition:.3s;box-shadow:0 1px 3px rgba(0,0,0,.2)"></span>
        </label>
        <span style="font-size:12px;font-weight:600;color:${eapMode==='link'?'var(--blue)':'var(--ink3)'}">Link para EAP antiga</span>
      </div>

      <!-- EAP Link mode -->
      <div id="eap-link-mode" style="display:${eapMode==='link'?'block':'none'}">
        <div class="proj-fg">
          <label class="proj-fl">Link para a EAP (PDF, PPT, etc.)</label>
          <input type="url" class="proj-fi" id="plan-eap-link" value="${projEsc(plan.eap_link||'')}" placeholder="https://..." onchange="projSalvarPlanejamento()">
          ${plan.eap_link ? `<div style="margin-top:5px"><a href="${projEsc(plan.eap_link)}" target="_blank" class="proj-btn" style="font-size:11.5px;padding:4px 10px;text-decoration:none;display:inline-block">🔗 Abrir EAP externa</a></div>` : ''}
        </div>
      </div>

      <!-- EAP HTML mode -->
      <div id="eap-html-mode" style="display:${eapMode==='html'?'block':'none'}">
        <!-- Sub-slider: Upload / Texto -->
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:1rem;padding:.5rem .8rem;background:#f0f4ff;border-radius:8px;border:1px solid #e5e8ef">
          <span style="font-size:11px;font-weight:600;color:${eapSubMode==='upload'?'var(--blue)':'var(--ink3)'}">Upload</span>
          <label style="position:relative;width:36px;height:20px;cursor:pointer">
            <input type="checkbox" id="eap-sub-toggle" ${eapSubMode==='texto'?'checked':''} onchange="projToggleEapSub()" style="opacity:0;width:0;height:0">
            <span style="position:absolute;inset:0;background:${eapSubMode==='texto'?'var(--blue)':'#ccc'};border-radius:20px;transition:.3s"></span>
            <span style="position:absolute;top:2px;left:${eapSubMode==='texto'?'18px':'2px'};width:16px;height:16px;background:#fff;border-radius:50%;transition:.3s;box-shadow:0 1px 3px rgba(0,0,0,.2)"></span>
          </label>
          <span style="font-size:11px;font-weight:600;color:${eapSubMode==='texto'?'var(--blue)':'var(--ink3)'}">Texto</span>
        </div>

        <!-- Upload sub-mode -->
        <div id="eap-upload-mode" style="display:${eapSubMode==='upload'?'block':'none'}">
          <div class="proj-fg">
            <label class="proj-fl">Upload de arquivo HTML da EAP</label>
            <input type="file" accept=".html,.htm" class="proj-fi" id="plan-eap-upload" onchange="projUploadEapHtml()" style="padding:6px">
          </div>
        </div>

        <!-- Texto sub-mode -->
        <div id="eap-texto-mode" style="display:${eapSubMode==='texto'?'block':'none'}">
          <div class="proj-fg">
            <div id="plan-eap-textarea-wrap" style="display:none">
              <label class="proj-fl">Código HTML da EAP</label>
              <textarea class="proj-fi" id="plan-eap-html" rows="5" placeholder="Cole o código HTML da EAP aqui..." onchange="projSalvarPlanejamento()">${projEsc(plan.eap_html||'')}</textarea>
              <button type="button" class="proj-btn" style="font-size:11px;padding:4px 10px;margin-top:4px" onclick="document.getElementById('plan-eap-textarea-wrap').style.display='none'">Fechar editor</button>
            </div>
            <div id="plan-eap-textarea-btn" style="display:block">
              <button type="button" class="proj-btn" style="font-size:12px;padding:6px 14px" onclick="document.getElementById('plan-eap-textarea-wrap').style.display='block';document.getElementById('plan-eap-textarea-btn').style.display='none'">
                ${plan.eap_html ? '✏️ Editar código HTML da EAP' : '📝 Colar código HTML da EAP'}
              </button>
            </div>
          </div>
        </div>

        <!-- Preview da EAP -->
        ${plan.eap_html ? `
          <div class="proj-eap-embed" style="margin-top:.8rem">
            <div style="padding:.6rem .8rem;background:#f0f4ff;border-bottom:1px solid #e5e8ef;font-size:11px;font-weight:600;color:var(--blue)">Pré-visualização da EAP</div>
            <div style="padding:1rem;overflow-x:auto">${plan.eap_html}</div>
          </div>
        ` : ''}
      </div>
    </div>

    <div class="proj-form-section">
      <div class="proj-form-section-title">
        <svg viewBox="0 0 16 16" fill="none" width="14" height="14"><path d="M8 2l.8 2.5H14l-4.2 3.1 1.6 4.9L8 10.5l-3.4 2 1.6-4.9L2 5.5h5.2z" stroke="currentColor" stroke-width="1.3"/></svg>
        Matriz de Riscos
      </div>
      <div class="proj-ib proj-ib-amber">
        Registre os riscos do projeto. O mapa de calor será gerado automaticamente com base na probabilidade e impacto.
      </div>

      <!-- Adicionar risco -->
      <div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr auto;gap:8px;align-items:end;margin-bottom:.8rem">
        <div class="proj-fg" style="margin:0"><label class="proj-fl">Risco</label><input type="text" class="proj-fi" id="risco-desc" placeholder="Descrição do risco"></div>
        <div class="proj-fg" style="margin:0"><label class="proj-fl">Probabilidade</label>
          <select class="proj-fi" id="risco-prob">
            <option value="1">Muito Baixa (1)</option><option value="2">Baixa (2)</option>
            <option value="3" selected>Média (3)</option><option value="4">Alta (4)</option><option value="5">Muito Alta (5)</option>
          </select></div>
        <div class="proj-fg" style="margin:0"><label class="proj-fl">Impacto</label>
          <select class="proj-fi" id="risco-impacto">
            <option value="1">Muito Baixo (1)</option><option value="2">Baixo (2)</option>
            <option value="3" selected>Médio (3)</option><option value="4">Alto (4)</option><option value="5">Muito Alto (5)</option>
          </select></div>
        <div class="proj-fg" style="margin:0"><label class="proj-fl">Urgência</label>
          <select class="proj-fi" id="risco-urgencia">
            <option value="baixa">Baixa</option><option value="media" selected>Média</option><option value="alta">Alta</option>
          </select></div>
        <button type="button" class="proj-btn primary" style="margin-bottom:0;align-self:flex-end;padding:8px 14px" onclick="projAdicionarRisco()">+ Adicionar</button>
      </div>

      <!-- Tabela de riscos -->
      ${riscos.length > 0 ? `
        <table class="proj-risk-table" style="margin-bottom:1rem">
          <thead><tr>
            <th>#</th><th>Risco</th><th>Probabilidade</th><th>Impacto</th><th>Urgência</th><th>Criticidade</th><th>Ações</th>
          </tr></thead>
          <tbody>
            ${riscos.map((r,i) => {
              const crit = r.probabilidade * r.impacto;
              const critClass = crit >= 20 ? 'risk-critico' : crit >= 12 ? 'risk-alto' : crit >= 6 ? 'risk-medio' : 'risk-baixo';
              const critLabel = crit >= 20 ? 'Crítico' : crit >= 12 ? 'Alto' : crit >= 6 ? 'Médio' : 'Baixo';
              return `<tr>
                <td>${i+1}</td>
                <td>${projEsc(r.descricao)}</td>
                <td style="text-align:center">${r.probabilidade}</td>
                <td style="text-align:center">${r.impacto}</td>
                <td style="text-align:center">${projEsc(r.urgencia||'—')}</td>
                <td><span class="risk-heat ${critClass}">${critLabel} (${crit})</span></td>
                <td><button type="button" class="proj-btn danger" style="font-size:11px;padding:2px 7px" onclick="projExcluirRisco(${i})">✕</button></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
        <!-- Mapa de calor -->
        <div style="margin-top:1rem">
          <div style="font-size:11.5px;font-weight:700;color:#1a2540;margin-bottom:.5rem">Mapa de Calor dos Riscos</div>
          ${projGerarMapaCalor(riscos)}
        </div>
      ` : '<div style="text-align:center;padding:1rem;color:#b0b8cc;font-size:13px">Nenhum risco registrado ainda.</div>'}

      <div class="proj-btn-row">
        <button type="button" class="proj-btn teal" onclick="projSalvarPlanejamento()">💾 Salvar Planejamento</button>
      </div>
    </div>
  `;
}

function projGerarMapaCalor(riscos) {
  let cells = {};
  riscos.forEach(function(r) {
    let key = r.probabilidade + '-' + r.impacto;
    if(!cells[key]) cells[key] = [];
    cells[key].push(r.descricao);
  });
  function getHeatClass(p, imp) {
    let v = p * imp;
    if(v >= 20) return 'heat-5';
    if(v >= 12) return 'heat-4';
    if(v >= 6) return 'heat-3';
    if(v >= 3) return 'heat-2';
    return 'heat-1';
  }
  let html = '<div class="heat-map-grid" style="grid-template-columns:50px repeat(5,1fr)">';
  html += '<div class="heat-cell heat-label"></div>';
  for(let imp=1; imp<=5; imp++) html += '<div class="heat-cell heat-label" style="font-size:9px;background:none">Impacto '+imp+'</div>';
  for(let prob=5; prob>=1; prob--) {
    html += '<div class="heat-cell heat-label" style="font-size:9px;background:none;height:auto">Prob. '+prob+'</div>';
    for(let imp2=1; imp2<=5; imp2++) {
      let titles = cells[prob+'-'+imp2] || [];
      let cc = titles.length > 0 ? titles.map(function(t){return '<div style="font-size:8px;line-height:1.2;margin:1px 0">'+projEsc(t)+'</div>';}).join('') : '';
      html += '<div class="heat-cell '+getHeatClass(prob,imp2)+'" style="height:auto;min-height:36px;padding:3px;align-items:flex-start;flex-direction:column" title="Prob.'+prob+' x Imp.'+imp2+' = '+(prob*imp2)+'">'+cc+'</div>';
    }
  }
  html += '</div>';
  return html;
}

function projAdicionarRisco() {
  const desc = document.getElementById('risco-desc')?.value.trim();
  if(!desc) { projToast('Informe a descrição do risco.', '#d97706'); return; }
  projLoad();
  const proj = PROJETOS.find(p => String(p.id) === _projCurrentId);
  if(!proj) return;
  if(!proj.planejamento) proj.planejamento = { eap_html:'', riscos:[], planner_link:'' };
  if(!proj.planejamento.riscos) proj.planejamento.riscos = [];
  proj.planejamento.riscos.push({
    id: Date.now(),
    descricao: desc,
    probabilidade: Number.parseInt(document.getElementById('risco-prob')?.value, 10)||3,
    impacto: Number.parseInt(document.getElementById('risco-impacto')?.value, 10)||3,
    urgencia: document.getElementById('risco-urgencia')?.value||'media'
  });
  projSave();
  projToast('Risco adicionado!');
  projDetalheTab('planejamento', document.querySelector('#proj-detalhe-tabs .proj-tab:nth-child(3)'));
}

function projExcluirRisco(idx) {
  projConfirmar('Excluir este risco?', () => {
    projLoad();
    const proj = PROJETOS.find(p => String(p.id) === _projCurrentId);
    if(!proj) return;
    proj.planejamento.riscos.splice(idx, 1);
    projSave();
    projToast('Risco excluído.');
    projDetalheTab('planejamento', document.querySelector('#proj-detalhe-tabs .proj-tab:nth-child(3)'));
  });
}

function projSalvarPlanejamento() {
  if(!projEnsureWriteAll()) return;
  projLoad();
  const proj = PROJETOS.find(p => String(p.id) === _projCurrentId);
  if(!proj) return;
  if(!proj.planejamento) proj.planejamento = { eap_html:'', riscos:[], planner_link:'', eap_link:'', eap_mode:'html', eap_sub_mode:'texto' };
  proj.planejamento.eap_html = document.getElementById('plan-eap-html')?.value || proj.planejamento.eap_html || '';
  proj.planejamento.eap_link = document.getElementById('plan-eap-link')?.value || proj.planejamento.eap_link || '';
  projSave();
  projToast('Planejamento salvo!');
  projDetalheTab('planejamento', document.querySelector('#proj-detalhe-tabs .proj-tab:nth-child(3)'));
}

// ── EAP mode toggles ──
function projToggleEapMode() {
  projLoad();
  const proj = PROJETOS.find(p => String(p.id) === _projCurrentId);
  if(!proj) return;
  if(!proj.planejamento) proj.planejamento = { eap_html:'', riscos:[], planner_link:'', eap_link:'', eap_mode:'html', eap_sub_mode:'texto' };
  const toggle = document.getElementById('eap-mode-toggle');
  proj.planejamento.eap_mode = toggle && toggle.checked ? 'link' : 'html';
  projSave();
  projDetalheTab('planejamento', document.querySelector('#proj-detalhe-tabs .proj-tab:nth-child(3)'));
}

function projToggleEapSub() {
  projLoad();
  const proj = PROJETOS.find(p => String(p.id) === _projCurrentId);
  if(!proj) return;
  if(!proj.planejamento) proj.planejamento = { eap_html:'', riscos:[], planner_link:'', eap_link:'', eap_mode:'html', eap_sub_mode:'texto' };
  const toggle = document.getElementById('eap-sub-toggle');
  proj.planejamento.eap_sub_mode = toggle && toggle.checked ? 'texto' : 'upload';
  projSave();
  projDetalheTab('planejamento', document.querySelector('#proj-detalhe-tabs .proj-tab:nth-child(3)'));
}

function projUploadEapHtml() {
  const fileInput = document.getElementById('plan-eap-upload');
  if(!fileInput || !fileInput.files || !fileInput.files[0]) return;
  const file = fileInput.files[0];
  const reader = new FileReader();
  reader.onload = function(e) {
    projLoad();
    const proj = PROJETOS.find(p => String(p.id) === _projCurrentId);
    if(!proj) return;
    if(!proj.planejamento) proj.planejamento = { eap_html:'', riscos:[], planner_link:'', eap_link:'', eap_mode:'html', eap_sub_mode:'upload' };
    proj.planejamento.eap_html = e.target.result;
    projSave();
    projToast('HTML da EAP carregado!');
    projDetalheTab('planejamento', document.querySelector('#proj-detalhe-tabs .proj-tab:nth-child(3)'));
  };
  reader.readAsText(file);
}

// ── ABA: EXECUÇÃO E MONITORAMENTO ────────────────────────────────
function projTabExecucao(p) {
  const exec = p.execucao || {};
  const reunioes = exec.reunioes || [];
  const cronMode = exec.cron_mode || 'planner'; // 'planner' or 'siga'
  const pctMode = exec.pct_mode || 'manual'; // 'manual' or 'derivado'
  const tarefas = exec.tarefas || [];
  const canScheduleIO = projCanWriteSchedule(String(p.id));
  const todayBackup = projScheduleBackupForDate(p);
  projSyncDerivedTaskDates(tarefas);
  const derivedPct = projCalcDerivedPct(tarefas);
  const displayPct = pctMode === 'derivado' ? derivedPct : (p.percentual||0);

  // Compute task stats for dashboard
  const today = new Date().toISOString().slice(0,10);
  const flatTasks = projFlattenTasks(tarefas);
  const leafTasks = flatTasks.filter(t => !(t._children && t._children.length > 0));
  const concluidas = leafTasks.filter(t => t.concluida);
  const atrasadas = leafTasks.filter(t => !t.concluida && t.dt_fim && t.dt_fim < today);
  const futuras = leafTasks.filter(t => !t.concluida && (!t.dt_fim || t.dt_fim >= today));

  return `
    <div class="proj-form-section">
      <div class="proj-form-section-title">
        <svg viewBox="0 0 16 16" fill="none" width="14" height="14"><path d="M3 3h10a1 1 0 011 1v9a1 1 0 01-1 1H3a1 1 0 01-1-1V4a1 1 0 011-1z" stroke="currentColor" stroke-width="1.4"/><path d="M5 7h6M5 9.5h4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
        Execução e Monitoramento
      </div>

      <!-- % Conclusão -->
      <div class="proj-fg">
        <label class="proj-fl">% de Conclusão do Projeto</label>
        <div style="display:flex;align-items:center;gap:10px">
          ${pctMode === 'manual' ? `
            <input type="range" id="exec-percentual" min="0" max="100" step="1" value="${displayPct}" style="flex:1;accent-color:var(--blue)" oninput="document.getElementById('exec-pct-val').textContent=this.value+'%'" onchange="projSalvarExecucao()">
          ` : `
            <div style="flex:1;height:8px;background:#e5e8ef;border-radius:4px;overflow:hidden"><div style="height:100%;width:${derivedPct}%;background:var(--blue);border-radius:4px;transition:width .3s"></div></div>
            <input type="hidden" id="exec-percentual" value="${derivedPct}">
          `}
          <span id="exec-pct-val" style="font-size:16px;font-weight:700;color:var(--blue);min-width:46px">${displayPct}%</span>
        </div>
      </div>

      <!-- Item 7: Slider manual / derivado -->
      <div style="display:flex;align-items:center;gap:12px;margin:.8rem 0;padding:.5rem .8rem;background:#f0f4ff;border-radius:8px;border:1px solid #e5e8ef">
        <span style="font-size:11px;font-weight:600;color:${pctMode==='manual'?'var(--blue)':'var(--ink3)'}">Manual</span>
        <label style="position:relative;width:36px;height:20px;cursor:pointer">
          <input type="checkbox" id="exec-pct-mode-toggle" ${pctMode==='derivado'?'checked':''} onchange="projTogglePctMode()" style="opacity:0;width:0;height:0">
          <span style="position:absolute;inset:0;background:${pctMode==='derivado'?'var(--blue)':'#ccc'};border-radius:20px;transition:.3s"></span>
          <span style="position:absolute;top:2px;left:${pctMode==='derivado'?'18px':'2px'};width:16px;height:16px;background:#fff;border-radius:50%;transition:.3s;box-shadow:0 1px 3px rgba(0,0,0,.2)"></span>
        </label>
        <span style="font-size:11px;font-weight:600;color:${pctMode==='derivado'?'var(--blue)':'var(--ink3)'}">Derivado do Planner SIGA</span>
      </div>

      <div class="proj-btn-row" style="margin-bottom:0">
        <button type="button" class="proj-btn teal" onclick="projSalvarExecucao()">💾 Salvar</button>
      </div>
    </div>

    <!-- Cronograma -->
    <div class="proj-form-section" id="exec-cronograma-section">
      <div class="proj-form-section-title">
        <svg viewBox="0 0 16 16" fill="none" width="14" height="14"><rect x="1" y="3" width="14" height="12" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M5 1v4M11 1v4M1 7h14" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
        Cronograma / Planner
      </div>

      <!-- Slider: Planner antigo / SIGA -->
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:1rem;padding:.6rem 1rem;background:#f8f9fb;border-radius:10px;border:1px solid #e5e8ef">
        <span style="font-size:12px;font-weight:600;color:${cronMode==='planner'?'var(--blue)':'var(--ink3)'}">Cronograma antigo no Planner</span>
        <label style="position:relative;width:44px;height:24px;cursor:pointer">
          <input type="checkbox" id="exec-cron-toggle" ${cronMode==='siga'?'checked':''} onchange="projToggleCronMode()" style="opacity:0;width:0;height:0">
          <span style="position:absolute;inset:0;background:${cronMode==='siga'?'var(--blue)':'#ccc'};border-radius:24px;transition:.3s"></span>
          <span style="position:absolute;top:2px;left:${cronMode==='siga'?'22px':'2px'};width:20px;height:20px;background:#fff;border-radius:50%;transition:.3s;box-shadow:0 1px 3px rgba(0,0,0,.2)"></span>
        </label>
        <span style="font-size:12px;font-weight:600;color:${cronMode==='siga'?'var(--blue)':'var(--ink3)'}">Cronograma pelo SIGA</span>
      </div>

      <!-- Planner antigo -->
      <div id="exec-cron-planner" style="display:${cronMode==='planner'?'block':'none'}">
        <div class="proj-fg">
          <label class="proj-fl">Link Microsoft Planner do Projeto</label>
          <input type="url" class="proj-fi" id="exec-planner" value="${projEsc(exec.planner_link||'')}" placeholder="https://tasks.office.com/..." onchange="projSalvarExecucao()">
          ${exec.planner_link ? `<div style="margin-top:5px"><a href="${projEsc(exec.planner_link)}" target="_blank" class="proj-btn" style="font-size:11.5px;padding:4px 10px;text-decoration:none;display:inline-block">🔗 Abrir Planner</a></div>` : ''}
        </div>
      </div>

      <!-- SIGA Cronograma -->
      <div id="exec-cron-siga" style="display:${cronMode==='siga'?'block':'none'}">
        <!-- Dashboard -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:1rem">
          <div style="background:var(--blue-l);padding:.8rem;border-radius:8px;text-align:center">
            <div style="font-size:22px;font-weight:700;color:var(--blue)">${displayPct}%</div>
            <div style="font-size:10px;color:#5a6782">Conclusão</div>
          </div>
          <div style="background:#fef3cd;padding:.8rem;border-radius:8px;text-align:center">
            <div style="font-size:22px;font-weight:700;color:#d97706">${atrasadas.length}</div>
            <div style="font-size:10px;color:#92400e">Atrasadas</div>
          </div>
          <div style="background:#d1fae5;padding:.8rem;border-radius:8px;text-align:center">
            <div style="font-size:22px;font-weight:700;color:#059669">${concluidas.length}</div>
            <div style="font-size:10px;color:#065f46">Concluídas</div>
          </div>
          <div style="background:#f3f4f6;padding:.8rem;border-radius:8px;text-align:center">
            <div style="font-size:22px;font-weight:700;color:#6b7280">${futuras.length}</div>
            <div style="font-size:10px;color:#6b7280">Futuras</div>
          </div>
        </div>
        ${atrasadas.length > 0 ? `
          <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:.6rem .8rem;margin-bottom:1rem">
            <div style="font-size:11px;font-weight:700;color:#dc2626;margin-bottom:4px">⚠ Tarefas Atrasadas:</div>
            ${atrasadas.map(t => `<div style="font-size:11px;color:#991b1b">• ${t._parentName ? `<strong>${projEsc(t._parentName)}</strong> / ` : ''}${projEsc(t.nome)} (prev: ${projFormatDate(t.dt_fim)})</div>`).join('')}
          </div>
        ` : ''}
        <!-- Tabela de tarefas -->
        ${projProjectResponsibleOptions(p.id)}
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:12px">
            <thead>
              <tr style="background:#f0f4ff">
                <th style="padding:6px 4px;text-align:center;border-bottom:2px solid #d0d5e3;width:28px"></th>
                <th style="padding:6px 8px;text-align:left;border-bottom:2px solid #d0d5e3;width:70px">Nº</th>
                <th style="padding:6px 4px;text-align:center;border-bottom:2px solid #d0d5e3;width:24px">✓</th>
                <th style="padding:6px 8px;text-align:left;border-bottom:2px solid #d0d5e3">Nome</th>
                <th style="padding:6px 8px;text-align:center;border-bottom:2px solid #d0d5e3;width:68px">PPE</th>
                <th style="padding:6px 8px;text-align:center;border-bottom:2px solid #d0d5e3;width:78px">Marco</th>
                <th style="padding:6px 8px;text-align:center;border-bottom:2px solid #d0d5e3;width:100px">Início</th>
                <th style="padding:6px 8px;text-align:center;border-bottom:2px solid #d0d5e3;width:100px">Fim Prev.</th>
                <th style="padding:6px 8px;text-align:left;border-bottom:2px solid #d0d5e3;width:120px">Responsável</th>
                <th style="padding:6px 8px;text-align:center;border-bottom:2px solid #d0d5e3;width:70px">%</th>
                <th style="padding:6px 8px;text-align:center;border-bottom:2px solid #d0d5e3;width:42px">Anot.</th>
                <th style="padding:6px 8px;text-align:center;border-bottom:2px solid #d0d5e3;width:40px">Sub</th>
                <th style="padding:6px 8px;text-align:center;border-bottom:2px solid #d0d5e3;width:30px"></th>
                <th style="padding:6px 8px;text-align:center;border-bottom:2px solid #d0d5e3;width:56px">Ordem</th>
              </tr>
            </thead>
            <tbody id="exec-tarefas-body">
              ${projRenderTarefasRows(tarefas, 0)}
            </tbody>
          </table>
        </div>
        <div style="margin-top:.6rem;display:flex;gap:8px">
          <button type="button" class="proj-btn primary" style="font-size:11px;padding:5px 12px" onclick="projAddTarefa(null)">+ Tarefa</button>
          ${canScheduleIO ? `
          <button type="button" class="proj-btn" style="font-size:11px;padding:5px 12px" onclick="projExportCronogramaXLSX()">Exportar .xlsx</button>
          <button type="button" class="proj-btn" style="font-size:11px;padding:5px 12px" onclick="projImportCronogramaXLSX()">Importar .xlsx</button>
          <button type="button" class="proj-btn danger" style="font-size:11px;padding:5px 12px" ${todayBackup?'':'disabled title="Nenhum backup do início do dia disponível"'} onclick="projRestaurarCronogramaInicioDia()">Voltar para o início do dia</button>
          ` : ''}
        </div>
        <div style="font-size:10.5px;color:var(--ink3);margin-top:5px">${todayBackup ? `Backup do início do dia salvo em ${projFormatDate(todayBackup.data)}.` : 'O backup do início do dia será criado automaticamente quando houver atividades no cronograma.'}</div>
      </div>
    </div>

    <div class="proj-form-section">
      <div class="proj-form-section-title">
        <svg viewBox="0 0 16 16" fill="none" width="14" height="14"><rect x="2" y="8" width="3" height="6" rx="1" fill="currentColor" opacity=".45"/><rect x="6.5" y="5" width="3" height="9" rx="1" fill="currentColor"/><rect x="11" y="2" width="3" height="12" rx="1" fill="currentColor" opacity=".75"/></svg>
        Indicadores
      </div>
      ${projRenderIndicadoresExecucao(p)}
    </div>

    <div class="proj-form-section">
      <div class="proj-form-section-title">
        <svg viewBox="0 0 16 16" fill="none" width="14" height="14"><rect x="1" y="3" width="14" height="12" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M5 1v4M11 1v4M1 7h14" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
        Reuniões do Projeto
      </div>

      <!-- Adicionar reunião -->
      <div style="background:#f8f9fb;border:1px solid #e5e8ef;border-radius:10px;padding:.9rem;margin-bottom:1rem">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.7rem;flex-wrap:wrap;gap:6px">
          <span style="font-size:11.5px;font-weight:600;color:#3a4560">➕ Adicionar Reunião</span>
          <div style="display:flex;gap:6px">
            <button type="button" class="proj-btn" style="font-size:10.5px;padding:3px 8px" onclick="projAutoAddReunioesMes()">📅 Status Patrocinador (mês atual)</button>
            <button type="button" class="proj-btn" style="font-size:10.5px;padding:3px 8px" onclick="projDeduplicarReunioes()">🧹 Remover duplicadas</button>
          </div>
        </div>
        <div class="proj-g2" style="margin-bottom:.6rem">
          <div class="proj-fg" style="margin:0"><label class="proj-fl">Nome da Reunião<span>*</span></label>
            <input type="text" class="proj-fi" id="reuniao-nome" placeholder="Nome da reunião"></div>
          <div class="proj-fg" style="margin:0"><label class="proj-fl">Data (opcional)</label>
            <input type="date" class="proj-fi" id="reuniao-data"></div>
        </div>
        <div class="proj-g2" style="margin-bottom:.6rem">
          <div class="proj-fg" style="margin:0"><label class="proj-fl">Participantes (opcional)</label>
            <input type="text" class="proj-fi" id="reuniao-participantes" placeholder="Nomes dos participantes"></div>
          <div class="proj-fg" style="margin:0"><label class="proj-fl">Observações (opcional)</label>
            <input type="text" class="proj-fi" id="reuniao-obs" placeholder="Observações ou pauta"></div>
        </div>
        <div style="text-align:right">
          <button type="button" class="proj-btn primary" onclick="projAdicionarReuniao()">Adicionar Reunião</button>
        </div>
      </div>

      <!-- Lista de reuniões -->
      ${reunioes.length > 0 ? `
        <div>
          ${reunioes.map(r => `
            <div class="proj-reunion-item ${r.realizada?'proj-reunion-done':''}" style="display:grid;grid-template-columns:auto 1fr auto auto;align-items:center;gap:10px">
              <div class="proj-reunion-check ${r.realizada?'done':''}" onclick="projToggleReuniaoExec('${r.id}')">
                ${r.realizada ? '<svg viewBox="0 0 12 12" fill="none" width="10" height="10"><path d="M2 6l3 3 5-5" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' : ''}
              </div>
              <div>
                <div class="proj-reunion-text">${projEsc(r.nome)}</div>
                <div style="font-size:11px;color:var(--ink3);margin-top:2px">
                  ${r.data ? projFormatDate(r.data) + ' · ' : ''}
                  ${r.participantes ? '👥 '+projEsc(r.participantes) : ''}
                </div>
                ${r.observacoes ? `<div style="font-size:11px;color:var(--ink3)">📝 ${projEsc(r.observacoes)}</div>` : ''}
              </div>
              <span style="font-size:10px;padding:2px 7px;border-radius:5px;${r.realizada?'background:var(--teal-l);color:var(--teal)':'background:var(--blue-l);color:var(--blue)'}">${r.realizada?'Realizada':'Pendente'}</span>
              <button type="button" class="proj-btn danger" style="font-size:11px;padding:3px 8px" onclick="projExcluirReuniaoExec('${projEsc(r.id)}')">✕</button>
            </div>
          `).join('')}
        </div>
      ` : '<div style="text-align:center;padding:1rem;color:#b0b8cc;font-size:13px">Nenhuma reunião registrada.</div>'}
    </div>
  `;
}

// ── Planner SIGA: helpers ──
function projSyncDerivedTaskDates(tarefas) {
  (tarefas||[]).forEach(t => {
    const subs = t.subtarefas || [];
    if(subs.length) {
      projSyncDerivedTaskDates(subs);
      const starts = subs.map(s => s.dt_inicio).filter(Boolean).sort(projTextCompare);
      const ends = subs.map(s => s.dt_fim).filter(Boolean).sort(projTextCompare);
      t.dt_inicio = starts[0] || '';
      t.dt_fim = ends.length ? ends[ends.length - 1] : '';
    }
  });
  return tarefas || [];
}

function projFlattenTasks(tarefas, depth, parentName, parentPath) {
  let result = [];
  (tarefas||[]).forEach((t, i) => {
    const path = parentPath !== undefined && parentPath !== null && parentPath !== '' ? parentPath+'.'+i : ''+i;
    const copy = Object.assign({}, t, {_depth: depth||0, _children: t.subtarefas||[], _parentName: parentName || '', _path: path});
    result.push(copy);
    if(t.subtarefas && t.subtarefas.length > 0) {
      result = result.concat(projFlattenTasks(t.subtarefas, (depth||0)+1, t.nome || 'Tarefa superior', path));
    }
  });
  return result;
}

function projCalcTaskPct(t) {
  if(t.subtarefas && t.subtarefas.length > 0) {
    const sum = t.subtarefas.reduce((a,s) => a + projCalcTaskPct(s), 0);
    return Math.round(sum / t.subtarefas.length);
  }
  return t.conclusao || 0;
}

function projCalcDerivedPct(tarefas) {
  if(!tarefas || tarefas.length === 0) return 0;
  const sum = tarefas.reduce((a,t) => a + projCalcTaskPct(t), 0);
  return Math.round(sum / tarefas.length);
}

function projRenderTarefasRows(tarefas, depth, parentIdx) {
  if(!tarefas) return '';
  let html = '';
  const canWriteSchedule = projCanWriteSchedule();
  tarefas.forEach((t, i) => {
    const path = parentIdx !== undefined && parentIdx !== null ? parentIdx+'.'+i : ''+i;
    const hasSubs = t.subtarefas && t.subtarefas.length > 0;
    const pct = hasSubs ? projCalcTaskPct(t) : (t.conclusao||0);
    const indent = depth * 20;
    const bold = hasSubs ? 'font-weight:700' : '';
    const strike = t.concluida ? 'text-decoration:line-through;color:#9ca3af' : '';
    const today = new Date().toISOString().slice(0,10);
    const overdue = !t.concluida && t.dt_fim && t.dt_fim < today;
    const rowBg = overdue ? 'background:#fef2f2' : (t.concluida ? 'background:#f0fdf4' : '');
    const hasNotes = Array.isArray(t.anotacoes) && t.anotacoes.length > 0;
    const canDrag = canWriteSchedule && !hasSubs && parentIdx !== undefined && parentIdx !== null;
    const canMoveUp = i > 0;
    const canMoveDown = i < tarefas.length - 1;
    html += `<tr style="${rowBg}">
      <td style="padding:5px 4px;text-align:center;border-bottom:1px solid #eaecf3">
        ${canDrag ? `<button type="button" class="proj-task-drag-handle" draggable="true" title="Arrastar para reordenar no mesmo bloco" ondragstart="projTaskDragStart(event,'${path}')" ondragover="projTaskDragOver(event,'${path}')" ondrop="projTaskDrop(event,'${path}')" ondragend="projTaskDragEnd(event)">⋮⋮</button>` : ''}
      </td>
      <td style="padding:5px 8px;border-bottom:1px solid #eaecf3;${strike};font-family:'DM Mono',monospace;font-size:11px;white-space:nowrap">${path.split('.').map(n=>Number.parseInt(n,10)+1).join('.')}.</td>
      <td style="padding:5px 4px;text-align:center;border-bottom:1px solid #eaecf3">
        ${!hasSubs ? `<input type="checkbox" ${t.concluida?'checked':''} onchange="projToggleTarefa('${path}')">` : ''}
      </td>
      <td style="padding:5px 8px;border-bottom:1px solid #eaecf3;padding-left:${8+indent}px;${bold};${strike}">
        <input type="text" class="proj-task-name-input" value="${projEsc(t.nome||'Nova tarefa')}" placeholder="Nova tarefa" aria-label="Nome da tarefa" onchange="projUpdateTarefa('${path}','nome',this.value.trim()||'Nova tarefa')" onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}">
      </td>
      <td style="padding:5px 8px;text-align:center;border-bottom:1px solid #eaecf3">
        <button type="button" class="proj-task-flag ppe ${t.ppe?'on':''}" onclick="projToggleTarefaFlag('${path}','ppe')">PPE</button>
      </td>
      <td style="padding:5px 8px;text-align:center;border-bottom:1px solid #eaecf3">
        <button type="button" class="proj-task-flag marco ${t.marco?'on':''}" onclick="projToggleTarefaFlag('${path}','marco')">Marco</button>
      </td>
      <td style="padding:5px 8px;text-align:center;border-bottom:1px solid #eaecf3;${strike}"><input type="date" value="${t.dt_inicio||''}" ${hasSubs?'disabled data-derived-disabled="1" title="Data derivada das subtarefas"':''} onchange="projUpdateTarefa('${path}','dt_inicio',this.value)" style="font-size:11px;border:1px solid #ddd;border-radius:4px;padding:2px 4px;width:100%;${hasSubs?'background:#f3f4f6;color:#64748b':''}"></td>
      <td style="padding:5px 8px;text-align:center;border-bottom:1px solid #eaecf3;${strike}${overdue?';color:#dc2626;font-weight:600':''}"><input type="date" value="${t.dt_fim||''}" ${hasSubs?'disabled data-derived-disabled="1" title="Data derivada das subtarefas"':''} onchange="projUpdateTarefa('${path}','dt_fim',this.value)" style="font-size:11px;border:1px solid ${overdue?'#fca5a5':'#ddd'};border-radius:4px;padding:2px 4px;width:100%;${hasSubs?'background:#f3f4f6;color:#64748b':''}"></td>
      <td style="padding:5px 8px;border-bottom:1px solid #eaecf3;${strike}"><input type="text" list="proj-responsaveis-options" value="${projEsc(t.responsavel||'')}" onchange="projUpdateTarefaResponsavel('${path}',this.value)" style="font-size:11px;border:1px solid #ddd;border-radius:4px;padding:2px 4px;width:100%" placeholder="Usuário ou área"></td>
      <td style="padding:5px 8px;text-align:center;border-bottom:1px solid #eaecf3;${strike}">
        ${hasSubs ? `<span style="font-size:11px;font-weight:600;color:var(--blue)">${pct}%</span>` :
          `<input type="number" min="0" max="100" value="${pct}" onchange="projUpdateTarefa('${path}','conclusao',Number.parseInt(this.value,10)||0)" style="font-size:11px;border:1px solid #ddd;border-radius:4px;padding:2px 4px;width:50px;text-align:center">`}
      </td>
      <td style="padding:5px 4px;text-align:center;border-bottom:1px solid #eaecf3">
        <button type="button" class="proj-task-note-btn ${hasNotes?'on':''}" title="Anotações" onclick="projOpenTaskNotes('${path}')">✎</button>
      </td>
      <td style="padding:5px 4px;text-align:center;border-bottom:1px solid #eaecf3">
        <button type="button" title="Adicionar subtarefa" style="background:none;border:none;cursor:pointer;font-size:13px;padding:0" onclick="projAddTarefa('${path}')">＋</button>
      </td>
      <td style="padding:5px 4px;text-align:center;border-bottom:1px solid #eaecf3">
        <button type="button" title="Excluir" style="background:none;border:none;cursor:pointer;font-size:13px;color:#dc2626;padding:0" onclick="projRemoveTarefa('${path}')">✕</button>
      </td>
      <td style="padding:5px 4px;text-align:center;border-bottom:1px solid #eaecf3">
        ${canWriteSchedule && hasSubs ? `<div class="proj-task-order-controls">
          <button type="button" title="Mover para cima" ${canMoveUp?'':'disabled'} onclick="projMoveTaskByButton('${path}',-1)">↑</button>
          <button type="button" title="Mover para baixo" ${canMoveDown?'':'disabled'} onclick="projMoveTaskByButton('${path}',1)">↓</button>
        </div>` : ''}
      </td>
    </tr>`;
    if(hasSubs) {
      html += projRenderTarefasRows(t.subtarefas, depth+1, path);
    }
  });
  return html;
}

// ── Planner SIGA: CRUD ──
function projScheduleBackupForDate(proj, dateKey = projLocalDateKey()){
  const backups = proj?.execucao?.cron_backups;
  if(!backups || typeof backups !== 'object' || Array.isArray(backups)) return null;
  return backups[dateKey] || null;
}

function projGetTarefaByPath(tarefas, path) {
  const parts = path.split('.').map(Number);
  let list = tarefas;
  for(let i=0;i<parts.length-1;i++){
    if(!list[parts[i]]) return null;
    list = list[parts[i]].subtarefas || [];
  }
  return {list, index: parts[parts.length-1]};
}

let _projTaskDragPath = '';

function projTaskParentPath(path) {
  const text = String(path || '');
  const idx = text.lastIndexOf('.');
  return idx === -1 ? '' : text.slice(0, idx);
}

function projTaskIndexFromPath(path) {
  const idx = Number.parseInt(String(path || '').split('.').pop(), 10);
  return Number.isFinite(idx) ? idx : -1;
}

function projRefreshScheduleAfterMutation(proj) {
  projSyncDerivedTaskDates(proj.execucao.tarefas);
  if(proj.execucao.pct_mode === 'derivado') {
    proj.percentual = projCalcDerivedPct(proj.execucao.tarefas);
    proj.execucao.percentual = proj.percentual;
  }
  projSave();
  projDetalheTab('execucao', document.querySelector('#proj-detalhe-tabs .proj-tab:nth-child(4)'));
}

function projMoveTaskToIndex(path, targetIndex) {
  return projWithScheduleWrite(() => {
    projLoad();
    const proj = PROJETOS.find(p => String(p.id) === _projCurrentId);
    if(!proj || !proj.execucao || !proj.execucao.tarefas) return;
    const ref = projGetTarefaByPath(proj.execucao.tarefas, path);
    if(!ref || !ref.list || !ref.list[ref.index]) return;
    const boundedTarget = Math.max(0, Math.min(targetIndex, ref.list.length - 1));
    if(ref.index === boundedTarget) return;
    projEnsureCurrentScheduleBackupBeforeMutation(proj);
    const [task] = ref.list.splice(ref.index, 1);
    ref.list.splice(boundedTarget, 0, task);
    projRefreshScheduleAfterMutation(proj);
  });
}

function projMoveTaskByButton(path, direction) {
  projLoad();
  const proj = PROJETOS.find(p => String(p.id) === _projCurrentId);
  if(!proj || !proj.execucao || !proj.execucao.tarefas) return;
  const ref = projGetTarefaByPath(proj.execucao.tarefas, path);
  const task = ref && ref.list ? ref.list[ref.index] : null;
  if(!task || !(task.subtarefas || []).length) return;
  projMoveTaskToIndex(path, ref.index + direction);
}

function projTaskDragStart(event, path) {
  _projTaskDragPath = String(path || '');
  if(event?.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', _projTaskDragPath);
  }
}

function projTaskDragOver(event, path) {
  const fromPath = _projTaskDragPath || event?.dataTransfer?.getData('text/plain') || '';
  if(fromPath && projTaskParentPath(fromPath) === projTaskParentPath(path)) {
    event.preventDefault();
    if(event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  }
}

function projTaskDrop(event, targetPath) {
  event.preventDefault();
  const fromPath = _projTaskDragPath || event?.dataTransfer?.getData('text/plain') || '';
  _projTaskDragPath = '';
  if(!fromPath || fromPath === targetPath) return;
  if(projTaskParentPath(fromPath) !== projTaskParentPath(targetPath)) {
    projToast('Reordene tarefas apenas dentro do mesmo bloco.', '#d97706');
    return;
  }
  const fromIndex = projTaskIndexFromPath(fromPath);
  const targetIndex = projTaskIndexFromPath(targetPath);
  if(fromIndex < 0 || targetIndex < 0) return;
  projMoveTaskToIndex(fromPath, targetIndex);
}

function projTaskDragEnd() {
  _projTaskDragPath = '';
}

function projFormatBrasiliaDateTime(value) {
  if(!value) return '';
  const date = new Date(value);
  if(Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(date);
}

function projCloseTaskNotes() {
  const el = document.getElementById('proj-task-notes-modal');
  if(el) el.remove();
}

function projCurrentUserForNote() {
  const user = typeof usuarioLogado !== 'undefined' ? usuarioLogado : null;
  return {
    name: projUserDisplayName(user) || String(user?.email || 'Usuário'),
    email: String(user?.email || '').trim().toLowerCase()
  };
}

function projCanDeleteTaskNote(note) {
  const currentUser = projCurrentUserForNote();
  const noteEmail = String(note?.autor_email || '').trim().toLowerCase();
  if(noteEmail && currentUser.email) return noteEmail === currentUser.email;
  const currentName = projNormKey(currentUser.name);
  const noteName = projNormKey(note?.autor_nome);
  return Boolean(noteName && currentName && currentName !== 'usuário' && noteName === currentName);
}

function projOpenTaskNotes(path) {
  projLoad();
  const proj = PROJETOS.find(p => String(p.id) === _projCurrentId);
  const ref = proj && proj.execucao ? projGetTarefaByPath(proj.execucao.tarefas || [], path) : null;
  const task = ref && ref.list ? ref.list[ref.index] : null;
  if(!task) return;
  projCloseTaskNotes();
  const notes = Array.isArray(task.anotacoes) ? task.anotacoes : [];
  const canWriteSchedule = projCanWriteSchedule(proj.id);
  const modal = document.createElement('div');
  modal.id = 'proj-task-notes-modal';
  modal.className = 'proj-task-notes-backdrop';
  projSetSafeHtml(modal, `
    <div class="proj-task-notes-card" role="dialog" aria-modal="true" aria-labelledby="proj-task-notes-title">
      <div class="proj-task-notes-head">
        <div>
          <div id="proj-task-notes-title" class="proj-task-notes-title">Anotações</div>
          <div class="proj-task-notes-subtitle">${projEsc(task.nome || 'Tarefa')}</div>
        </div>
        <button type="button" class="proj-task-notes-close" onclick="projCloseTaskNotes()" aria-label="Fechar">×</button>
      </div>
      <div class="proj-task-notes-list">
        ${notes.length ? notes.map(n => `
          <article class="proj-task-note-item">
            <div class="proj-task-note-head">
              <div class="proj-task-note-meta">${projEsc(n.autor_nome || 'Usuário')} · ${projEsc(projFormatBrasiliaDateTime(n.criado_em))} BRT</div>
              ${canWriteSchedule && projCanDeleteTaskNote(n) ? `<button type="button" class="proj-task-note-delete" title="Excluir anotação" onclick="projDeleteTaskNote('${path}','${projEsc(n.id || '')}')">Excluir</button>` : ''}
            </div>
            <div class="proj-task-note-text">${projEsc(n.texto || '')}</div>
          </article>
        `).join('') : '<div class="proj-task-notes-empty">Nenhuma anotação publicada.</div>'}
      </div>
      ${canWriteSchedule ? `<textarea id="proj-task-note-text" class="proj-fi proj-task-note-textarea" placeholder="Escreva uma anotação sobre esta tarefa"></textarea>` : '<div class="proj-task-notes-empty">Você pode visualizar as anotações, mas não editar o cronograma deste projeto.</div>'}
      <div class="proj-task-notes-actions">
        <button type="button" class="proj-btn" onclick="projCloseTaskNotes()">Cancelar</button>
        ${canWriteSchedule ? `<button type="button" class="proj-btn primary" onclick="projPublishTaskNote('${path}')">Publicar</button>` : ''}
      </div>
    </div>
  `);
  modal.addEventListener('click', ev => {
    if(ev.target === modal) projCloseTaskNotes();
  });
  document.body.appendChild(modal);
  const input = document.getElementById('proj-task-note-text');
  if(input) input.focus();
}

function projPublishTaskNote(path) {
  const input = document.getElementById('proj-task-note-text');
  const text = String(input?.value || '').trim();
  if(!text) {
    projToast('Escreva uma anotação antes de publicar.', '#d97706');
    return;
  }
  return projWithScheduleWrite(() => {
    projLoad();
    const proj = PROJETOS.find(p => String(p.id) === _projCurrentId);
    if(!proj || !proj.execucao || !proj.execucao.tarefas) return;
    const ref = projGetTarefaByPath(proj.execucao.tarefas, path);
    const task = ref && ref.list ? ref.list[ref.index] : null;
    if(!task) return;
    projEnsureCurrentScheduleBackupBeforeMutation(proj);
    const currentUser = projCurrentUserForNote();
    if(!Array.isArray(task.anotacoes)) task.anotacoes = [];
    task.anotacoes.push({
      id: `note-${Date.now()}`,
      texto: text,
      autor_nome: currentUser.name,
      autor_email: currentUser.email,
      criado_em: new Date().toISOString()
    });
    projSave();
    projCloseTaskNotes();
    projToast('Anotação publicada.', 'var(--teal)');
    projDetalheTab('execucao', document.querySelector('#proj-detalhe-tabs .proj-tab:nth-child(4)'));
  });
}

function projDeleteTaskNote(path, noteId) {
  return projWithScheduleWrite(() => {
    projLoad();
    const proj = PROJETOS.find(p => String(p.id) === _projCurrentId);
    if(!proj || !proj.execucao || !proj.execucao.tarefas) return;
    const ref = projGetTarefaByPath(proj.execucao.tarefas, path);
    const task = ref && ref.list ? ref.list[ref.index] : null;
    if(!task || !Array.isArray(task.anotacoes)) return;
    const index = task.anotacoes.findIndex(n => String(n.id || '') === String(noteId || ''));
    const note = index >= 0 ? task.anotacoes[index] : null;
    if(!note || !projCanDeleteTaskNote(note)) {
      projToast('Você só pode excluir suas próprias anotações.', '#d97706');
      return;
    }
    projEnsureCurrentScheduleBackupBeforeMutation(proj);
    task.anotacoes.splice(index, 1);
    projSave();
    projToast('Anotação excluída.', 'var(--teal)');
    projDetalheTab('execucao', document.querySelector('#proj-detalhe-tabs .proj-tab:nth-child(4)'));
    projOpenTaskNotes(path);
  });
}

function projAddTarefa(parentPath) {
  return projWithScheduleWrite(() => {
  projLoad();
  const proj = PROJETOS.find(p => String(p.id) === _projCurrentId);
  if(!proj) return;
  if(!proj.execucao) proj.execucao = {planner_link:'',percentual:0,reunioes:[],tarefas:[]};
  if(!proj.execucao.tarefas) proj.execucao.tarefas = [];
  projEnsureCurrentScheduleBackupBeforeMutation(proj);
  const nova = {id:'t'+Date.now(), nome:'Nova tarefa', ppe:false, marco:false, dt_inicio:'', dt_fim:'', responsavel:'', conclusao:0, concluida:false, subtarefas:[]};
  if(parentPath === null || parentPath === undefined) {
    proj.execucao.tarefas.push(nova);
  } else {
    const ref = projGetTarefaByPath(proj.execucao.tarefas, parentPath);
    if(ref && ref.list[ref.index]) {
      if(!ref.list[ref.index].subtarefas) ref.list[ref.index].subtarefas = [];
      ref.list[ref.index].subtarefas.push(nova);
    }
  }
  projSyncDerivedTaskDates(proj.execucao.tarefas);
  projSave();
  projDetalheTab('execucao', document.querySelector('#proj-detalhe-tabs .proj-tab:nth-child(4)'));
  });
}

function projRemoveTarefa(path) {
  if(!projEnsureWriteSchedule()) return;
  projLoad();
  const proj = PROJETOS.find(p => String(p.id) === _projCurrentId);
  if(!proj || !proj.execucao || !proj.execucao.tarefas) return;
  projEnsureCurrentScheduleBackupBeforeMutation(proj);
  const ref = projGetTarefaByPath(proj.execucao.tarefas, path);
  const task = ref && ref.list ? ref.list[ref.index] : null;
  const subCount = task ? projScheduleTasksCount(task.subtarefas || []) : 0;
  if(task && subCount > 0) {
    projConfirmar(`Excluir a tarefa "${task.nome || 'Tarefa'}" e ${subCount} subtarefa(s)?\n\nEsta tarefa calcula automaticamente início, fim e percentual a partir das subtarefas. A exclusão removerá tudo que está abaixo dela.`, () => projRemoveTarefaConfirmada(path));
    return;
  }
  return projRemoveTarefaConfirmada(path);
}

function projRemoveTarefaConfirmada(path) {
  return projWithScheduleWrite(() => {
  projLoad();
  const proj = PROJETOS.find(p => String(p.id) === _projCurrentId);
  if(!proj || !proj.execucao || !proj.execucao.tarefas) return;
  projEnsureCurrentScheduleBackupBeforeMutation(proj);
  const ref = projGetTarefaByPath(proj.execucao.tarefas, path);
  if(ref) ref.list.splice(ref.index, 1);
  projSyncDerivedTaskDates(proj.execucao.tarefas);
  projSave();
  projDetalheTab('execucao', document.querySelector('#proj-detalhe-tabs .proj-tab:nth-child(4)'));
  });
}

function projRestaurarCronogramaInicioDia() {
  if(!projEnsureWriteSchedule()) return;
  projLoad();
  const proj = PROJETOS.find(p => String(p.id) === _projCurrentId);
  const backup = projScheduleBackupForDate(proj);
  if(!proj || !backup) {
    projToast('Nenhum backup do início do dia disponível para este projeto.', '#d97706');
    return;
  }
  const total = projScheduleTasksCount(backup.tarefas || []);
  projConfirmar(`Voltar o cronograma de "${proj.nome || 'Projeto'}" para o início do dia?\n\nIsso substituirá as tarefas atuais pelas ${total} tarefa(s) salvas no backup de ${projFormatDate(backup.data)}.`, () => {
    projWithScheduleWrite(() => {
      projLoad();
      const p = PROJETOS.find(x => String(x.id) === _projCurrentId);
      const b = projScheduleBackupForDate(p);
      if(!p || !b) {
        projToast('Backup do início do dia não encontrado.', '#dc2626');
        return;
      }
      if(!p.execucao) p.execucao = {planner_link:'',percentual:0,reunioes:[],tarefas:[]};
      p.execucao.tarefas = projCloneScheduleTasks(b.tarefas || []);
      projSyncDerivedTaskDates(p.execucao.tarefas);
      if(p.execucao.pct_mode === 'derivado') {
        p.percentual = projCalcDerivedPct(p.execucao.tarefas);
        p.execucao.percentual = p.percentual;
      }
      projSave();
      projToast('Cronograma restaurado para o início do dia.', 'var(--teal)');
      projDetalheTab('execucao', document.querySelector('#proj-detalhe-tabs .proj-tab:nth-child(4)'));
    });
  });
}

function projUpdateTarefa(path, field, value) {
  return projWithScheduleWrite(() => {
  projLoad();
  const proj = PROJETOS.find(p => String(p.id) === _projCurrentId);
  if(!proj || !proj.execucao || !proj.execucao.tarefas) return;
  projEnsureCurrentScheduleBackupBeforeMutation(proj);
  const ref = projGetTarefaByPath(proj.execucao.tarefas, path);
  if(ref && ref.list[ref.index]) {
    ref.list[ref.index][field] = value;
    if(field === 'conclusao' && value >= 100) ref.list[ref.index].concluida = true;
    if(field === 'conclusao' && value < 100) ref.list[ref.index].concluida = false;
  }
  projSyncDerivedTaskDates(proj.execucao.tarefas);
  // Update derived pct
  if(proj.execucao.pct_mode === 'derivado') {
    proj.percentual = projCalcDerivedPct(proj.execucao.tarefas);
    proj.execucao.percentual = proj.percentual;
  }
  projSave();
  projDetalheTab('execucao', document.querySelector('#proj-detalhe-tabs .proj-tab:nth-child(4)'));
  });
}

function projUpdateTarefaResponsavel(path, rawValue) {
  return projWithScheduleWrite(() => {
  projLoad();
  const proj = PROJETOS.find(p => String(p.id) === _projCurrentId);
  if(!proj || !proj.execucao || !proj.execucao.tarefas) return;
  projEnsureCurrentScheduleBackupBeforeMutation(proj);
  const ref = projGetTarefaByPath(proj.execucao.tarefas, path);
  if(ref && ref.list[ref.index]) {
    const value = String(rawValue||'').trim();
    const user = projFindProjectUserByResponsibleValue(proj.id, value);
    ref.list[ref.index].responsavel = user ? projUserDisplayName(user) : value;
    if(user && user.email) ref.list[ref.index].responsavel_email = String(user.email).trim().toLowerCase();
    else delete ref.list[ref.index].responsavel_email;
  }
  projSyncDerivedTaskDates(proj.execucao.tarefas);
  projSave();
  projDetalheTab('execucao', document.querySelector('#proj-detalhe-tabs .proj-tab:nth-child(4)'));
  });
}

function projToggleTarefaFlag(path, field) {
  return projWithScheduleWrite(() => {
  projLoad();
  const proj = PROJETOS.find(p => String(p.id) === _projCurrentId);
  if(!proj || !proj.execucao || !proj.execucao.tarefas) return;
  projEnsureCurrentScheduleBackupBeforeMutation(proj);
  const ref = projGetTarefaByPath(proj.execucao.tarefas, path);
  if(ref && ref.list[ref.index]) {
    ref.list[ref.index][field] = !ref.list[ref.index][field];
  }
  projSyncDerivedTaskDates(proj.execucao.tarefas);
  projSave();
  projDetalheTab('execucao', document.querySelector('#proj-detalhe-tabs .proj-tab:nth-child(4)'));
  });
}

function projToggleTarefa(path) {
  return projWithScheduleWrite(() => {
  projLoad();
  const proj = PROJETOS.find(p => String(p.id) === _projCurrentId);
  if(!proj || !proj.execucao || !proj.execucao.tarefas) return;
  projEnsureCurrentScheduleBackupBeforeMutation(proj);
  const ref = projGetTarefaByPath(proj.execucao.tarefas, path);
  if(ref && ref.list[ref.index]) {
    ref.list[ref.index].concluida = !ref.list[ref.index].concluida;
    ref.list[ref.index].conclusao = ref.list[ref.index].concluida ? 100 : 0;
  }
  projSyncDerivedTaskDates(proj.execucao.tarefas);
  if(proj.execucao.pct_mode === 'derivado') {
    proj.percentual = projCalcDerivedPct(proj.execucao.tarefas);
    proj.execucao.percentual = proj.percentual;
  }
  projSave();
  projDetalheTab('execucao', document.querySelector('#proj-detalhe-tabs .proj-tab:nth-child(4)'));
  });
}

// ── Toggle cron mode / pct mode ──
function projToggleCronMode() {
  return projWithScheduleWrite(() => {
  projLoad();
  const proj = PROJETOS.find(p => String(p.id) === _projCurrentId);
  if(!proj) return;
  if(!proj.execucao) proj.execucao = {planner_link:'',percentual:0,reunioes:[],tarefas:[]};
  const toggle = document.getElementById('exec-cron-toggle');
  proj.execucao.cron_mode = toggle && toggle.checked ? 'siga' : 'planner';
  projSave();
  projDetalheTab('execucao', document.querySelector('#proj-detalhe-tabs .proj-tab:nth-child(4)'));
  });
}

function projTogglePctMode() {
  return projWithScheduleWrite(() => {
  projLoad();
  const proj = PROJETOS.find(p => String(p.id) === _projCurrentId);
  if(!proj) return;
  if(!proj.execucao) proj.execucao = {planner_link:'',percentual:0,reunioes:[],tarefas:[]};
  const toggle = document.getElementById('exec-pct-mode-toggle');
  proj.execucao.pct_mode = toggle && toggle.checked ? 'derivado' : 'manual';
  if(proj.execucao.pct_mode === 'derivado') {
    proj.percentual = projCalcDerivedPct(proj.execucao.tarefas||[]);
    proj.execucao.percentual = proj.percentual;
  }
  projSave();
  projDetalheTab('execucao', document.querySelector('#proj-detalhe-tabs .proj-tab:nth-child(4)'));
  });
}

function projSalvarExecucao() {
  const canFullExec = projCanWriteExec();
  const canSchedule = projCanWriteSchedule();
  if(!canFullExec && !canSchedule){
    projEnsureWriteSchedule();
    return;
  }
  projLoad();
  const proj = PROJETOS.find(p => String(p.id) === _projCurrentId);
  if(!proj) return;
  if(!proj.execucao) proj.execucao = { planner_link:'', percentual:0, reunioes:[], tarefas:[], cron_mode:'planner', pct_mode:'manual' };
  proj.execucao.planner_link = document.getElementById('exec-planner')?.value || proj.execucao.planner_link || '';
  if(canFullExec && proj.execucao.pct_mode !== 'derivado') {
    proj.percentual = Number.parseInt(document.getElementById('exec-percentual')?.value, 10)||0;
  } else if(proj.execucao.pct_mode === 'derivado') {
    proj.percentual = projCalcDerivedPct(proj.execucao.tarefas||[]);
  }
  proj.execucao.percentual = proj.percentual;
  if(canFullExec) projSave();
  else projWithScheduleWrite(() => projSave());
  projToast('Execução salva!');
}

function projAdicionarReuniao() {
  if(!projEnsureWriteAll('Apenas EPP pode criar reuniões.')) return;
  const nome = document.getElementById('reuniao-nome')?.value.trim();
  if(!nome) { projToast('Informe o nome da reunião.', '#d97706'); return; }
  projLoad();
  const proj = PROJETOS.find(p => String(p.id) === _projCurrentId);
  if(!proj) return;
  if(!proj.execucao) proj.execucao = { planner_link:'', percentual:0, reunioes:[] };
  if(!proj.execucao.reunioes) proj.execucao.reunioes = [];
  proj.execucao.reunioes.push({
    id: 'r' + Date.now(),
    nome,
    data: document.getElementById('reuniao-data')?.value||'',
    participantes: document.getElementById('reuniao-participantes')?.value.trim()||'',
    observacoes: document.getElementById('reuniao-obs')?.value.trim()||'',
    realizada: false
  });
  projSave();
  projToast('Reunião adicionada!');
  projAtualizarBadgeReunioes();
  // Re-render tab
  projDetalheTab('execucao', document.querySelector('#proj-detalhe-tabs .proj-tab:nth-child(4)'));
}

function projToggleReuniaoExec(reuniaoId) {
  if(!projEnsureWriteAll('Apenas EPP pode alterar reuniões.')) return;
  projLoad();
  const proj = PROJETOS.find(p => String(p.id) === _projCurrentId);
  if(!proj) return;
  const r = (proj.execucao?.reunioes||[]).find(r => String(r.id) === String(reuniaoId));
  if(r) {
    r.realizada = !r.realizada;
    projSave();
    projAtualizarBadgeReunioes();
    projDetalheTab('execucao', document.querySelector('#proj-detalhe-tabs .proj-tab:nth-child(4)'));
  }
}

function projExcluirReuniaoExec(reuniaoId) {
  if(!projEnsureWriteAll('Apenas EPP pode excluir reuniões.')) return;
  projConfirmar('Excluir esta reunião?', () => {
    projLoad();
    const proj = PROJETOS.find(p => String(p.id) === _projCurrentId);
    if(!proj) return;
    proj.execucao.reunioes = (proj.execucao.reunioes||[]).filter(r => String(r.id) !== String(reuniaoId));
    projSave();
    projToast('Reunião excluída.');
    projAtualizarBadgeReunioes();
    projDetalheTab('execucao', document.querySelector('#proj-detalhe-tabs .proj-tab:nth-child(4)'));
  });
}

function projAutoAddReunioesMes(){if(!projEnsureWriteAll('Apenas EPP pode criar reuniões automáticas.'))return;projLoad();let proj=PROJETOS.find(function(p){return String(p.id)===_projCurrentId;});if(!proj)return;if(!proj.execucao)proj.execucao={planner_link:'',percentual:0,reunioes:[]};if(!proj.execucao.reunioes)proj.execucao.reunioes=[];let now=new Date();let dataStatus=projMonthFirstDay(now);let mn=projMonthLabel(projMonthValue(now));let nome='Reunião de Status Patrocinador - '+mn;let ja=proj.execucao.reunioes.some(function(r){return r.nome===nome||(r.auto&&r.data===dataStatus);});if(ja){projToast('Reunião deste mês já existe.','#d97706');return;}proj.execucao.reunioes.push({id:'r'+Date.now(),nome:nome,data:dataStatus,participantes:'',observacoes:'Reunião mensal de acompanhamento com o patrocinador',realizada:false,auto:true});projSave();projToast('Reunião de Status adicionada!');projAtualizarBadgeReunioes();projDetalheTab('execucao',document.querySelector('#proj-detalhe-tabs .proj-tab:nth-child(4)'));}
function projDeduplicarReunioes(){if(!projEnsureWriteAll('Apenas EPP pode alterar reuniões.'))return;projLoad();let proj=PROJETOS.find(function(p){return String(p.id)===_projCurrentId;});if(!proj||!proj.execucao||!proj.execucao.reunioes)return;let seen={};let orig=proj.execucao.reunioes.length;proj.execucao.reunioes=proj.execucao.reunioes.filter(function(r){let k=r.nome+'|'+(r.data||'');if(seen[k])return false;seen[k]=true;return true;});let rem=orig-proj.execucao.reunioes.length;projSave();if(rem>0){projToast(rem+' duplicada(s) removida(s).');projDetalheTab('execucao',document.querySelector('#proj-detalhe-tabs .proj-tab:nth-child(4)'));}else{projToast('Nenhuma duplicata encontrada.');}}

// ── ABA: CONCLUSÃO ───────────────────────────────────────────────
let _tipoConclusaoSelecionado = '';
function projSelecionarTipoConclusao(tipo) {
  _tipoConclusaoSelecionado = tipo;
  document.querySelectorAll('.proj-conclusao-card').forEach(c => {
    c.classList.remove('selected-success','selected-cancel');
  });
  const cards = document.querySelectorAll('.proj-conclusao-card');
  if(tipo === 'sucesso' && cards[0]) cards[0].classList.add('selected-success');
  if(tipo === 'cancelamento' && cards[1]) cards[1].classList.add('selected-cancel');
}

function projSalvarConclusao() {
  projLoad();
  const proj = PROJETOS.find(p => String(p.id) === _projCurrentId);
  if(!proj) return;
  if(!proj.conclusao) proj.conclusao = {};
  proj.conclusao.tipo = _tipoConclusaoSelecionado || proj.conclusao.tipo || '';
  proj.conclusao.dt_conclusao = document.getElementById('conc-data')?.value||'';
  proj.conclusao.link_termo_aceite = document.getElementById('conc-termo')?.value||'';
  proj.conclusao.historia = document.getElementById('conc-historia')?.value||'';
  proj.conclusao.links_noticias = document.getElementById('conc-links')?.value||'';
  const imagensUrlsEl = document.getElementById('conc-imagens-urls');
  if(imagensUrlsEl) proj.conclusao.imagens = projConclusaoUrlsToImagens(imagensUrlsEl.value);
  proj.conclusao.licoes_data = document.getElementById('conc-lic-data')?.value||'';
  proj.conclusao.licoes_participantes = document.getElementById('conc-lic-part')?.value||'';
  proj.conclusao.licoes_certo = document.getElementById('conc-lic-certo')?.value||'';
  proj.conclusao.licoes_melhorar = document.getElementById('conc-lic-melhorar')?.value||'';
  proj.conclusao.licoes_ideias = document.getElementById('conc-lic-ideias')?.value||'';
  projSave();
  projToast('Conclusão salva!');
}

function projFinalizarProjeto() {
  const tipo = _tipoConclusaoSelecionado;
  if(!tipo) { projToast('Selecione o tipo de conclusão.', '#d97706'); return; }
  const msg = tipo === 'sucesso'
    ? 'Encerrar o projeto como CONCLUÍDO COM SUCESSO?\n\nEsta ação mudará o status do projeto para Concluído.'
    : 'Encerrar o projeto como CANCELADO?\n\nEsta ação mudará o status do projeto para Cancelado.';
  projConfirmar(msg, () => {
    projSalvarConclusao();
    projLoad();
    const proj = PROJETOS.find(p => String(p.id) === _projCurrentId);
    if(!proj) return;
    proj.status = tipo === 'sucesso' ? 'concluido' : 'cancelado';
    proj.fase_atual = 'conclusao';
    projSave();
    projToast('Projeto encerrado!', 'var(--teal)');
    projAbrirDetalhe(_projCurrentId, false);
  });
}

function projConclusaoImagemSrc(img){
  if(typeof img === 'string') return img.trim();
  return String(img?.url || img?.data || '').trim();
}
function projConclusaoImagemNome(url, index){
  try {
    const u = new URL(url);
    const last = decodeURIComponent((u.pathname.split('/').filter(Boolean).pop() || '').trim());
    return last || `Imagem ${index + 1}`;
  } catch(_e) {
    return `Imagem ${index + 1}`;
  }
}
function projConclusaoImagensToUrls(conc){
  const seen = new Set();
  return (conc?.imagens || [])
    .map(projConclusaoImagemSrc)
    .filter(Boolean)
    .filter(url => {
      const key = url.toLowerCase();
      if(seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
function projConclusaoUrlsToImagens(text){
  const seen = new Set();
  return String(text || '')
    .split(/\n+/)
    .map(s => s.trim())
    .filter(Boolean)
    .filter(url => {
      const key = url.toLowerCase();
      if(seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((url, index) => ({nome: projConclusaoImagemNome(url, index), url, data: url, externo: true}));
}

// ── AVANÇAR FASE ──────────────────────────────────────────────────
function projAvancarFase(id) {
  projLoad();
  const proj = PROJETOS.find(p => String(p.id) === String(id));
  if(!proj) return;
  const idx = FASE_IDX[proj.fase_atual] || 0;
  if(idx >= PROJ_FASES.length - 1) {
    projToast('Este projeto já está na fase final.', '#d97706');
    return;
  }
  const proximaFase = PROJ_FASES[idx + 1];
  projConfirmar(`Avançar para a fase "${proximaFase.label}"?\n\nVocê poderá continuar preenchendo as fases anteriores.`, () => {
    // Add monthly status meeting if advancing to execucao
    if(proximaFase.id === 'execucao') {
      if(!proj.execucao) proj.execucao = { planner_link:'', percentual:0, reunioes:[] };
      if(!proj.execucao.reunioes) proj.execucao.reunioes = [];
      // Add meeting for current month
      proj.execucao.reunioes.push({
        id: 'r' + Date.now(),
        nome: `Reunião de Status Patrocinador do Projeto ${proj.nome}`,
        data: '',
        participantes: '',
        observacoes: '',
        realizada: false,
        auto: true
      });
    }
    proj.fase_atual = proximaFase.id;
    projSave();
    projToast(`Projeto avançado para "${proximaFase.label}"!`);
    projAbrirDetalhe(id);
  });
}

function projRegredirFase(id) {
  projLoad();
  let proj = PROJETOS.find(function(p){return String(p.id)===String(id);});
  if(!proj) return;
  let idx = FASE_IDX[proj.fase_atual] || 0;
  if(idx <= 0) { projToast('Já está na primeira fase.','#d97706'); return; }
  let faseAnterior = PROJ_FASES[idx - 1];
  projConfirmar('Regredir para a fase "' + faseAnterior.label + '"?', function() {
    proj.fase_atual = faseAnterior.id;
    projSave();
    projToast('Fase regredida para "' + faseAnterior.label + '".');
    projAbrirDetalhe(id, true);
  });
}

// ── ÍCONE DO PROJETO ──────────────────────────────────────────────
function projUploadIcone(id, inputEl) {
  const file = inputEl.files?.[0];
  if(!file) return;
  if(file.size > 2*1024*1024) { projToast('Imagem muito grande (máx. 2 MB).', '#d97706'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    projLoad();
    const proj = PROJETOS.find(p => String(p.id) === String(id));
    if(!proj) return;
    proj.icone_url = e.target.result;
    projSave();
    projToast('Ícone atualizado!');
    projAbrirDetalhe(id);
  };
  reader.readAsDataURL(file);
}

// ════════════════════════════════════════════════════════════════════
// MÓDULO DE PROGRAMAS
// ════════════════════════════════════════════════════════════════════

function progRenderPage() {
  projLoad(); // carrega projetos + programas
  const el = document.getElementById('proj-programas-content');
  if(!el) return;

  if(PROGRAMAS.length === 0) {
    projSetSafeHtml(el, `
      <div style="text-align:center;padding:3rem;color:#b0b8cc">
        <div style="font-size:40px;margin-bottom:12px">📂</div>
        <div style="font-size:15px;font-weight:600;margin-bottom:6px">Nenhum programa cadastrado</div>
        <div style="font-size:13px;margin-bottom:1rem">Programas agrupam projetos relacionados sob uma mesma estratégia.</div>
        <button type="button" class="proj-btn primary" onclick="progAbrirModalNovo()">+ Criar primeiro programa</button>
      </div>`);
    return;
  }

  const ativos     = PROGRAMAS.filter(pg => pg.status === 'ativo');
  const concluidos = PROGRAMAS.filter(pg => pg.status === 'concluido');
  const cancelados = PROGRAMAS.filter(pg => pg.status === 'cancelado');

  const renderProg = (pg) => {
    const projs = PROJETOS.filter(p => String(p.programa_id) === String(pg.id));
    const pct = progPercentualMedio(pg.id);
    const statusBadge = pg.status === 'concluido'
      ? '<span class="proj-list-badge" style="background:var(--teal-l);color:var(--teal)">🏆 Concluído</span>'
      : pg.status === 'cancelado'
        ? '<span class="proj-list-badge" style="background:#fde8e8;color:#7f1d1d">✕ Cancelado</span>'
        : '<span class="proj-list-badge" style="background:var(--blue-l);color:var(--blue)">Ativo</span>';

    return `
      <div style="border:1.5px solid #e5e8ef;border-radius:12px;background:#fff;padding:1.1rem;margin-bottom:.9rem">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
          <div style="flex:1;min-width:0;cursor:pointer" onclick="progAbrirDetalhe('${pg.id}')">
            <div style="font-family:'Syne',sans-serif;font-size:14px;font-weight:700;color:#1a2540;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              📂 ${projEsc(pg.nome)}
              ${statusBadge}
            </div>
            ${pg.descricao ? `<div style="font-size:12px;color:#6b7385;margin-top:4px">${projEsc(pg.descricao)}</div>` : ''}
            <div style="font-size:11px;color:var(--ink3);margin-top:5px;display:flex;gap:12px;flex-wrap:wrap">
              <span>📁 ${projs.length} projeto${projs.length !== 1 ? 's' : ''}</span>
              ${pg.gerente ? `<span>👤 ${projEsc(pg.gerente)}</span>` : ''}
              ${pg.patrocinador ? `<span>📝 ${projEsc(pg.patrocinador)}</span>` : ''}
            </div>
            <div style="margin-top:8px;display:flex;align-items:center;gap:8px">
              <div class="proj-prog-bar" style="width:180px"><div class="proj-prog-fill" style="width:${pct}%"></div></div>
              <span style="font-size:11px;color:var(--ink3)">${pct}% médio</span>
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:6px">
            <button type="button" class="proj-btn" style="font-size:11px;padding:4px 10px" onclick="event.stopPropagation();progAbrirModalEditar('${pg.id}')">✏️ Editar</button>
            <button type="button" class="proj-btn danger" style="font-size:11px;padding:4px 10px" onclick="event.stopPropagation();progExcluir('${pg.id}')">Excluir</button>
          </div>
        </div>
      </div>
    `;
  };

  const renderGrp = (label, list) => list.length === 0 ? '' : `
    <div style="margin-bottom:1.4rem">
      <div style="font-family:'Syne',sans-serif;font-size:12px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:.7rem;padding:.5rem 0;border-bottom:2px solid #eaecf3">${label} <span style="color:var(--blue)">(${list.length})</span></div>
      ${list.map(renderProg).join('')}
    </div>
  `;

  projSetSafeHtml(el, renderGrp('Programas Ativos', ativos) + renderGrp('Programas Concluídos', concluidos) + renderGrp('Programas Cancelados', cancelados));
}

function progAbrirModalNovo() {
  _progModal({ id: null, nome: '', descricao: '', gerente: '', patrocinador: '', status: 'ativo' }, 'Novo Programa');
}

function progAbrirModalEditar(id) {
  progLoad();
  const pg = PROGRAMAS.find(p => String(p.id) === String(id));
  if(!pg) return;
  _progModal(pg, 'Editar Programa');
}

function _progModal(pg, titulo) {
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:99999;display:flex;align-items:center;justify-content:center;padding:1rem;overflow-y:auto';
  projSetSafeHtml(modal, `
    <div style="background:#fff;border-radius:16px;padding:1.6rem;width:100%;max-width:540px;box-shadow:0 16px 48px rgba(0,0,0,.2)">
      <div style="font-family:'Syne',sans-serif;font-size:16px;font-weight:700;color:#1a2540;margin-bottom:1.2rem">${titulo}</div>
      <div class="proj-fg">
        <label class="proj-fl">Nome do Programa<span>*</span></label>
        <input type="text" class="proj-fi" id="prog-m-nome" value="${projEsc(pg.nome||'')}" placeholder="Ex: Gestão de Riscos no Controle">
      </div>
      <div class="proj-fg">
        <label class="proj-fl">Descrição</label>
        <textarea class="proj-fi" id="prog-m-desc" placeholder="Objetivo geral do programa..." rows="2">${projEsc(pg.descricao||'')}</textarea>
      </div>
      <div class="proj-g2">
        <div class="proj-fg">
          <label class="proj-fl">Gerente do Programa</label>
          <input type="text" class="proj-fi" id="prog-m-gerente" value="${projEsc(pg.gerente||'')}">
        </div>
        <div class="proj-fg">
          <label class="proj-fl">Patrocinador</label>
          <input type="text" class="proj-fi" id="prog-m-patrocinador" value="${projEsc(pg.patrocinador||'')}">
        </div>
      </div>
      <div class="proj-fg">
        <label class="proj-fl">Status</label>
        <select class="proj-fi" id="prog-m-status">
          <option value="ativo"${pg.status==='ativo'?' selected':''}>Ativo</option>
          <option value="concluido"${pg.status==='concluido'?' selected':''}>Concluído</option>
          <option value="cancelado"${pg.status==='cancelado'?' selected':''}>Cancelado</option>
        </select>
      </div>
      <div class="proj-btn-row">
        <button type="button" class="proj-btn" onclick="this.closest('[style*=fixed]').remove()">Cancelar</button>
        <button type="button" class="proj-btn primary" onclick="progSalvarModal('${pg.id||''}',this)">Salvar</button>
      </div>
    </div>
  `);
  document.body.appendChild(modal);
  setTimeout(() => document.getElementById('prog-m-nome')?.focus(), 50);
}

function progSalvarModal(idRaw, btn) {
  if(!projEnsureWriteAll('Apenas EPP pode gerenciar programas.')) return;
  const nome = document.getElementById('prog-m-nome')?.value.trim();
  if(!nome) { projToast('Informe o nome do programa.', '#d97706'); return; }
  progLoad();

  if(idRaw && idRaw !== 'null' && idRaw !== '') {
    // Edit
    const pg = PROGRAMAS.find(p => String(p.id) === String(idRaw));
    if(!pg) return;
    pg.nome = nome;
    pg.descricao = document.getElementById('prog-m-desc')?.value.trim()||'';
    pg.gerente = document.getElementById('prog-m-gerente')?.value.trim()||'';
    pg.patrocinador = document.getElementById('prog-m-patrocinador')?.value.trim()||'';
    pg.status = document.getElementById('prog-m-status')?.value||'ativo';
    progSave();
    projToast('Programa atualizado!');
  } else {
    // Create
    const novo = progFixDefaults({
      id: Date.now(),
      nome,
      descricao: document.getElementById('prog-m-desc')?.value.trim()||'',
      gerente: document.getElementById('prog-m-gerente')?.value.trim()||'',
      patrocinador: document.getElementById('prog-m-patrocinador')?.value.trim()||'',
      status: document.getElementById('prog-m-status')?.value||'ativo'
    });
    PROGRAMAS.push(novo);
    progSave();
    projToast('Programa "' + nome + '" criado!');
  }

  btn.closest('[style*=fixed]').remove();
  progRenderPage();
}

function progExcluir(id) {
  if(!projEnsureWriteAll('Apenas EPP pode excluir programas.')) return;
  progLoad();
  const pg = PROGRAMAS.find(p => String(p.id) === String(id));
  if(!pg) return;
  const projsVinc = PROJETOS.filter(p => String(p.programa_id) === String(id));
  const msg = projsVinc.length > 0
    ? `Excluir o programa "${pg.nome}"?\n\nAtenção: ${projsVinc.length} projeto(s) deste programa ficarão sem programa vinculado (os projetos NÃO serão excluídos).`
    : `Excluir o programa "${pg.nome}"?`;
  projConfirmar(msg, () => {
    // Desvincular projetos
    projLoad();
    PROJETOS.forEach(p => {
      if(String(p.programa_id) === String(id)) p.programa_id = null;
    });
    projSave();
    // Remover programa
    PROGRAMAS = PROGRAMAS.filter(p => String(p.id) !== String(id));
    progSave();
    projToast('Programa excluído.');
    progRenderPage();
  });
}

function progAbrirDetalhe(id) {
  progLoad();
  const pg = PROGRAMAS.find(p => String(p.id) === String(id));
  if(!pg) return;
  const projs = PROJETOS.filter(p => String(p.programa_id) === String(id));
  const pct = progPercentualMedio(id);

  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:99999;display:flex;align-items:center;justify-content:center;padding:1rem;overflow-y:auto';
  projSetSafeHtml(modal, `
    <div style="background:#fff;border-radius:16px;padding:1.8rem;width:100%;max-width:720px;box-shadow:0 16px 48px rgba(0,0,0,.2);max-height:90vh;overflow-y:auto">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1rem;gap:12px">
        <div style="flex:1;min-width:0">
          <div style="font-family:'Syne',sans-serif;font-size:18px;font-weight:700;color:#1a2540;margin-bottom:4px">📂 ${projEsc(pg.nome)}</div>
          ${pg.descricao ? `<div style="font-size:13px;color:#6b7385;line-height:1.5">${projEsc(pg.descricao)}</div>` : ''}
        </div>
        <button type="button" class="proj-btn" onclick="this.closest('[style*=fixed]').remove()">✕</button>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:1.2rem;padding:.9rem;background:#f8faff;border-radius:10px;border:1px solid #e5e8ef">
        <div>
          <div style="font-size:10.5px;color:var(--ink3);text-transform:uppercase;letter-spacing:.06em;font-weight:600">Gerente</div>
          <div style="font-size:13px;color:#1a2540;margin-top:2px">${projEsc(pg.gerente)||'—'}</div>
        </div>
        <div>
          <div style="font-size:10.5px;color:var(--ink3);text-transform:uppercase;letter-spacing:.06em;font-weight:600">Patrocinador</div>
          <div style="font-size:13px;color:#1a2540;margin-top:2px">${projEsc(pg.patrocinador)||'—'}</div>
        </div>
        <div>
          <div style="font-size:10.5px;color:var(--ink3);text-transform:uppercase;letter-spacing:.06em;font-weight:600">Status</div>
          <div style="font-size:13px;color:#1a2540;margin-top:2px">${pg.status==='concluido'?'🏆 Concluído':pg.status==='cancelado'?'✕ Cancelado':'✓ Ativo'}</div>
        </div>
        <div>
          <div style="font-size:10.5px;color:var(--ink3);text-transform:uppercase;letter-spacing:.06em;font-weight:600">Progresso médio</div>
          <div style="margin-top:4px;display:flex;align-items:center;gap:8px">
            <div class="proj-prog-bar" style="flex:1"><div class="proj-prog-fill" style="width:${pct}%"></div></div>
            <span style="font-size:12px;color:var(--blue);font-weight:600">${pct}%</span>
          </div>
        </div>
      </div>

      <div style="font-family:'Syne',sans-serif;font-size:13px;font-weight:700;color:#1a2540;margin-bottom:.7rem">Projetos deste programa <span style="color:var(--blue)">(${projs.length})</span></div>

      ${projs.length === 0 ? `
        <div style="text-align:center;padding:1.5rem;color:#b0b8cc;background:#f8faff;border-radius:10px;border:1px dashed #d5deed">
          <div style="font-size:13px">Nenhum projeto vinculado ainda.</div>
          <div style="font-size:11px;margin-top:4px">Ao criar um novo projeto, selecione este programa no campo "Programa".</div>
        </div>
      ` : projs.map(p => `
        <div class="proj-list-item" onclick="(function(){document.querySelectorAll('[style*=\\'z-index:99999\\']').forEach(m=>m.remove());projAbrirDetalhe('${p.id}');})()">
          <div class="proj-list-icon">
            ${p.icone_url ? `<img src="${projEsc(p.icone_url)}" alt="ícone">` : `<span style="font-size:20px">${p.icone_emoji || '📁'}</span>`}
          </div>
          <div>
            <div class="proj-list-name">${projEsc(p.nome)}</div>
            <div class="proj-list-meta">
              <span>👤 ${projEsc(p.gerente)||'—'}</span>
              ${p.patrocinador ? `<span>📝 ${projEsc(p.patrocinador)}</span>` : ''}
            </div>
            <div style="margin-top:5px">
              <div class="proj-prog-bar" style="width:160px;display:inline-block">
                <div class="proj-prog-fill" style="width:${p.percentual||0}%"></div>
              </div>
              <span style="font-size:11px;color:var(--ink3);margin-left:6px">${p.percentual||0}%</span>
            </div>
          </div>
          <span class="proj-list-badge ${projFaseBadgeClass(p.status,p.fase_atual)}">${projFaseText(p)}</span>
        </div>
      `).join('')}

      <div class="proj-btn-row" style="margin-top:1.2rem">
        <button type="button" class="proj-btn" onclick="this.closest('[style*=fixed]').remove();progAbrirModalEditar('${pg.id}')">✏️ Editar Programa</button>
        <button type="button" class="proj-btn primary" onclick="this.closest('[style*=fixed]').remove()">Fechar</button>
      </div>
    </div>
  `);
  document.body.appendChild(modal);
}

// ════════════════════════════════════════════════════════════════════
// CARREGAR DADOS INICIAIS (PORTFÓLIO CAGE DO STATUS REPORT MAR/26)
// ════════════════════════════════════════════════════════════════════
function projCarregarDemoSeVazio() {
  if(fbReady()) return;
  projLoad();
  if(PROJETOS.length > 0 || PROGRAMAS.length > 0) return;
  try {
    let data = JSON.parse('{"projetos":[{"id":1000101,"nome":"Seccional de Obras","gerente":"Elizandro Moch","gerente_substituto":"Leonardo Cecconello","descricao":"Desenvolvimento de controles baseados em riscos para gestão e fiscalização de contratos de obras no DAER-FUNRIGS.","dt_inicio":"","dt_fim":"","patrocinador":"Jociê Pereira","fonte":"Gestão","fase_atual":"execucao","status":"ativo","percentual":65,"icone_url":"","icone_emoji":"🏗️","dt_criacao":"2026-04-22","programa_id":2000001,"aprovacao":{"motivo_inicio":"","aprovado":false,"deliberacao":"","dt_aprovacao":"","obs":""},"ideacao":{"descricao":"","objetivo_smart":"","beneficios":"","requisitos":"","premissas":"","restricoes":"","entregas_macro":"","riscos_canvas":"","equipe":"","partes_interessadas":"","objetivo_estrategico":"","custos":"","resultados_esperados":"","acoes_imediatas":""},"planejamento":{"eap_html":"","riscos":[],"planner_link":""},"execucao":{"planner_link":"","percentual":65,"reunioes":[]},"conclusao":{"tipo":"","dt_conclusao":"","link_termo_aceite":"","historia":"","links_noticias":""}},{"id":1000102,"nome":"Seccional de Transferências Voluntárias","gerente":"Patricia Leão","gerente_substituto":"Eneias Eler","descricao":"Refinamento do painel de riscos, análise amostral, definição de protocolos de análise e evoluções sistêmicas para convênios.","dt_inicio":"","dt_fim":"","patrocinador":"Jociê Pereira","fonte":"Gestão","fase_atual":"execucao","status":"ativo","percentual":60,"icone_url":"","icone_emoji":"🔍","dt_criacao":"2026-04-22","programa_id":2000001,"aprovacao":{"motivo_inicio":"","aprovado":false,"deliberacao":"","dt_aprovacao":"","obs":""},"ideacao":{"descricao":"","objetivo_smart":"","beneficios":"","requisitos":"","premissas":"","restricoes":"","entregas_macro":"","riscos_canvas":"","equipe":"","partes_interessadas":"","objetivo_estrategico":"","custos":"","resultados_esperados":"","acoes_imediatas":""},"planejamento":{"eap_html":"","riscos":[],"planner_link":""},"execucao":{"planner_link":"","percentual":60,"reunioes":[]},"conclusao":{"tipo":"","dt_conclusao":"","link_termo_aceite":"","historia":"","links_noticias":""}},{"id":1000103,"nome":"AIRA - Arquitetura Inteligente de Redes de Agentes","gerente":"Jimmy Paiva Gomes","gerente_substituto":"","descricao":"Aperfeiçoar o processo de controle da execução da despesa com base em riscos, com o uso de agentes de IA.","dt_inicio":"2025-01-15","dt_fim":"2027-12-31","patrocinador":"Jociê Pereira","fonte":"Gestão","fase_atual":"execucao","status":"ativo","percentual":0,"icone_url":"","icone_emoji":"🤖","dt_criacao":"2025-01-15","programa_id":2000001,"aprovacao":{"motivo_inicio":"Aperfeiçoar o processo de controle da execução da despesa com base em riscos, com o uso de agentes de IA, ampliando a eficiência operacional e o controle baseado em dados.","aprovado":true,"deliberacao":"","dt_aprovacao":"","obs":"Aprovado em reunião ordinária do CGP."},"ideacao":{"descricao":"Aperfeiçoar o processo de controle da execução da despesa com base em riscos, com o uso de agentes de IA.","objetivo_smart":"XX% das solicitações de liquidação de despesa atendidas com uso de IA até 31/12/2027.","beneficios":"Eficiência no controle da despesa pública; Escalabilidade, rastreabilidade e auditabilidade da atividade de controle; Melhor mensuração dos custos do controle; Aumento da produtividade.","requisitos":"Uma única interface para o usuário; Integração com os demais sistemas do Estado; Autonomia sem intervenção humana.","premissas":"Disponibilidade de recursos do Profisco III para o projeto; Haverá possibilidade de integração com o SEI.","restricoes":"Atuação inicialmente limitada ao controle do Poder Executivo; Apenas na liquidação da despesa; Em processos SEI.","entregas_macro":"Elaboração de protocolos por tipo de objeto; Padronização de documentos de liquidação da despesa no SEI; Proposta de reorganização do processo de trabalho da área de Controle.","riscos_canvas":"Dependência de partes externas para integração do sistema; Atrasos no andamento do Profisco III; Risco de impactos negativos na qualidade e risco de imagem.","equipe":"Jimmy, Robson, Jonas, Marcus Pizzato, Felipe Thiesen, Michel.","partes_interessadas":"SPGG (SEI), PROCERGS (FPE), servidores das seccionais da CAGE e servidores do Estado que atuam em processos de liquidação.","objetivo_estrategico":"Otimizar os processos de trabalho, com foco na melhoria da eficiência operacional e automação; Desenvolver modelo de controle baseado em riscos e orientado pela utilização de dados.","custos":"Disponibilidade de pessoal para o desenvolvimento; Infraestrutura tecnológica.","resultados_esperados":"Redução do tempo médio de atendimento das solicitações de liquidação pela CAGE; Reorganização da estrutura da CAGE.","acoes_imediatas":"Pilotos nas áreas de negócio envolvidas; Disseminação do projeto para consolidação.","canvas_mode":"manual"},"planejamento":{"eap_html":"<!DOCTYPE html>\\n<!-- saved from url=(0052)file:///C:/Users/ewwoy/Downloads/EAP_AIRA%20(3).html -->\\n<html lang=\\"pt-BR\\"><head><meta http-equiv=\\"Content-Type\\" content=\\"text/html; charset=UTF-8\\">\\n\\n<meta name=\\"viewport\\" content=\\"width=device-width, initial-scale=1.0\\">\\n<title>EAP - AIRA</title>\\n<link href=\\"./1. EAP - AIRA_files/css2\\" rel=\\"stylesheet\\">\\n<style>\\n  * { margin: 0; padding: 0; box-sizing: border-box; }\\n\\n  body {\\n    font-family: \'DM Sans\', sans-serif;\\n    background: #f4f6f9;\\n    color: #111;\\n    padding: 32px 24px 48px;\\n    min-width: 1100px;\\n  }\\n\\n  .header {\\n    background: #fff;\\n    border-radius: 12px;\\n    padding: 20px 32px;\\n    margin-bottom: 32px;\\n    display: flex;\\n    align-items: center;\\n    justify-content: space-between;\\n    box-shadow: 0 2px 12px rgba(0,0,0,0.07);\\n    border-bottom: 3px solid #0B5EA8;\\n  }\\n\\n  .logos {\\n    display: flex;\\n    align-items: center;\\n    gap: 24px;\\n  }\\n\\n  .logos img.logo-cage {\\n    height: 56px;\\n    object-fit: contain;\\n  }\\n\\n  .logos img.logo-epp {\\n    height: 28px;\\n    object-fit: contain;\\n  }\\n\\n  .header-title {\\n    text-align: center;\\n    flex: 1;\\n  }\\n\\n  .header-title h1 {\\n    font-size: 1.35rem;\\n    font-weight: 700;\\n    color: #0B5EA8;\\n    letter-spacing: 0.01em;\\n    line-height: 1.3;\\n  }\\n\\n  .header-title p {\\n    font-size: 0.82rem;\\n    color: #555;\\n    margin-top: 4px;\\n    font-weight: 400;\\n    letter-spacing: 0.04em;\\n    text-transform: uppercase;\\n  }\\n\\n  .tree {\\n    display: flex;\\n    flex-direction: column;\\n    align-items: center;\\n  }\\n\\n  .root-node {\\n    background: #0B5EA8;\\n    color: #fff;\\n    padding: 12px 40px;\\n    border-radius: 8px;\\n    font-size: 0.95rem;\\n    font-weight: 700;\\n    letter-spacing: 0.03em;\\n    text-align: center;\\n    box-shadow: 0 4px 16px rgba(11,94,168,0.25);\\n    position: relative;\\n    z-index: 2;\\n  }\\n\\n  .connector-root {\\n    width: 2px;\\n    height: 28px;\\n    background: #0B5EA8;\\n    margin: 0 auto;\\n  }\\n\\n  .columns-wrapper {\\n    width: 100%;\\n    position: relative;\\n  }\\n\\n  .h-bar {\\n    position: absolute;\\n    top: 0;\\n    left: 0;\\n    right: 0;\\n    height: 2px;\\n    background: #0B5EA8;\\n  }\\n\\n  .columns {\\n    display: flex;\\n    width: 100%;\\n    gap: 10px;\\n    align-items: flex-start;\\n  }\\n\\n  .column {\\n    flex: 1;\\n    display: flex;\\n    flex-direction: column;\\n    align-items: center;\\n  }\\n\\n  .connector-down {\\n    width: 2px;\\n    height: 28px;\\n    background: #0B5EA8;\\n  }\\n\\n  .macro-node {\\n    width: 100%;\\n    padding: 9px 8px;\\n    border-radius: 7px;\\n    font-size: 0.78rem;\\n    font-weight: 700;\\n    text-align: center;\\n    color: #000;\\n    line-height: 1.35;\\n    box-shadow: 0 2px 8px rgba(0,0,0,0.10);\\n    cursor: default;\\n    transition: transform 0.15s ease, box-shadow 0.15s ease, filter 0.15s ease;\\n  }\\n\\n  .macro-node:hover {\\n    transform: translateY(-2px) scale(1.02);\\n    box-shadow: 0 6px 16px rgba(11,94,168,0.22);\\n    filter: brightness(0.94);\\n  }\\n\\n  .connector-sub {\\n    width: 2px;\\n    height: 18px;\\n    background: #0B5EA8;\\n  }\\n\\n  .sub-items {\\n    display: flex;\\n    flex-direction: column;\\n    gap: 6px;\\n    width: 100%;\\n  }\\n\\n  .sub-item {\\n    width: 100%;\\n    padding: 7px 8px;\\n    border-radius: 6px;\\n    font-size: 0.70rem;\\n    font-weight: 400;\\n    text-align: center;\\n    color: #000;\\n    line-height: 1.35;\\n    box-shadow: 0 1px 4px rgba(0,0,0,0.08);\\n    cursor: default;\\n    transition: transform 0.15s ease, box-shadow 0.15s ease, filter 0.15s ease;\\n  }\\n\\n  .sub-item:hover {\\n    transform: translateX(3px);\\n    box-shadow: 0 3px 10px rgba(11,94,168,0.18);\\n    filter: brightness(0.93);\\n  }\\n\\n  /* Blues: mais claro na col-1, progressivamente mais saturado até col-5 */\\n  .col-1 .macro-node { background: #E8F3FA; }\\n  .col-1 .sub-item   { background: #EEF6FB; }\\n\\n  .col-2 .macro-node { background: #D8EBF7; }\\n  .col-2 .sub-item   { background: #E4F0F9; }\\n\\n  .col-3 .macro-node { background: #C8DFF4; }\\n  .col-3 .sub-item   { background: #D8EAF6; }\\n\\n  .col-4 .macro-node { background: #B8D4EE; }\\n  .col-4 .sub-item   { background: #CCDFF2; }\\n\\n  .col-5 .macro-node { background: #A8C8E8; }\\n  .col-5 .sub-item   { background: #C4D9EE; }\\n</style>\\n</head>\\n<body>\\n\\n<div class=\\"header\\">\\n  <div class=\\"logos\\">\\n    <img src=\\"data:image/png;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAARCAHCAyADASIAAhEBAxEB/8QAHQABAAIDAQEBAQAAAAAAAAAAAAEIBQYHBAMCCf/EAFwQAAEDAgIEBggQCAwFBQEAAAABAgMEBQYRBxIhMQgTQVFhgRQVIjJxkaGxFhcjN0JSVWJ0kpOUssHR0jZUVnJzorPCJCUmMzVDZnWCpOLwRlNjZIQYRJXD4TT/xAAcAQEAAQUBAQAAAAAAAAAAAAAABgIDBAUHAQj/xABCEQACAQIDAwcIBwgDAQEBAAAAAQIDBAURIRIxQQZRcYGhsdETFBYiNFJhkQcVMjNywfAXIzVCU5Ki4SRU4mLxQ//aAAwDAQACEQMRAD8AuWAAAAQASQCQAQSQACQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAoAAAAAAAAAAAAAAAAAAAAAAAAAABABIAAAAAAAAAAAAAAAAAAIJAABABJBIAAAAAAABCkgAAEAEgAAAgAEkAAAkAAAAAAAAgkgkAAgkAAAAAAAAAAAgkAAAAAAAAAAAAAAAAAAAAAAAAAAEAEgAAAAAAAAAAAAgkAAAAAAAAgkAAgkAAEZAE5AgAEggZAEgEAEggkAAAAAAAAAAAAAAAAAAAAAAgkAAEEgAAAAgkAAAAAEAAEkEgAEEgAAgkAEEgAAAAAEAEggkAAAAgkAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgkAAAAgkAAAAAEEgAAAAEEgAAAAAAAgkAAAAAEEgAAAAAAAAAAAEAEkEgAAAAAAAgkAAAEAEggkAAEAEgAAAAAAAAAgkAAAAAAAAAAgkAAgEgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgkAAAAAAAAAAAAAAAAAgkAAAAAAAAAAAAAAAAAAAAEEgAAAAAAAAAAgkAAAEAEgAAEEgAAEAAkgkAAEAEgEAEgAAAAAAAAAgkAgkAAAgkAAAAAgkAAAAAgkAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAEgAAAAAAAAAAAAAAAAAAAAAAAAEAEgEAEgAAAAAAAAAgkAAAAAgkAAgkAAAAAAAAAAAAAAAAAEAEggkAAEAEgAAAAAAgkAAAAAAAAAAAAAAAAAAAAAAAAAAgkAAgkAAAAAEAEggAEggkAAAAAAAAEAEgAAAgkAAgkAAAAAgkAAEAEgEAEggkAAAAAAAAAAAAAAAAAEAEgEAEgAAAgkAAAAAAAAgkAEEgAAAAEEgAEEgAAgkAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEEgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADkAAIJIJAAAABBIABBJABJBIAIJIJAIBIAAAAAIJAAAAIJAAIAJAABABIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA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\\" alt=\\"CAGE\\" class=\\"logo-cage\\">\\n    <img src=\\"data:image/png;base64,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\\" alt=\\"Escritório de Projetos e Processos\\" class=\\"logo-epp\\">\\n  </div>\\n  <div class=\\"header-title\\">\\n    <h1>Estrutura Analítica do Projeto (EAP)</h1>\\n    <p>AIRA</p>\\n  </div>\\n  <div style=\\"width:220px\\"></div>\\n</div>\\n\\n<div class=\\"tree\\">\\n\\n  <div class=\\"root-node\\">AIRA</div>\\n  <div class=\\"connector-root\\"></div>\\n\\n  <div class=\\"columns-wrapper\\">\\n    <div class=\\"h-bar\\"></div>\\n    <div class=\\"columns\\">\\n\\n      <!-- COL 1: Diagnóstico e Modelagem — 5 itens -->\\n      <div class=\\"column col-1\\">\\n        <div class=\\"connector-down\\"></div>\\n        <div class=\\"macro-node\\">Diagnóstico e<br>Modelagem</div>\\n        <div class=\\"connector-sub\\"></div>\\n        <div class=\\"sub-items\\">\\n          <div class=\\"sub-item\\">Taxonomia dos Tipos de Processos Administrativos e Controles</div>\\n          <div class=\\"sub-item\\">Redesenho de Processos de Trabalho</div>\\n          <div class=\\"sub-item\\">Desenho de Processo de Monitoramento</div>\\n          <div class=\\"sub-item\\">Instrução Normativa com Padronização</div>\\n          <div class=\\"sub-item\\">Ato Normativo para uso de Controle Automático</div>\\n        </div>\\n      </div>\\n\\n      <!-- COL 2: Desenvolvimento do Sistema — 5 itens -->\\n      <div class=\\"column col-2\\">\\n        <div class=\\"connector-down\\"></div>\\n        <div class=\\"macro-node\\">Desenvolvimento<br>do Sistema</div>\\n        <div class=\\"connector-sub\\"></div>\\n        <div class=\\"sub-items\\">\\n          <div class=\\"sub-item\\">Documentação</div>\\n          <div class=\\"sub-item\\">Módulos Adicionais</div>\\n          <div class=\\"sub-item\\">Painéis de Operação do AIRA</div>\\n          <div class=\\"sub-item\\">Códigos, IaC e DevOps</div>\\n          <div class=\\"sub-item\\">Manual de Usuário</div>\\n        </div>\\n      </div>\\n\\n      <!-- COL 3: Integrações de Sistema — 4 itens -->\\n      <div class=\\"column col-3\\">\\n        <div class=\\"connector-down\\"></div>\\n        <div class=\\"macro-node\\">Integrações<br>de Sistema</div>\\n        <div class=\\"connector-sub\\"></div>\\n        <div class=\\"sub-items\\">\\n          <div class=\\"sub-item\\">Relatório de Integração SEI</div>\\n          <div class=\\"sub-item\\">Relatório de Integração FPE</div>\\n          <div class=\\"sub-item\\">Relatório de Integração CAGE Gerencial</div>\\n          <div class=\\"sub-item\\">Relatório de Integração SINCAGE</div>\\n        </div>\\n      </div>\\n\\n      <!-- COL 4: Conformidade e Segurança — 7 itens -->\\n      <div class=\\"column col-4\\">\\n        <div class=\\"connector-down\\"></div>\\n        <div class=\\"macro-node\\">Conformidade<br>e Segurança</div>\\n        <div class=\\"connector-sub\\"></div>\\n        <div class=\\"sub-items\\">\\n          <div class=\\"sub-item\\">Relatório de Conformidade — Política de Desenvolvimento</div>\\n          <div class=\\"sub-item\\">Relatório de Conformidade — Política de Segurança</div>\\n          <div class=\\"sub-item\\">Relatório de Conformidade — Política de Uso de IA</div>\\n          <div class=\\"sub-item\\">Relatório de Conformidade — Agentic Trust Framework</div>\\n          <div class=\\"sub-item\\">Matriz de Riscos e Plano de Incidentes</div>\\n          <div class=\\"sub-item\\">Avaliação de Impacto à Proteção de Dados</div>\\n          <div class=\\"sub-item\\">Relatório de Conformidade de Governança de Dados</div>\\n        </div>\\n      </div>\\n\\n      <!-- COL 5: Implantação e Sustentação — 3 itens -->\\n      <div class=\\"column col-5\\">\\n        <div class=\\"connector-down\\"></div>\\n        <div class=\\"macro-node\\">Implantação<br>e Sustentação</div>\\n        <div class=\\"connector-sub\\"></div>\\n        <div class=\\"sub-items\\">\\n          <div class=\\"sub-item\\">Relatório de Implantação por objeto de controle</div>\\n          <div class=\\"sub-item\\">Plano de Capacitação</div>\\n          <div class=\\"sub-item\\">Dashboard de Implantação do AIRA</div>\\n        </div>\\n      </div>\\n\\n    </div>\\n  </div>\\n</div>\\n\\n\\n\\n</body></html>","riscos":[{"id":1,"descricao":"Dependência de partes externas para integração","probabilidade":4,"impacto":4,"urgencia":"alta"},{"id":2,"descricao":"Atrasos no Profisco III","probabilidade":3,"impacto":3,"urgencia":"media"},{"id":3,"descricao":"Resistência dos usuários","probabilidade":2,"impacto":2,"urgencia":"baixa"}],"planner_link":"","eap_link":""},"execucao":{"planner_link":"","percentual":0,"reunioes":[{"id":"r1001","nome":"Reunião de Status Patrocinador do Projeto AIRA","data":"","participantes":"Jimmy, Robson, Coordenador","observacoes":"Reunião mensal de acompanhamento","realizada":false,"auto":true}]},"conclusao":{"tipo":"","dt_conclusao":"","link_termo_aceite":"","historia":"","links_noticias":""}},{"id":1000201,"nome":"Identificação das Fontes de Recursos","gerente":"Guilherme Lentz","gerente_substituto":"Gabriela Machado","descricao":"Envio da Matriz de Saldos Contábeis com ativo e passivo financeiros e disponibilidade por destinação de recursos (DDR). Redesenho da DDR e abertura do Ativo Financeiro no FPE.","dt_inicio":"","dt_fim":"","patrocinador":"Felipe Bittencourt","fonte":"Gestão","fase_atual":"conclusao","status":"concluido","percentual":100,"icone_url":"","icone_emoji":"📝","dt_criacao":"2026-04-22","programa_id":2000002,"aprovacao":{"motivo_inicio":"","aprovado":true,"deliberacao":"","dt_aprovacao":"","obs":""},"ideacao":{"descricao":"","objetivo_smart":"","beneficios":"","requisitos":"","premissas":"","restricoes":"","entregas_macro":"","riscos_canvas":"","equipe":"","partes_interessadas":"","objetivo_estrategico":"","custos":"","resultados_esperados":"","acoes_imediatas":""},"planejamento":{"eap_html":"","riscos":[],"planner_link":""},"execucao":{"planner_link":"","percentual":100,"reunioes":[]},"conclusao":{"tipo":"sucesso","dt_conclusao":"","link_termo_aceite":"","historia":"Projeto atingiu a meta com a obtenção da nota A no ranking da STN (referente à qualificação da informação contábil). A frente de Identificação das Fontes de Recursos teve a Matriz de Saldos Contábeis de novembro/2025 enviada com ativo e passivo financeiros e DDR abertos por recurso. ","links_noticias":""}},{"id":1000301,"nome":"Coordenação Geral das UCI\'s","gerente":"José Carlos","gerente_substituto":"","descricao":"Definição da estrutura de assessoria técnica (Coordenação), mapeamento de interfaces e fluxos de integração com UCIs, além de suas atividades obrigatórias. Elaborado novo decreto do Sistema de CI.","dt_inicio":"","dt_fim":"","patrocinador":"Jociê Pereira","fonte":"Gestão","fase_atual":"execucao","status":"ativo","percentual":56,"icone_url":"","icone_emoji":"📁","dt_criacao":"2026-04-22","programa_id":null,"aprovacao":{"motivo_inicio":"","aprovado":false,"dt_aprovacao":"","obs":""},"ideacao":{"descricao":"","objetivo_smart":"","beneficios":"","requisitos":"","premissas":"","restricoes":"","entregas_macro":"","riscos_canvas":"","equipe":"","partes_interessadas":"","objetivo_estrategico":"","custos":"","resultados_esperados":"","acoes_imediatas":""},"planejamento":{"eap_html":"","riscos":[],"planner_link":""},"execucao":{"planner_link":"","percentual":56,"reunioes":[]},"conclusao":{"tipo":"","dt_conclusao":"","link_termo_aceite":"","historia":"","links_noticias":""}},{"id":1000302,"nome":"BIGDATA-CAGE","gerente":"Felipe Thiesen","gerente_substituto":"","descricao":"Montagem da réplica FPE, documentação dos scripts de extração e acesso ao banco SEF_CADASTRO. Transformações para uso em aplicações Qlik (DIE) e novos fluxos para tabelas do DW Sefaz (DETIC).","dt_inicio":"","dt_fim":"","patrocinador":"Antônio Kehrwald","fonte":"Gestão","fase_atual":"execucao","status":"ativo","percentual":56,"icone_url":"","icone_emoji":"📊","dt_criacao":"2026-04-22","programa_id":null,"aprovacao":{"motivo_inicio":"","aprovado":false,"dt_aprovacao":"","obs":""},"ideacao":{"descricao":"","objetivo_smart":"","beneficios":"","requisitos":"","premissas":"","restricoes":"","entregas_macro":"","riscos_canvas":"","equipe":"","partes_interessadas":"","objetivo_estrategico":"","custos":"","resultados_esperados":"","acoes_imediatas":""},"planejamento":{"eap_html":"","riscos":[],"planner_link":""},"execucao":{"planner_link":"","percentual":56,"reunioes":[]},"conclusao":{"tipo":"","dt_conclusao":"","link_termo_aceite":"","historia":"","links_noticias":""}},{"id":1000303,"nome":"EvoluTIva","gerente":"Leonardo Branco","gerente_substituto":"","descricao":"Desenvolvimento das bases para acompanhamento do desempenho dos projetos e das demandas de melhoria da DTTI. MVP de dashboard já disponibilizado na intranet.","dt_inicio":"","dt_fim":"","patrocinador":"Antônio Kehrwald","fonte":"Gestão","fase_atual":"execucao","status":"ativo","percentual":70,"icone_url":"","icone_emoji":"🖥️","dt_criacao":"2026-04-22","programa_id":null,"aprovacao":{"motivo_inicio":"","aprovado":false,"dt_aprovacao":"","obs":""},"ideacao":{"descricao":"","objetivo_smart":"","beneficios":"","requisitos":"","premissas":"","restricoes":"","entregas_macro":"","riscos_canvas":"","equipe":"","partes_interessadas":"","objetivo_estrategico":"","custos":"","resultados_esperados":"","acoes_imediatas":""},"planejamento":{"eap_html":"","riscos":[],"planner_link":""},"execucao":{"planner_link":"","percentual":70,"reunioes":[]},"conclusao":{"tipo":"","dt_conclusao":"","link_termo_aceite":"","historia":"","links_noticias":""}},{"id":1000304,"nome":"Projeto Escola Íntegra","gerente":"Álvaro Santos","gerente_substituto":"","descricao":"Concluída a 3ª edição do concurso de manifestações artísticas. Elaboração do ebook, reuniões com a SEDUC, evento de premiação em 2025 e expansão para 100% das escolas estaduais.","dt_inicio":"","dt_fim":"","patrocinador":"Jociê Pereira","fonte":"Gestão","fase_atual":"conclusao","status":"concluido","percentual":100,"icone_url":"","icone_emoji":"🏆","dt_criacao":"2026-04-22","programa_id":null,"aprovacao":{"motivo_inicio":"","aprovado":false,"dt_aprovacao":"","obs":""},"ideacao":{"descricao":"","objetivo_smart":"","beneficios":"","requisitos":"","premissas":"","restricoes":"","entregas_macro":"","riscos_canvas":"","equipe":"","partes_interessadas":"","objetivo_estrategico":"","custos":"","resultados_esperados":"","acoes_imediatas":""},"planejamento":{"eap_html":"","riscos":[],"planner_link":""},"execucao":{"planner_link":"","percentual":100,"reunioes":[]},"conclusao":{"tipo":"sucesso","dt_conclusao":"","link_termo_aceite":"","historia":"O Projeto atingiu a meta. Realizada a Reunião de lições aprendidas. Expansão para 100% das escolas estaduais.","links_noticias":""}},{"id":1000305,"nome":"Portal e-Cage","gerente":"Marcos Ramos","gerente_substituto":"","descricao":"Priorizadas 7 melhorias de usabilidade. Homologação de dashboard estratégico, ajustes UX (e-mail, reclassificação, observação, filtros) e processos de monitoramento.","dt_inicio":"","dt_fim":"","patrocinador":"Jociê Pereira","fonte":"Gestão","fase_atual":"conclusao","status":"concluido","percentual":100,"icone_url":"","icone_emoji":"🌐","dt_criacao":"2026-04-22","programa_id":null,"aprovacao":{"motivo_inicio":"","aprovado":false,"dt_aprovacao":"","obs":""},"ideacao":{"descricao":"","objetivo_smart":"","beneficios":"","requisitos":"","premissas":"","restricoes":"","entregas_macro":"","riscos_canvas":"","equipe":"","partes_interessadas":"","objetivo_estrategico":"","custos":"","resultados_esperados":"","acoes_imediatas":""},"planejamento":{"eap_html":"","riscos":[],"planner_link":""},"execucao":{"planner_link":"","percentual":100,"reunioes":[]},"conclusao":{"tipo":"sucesso","dt_conclusao":"","link_termo_aceite":"","historia":"Projeto concluído com aceite do Patrocinador e transição formal da operação para a área de negócio.","links_noticias":""}},{"id":1000306,"nome":"Pró-Audit","gerente":"Lorenzo Venzon","gerente_substituto":"","descricao":"Validação externa do IA-CM (KPAs 2.9, 2.10 e 2.1) concluída e validadas KPAs 2.2 a 2.8. Monitoramento das recomendações no SAEWEB.","dt_inicio":"","dt_fim":"","patrocinador":"Jociê Pereira","fonte":"Gestão","fase_atual":"conclusao","status":"concluido","percentual":100,"icone_url":"","icone_emoji":"🔬","dt_criacao":"2026-04-22","programa_id":null,"aprovacao":{"motivo_inicio":"","aprovado":false,"dt_aprovacao":"","obs":""},"ideacao":{"descricao":"","objetivo_smart":"","beneficios":"","requisitos":"","premissas":"","restricoes":"","entregas_macro":"","riscos_canvas":"","equipe":"","partes_interessadas":"","objetivo_estrategico":"","custos":"","resultados_esperados":"","acoes_imediatas":""},"planejamento":{"eap_html":"","riscos":[],"planner_link":""},"execucao":{"planner_link":"","percentual":100,"reunioes":[]},"conclusao":{"tipo":"sucesso","dt_conclusao":"","link_termo_aceite":"","historia":"Obtida a validação nível 2 do IA-CM. Realizada a reunião de lições aprendidas e encerramento do Projeto. Será iniciado em 2026 novo projeto para obtenção do nível 3 do IA-CM.","links_noticias":""}},{"id":1000307,"nome":"Transparência Cidadã","gerente":"Leonardo Branco","gerente_substituto":"","descricao":"Implantado painel reformulado de Contratos de Obras (novo layout), concluídos novos FAQs (Obras e Dívida Ativa), iniciada reformulação dos painéis \\"Despesas com Fornecedores e Prestadores\\" e mapeamento de interesses dos cidadãos.","dt_inicio":"","dt_fim":"","patrocinador":"Antônio Kehrwald","fonte":"Gestão","fase_atual":"conclusao","status":"concluido","percentual":100,"icone_url":"","icone_emoji":"📋","dt_criacao":"2026-04-22","programa_id":null,"aprovacao":{"motivo_inicio":"","aprovado":false,"dt_aprovacao":"","obs":""},"ideacao":{"descricao":"","objetivo_smart":"","beneficios":"","requisitos":"","premissas":"","restricoes":"","entregas_macro":"","riscos_canvas":"","equipe":"","partes_interessadas":"","objetivo_estrategico":"","custos":"","resultados_esperados":"","acoes_imediatas":""},"planejamento":{"eap_html":"","riscos":[],"planner_link":""},"execucao":{"planner_link":"","percentual":100,"reunioes":[]},"conclusao":{"tipo":"sucesso","dt_conclusao":"","link_termo_aceite":"","historia":"O Projeto atingiu a meta ao ganhar selo Diamante no ranking PNTP. Algumas pendências ficaram acordadas para serem entregues em 2026 por meio de controle da própria Área e acompanhamento pelo EPP ao final do 1º trimestre de 2026.","links_noticias":""}}],"programas":[{"id":2000001,"nome":"Gestão de Riscos no Controle","descricao":"Programa estratégico para desenvolvimento de controles baseados em riscos em diferentes áreas da CAGE.","gerente":"Ricardo Santiago","patrocinador":"Jociê Pereira","status":"ativo","dt_criacao":"2026-04-22"},{"id":2000002,"nome":"Qualificação da Informação Contábil","descricao":"Programa para qualificação da informação contábil no Siconfi e identificação das fontes de recursos.","gerente":"Guilherme Lentz","patrocinador":"Felipe Bittencourt","status":"ativo","dt_criacao":"2026-04-22"}],"exportDate":"2026-04-22T16:02:01.832Z","version":"SIGA_Projetos_v4"}');
    PROJETOS = data.projetos.map(function(p){return projFixDefaults(p);});
    projSave();
    if(data.programas) { PROGRAMAS = data.programas.map(function(pg){return progFixDefaults(pg);}); progSave(); }
  } catch(e) { console.warn("Demo data error:", e); }
}


// ── Criar Reunioes de Status Patrocinador para todos os projetos ativos ──
function projAutoAddReunioesStatusTodos(){
  projAutoAddReunioesTipo('status', 0);
}

// ── Excluir reuniões duplicadas em TODOS os projetos ──
function projDeduplicarReunioesGlobal(){
  if(!projEnsureWriteAll('Apenas EPP pode alterar reuniões.')) return;
  projLoad();
  let totalRem = 0;
  PROJETOS.forEach(function(proj){
    if(!proj.execucao || !proj.execucao.reunioes) return;
    let seen = {};
    let orig = proj.execucao.reunioes.length;
    proj.execucao.reunioes = proj.execucao.reunioes.filter(function(r){
      let k = r.nome + '|' + (r.data||'');
      if(seen[k]) return false;
      seen[k] = true;
      return true;
    });
    totalRem += orig - proj.execucao.reunioes.length;
  });
  projSave();
  if(totalRem > 0){
    projToast(totalRem + ' reunião(ões) duplicada(s) removida(s).');
  } else {
    projToast('Nenhuma duplicata encontrada.','#d97706');
  }
  projAtualizarBadgeReunioes();
  projGo('reunioes', document.getElementById('pnb-reunioes'));
}


// ── Exportar / Importar JSON ──────────────────────────────────
function projEnsureEPJson(msg='Apenas o perfil EPP pode exportar ou importar o JSON do sistema.'){
  if(isEP()) return true;
  projToast(msg, '#d97706');
  return false;
}

function projExportJSON(){
  if(!projEnsureEPJson()) return;
  projLoad();
  let data = {
    projetos: PROJETOS,
    programas: PROGRAMAS,
    macros: PROJ_MACROS,
    objetivos: PROJ_OBJETIVOS,
    exportDate: new Date().toISOString(),
    version: 'SIGA_Projetos_v6'
  };
  let blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
  let url = URL.createObjectURL(blob);
  let a = document.createElement('a');
  a.href = url;
  a.download = 'SIGA_Projetos_backup_' + new Date().toISOString().slice(0,10) + '.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  projToast('Backup exportado!');
}

function projImportJSON(){
  if(!projEnsureEPJson()) return;
  let inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.json';
  inp.onchange = function(e){
    let file = e.target.files[0];
    if(!file) return;
    let reader = new FileReader();
    reader.onload = function(ev){
      try {
        let data = JSON.parse(ev.target.result);
        if(!data.projetos || !Array.isArray(data.projetos)){
          projToast('Arquivo JSON invalido.','#d97706');
          return;
        }
        projConfirmar('Importar dados? Isso substituira TODOS os projetos e programas atuais.', function(){
          const prevProjetos = PROJETOS;
          const prevProgramas = PROGRAMAS;
          const prevMacros = PROJ_MACROS;
          const prevObjetivos = PROJ_OBJETIVOS;

          projApplyDataSet(data);

          _projFbState.loaded = true;
          clearTimeout(_projFbState.saveTimer);

          const gravarCacheLocal = function(){
            localStorage.setItem(PROJ_STORAGE_KEY, JSON.stringify(PROJETOS));
            localStorage.setItem(PROG_STORAGE_KEY, JSON.stringify(PROGRAMAS));
            localStorage.setItem('cagePROJ_MACROS_v6', JSON.stringify(PROJ_MACROS||[]));
            localStorage.setItem('cage_objetivos_v6', JSON.stringify(PROJ_OBJETIVOS||[]));
          };

          if(!fbReady()){
            try { gravarCacheLocal(); } catch(_e){}
            projToast('Importado localmente. Firebase indisponível — dados não sincronizados na nuvem.', '#d97706');
            projGo('inicio', document.getElementById('pnb-inicio'));
            return;
          }

          projToast('Enviando para a nuvem…');
          projFbSaveAll().then(function(){
            try { gravarCacheLocal(); } catch(_e){}
            projToast('Dados importados e sincronizados na nuvem!');
            projGo('inicio', document.getElementById('pnb-inicio'));
          }).catch(function(err){
            PROJETOS = prevProjetos;
            PROGRAMAS = prevProgramas;
            PROJ_MACROS = prevMacros;
            PROJ_OBJETIVOS = prevObjetivos;
            _projFbState.loaded = false;
            console.warn('projImportJSON/fb:', err && err.message);
            projToast('Erro ao enviar para a nuvem: ' + (err && err.message ? err.message : err), '#dc2626');
          });
        });
      } catch(err){
        projToast('Erro ao ler arquivo: ' + err.message, '#d97706');
      }
    };
    reader.readAsText(file);
  };
  inp.click();
}

function projProcessImport(inputEl){
  if(!projEnsureEPJson()){ if(inputEl) inputEl.value=''; return; }
  if(!inputEl || !inputEl.files || !inputEl.files[0]) return;
  let file = inputEl.files[0];
  let reader = new FileReader();
  reader.onload = function(ev){
    try {
      let data = JSON.parse(ev.target.result);
      if(!data.projetos || !Array.isArray(data.projetos)){
        projToast('Arquivo JSON invalido.','#d97706');
        return;
      }
      projConfirmar('Importar dados? Isso substituira TODOS os projetos e programas atuais.', function(){
        const prevProjetos = PROJETOS;
        const prevProgramas = PROGRAMAS;
        const prevMacros = PROJ_MACROS;
        const prevObjetivos = PROJ_OBJETIVOS;

        projApplyDataSet(data);

        _projFbState.loaded = true;
        clearTimeout(_projFbState.saveTimer);

        const gravarCacheLocal = function(){
          localStorage.setItem(PROJ_STORAGE_KEY, JSON.stringify(PROJETOS));
          localStorage.setItem(PROG_STORAGE_KEY, JSON.stringify(PROGRAMAS));
          localStorage.setItem('cagePROJ_MACROS_v6', JSON.stringify(PROJ_MACROS||[]));
          localStorage.setItem('cage_objetivos_v6', JSON.stringify(PROJ_OBJETIVOS||[]));
        };

        if(!fbReady()){
          try { gravarCacheLocal(); } catch(_e){}
          projToast('Importado localmente. Firebase indisponível — dados não sincronizados na nuvem.', '#d97706');
          projGo('inicio', document.getElementById('pnb-inicio'));
          return;
        }

        projToast('Enviando para a nuvem…');
        projFbSaveAll({includeConfig:true}).then(function(){
          try { gravarCacheLocal(); } catch(_e){}
          projToast('Dados importados com sucesso!');
          projGo('inicio', document.getElementById('pnb-inicio'));
        }).catch(function(err){
          PROJETOS = prevProjetos;
          PROGRAMAS = prevProgramas;
          PROJ_MACROS = prevMacros;
          PROJ_OBJETIVOS = prevObjetivos;
          projToast('Falha ao importar na nuvem: ' + err.message, '#dc2626');
        });
      });
    } catch(e){
      projToast('Erro ao ler arquivo JSON.','#dc2626');
    } finally {
      inputEl.value = '';
    }
  };
  reader.readAsText(file);
}


// ── Alterar Emoji do Projeto (Picker) ──────────────────────────
let _projWorkEmojis = [
  '\u{1F4C1}','\u{1F4C2}','\u{1F4CA}','\u{1F4C8}','\u{1F4C9}','\u{1F4CB}','\u{1F4CC}','\u{1F4CE}','\u{1F4DD}','\u{1F4C4}','\u{1F4C3}','\u{1F4D1}','\u{1F4D0}','\u{1F4CF}',
  '\u{1F5C2}','\u{1F5C3}','\u{1F5C4}','\u{1F5D3}','\u{1F5D2}','\u{1F4C5}','\u{1F4C6}',
  '\u{1F4BC}','\u{1F3E2}','\u{1F3D7}','\u{1F3ED}','\u{1F3DB}','\u{1F3E6}','\u{1F3E5}','\u{1F3EB}','\u{1F3EA}',
  '\u{2699}','\u{1F527}','\u{1F528}','\u{1F6E0}','\u{1F529}','\u{1F517}','\u{1F511}','\u{1F510}','\u{1F512}','\u{1F513}',
  '\u{1F4A1}','\u{1F50D}','\u{1F50E}','\u{1F52C}','\u{1F52D}','\u{1F9EA}','\u{1F9EE}','\u{1F9F0}',
  '\u{1F4BB}','\u{1F5A5}','\u{1F5A8}','\u{2328}','\u{1F5B1}','\u{1F4BE}','\u{1F4BF}','\u{1F4C0}',
  '\u{1F310}','\u{1F30D}','\u{1F4E1}','\u{1F4F6}','\u{1F4F1}','\u{1F4F2}','\u{260E}','\u{1F4DE}','\u{1F4E0}',
  '\u{2709}','\u{1F4E7}','\u{1F4E8}','\u{1F4E9}','\u{1F4E4}','\u{1F4E5}','\u{1F4E6}','\u{1F4EB}','\u{1F4EC}',
  '\u{1F3C6}','\u{1F3C5}','\u{1F3AF}','\u{1F393}','\u{1F680}','\u{1F6E1}','\u{2B50}','\u{1F31F}','\u{1F48E}',
  '\u{2705}','\u{2611}','\u{274C}','\u{2753}','\u{2757}','\u{26A0}','\u{1F534}','\u{1F7E2}','\u{1F7E1}','\u{1F535}',
  '\u{1F916}','\u{1F9E0}','\u{1F91D}','\u{1F465}','\u{1F464}','\u{1F64B}','\u{1F4AC}','\u{1F5E3}',
  '\u{1F4E3}','\u{1F4E2}','\u{1F514}',
  '\u{23F1}','\u{23F0}','\u{23F3}','\u{1F550}',
  '\u{1F3A8}','\u{1F5BC}','\u{270F}','\u{1F58A}','\u{1F58B}','\u{2712}','\u{1F4D6}','\u{1F4DA}',
  '\u{1F4B0}','\u{1F4B5}','\u{1F4B3}','\u{1F9FE}','\u{1F4D2}','\u{1F4D5}','\u{1F4D7}','\u{1F4D8}','\u{1F4D9}',
  '\u{1F3E0}','\u{1F3E1}','\u{1F5FA}','\u{1F9ED}','\u{1F697}','\u{1F68C}','\u{2708}','\u{1F6A2}',
  '\u{1F331}','\u{1F333}','\u{267B}','\u{1F4A7}','\u{1F525}','\u{26A1}','\u{2600}','\u{1F308}'
];


function projShowEmojiPicker(projId) {
  let overlay = document.createElement('div');
  overlay.id = 'proj-emoji-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center';

  let box = document.createElement('div');
  box.style.cssText = 'background:#fff;border-radius:14px;padding:1.5rem;max-width:440px;width:95%;max-height:70vh;overflow-y:auto;box-shadow:0 16px 48px rgba(0,0,0,.3)';

  let header = document.createElement('div');
  header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem';
  let title = document.createElement('div');
  title.style.cssText = 'font-weight:700;font-size:15px;color:#1a2540';
  title.textContent = 'Selecionar Icone do Projeto';
  let closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = '\u2715';
  closeBtn.style.cssText = 'background:none;border:none;font-size:20px;cursor:pointer;color:#70709a';
  closeBtn.onclick = function(){ overlay.remove(); };
  header.appendChild(title);
  header.appendChild(closeBtn);
  box.appendChild(header);

  let grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(40px,1fr));gap:4px';
  _projWorkEmojis.forEach(function(em){
    let btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = em;
    btn.style.cssText = 'font-size:22px;padding:6px;background:none;border:1px solid #e4e2d8;border-radius:8px;cursor:pointer;transition:all .15s';
    btn.onmouseover = function(){ this.style.background='#ebf1fc'; this.style.borderColor='#1A5DC8'; };
    btn.onmouseout = function(){ this.style.background='none'; this.style.borderColor='#e4e2d8'; };
    btn.onclick = function(){
      projLoad();
      let proj = PROJETOS.find(function(p){return String(p.id)===String(projId);});
      if(proj){ proj.icone_emoji = em; proj.icone_url = ''; projSave(); projToast('Icone atualizado!'); projAbrirDetalhe(projId, true); }
      overlay.remove();
    };
    grid.appendChild(btn);
  });
  box.appendChild(grid);

  let uploadDiv = document.createElement('div');
  uploadDiv.style.cssText = 'margin-top:1rem;padding-top:1rem;border-top:1px solid #e4e2d8;text-align:center';
  let uploadLabel = document.createElement('label');
  uploadLabel.className = 'proj-btn';
  uploadLabel.style.cssText = 'cursor:pointer;font-size:12px;padding:6px 14px';
  uploadLabel.textContent = '\u{1F4F7} Enviar imagem personalizada';
  let uploadInput = document.createElement('input');
  uploadInput.type = 'file';
  uploadInput.accept = 'image/*';
  uploadInput.style.display = 'none';
  uploadInput.onchange = function(){ projUploadIcone(projId, this); overlay.remove(); };
  uploadLabel.appendChild(uploadInput);
  uploadDiv.appendChild(uploadLabel);
  box.appendChild(uploadDiv);

  overlay.appendChild(box);
  overlay.onclick = function(e){ if(e.target===overlay) overlay.remove(); };
  document.body.appendChild(overlay);
}


// ── V9: helpers executivos ───────────────────────────────────────
function projProgramaNome(p) { if(p && p.programa_id){ const pg=(PROGRAMAS||[]).find(x=>String(x.id)===String(p.programa_id)); if(pg)return pg.nome; } return 'Sem programa'; }
function projGetDashFiltro(){return {patrocinador:document.getElementById('proj-f-patrocinador')?.value||'',objetivo:document.getElementById('proj-f-objetivo')?.value||'',macro:document.getElementById('proj-f-macro')?.value||'',divisao:document.getElementById('proj-f-divisao')?.value||''};}
function projGroupCount(projects,getter){const map={};projects.forEach(p=>{const k=getter(p)||'Não informado';map[k]=(map[k]||0)+1;});return Object.entries(map).map(([label,count])=>({label,count})).sort((a,b)=>b.count-a.count).slice(0,8);}
function projTarefasAtrasadasProjeto(p){const today=new Date().toISOString().slice(0,10);projSyncDerivedTaskDates(p.execucao?.tarefas||[]);return projFlattenTasks(p.execucao?.tarefas||[]).filter(t=>!(t._children&&t._children.length)&&!t.concluida&&t.dt_fim&&t.dt_fim<today);}
function projRenderIndicadoresExecucao(p){const inds=p.execucao?.indicadores||[];return `<div style="display:flex;flex-direction:column;gap:8px">${inds.length?inds.map((i,idx)=>`<div class="proj-v9-ind-grid"><input class="proj-fi" value="${projEsc(i.nome||'')}" onchange="projUpdateIndicador(${idx},'nome',this.value)" placeholder="Indicador"><input class="proj-fi" type="number" value="${projEsc(String(i.meta||''))}" onchange="projUpdateIndicador(${idx},'meta',this.value)" placeholder="Meta"><input class="proj-fi" type="number" value="${projEsc(String(i.atual||''))}" onchange="projUpdateIndicador(${idx},'atual',this.value)" placeholder="Atual"><select class="proj-fi" onchange="projUpdateIndicador(${idx},'status',this.value)"><option ${i.status==='Em acompanhamento'?'selected':''}>Em acompanhamento</option><option ${i.status==='Atingido'?'selected':''}>Atingido</option><option ${i.status==='Atenção'?'selected':''}>Atenção</option></select><button type="button" class="proj-btn danger" onclick="projRemoveIndicador(${idx})">×</button></div>`).join(''):'<div style="font-size:12px;color:var(--ink3)">Nenhum indicador registrado para este projeto.</div>'}<div><button type="button" class="proj-btn primary" style="font-size:11px;padding:5px 12px" onclick="projAddIndicador()">+ Indicador</button></div></div>`;}
function projRemoveIndicador(idx){projLoad();const proj=PROJETOS.find(p=>String(p.id)===_projCurrentId);if(!proj?.execucao?.indicadores)return;proj.execucao.indicadores.splice(idx,1);projSave();projDetalheTab('execucao',document.querySelector('#proj-detalhe-tabs .proj-tab:nth-child(4)'));}
const PROJ_CRON_XLSX_HEADERS = ['Numero','Nome','PPE','Marco','Inicio','Fim','Responsavel','Conclusao','Concluida'];
function projFlattenTasksForExport(tasks,prefix){let rows=[];projSyncDerivedTaskDates(tasks||[]);(tasks||[]).forEach((t,i)=>{const num=prefix?prefix+'.'+(i+1):String(i+1);rows.push({Numero:num,Nome:t.nome||'',PPE:t.ppe?'Sim':'Não',Marco:t.marco?'Sim':'Não',Inicio:t.dt_inicio||'',Fim:t.dt_fim||'',Responsavel:t.responsavel||'',Conclusao:t.conclusao||0,Concluida:t.concluida?'Sim':'Não'});rows=rows.concat(projFlattenTasksForExport(t.subtarefas||[],num));});return rows;}
function projExportCronogramaXLSX(){if(!projEnsureWriteSchedule('Apenas o perfil EPP ou o gerente vinculado ao projeto pode exportar o cronograma.')) return;projLoad();const proj=PROJETOS.find(p=>String(p.id)===_projCurrentId);if(!proj)return;projSyncDerivedTaskDates(proj.execucao?.tarefas||[]);const rows=projFlattenTasksForExport(proj.execucao?.tarefas||[]);if(!rows.length){projToast('Não há tarefas para exportar.','#d97706');return;}if(typeof XLSX==='undefined'){projToast('Biblioteca XLSX indisponível.','#d97706');return;}const ws=XLSX.utils.json_to_sheet(rows,{header:PROJ_CRON_XLSX_HEADERS});ws['!cols']=[{wch:10},{wch:42},{wch:8},{wch:8},{wch:12},{wch:12},{wch:24},{wch:10},{wch:10}];const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Cronograma SIGA');XLSX.writeFile(wb,'Cronograma_SIGA_'+(proj.nome||'projeto').replace(/[^\w]+/g,'_').slice(0,40)+'.xlsx');}
function projCronXlsxBool(v){const s=String(v||'').trim().toLowerCase();if(['sim','s','true','1'].includes(s))return true;if(['não','nao','n','false','0',''].includes(s))return false;throw new Error('Campo Sim/Não inválido.');}
function projCronXlsxDate(v){const s=String(v||'').trim();if(!s)return '';if(!/^\d{4}-\d{2}-\d{2}$/.test(s))throw new Error('Datas devem estar no formato AAAA-MM-DD exportado pelo SIGA.');return s;}
function projImportCronogramaXLSX(inputEl){
  if(!projEnsureWriteSchedule('Apenas o perfil EPP ou o gerente vinculado ao projeto pode importar o cronograma.')) return;
  if(!inputEl){
    const inp=document.createElement('input');
    inp.type='file';inp.accept='.xlsx';inp.style.display='none';
    inp.onchange=function(){projImportCronogramaXLSX(inp);setTimeout(()=>inp.remove(),0);};
    document.body.appendChild(inp);inp.click();return;
  }
  const file=inputEl.files&&inputEl.files[0]; if(!file)return;
  if(typeof XLSX==='undefined'){projToast('Biblioteca XLSX indisponível.','#d97706');inputEl.value='';return;}
  const reader=new FileReader();
  reader.onload=function(ev){
    try{
      const wb=XLSX.read(ev.target.result,{type:'array'});
      const ws=wb.Sheets[wb.SheetNames[0]];
      const matrix=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:false});
      const headers=(matrix[0]||[]).map(h=>String(h).trim());
      if(headers.length!==PROJ_CRON_XLSX_HEADERS.length || PROJ_CRON_XLSX_HEADERS.some((h,i)=>headers[i]!==h)) throw new Error('Arquivo incompatível. Use o mesmo .xlsx exportado pelo SIGA.');
      const rows=XLSX.utils.sheet_to_json(ws,{defval:'',raw:false}).filter(r=>String(r.Numero||r.Nome||'').trim());
      const tarefas=[];
      rows.forEach((r,idx)=>{
        const numero=String(r.Numero||'').trim().replace(/\.$/,'');
        if(!/^(\d+)(\.\d+)*$/.test(numero)) throw new Error('Numeração inválida na linha '+(idx+2)+'.');
        const parts=numero.split('.').map(n=>Number(n)-1);
        if(parts.some(n=>!Number.isInteger(n)||n<0)) throw new Error('Numeração inválida na linha '+(idx+2)+'.');
        let list=tarefas;
        for(let i=0;i<parts.length-1;i++){
          const parent=list[parts[i]];
          if(!parent) throw new Error('Subtarefa sem tarefa superior na linha '+(idx+2)+'.');
          if(!parent.subtarefas) parent.subtarefas=[];
          list=parent.subtarefas;
        }
        const pos=parts[parts.length-1];
        if(pos!==list.length) throw new Error('Numeração fora de ordem na linha '+(idx+2)+'.');
        const conclusao=Math.max(0,Math.min(100,Number(String(r.Conclusao||'0').replace(',','.'))||0));
        list.push({id:'t'+Date.now()+'_'+idx,nome:String(r.Nome||'Nova tarefa').trim()||'Nova tarefa',ppe:projCronXlsxBool(r.PPE),marco:projCronXlsxBool(r.Marco),dt_inicio:projCronXlsxDate(r.Inicio),dt_fim:projCronXlsxDate(r.Fim),responsavel:String(r.Responsavel||'').trim(),conclusao,concluida:projCronXlsxBool(r.Concluida),subtarefas:[]});
      });
      projConfirmar('Importar cronograma? Isso substituirá as tarefas atuais deste projeto.', function(){
        projWithScheduleWrite(() => {
        projLoad();
        const proj=PROJETOS.find(p=>String(p.id)===_projCurrentId); if(!proj)return;
        if(!proj.execucao)proj.execucao={planner_link:'',percentual:0,reunioes:[],tarefas:[]};
        projEnsureCurrentScheduleBackupBeforeMutation(proj);
        proj.execucao.tarefas=projSyncDerivedTaskDates(tarefas);
        if(proj.execucao.pct_mode==='derivado'){proj.percentual=projCalcDerivedPct(proj.execucao.tarefas);proj.execucao.percentual=proj.percentual;}
        projSave();
        projToast('Cronograma importado com sucesso!');
        projDetalheTab('execucao',document.querySelector('#proj-detalhe-tabs .proj-tab:nth-child(4)'));
        });
      });
    }catch(e){projToast('Erro ao importar .xlsx: '+e.message,'#dc2626');}
    finally{inputEl.value='';}
  };
  reader.readAsArrayBuffer(file);
}
function projRemoveConclusaoImagem(idx){projLoad();const proj=PROJETOS.find(p=>String(p.id)===_projCurrentId);if(!proj?.conclusao?.imagens)return;proj.conclusao.imagens.splice(idx,1);projSave();projDetalheTab('conclusao',document.querySelector('#proj-detalhe-tabs .proj-tab:nth-child(5)'));}
// ── Init ao carregar ──────────────────────────────────────────────
// ── Ajustes v9.1: indicadores, memorial e report executivo ───────
const PROJ_CAGE_REPORT_LOGO = 'cage-logo-report.png';

function projGroupCountWithProjects(list, fn) {
  const map = {};
  (list||[]).forEach(p => {
    const values = Array.isArray(fn(p)) ? fn(p) : [fn(p)];
    const clean = values.map(v => String(v||'').trim()).filter(Boolean);
    (clean.length ? clean : ['Não informado']).forEach(key => {
      if(!map[key]) map[key] = { label:key, count:0, projects:[], projectObjs:[] };
      if(!map[key].projectObjs.some(x => String(x.id) === String(p.id))) {
        map[key].count++;
        map[key].projects.push(p.nome||'Projeto sem nome');
        map[key].projectObjs.push(p);
      }
    });
  });
  return Object.values(map).sort((a,b) => b.count-a.count || a.label.localeCompare(b.label));
}

function projMultiValues(...sources) {
  const out = [];
  const add = v => {
    if(Array.isArray(v)) v.forEach(add);
    else String(v||'').split(/[;\n|]+/).map(s => s.trim()).filter(Boolean).forEach(s => {
      if(!out.includes(s)) out.push(s);
    });
  };
  sources.forEach(add);
  return out;
}

function projTextCompare(a, b) {
  return String(a || '').localeCompare(String(b || ''));
}

function projOptionsFromProjetos(projects, getter) {
  const vals = [];
  (projects||[]).forEach(p => {
    const got = getter(p);
    (Array.isArray(got) ? got : [got]).forEach(v => {
      const clean = String(v||'').trim();
      if(clean && !vals.includes(clean)) vals.push(clean);
    });
  });
  return vals.sort(projTextCompare);
}

function projFiltrarProjetosV9(projects) {
  const f = projGetDashFiltro();
  return projects.filter(p => {
    const d = projDimensoesProjeto(p);
    return (!f.patrocinador || d.patrocinador === f.patrocinador)
      && (!f.objetivo || d.objetivos.includes(f.objetivo))
      && (!f.macro || d.macros.includes(f.macro))
      && (!f.divisao || d.divisao === f.divisao);
  });
}

function projUnlinkedValues(allValues, projects, getter) {
  const linked = new Set();
  (projects||[]).forEach(p => {
    const got = getter(p);
    (Array.isArray(got) ? got : [got]).forEach(v => {
      const clean = String(v||'').trim();
      if(clean) linked.add(clean);
    });
  });
  return (allValues||[]).map(v => String(v||'').trim()).filter(v => v && !linked.has(v)).sort(projTextCompare);
}

function projToggleDashUnlinked(key) {
  window._projDashOpenUnlinked = window._projDashOpenUnlinked || {};
  window._projDashOpenUnlinked[key] = !window._projDashOpenUnlinked[key];
  projRenderDashV9();
}

function projPctFmt(valor) {
  const n = Number(valor||0);
  return n.toLocaleString('pt-BR', { minimumFractionDigits:2, maximumFractionDigits:2 }) + '%';
}

function projIndicadorResumo(ind) {
  const meta = projIndicadorValor(ind,'meta');
  const atual = projIndicadorValor(ind,'resultado');
  const pct = meta ? (atual / meta) * 100 : 0;
  return `${atual}/${meta} (${projPctFmt(pct)})`;
}

function projDashKey(title) {
  return String(title||'grafico').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-|-$/g,'').toLowerCase();
}

function projToggleDashGroup(chartKey, idx) {
  window._projDashOpenGroups = window._projDashOpenGroups || {};
  const key = chartKey + ':' + idx;
  window._projDashOpenGroups[key] = !window._projDashOpenGroups[key];
  projRenderDashV9();
}

function projDashProjectList(projects) {
  return (projects||[]).map(p => `<a href="#" class="proj-v10-chart-project" onclick="event.preventDefault();event.stopPropagation();projAbrirDetalhe('${projEsc(String(p.id))}', true)">${projIconHtml(p)}<span>${projEsc(p.nome||'Projeto sem nome')}</span></a>`).join('');
}

function projChartBars(title, items, opts) {
  const chartKey = projDashKey(title);
  const max = Math.max(1, ...(items||[]).map(i => i.count||0));
  window._projDashOpenGroups = window._projDashOpenGroups || {};
  window._projDashOpenUnlinked = window._projDashOpenUnlinked || {};
  const unlinked = opts?.unlinkedItems || [];
  const unlinkedKey = opts?.unlinkedKey || chartKey;
  const unlinkedHtml = opts?.unlinkedLabel ? `<button type="button" class="proj-v10-unlinked-btn" onclick="event.stopPropagation();projToggleDashUnlinked('${projEsc(unlinkedKey)}')">${projEsc(opts.unlinkedLabel)} (${unlinked.length})</button>${window._projDashOpenUnlinked[unlinkedKey] ? `<div class="proj-v10-unlinked-list">${unlinked.length ? unlinked.map(v => `<div>${projEsc(v)}</div>`).join('') : '<div>Nenhum item sem projeto vinculado.</div>'}</div>` : ''}` : '';
  return `<div class="proj-v9-chart-card"><div class="proj-card-t">${projEsc(title)}</div><div class="proj-v9-bars">${
    (items||[]).length ? items.map((i,idx) => {
      const tip = (i.projects&&i.projects.length) ? i.projects.join(' | ') : (i.title||i.label);
      const open = !!window._projDashOpenGroups[chartKey + ':' + idx];
      const width = typeof i.widthPct === 'number' ? Math.max(2, Math.min(100, i.widthPct)) : Math.max(6, Math.round((i.count||0)/max*100));
      const value = i.displayValue || i.count || 0;
      return `<div class="proj-v9-bar-row" title="${projEsc(tip)}" onclick="projToggleDashGroup('${chartKey}',${idx})"><span title="${projEsc(tip)}">${projEsc(i.label)}</span><div class="proj-v9-bar"><div style="width:${width}%"></div></div><strong>${projEsc(value)}</strong>${open ? `<div class="proj-v10-chart-projects">${projDashProjectList(i.projectObjs||[]) || '<span style="font-size:10.5px;color:var(--ink3)">Sem projetos vinculados.</span>'}</div>` : ''}</div>`;
    }).join('') : '<div style="font-size:12px;color:var(--ink3)">Sem dados.</div>'
  }${unlinkedHtml}</div></div>`;
}

function projIndicadoresLista(projetos) {
  const rows = [];
  (projetos||[]).forEach(p => (p.execucao?.indicadores||[]).forEach((ind,idx) => rows.push({ p, ind, idx })));
  return rows;
}

function projIndicadorValor(ind, campo) {
  return Number(ind[campo] ?? (campo === 'resultado' ? ind.atual : 0) ?? 0);
}

function projIndicadorPct(ind) {
  const meta = projIndicadorValor(ind,'meta');
  const resultado = projIndicadorValor(ind,'resultado');
  return meta ? Math.max(0, Math.min(999, Math.round(resultado/meta*100))) : 0;
}

function projIndicadoresDashItems(rows) {
  const map = {};
  (rows||[]).forEach(({p, ind}) => {
    const label = String(ind.nome||'Indicador sem nome').trim() || 'Indicador sem nome';
    if(!map[label]) map[label] = { label, count:0, pctSum:0, displayParts:[], projects:[], projectObjs:[] };
    const meta = projIndicadorValor(ind,'meta');
    const atual = projIndicadorValor(ind,'resultado');
    const pct = meta ? (atual / meta) * 100 : 0;
    map[label].count++;
    map[label].pctSum += pct;
    map[label].displayParts.push(`${p.nome}: ${atual}/${meta} (${projPctFmt(pct)})`);
    map[label].projects.push(`${p.nome}: ${atual}/${meta} (${projPctFmt(pct)})`);
    map[label].projectObjs.push(p);
  });
  return Object.values(map).map(item => {
    const avg = item.count ? item.pctSum / item.count : 0;
    return {
      label:item.label,
      count:Math.round(avg),
      widthPct:Math.max(0, Math.min(100, avg)),
      displayValue:item.count === 1 ? item.displayParts[0].replace(/^.*?:\s*/, '') : `Média ${projPctFmt(avg)}`,
      projects:item.projects,
      projectObjs:item.projectObjs
    };
  }).sort((a,b) => b.count-a.count || a.label.localeCompare(b.label));
}

function projIndicadoresMetaChart(rows) {
  return `<div class="proj-v9-chart-card"><div class="proj-card-t">Resultado vs. Meta</div><div class="proj-v9-meta-list">${
    (rows||[]).length ? rows.map(r => {
      const meta = projIndicadorValor(r.ind,'meta');
      const atual = projIndicadorValor(r.ind,'resultado');
      const pctReal = meta ? (atual / meta) * 100 : 0;
      const pct = Math.max(0, Math.min(100, pctReal));
      const pctLabel = meta ? Math.round(pctReal) : 0;
      return `<div class="proj-v9-meta-row" title="${projEsc(r.p.nome)}: ${atual} / ${meta}"><div class="proj-v9-meta-name">${projEsc(r.ind.nome||'Indicador')}<div style="font-size:10.5px;color:var(--ink3)">${projEsc(r.p.nome||'')}</div></div><div class="proj-v9-meta-wrap"><div class="proj-v9-meta-target">${projEsc(meta)}</div><div class="proj-v9-meta-track"><div class="proj-v9-meta-fill" style="width:${pct}%"></div></div><div class="proj-v9-meta-current" style="left:${pct}%">${projEsc(atual)}</div><div class="proj-v9-meta-pct">${pctLabel}%</div></div></div>`;
    }).join('') : '<div style="font-size:12px;color:var(--ink3)">Nenhum indicador encontrado para os filtros atuais.</div>'
  }</div></div>`;
}

function projRenderDashV9() {
  if(typeof projLoadListas === 'function') projLoadListas();
  const all = (PROJETOS||[]).filter(p => p.status === 'ativo');
  const cur = projGetDashFiltro();
  const opts = {
    patrocinador: projOptionsFromProjetos(all, p => projDimensoesProjeto(p).patrocinador),
    objetivo: projOptionsFromProjetos(all, p => projDimensoesProjeto(p).objetivos),
    macro: projOptionsFromProjetos(all, p => projDimensoesProjeto(p).macros),
    divisao: projOptionsFromProjetos(all, p => projDimensoesProjeto(p).divisao)
  };
  const sel = (id,label,arr,val) => `<div class="proj-fg" style="margin:0"><label class="proj-fl">${label}</label><select class="proj-fi" id="${id}" onchange="projRenderDashV9()"><option value="">Todos</option>${arr.map(v=>`<option value="${projEsc(v)}" ${v===val?'selected':''}>${projEsc(v)}</option>`).join('')}</select></div>`;
  const filtrados = projFiltrarProjetosV9(all);
  const filtrosEl = document.getElementById('proj-dash-filtros');
  if(filtrosEl) projSetSafeHtml(filtrosEl, `<div class="proj-v9-filter-card"><div class="proj-card-t">Filtros</div><div class="proj-v9-filter-grid">${sel('proj-f-patrocinador','Patrocinador',opts.patrocinador,cur.patrocinador)}${sel('proj-f-objetivo','Objetivo Estratégico',opts.objetivo,cur.objetivo)}${sel('proj-f-macro','Macroprocesso',opts.macro,cur.macro)}${sel('proj-f-divisao','Divisão',opts.divisao,cur.divisao)}</div></div>`);

  const alertasEl = document.getElementById('proj-dash-alertas');
  if(alertasEl) {
    const comAtraso = filtrados.map(p => ({ p, tarefas:projTarefasAtrasadasProjeto(p) })).filter(x => x.tarefas.length);
    projSetSafeHtml(alertasEl, `<div class="proj-v9-alert-card"><div class="proj-card-t">Painel de Alertas</div>${comAtraso.length ? comAtraso.map(({p,tarefas}) => `<div class="proj-v9-alert-project"><div style="display:flex;justify-content:space-between;gap:10px"><a href="#" onclick="event.preventDefault();projAbrirDetalhe('${projEsc(String(p.id))}', true)" style="font-weight:800;color:var(--blue);text-decoration:none">${projIconHtml(p)} ${projEsc(p.nome)}</a><span style="font-size:11px;color:#dc2626;font-weight:800">${tarefas.length} atrasada(s)</span></div>${tarefas.slice(0,6).map(t => `<div class="proj-v9-alert-task"><span>${t._parentName ? `${projEsc(t._parentName)} / ` : ''}${projEsc(t.nome)}</span><span>${projEsc(t.responsavel||'')}</span><strong>${projFormatDate(t.dt_fim)}</strong></div>`).join('')}</div>`).join('') : '<div style="font-size:12px;color:var(--ink3)">Nenhum projeto com tarefas atrasadas nos filtros atuais.</div>'}</div>`);
  }

  const graficosEl = document.getElementById('proj-dash-graficos');
  if(graficosEl) {
    const inds = projIndicadoresLista(filtrados);
    const macrosSemProjeto = projUnlinkedValues(PROJ_MACROS, all, p => projDimensoesProjeto(p).macros);
    const objetivosSemProjeto = projUnlinkedValues(PROJ_OBJETIVOS, all, p => projDimensoesProjeto(p).objetivos);
    const indResumo = inds.slice(0,8).map(({p,ind}) => `<div class="proj-v9-mini-ind"><div><strong>${projEsc(ind.nome||'Indicador')}</strong><div style="font-size:11px;color:var(--ink3)">${projEsc(p.nome)}</div></div><div>${projEsc(projIndicadorResumo(ind))}</div></div>`).join('');
    projSetSafeHtml(graficosEl, `<div class="proj-v9-chart-card"><div class="proj-card-t">Resumo de Indicadores</div><div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px"><div><strong>${filtrados.length}</strong><span> Projetos</span></div><div><strong>${Math.round(filtrados.reduce((a,p)=>a+(p.percentual||0),0)/(filtrados.length||1))}%</strong><span> Média</span></div><div><strong>${inds.length}</strong><span> Indicadores</span></div><div><strong>${filtrados.filter(p=>projTarefasAtrasadasProjeto(p).length).length}</strong><span> Com atraso</span></div></div>${indResumo ? `<div class="proj-v9-mini-list">${indResumo}</div>` : '<div style="font-size:12px;color:var(--ink3);margin-top:.7rem">Nenhum indicador cadastrado nos filtros atuais.</div>'}</div><div class="proj-v9-chart-grid">${projChartBars('Projetos por Macroprocesso', projGroupCountWithProjects(filtrados, p => projDimensoesProjeto(p).macros), {unlinkedLabel:'Ver Macroprocessos sem Projeto vinculado', unlinkedItems:macrosSemProjeto, unlinkedKey:'macroprocessos-sem-projeto'})}${projChartBars('Projetos por Objetivo Estratégico', projGroupCountWithProjects(filtrados, p => projDimensoesProjeto(p).objetivos), {unlinkedLabel:'Ver Objetivos Estratégicos sem Projeto vinculado', unlinkedItems:objetivosSemProjeto, unlinkedKey:'objetivos-sem-projeto'})}${projChartBars('Projetos por Patrocinador', projGroupCountWithProjects(filtrados, p => projDimensoesProjeto(p).patrocinador))}${projChartBars('Projetos por Indicadores', projIndicadoresDashItems(inds))}</div>`);
  }
}

function projRenderIndicadoresPage() {
  projLoad();
  const el = document.getElementById('proj-indicadores-content');
  if(!el) return;
  const projetos = (PROJETOS||[]).filter(p => p.status === 'ativo');
  const fProj = document.getElementById('proj-ind-filter-proj')?.value || '';
  const fArea = document.getElementById('proj-ind-filter-area')?.value || '';
  let rows = projIndicadoresLista(projetos);
  if(fProj) rows = rows.filter(r => String(r.p.id) === fProj);
  if(fArea) rows = rows.filter(r => projDimensoesProjeto(r.p).macros.includes(fArea));
  const projetosOpts = projetos.map(p => `<option value="${projEsc(String(p.id))}" ${String(p.id)===fProj?'selected':''}>${projEsc(p.nome)}</option>`).join('');
  const macroOpts = projOptionsFromProjetos(projetos, p => projDimensoesProjeto(p).macros).map(v => `<option value="${projEsc(v)}" ${v===fArea?'selected':''}>${projEsc(v)}</option>`).join('');
  const chart = projIndicadoresMetaChart(rows);
  const table = rows.length ? `<table class="proj-v9-table"><thead><tr><th>Projeto</th><th>Indicador</th><th>Meta</th><th>Resultado</th><th>Unidade</th><th></th></tr></thead><tbody>${rows.map(r => `<tr><td>${projEsc(r.p.nome)}</td><td><input class="proj-fi" value="${projEsc(r.ind.nome||'')}" onchange="projUpdateIndicadorGlobal('${projEsc(String(r.p.id))}',${r.idx},'nome',this.value)"></td><td><input class="proj-fi" type="number" step="0.01" value="${projEsc(r.ind.meta||'')}" onchange="projUpdateIndicadorGlobal('${projEsc(String(r.p.id))}',${r.idx},'meta',this.value)"></td><td><input class="proj-fi" type="number" step="0.01" value="${projEsc(r.ind.resultado ?? r.ind.atual ?? '')}" onchange="projUpdateIndicadorGlobal('${projEsc(String(r.p.id))}',${r.idx},'resultado',this.value)"></td><td><input class="proj-fi" value="${projEsc(r.ind.unidade||'')}" onchange="projUpdateIndicadorGlobal('${projEsc(String(r.p.id))}',${r.idx},'unidade',this.value)"></td><td><button type="button" class="proj-btn danger" style="font-size:11px;padding:4px 8px" onclick="projRemoveIndicadorGlobal('${projEsc(String(r.p.id))}',${r.idx})">Remover</button></td></tr>`).join('')}</tbody></table>` : '<div class="proj-v9-chart-card" style="font-size:12px;color:var(--ink3)">Nenhum indicador encontrado para os filtros atuais.</div>';
  projSetSafeHtml(el, `<div class="proj-v9-filter-card"><div class="proj-card-t">Filtros e edição</div><div class="proj-v9-filter-grid"><div class="proj-fg" style="margin:0"><label class="proj-fl">Projeto</label><select class="proj-fi" id="proj-ind-filter-proj" onchange="projRenderIndicadoresPage()"><option value="">Todos</option>${projetosOpts}</select></div><div class="proj-fg" style="margin:0"><label class="proj-fl">Macroprocesso</label><select class="proj-fi" id="proj-ind-filter-area" onchange="projRenderIndicadoresPage()"><option value="">Todos</option>${macroOpts}</select></div><div class="proj-fg" style="margin:0"><label class="proj-fl">Adicionar em projeto</label><select class="proj-fi" id="proj-ind-add-proj"><option value="">Selecione</option>${projetosOpts}</select></div><div style="display:flex;align-items:end"><button type="button" class="proj-btn primary" onclick="projAddIndicadorProjetoGlobal()">+ Indicador</button></div></div></div><div class="proj-v9-bi-grid"><div>${chart}</div><div class="proj-v9-chart-card"><div class="proj-card-t">Indicadores cadastrados</div>${table}</div></div>`);
}

function projUpdateIndicadorGlobal(projId, idx, field, value) {
  projLoad();
  const p = PROJETOS.find(x => String(x.id) === String(projId));
  if(!p) return;
  if(!p.execucao) p.execucao = {};
  if(!p.execucao.indicadores) p.execucao.indicadores = [];
  if(!p.execucao.indicadores[idx]) return;
  p.execucao.indicadores[idx][field] = value;
  if(field === 'resultado') p.execucao.indicadores[idx].atual = value;
  projSave();
  projRenderIndicadoresPage();
}

function projAddIndicador() {
  projLoad();
  const proj = PROJETOS.find(p => String(p.id) === _projCurrentId);
  if(!proj) return;
  if(!proj.execucao) proj.execucao = { planner_link:'', percentual:0, reunioes:[], tarefas:[] };
  if(!proj.execucao.indicadores) proj.execucao.indicadores = [];
  proj.execucao.indicadores.push({ nome:'Novo indicador', meta:'', resultado:'', atual:'', unidade:'%', status:'Em acompanhamento' });
  projSave();
  projDetalheTab('execucao', document.querySelector('#proj-detalhe-tabs .proj-tab:nth-child(4)'));
}

function projUpdateIndicador(idx, field, value) {
  projLoad();
  const proj = PROJETOS.find(p => String(p.id) === _projCurrentId);
  if(!proj?.execucao?.indicadores?.[idx]) return;
  const ind = proj.execucao.indicadores[idx];
  ind[field] = value;
  if(field === 'atual') ind.resultado = value;
  if(field === 'resultado') ind.atual = value;
  projSave();
}

function projAddIndicadorProjetoGlobal() {
  const projId = document.getElementById('proj-ind-add-proj')?.value;
  if(!projId) { projToast('Selecione um projeto para adicionar indicador.', '#d97706'); return; }
  projLoad();
  const p = PROJETOS.find(x => String(x.id) === String(projId));
  if(!p) return;
  if(!p.execucao) p.execucao = {};
  if(!p.execucao.indicadores) p.execucao.indicadores = [];
  p.execucao.indicadores.push({ nome:'Novo indicador', meta:100, resultado:0, atual:0, unidade:'%' });
  projSave();
  projRenderIndicadoresPage();
}

function projRemoveIndicadorGlobal(projId, idx) {
  projLoad();
  const p = PROJETOS.find(x => String(x.id) === String(projId));
  if(!p?.execucao?.indicadores) return;
  p.execucao.indicadores.splice(idx,1);
  projSave();
  projRenderIndicadoresPage();
}

function projConclusaoImagemEditorHtml(conc) {
  const urls = projConclusaoImagensToUrls(conc);
  const urlsText = urls.join('\n');
  const preview = urls.length
    ? `<div class="proj-v9-attach-grid">${urls.map((url,i)=>`<div><img src="${projEsc(url)}" alt="${projEsc(projConclusaoImagemNome(url,i))}"><button type="button" class="proj-btn danger" style="font-size:10px;padding:2px 6px;margin-top:3px;width:100%" onclick="projRemoveConclusaoImagem(${i})">Remover</button></div>`).join('')}</div>`
    : '<div style="font-size:11px;color:var(--ink3);margin-top:4px">Nenhuma URL de imagem informada.</div>';
  return `<div class="proj-form-section" style="background:#fff;margin-top:1rem"><div class="proj-form-section-title">URLs de Imagens do Memorial</div><div class="proj-fg"><label class="proj-fl">URL da imagem <span style="font-size:10px;color:var(--ink3)">(uma por linha)</span></label><textarea class="proj-fi" id="conc-imagens-urls" rows="3" placeholder="https://.../imagem.jpg">${projEsc(urlsText)}</textarea>${preview}</div></div>`;
}

function projTabConclusao(p) {
  const conc = p.conclusao || {};
  const selectedSuccess = conc.tipo === 'sucesso';
  const selectedCancel = conc.tipo === 'cancelamento';
  return `<div class="proj-form-section"><div class="proj-form-section-title">Fase 5: Conclusão</div><div class="proj-ib proj-ib-blue">Registre o encerramento oficial, o Memorial do Projeto, as notícias e os aprendizados.</div><div class="proj-fg"><label class="proj-fl">Tipo de Conclusão<span>*</span></label><div class="proj-conclusao-tipo"><div class="proj-conclusao-card ${selectedSuccess?'selected-success':''}" onclick="projSelecionarTipoConclusao('sucesso')"><div class="proj-conclusao-icon">OK</div><div class="proj-conclusao-label">Conclusão com Sucesso</div><div class="proj-conclusao-desc">Projeto entregue conforme planejado</div></div><div class="proj-conclusao-card ${selectedCancel?'selected-cancel':''}" onclick="projSelecionarTipoConclusao('cancelamento')"><div class="proj-conclusao-icon">X</div><div class="proj-conclusao-label">Cancelamento</div><div class="proj-conclusao-desc">Projeto encerrado sem conclusão das entregas</div></div></div></div><div class="proj-g2"><div class="proj-fg"><label class="proj-fl">Data de Conclusão/Cancelamento</label><input type="date" class="proj-fi" id="conc-data" value="${projEsc(conc.dt_conclusao||'')}"></div><div class="proj-fg"><label class="proj-fl">Link para o Termo de Aceite</label><input type="url" class="proj-fi" id="conc-termo" value="${projEsc(conc.link_termo_aceite||'')}" placeholder="https://..."></div></div><div class="proj-fg"><label class="proj-fl">História do Projeto</label><textarea class="proj-fi" id="conc-historia" rows="5" placeholder="Conte a história e trajetória do projeto, principais marcos, aprendizados...">${projEsc(conc.historia||'')}</textarea></div><div class="proj-fg"><label class="proj-fl">Links de Notícias / Resultados <span style="font-size:10px;color:var(--ink3)">(um por linha)</span></label><textarea class="proj-fi" id="conc-links" rows="3" placeholder="https://noticia1.gov.br&#10;https://noticia2.gov.br">${projEsc(conc.links_noticias||'')}</textarea></div>${projConclusaoImagemEditorHtml(conc)}<div class="proj-form-section" style="background:#f8fbff;margin-top:1rem"><div class="proj-form-section-title">Reunião de Lições Aprendidas</div><div class="proj-g2"><div class="proj-fg"><label class="proj-fl">Data da reunião</label><input type="date" class="proj-fi" id="conc-lic-data" value="${projEsc(conc.licoes_data||'')}"></div><div class="proj-fg"><label class="proj-fl">Participantes</label><input type="text" class="proj-fi" id="conc-lic-part" value="${projEsc(conc.licoes_participantes||'')}" placeholder="Nomes dos participantes"></div></div><div class="proj-g3"><div class="proj-fg"><label class="proj-fl">O que deu certo?</label><textarea class="proj-fi" id="conc-lic-certo" rows="4">${projEsc(conc.licoes_certo||'')}</textarea></div><div class="proj-fg"><label class="proj-fl">O que pode melhorar?</label><textarea class="proj-fi" id="conc-lic-melhorar" rows="4">${projEsc(conc.licoes_melhorar||'')}</textarea></div><div class="proj-fg"><label class="proj-fl">Sugestões / ideias</label><textarea class="proj-fi" id="conc-lic-ideias" rows="4">${projEsc(conc.licoes_ideias||'')}</textarea></div></div></div><div class="proj-btn-row"><button type="button" class="proj-btn teal" onclick="projSalvarConclusao()">Salvar</button>${p.status !== 'concluido' && p.status !== 'cancelado' ? `<button type="button" class="proj-btn primary" onclick="projFinalizarProjeto()">Encerrar Projeto</button>` : `<div style="font-size:12.5px;color:var(--teal);font-weight:600;align-self:center">Projeto encerrado</div>`}</div></div>`;
}

function projBuildStatusReportHTMLLegacy() {
  progLoad();
  const ativos = PROJETOS.filter(p => p.status === 'ativo');
  const data = new Date().toLocaleDateString('pt-BR');
  const orgLabel = projEsc(ORG_CONFIG.reportHeaderLabel);
  const grupos = {};
  ativos.forEach(p => { const g = projProgramaNome(p); if(!grupos[g]) grupos[g] = []; grupos[g].push(p); });
  const media = ativos.length ? Math.round(ativos.reduce((a,p)=>a+(p.percentual||0),0)/ativos.length) : 0;
  const groupsHtml = Object.entries(grupos).map(([prog,items]) => `<h2 class="sr-program">${projEsc(prog)}</h2>${items.map(p => { const pct = Math.max(0,Math.min(100,p.percentual||0)); const obs = projEsc(p.status_report_obs||'Sem sumário executivo registrado.').replace(/\n/g,'<br>'); return `<section class="sr-card"><div class="sr-card-main"><div class="sr-title-row"><div><h3>${projEsc(p.nome)}</h3><div class="sr-sub">Projeto em andamento · ${projEsc(projFaseText(p))}</div></div><div class="sr-pct">${pct}%</div></div><div class="sr-progress"><div style="width:${pct}%"></div></div><div class="sr-info"><div><span>Patrocinador</span>${projEsc(p.patrocinador||'Não informado')}</div><div><span>Gerente</span>${projEsc(p.gerente||'Não informado')}</div><div><span>Gerente substituto</span>${projEsc(p.gerente_substituto||'Não informado')}</div><div><span>% de conclusão</span>${pct}%</div></div></div><aside class="sr-note"><span>Sumário Executivo</span><p>${obs}</p></aside></section>`; }).join('')}`).join('');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Status Report Executivo</title><style>@page{size:A4;margin:13mm}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#172033;margin:0;background:#fff}.sr-cover{display:flex;align-items:center;justify-content:space-between;gap:22px;padding:18px 20px;margin-bottom:18px;border:1px solid #d8e6f5;border-left:8px solid var(--blue);background:linear-gradient(90deg,#f5fbff,#fff)}.sr-logo{width:168px;max-height:62px;object-fit:contain}.sr-kicker{font-size:10px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--blue)}.sr-cover h1{margin:4px 0;font-size:27px;color:#0f2746}.sr-date{font-size:12px;color:#5f6b80}.sr-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px}.sr-chip{border:1px solid #d9e5f5;border-radius:8px;padding:9px 12px;font-size:12px;background:#f8fbff}.sr-chip strong{font-size:20px;color:var(--blue);display:block}.sr-program{font-size:16px;color:var(--blue);border-bottom:2px solid var(--teal);padding-bottom:5px;margin:18px 0 10px}.sr-card{display:grid;grid-template-columns:1.45fr .9fr;gap:14px;border:1px solid #d9e2ef;border-radius:10px;padding:14px;margin-bottom:12px;break-inside:avoid;background:#fff}.sr-title-row{display:flex;align-items:flex-start;gap:10px}.sr-title-row>div:first-child{flex:1}h3{font-size:15px;margin:0;color:#0f2746}.sr-sub{font-size:10.5px;color:#6b7588;margin-top:2px}.sr-pct{font-size:26px;font-weight:800;color:#00a89a}.sr-progress{height:7px;border-radius:99px;background:#e7edf5;overflow:hidden;margin:12px 0}.sr-progress div{height:100%;background:linear-gradient(90deg,var(--blue),var(--teal))}.sr-info{display:grid;grid-template-columns:1fr 1fr;gap:8px}.sr-info div{font-size:12px;border-top:1px solid #edf2f7;padding-top:6px}.sr-info span,.sr-note span{display:block;font-size:9px;color:var(--blue);font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:2px}.sr-note{border-left:3px solid #f59e0b;padding-left:12px}.sr-note p{font-size:12px;line-height:1.45;margin:0;color:#334155}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body><header class="sr-cover"><div><div class="sr-kicker">${orgLabel}</div><h1>Status Report Executivo</h1><div class="sr-date">Emitido em ${data}</div></div><img class="sr-logo" src="${PROJ_CAGE_REPORT_LOGO}" alt="CAGE"></header><div class="sr-summary"><div class="sr-chip"><strong>${ativos.length}</strong>Projetos em andamento</div><div class="sr-chip"><strong>${media}%</strong>Média de conclusão</div><div class="sr-chip"><strong>${Object.keys(grupos).length}</strong>Programas</div></div>${groupsHtml||'<div>Nenhum projeto em andamento encontrado.</div>'}<script>setTimeout(function(){window.print();},450);<\/script></body></html>`;
}

// ── V10: Estratégia como fonte oficial ───────────────────────────
function projBuildStatusReportHTMLV10(){
  progLoad();
  const ativos = PROJETOS.filter(p => p.status === 'ativo');
  const data = new Date().toLocaleDateString('pt-BR');
  const grupos = {};
  ativos.forEach(p => { const g = projProgramaNome(p); if(!grupos[g]) grupos[g] = []; grupos[g].push(p); });
  const media = ativos.length ? Math.round(ativos.reduce((a,p)=>a+(Number(p.percentual ?? p.execucao?.percentual ?? 0)),0)/ativos.length) : 0;
  const reportLogo = new URL(PROJ_CAGE_REPORT_LOGO, window.location.href).href;
  const orgLabel = projEsc(ORG_CONFIG.reportHeaderLabel);
  const publicUrl = projEsc(ORG_CONFIG.publicUrl);
  const indicadorRows = projIndicadoresLista(ativos);
  const indicadoresHtml = indicadorRows.length ? `<section class="sr-indicators"><h2>Indicadores cadastrados</h2><table><thead><tr><th>Projeto</th><th>Indicador</th><th>Resultado / Meta</th><th>Atingimento</th></tr></thead><tbody>${indicadorRows.map(({p, ind}) => { const meta = projIndicadorValor(ind,'meta'); const atual = projIndicadorValor(ind,'resultado'); const pct = meta ? (atual / meta) * 100 : 0; return `<tr><td>${projEsc(p.nome||'')}</td><td>${projEsc(ind.nome||'Indicador')}</td><td>${projEsc(atual)} / ${projEsc(meta)}</td><td>${projPctFmt(pct)}</td></tr>`; }).join('')}</tbody></table></section>` : '<section class="sr-indicators"><h2>Indicadores cadastrados</h2><p>Nenhum indicador cadastrado nos projetos em andamento.</p></section>';
  const groupsHtml = Object.entries(grupos).map(([prog,items]) => `<h2 class="sr-program">${projEsc(prog)}</h2>${items.map(p => { const pct = Math.max(0,Math.min(100,Number(p.percentual ?? p.execucao?.percentual ?? 0))); const obs = projEsc(p.status_report_obs||'Sem sumário executivo registrado.').replace(/\n/g,'<br>'); return `<section class="sr-card"><div class="sr-card-main"><div class="sr-title-row"><div><h3>${projEsc(p.nome)}</h3><div class="sr-sub">Projeto em andamento · ${projEsc(projFaseText(p))}</div></div><div class="sr-pct">${pct}%</div></div><div class="sr-progress"><div style="width:${pct}%"></div></div><div class="sr-info"><div><span>Patrocinador</span>${projEsc(p.patrocinador||'Não informado')}</div><div><span>Gerente</span>${projEsc(p.gerente||'Não informado')}</div><div><span>Gerente substituto</span>${projEsc(p.gerente_substituto||'Não informado')}</div><div><span>% de conclusão</span>${pct}%</div></div></div><aside class="sr-note"><span>Sumário Executivo</span><p>${obs}</p></aside></section>`; }).join('')}`).join('');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Status Report Executivo</title><style>:root{--blue:#005a9c;--teal:#00bfb3;--ink:#172033;--muted:#5f6b80}@page{size:A4;margin:13mm}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:var(--ink);margin:0;background:#fff}.sr-cover{display:flex;align-items:center;justify-content:space-between;gap:22px;padding:18px 20px;margin-bottom:18px;border:1px solid #d8e6f5;border-left:8px solid var(--blue);background:linear-gradient(90deg,#f5fbff,#fff)}.sr-logo{width:185px;max-height:72px;object-fit:contain}.sr-kicker{font-size:10px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--blue)}.sr-cover h1{margin:4px 0;font-size:27px;color:#0f2746}.sr-date{font-size:12px;color:var(--muted)}.sr-intro{border:1px solid #d9e5f5;border-radius:10px;background:#f8fbff;padding:12px 14px;margin-bottom:16px;font-size:12px;line-height:1.5;color:#334155}.sr-intro a{color:var(--blue);font-weight:700;text-decoration:none}.sr-program{font-size:16px;color:var(--blue);border-bottom:2px solid var(--teal);padding-bottom:5px;margin:18px 0 10px}.sr-card{display:grid;grid-template-columns:1.45fr .9fr;gap:14px;border:1px solid #d9e2ef;border-radius:10px;padding:14px;margin-bottom:12px;break-inside:avoid;background:#fff}.sr-title-row{display:flex;align-items:flex-start;gap:10px}.sr-title-row>div:first-child{flex:1}h3{font-size:15px;margin:0;color:#0f2746}.sr-sub{font-size:10.5px;color:#6b7588;margin-top:2px}.sr-pct{font-size:26px;font-weight:800;color:var(--teal)}.sr-progress{height:8px;border-radius:99px;background:#e7edf5;overflow:hidden;margin:12px 0}.sr-progress div{height:100%;min-width:2px;background:linear-gradient(90deg,var(--blue),var(--teal))}.sr-info{display:grid;grid-template-columns:1fr 1fr;gap:8px}.sr-info div{font-size:12px;border-top:1px solid #edf2f7;padding-top:6px}.sr-info span,.sr-note span{display:block;font-size:9px;color:var(--blue);font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:2px}.sr-note{border-left:3px solid #f59e0b;padding-left:12px}.sr-note p{font-size:12px;line-height:1.45;margin:0;color:#334155}.sr-indicators{margin-top:20px;break-inside:avoid}.sr-indicators h2{font-size:16px;color:var(--blue);border-bottom:2px solid var(--teal);padding-bottom:5px}.sr-indicators table{width:100%;border-collapse:collapse;font-size:11px}.sr-indicators th{background:#0f2746;color:#fff;text-align:left;padding:7px}.sr-indicators td{border-bottom:1px solid #d9e2ef;padding:7px}.sr-indicators tr:nth-child(even) td{background:#f8fbff}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body><header class="sr-cover"><div><div class="sr-kicker">${orgLabel}</div><h1>Status Report Executivo</h1><div class="sr-date">Emitido em ${data}</div></div><img class="sr-logo" src="${reportLogo}" alt="CAGE"></header><section class="sr-intro">Este relatório foi gerado a partir dos dados do ${projEsc(ORG_CONFIG.systemFullName)}, módulo de Projetos. Acesse o SIGA em <a href="${publicUrl}">${publicUrl}</a>.</section><div class="sr-summary"><div class="sr-chip"><strong>${ativos.length}</strong>Projetos em andamento</div><div class="sr-chip"><strong>${media}%</strong>Média de conclusão</div></div>${groupsHtml||'<div>Nenhum projeto em andamento encontrado.</div>'}${indicadoresHtml}<script>setTimeout(function(){window.print();},450);<\/script></body></html>`;
}

function projBuildStatusReportHTML(){
  progLoad();
  const ativos = PROJETOS.filter(p => p.status === 'ativo');
  const concluidos = PROJETOS.filter(p => p.status === 'concluido');
  const data = new Date().toLocaleDateString('pt-BR');
  const ref = projRelatorioExecutivoRef();
  const media = ativos.length ? Math.round(ativos.reduce((a,p)=>a+(Number(p.percentual ?? p.execucao?.percentual ?? 0)),0)/ativos.length) : 0;
  const reportLogo = new URL(PROJ_CAGE_REPORT_LOGO, window.location.href).href;
  const eppLogo = new URL('epp-logo.png', window.location.href).href;
  const grupos = {};
  ativos.forEach(p => { const g = projProgramaNome(p); if(!grupos[g]) grupos[g] = []; grupos[g].push(p); });
  const projectBars = ativos.slice().sort((a,b)=>Number(b.percentual ?? b.execucao?.percentual ?? 0)-Number(a.percentual ?? a.execucao?.percentual ?? 0)).map(p => { const pct=Math.max(0,Math.min(100,Number(p.percentual ?? p.execucao?.percentual ?? 0))); return `<div class="sr-mini-row"><span>${projEsc(p.nome)}</span><div><i style="width:${pct}%"></i></div><strong>${pct}%</strong><em>${projEsc(p.gerente||'Gerente n\u00e3o informado')}</em></div>`; }).join('');
  const completedList = concluidos.length ? `<ul class="sr-completed-list">${concluidos.map(p => `<li><strong>${projEsc(p.nome)}</strong></li>`).join('')}</ul>` : '<p>Nenhum projeto conclu\u00eddo registrado.</p>';
  const totalProjetos = ativos.length + concluidos.length;
  const concluidoPct = totalProjetos ? Math.round((concluidos.length / totalProjetos) * 100) : 0;
  const execHtml = `<section class="sr-exec"><div class="sr-exec-head"><div><span>Resumo Gr\u00e1fico</span><h2>Vis\u00e3o imediata do portf\u00f3lio</h2></div></div><div class="sr-ring-row"><div class="sr-ring-card"><div class="sr-ring sr-ring-projects" style="--done:${concluidoPct};--active:${100-concluidoPct}"><strong>${totalProjetos}</strong><small>Projetos</small></div><div class="sr-ring-legend"><span><i class="blue"></i>${ativos.length} em andamento</span><span><i class="green"></i>${concluidos.length} conclu\u00eddos</span></div></div><div class="sr-ring-card"><div class="sr-ring sr-ring-average" style="--pct:${media}"><strong>${media}%</strong><small>M\u00e9dia de<br>conclus\u00e3o</small></div></div><div class="sr-ring-logo"><img src="${eppLogo}" alt="Escrit\u00f3rio de Projetos e Processos"></div></div><div class="sr-exec-grid"><div class="sr-exec-panel sr-exec-panel-wide"><h3>Projetos por conclus\u00e3o</h3>${projectBars || '<p>Nenhum projeto em andamento.</p>'}</div><div class="sr-exec-panel"><h3>Projetos conclu\u00eddos</h3>${completedList}</div></div></section>`;
  const projectIndicators = p => {
    const inds = p.execucao?.indicadores || [];
    if(!inds.length) return '';
    return `<div class="sr-project-indicators"><span>Indicadores</span>${inds.map(ind => {
      const meta = projIndicadorValor(ind,'meta');
      const atual = projIndicadorValor(ind,'resultado');
      const pct = meta ? (atual / meta) * 100 : 0;
      return `<div><strong>${projEsc(ind.nome||'Indicador')}</strong><em>${projEsc(atual)} / ${projEsc(meta)} · ${projPctFmt(pct)}</em></div>`;
    }).join('')}</div>`;
  };
  const projectOverdue = p => {
    const tarefas = projTarefasAtrasadasProjeto(p);
    if(!tarefas.length) return '';
    return `<div class="sr-project-overdue"><span>Tarefas atrasadas</span>${tarefas.slice(0,6).map(t => `<div><strong>${t._parentName ? `${projEsc(t._parentName)} / ` : ''}${projEsc(t.nome)}</strong><em>${projFormatDate(t.dt_fim)}</em></div>`).join('')}${tarefas.length>6?`<small>+${tarefas.length-6} tarefa(s) atrasada(s)</small>`:''}</div>`;
  };
  const groupsHtml = Object.entries(grupos).map(([prog,items]) => `<section class="sr-program-block"><h2 class="sr-program">${projEsc(prog)}</h2>${items.map(p => { const pct = Math.max(0,Math.min(100,Number(p.percentual ?? p.execucao?.percentual ?? 0))); const obs = projEsc(p.status_report_obs||'Sem sumário executivo registrado.').replace(/\n/g,'<br>'); return `<section class="sr-card"><div class="sr-card-main"><div class="sr-title-row"><div><h3>${projEsc(p.nome)}</h3><div class="sr-sub">Projeto em andamento · ${projEsc(projFaseText(p))}</div></div><div class="sr-pct">${pct}%</div></div><div class="sr-progress"><div style="width:${pct}%"></div></div><div class="sr-info"><div><span>Patrocinador</span>${projEsc(p.patrocinador||'Não informado')}</div><div><span>Gerente</span>${projEsc(p.gerente||'Não informado')}</div><div><span>Gerente substituto</span>${projEsc(p.gerente_substituto||'Não informado')}</div><div><span>% de conclusão</span>${pct}%</div></div>${projectIndicators(p)}${projectOverdue(p)}</div><aside class="sr-note"><span>Sumário Executivo</span><p>${obs}</p></aside></section>`; }).join('')}</section>`).join('');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Relatório Executivo de Projetos</title><style>:root{--blue:#005a9c;--teal:#00bfb3;--ink:#172033;--muted:#5f6b80}@page{size:A4;margin:13mm}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:var(--ink);margin:0;background:#fff}.sr-page{background:#fff}.sr-cover{display:flex;align-items:center;justify-content:space-between;gap:22px;padding:18px 20px;margin-bottom:18px;border:1px solid #d8e6f5;border-left:8px solid var(--blue);background:linear-gradient(90deg,#f5fbff,#fff)}.sr-logo{width:185px;max-height:72px;object-fit:contain}.sr-kicker{font-size:10px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--blue)}.sr-cover h1{margin:4px 0;font-size:27px;color:#0f2746}.sr-meta{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.sr-date{font-size:12px;color:var(--muted)}.sr-ref{font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--blue);border:1px solid #cfe0f4;background:#f8fbff;border-radius:999px;padding:3px 9px}.sr-summary{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:16px}.sr-chip{border:1px solid #d9e5f5;border-radius:8px;padding:9px 12px;font-size:12px;background:#f8fbff}.sr-chip strong{font-size:20px;color:var(--blue);display:block}.sr-intro{border:1px solid #d9e5f5;border-radius:10px;background:#f8fbff;padding:12px 14px;margin-bottom:16px;font-size:12px;line-height:1.5;color:#334155}.sr-exec{border:1px solid #d9e5f5;border-radius:14px;padding:16px;margin:0 0 18px;background:linear-gradient(135deg,#f8fbff,#fff)}.sr-exec-head{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-bottom:12px}.sr-exec-head span{font-size:9px;text-transform:uppercase;letter-spacing:.14em;color:var(--teal);font-weight:800}.sr-exec-head h2{font-size:18px;margin:3px 0 0;color:#0f2746}.sr-ring-row{display:flex;align-items:center;gap:18px;margin:0 0 14px}.sr-ring-card{display:flex;align-items:center;gap:10px}.sr-ring{width:112px;height:112px;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;position:relative;flex:none}.sr-ring-average{background:conic-gradient(var(--teal) calc(var(--pct)*1%),#e7edf5 0)}.sr-ring-projects{background:conic-gradient(#00a89a calc(var(--done)*1%),#005a9c 0)}.sr-ring:before{content:'';position:absolute;inset:12px;border-radius:50%;background:#fff}.sr-ring strong,.sr-ring small{position:relative;z-index:1;line-height:1;text-align:center}.sr-ring strong{font-size:24px;color:var(--blue)}.sr-ring small{display:block;font-size:8.5px;color:var(--muted);text-transform:uppercase}.sr-ring-legend{font-size:10px;color:#334155;display:grid;gap:4px}.sr-ring-legend i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px}.sr-ring-legend .blue{background:#005a9c}.sr-ring-legend .green{background:#00a89a}.sr-ring-logo{margin-left:auto;min-width:180px;display:flex;align-items:center;justify-content:flex-end}.sr-ring-logo img{max-width:220px;max-height:86px;object-fit:contain}.sr-exec-grid{display:grid;grid-template-columns:1fr;gap:14px}.sr-exec-panel{border:1px solid #edf2f7;border-radius:10px;background:#fff;padding:12px}.sr-exec-panel h3{font-size:12px;margin:0 0 10px;color:#0f2746;text-transform:uppercase;letter-spacing:.06em}.sr-mini-row{display:grid;grid-template-columns:minmax(240px,1.25fr) 1.1fr 42px minmax(120px,.75fr);gap:8px;align-items:center;font-size:10.5px;margin:7px 0}.sr-completed-list{margin:0;padding:0;list-style:none;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 14px}.sr-completed-list li{border-bottom:1px solid #edf2f7;padding:6px 0;font-size:10.5px}.sr-completed-list strong{display:block;color:#0f2746}.sr-mini-row span{color:#334155;white-space:normal;overflow:visible;text-overflow:clip}.sr-mini-row div{height:8px;border-radius:99px;background:#e7edf5;overflow:hidden}.sr-mini-row i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,var(--blue),var(--teal))}.sr-mini-row strong{font-size:10.5px;color:var(--blue);text-align:right}.sr-mini-row em{font-style:normal;color:#5f6b80;font-size:9.8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.sr-top-list{margin:12px 0 0;padding:0;list-style:none;border-top:1px solid #edf2f7}.sr-top-list li{display:flex;justify-content:space-between;gap:8px;font-size:10.5px;padding:6px 0;border-bottom:1px solid #edf2f7}.sr-top-list span{color:#0b8f84;font-weight:800}.sr-program-block{margin-top:34px}.sr-program{font-size:16px;color:var(--blue);border-bottom:2px solid var(--teal);padding-bottom:5px;margin:0 0 12px}.sr-card{display:grid;grid-template-columns:.95fr 1.25fr;gap:16px;border:1px solid #d9e2ef;border-radius:10px;padding:14px;margin-bottom:12px;break-inside:avoid;background:#fff}.sr-title-row{display:flex;align-items:flex-start;gap:10px}.sr-title-row>div:first-child{flex:1}h3{font-size:15px;margin:0;color:#0f2746}.sr-sub{font-size:10.5px;color:#6b7588;margin-top:2px}.sr-pct{font-size:26px;font-weight:800;color:var(--teal)}.sr-progress{height:8px;border-radius:99px;background:#e7edf5;overflow:hidden;margin:12px 0}.sr-progress div{height:100%;min-width:2px;background:linear-gradient(90deg,var(--blue),var(--teal))}.sr-info{display:grid;grid-template-columns:1fr 1fr;gap:8px}.sr-info div{font-size:12px;border-top:1px solid #edf2f7;padding-top:6px}.sr-info span,.sr-note span,.sr-project-indicators>span,.sr-project-overdue>span{display:block;font-size:9px;color:var(--blue);font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:2px}.sr-project-indicators,.sr-project-overdue{margin-top:10px;border-top:1px solid #edf2f7;padding-top:7px}.sr-project-indicators div,.sr-project-overdue div{display:flex;justify-content:space-between;gap:8px;font-size:11px;padding:3px 0}.sr-project-indicators em{font-style:normal;color:#0b8f84;font-weight:700}.sr-project-overdue{background:#fffaf2;border:1px solid #fde2b5;border-radius:8px;padding:7px 8px}.sr-project-overdue em{font-style:normal;color:#b45309;font-weight:700;white-space:nowrap}.sr-project-overdue small{display:block;color:#b45309;font-size:10px;margin-top:3px}.sr-note{border-left:3px solid #f59e0b;padding-left:12px}.sr-note p{font-size:12px;line-height:1.45;margin:0;color:#334155}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body><div class="sr-page"><header class="sr-cover"><div><div class="sr-kicker">CAGE-RS · Escritório de Projetos e Processos</div><h1>Relatório Executivo de Projetos</h1><div class="sr-meta"><span class="sr-date">Emitido em ${data}</span><span class="sr-ref">ref. ${ref}</span></div></div><img class="sr-logo" src="${reportLogo}" alt="CAGE"></header><section class="sr-intro">Este relatório foi gerado a partir dos dados do Sistema Integrado de Gestão Estratégica (SIGA), módulo de Projetos.</section>${execHtml}${groupsHtml||'<div>Nenhum projeto em andamento encontrado.</div>'}</div><script>setTimeout(function(){window.print();},450);<\/script></body></html>`;
}

function projStrategyBaseName(v) {
  return String(v||'').replace(/^\s*\[[^\]]+\]\s*/,'').trim();
}

function projNormalizeStrategyList(list) {
  const byBase = {};
  (list||[]).map(v => String(v||'').trim()).filter(Boolean).forEach(v => {
    const base = projStrategyBaseName(v).toLowerCase();
    if(!byBase[base]) byBase[base] = v;
    else if(/^\s*\[[^\]]+\]/.test(v) && !/^\s*\[[^\]]+\]/.test(byBase[base])) byBase[base] = v;
  });
  return Object.values(byBase).sort(projTextCompare);
}

function projNormalizeStrategyLists() {
  if(typeof projLoadListas === 'function') projLoadListas();
  const oldM = JSON.stringify(PROJ_MACROS||[]);
  const oldO = JSON.stringify(PROJ_OBJETIVOS||[]);
  if(Array.isArray(PROJETOS)) {
    PROJETOS.forEach(p => {
      projMultiValues(p.macroprocessos, p.macroprocesso).forEach(v => {
        if(/^\s*\[[^\]]+\]/.test(v) && !(PROJ_MACROS||[]).includes(v)) PROJ_MACROS.push(v);
      });
      projMultiValues(p.objetivos_estrategicos, p.ideacao?.objetivo_estrategico).forEach(v => {
        if(/^\s*\[[^\]]+\]/.test(v) && !(PROJ_OBJETIVOS||[]).includes(v)) PROJ_OBJETIVOS.push(v);
      });
    });
  }
  PROJ_MACROS = projNormalizeStrategyList(PROJ_MACROS);
  PROJ_OBJETIVOS = projNormalizeStrategyList(PROJ_OBJETIVOS);
  if(isEP() && (oldM !== JSON.stringify(PROJ_MACROS) || oldO !== JSON.stringify(PROJ_OBJETIVOS))) projSaveListas();
}

function projCanonicalStrategyValue(v, list) {
  const clean = String(v||'').trim();
  if(!clean) return '';
  if((list||[]).includes(clean)) return clean;
  const base = projStrategyBaseName(clean).toLowerCase();
  return (list||[]).find(x => projStrategyBaseName(x).toLowerCase() === base) || clean;
}

function projDimensoesProjeto(p) {
  projNormalizeStrategyLists();
  const objetivos = projMultiValues(p.objetivos_estrategicos, p.ideacao?.objetivo_estrategico)
    .map(v => projCanonicalStrategyValue(v, PROJ_OBJETIVOS)).filter(Boolean);
  const macros = projMultiValues(p.macroprocessos, p.macroprocesso)
    .map(v => projCanonicalStrategyValue(v, PROJ_MACROS)).filter(Boolean);
  return {
    patrocinador:p.patrocinador||'',
    objetivo:objetivos[0]||'',
    objetivos:[...new Set(objetivos)],
    macro:macros[0]||'',
    macros:[...new Set(macros)],
    divisao:p.divisao||''
  };
}

function projProjetosRelacionados(kind, value) {
  projLoad();
  return (PROJETOS||[]).filter(p => {
    const d = projDimensoesProjeto(p);
    return kind === 'macro' ? d.macros.includes(value) : d.objetivos.includes(value);
  });
}

function projStrategyRelatedHtml(kind, values) {
  return `<div class="proj-v10-related"><div class="proj-v10-related-title">Projetos relacionados</div>${
    values.length ? values.map(v => {
      const ps = projProjetosRelacionados(kind, v);
      return `<div class="proj-v10-related-group"><div class="proj-v10-related-name">${projEsc(v)} <span style="color:var(--ink3);font-weight:700">(${ps.length})</span></div>${ps.length ? ps.map(p => `<a href="#" class="proj-v10-chart-project" onclick="event.preventDefault();projAbrirDetalhe('${projEsc(String(p.id))}', true)">${projIconHtml(p)}<span>${projEsc(p.nome||'Projeto sem nome')}</span></a>`).join('') : '<div style="font-size:11px;color:var(--ink3)">-</div>'}</div>`;
    }).join('') : '<div style="font-size:12px;color:var(--ink3)">Nenhum item cadastrado.</div>'
  }</div>`;
}

function projStrategyParts(value) {
  const raw = String(value||'').trim();
  const m = raw.match(/^\[([^\]]+)\](.*)/);
  let group = m ? m[1] : 'Outros';
  let name = (m ? m[2].trim() : raw) || raw;
  if(group.toLowerCase() === 'finalístico') group = 'Finalísticos';
  return { group, name };
}

function projStrategyGroupMeta(kind, group) {
  const key = String(group||'Outros').toLowerCase();
  const objetivo = {
    resultados: {label:'Resultados para a Sociedade', order:1},
    'articulação': {label:'Articulação e Relacionamento', order:2},
    articulacao: {label:'Articulação e Relacionamento', order:2},
    processos: {label:'Processos Internos', order:3},
    aprendizado: {label:'Aprendizado e Crescimento', order:4}
  };
  const macro = {
    'gestão': {label:'Gestão', order:1},
    gestao: {label:'Gestão', order:1},
    'finalístico': {label:'Finalísticos', order:2},
    'finalísticos': {label:'Finalísticos', order:2},
    finalistico: {label:'Finalísticos', order:2},
    finalisticos: {label:'Finalísticos', order:2},
    apoio: {label:'Apoio', order:3}
  };
  const meta = (kind === 'macro' ? macro : objetivo)[key];
  return meta || {label:group || 'Outros', order:99};
}

function projStrategyProjectLinks(kind, value) {
  const ps = projProjetosRelacionados(kind, value);
  return ps.length ? ps.map(p => `<a href="#" class="proj-strategy-project" onclick="event.preventDefault();projAbrirDetalhe('${projEsc(String(p.id))}', true)">${projIconHtml(p)}<span>${projEsc(p.nome||'Projeto sem nome')}</span></a>`).join('') : '<div class="proj-strategy-empty">-</div>';
}

function projStrategyGroupIcon(kind, group) {
  const key = String(group||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const icons = {
    resultados:'<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="14" r="5"/><path d="M14 34c1.7-6 5.1-9 10-9s8.3 3 10 9"/><path d="M11 22c-3.2 1.8-5.2 5-6 9M37 22c3.2 1.8 5.2 5 6 9"/><circle cx="10" cy="18" r="3.8"/><circle cx="38" cy="18" r="3.8"/></svg>',
    articulacao:'<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="13" cy="24" r="6"/><circle cx="35" cy="14" r="6"/><circle cx="35" cy="34" r="6"/><path d="M18.4 21.6l11.2-5.1M18.4 26.4l11.2 5.1"/></svg>',
    processos:'<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="18" cy="19" r="6"/><circle cx="31" cy="31" r="6"/><path d="M18 9v4M18 25v4M8 19h4M24 19h4M27 24l-3-3M31 21v4M31 37v4M21 31h4M37 31h4"/></svg>',
    aprendizado:'<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M10 32c8-1 14-5.5 18-16"/><path d="M27 16h9v9"/><path d="M13 36h22"/><path d="M13 36V24M24 36V18M35 36V12"/></svg>',
    gestao:'<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="10" y="14" width="28" height="22" rx="4"/><path d="M18 14v-4h12v4M17 24h14M17 30h8"/></svg>',
    finalistico:'<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="15"/><circle cx="24" cy="24" r="8"/><circle cx="24" cy="24" r="2"/><path d="M35 13l4-4M39 9v8M39 9h-8"/></svg>',
    finalisticos:'<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="15"/><circle cx="24" cy="24" r="8"/><circle cx="24" cy="24" r="2"/><path d="M35 13l4-4M39 9v8M39 9h-8"/></svg>',
    apoio:'<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M14 28v-9a10 10 0 0120 0v9"/><path d="M11 28h8v8h-8zM29 28h8v8h-8z"/><path d="M19 36h10"/></svg>'
  };
  return icons[key] || '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 8l14 8v16l-14 8-14-8V16z"/><path d="M24 8v16l14 8M24 24L10 16"/></svg>';
}

function projStrategyVisual(kind, values, title, className) {
  const groups = {};
  (values||[]).forEach(v => {
    const parts = projStrategyParts(v);
    if(!groups[parts.group]) groups[parts.group] = [];
    groups[parts.group].push({ value:v, name:parts.name });
  });
  const groupsHtml = Object.entries(groups).sort(([a],[b]) => projStrategyGroupMeta(kind,a).order - projStrategyGroupMeta(kind,b).order).map(([group,items]) => {
    const meta = projStrategyGroupMeta(kind, group);
    return `<section class="proj-strategy-band"><div class="proj-strategy-side"><div class="proj-strategy-side-icon">${projStrategyGroupIcon(kind, group)}</div><div class="proj-strategy-band-title">${projEsc(meta.label)}</div></div><div class="proj-strategy-band-main"><div class="proj-strategy-band-head">${projEsc(meta.label)}</div><div class="proj-strategy-items">${items.map(item => `<article class="proj-strategy-node"><h4>${projEsc(item.name)}</h4><div class="proj-strategy-projects">${projStrategyProjectLinks(kind,item.value)}</div></article>`).join('')}</div></div></section>`;
  }).join('');
  return `<div class="proj-strategy-visual ${className||''}"><div class="proj-strategy-title">${projEsc(title)}</div>${groupsHtml || '<div style="font-size:12px;color:var(--ink3)">Nenhum item cadastrado.</div>'}</div>`;
}

function projToggleStrategyEditor(kind) {
  const panel = document.getElementById(`proj-strategy-editor-${kind}`);
  if(!panel) return;
  panel.classList.toggle('open');
}

function projRenderEstrategiaPageLegacy() {
  projLoad();
  projNormalizeStrategyLists();
  const el = document.getElementById('proj-estrategia-content');
  if(!el) return;
  projSetSafeHtml(el, `<div class="proj-v10-strategy-grid"><div class="proj-v9-chart-card"><div class="proj-card-t">Macroprocessos</div><div class="proj-ib proj-ib-blue" style="font-size:12px">Um item por linha. Se existir uma versão com prefixo entre colchetes e outra sem, a versão com colchetes é mantida.</div><textarea id="estrat-macros" class="proj-fi proj-v10-strategy-text">${projEsc((PROJ_MACROS||[]).join('\n'))}</textarea><div class="proj-btn-row"><button type="button" class="proj-btn primary" onclick="projSalvarEstrategia('macro')">Salvar Macroprocessos</button></div>${projStrategyRelatedHtml('macro', PROJ_MACROS||[])}</div><div class="proj-v9-chart-card"><div class="proj-card-t">Objetivos Estratégicos</div><div class="proj-ib proj-ib-blue" style="font-size:12px">Um item por linha. Estes dados alimentam o workflow e os gráficos do dashboard.</div><textarea id="estrat-objetivos" class="proj-fi proj-v10-strategy-text">${projEsc((PROJ_OBJETIVOS||[]).join('\n'))}</textarea><div class="proj-btn-row"><button type="button" class="proj-btn primary" onclick="projSalvarEstrategia('objetivo')">Salvar Objetivos Estratégicos</button></div>${projStrategyRelatedHtml('objetivo', PROJ_OBJETIVOS||[])}</div></div>`);
}

function projRenderEstrategiaPage() {
  projLoad();
  projNormalizeStrategyLists();
  const el = document.getElementById('proj-estrategia-content');
  if(!el) return;
  const editors = isEP() ? `<div class="proj-v10-strategy-grid"><div class="proj-v9-chart-card"><div class="proj-strategy-editor-head"><div class="proj-card-t">Editar Macroprocessos</div><button type="button" class="proj-btn" onclick="projToggleStrategyEditor('macro')">Abrir edição</button></div><div id="proj-strategy-editor-macro" class="proj-strategy-editor-body"><textarea id="estrat-macros" class="proj-fi proj-v10-strategy-text">${projEsc((PROJ_MACROS||[]).join('\n'))}</textarea><div class="proj-btn-row"><button type="button" class="proj-btn primary" onclick="projSalvarEstrategia('macro')">Salvar Macroprocessos</button></div></div></div><div class="proj-v9-chart-card"><div class="proj-strategy-editor-head"><div class="proj-card-t">Editar Objetivos Estratégicos</div><button type="button" class="proj-btn" onclick="projToggleStrategyEditor('objetivo')">Abrir edição</button></div><div id="proj-strategy-editor-objetivo" class="proj-strategy-editor-body"><textarea id="estrat-objetivos" class="proj-fi proj-v10-strategy-text">${projEsc((PROJ_OBJETIVOS||[]).join('\n'))}</textarea><div class="proj-btn-row"><button type="button" class="proj-btn primary" onclick="projSalvarEstrategia('objetivo')">Salvar Objetivos Estratégicos</button></div></div></div></div>` : '';
  projSetSafeHtml(el, `${projStrategyVisual('objetivo', PROJ_OBJETIVOS||[], 'Mapa Estratégico', 'objetivos')}${projStrategyVisual('macro', PROJ_MACROS||[], 'Cadeia de Valor', 'macros')}${editors}`);
}

function projSalvarEstrategia(kind) {
  if(!projEnsureWriteAll('Apenas EPP pode editar Macroprocessos e Objetivos Estratégicos.')) return;
  const id = kind === 'macro' ? 'estrat-macros' : 'estrat-objetivos';
  const lines = (document.getElementById(id)?.value||'').split(/\n+/).map(s => s.trim()).filter(Boolean);
  if(kind === 'macro') PROJ_MACROS = projNormalizeStrategyList(lines);
  else PROJ_OBJETIVOS = projNormalizeStrategyList(lines);
  projSaveListas();
  projToast('Estratégia atualizada.');
  projRenderEstrategiaPage();
}

function projPopulateVinculacoes() {
  projNormalizeStrategyLists();
  projLoad();
  let proj = PROJETOS.find(function(p){return String(p.id)===_projCurrentId;});
  if(!proj) return;
  let ml = document.getElementById('aprov-macro-list');
  if(ml) projSetSafeHtml(ml, (proj.macroprocessos||[]).map(function(m,i){let v=projCanonicalStrategyValue(m,PROJ_MACROS);return '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;padding:4px 8px;background:#f0f4ff;border-radius:6px;font-size:12px;color:#1a2540"><span style="flex:1">'+projEsc(v)+'</span><button type="button" style="background:none;border:none;cursor:pointer;color:#b91c1c;font-size:14px;padding:0 4px" onclick="projRemoverMacro('+i+')">✕</button></div>';}).join(''));
  let ms = document.getElementById('aprov-macro-sel');
  if(ms) projSetSafeHtml(ms, '<option value="">Selecione...</option>' + PROJ_MACROS.map(function(m){return '<option value="'+projEsc(m)+'">'+projEsc(m)+'</option>';}).join(''));
  let ol = document.getElementById('aprov-obj-list');
  if(ol) projSetSafeHtml(ol, (proj.objetivos_estrategicos||[]).map(function(o,i){let v=projCanonicalStrategyValue(o,PROJ_OBJETIVOS);return '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;padding:4px 8px;background:var(--teal-l);border-radius:6px;font-size:12px;color:#1a2540"><span style="flex:1">'+projEsc(v)+'</span><button type="button" style="background:none;border:none;cursor:pointer;color:#b91c1c;font-size:14px;padding:0 4px" onclick="projRemoverObj('+i+')">✕</button></div>';}).join(''));
  let os = document.getElementById('aprov-obj-sel');
  if(os) projSetSafeHtml(os, '<option value="">Selecione...</option>' + PROJ_OBJETIVOS.map(function(o){return '<option value="'+projEsc(o)+'">'+projEsc(o)+'</option>';}).join(''));
}

function projAddMacroNovo(){if(!projEnsureWriteAll('Apenas EPP pode editar Macroprocessos e Objetivos Estratégicos.'))return;let inp=document.getElementById('aprov-macro-novo');if(!inp||!inp.value.trim()){projToast('Digite o macroprocesso.','#d97706');return;}let v=inp.value.trim();PROJ_MACROS=projNormalizeStrategyList([].concat(PROJ_MACROS||[],[v]));projSaveListas();v=projCanonicalStrategyValue(v,PROJ_MACROS);projLoad();let p=PROJETOS.find(function(x){return String(x.id)===_projCurrentId;});if(!p)return;if(!p.macroprocessos)p.macroprocessos=[];if(!p.macroprocessos.includes(v))p.macroprocessos.push(v);projSave();inp.value='';projPopulateVinculacoes();}
function projAddObjNovo(){if(!projEnsureWriteAll('Apenas EPP pode editar Macroprocessos e Objetivos Estratégicos.'))return;let inp=document.getElementById('aprov-obj-novo');if(!inp||!inp.value.trim()){projToast('Digite o objetivo.','#d97706');return;}let v=inp.value.trim();PROJ_OBJETIVOS=projNormalizeStrategyList([].concat(PROJ_OBJETIVOS||[],[v]));projSaveListas();v=projCanonicalStrategyValue(v,PROJ_OBJETIVOS);projLoad();let p=PROJETOS.find(function(x){return String(x.id)===_projCurrentId;});if(!p)return;if(!p.objetivos_estrategicos)p.objetivos_estrategicos=[];if(!p.objetivos_estrategicos.includes(v))p.objetivos_estrategicos.push(v);projSave();inp.value='';projPopulateVinculacoes();}

function projNewsTitleFromUrl(url, i) {
  try {
    const u = new URL(url);
    const slug = decodeURIComponent((u.pathname.split('/').filter(Boolean).pop() || '').replace(/\.[a-z0-9]+$/i, ''));
    const title = slug.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
    if(title) return title.charAt(0).toUpperCase() + title.slice(1);
    return `Notícia ${i + 1} - ${u.hostname.replace(/^www\./, '')}`;
  } catch(e) {
    return `Notícia ${i + 1}`;
  }
}

function projNewsHost(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch(e) { return url; }
}

function projMemorialNewsEmbeds(conc) {
  const links = String(conc.links_noticias||'').split(/\n+/).map(s => s.trim()).filter(Boolean);
  if(!links.length) return '';
  return `<div class="proj-form-section" style="margin-top:1rem"><div class="proj-form-section-title">Notícias e Resultados</div><div class="proj-v12-news-list">${links.map((url,i) => `<div class="proj-v12-news-card"><div class="proj-v12-news-copy"><div class="proj-v12-news-title">${projEsc(projNewsTitleFromUrl(url, i))}</div><div class="proj-v12-news-url">${projEsc(projNewsHost(url))}</div></div><a class="proj-btn primary" href="${projEsc(url)}" target="_blank" rel="noopener">Abrir em nova guia</a></div>`).join('')}</div></div>`;
}

function projMemorialImagesHtml(conc) {
  const imagens = conc.imagens || [];
  if(!imagens.length) return '<div style="font-size:12px;color:var(--ink3)">Nenhuma imagem anexada ao Memorial.</div>';
  if(imagens.length === 1) {
    const img = imagens[0];
    const src = projConclusaoImagemSrc(img);
    return `<div class="proj-v12-single-image"><a href="${projEsc(src)}" target="_blank"><img src="${projEsc(src)}" alt="${projEsc(img.nome||'Imagem do memorial')}"></a></div>`;
  }
  return `<div class="proj-v12-carousel" id="proj-memorial-carousel" data-index="0"><button type="button" class="proj-v12-carousel-btn prev" onclick="projMemorialCarouselStep(-1)" aria-label="Imagem anterior">‹</button><div class="proj-v12-carousel-stage">${imagens.map((img,i) => { const src = projConclusaoImagemSrc(img); return `<a href="${projEsc(src)}" target="_blank" class="proj-v12-carousel-slide ${i===0?'on':''}"><img src="${projEsc(src)}" alt="${projEsc(img.nome||'Imagem do memorial')}"></a>`; }).join('')}</div><button type="button" class="proj-v12-carousel-btn next" onclick="projMemorialCarouselStep(1)" aria-label="Próxima imagem">›</button><div class="proj-v12-carousel-counter">1 / ${imagens.length}</div></div>`;
}

function projMemorialCarouselStep(delta) {
  const carousel = document.getElementById('proj-memorial-carousel');
  if(!carousel) return;
  const slides = Array.from(carousel.querySelectorAll('.proj-v12-carousel-slide'));
  if(!slides.length) return;
  let idx = Number(carousel.dataset.index || 0);
  idx = (idx + delta + slides.length) % slides.length;
  carousel.dataset.index = String(idx);
  slides.forEach((slide, i) => slide.classList.toggle('on', i === idx));
  const counter = carousel.querySelector('.proj-v12-carousel-counter');
  if(counter) counter.textContent = `${idx + 1} / ${slides.length}`;
}

function projRenderMemorial(p) {
  const conc = p.conclusao || {};
  const content = document.getElementById('proj-detalhe-content');
  if(!content) return;
  const licoes = [conc.licoes_data, conc.licoes_participantes, conc.licoes_certo, conc.licoes_melhorar, conc.licoes_ideias].some(Boolean);
  const imgs = projMemorialImagesHtml(conc);
  projSetSafeHtml(content, `<div class="proj-ph"><div><div class="proj-ph-t">Memorial do Projeto</div><div class="proj-ph-s">${projEsc(p.nome||'Projeto')}</div></div><div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="proj-btn primary" style="font-size:12px;padding:5px 11px" onclick="projAbrirDetalhe('${projEsc(String(p.id))}', true)">Ver Workflow</button><button type="button" class="proj-btn" style="font-size:12px;padding:5px 11px" onclick="projGo('portfolio',document.getElementById('pnb-portfolio'))">Voltar ao Portfólio</button></div></div><div class="proj-form-section"><div class="proj-form-section-title">Informações Gerais</div><div class="proj-g3"><div><div class="proj-fl">Projeto</div><strong>${projEsc(p.nome||'')}</strong></div><div><div class="proj-fl">Patrocinador</div><strong>${projEsc(p.patrocinador||'Não informado')}</strong></div><div><div class="proj-fl">Gerente</div><strong>${projEsc(p.gerente||'Não informado')}</strong></div></div></div><div class="proj-form-section"><div class="proj-form-section-title">História do Projeto</div><div style="font-size:13px;color:#334155;line-height:1.7;white-space:pre-wrap">${projEsc(conc.historia||'História ainda não registrada.')}</div></div>${projMemorialNewsEmbeds(conc)}<div class="proj-form-section" style="margin-top:1rem"><div class="proj-form-section-title">Imagens do Memorial</div>${imgs}</div>${licoes ? `<div class="proj-form-section" style="margin-top:1rem"><div class="proj-form-section-title">Lições Aprendidas</div><div class="proj-g2"><div><div class="proj-fl">Data da reunião</div><strong>${projFormatDate(conc.licoes_data)||'Não informada'}</strong></div><div><div class="proj-fl">Participantes</div><strong>${projEsc(conc.licoes_participantes||'Não informado')}</strong></div></div><div class="proj-g3" style="margin-top:1rem"><div><div class="proj-fl">O que deu certo?</div><div style="white-space:pre-wrap">${projEsc(conc.licoes_certo||'')}</div></div><div><div class="proj-fl">O que pode melhorar?</div><div style="white-space:pre-wrap">${projEsc(conc.licoes_melhorar||'')}</div></div><div><div class="proj-fl">Sugestões / ideias</div><div style="white-space:pre-wrap">${projEsc(conc.licoes_ideias||'')}</div></div></div></div>` : ''}`);
}
