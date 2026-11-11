import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {fillFreshTotp} from './helpers/totp';

const account=JSON.parse(readFileSync('infra/generated/accounts.json','utf8'))[0];
test('UI-01 Sign-in error and password visibility remain usable at phone widths',async({page})=>{
  await page.goto('/');
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:900});
    await expect(page.getByRole('link',{name:'Đăng nhập vào Storeluma'})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  await page.getByRole('link',{name:'Đăng nhập vào Storeluma'}).click();
  await expect(page.locator('.auth-step')).toContainText('Bước 1');
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:900});
    await expect(page.locator('#username')).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  await page.setViewportSize({width:320,height:740});
  await page.locator('#username').fill('unknown-ui-account');
  await page.locator('#password').fill('invalid-test-password');
  await page.getByRole('button',{name:'Hiện mật khẩu'}).click();
  await expect(page.locator('#password')).toHaveAttribute('type','text');
  await page.getByRole('button',{name:'Ẩn mật khẩu'}).click();
  await expect(page.locator('#password')).toHaveAttribute('type','password');
  await page.locator('#kc-login').click();
  await expect(page.getByText('Tên đăng nhập hoặc mật khẩu không đúng.').first()).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('UI-02 TOTP, keyboard navigation and the phone menu preserve the real session',async({page})=>{
  await page.goto('/auth/login');
  await page.locator('#username').fill(account.username);
  await page.locator('#password').fill(account.password);
  await page.locator('#kc-login').click();
  await expect(page.getByRole('heading',{name:'Xác thực tài khoản'})).toBeVisible();
  await expect(page.locator('#otp')).toHaveAttribute('inputmode','numeric');
  await expect(page.locator('#otp')).toHaveAttribute('autocomplete','one-time-code');
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:900});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  await fillFreshTotp(page,account.otpSecret);
  await page.locator('#kc-login').click();
  await expect(page).toHaveURL('http://localhost:4100/');
  await expect(page.getByRole('button',{name:'Đăng xuất',exact:true})).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link',{name:'Đến nội dung chính'})).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
  for(const width of [320,390,680,700]){
    await page.setViewportSize({width,height:844});
    const menu=page.locator('.menu-toggle'),nav=page.getByRole('navigation',{name:'Điều hướng'});
    await expect(menu).toHaveAttribute('aria-expanded','false');
    await expect(nav).toBeHidden();
    await menu.click();
    await expect(menu).toHaveAttribute('aria-expanded','true');
    await nav.getByRole('button',{name:'Địa điểm',exact:true}).focus();
    await page.keyboard.press('Escape');
    await expect(menu).toBeFocused();
    await expect(nav).toBeHidden();
    await menu.press('Enter');
    await nav.getByRole('button',{name:'Địa điểm',exact:true}).click();
    await expect(nav).toBeHidden();
    await expect(page.locator('#main-content')).toBeFocused();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  await page.setViewportSize({width:1440,height:700});
  await expect(page.getByRole('navigation',{name:'Điều hướng'})).toBeVisible();
  await expect(page.locator('.menu-toggle')).toBeHidden();
  await page.getByRole('button',{name:'Đăng xuất',exact:true}).click();
  await expect(page.getByRole('link',{name:'Đăng nhập vào Storeluma'})).toBeVisible();
});
