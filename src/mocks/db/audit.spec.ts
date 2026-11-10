import type { MockData, TopicRecord } from './mock-data';
import { buildSeed } from '../seed/seed';
import { TEST_NOW } from '../testing';
import { auditChanges, recordAudit, sameValue } from './audit';

describe('recordAudit', () => {
  const seedData = buildSeed(TEST_NOW);
  const actorId = '11111111-1111-4111-8111-111111111111';
  let data: MockData;
  let logSize: number;

  beforeEach(() => {
    data = structuredClone(seedData);
    logSize = data.auditLog.length;
  });

  function topic(overrides: Partial<TopicRecord> = {}): TopicRecord {
    return {
      id: '22222222-2222-4222-8222-222222222222',
      organizationId: data.organization.id,
      name: 'Phishing Awareness',
      description: 'Spot and report phishing.',
      icon: null,
      status: 'active',
      createdAt: '2026-11-01T09:00:00.000Z',
      updatedAt: '2026-11-01T09:00:00.000Z',
      ...overrides,
    };
  }

  it('records creation with every field that has a value', () => {
    const [entry] = recordAudit(data, {
      action: 'created',
      entityType: 'topic',
      actorId,
      now: TEST_NOW,
      after: topic(),
    });

    expect(entry).toEqual({
      id: expect.any(String),
      organizationId: data.organization.id,
      actorId,
      action: 'created',
      entityType: 'topic',
      entityId: '22222222-2222-4222-8222-222222222222',
      changes: [
        { field: 'name', oldValue: null, newValue: 'Phishing Awareness' },
        { field: 'description', oldValue: null, newValue: 'Spot and report phishing.' },
        { field: 'status', oldValue: null, newValue: 'active' },
      ],
      createdAt: TEST_NOW.toISOString(),
      updatedAt: TEST_NOW.toISOString(),
    });
    expect(data.auditLog).toHaveLength(logSize + 1);
    expect(data.auditLog.at(-1)).toBe(entry);
  });

  it('records an edit with only the changed fields', () => {
    const before = topic();
    const after = topic({
      name: 'Phishing Basics',
      icon: 'fish',
      updatedAt: TEST_NOW.toISOString(),
    });

    const entries = recordAudit(data, {
      action: 'updated',
      entityType: 'topic',
      actorId,
      now: TEST_NOW,
      before,
      after,
    });

    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe('updated');
    expect(entries[0].changes).toEqual([
      { field: 'name', oldValue: 'Phishing Awareness', newValue: 'Phishing Basics' },
      { field: 'icon', oldValue: null, newValue: 'fish' },
    ]);
    expect(data.auditLog).toHaveLength(logSize + 1);
  });

  it('records nothing for an edit that changes no field', () => {
    const entries = recordAudit(data, {
      action: 'updated',
      entityType: 'topic',
      actorId,
      now: TEST_NOW,
      before: topic(),
      after: topic({ updatedAt: TEST_NOW.toISOString() }),
    });

    expect(entries).toEqual([]);
    expect(data.auditLog).toHaveLength(logSize);
  });

  it('records deactivation without a list of changes', () => {
    const [entry] = recordAudit(data, {
      action: 'deactivated',
      entityType: 'topic',
      actorId,
      now: TEST_NOW,
      after: topic({ status: 'inactive' }),
    });

    expect(entry).toMatchObject({
      action: 'deactivated',
      entityType: 'topic',
      entityId: '22222222-2222-4222-8222-222222222222',
      actorId,
      changes: [],
    });
    expect(data.auditLog).toHaveLength(logSize + 1);
  });

  it('records reactivation without a list of changes', () => {
    const [entry] = recordAudit(data, {
      action: 'reactivated',
      entityType: 'topic',
      actorId,
      now: TEST_NOW,
      after: topic(),
    });

    expect(entry).toMatchObject({ action: 'reactivated', changes: [] });
    expect(data.auditLog).toHaveLength(logSize + 1);
  });

  it('keeps the recorded values when the record changes later', () => {
    const after = topic();
    const [entry] = recordAudit(data, {
      action: 'created',
      entityType: 'topic',
      actorId,
      now: TEST_NOW,
      after,
    });

    after.name = 'Changed afterwards';

    expect(entry.changes[0]).toEqual({
      field: 'name',
      oldValue: null,
      newValue: 'Phishing Awareness',
    });
  });

  describe('a change of status in an edit', () => {
    function update(before: TopicRecord, after: TopicRecord) {
      return recordAudit(data, {
        action: 'updated',
        entityType: 'topic',
        actorId,
        now: TEST_NOW,
        before,
        after,
      });
    }

    it('is logged as deactivated, never as updated', () => {
      const entries = update(topic(), topic({ status: 'inactive' }));

      expect(entries.map((entry) => [entry.action, entry.changes])).toEqual([['deactivated', []]]);
      expect(data.auditLog.slice(logSize)).toEqual(entries);
    });

    it('is logged as reactivated, never as updated', () => {
      const entries = update(topic({ status: 'inactive' }), topic());

      expect(entries.map((entry) => [entry.action, entry.changes])).toEqual([['reactivated', []]]);
    });

    it('is logged as activated when it is the first activation', () => {
      const entries = recordAudit(data, {
        action: 'updated',
        entityType: 'topic',
        actorId,
        now: TEST_NOW,
        before: topic({ status: 'inactive', name: 'Draft' }),
        after: topic(),
        firstActivation: true,
      });

      expect(entries.map((entry) => entry.action)).toEqual(['updated', 'activated']);
    });

    it('ignores firstActivation when the status changes to inactive', () => {
      const entries = recordAudit(data, {
        action: 'updated',
        entityType: 'topic',
        actorId,
        now: TEST_NOW,
        before: topic(),
        after: topic({ status: 'inactive' }),
        firstActivation: true,
      });

      expect(entries.map((entry) => entry.action)).toEqual(['deactivated']);
    });

    it('logs the other fields as updated first, then the status change', () => {
      const entries = update(topic(), topic({ name: 'Phishing Basics', status: 'inactive' }));

      expect(entries.map((entry) => entry.action)).toEqual(['updated', 'deactivated']);
      expect(entries[0].changes).toEqual([
        { field: 'name', oldValue: 'Phishing Awareness', newValue: 'Phishing Basics' },
      ]);
      expect(entries[1].changes).toEqual([]);
      expect(data.auditLog.slice(logSize)).toEqual(entries);
    });
  });

  it('rejects records with derived fields, so they never appear in changes', () => {
    const department = {
      id: '33333333-3333-4333-8333-333333333333',
      name: 'Finance',
      employeeCount: 4,
    };

    expect(() =>
      recordAudit(data, {
        action: 'created',
        entityType: 'department',
        actorId,
        now: TEST_NOW,
        after: department,
      }),
    ).toThrow(/derived fields \(employeeCount\)/);
    expect(data.auditLog).toHaveLength(logSize);
  });
});

