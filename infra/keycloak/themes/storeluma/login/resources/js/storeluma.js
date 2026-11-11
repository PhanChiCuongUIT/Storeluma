// Progressive presentation only; all authentication stays in Keycloak's forms.
document.addEventListener('DOMContentLoaded', () => {
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
