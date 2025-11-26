import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const ISS = process.env.JWT_ISSUER || 'wheelpath-dev';
const AUD = process.env.JWT_AUDIENCE || 'wheelpath-api';

function sign(sub: string, tenantId: string, email: string, role: string) {
  return jwt.sign({ sub, tenantId, email, role }, JWT_SECRET, {
    issuer: ISS,
    audience: AUD,
    algorithm: 'HS256',
    expiresIn: '7d',
  });
}

const tenants = [
  {
    id: 'tenant-a',
    users: [
      { sub: 'a-admin', email: 'admin@a.local', role: 'admin' },
      { sub: 'a-member', email: 'member@a.local', role: 'member' },
    ],
  },
  {
    id: 'tenant-b',
    users: [
      { sub: 'b-admin', email: 'admin@b.local', role: 'admin' },
      { sub: 'b-member', email: 'member@b.local', role: 'member' },
    ],
  },
];

for (const t of tenants) {
  // eslint-disable-next-line no-console
  console.log(`\nTenant: ${t.id}`);
  for (const u of t.users) {
    const token = sign(u.sub, t.id, u.email, u.role);
    // eslint-disable-next-line no-console
    console.log(`${u.role} token: ${token}`);
  }
}
