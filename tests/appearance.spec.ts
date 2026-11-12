import {test,expect,type Page} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {fillFreshTotp} from './helpers/totp';
import {t} from '../apps/web/src/i18n';

async function choose(page:Page,label:string,value:string){
  await page.getByRole('button',{name:label,exact:true}).click();
  await page.locator(`[role="menuitemradio"][data-value="${value}"]:visible`).click();
}

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
  await choose(page,'Giao diện','light');
  await choose(page,'Ngôn ngữ','en');
  await expect(page.getByRole('link',{name:'Sign in to Storeluma'})).toBeVisible();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang','en');
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await choose(page,'Appearance','system');
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await expect(page.locator('.brand-dark')).toBeVisible();
  await page.emulateMedia({colorScheme:'light'});
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await expect(page.locator('.brand-light')).toBeVisible();
  await expect(page.locator('.brand-dark')).toBeHidden();
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
  await choose(page,'Giao diện','dark');
  await choose(page,'Ngôn ngữ','en');
  await page.getByRole('link',{name:'Sign in to Storeluma'}).click();
  await expect(page.locator('html')).toHaveAttribute('lang',/^en/);
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await expect(page.getByRole('button',{name:'Language',exact:true})).toBeVisible();
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
  await choose(page,'Language','vi');
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
    for(const name of ['Appearance','Language']){
      await page.getByRole('button',{name,exact:true}).click();
      const box=await page.getByRole('menu').boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(width);
      await page.keyboard.press('Escape');
    }
  }
  await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await expect(page.getByRole('link',{name:'Sign in to Storeluma'})).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  expect(errors).toEqual([]);
});

test('DISPLAY-04 Keycloak language switching preserves theme on errors and logout confirmation',async({page})=>{
  await page.goto('/');await choose(page,'Giao diện','dark');
  await page.getByRole('link',{name:'Đăng nhập vào Storeluma'}).click();
  await choose(page,'Ngôn ngữ','en');
  await expect(page.locator('html')).toHaveAttribute('lang','en');
  await expect(page.locator('#kc-header-wrapper')).toHaveCSS('background-image',/Logo_Storeluma_Dark\.png/);
  await choose(page,'Appearance','light');
  await expect(page.locator('#kc-header-wrapper')).toHaveCSS('background-image',/Logo_Storeluma\.png/);
  await choose(page,'Appearance','dark');
  await page.locator('#username').fill('unknown-display-account');await page.locator('#password').fill('invalid-test-password');await page.locator('#kc-login').click();
  await expect(page.getByText('Invalid username or password.',{exact:true})).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.goto('http://localhost:8180/realms/storeluma/protocol/openid-connect/logout?client_id=storeluma-web');
  await expect(page.getByRole('heading')).toContainText('Logging out');
  await expect(page.getByRole('button',{name:'Appearance',exact:true})).toHaveAttribute('title','Appearance: Dark');
  await page.setViewportSize({width:320,height:740});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('DISPLAY-05 Icon menus support keyboard, dismissal and matching brand dimensions',async({page})=>{
  const pngSize=(file:string)=>{const b=readFileSync(file);return [b.readUInt32BE(16),b.readUInt32BE(20)];};
  expect(pngSize('apps/web/public/brand/Logo_Storeluma_Dark.png')).toEqual(pngSize('apps/web/public/brand/Logo_Storeluma.png'));
  await page.goto('/');await choose(page,'Giao diện','light');
  const original=await page.locator('.brand-light').boundingBox();
  const theme=page.getByRole('button',{name:'Giao diện',exact:true});
  await theme.focus();await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitemradio',{name:'Sáng',exact:true})).toBeFocused();
  await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
  await expect(theme).toBeFocused();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await expect(page.locator('.brand-light')).toBeHidden();
  expect(await page.locator('.brand-dark').boundingBox()).toEqual(original);
  await theme.press('ArrowUp');await expect(page.getByRole('menuitemradio',{name:'Hệ thống',exact:true})).toBeFocused();
  await page.keyboard.press('Home');await expect(page.getByRole('menuitemradio',{name:'Sáng',exact:true})).toBeFocused();
  await page.keyboard.press('End');await expect(page.getByRole('menuitemradio',{name:'Hệ thống',exact:true})).toBeFocused();
  await page.keyboard.press('Escape');await expect(theme).toBeFocused();await expect(page.getByRole('menu')).toBeHidden();
  await theme.click();await page.getByRole('button',{name:'Ngôn ngữ',exact:true}).click();
  await expect(theme).toHaveAttribute('aria-expanded','false');await expect(page.getByRole('menu')).toHaveCount(1);
  await page.keyboard.press('Tab');await expect(page.getByRole('menu')).toBeHidden();
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:900});
    for(const name of ['Giao diện','Ngôn ngữ']){
      await page.getByRole('button',{name,exact:true}).click();
      const box=await page.getByRole('menu').boundingBox();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(width);
      await page.locator('h1').click();await expect(page.getByRole('menu')).toBeHidden();
    }
  }
  expect(await page.locator('.brand-dark').evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth===1254)).toBe(true);
});
