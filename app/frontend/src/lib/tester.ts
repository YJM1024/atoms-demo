/**
 * Tester agent: static checks plus a real run of the app in a hidden sandboxed
 * iframe that reports runtime exceptions, console.error, unhandled rejections,
 * resource failures, blank renders and errors raised during a smoke interaction.
 */
import { STORAGE_SHIM, injectScript } from './sandbox';

export type CheckStatus = 'pass' | 'fail' | 'warn';

export interface TestItem {
  key: string;
  name: string;
  status: CheckStatus;
  details: string[];
}

export interface TestReport {
  passed: boolean;
  truncated: boolean;
  items: TestItem[];
  issues: string[];
  durationMs: number;
}

interface ProbeIssues {
  runtime: string[];
  console: string[];
  resource: string[];
  interaction: string[];
  form: string[];
}

interface ProbeResult {
  issues: ProbeIssues;
  render: { text: number; media: number; elements: number };
  acted: number;
}

const RUNTIME_TIMEOUT = 15000;

const PROBE = (token: string) => `(function(){
var TOKEN=${JSON.stringify(token)};
var issues={runtime:[],console:[],resource:[],interaction:[],form:[]};
var phase='load';var done=false;
function txt(v){try{if(v instanceof Error)return v.name+': '+v.message;if(v&&typeof v==='object')return JSON.stringify(v).slice(0,200);return String(v);}catch(e){return String(v);}}
function add(kind,msg){msg=String(msg).slice(0,300);var list=(phase==='interaction'&&(kind==='runtime'||kind==='console'))?issues.interaction:issues[kind];if(list.indexOf(msg)<0&&list.length<8)list.push(msg);}
window.addEventListener('error',function(e){var t=e.target;
  if(t&&t!==window&&(t.src||t.href)){add('resource',(t.tagName||'').toLowerCase()+' 加载失败: '+(t.src||t.href));return;}
  add('runtime',(e.message||'未知错误')+(e.lineno?' (第 '+e.lineno+' 行)':''));},true);
window.addEventListener('unhandledrejection',function(e){add('runtime','未处理的 Promise 拒绝: '+txt(e.reason));});
var ce=console.error;console.error=function(){try{add('console',Array.prototype.map.call(arguments,txt).join(' '));}catch(_){}return ce.apply(console,arguments);};
window.alert=function(){};window.confirm=function(){return true;};window.prompt=function(){return '';};
window.addEventListener('submit',function(e){if(!e.defaultPrevented){add('form','表单提交没有调用 preventDefault，提交后页面会重新加载');e.preventDefault();}});
function visible(el){var r=el.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(el).visibility!=='hidden';}
function snapshot(){var b=document.body;return{text:b?(b.innerText||'').trim().length:0,media:document.querySelectorAll('canvas,svg,img,video').length,elements:b?b.querySelectorAll('*').length:0};}
function smoke(){phase='interaction';var acted=0;
  try{
    var inputs=Array.prototype.slice.call(document.querySelectorAll('input:not([type=hidden]):not([type=file]),textarea')).filter(visible).slice(0,6);
    inputs.forEach(function(el){var t=(el.type||'').toLowerCase();
      try{if(t==='checkbox'||t==='radio'){el.click();}else{el.focus();
        el.value=(t==='number'||t==='range')?'12':(t==='date'?'2026-01-01':(t==='color'?'#336699':'测试123'));
        el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
        el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,bubbles:true}));}acted++;}catch(err){add('runtime',txt(err));}});
    var btns=Array.prototype.slice.call(document.querySelectorAll('button,[role=button],input[type=button],input[type=submit]')).filter(visible).slice(0,15);
    btns.forEach(function(b){try{b.click();acted++;}catch(err){add('runtime',txt(err));}});
    ['ArrowUp','ArrowRight','ArrowDown','ArrowLeft',' ','Enter'].forEach(function(k){var o={key:k,code:k===' '?'Space':k,bubbles:true};
      document.dispatchEvent(new KeyboardEvent('keydown',o));document.dispatchEvent(new KeyboardEvent('keyup',o));});
  }catch(err){add('runtime',txt(err));}
  return acted;}
function run(){if(done)return;done=true;
  setTimeout(function(){var render=snapshot();var acted=smoke();
    setTimeout(function(){parent.postMessage({type:'app-probe',token:TOKEN,issues:issues,render:render,acted:acted},'*');},1200);},700);}
window.addEventListener('load',run);setTimeout(run,6000);
})();`;

