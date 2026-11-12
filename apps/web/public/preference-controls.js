/* Shared appearance menus for the application and identity-provider pages. */
(function () {
  let nextId = 0;
  const paths = {
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5"/>',
    moon: '<path d="M20.8 13A9 9 0 0 1 11 3.2 9 9 0 1 0 20.8 13Z"/>',
    system: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/>',
    globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>', check: '<path d="m5 12 4 4L19 6"/>'
  };
  const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
  window.storelumaControls = {
    mount(host, options = {}) {
      const prefs = window.storelumaPreferences;
      const controller = new AbortController();
      const on = (target, name, callback) => target.addEventListener(name, callback, {signal: controller.signal});
      host.classList.add('sl-preferences'); host.setAttribute('role', 'group');
      let opened;
      const position = () => {
        if (!opened) return;
        const {menu} = opened;
        menu.style.left = 'auto'; menu.style.right = '0';
        const box = menu.getBoundingClientRect();
        if (box.left < 8) {menu.style.left = `${8 - menu.parentElement.getBoundingClientRect().left}px`; menu.style.right = 'auto';}
      };
      const close = (restore = false) => {
        if (!opened) return;
        const previous = opened; opened = undefined;
        previous.menu.hidden = true; previous.button.setAttribute('aria-expanded', 'false');
        if (restore) previous.button.focus();
      };
      const menus = ['theme', 'language'].map(kind => {
        const wrapper = document.createElement('div'); wrapper.className = 'sl-preference';
        const button = document.createElement('button'); button.type = 'button'; button.className = 'sl-preference-trigger';
        button.dataset.preference = kind; button.setAttribute('aria-haspopup', 'menu'); button.setAttribute('aria-expanded', 'false');
        const menu = document.createElement('div'); menu.className = 'sl-preference-menu'; menu.hidden = true;
        menu.id = `sl-preference-${++nextId}`; menu.setAttribute('role', 'menu'); button.setAttribute('aria-controls', menu.id);
        const values = kind === 'theme' ? ['light', 'dark', 'system'] : ['vi', 'en'];
        const items = values.map(value => {
          const item = document.createElement('button'); item.type = 'button'; item.tabIndex = -1;
          item.setAttribute('role', 'menuitemradio'); item.dataset.value = value;
          on(item, 'click', () => {
            close(true);
            if (kind === 'theme') prefs.setTheme(value);
            else if (options.onLanguage) options.onLanguage(value);
            else prefs.setLanguage(value);
          });
          menu.append(item); return item;
        });
        const entry = {kind, button, menu, items};
        const open = (last = false) => {
          close(); opened = entry; menu.hidden = false; button.setAttribute('aria-expanded', 'true');
          position();
          items[last ? items.length - 1 : 0].focus();
        };
        on(button, 'click', () => opened === entry ? close() : open());
        on(button, 'keydown', event => {
          if (['ArrowDown', 'ArrowUp'].includes(event.key)) {event.preventDefault(); open(event.key === 'ArrowUp');}
        });
        on(menu, 'keydown', event => {
          const index = items.indexOf(document.activeElement);
          const target = {ArrowDown: (index + 1) % items.length, ArrowUp: (index + items.length - 1) % items.length, Home: 0, End: items.length - 1}[event.key];
          if (target !== undefined) {event.preventDefault(); items[target].focus();}
          else if (event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); close(true);}
          else if (event.key === 'Tab') close(true);
        });
        wrapper.append(button, menu); host.append(wrapper); return entry;
      });
      const update = () => {
        const english = prefs.language === 'en';
        host.setAttribute('aria-label', english ? 'Display preferences' : 'Tùy chọn hiển thị');
        for (const {kind, button, menu, items} of menus) {
          const label = kind === 'theme' ? (english ? 'Appearance' : 'Giao diện') : (english ? 'Language' : 'Ngôn ngữ');
          const labels = {light: english ? 'Light' : 'Sáng', dark: english ? 'Dark' : 'Tối', system: english ? 'System' : 'Hệ thống', vi: 'Tiếng Việt', en: 'English'};
          button.setAttribute('aria-label', label); button.title = `${label}: ${labels[prefs[kind]]}`;
          button.innerHTML = kind === 'theme' ? icon(document.documentElement.dataset.theme === 'dark' ? 'moon' : 'sun') : `${icon('globe')}<span>${prefs.language.toUpperCase()}</span>${icon('chevron')}`;
          menu.setAttribute('aria-label', label);
          for (const item of items) {
            const value = item.dataset.value;
            item.setAttribute('aria-checked', String(prefs[kind] === value));
            item.innerHTML = `${kind === 'theme' ? icon(value === 'light' ? 'sun' : value === 'dark' ? 'moon' : 'system') : `<span class="sl-language-code">${value.toUpperCase()}</span>`}<span>${labels[value]}</span><span class="sl-preference-check">${icon('check')}</span>`;
          }
        }
      };
      on(document, 'pointerdown', event => {if (!host.contains(event.target)) close();});
      on(document, 'focusin', event => {if (!host.contains(event.target)) close();});
      on(window, 'storeluma-preferences', update); update();
      on(window, 'resize', position);
      return () => {controller.abort(); host.replaceChildren();};
    }
  };
})();
