import { beforeEach, describe, expect, it, vi } from 'vitest';

class FakeTimestamp {
  constructor(value = new Date('2026-06-01T12:00:00Z')) {
    this._date = new Date(value);
  }

  toDate() {
    return new Date(this._date);
  }

  toMillis() {
    return this._date.getTime();
  }

  static now() {
    return new FakeTimestamp();
  }

  static fromDate(date) {
    return new FakeTimestamp(date);
  }
}

vi.mock('firebase-admin/firestore', () => ({
  Timestamp: FakeTimestamp,
  FieldValue: {
    serverTimestamp: () => FakeTimestamp.now(),
  },
}));

const engineModule = await import('../../functions/workflow/engine.js');
const entitiesModule = await import('../../functions/workflow/entities.js');

const { makeEngine } = engineModule.default ?? engineModule;
const { normalizarProcessoModeloDoc } = entitiesModule.default ?? entitiesModule;

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function createDocSnapshot(id, data) {
  return {
    id,
    exists: data !== undefined,
    data: () => clone(data),
  };
}

class FakeDocRef {
  constructor(store, key) {
    this.store = store;
    this.key = key;
    this.id = String(key).split('/').pop();
  }

  async get() {
    return createDocSnapshot(this.id, this.store.get(this.key));
  }

  async update(patch) {
    const current = this.store.get(this.key);
    if (current === undefined) throw new Error(`Documento não encontrado: ${this.key}`);
    this.store.set(this.key, { ...clone(current), ...clone(patch) });
  }

  async set(data) {
    this.store.set(this.key, clone(data));
  }

  async delete() {
    this.store.delete(this.key);
  }
}

class FakeQuery {
  constructor(db, collectionName, filters = [], limitValue = null) {
    this.db = db;
    this.collectionName = collectionName;
    this.filters = filters;
    this.limitValue = limitValue;
  }

  where(field, op, value) {
    return new FakeQuery(this.db, this.collectionName, [...this.filters, { field, op, value }], this.limitValue);
  }

  limit(value) {
    return new FakeQuery(this.db, this.collectionName, this.filters, value);
  }

  orderBy() {
    return this;
  }

  async get() {
    const collection = this.db._ensureCollection(this.collectionName);
    let docs = Array.from(collection.entries()).map(([id, data]) => ({ id, data: clone(data) }));

    for (const filter of this.filters) {
      docs = docs.filter(({ data }) => {
        const current = data?.[filter.field];
        switch (filter.op) {
          case '==':
            return current === filter.value;
          case 'in':
            return Array.isArray(filter.value) && filter.value.includes(current);
          case 'array-contains':
            return Array.isArray(current) && current.includes(filter.value);
          default:
            throw new Error(`Operador não suportado no fake Firestore: ${filter.op}`);
        }
      });
    }

    if (typeof this.limitValue === 'number') {
      docs = docs.slice(0, this.limitValue);
    }

    return {
      empty: docs.length === 0,
      size: docs.length,
      docs: docs.map(({ id, data }) => createDocSnapshot(id, data)),
    };
  }
}

class FakeCollectionRef extends FakeQuery {
  constructor(db, collectionName) {
    super(db, collectionName);
    this.db = db;
    this.collectionName = collectionName;
  }

  doc(id) {
    this.db._ensureCollection(this.collectionName);
    return new FakeDocRef(this.db.collections.get(this.collectionName), id);
  }

  async add(data) {
    const id = `${this.collectionName}-${++this.db.counter}`;
    this.db._ensureCollection(this.collectionName).set(id, clone(data));
    return { id };
  }
}

