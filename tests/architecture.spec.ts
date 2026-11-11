import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';

const env = Object.fromEntries(readFileSync('.env', 'utf8').split(/\r?\n/)
  .filter(line => line.includes('='))
  .map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
const services = ['business', 'catalog', 'inventory', 'sales', 'finance', 'reporting', 'notification', 'gateway', 'keycloak'];

test('ARCH-01 Every service database account is isolated from all other service databases', async () => {
  for (const service of services) {
    const db = new Pool({ host: '127.0.0.1', port: Number(env.PG_HOST_PORT ?? 55432),
      user: service, password: env[service.toUpperCase() + '_DB_PASSWORD'],
      database: service + '_db', max: 1, connectionTimeoutMillis: 5000 });
    try {
      const role = (await db.query(
        'SELECT current_user AS name, rolsuper, rolcreatedb, rolcreaterole, rolreplication FROM pg_roles WHERE rolname=current_user',
      )).rows[0];
      expect(role, service).toEqual({ name: service, rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false });
      for (const target of services) {
        const grants = (await db.query(
          `SELECT has_database_privilege(current_user,$1,'CONNECT') AS connect,
                  pg_has_role(current_user,$2,'MEMBER') AS member`,
          [target + '_db', target],
        )).rows[0];
        expect(grants, `${service} -> ${target}`).toEqual({ connect: service === target, member: service === target });
      }
    } finally { await db.end(); }
  }
});
