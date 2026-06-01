import { describe, expect, it } from 'vitest';

const routesModule = await import('../../functions/workflow/notification-routes.js');
const { handleWfNotificacoesRoute } = routesModule.default ?? routesModule;

function makeReq({ method = 'GET', path = '/', body = undefined } = {}) {
  return { method, path, body };
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

class FakeDocRef {
  constructor(store, id) {
    this.store = store;
    this.id = id;
  }

  async update(patch) {
    const current = this.store.get(this.id);
    this.store.set(this.id, { ...clone(current), ...clone(patch) });
  }
}

class FakeSnap {
  constructor(entries, store) {
    this.docs = entries.map(([id, data]) => ({
      id,
      ref: new FakeDocRef(store, id),
      data: () => clone(data),
    }));
    this.size = this.docs.length;
  }
}

class FakeQuery {
  constructor(store, entries) {
    this.store = store;
    this.entries = entries;
  }

  where(field, op, value) {
    const filtered = this.entries.filter(([, data]) => {
      if (op === '==') return data?.[field] === value;
      return false;
    });
    return new FakeQuery(this.store, filtered);
  }

  orderBy() {
    return this;
  }

  limit(value) {
    return new FakeQuery(this.store, this.entries.slice(0, value));
  }

  async get() {
    return new FakeSnap(this.entries, this.store);
  }
}

function makeNotificacoesCol(seed) {
  const store = new Map(Object.entries(seed).map(([id, data]) => [id, clone(data)]));
  const allEntries = () => Array.from(store.entries());
  return {
    store,
    where(field, op, value) {
      return new FakeQuery(store, allEntries()).where(field, op, value);
    },
    doc(id) {
      return new FakeDocRef(store, id);
    },
  };
}

describe('workflow notification routes helper', () => {
  it('lista notificações do usuário e inclui ep_escalada para perfil ep', async () => {
    const notificacoesCol = makeNotificacoesCol({
      n1: { destinatario_uid: 'u1', titulo: 'Minha', lida: false, criado_em: { seconds: 10 } },
      n2: { destinatario_uid: 'ep_escalada', titulo: 'Escalada', lida: false, criado_em: { seconds: 20 } },
      n3: { destinatario_uid: 'u2', titulo: 'Outra', lida: false, criado_em: { seconds: 30 } },
    });
    const res = makeRes();

    await handleWfNotificacoesRoute({
      req: makeReq({ method: 'GET' }),
      res,
      user: { uid: 'u1', perfil: 'ep' },
      notificacoesCol,
      db: { batch() { throw new Error('not-used'); } },
    });

    expect(res.body).toEqual([
      { id: 'n2', destinatario_uid: 'ep_escalada', titulo: 'Escalada', lida: false, criado_em: { seconds: 20 } },
      { id: 'n1', destinatario_uid: 'u1', titulo: 'Minha', lida: false, criado_em: { seconds: 10 } },
    ]);
  });

  it('marca uma ou todas as notificações como lidas', async () => {
    const notificacoesCol = makeNotificacoesCol({
      n1: { destinatario_uid: 'u1', titulo: 'Minha', lida: false, criado_em: { seconds: 10 } },
      n2: { destinatario_uid: 'ep_escalada', titulo: 'Escalada', lida: false, criado_em: { seconds: 20 } },
      n3: { destinatario_uid: 'u1', titulo: 'Lida', lida: true, criado_em: { seconds: 5 } },
    });
    const updated = [];
    const db = {
      batch() {
        return {
          update(ref, patch) {
            updated.push([ref, patch]);
          },
          async commit() {
            await Promise.all(updated.map(([ref, patch]) => ref.update(patch)));
          },
        };
      },
    };

    const resUma = makeRes();
    await handleWfNotificacoesRoute({
      req: makeReq({ method: 'POST', path: '/n1/marcar-lida' }),
      res: resUma,
      user: { uid: 'u1', perfil: 'ep' },
      notificacoesCol,
      db,
    });
    expect(resUma.body).toEqual({ ok: true });
    expect(notificacoesCol.store.get('n1').lida).toBe(true);

    const resTodas = makeRes();
    await handleWfNotificacoesRoute({
      req: makeReq({ method: 'POST', path: '/marcar-todas-lidas' }),
      res: resTodas,
      user: { uid: 'u1', perfil: 'ep' },
      notificacoesCol,
      db,
    });
    expect(resTodas.body).toEqual({ ok: true, marcadas: 1 });
    expect(notificacoesCol.store.get('n2').lida).toBe(true);
  });

  it('retorna 405 para método não suportado', async () => {
    const res = makeRes();
    await handleWfNotificacoesRoute({
      req: makeReq({ method: 'DELETE' }),
      res,
      user: { uid: 'u1' },
      notificacoesCol: makeNotificacoesCol({}),
      db: { batch() { throw new Error('not-used'); } },
    });
    expect(res.statusCode).toBe(405);
    expect(res.ended).toBe(true);
  });
});