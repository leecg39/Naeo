export function safeNext(value:unknown,fallback='/dashboard') {
  if(typeof value!=='string'||!/^\/(?!\/)/.test(value)||/[\\\r\n\t]/.test(value))return fallback;
  try {
    const decoded=decodeURIComponent(value);
    if(/^\/\//.test(decoded)||/[\\\r\n\t]/.test(decoded)||/^\/(login|api|auth)(\/|\?|#|$)/i.test(decoded))return fallback;
    const url=new URL(value,'http://local.invalid');
    if(url.origin!=='http://local.invalid')return fallback;
    return url.pathname+url.search+url.hash;
  }catch{return fallback;}
}
