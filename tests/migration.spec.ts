import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, mkdirSync, mkdtempSync, copyFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Pool } from 'pg';

const exec = promisify(execFile);
const env = Object.fromEntries(readFileSync('.env', 'utf8').split(/\r?\n/)
  .filter(x => x.includes('=')).map(x => [x.slice(0, x.indexOf('=')), x.slice(x.indexOf('=') + 1)]));

test('MIG-01 Existing receipt history survives upgrade, concurrent restart and a failed migration', async () => {
  // An isolated disposable database, never the application's inventory_db.
  const name = 'storeluma_migration_' + randomUUID().replaceAll('-', '');
  const connection = { host: '127.0.0.1', port: 55432, user: 'postgres', password: env.PG_ADMIN_PASSWORD };
  const admin = new Pool({ ...connection, database: 'postgres', max: 1 });
  const fixture = new Pool({ ...connection, database: name, max: 1 });
  mkdirSync('tmp', { recursive: true });
  const workspace = mkdtempSync(resolve('tmp/migration-'));
  const directory = join(workspace, 'services/inventory/migrations');
  mkdirSync(directory, { recursive: true });
  const moduleUrl = pathToFileURL(resolve('dist/packages/platform/db.js')).href;
  const url = new URL('postgresql://127.0.0.1:55432/' + name);
  url.username = 'postgres'; url.password = env.PG_ADMIN_PASSWORD;
  const migrate = () => exec(process.execPath, ['--input-type=module', '-e',
    `const {migrate,db}=await import(${JSON.stringify(moduleUrl)}); try{await migrate('inventory')}finally{await db.end()}`],
    { cwd: workspace, env: { ...process.env, DATABASE_URL: url.href }, timeout: 30000 });
  let created = false;
  try {
    await admin.query(`CREATE DATABASE "${name}"`); created = true;
    for (const file of ['001.sql', '002.sql']) copyFileSync('services/inventory/migrations/' + file, join(directory, file));
    await migrate();
    const tenant = randomUUID(), warehouse = randomUUID(), site = randomUUID(), sku = randomUUID();
    await fixture.query('INSERT INTO warehouses(id,tenant_id,site_id,name) VALUES($1,$2,$3,$4)', [warehouse, tenant, site, 'Kho trước nâng cấp']);
    const ids: string[] = [];
    for (const [index, qty, value] of [[0, '10.000', '100000'], [1, '5.000', '60000']] as const) {
      const receipt = randomUUID(), line = randomUUID(), movement = randomUUID(); ids.push(movement);
      await fixture.query("INSERT INTO receipts(id,tenant_id,site_id,warehouse_id,code,source_type,status,total_vnd,created_by) VALUES($1,$2,$3,$4,$5,'OPENING_STOCK','POSTED',$6,'migration-fixture')", [receipt, tenant, site, warehouse, 'OLD-' + index, value]);
      await fixture.query("INSERT INTO receipt_lines(id,tenant_id,receipt_id,position,sku_id,unit_id,sku_code,sku_name,unit_name,base_unit,factor,qty,qty_base,unit_cost_vnd,total_vnd) VALUES($1,$2,$3,0,$4,$5,'OLD-SKU','Hàng trước nâng cấp','Hộp','Hộp',1,$6,$6,$7,$8)", [line, tenant, receipt, sku, randomUUID(), qty, index ? '12000' : '10000', value]);
      await fixture.query("INSERT INTO stock_movements(id,tenant_id,warehouse_id,sku_id,receipt_id,line_id,qty_base,value_vnd,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)", [movement, tenant, warehouse, sku, receipt, line, qty, value, `2026-10-15T10:0${index}:00Z`]);
    }
    await fixture.query("INSERT INTO stock_balances(id,tenant_id,warehouse_id,sku_id,on_hand,inventory_value,avg_cost,version) VALUES($1,$2,$3,$4,15,160000,10666.666667,2)", [randomUUID(), tenant, warehouse, sku]);
    const before = (await fixture.query('SELECT * FROM stock_balances')).rows;
    const receipts = (await fixture.query('SELECT * FROM receipts ORDER BY code')).rows;
    const lines = (await fixture.query('SELECT * FROM receipt_lines ORDER BY id')).rows;
    copyFileSync('services/inventory/migrations/003.sql', join(directory, '003.sql'));
    await Promise.all([migrate(), migrate()]);
    await migrate();
    expect((await fixture.query('SELECT version FROM schema_migrations ORDER BY version')).rows.map(x => x.version)).toEqual(['001', '002', '003']);
    expect((await fixture.query('SELECT * FROM stock_balances')).rows).toEqual(before);
    expect((await fixture.query('SELECT * FROM receipts ORDER BY code')).rows).toEqual(receipts);
    expect((await fixture.query('SELECT * FROM receipt_lines ORDER BY id')).rows).toEqual(lines);
    const movements = (await fixture.query('SELECT * FROM stock_movements ORDER BY created_at')).rows;
    expect(movements.map(x => x.id)).toEqual(ids);
    expect(movements.map(x => [x.on_hand_before, x.on_hand_after, x.value_before, x.value_after])).toEqual([
      ['0.000', '10.000', '0', '100000'], ['10.000', '15.000', '100000', '160000'],
    ]);
    for (const m of movements) {
      expect(m.reconstructed).toBe(true);
      expect(m.document_type).toBe('RECEIPT');
      expect(m.document_id).toBe(m.receipt_id);
      expect(m.document_line_id).toBe(m.line_id);
      expect(m.sku_name).toBe('Hàng trước nâng cấp');
    }
    // Exercise the same migration runner's rollback on a populated database.
    writeFileSync(join(directory, '004.sql'), 'CREATE TABLE failed_migration_probe(id int); SELECT 1/0;');
    const failed = await migrate().then(() => false, () => true);
    expect(failed).toBe(true);
    expect((await fixture.query("SELECT to_regclass('failed_migration_probe') AS object")).rows[0].object).toBeNull();
    expect((await fixture.query("SELECT 1 FROM schema_migrations WHERE version='004'")).rowCount).toBe(0);
    unlinkSync(join(directory, '004.sql'));
    await migrate();
    expect((await fixture.query('SELECT * FROM stock_balances')).rows).toEqual(before);
    expect((await fixture.query('SELECT * FROM stock_movements ORDER BY created_at')).rows).toEqual(movements);
  } finally {
    await fixture.end();
    if (created && /^storeluma_migration_[a-f0-9]{32}$/.test(name)) await admin.query(`DROP DATABASE "${name}"`);
    await admin.end();
  }
});
