import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {fillFreshTotp} from './helpers/totp';
import {t} from '../apps/web/src/i18n';

test('DISPLAY-01 Language catalog preserves placeholders and translates notices without changing arguments',()=>{
  const catalog={...JSON.parse(readFileSync('apps/web/src/messages.en.json','utf8')),...JSON.parse(readFileSync('apps/web/src/messages.errors.en.json','utf8'))};
  for(const [vi,en] of Object.entries(catalog)){
    expect(String(en).trim(),vi).not.toBe('');
    expect([...String(en).matchAll(/\{\d+\}/g)].map(m=>m[0]).sort(),vi).toEqual([...vi.matchAll(/\{\d+\}/g)].map(m=>m[0]).sort());
  }
  const scope=globalThis as any;const before=scope.window;
  try{
    scope.window={storelumaPreferences:{language:'en'}};
    expect(t('Sắp hết hàng: Cà phê (250g)')).toBe('Low stock: Cà phê (250g)');
    expect(t('Cà phê (250g)')).toBe('Cà phê (250g)');
    scope.window.storelumaPreferences.language='vi';
    expect(t('Low stock: Cà phê (250g)')).toBe('Sắp hết hàng: Cà phê (250g)');
  }finally{scope.window=before;}
});

test('DISPLAY-02 System appearance, explicit preference and language persist across reload',async({page})=>{
  await page.emulateMedia({colorScheme:'dark'});await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.getByLabel('Giao diện',{exact:true}).selectOption('light');
  await page.getByLabel('Ngôn ngữ',{exact:true}).selectOption('en');
  await expect(page.getByRole('link',{name:'Sign in to Storeluma'})).toBeVisible();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang','en');
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await page.getByLabel('Appearance',{exact:true}).selectOption('system');
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.emulateMedia({colorScheme:'light'});
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:900});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
});

test('DISPLAY-03 English dark sign-in, TOTP and authenticated navigation share preferences',async({page})=>{
  test.setTimeout(120000);
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const account=JSON.parse(readFileSync('infra/generated/accounts.json','utf8'))[0];
  await page.goto('/');
  await page.getByLabel('Giao diện',{exact:true}).selectOption('dark');
  await page.getByLabel('Ngôn ngữ',{exact:true}).selectOption('en');
  await page.getByRole('link',{name:'Sign in to Storeluma'}).click();
  await expect(page.locator('html')).toHaveAttribute('lang',/^en/);
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await expect(page.getByLabel('Language',{exact:true})).toBeVisible();
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:900});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  await page.locator('#username').fill(account.username);await page.locator('#password').fill(account.password);
  await page.locator('#kc-login').click();
  await expect(page.locator('.auth-step')).toContainText('Step 2');
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await fillFreshTotp(page,account.otpSecret);await page.locator('#kc-login').click();
  await expect(page).toHaveURL('http://localhost:4100/');
  await expect(page.getByRole('button',{name:'Sign out',exact:true})).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang','en');
  await page.getByLabel('Language',{exact:true}).selectOption('vi');
  await expect(page.getByRole('button',{name:'Đăng xuất',exact:true})).toBeVisible();
  await page.locator('.heading-actions').getByRole('button',{name:'Tạo hộ kinh doanh',exact:true}).click();
  const draft=page.getByRole('dialog').locator('input[name="name"]');await draft.fill('Tên giữ nguyên');
  // Changing the shared preference must rerender labels without remounting a form.
  await page.evaluate(()=>window.storelumaPreferences.setLanguage('en'));
  await expect(draft).toHaveValue('Tên giữ nguyên');
  await page.keyboard.press('Escape');
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:900});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await expect(page.getByRole('link',{name:'Sign in to Storeluma'})).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  expect(errors).toEqual([]);
});

test('DISPLAY-04 Keycloak language switching preserves theme on errors and logout confirmation',async({page})=>{
  await page.goto('/');await page.getByLabel('Giao diện',{exact:true}).selectOption('dark');
  await page.getByRole('link',{name:'Đăng nhập vào Storeluma'}).click();
  await expect(page.locator('#login-select-toggle')).toBeVisible();
  const english=await page.getByLabel('Ngôn ngữ',{exact:true}).locator('option').evaluateAll(options=>(options as HTMLOptionElement[]).find(o=>o.textContent?.trim()==='English')!.value);
  await page.getByLabel('Ngôn ngữ',{exact:true}).selectOption(english);
  await expect(page.locator('html')).toHaveAttribute('lang','en');
  await page.locator('#username').fill('unknown-display-account');await page.locator('#password').fill('invalid-test-password');await page.locator('#kc-login').click();
  await expect(page.getByText('Invalid username or password.',{exact:true})).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.goto('http://localhost:8180/realms/storeluma/protocol/openid-connect/logout?client_id=storeluma-web');
  await expect(page.getByRole('heading')).toContainText('Logging out');
  await expect(page.getByLabel('Appearance',{exact:true})).toHaveValue('dark');
  await page.setViewportSize({width:320,height:740});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
