export const APP_VERSION = '0.1.0';

function boot(){
  const ver = document.getElementById('ver');
  if (ver) ver.textContent = 'v' + APP_VERSION;
  console.log('[tracker-v2] boot', APP_VERSION);
}
boot();
