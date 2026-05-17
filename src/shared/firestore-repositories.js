(function initFirestoreRepositories(globalScope){
  function requireFirebase(){
    if(!fbReady()) throw new Error('Firebase indisponível.');
    return fb();
  }

  function collectionRepository(collectionName){
    function ref(id){
      const {db} = requireFirebase();
      return fbDocRef(db, collectionName, id);
    }

    function colRef(){
      const {db} = requireFirebase();
      return fbColRef(db, collectionName);
    }

    async function list(){
      const {getDocs} = requireFirebase();
      const snap = await getDocs(colRef());
      const docs = [];
      snap.forEach(docSnap => docs.push({id: docSnap.id, ref: docSnap.ref, data: docSnap.data()}));
      return {empty: snap.empty, docs};
    }

    async function get(id){
      const {getDoc} = requireFirebase();
      return getDoc(ref(id));
    }

    async function set(id, data, options){
      const {setDoc} = requireFirebase();
      if(options) return setDoc(ref(id), data, options);
      return setDoc(ref(id), data);
    }

    async function remove(id){
      const {deleteDoc} = requireFirebase();
      return deleteDoc(ref(id));
    }

    return {collectionName, ref, colRef, list, get, set, remove};
  }

  function _configRef(key){
    const {db} = requireFirebase();
    return fbConfigDocRef(db, key);
  }

  function configRepository(){
    async function get(key, options={}){
      const api = requireFirebase();
      const getter = options.fromServer && api.getDocFromServer ? api.getDocFromServer : api.getDoc;
      return getter(_configRef(key));
    }

    async function set(key, data, options){
      const {setDoc} = requireFirebase();
      if(options) return setDoc(_configRef(key), data, options);
      return setDoc(_configRef(key), data);
    }

    async function remove(key){
      const {deleteDoc} = requireFirebase();
      return deleteDoc(_configRef(key));
    }

    return {ref: _configRef, get, set, remove};
  }

  async function batchCommit(ops, chunkSize=450){
    const {db, writeBatch} = requireFirebase();
    for(let i = 0; i < ops.length; i += chunkSize){
      const batch = writeBatch(db);
      ops.slice(i, i + chunkSize).forEach(op => {
        if(op.type === 'delete') batch.delete(op.ref);
        else if(op.options) batch.set(op.ref, op.data, op.options);
        else batch.set(op.ref, op.data);
      });
      await batch.commit();
    }
  }

  async function syncCollection(repository, items, cleanFn, chunkSize=400){
    const ids = new Set((items || []).map(item => String(item.id)));
    const ops = [];
    (items || []).forEach(item => {
      ops.push({type: 'set', ref: repository.ref(item.id), data: cleanFn ? cleanFn(item) : item});
    });
    const snap = await repository.list();
    snap.docs.forEach(docItem => {
      if(!ids.has(String(docItem.id))) ops.push({type: 'delete', ref: docItem.ref});
    });
    await batchCommit(ops, chunkSize);
  }

  function ideiasCollectionRepository(collectionName){
    function colRef(){
      const {db} = requireFirebase();
      return fbColRef(db, collectionName);
    }
    function docRef(id){
      const {db} = requireFirebase();
      return fbDocRef(db, collectionName, id);
    }
    async function add(data){
      const {addDoc} = requireFirebase();
      return addDoc(colRef(), data);
    }
    async function list(){
      const {getDocs} = requireFirebase();
      const snap = await getDocs(colRef());
      const docs = [];
      snap.forEach(d => docs.push({id: d.id, ref: d.ref, data: d.data()}));
      docs.sort((a,b)=> (b.data.criadoEm||'').localeCompare(a.data.criadoEm||''));
      return {empty: snap.empty, docs};
    }
    async function listByArqId(arqId){
      const {getDocs, query, where} = requireFirebase();
      const snap = await getDocs(query(colRef(), where('arqId','==',arqId)));
      const docs = [];
      snap.forEach(d => docs.push({id: d.id, ref: d.ref, data: d.data()}));
      docs.sort((a,b)=> (b.data.criadoEm||'').localeCompare(a.data.criadoEm||''));
      return {empty: snap.empty, docs};
    }
    async function update(id, data){
      const {updateDoc} = requireFirebase();
      return updateDoc(docRef(id), data);
    }
    return {collectionName, colRef, docRef, add, list, listByArqId, update};
  }

  const repositories = {
    collection: collectionRepository,
    config: configRepository(),
    batchCommit,
    syncCollection,
  };

  globalScope.FirestoreRepositories = repositories;
  globalScope.processosRepository = collectionRepository('processos');
  globalScope.kpisRepository = collectionRepository('kpis');
  globalScope.publicacoesRepository = collectionRepository('publicacoes');
  globalScope.planoRepository = collectionRepository('plano');
  globalScope.trilhasRepository = collectionRepository('trilhas');
  globalScope.planoMetasRepository = collectionRepository('plano_metas');
  globalScope.solicitacoesRepository = collectionRepository('solicitacoes');
  globalScope.avisosRepository = collectionRepository('avisos');
  globalScope.relatoriosIndicadoresRepository = collectionRepository('relatorios_ind');
  globalScope.fluxosRepository = collectionRepository('fluxos');
  globalScope.sessoesRepository = collectionRepository('sessions');
  globalScope.projetosRepository = collectionRepository('projPROJETOS');
  globalScope.programasRepository = collectionRepository('projPROGRAMAS');
  globalScope.projetosUsuariosRepository = globalScope.projetosRepository;
  globalScope.configRepository = repositories.config;
  globalScope.ideiasRepository = ideiasCollectionRepository('ideias');
})(globalThis);
