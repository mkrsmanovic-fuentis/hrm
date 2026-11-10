import type { Topic } from '../../app/core/api/api-schema.gen';
import { buildSeed } from '../seed/seed';
import { TEST_NOW } from '../testing';
import { auditChanges, recordAudit } from './audit';
import type { MockData } from './mock-data';

describe('recordAudit', () => {
  const seedData = buildSeed(TEST_NOW);
  const actorId = '11111111-1111-4111-8111-111111111111';
  let data: MockData;
  let logSize: number;

  beforeEach(() => {
    data = structuredClone(seedData);
    logSize = data.auditLog.length;
  });

  function topic(overrides: Partial<Topic> = {}): Topic {
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
    const entry = recordAudit(data, {
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

    const entry = recordAudit(data, {
      action: 'updated',
      entityType: 'topic',
      actorId,
      now: TEST_NOW,
      before,
      after,
    });

    expect(entry?.action).toBe('updated');
    expect(entry?.changes).toEqual([
      { field: 'name', oldValue: 'Phishing Awareness', newValue: 'Phishing Basics' },
      { field: 'icon', oldValue: null, newValue: 'fish' },
    ]);
    expect(data.auditLog).toHaveLength(logSize + 1);
  });

  it('records nothing for an edit that changes no field', () => {
    const entry = recordAudit(data, {
      action: 'updated',
      entityType: 'topic',
      actorId,
      now: TEST_NOW,
      before: topic(),
      after: topic({ updatedAt: TEST_NOW.toISOString() }),
    });

    expect(entry).toBeNull();
    expect(data.auditLog).toHaveLength(logSize);
  });

  it('records deactivation without a list of changes', () => {
    const entry = recordAudit(data, {
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
    const entry = recordAudit(data, {
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
    const entry = recordAudit(data, {
      action: 'created',
      entityType: 'topic',
      actorId,
      now: TEST_NOW,
      after,
    });

    after.name = 'Changed afterwards';

    expect(entry?.changes[0]).toEqual({
      field: 'name',
      oldValue: null,
      newValue: 'Phishing Awareness',
    });
  });
});

describe('auditChanges', () => {
  it('compares nested values by content', () => {
    expect(auditChanges({ id: '1', tags: ['a', 'b'] }, { id: '1', tags: ['a', 'b'] })).toEqual([]);
    expect(auditChanges({ id: '1', tags: ['a'] }, { id: '1', tags: ['a', 'b'] })).toEqual([
      { field: 'tags', oldValue: ['a'], newValue: ['a', 'b'] },
    ]);
  });

  it('treats a missing field as null', () => {
    expect(auditChanges({ id: '1', note: 'x' }, { id: '1' })).toEqual([
      { field: 'note', oldValue: 'x', newValue: null },
    ]);
  });
});
