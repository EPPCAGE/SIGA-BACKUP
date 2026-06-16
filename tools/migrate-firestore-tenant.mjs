#!/usr/bin/env node

import crypto from 'node:crypto';

const DEFAULT_COLLECTIONS = [
  'processos',
  'kpis',
  'publicacoes',
  'plano',
  'plano_metas',
  'relatorios_ind',
  'fluxos',
  'projPROJETOS',
  'projPROGRAMAS',
  'sessions',
];

const DEFAULT_CONFIG_DOCS = [
  'arquitetura',
  'usuarios',
  'mapeados',
  'criticos',
  'ejs',
  'last_modified',
  'projPROJ_MACROS',
  'proj_objetivos',
];

function readArg(name, fallback = ''){
  const prefix = `--${name}=`;
  const found = process.argv.find(arg => arg.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : fallback;
}

function hasFlag(name){
  return process.argv.includes(`--${name}`);
}

function splitList(value, fallback){
  if(!value) return fallback;
  return value.split(',').map(item => item.trim()).filter(Boolean);
}

function tenantPath(tenantId, collectionName, docId){
  const base = `tenants/${tenantId}/${collectionName}`;
  return docId ? `${base}/${docId}` : base;
}

function printPlan({tenantId, collections, configDocs, execute, validateOnly}){
  console.log(`Tenant alvo: ${tenantId}`);
  const modeIfRun = execute ? 'EXECUCAO' : 'DRY-RUN';
  const mode = validateOnly ? 'VALIDACAO' : modeIfRun;
  console.log(`Modo: ${mode}`);
  console.log('\nColecoes que serao copiadas:');
  collections.forEach(collectionName => {
    console.log(`- ${collectionName} -> ${tenantPath(tenantId, collectionName)}`);
  });
  console.log('\nDocumentos de config que serao copiados:');
  configDocs.forEach(docId => {
    console.log(`- config/${docId} -> ${tenantPath(tenantId, 'config', docId)}`);
  });
}

async function loadAdmin(){
  try {
    return await import('firebase-admin');
  } catch(error_) {
    throw new Error(
      'firebase-admin nao esta instalado. Para executar a migracao real, instale em um ambiente controlado: npm install --save-dev firebase-admin',
      { cause: error_ }
    );
  }
}

function stableStringify(value){
  if(value === null || typeof value !== 'object') return JSON.stringify(value);
  if(Array.isArray(value)) return '['+value.map(stableStringify).join(',')+']';
  return '{'+Object.keys(value).sort((a, b) => a.localeCompare(b)).map(key => JSON.stringify(key)+':'+stableStringify(value[key])).join(',')+'}';
}

function hashDocData(data){
  return crypto.createHash('sha256').update(stableStringify(data)).digest('hex');
}

function docsById(snapshot){
  const docs = new Map();
  snapshot.docs.forEach(docSnap => {
    docs.set(docSnap.id, hashDocData(docSnap.data()));
  });
  return docs;
}

function compareDocMaps(sourceDocs, targetDocs){
  const missing = [];
  const mismatched = [];
  sourceDocs.forEach((sourceHash, id) => {
    const targetHash = targetDocs.get(id);
    if(!targetDocs.has(id)) missing.push(id);
    else if(targetHash !== sourceHash) mismatched.push(id);
  });
  return {
    sourceCount: sourceDocs.size,
    targetCount: targetDocs.size,
    missing,
    mismatched,
    ok: missing.length === 0 && mismatched.length === 0 && sourceDocs.size === targetDocs.size,
  };
}

async function copyCollection(db, sourceCollection, targetCollection){
  const sourceSnap = await db.collection(sourceCollection).get();
  if(sourceSnap.empty) return 0;
  let batch = db.batch();
  let count = 0;
  let batchSize = 0;
  for(const docSnap of sourceSnap.docs){
    batch.set(db.doc(`${targetCollection}/${docSnap.id}`), docSnap.data());
    count++;
    batchSize++;
    if(batchSize >= 450){
      await batch.commit();
      batch = db.batch();
      batchSize = 0;
    }
  }
  if(batchSize > 0) await batch.commit();
  return count;
}

async function copyConfigDocs(db, configDocs, tenantId){
  let copied = 0;
  let batch = db.batch();
  let batchSize = 0;
  for(const docId of configDocs){
    const source = await db.doc(`config/${docId}`).get();
    if(!source.exists) continue;
    batch.set(db.doc(tenantPath(tenantId, 'config', docId)), source.data());
    copied++;
    batchSize++;
    if(batchSize >= 450){
      await batch.commit();
      batch = db.batch();
      batchSize = 0;
    }
  }
  if(batchSize > 0) await batch.commit();
  return copied;
}

async function validateCollection(db, sourceCollection, targetCollection){
  const [sourceSnap, targetSnap] = await Promise.all([
    db.collection(sourceCollection).get(),
    db.collection(targetCollection).get(),
  ]);
  const result = compareDocMaps(docsById(sourceSnap), docsById(targetSnap));
  const status = result.ok ? 'OK' : 'FALHA';
  console.log(`Validacao ${status}: ${sourceCollection} (${result.sourceCount}) -> ${targetCollection} (${result.targetCount})`);
  if(!result.ok){
    if(result.missing.length) console.log(`  Ausentes no tenant: ${result.missing.slice(0, 20).join(', ')}`);
    if(result.mismatched.length) console.log(`  Divergentes: ${result.mismatched.slice(0, 20).join(', ')}`);
  }
  return result;
}

async function validateConfigDocs(db, configDocs, tenantId){
  const sourceDocs = new Map();
  const targetDocs = new Map();
  await Promise.all(configDocs.map(async docId => {
    const [source, target] = await Promise.all([
      db.doc(`config/${docId}`).get(),
      db.doc(tenantPath(tenantId, 'config', docId)).get(),
    ]);
    if(source.exists) sourceDocs.set(docId, hashDocData(source.data()));
    if(target.exists) targetDocs.set(docId, hashDocData(target.data()));
  }));
  const result = compareDocMaps(sourceDocs, targetDocs);
  const status = result.ok ? 'OK' : 'FALHA';
  console.log(`Validacao ${status}: config (${result.sourceCount}) -> tenants/${tenantId}/config (${result.targetCount})`);
  if(!result.ok){
    if(result.missing.length) console.log(`  Config ausente no tenant: ${result.missing.slice(0, 20).join(', ')}`);
    if(result.mismatched.length) console.log(`  Config divergente: ${result.mismatched.slice(0, 20).join(', ')}`);
  }
  return result;
}

async function validateMigration({db, tenantId, collections, configDocs}){
  const results = [];
  for(const collectionName of collections){
    results.push(await validateCollection(db, collectionName, tenantPath(tenantId, collectionName)));
  }
  results.push(await validateConfigDocs(db, configDocs, tenantId));
  const failures = results.filter(result => !result.ok);
  if(failures.length){
    throw new Error(`Validacao falhou em ${failures.length} grupo(s). Nao ative TENANCY.enabled ainda.`);
  }
  console.log('Validacao concluida: contagem e integridade conferem.');
}

async function executeMigration({tenantId, collections, configDocs, validateOnly}){
  const admin = await loadAdmin();
  if(!admin.apps.length){
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
    });
  }
  const db = admin.firestore();
  if(validateOnly){
    await validateMigration({db, tenantId, collections, configDocs});
    return;
  }
  for(const collectionName of collections){
    const copied = await copyCollection(db, collectionName, tenantPath(tenantId, collectionName));
    console.log(`Copiados ${copied} documentos de ${collectionName}.`);
  }
  const configCopied = await copyConfigDocs(db, configDocs, tenantId);
  console.log(`Copiados ${configCopied} documentos de config.`);
  await validateMigration({db, tenantId, collections, configDocs});
}

async function main(){
  const tenantId = readArg('tenant', 'cage-rs');
  const execute = hasFlag('execute');
  const validateOnly = hasFlag('validate');
  const collections = splitList(readArg('collections'), DEFAULT_COLLECTIONS);
  const configDocs = splitList(readArg('config-docs'), DEFAULT_CONFIG_DOCS);

  printPlan({tenantId, collections, configDocs, execute, validateOnly});
  if(!execute && !validateOnly){
    console.log('\nNenhum dado foi alterado. Use --execute apenas em homologacao/controlado.');
    return;
  }
  await executeMigration({tenantId, collections, configDocs, validateOnly});
}

try {
  await main();
} catch (error_) {
  console.error(error_.message);
  process.exitCode = 1;
}
