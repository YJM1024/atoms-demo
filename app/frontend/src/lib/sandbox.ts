/**
 * Helpers for running generated apps inside a sandboxed iframe.
 *
 * The iframe runs without `allow-same-origin`, so touching `localStorage`
 * throws a SecurityError and crashes most generated apps. The storage shim
 * swaps in an in-memory Storage before any app script runs.
 */

export const STORAGE_SHIM = `(function(){
  function mk(){var d={};return{
    get length(){return Object.keys(d).length;},
    key:function(i){var k=Object.keys(d);return i<k.length?k[i]:null;},
    getItem:function(k){k=String(k);return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null;},
    setItem:function(k,v){d[String(k)]=String(v);},
    removeItem:function(k){delete d[String(k)];},
    clear:function(){d={};}
  };}
  ['localStorage','sessionStorage'].forEach(function(n){
    var ok=true;
    try{var s=window[n];s.setItem('__probe__','1');s.removeItem('__probe__');}catch(e){ok=false;}
    if(!ok){try{Object.defineProperty(window,n,{value:mk(),configurable:true});}catch(e){}}
  });
})();`;

/** Inserts an inline script as early as possible so it runs before app code. */
export function injectScript(html: string, script: string): string {
  const tag = `<script>${script}</script>`;
  const head = html.match(/<head[^>]*>/i);
  if (head && head.index !== undefined) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + tag + html.slice(at);
  }
  const root = html.match(/<html[^>]*>/i);
  if (root && root.index !== undefined) {
    const at = root.index + root[0].length;
    return html.slice(0, at) + tag + html.slice(at);
  }
  return tag + html;
}

export const buildPreviewDoc = (html: string) => (html ? injectScript(html, STORAGE_SHIM) : html);

export const PREVIEW_SANDBOX = 'allow-scripts allow-forms allow-modals allow-popups allow-pointer-lock';
