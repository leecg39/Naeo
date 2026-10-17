/**
 * 로그인·약관 뒤 이동할 내부 경로만 허용한다.
 * URL 정규화('/./', '/a/../', '%2e') 뒤의 결과도 다시 검사해 '//evil.com' 같은 프로토콜 상대 주소로 바뀌는 우회를 막는다.
 */
export function safeNext(value:unknown,fallback='/dashboard') {
  if(typeof value!=='string'||value.length>500||!/^\/(?!\/)/.test(value)||/[\\\r\n\t]/.test(value))return fallback;
  try {
    const blocked=(path:string)=>/^\/\//.test(path)||/[\\\r\n\t]/.test(path)||/^\/(login|api|auth)(\/|\?|#|$)/i.test(path);
    if(blocked(decodeURIComponent(value)))return fallback;
    const url=new URL(value,'http://local.invalid');
    if(url.origin!=='http://local.invalid')return fallback;
    const out=url.pathname+url.search+url.hash;
    if(blocked(out)||blocked(decodeURIComponent(url.pathname)))return fallback;
    return out;
  }catch{return fallback;}
}