describe('auditChanges', () => {
  it('compares nested values by content', () => {
    expect(auditChanges({ id: '1', tags: ['a', 'b'] }, { id: '1', tags: ['a', 'b'] })).toEqual([]);
    expect(auditChanges({ id: '1', tags: ['a'] }, { id: '1', tags: ['a', 'b'] })).toEqual([
      { field: 'tags', oldValue: ['a'], newValue: ['a', 'b'] },
    ]);
  });

  it('compares objects regardless of the order of their keys', () => {
    expect(
      auditChanges(
        { id: '1', settings: { a: 1, b: { c: 2, d: 3 } } },
        { id: '1', settings: { b: { d: 3, c: 2 }, a: 1 } },
      ),
    ).toEqual([]);
  });

  it('treats a missing field as null', () => {
    expect(auditChanges({ id: '1', note: 'x' }, { id: '1' })).toEqual([
      { field: 'note', oldValue: 'x', newValue: null },
    ]);
  });
});

describe('sameValue', () => {
  it('compares plain data deeply', () => {
    expect(sameValue({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(sameValue([1, 2], [2, 1])).toBe(false);
    expect(sameValue({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(sameValue(null, {})).toBe(false);
    expect(sameValue([], {})).toBe(false);
    expect(sameValue('1', 1)).toBe(false);
  });
});