function runtimeCheck(html: string, storageShim: boolean): Promise<ProbeResult | null> {
  return new Promise((resolve) => {
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts allow-forms');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.style.cssText = 'position:fixed;left:-20000px;top:0;width:1280px;height:800px;opacity:0;pointer-events:none;border:0;';

    let timer = 0;
    const finish = (result: ProbeResult | null) => {
      window.clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      frame.remove();
      resolve(result);
    };
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; token?: string } & ProbeResult;
      if (event.source !== frame.contentWindow || data?.type !== 'app-probe' || data.token !== token) return;
      finish({ issues: data.issues, render: data.render, acted: data.acted });
    };

    window.addEventListener('message', onMessage);
    timer = window.setTimeout(() => finish(null), RUNTIME_TIMEOUT);
    const script = storageShim ? STORAGE_SHIM + PROBE(token) : PROBE(token);
    frame.srcdoc = injectScript(html, script);
    document.body.appendChild(frame);
  });
}

const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;

function staticCheck(html: string): TestItem[] {
  const structure: string[] = [];
  const tail = html.trim().slice(-60).replace(/\s+/g, ' ');
  if (!/<\/html>\s*$/i.test(html.trim())) structure.push(`缺少 </html>，代码疑似被截断（结尾为「…${tail}」）`);
  if (!/<\/body>/i.test(html)) structure.push('缺少 </body> 结束标签');
  const scriptOpen = count(html, /<script\b/gi);
  const scriptClose = count(html, /<\/script>/gi);
  if (scriptOpen !== scriptClose) structure.push(`<script> 标签未闭合（开始 ${scriptOpen} 个，结束 ${scriptClose} 个）`);
  const styleOpen = count(html, /<style\b/gi);
  const styleClose = count(html, /<\/style>/gi);
  if (styleOpen !== styleClose) structure.push(`<style> 标签未闭合（开始 ${styleOpen} 个，结束 ${styleClose} 个）`);
  const structureWarn = /^\s*<!doctype html/i.test(html) ? [] : ['缺少 <!DOCTYPE html> 声明'];

  const syntax: string[] = [];
  const deps: string[] = [];
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script').forEach((el, i) => {
    const src = el.getAttribute('src');
    if (src) {
      if (/^https?:|^\/\//i.test(src)) deps.push(`外部脚本 ${src}`);
      else syntax.push(`引用了无法在单文件中加载的本地脚本 ${src}`);
      return;
    }
    const type = (el.getAttribute('type') ?? '').trim().toLowerCase();
    if (type && !['text/javascript', 'application/javascript', 'module'].includes(type)) return;
    if (type === 'module') return;
    try {
      // Compiles without executing: catches syntax errors and truncated scripts.
      new Function(el.textContent ?? '');
    } catch (err) {
      syntax.push(`第 ${i + 1} 个脚本：${(err as Error).name}: ${(err as Error).message}`);
    }
  });
  doc.querySelectorAll('link[href]').forEach((el) => {
    const href = el.getAttribute('href') ?? '';
    if (/^https?:|^\/\//i.test(href)) deps.push(`外部样式 ${href}`);
  });

  const refs: string[] = [];
  const ids = new Set<string>();
  for (const m of html.matchAll(/getElementById\(\s*['"`]([\w-]+)['"`]\s*\)/g)) ids.add(m[1]);
  ids.forEach((name) => {
    const defined = new RegExp(`id\\s*[=:]\\s*\\\\?['"\`]${name}\\\\?['"\`]|\\.id\\s*=\\s*['"\`]${name}['"\`]`).test(html);
    if (!defined) refs.push(`脚本引用了 #${name}，但页面中没有找到对应元素`);
  });

  return [
    {
      key: 'structure',
      name: 'HTML 结构完整性',
      status: structure.length ? 'fail' : structureWarn.length ? 'warn' : 'pass',
      details: [...structure, ...structureWarn],
    },
    { key: 'syntax', name: '脚本语法检查', status: syntax.length ? 'fail' : 'pass', details: syntax },
    { key: 'refs', name: 'DOM 引用检查', status: refs.length ? 'warn' : 'pass', details: refs },
    { key: 'deps', name: '外部依赖', status: deps.length ? 'warn' : 'pass', details: deps },
  ];
}

export async function runTests(
  html: string,
  onProgress?: (label: string) => void,
  options: { storageShim?: boolean } = {},
): Promise<TestReport> {
  const started = performance.now();
  onProgress?.('静态检查 HTML 结构与脚本语法');
  const items = staticCheck(html);
  const truncated = items[0].status === 'fail';

  onProgress?.('在沙箱中运行应用，并进行交互冒烟测试');
  const probe = await runtimeCheck(html, options.storageShim ?? true);

  if (!probe) {
    items.push({
      key: 'runtime',
      name: '沙箱运行',
      status: 'fail',
      details: [`页面在 ${RUNTIME_TIMEOUT / 1000} 秒内没有完成测试，可能存在死循环或脚本阻塞`],
    });
  } else {
    const { issues, render, acted } = probe;
    const localResources = issues.resource.filter((r) => !/https?:\/\//i.test(r));
    const remoteResources = issues.resource.filter((r) => /https?:\/\//i.test(r));
    const blank = render.text === 0 && render.media === 0 && render.elements < 3;
    items.push(
      { key: 'runtime', name: '运行时异常', status: issues.runtime.length ? 'fail' : 'pass', details: issues.runtime },
      { key: 'console', name: 'console.error', status: issues.console.length ? 'fail' : 'pass', details: issues.console },
      {
        key: 'resource',
        name: '资源加载',
        status: localResources.length ? 'fail' : remoteResources.length ? 'warn' : 'pass',
        details: issues.resource,
      },
      {
        key: 'render',
        name: '页面渲染',
        status: blank ? 'fail' : 'pass',
        details: blank ? ['页面加载后是空白的，没有渲染任何内容'] : [],
      },
      {
        key: 'interaction',
        name: `交互冒烟（操作 ${acted} 个控件）`,
        status: issues.interaction.length || issues.form.length ? 'fail' : 'pass',
        details: [...issues.interaction, ...issues.form],
      },
    );
  }

  const issues = items.filter((i) => i.status === 'fail').flatMap((i) => i.details.map((d) => `[${i.name}] ${d}`));
  return { passed: issues.length === 0, truncated, items, issues, durationMs: Math.round(performance.now() - started) };
}

const ICON: Record<CheckStatus, string> = { pass: '✅', fail: '❌', warn: '⚠️' };

export function formatReport(
  report: TestReport,
  ctx: { version: number; round: number; maxRounds: number; outcome: 'pass' | 'fixing' | 'fail' },
): string {
  const lines = report.items.map((item) => {
    const detail = item.details.length ? `：${item.details.slice(0, 3).join('；')}` : '';
    return `- ${ICON[item.status]} ${item.name}${item.status === 'pass' ? '' : detail}`;
  });
  const passCount = report.items.filter((i) => i.status !== 'fail').length;
  const head = `**测试报告 · v${ctx.version}**（${passCount}/${report.items.length} 项通过 · 修复轮次 ${ctx.round}/${ctx.maxRounds} · 用时 ${(report.durationMs / 1000).toFixed(1)}s）`;
  const tail =
    ctx.outcome === 'pass'
      ? `\n\n**结论：测试通过，v${ctx.version} 已交付。**`
      : ctx.outcome === 'fixing'
        ? `\n\n**结论：发现 ${report.issues.length} 个问题，已交给工程师自动修复。**`
        : `\n\n**结论：已达到 ${ctx.maxRounds} 轮自动修复上限，仍有 ${report.issues.length} 个问题未解决。** 可以点击下方按钮再次自动修复，或者直接描述问题让团队处理。`;
  return `${head}\n\n${lines.join('\n')}${tail}`;
}
