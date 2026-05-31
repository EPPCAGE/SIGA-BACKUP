const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const logs = [];
  page.on('console', msg => logs.push(`${msg.type()}: ${msg.text()}`));
  page.on('pageerror', err => logs.push(`pageerror: ${err.message}`));

  await page.goto('http://localhost:8000/processos.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);

  const result = await page.evaluate(async () => {
    let seq = 0;
    const store = {
      processos: new Map(),
      wf_processo_modelos: new Map(),
      wf_formulario_modelos: new Map(),
      wf_instancia_processos: new Map(),
      wf_tarefa_workflows: new Map(),
      wf_notificacoes: new Map(),
      wf_historico: new Map(),
      wf_comentarios: new Map(),
    };

    const processId = 'proc_demo_1';
    const bpmn = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:omgdc="http://www.omg.org/spec/DD/20100524/DC" xmlns:omgdi="http://www.omg.org/spec/DD/20100524/DI" targetNamespace="http://ep.cage">
  <process id="proc1" isExecutable="false">
    <startEvent id="start" name="Inicio"/>
    <userTask id="rev" name="Revisar"/>
    <exclusiveGateway id="gw1" name="Aprovado?"/>
    <endEvent id="fim" name="Fim"/>
    <sequenceFlow id="f0" sourceRef="start" targetRef="rev"/>
    <sequenceFlow id="f1" sourceRef="rev" targetRef="gw1"/>
    <sequenceFlow id="f2" sourceRef="gw1" targetRef="fim"/>
  </process>
</definitions>`;

    store.processos.set(processId, {
      nome: 'Processo Demo',
      mod: {
        bpmnAsIs: bpmn,
        etapas_proc: [{ id: 'rev', nome: 'Revisar', tipo: 'Atividade' }],
      },
    });

    const sdk = {
      auth: { currentUser: { uid: 'u_ep_1' } },
      getFirestore: () => ({}),
      collection: (_db, col) => ({ col }),
      doc: (_db, col, id) => ({ col, id }),
      query: (ref, ...constraints) => ({ col: ref.col, constraints }),
      where: (field, op, value) => ({ type: 'where', field, op, value }),
      addDoc: async (ref, data) => {
        const id = `id_${++seq}`;
        const col = ref.col;
        if (!store[col]) store[col] = new Map();
        store[col].set(id, { ...data, _id: id });
        return { id };
      },
      getDoc: async (ref) => {
        const col = store[ref.col] || new Map();
        const data = col.get(ref.id);
        return {
          id: ref.id,
          exists: () => !!data,
          data: () => data,
        };
      },
      getDocs: async (refOrQuery) => {
        const col = store[refOrQuery.col] || new Map();
        let entries = Array.from(col.entries());
        const constraints = refOrQuery.constraints || [];
        constraints.forEach((c) => {
          if (c?.type === 'where' && c.op === '==') {
            entries = entries.filter(([, d]) => d?.[c.field] === c.value);
          }
        });
        return {
          docs: entries.map(([id, d]) => ({ id, data: () => d })),
        };
      },
      updateDoc: async (ref, data) => {
        const col = store[ref.col] || new Map();
        const curr = col.get(ref.id) || {};
        col.set(ref.id, { ...curr, ...data });
      },
      setDoc: async (ref, data, opts) => {
        const col = store[ref.col] || new Map();
        const curr = col.get(ref.id) || {};
        col.set(ref.id, opts?.merge ? { ...curr, ...data } : { ...data });
      },
      deleteDoc: async (ref) => {
        const col = store[ref.col] || new Map();
        col.delete(ref.id);
      },
    };

    globalThis.fb = () => sdk;
    globalThis._fbReady = true;
    globalThis.usuarioLogado = { uid: 'u_ep_1', perfil: 'ep', nome: 'EP Teste' };
    globalThis.USUARIOS = [{ uid: 'u_ep_1', email: 'ep@test.local', nome: 'EP Teste', perfil: 'ep' }];
    globalThis.isEP = () => true;

    // 1) Importar mapeamento existente
    await globalThis.wfImportarMapeamento(processId);

    const modelos = Array.from((store.wf_processo_modelos || new Map()).values());
    const modeloImportado = modelos[0] || null;

    // 2) Criar modelo vazio e vincular processo (deve puxar BPMN automaticamente)
    const novoId = `m_${Date.now()}`;
    store.wf_processo_modelos.set(novoId, {
      id: novoId,
      nome: 'Workflow Vazio',
      descricao: '',
      status: 'rascunho',
      versao: 1,
      canvas: { nos: [], arestas: [] },
      bpmn_xml: '',
    });

    await globalThis.wfAbrirConfigModelo(novoId);
    const sel = document.createElement('select');
    sel.id = 'wf-arq-sel';
    sel.innerHTML = '<option value="">Selecione</option><option value="' + processId + '" selected>Processo Demo</option>';
    document.body.appendChild(sel);
    await globalThis._wfSalvarVinculoArq();

    const modeloVinculado = store.wf_processo_modelos.get(novoId) || null;

    return {
      importedModelCreated: !!modeloImportado,
      importedHasBpmn: String(modeloImportado?.bpmn_xml || '').includes('<process'),
      linkedModelHasOrigin: modeloVinculado?.processo_origem_id === processId,
      linkedModelImportedBpmn: String(modeloVinculado?.bpmn_xml || '').includes('<process'),
      totalModels: modelos.length + (modeloVinculado ? 1 : 0),
    };
  });

  console.log(JSON.stringify({ result, logs: logs.slice(-120) }, null, 2));
  await browser.close();
})();
