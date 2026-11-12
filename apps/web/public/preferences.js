/* Shared by the application and the Keycloak login theme. Contains no credentials. */
(function () {
  const root = document.documentElement;
  const read = name => document.cookie.split('; ').find(item => item.startsWith(name + '='))?.split('=')[1];
  let language = read('sl_language') === 'en' ? 'en' : 'vi';
  let theme = ['light', 'dark', 'system'].includes(read('sl_theme')) ? read('sl_theme') : 'system';
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const apply = () => {
    root.dataset.theme = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;
    root.style.colorScheme = root.dataset.theme;
    // Keycloak's rendered language is set by its own message bundle.
    if (!location.pathname.includes('/realms/')) root.lang = language;
    window.dispatchEvent(new Event('storeluma-preferences'));
  };
  const save = (key,value) => { document.cookie = `${key}=${value}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol==='https:'?'; Secure':''}`; };
  window.storelumaPreferences = {
    get language() { return language; },
    get theme() { return theme; },
    setLanguage(value) { if (!['vi','en'].includes(value)) return; language=value;save('sl_language',value);apply(); },
    setTheme(value) { if (!['light','dark','system'].includes(value)) return;theme=value;save('sl_theme',value);apply(); },
    snapshot() { return language+':'+theme; }
  };
  media.addEventListener('change',apply);
  apply();
})();
