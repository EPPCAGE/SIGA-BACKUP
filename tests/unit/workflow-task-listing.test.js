import { describe, expect, it } from 'vitest';

const listingModule = await import('../../functions/workflow/task-listing.js');
const { listarTarefasAbertasUsuario } = listingModule.default ?? listingModule;

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function makeDocSnapshot(id, data) {
  return {
    id,
    data: () => clone(data),
  };
}

class FakeQuery {
  constructor(collection, filters = [], limitValue = null) {
    this.collection = collection;
    this.filters = filters;
    this.limitValue = limitValue;
  }

  where(field, op, value) {
    return new FakeQuery(this.collection, [...this.filters, { field, op, value }], this.limitValue);
  }

  limit(value) {
    return new FakeQuery(this.collection, this.filters, value);
  }

  async get() {
    let docs = Array.from(this.collection.entries()).map(([id, data]) => ({ id, data: clone(data) }));
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
            throw new Error(`Operador não suportado: ${filter.op}`);
        }
      });
    }
    if (typeof this.limitValue === 'number') docs = docs.slice(0, this.limitValue);
    return { docs: docs.map(({ id, data }) => makeDocSnapshot(id, data)) };
  }
}

class FakeCollectionRef extends FakeQuery {
  constructor(entries) {
    super(new Map(entries));
  }
}

describe('workflow task listing helper', () => {
  it('agrega tarefas por uid, email, perfil e grupo sem duplicar e ordena por prazo', async () => {
    const tarefasCol = new FakeCollectionRef([
      ['t1', { responsavel_uid: 'u1', status: 'pendente', prazo: { _seconds: 30 } }],
      ['t2', { papel_alvo: 'user@example.com', status: 'em_execucao', prazo: { _seconds: 20 } }],
      ['t3', { papel_alvo: 'gestor', status: 'pendente', prazo: { _seconds: 40 } }],
      ['t4', { grupo_id: 'g1', status: 'pendente', prazo: { _seconds: 10 } }],
      ['t5', { grupo_id: 'g1', papel_alvo: 'user@example.com', status: 'pendente', prazo: { _seconds: 50 } }],
      ['t6', { responsavel_uid: 'u1', status: 'concluida', prazo: { _seconds: 5 } }],
    ]);
    const gruposCol = new FakeCollectionRef([
      ['g1', { nome: 'Grupo Alfa', membros_email: ['user@example.com'] }],
    ]);

    const tarefas = await listarTarefasAbertasUsuario({
      tarefasCol,
      gruposCol,
      user: { uid: 'u1', email: 'user@example.com', perfil: 'gestor' },
    });

    expect(tarefas.map((item) => item.id)).toEqual(['t4', 't2', 't1', 't3', 't5']);
    expect(tarefas.find((item) => item.id === 't4')._nomeGrupo).toBe('Grupo Alfa');
    expect(tarefas).toHaveLength(5);
  });

  it('não consulta grupos quando o usuário não tem email', async () => {
    const tarefasCol = new FakeCollectionRef([
      ['t1', { responsavel_uid: 'u1', status: 'pendente' }],
      ['t2', { papel_alvo: 'dono', status: 'pendente' }],
    ]);
    const gruposCol = new FakeCollectionRef([
      ['g1', { nome: 'Grupo Alfa', membros_email: ['user@example.com'] }],
    ]);

    const tarefas = await listarTarefasAbertasUsuario({
      tarefasCol,
      gruposCol,
      user: { uid: 'u1', perfil: 'dono' },
    });

    expect(tarefas.map((item) => item.id)).toEqual(['t1', 't2']);
  });
});