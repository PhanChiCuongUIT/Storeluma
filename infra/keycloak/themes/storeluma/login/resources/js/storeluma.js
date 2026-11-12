// Progressive presentation only; all authentication stays in Keycloak's forms.
document.addEventListener('DOMContentLoaded', () => {
  const prefs=window.storelumaPreferences;
  const english=document.documentElement.lang.startsWith('en');
  // The server-rendered locale is authoritative for this Keycloak step.
  prefs.setLanguage(english?'en':'vi');
  const toolbar=document.createElement('div');toolbar.className='auth-preferences';
  const localeSelect=document.getElementById('login-select-toggle');
  const localeUrls=new Map();
  for(const option of localeSelect?.options??[]){
    const url=new URL(option.value,location.href);
    const language=url.searchParams.get('kc_locale');
    if(url.origin===location.origin && ['vi','en'].includes(language)) localeUrls.set(language,url.href);
  }
  window.storelumaControls.mount(toolbar,{
    onLanguage(language){
      const url=localeUrls.get(language);
      if(!url || language===prefs.language) return;
      prefs.setLanguage(language);
      location.assign(url);
    }
  });
  if(localeSelect) document.querySelector('.pf-v5-c-login__main-header-utilities')?.remove();
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
