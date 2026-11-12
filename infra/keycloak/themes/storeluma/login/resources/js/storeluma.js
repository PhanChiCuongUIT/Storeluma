// Progressive presentation only; all authentication stays in Keycloak's forms.
document.addEventListener('DOMContentLoaded', () => {
  const prefs=window.storelumaPreferences;
  const english=document.documentElement.lang.startsWith('en');
  // The server-rendered locale is authoritative for this Keycloak step.
  prefs.setLanguage(english?'en':'vi');
  const toolbar=document.createElement('div');toolbar.className='auth-preferences';
  toolbar.setAttribute('role','group');toolbar.setAttribute('aria-label',english?'Display preferences':'Tùy chọn hiển thị');
  const localeSelect=document.getElementById('login-select-toggle');
  if(localeSelect){
    localeSelect.setAttribute('aria-label',english?'Language':'Ngôn ngữ');
    localeSelect.addEventListener('change',()=>{const url=new URL(localeSelect.value,location.href);prefs.setLanguage(url.searchParams.get('kc_locale')==='en'?'en':'vi');});
    toolbar.append(localeSelect);
    document.querySelector('.pf-v5-c-login__main-header-utilities')?.remove();
  }
  const theme=document.createElement('select');theme.setAttribute('aria-label',english?'Appearance':'Giao diện');
  for(const [value,vi,en] of [['system','Hệ thống','System'],['light','Sáng','Light'],['dark','Tối','Dark']]){const option=document.createElement('option');option.value=value;option.textContent=english?en:vi;theme.append(option);}
  theme.value=prefs.theme;theme.addEventListener('change',()=>prefs.setTheme(theme.value));toolbar.append(theme);
  document.querySelector('.pf-v5-c-login__container')?.prepend(toolbar);
  const guidance = document.querySelector('.auth-guidance');
  const title = document.getElementById('kc-page-title');
  if (guidance && title) {
    title.textContent = guidance.dataset.authTitle;
    const step = document.createElement('span');
    step.className = 'auth-step';
    step.textContent = guidance.dataset.authStep;
    title.before(step);
  }
  const otp = document.getElementById('otp');
  if (otp) {
    otp.setAttribute('inputmode', 'numeric');
    otp.setAttribute('autocomplete', 'one-time-code');
    const description = otp.getAttribute('aria-describedby');
    otp.setAttribute('aria-describedby', [description, 'storeluma-auth-help'].filter(Boolean).join(' '));
  }
});
