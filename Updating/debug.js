// debug.js - quick runtime checks & button click logging (temporary)
(function(){
  console.log("[debug] page loaded. Timestamp:", new Date().toISOString());

  // report presence of key globals
  console.log("[debug] window.Auth:", !!window.Auth, window.Auth);
  console.log("[debug] window.UI:", !!window.UI, window.UI);

  // Log some important DOM elements
  ['loginButtons','phoneForm','emailForm','recaptcha-container','toggleSearchBtn'].forEach(id=>{
    const el = document.getElementById(id);
    console.log(`[debug] element ${id}:`, !!el, el);
  });

  // Attach click listeners to log interactions
  document.querySelectorAll('button, a').forEach(el=>{
    el.addEventListener('click', (e) => {
      console.log('[debug] CLICK:', el.id || el.innerText || el.className);
    }, {capture:true});
  });

  console.log("[debug] For reCAPTCHA issues, run in console after opening phone form:");
  console.log("  window.recaptchaVerifier");
  console.log("  window.grecaptcha");
  console.log("  document.getElementById('recaptcha-container')?.innerHTML");
})();