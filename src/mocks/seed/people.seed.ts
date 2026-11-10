/** People for the seed: one fictional organization, its departments and 42 users. */

export const organizationSeed = {
  name: 'Brightwater Logistics',
  emailDomain: 'brightwater.example',
};

export interface DepartmentSeed {
  name: string;
  description: string | null;
  status: 'active' | 'inactive';
}

export const departmentSeeds: DepartmentSeed[] = [
  {
    name: 'Engineering',
    description: 'Builds and runs the routing and tracking platform.',
    status: 'active',
  },
  {
    name: 'IT & Security',
    description: 'Workplace IT, accounts and information security.',
    status: 'active',
  },
  { name: 'Finance', description: 'Accounting, payroll and purchasing.', status: 'active' },
  {
    name: 'Human Resources',
    description: 'Hiring, onboarding and people operations.',
    status: 'active',
  },
  { name: 'Sales', description: null, status: 'active' },
  {
    name: 'Customer Support',
    description: 'Helps customers by phone, chat and email.',
    status: 'active',
  },
  { name: 'Operations', description: 'Warehouses, fleet and dispatch.', status: 'active' },
  { name: 'Marketing', description: null, status: 'active' },
  { name: 'Facilities', description: 'Merged into Operations.', status: 'inactive' },
];

/**
 * Every seeded user who has set a password signs in with this one. Demo only: the real backend
 * stores a secure hash of each user's own password. Documented in docs/developer-guide/mock-api.mdx.
 */
export const DEMO_PASSWORD = 'demo-2026';

export type UserSeedState = 'active' | 'invited' | 'invite_expired' | 'inactive';

export interface UserSeed {
  firstName: string;
  lastName: string;
  /** Department name, or null for no department. */
  department: string | null;
  role: 'administrator' | 'employee';
  state: UserSeedState;
}

const employee = (
  firstName: string,
  lastName: string,
  department: string | null,
  state: UserSeedState = 'active',
): UserSeed => ({ firstName, lastName, department, role: 'employee', state });

export const userSeeds: UserSeed[] = [
  {
    firstName: 'Maja',
    lastName: 'Novak',
    department: 'IT & Security',
    role: 'administrator',
    state: 'active',
  },
  {
    firstName: 'Daniel',
    lastName: 'Brooks',
    department: 'Human Resources',
    role: 'administrator',
    state: 'active',
  },
  employee('Amelia', 'Hughes', 'Engineering'),
  employee('Lukas', 'Becker', 'Engineering'),
  employee('Priya', 'Raman', 'Engineering'),
  employee('Tomás', 'Ortega', 'Engineering'),
  employee('Hannah', 'Fischer', 'Engineering'),
  employee('Kwame', 'Mensah', 'Engineering'),
  employee('Sofia', 'Lindqvist', 'Engineering', 'inactive'),
  employee('Ivan', 'Petrović', 'IT & Security'),
  employee('Grace', 'Okafor', 'IT & Security'),
  employee('Oliver', 'Grant', 'Finance'),
  employee('Chloé', 'Martin', 'Finance'),
  employee('Henrik', 'Dahl', 'Finance'),
  employee('Aisha', 'Khan', 'Finance', 'invited'),
  employee('Emma', 'Wilson', 'Human Resources'),
  employee('Mateo', 'García', 'Human Resources'),
  employee('Noah', 'Schmidt', 'Sales'),
  employee('Isabella', 'Rossi', 'Sales'),
  employee('Jack', 'Thompson', 'Sales'),
  employee('Yuki', 'Tanaka', 'Sales'),
  employee('Lena', 'Vogel', 'Sales', 'inactive'),
  employee('Samuel', 'Adeyemi', 'Sales', 'invite_expired'),
  employee('Mia', 'Johansson', 'Customer Support'),
  employee('Ethan', 'Clarke', 'Customer Support'),
  employee('Zara', 'Ahmed', 'Customer Support'),
  employee('Luca', 'Bianchi', 'Customer Support'),
  employee('Nora', 'Kowalski', 'Customer Support'),
  employee('Diego', 'Fernández', 'Customer Support', 'invited'),
  employee('Freya', 'Larsen', 'Operations'),
  employee('Marek', 'Horvat', 'Operations'),
  employee('Olivia', 'Bennett', 'Operations'),
  employee('Arjun', 'Mehta', 'Operations'),
  employee('Elif', 'Yılmaz', 'Operations'),
  employee('Patrick', 'O’Neill', 'Operations'),
  employee('Ana', 'Kovač', 'Operations', 'inactive'),
  employee('Charlotte', 'Dubois', 'Marketing'),
  employee('Leo', 'Novak', 'Marketing'),
  employee('Ines', 'Silva', 'Marketing'),
  employee('Benjamin', 'Weber', null),
  employee('Ruth', 'Abebe', null),
  employee('Viktor', 'Nilsson', 'Engineering'),
];
