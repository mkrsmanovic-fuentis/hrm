import { countsInPendingAndOverdue, fullName, isSameEmail, isValidEmail } from './user-rules';

describe('user rules', () => {
  it('matches emails ignoring case and spaces around them', () => {
    expect(
      isSameEmail(' Oliver.Grant@Brightwater.example ', 'oliver.grant@brightwater.example'),
    ).toBe(true);
    expect(isSameEmail('oliver@brightwater.example', 'olivia@brightwater.example')).toBe(false);
  });

  it('accepts plain email addresses only', () => {
    expect(isValidEmail('hana.sato@brightwater.example')).toBe(true);
    for (const value of ['hana', 'hana@', '@brightwater.example', 'hana sato@x.example', 'a@b']) {
      expect(isValidEmail(value)).toBe(false);
    }
  });

  it('builds the full name, first name first', () => {
    expect(fullName({ firstName: 'Hana', lastName: 'Sato' })).toBe('Hana Sato');
  });

  it('leaves a deactivated user out of pending and overdue counts', () => {
    expect(countsInPendingAndOverdue({ status: 'active' })).toBe(true);
    expect(countsInPendingAndOverdue({ status: 'inactive' })).toBe(false);
  });
});
