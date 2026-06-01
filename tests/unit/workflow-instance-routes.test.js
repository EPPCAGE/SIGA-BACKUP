import { describe, expect, it, vi } from 'vitest';

const routesModule = await import('../../functions/workflow/instance-routes.js');
const { handleWfInstanciasRoute, handleWfInstanciaItemRoute } = routesModule.default ?? routesModule;

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

function makeDocSnapshot(id, data) {
  return {
    id,
    exists: data !== undefined,
    data: () => structuredClone(data),
  };
}

class FakeQuery {
  constructor(entries) {
    this.entries = entries;
  }

  where() {
    return this;
  }

  orderBy() {
    return this;
  }

  limit() {
    return this;
  }

  async get() {
    return {
      docs: this.entries.map(([id, data]) => makeDocSnapshot(id, data)),
    };
  }
}

describe('workflow instance routes helper', () => {
  it('lista instâncias do solicitante e inicia nova instância', async () => {
    const engine = {
      iniciarInstancia: vi.fn().mockResolvedValue({ id: 'inst-2', titulo: 'Nova' }),
      iniciarInstanciaMapeada: vi.fn().mockResolvedValue({ id: 'inst-3', titulo: 'Legado' }),
    };
    const user = { uid: 'u1', email: 'u1@example.com', perfil: 'gestor' };
    const instanciasCol = new FakeQuery([
      ['inst-1', { titulo: 'Instância 1' }],
    ]);

    const resGet = makeRes();
    await handleWfInstanciasRoute({
      req: makeReq({ method: 'GET' }),
      res: resGet,
      user,
      instanciasCol,
      engine,
    });
    expect(resGet.body).toEqual([{ id: 'inst-1', titulo: 'Instância 1' }]);

    const resPost = makeRes();
    await handleWfInstanciasRoute({
      req: makeReq({ method: 'POST', body: { processo_modelo_id: 'pm-1', titulo: 'Nova', grupo_id: 'grupo-1', grupo_nome: 'Grupo 1' } }),
      res: resPost,
      user,
      instanciasCol,
      engine,
    });
    expect(engine.iniciarInstancia).toHaveBeenCalledWith({
      processo_modelo_id: 'pm-1',
      titulo: 'Nova',
      solicitante_uid: 'u1',
      grupo_id: 'grupo-1',
      grupo_nome: 'Grupo 1',
    });
    expect(resPost.statusCode).toBe(201);
    expect(resPost.body).toEqual({ id: 'inst-2', titulo: 'Nova' });

    const resPostMapeado = makeRes();
    await handleWfInstanciasRoute({
      req: makeReq({ method: 'POST', body: { processo_id: 'proc-1', processo_nome: 'Processo 1', titulo: 'Legado', fluxo_origem: 'tobe', snapshot_etapas: [{ id: 'e1', nome: 'Etapa 1' }] } }),
      res: resPostMapeado,
      user,
      instanciasCol,
      engine,
    });
    expect(engine.iniciarInstanciaMapeada).toHaveBeenCalledWith({
      processo_id: 'proc-1',
      processo_nome: 'Processo 1',
      titulo: 'Legado',
      solicitante_uid: 'u1',
      snapshot_etapas: [{ id: 'e1', nome: 'Etapa 1' }],
      fluxo_origem: 'tobe',
    });
    expect(resPostMapeado.statusCode).toBe(201);
    expect(resPostMapeado.body).toEqual({ id: 'inst-3', titulo: 'Legado' });
  });

  it('retorna detalhe, histórico e cancelamento de instância', async () => {
    const engine = {
      cancelarInstancia: vi.fn().mockResolvedValue({ ok: true }),
      suspenderInstancia: vi.fn().mockResolvedValue({ ok: 'suspensa' }),
      retomarInstancia: vi.fn().mockResolvedValue({ ok: 'retomada' }),
      excluirInstanciaLogica: vi.fn().mockResolvedValue({ ok: 'excluida' }),
    };
    const instanciasCol = {
      doc: () => ({ get: async () => makeDocSnapshot('inst-1', { titulo: 'Instância 1' }) }),
    };
    const historicoCol = new FakeQuery([
      ['h1', { instancia_id: 'inst-1', descricao: 'Criada' }],
      ['h2', { instancia_id: 'inst-1', descricao: 'Avançou' }],
    ]);

    const resGet = makeRes();
    await handleWfInstanciaItemRoute({
      req: makeReq({ method: 'GET', path: '/inst-1' }),
      res: resGet,
      user: { uid: 'u1', email: 'u1@example.com', perfil: 'gestor' },
      instanciasCol,
      historicoCol,
      engine,
    });
    expect(resGet.body).toEqual({ id: 'inst-1', titulo: 'Instância 1' });

    const resHistorico = makeRes();
    await handleWfInstanciaItemRoute({
      req: makeReq({ method: 'GET', path: '/inst-1/historico' }),
      res: resHistorico,
      user: { uid: 'u1', email: 'u1@example.com', perfil: 'gestor' },
      instanciasCol,
      historicoCol,
      engine,
    });
    expect(resHistorico.body).toEqual([
      { id: 'h1', instancia_id: 'inst-1', descricao: 'Criada' },
      { id: 'h2', instancia_id: 'inst-1', descricao: 'Avançou' },
    ]);

    const resCancelar = makeRes();
    await handleWfInstanciaItemRoute({
      req: makeReq({ method: 'POST', path: '/inst-1/cancelar', body: { motivo: 'teste' } }),
      res: resCancelar,
      user: { uid: 'u1', email: 'u1@example.com', perfil: 'gestor' },
      instanciasCol,
      historicoCol,
      engine,
    });
    expect(engine.cancelarInstancia).toHaveBeenCalledWith({
      instancia_id: 'inst-1',
      usuario_uid: 'u1',
      usuario_email: 'u1@example.com',
      usuario_perfil: 'gestor',
      motivo: 'teste',
    });
    expect(resCancelar.body).toEqual({ ok: true });

    const resSuspender = makeRes();
    await handleWfInstanciaItemRoute({
      req: makeReq({ method: 'POST', path: '/inst-1/suspender' }),
      res: resSuspender,
      user: { uid: 'u1', email: 'u1@example.com', perfil: 'gestor' },
      instanciasCol,
      historicoCol,
      engine,
    });
    expect(engine.suspenderInstancia).toHaveBeenCalledWith({
      instancia_id: 'inst-1',
      usuario_uid: 'u1',
      usuario_email: 'u1@example.com',
      usuario_perfil: 'gestor',
    });
    expect(resSuspender.body).toEqual({ ok: 'suspensa' });

    const resRetomar = makeRes();
    await handleWfInstanciaItemRoute({
      req: makeReq({ method: 'POST', path: '/inst-1/retomar' }),
      res: resRetomar,
      user: { uid: 'u1', email: 'u1@example.com', perfil: 'gestor' },
      instanciasCol,
      historicoCol,
      engine,
    });
    expect(engine.retomarInstancia).toHaveBeenCalledWith({
      instancia_id: 'inst-1',
      usuario_uid: 'u1',
      usuario_email: 'u1@example.com',
      usuario_perfil: 'gestor',
    });
    expect(resRetomar.body).toEqual({ ok: 'retomada' });

    const resExcluir = makeRes();
    await handleWfInstanciaItemRoute({
      req: makeReq({ method: 'POST', path: '/inst-1/excluir' }),
      res: resExcluir,
      user: { uid: 'u1', email: 'u1@example.com', perfil: 'gestor' },
      instanciasCol,
      historicoCol,
      engine,
    });
    expect(engine.excluirInstanciaLogica).toHaveBeenCalledWith({
      instancia_id: 'inst-1',
      usuario_uid: 'u1',
      usuario_email: 'u1@example.com',
      usuario_perfil: 'gestor',
    });
    expect(resExcluir.body).toEqual({ ok: 'excluida' });
  });

  it('retorna 404 ao buscar instância inexistente e 405 para método inválido', async () => {
    const res404 = makeRes();
    await handleWfInstanciaItemRoute({
      req: makeReq({ method: 'GET', path: '/inst-404' }),
      res: res404,
      user: { uid: 'u1' },
      instanciasCol: { doc: () => ({ get: async () => makeDocSnapshot('inst-404', undefined) }) },
      historicoCol: new FakeQuery([]),
      engine: {},
    });
    expect(res404.statusCode).toBe(404);
    expect(res404.body).toEqual({ erro: 'NAO_ENCONTRADO' });

    const res405 = makeRes();
    await handleWfInstanciasRoute({
      req: makeReq({ method: 'DELETE' }),
      res: res405,
      user: { uid: 'u1' },
      instanciasCol: new FakeQuery([]),
      engine: {},
    });
    expect(res405.statusCode).toBe(405);
    expect(res405.ended).toBe(true);
  });
});