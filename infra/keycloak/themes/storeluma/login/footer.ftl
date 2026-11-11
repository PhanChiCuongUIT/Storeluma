<#macro content>
  <#if pageId == "login" || pageId == "login-otp">
    <div class="auth-guidance" data-auth-title="${msg((pageId == 'login-otp')?then('storelumaOtpTitle', 'loginAccountTitle'))}" data-auth-step="${msg((pageId == 'login-otp')?then('storelumaStepTwo', 'storelumaStepOne'))}">
      <strong>${msg("storelumaSecureLogin")}</strong>
      <p id="storeluma-auth-help">${msg((pageId == 'login-otp')?then('storelumaOtpHelp', 'storelumaPasswordHelp'))}</p>
    </div>
  </#if>
</#macro>