function makeFakeDb({ collections = {}, rootDocs = {} } = {}) {
  return {
    collections: new Map(),
    rootDocs: new Map(Object.entries(rootDocs).map(([key, value]) => [key, clone(value)])),
    counter: 0,
    _ensureCollection(name) {
      if (!this.collections.has(name)) {
        const seeded = collections[name]
          ? new Map(Object.entries(collections[name]).map(([id, value]) => [id, clone(value)]))
          : new Map();
        this.collections.set(name, seeded);
      }
      return this.collections.get(name);
    },
    collection(name) {
      this._ensureCollection(name);
      return new FakeCollectionRef(this, name);
    },
    doc(path) {
      if (!this.rootDocs.has(path)) this.rootDocs.set(path, undefined);
      return new FakeDocRef(this.rootDocs, path);
    },
    batch() {
      const operations = [];
      return {
        update(ref, patch) {
          operations.push(() => ref.update(patch));
        },
        async commit() {
          for (const operation of operations) {
            await operation();
          }
        },
      };
    },
    getCollection(name) {
      return Array.from(this._ensureCollection(name).entries()).map(([id, data]) => ({ id, ...clone(data) }));
    },
    getDoc(name, id) {
      const data = this._ensureCollection(name).get(id);
      return data ? { id, ...clone(data) } : null;
    },
  };
}

function makeCanvasModel(overrides = {}) {
  return {
    nome: 'Fluxo de Teste',
    status: 'publicado',
    versao: 1,
    criado_por: 'u-admin',
    config_nos: {
      etapa_1: {
        papeis: {
          executor: 'solicitante',
          revisor: 'reviewer-1',
          aprovador: 'approver-1',
          ciente: ['watcher@example.com'],
        },
        acoes: ['avancar', 'aprovar', 'rejeitar'],
        formulario_id: 'form-1',
        campos_condicionais: [],
        sla_horas: 0,
        exige_parecer: false,
      },
    },
    canvas: {
      nos: [
        { id: 'inicio', tipo: 'inicio', nome: 'Início' },
        { id: 'etapa_1', tipo: 'tarefa', nome: 'Etapa 1' },
        { id: 'fim', tipo: 'fim', nome: 'Fim' },
      ],
      arestas: [
        { id: 'a1', origem: 'inicio', destino: 'etapa_1', padrao: true },
        { id: 'a2', origem: 'etapa_1', destino: 'fim', acao: 'aprovar', padrao: true },
      ],
    },
    ...overrides,
  };
}

