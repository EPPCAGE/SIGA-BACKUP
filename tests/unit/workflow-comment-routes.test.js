import { describe, expect, it } from 'vitest';

const routesModule = await import('../../functions/workflow/comment-routes.js');
const { handleWfComentariosRoute } = routesModule.default ?? routesModule;

function makeReq({ method = 'GET', path = '/', body = undefined, query = undefined } = {}) {
  return { method, path, body, query };
}

function makeRes() {
  return {
    statusCode: 200,
    body: undefined,
    ended: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

class FakeQuery {
  constructor(entries) {
    this.entries = entries;
  }

  where(field, op, value) {
    return new FakeQuery(this.entries.filter(([, data]) => op === '==' && data?.[field] === value));
  }

  async get() {
    return {
      docs: this.entries.map(([id, data]) => ({ id, data: () => clone(data) })),
    };
  }
}

function makeComentariosCol(seed) {
  const store = new Map(Object.entries(seed).map(([id, data]) => [id, clone(data)]));
  return {
    where(field, op, value) {
      return new FakeQuery(Array.from(store.entries())).where(field, op, value);
    },
    async add(data) {
      const id = `c${store.size + 1}`;
      store.set(id, clone(data));
      return { id };
    },
    store,
  };
}

describe('workflow comment routes helper', () => {
  it('lista comentários filtrando por tarefa ou instância', async () => {
    const comentariosCol = makeComentariosCol({
      c1: { tarefa_id: 't1', instancia_id: 'i1', texto: 'A', criado_em: { seconds: 10 } },
      c2: { tarefa_id: 't1', instancia_id: 'i1', texto: 'B', criado_em: { seconds: 20 } },
      c3: { tarefa_id: 't2', instancia_id: 'i2', texto: 'C', criado_em: { seconds: 30 } },
    });

    const resTarefa = makeRes();
    await handleWfComentariosRoute({
      req: makeReq({ method: 'GET', query: { tarefa_id: 't1' } }),
      res: resTarefa,
      user: { uid: 'u1' },
      comentariosCol,
      nowFactory: () => ({ seconds: 999 }),
    });
    expect(resTarefa.body.map((item) => item.id)).toEqual(['c1', 'c2']);

    const resInstancia = makeRes();
    await handleWfComentariosRoute({
      req: makeReq({ method: 'GET', query: { instancia_id: 'i2' } }),
      res: resInstancia,
      user: { uid: 'u1' },
      comentariosCol,
      nowFactory: () => ({ seconds: 999 }),
    });
    expect(resInstancia.body).toEqual([{ id: 'c3', tarefa_id: 't2', instancia_id: 'i2', texto: 'C', criado_em: { seconds: 30 } }]);
  });

  it('cria comentário com autor autenticado', async () => {
    const comentariosCol = makeComentariosCol({});
    const res = makeRes();

    await handleWfComentariosRoute({
      req: makeReq({
        method: 'POST',
        body: {
          tarefa_id: 't1',
          instancia_id: 'i1',
          etapa_id: 'e1',
          etapa_nome: 'Etapa 1',
          texto: 'Comentário',
          respondendo_a: 'c0',
        },
      }),
      res,
      user: { uid: 'u1' },
      comentariosCol,
      nowFactory: () => ({ seconds: 123 }),
    });

    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual({
      id: 'c1',
      tarefa_id: 't1',
      instancia_id: 'i1',
      etapa_id: 'e1',
      etapa_nome: 'Etapa 1',
      autor_uid: 'u1',
      texto: 'Comentário',
      respondendo_a: 'c0',
      criado_em: { seconds: 123 },
      _criado_em: { seconds: 123 },
    });
  });

  it('valida filtro obrigatório e campos obrigatórios', async () => {
    const comentariosCol = makeComentariosCol({});

    const resFiltro = makeRes();
    await handleWfComentariosRoute({
      req: makeReq({ method: 'GET', query: {} }),
      res: resFiltro,
      user: { uid: 'u1' },
      comentariosCol,
      nowFactory: () => ({ seconds: 1 }),
    });
    expect(resFiltro.statusCode).toBe(400);
    expect(resFiltro.body).toEqual({ erro: 'FILTRO_OBRIGATORIO' });

    const resBody = makeRes();
    await handleWfComentariosRoute({
      req: makeReq({ method: 'POST', body: { tarefa_id: 't1' } }),
      res: resBody,
      user: { uid: 'u1' },
      comentariosCol,
      nowFactory: () => ({ seconds: 1 }),
    });
    expect(resBody.statusCode).toBe(400);
    expect(resBody.body).toEqual({ erro: 'CAMPO_OBRIGATORIO' });
  });
});