import { describe, expect, it, vi } from 'vitest';

const routesModule = await import('../../functions/workflow/task-routes.js');
const { handleWfTarefasRoute } = routesModule.default ?? routesModule;

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

describe('workflow task routes helper', () => {
  it('lista tarefas abertas via helper de agregação', async () => {
    const req = makeReq({ method: 'GET', path: '/' });
    const res = makeRes();
    const listar = vi.fn().mockResolvedValue([{ id: 't1' }, { id: 't2' }]);

    await handleWfTarefasRoute({
      req,
      res,
      user: { uid: 'u1' },
      tarefasCol: {},
      gruposCol: {},
      engine: {},
      listarTarefasAbertasUsuario: listar,
    });

    expect(listar).toHaveBeenCalledWith({ tarefasCol: {}, gruposCol: {}, user: { uid: 'u1' } });
    expect(res.body).toEqual([{ id: 't1' }, { id: 't2' }]);
  });

  it('retorna 404 ao buscar tarefa inexistente', async () => {
    const req = makeReq({ method: 'GET', path: '/t1' });
    const res = makeRes();

    await handleWfTarefasRoute({
      req,
      res,
      user: { uid: 'u1' },
      tarefasCol: { doc: () => ({ get: async () => makeDocSnapshot('t1', undefined) }) },
      gruposCol: {},
      engine: {},
      listarTarefasAbertasUsuario: vi.fn(),
    });

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ erro: 'NAO_ENCONTRADO' });
  });

  it('encaminha assumir, iniciar e concluir ao engine com contexto do usuário', async () => {
    const engine = {
      assumirTarefa: vi.fn().mockResolvedValue({ ok: 'assumida' }),
      iniciarTarefa: vi.fn().mockResolvedValue({ ok: 'iniciada' }),
      concluirTarefa: vi.fn().mockResolvedValue({ ok: 'concluida' }),
      delegarTarefa: vi.fn().mockResolvedValue({ ok: 'delegada' }),
      excluirTarefa: vi.fn().mockResolvedValue({ ok: 'excluida' }),
    };
    const user = { uid: 'u1', email: 'user@example.com', perfil: 'gestor' };

    const resAssumir = makeRes();
    await handleWfTarefasRoute({
      req: makeReq({ method: 'POST', path: '/t1/assumir' }),
      res: resAssumir,
      user,
      tarefasCol: {},
      gruposCol: {},
      engine,
      listarTarefasAbertasUsuario: vi.fn(),
    });
    expect(engine.assumirTarefa).toHaveBeenCalledWith({
      tarefa_id: 't1',
      usuario_uid: 'u1',
      usuario_email: 'user@example.com',
      usuario_perfil: 'gestor',
    });
    expect(resAssumir.body).toEqual({ ok: 'assumida' });

    const resIniciar = makeRes();
    await handleWfTarefasRoute({
      req: makeReq({ method: 'POST', path: '/t2/iniciar' }),
      res: resIniciar,
      user,
      tarefasCol: {},
      gruposCol: {},
      engine,
      listarTarefasAbertasUsuario: vi.fn(),
    });
    expect(engine.iniciarTarefa).toHaveBeenCalledWith({
      tarefa_id: 't2',
      usuario_uid: 'u1',
      usuario_email: 'user@example.com',
      usuario_perfil: 'gestor',
    });
    expect(resIniciar.body).toEqual({ ok: 'iniciada' });

    const resConcluir = makeRes();
    await handleWfTarefasRoute({
      req: makeReq({
        method: 'POST',
        path: '/t3/concluir',
        body: { acao: 'aprovar', observacao: 'ok', dados_formulario: { campo: 1 }, anexos: [{ nome: 'arquivo.pdf' }] },
      }),
      res: resConcluir,
      user,
      tarefasCol: {},
      gruposCol: {},
      engine,
      listarTarefasAbertasUsuario: vi.fn(),
    });
    expect(engine.concluirTarefa).toHaveBeenCalledWith({
      tarefa_id: 't3',
      usuario_uid: 'u1',
      usuario_email: 'user@example.com',
      usuario_perfil: 'gestor',
      acao: 'aprovar',
      observacao: 'ok',
      dados_formulario: { campo: 1 },
      anexos: [{ nome: 'arquivo.pdf' }],
    });
    expect(resConcluir.body).toEqual({ ok: 'concluida' });

    const resDelegar = makeRes();
    await handleWfTarefasRoute({
      req: makeReq({
        method: 'POST',
        path: '/t4/delegar',
        body: { novo_responsavel_uid: 'u2', motivo: 'redistribuicao' },
      }),
      res: resDelegar,
      user,
      tarefasCol: {},
      gruposCol: {},
      engine,
      listarTarefasAbertasUsuario: vi.fn(),
    });
    expect(engine.delegarTarefa).toHaveBeenCalledWith({
      tarefa_id: 't4',
      usuario_uid: 'u1',
      usuario_email: 'user@example.com',
      usuario_perfil: 'gestor',
      novo_responsavel_uid: 'u2',
      motivo: 'redistribuicao',
    });
    expect(resDelegar.body).toEqual({ ok: 'delegada' });

    const resExcluir = makeRes();
    await handleWfTarefasRoute({
      req: makeReq({
        method: 'POST',
        path: '/t5/excluir',
      }),
      res: resExcluir,
      user,
      tarefasCol: {},
      gruposCol: {},
      engine,
      listarTarefasAbertasUsuario: vi.fn(),
    });
    expect(engine.excluirTarefa).toHaveBeenCalledWith({
      tarefa_id: 't5',
      usuario_uid: 'u1',
      usuario_email: 'user@example.com',
      usuario_perfil: 'gestor',
    });
    expect(resExcluir.body).toEqual({ ok: 'excluida' });
  });

  it('responde 405 para método/ação não suportado', async () => {
    const res = makeRes();

    await handleWfTarefasRoute({
      req: makeReq({ method: 'DELETE', path: '/t1' }),
      res,
      user: { uid: 'u1' },
      tarefasCol: {},
      gruposCol: {},
      engine: {},
      listarTarefasAbertasUsuario: vi.fn(),
    });

    expect(res.statusCode).toBe(405);
    expect(res.ended).toBe(true);
  });
});