describe('workflow engine canvas backend', () => {
  let db;
  let engine;

  beforeEach(() => {
    db = makeFakeDb({
      collections: {
        wf_processo_modelos: {
          modelo_1: makeCanvasModel(),
        },
        wf_formulario_modelos: {
          'form-1': {
            titulo: 'Formulário',
            campos: [
              { id: 'tipo', label: 'Tipo', obrigatorio: false },
              { id: 'detalhe', label: 'Detalhe', obrigatorio: false },
            ],
          },
        },
      },
      rootDocs: {
        'config/usuarios': {
          data: [
            { uid: 'solicitante-1', email: 'solicitante@example.com' },
            { uid: 'reviewer-1', email: 'reviewer@example.com' },
            { uid: 'approver-1', email: 'approver@example.com' },
            { uid: 'watcher-1', email: 'watcher@example.com' },
          ],
        },
      },
    });
    engine = makeEngine(db);
  });

  it('preserva a ação opcional ao normalizar campos condicionais', () => {
    const doc = normalizarProcessoModeloDoc({
      nome: 'Modelo',
      criado_por: 'u-admin',
      config_nos: {
        n1: {
          campos_condicionais: [
            {
              campo_id: 'detalhe',
              acao: 'opcional',
              condicoes: [{ campo: 'tipo', operador: '=', valor: 'x' }],
            },
          ],
        },
      },
    });

    expect(doc.config_nos.n1.campos_condicionais[0].acao).toBe('opcional');
  });

  it('sequencia executor, revisor e aprovador no mesmo nó e notifica cientes na entrada', async () => {
    const instancia = await engine.iniciarInstancia({
      processo_modelo_id: 'modelo_1',
      titulo: 'Fluxo A',
      solicitante_uid: 'solicitante-1',
    });

    let tarefas = db.getCollection('wf_tarefa_workflows');
    expect(tarefas).toHaveLength(1);
    expect(tarefas[0].papel_responsavel).toBe('executor');

    const notificacoesInicio = db.getCollection('wf_notificacoes');
    expect(notificacoesInicio.some((item) => item.destinatario_uid === 'watcher-1' && item.titulo.includes('Ciência'))).toBe(true);

    await engine.concluirTarefa({
      tarefa_id: tarefas[0].id,
      usuario_uid: 'solicitante-1',
      acao: 'avancar',
      dados_formulario: { tipo: 'simples' },
    });

    tarefas = db.getCollection('wf_tarefa_workflows');
    const tarefaRevisor = tarefas.find((item) => item.status === 'pendente' && item.papel_responsavel === 'revisor');
    expect(tarefaRevisor).toBeTruthy();
    expect(tarefaRevisor.responsavel_uid).toBe('reviewer-1');
    expect(tarefaRevisor.acoes_disponiveis).toEqual(['avancar']);

    await engine.concluirTarefa({
      tarefa_id: tarefaRevisor.id,
      usuario_uid: 'reviewer-1',
      acao: 'avancar',
      dados_formulario: { tipo: 'simples' },
    });

    tarefas = db.getCollection('wf_tarefa_workflows');
    const tarefaAprovador = tarefas.find((item) => item.status === 'pendente' && item.papel_responsavel === 'aprovador');
    expect(tarefaAprovador).toBeTruthy();
    expect(tarefaAprovador.responsavel_uid).toBe('approver-1');
    expect(tarefaAprovador.acoes_disponiveis).toEqual(['aprovar', 'rejeitar']);

    await engine.concluirTarefa({
      tarefa_id: tarefaAprovador.id,
      usuario_uid: 'approver-1',
      acao: 'aprovar',
      dados_formulario: { tipo: 'simples' },
    });

    const instanciaAtualizada = db.getDoc('wf_instancia_processos', instancia.id);
    expect(instanciaAtualizada.status).toBe('concluido');
    expect(db.getCollection('wf_tarefa_workflows').filter((item) => item.status === 'concluida')).toHaveLength(3);
  });

  it('exige campo dinamicamente quando regra obrigatoria do canvas é satisfeita', async () => {
    db.collections.set('wf_processo_modelos', new Map([
      ['modelo_2', makeCanvasModel({
        config_nos: {
          etapa_1: {
            papeis: {
              executor: 'solicitante',
              ciente: [],
            },
            acoes: ['avancar'],
            formulario_id: 'form-1',
            campos_condicionais: [
              {
                campo_id: 'detalhe',
                acao: 'obrigatorio',
                operador_logico: 'AND',
                condicoes: [{ campo: 'tipo', operador: '=', valor: 'especial' }],
              },
            ],
            sla_horas: 0,
            exige_parecer: false,
          },
        },
        canvas: {
          nos: [
            { id: 'inicio', tipo: 'inicio', nome: 'Início' },
            { id: 'etapa_1', tipo: 'tarefa', nome: 'Etapa 1' },
            { id: 'fim', tipo: 'fim', nome: 'Fim' },
          ],
          arestas: [
            { id: 'b1', origem: 'inicio', destino: 'etapa_1', padrao: true },
            { id: 'b2', origem: 'etapa_1', destino: 'fim', acao: 'avancar', padrao: true },
          ],
        },
      })],
    ]));

    const instancia = await engine.iniciarInstancia({
      processo_modelo_id: 'modelo_2',
      titulo: 'Fluxo B',
      solicitante_uid: 'solicitante-1',
    });
    const tarefa = db.getCollection('wf_tarefa_workflows').find((item) => item.instancia_id === instancia.id && item.status === 'pendente');

    await expect(engine.concluirTarefa({
      tarefa_id: tarefa.id,
      usuario_uid: 'solicitante-1',
      acao: 'avancar',
      dados_formulario: { tipo: 'especial' },
    })).rejects.toMatchObject({ code: 'CAMPO_OBRIGATORIO' });

    await expect(engine.concluirTarefa({
      tarefa_id: tarefa.id,
      usuario_uid: 'solicitante-1',
      acao: 'avancar',
      dados_formulario: { tipo: 'especial', detalhe: 'preenchido' },
    })).resolves.toEqual({ ok: true });
  });

  it('permite assumir tarefa de fila por grupo apenas para membro do grupo', async () => {
    db.collections.set('wf_grupos', new Map([
      ['grupo-1', { nome: 'Grupo 1', membros_email: ['reviewer@example.com'] }],
    ]));
    db.collections.set('wf_tarefa_workflows', new Map([
      ['tarefa-grupo', {
        instancia_id: 'inst-1',
        etapa_modelo_id: 'etapa_1',
        status: 'pendente',
        responsavel_uid: null,
        papel_alvo: 'grupo:grupo-1',
        grupo_id: 'grupo-1',
      }],
    ]));

    await expect(engine.assumirTarefa({
      tarefa_id: 'tarefa-grupo',
      usuario_uid: 'approver-1',
      usuario_email: 'approver@example.com',
    })).rejects.toMatchObject({ code: 'SEM_PERMISSAO' });

    const resultado = await engine.assumirTarefa({
      tarefa_id: 'tarefa-grupo',
      usuario_uid: 'reviewer-1',
      usuario_email: 'reviewer@example.com',
    });

    expect(resultado.responsavel_uid).toBe('reviewer-1');
    expect(resultado.status).toBe('em_execucao');
    expect(db.getDoc('wf_tarefa_workflows', 'tarefa-grupo').responsavel_uid).toBe('reviewer-1');
  });

  it('permite iniciar tarefa direcionada por e-mail ou perfil sem responsavel_uid prévio', async () => {
    db.collections.set('wf_tarefa_workflows', new Map([
      ['tarefa-email', {
        instancia_id: 'inst-email',
        etapa_modelo_id: 'etapa_1',
        status: 'pendente',
        responsavel_uid: null,
        papel_alvo: 'reviewer@example.com',
        grupo_id: null,
      }],
      ['tarefa-perfil', {
        instancia_id: 'inst-perfil',
        etapa_modelo_id: 'etapa_1',
        status: 'pendente',
        responsavel_uid: null,
        papel_alvo: 'gestor',
        grupo_id: null,
      }],
    ]));

    const tarefaEmail = await engine.iniciarTarefa({
      tarefa_id: 'tarefa-email',
      usuario_uid: 'reviewer-1',
      usuario_email: 'reviewer@example.com',
    });
    expect(tarefaEmail.status).toBe('em_execucao');
    expect(db.getDoc('wf_tarefa_workflows', 'tarefa-email').responsavel_uid).toBe('reviewer-1');

    const tarefaPerfil = await engine.iniciarTarefa({
      tarefa_id: 'tarefa-perfil',
      usuario_uid: 'gestor-1',
      usuario_email: 'gestor@example.com',
      usuario_perfil: 'gestor',
    });
    expect(tarefaPerfil.status).toBe('em_execucao');
    expect(db.getDoc('wf_tarefa_workflows', 'tarefa-perfil').responsavel_uid).toBe('gestor-1');
  });

  it('propaga grupo inicial da instância canvas para a primeira tarefa criada', async () => {
    db.collections.set('wf_processo_modelos', new Map([
      ['modelo_grupo', makeCanvasModel({
        nome: 'Fluxo com Grupo',
        config_nos: {
          etapa_1: {
            papeis: {
              executor: 'grupo:grupo-1',
              ciente: [],
            },
            acoes: ['avancar'],
            formulario_id: null,
            campos_condicionais: [],
            sla_horas: 0,
            exige_parecer: false,
          },
        },
      })],
    ]));

    const instancia = await engine.iniciarInstancia({
      processo_modelo_id: 'modelo_grupo',
      titulo: 'Fluxo Grupo',
      solicitante_uid: 'solicitante-1',
      grupo_id: 'grupo-1',
      grupo_nome: 'Grupo 1',
    });

    expect(instancia.grupo_id).toBe('grupo-1');
    expect(instancia.grupo_nome).toBe('Grupo 1');

    const tarefa = db.getCollection('wf_tarefa_workflows').find((item) => item.instancia_id === instancia.id && item.status === 'pendente');
    expect(tarefa).toBeTruthy();
    expect(tarefa.grupo_id).toBe('grupo-1');
    expect(tarefa.papel_alvo).toBe('grupo:grupo-1');
    expect(tarefa.responsavel_uid).toBeNull();
  });

  it('inicia instância a partir de processo mapeado e cria a primeira tarefa sequencial', async () => {
    const instancia = await engine.iniciarInstanciaMapeada({
      processo_id: 'proc-1',
      processo_nome: 'Processo Legado',
      titulo: 'Processo Legado - Execução',
      solicitante_uid: 'solicitante-1',
      fluxo_origem: 'tobe',
      snapshot_etapas: [
        {
          id: 'proc-1_e1',
          nome: 'Etapa inicial',
          tipo: 'Atividade',
          executor: 'solicitante',
          sla_horas: 0,
        },
      ],
    });

    expect(instancia.processo_id).toBe('proc-1');
    expect(instancia.fluxo_origem).toBe('tobe');
    expect(instancia.etapa_atual_id).toBe('proc-1_e1');

    const tarefa = db.getCollection('wf_tarefa_workflows').find((item) => item.instancia_id === instancia.id);
    expect(tarefa).toBeTruthy();
    expect(tarefa.etapa_modelo_id).toBe('proc-1_e1');
    expect(tarefa.responsavel_uid).toBe('solicitante-1');
    expect(tarefa.processo_id).toBe('proc-1');
  });

  it('nega gestao de instância para perfil sem permissão', async () => {
    db.collections.set('wf_instancia_processos', new Map([
      ['inst-1', { status: 'em_andamento' }],
    ]));

    await expect(engine.suspenderInstancia({
      instancia_id: 'inst-1',
      usuario_uid: 'dono-1',
      usuario_perfil: 'dono',
    })).rejects.toMatchObject({ code: 'SEM_PERMISSAO' });
  });

  it('nega exclusão de tarefa para perfil sem gestão de workflow', async () => {
    db.collections.set('wf_tarefa_workflows', new Map([
      ['tarefa-1', {
        instancia_id: 'inst-1',
        etapa_modelo_id: 'etapa_1',
        etapa_nome: 'Etapa 1',
        status: 'pendente',
        responsavel_uid: 'solicitante-1',
      }],
    ]));

    await expect(engine.excluirTarefa({
      tarefa_id: 'tarefa-1',
      usuario_uid: 'solicitante-1',
      usuario_perfil: 'dono',
    })).rejects.toMatchObject({ code: 'SEM_PERMISSAO' });
  });

  it('permite delegação apenas para responsável atual ou gestor', async () => {
    db.collections.set('wf_tarefa_workflows', new Map([
      ['tarefa-delegar', {
        instancia_id: 'inst-1',
        processo_nome: 'Fluxo A',
        etapa_modelo_id: 'etapa_1',
        etapa_nome: 'Etapa 1',
        status: 'em_execucao',
        responsavel_uid: 'solicitante-1',
      }],
    ]));

    await expect(engine.delegarTarefa({
      tarefa_id: 'tarefa-delegar',
      usuario_uid: 'reviewer-1',
      usuario_perfil: 'dono',
      novo_responsavel_uid: 'approver-1',
    })).rejects.toMatchObject({ code: 'SEM_PERMISSAO' });

    await expect(engine.delegarTarefa({
      tarefa_id: 'tarefa-delegar',
      usuario_uid: 'solicitante-1',
      usuario_perfil: 'dono',
      novo_responsavel_uid: 'approver-1',
      motivo: 'redistribuicao',
    })).resolves.toEqual({ ok: true });
  });
});
