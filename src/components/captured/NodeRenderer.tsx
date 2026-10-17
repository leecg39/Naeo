'use client';

import { createElement, memo, type CSSProperties, type ReactNode, type SyntheticEvent } from 'react';
import type { CapturedNode } from '@/types/site';

const blockedTags = new Set(['script', 'iframe', 'object', 'embed', 'base', 'meta', 'link']);
const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const booleanAttrs = new Set(['allowFullScreen', 'async', 'autoFocus', 'autoPlay', 'checked', 'controls', 'default', 'defer', 'disabled', 'formNoValidate', 'hidden', 'inert', 'loop', 'multiple', 'muted', 'noModule', 'noValidate', 'open', 'playsInline', 'readOnly', 'required', 'reversed', 'scoped', 'selected']);
const attributeNames: Record<string, string> = {
  class: 'className', for: 'htmlFor', tabindex: 'tabIndex', readonly: 'readOnly',
  colspan: 'colSpan', rowspan: 'rowSpan', datetime: 'dateTime', srcset: 'srcSet',
  crossorigin: 'crossOrigin', referrerpolicy: 'referrerPolicy', fetchpriority: 'fetchPriority',
  autocomplete: 'autoComplete', autofocus: 'autoFocus', autoplay: 'autoPlay',
  acceptcharset: 'acceptCharset', 'accept-charset': 'acceptCharset', accesskey: 'accessKey',
  contenteditable: 'contentEditable', spellcheck: 'spellCheck', maxlength: 'maxLength',
  minlength: 'minLength', inputmode: 'inputMode', enterkeyhint: 'enterKeyHint',
  novalidate: 'noValidate', formnovalidate: 'formNoValidate', formaction: 'formAction',
  formenctype: 'formEncType', formmethod: 'formMethod', formtarget: 'formTarget',
  playsinline: 'playsInline', allowfullscreen: 'allowFullScreen', usemap: 'useMap',
  viewbox: 'viewBox', preserveaspectratio: 'preserveAspectRatio', pathlength: 'pathLength',
  gradientunits: 'gradientUnits', gradienttransform: 'gradientTransform',
  patternunits: 'patternUnits', patterncontentunits: 'patternContentUnits',
  patterntransform: 'patternTransform', markerwidth: 'markerWidth', markerheight: 'markerHeight',
  markerunits: 'markerUnits', refx: 'refX', refy: 'refY', textlength: 'textLength',
  lengthadjust: 'lengthAdjust', clippathunits: 'clipPathUnits', maskunits: 'maskUnits',
  maskcontentunits: 'maskContentUnits', filterunits: 'filterUnits', primitiveunits: 'primitiveUnits',
  'xlink:href': 'xlinkHref', 'xmlns:xlink': 'xmlnsXlink', 'xml:space': 'xmlSpace',
};
const svgTags: Record<string, string> = {
  lineargradient: 'linearGradient', radialgradient: 'radialGradient', clippath: 'clipPath',
  textpath: 'textPath', foreignobject: 'foreignObject',
  feblend: 'feBlend', fecolormatrix: 'feColorMatrix', fecomponenttransfer: 'feComponentTransfer',
  fecomposite: 'feComposite', fegaussianblur: 'feGaussianBlur', feoffset: 'feOffset',
  femerge: 'feMerge', femergenode: 'feMergeNode', feflood: 'feFlood',
};

/** Split declarations without breaking quoted URLs, gradients, or custom property values. */
function parseStyle(source: string): CSSProperties {
  const result: Record<string, string> = {};
  const declarations: string[] = [];
  let start = 0;
  let nesting = 0;
  let quote = '';
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (c === quote && source[i - 1] !== '\\') quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(') nesting++;
    else if (c === ')') nesting--;
    else if (c === ';' && nesting === 0) { declarations.push(source.slice(start, i)); start = i + 1; }
  }
  declarations.push(source.slice(start));
  for (const declaration of declarations) {
    const colon = declaration.indexOf(':');
    if (colon < 1) continue;
    const name = declaration.slice(0, colon).trim();
    const value = declaration.slice(colon + 1).trim().replace(/\s*!important\s*$/i, '');
    if (!value || /expression\s*\(|javascript\s*:/i.test(value)) continue;
    const property = name.startsWith('--') ? name : name.replace(/^-ms-/, 'ms-').replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    result[property] = value;
  }
  return result as CSSProperties;
}

function safeUrl(value: string, attribute: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed === '' && ['src', 'poster'].includes(attribute)) return;
  if (trimmed.startsWith('#') || trimmed === '') return trimmed;
  if (/^(?:javascript|vbscript):/i.test(trimmed.replace(/[\u0000-\u0020]/g, ''))) return;
  if (/^data:/i.test(trimmed) && !(attribute === 'src' && /^data:image\//i.test(trimmed))) return;
  try {
    const url = new URL(trimmed, 'https://www.naeo.kr');
    if (url.hostname === 'naeo.kr' || url.hostname === 'www.naeo.kr') {
      return `${url.pathname}${url.search}${url.hash}`;
    }
  } catch { return; }
  return trimmed;
}

function imageUnavailable(event: SyntheticEvent<HTMLImageElement>) {
  const element = event.currentTarget;
  element.dataset.assetUnavailable = 'true';
  element.classList.add('loaded');
  element.closest('.mdx-img-skeleton')?.classList.add('loaded');
  element.title = element.alt || '이미지를 불러올 수 없습니다';
  // Retain the captured box and show the real alt text, including missing intrinsic-size assets.
  if (element.getBoundingClientRect().height < 24) element.style.minHeight = '48px';
}

function imageLoaded(event: SyntheticEvent<HTMLImageElement>) {
  const element = event.currentTarget;
  const wrapper = element.closest('.mdx-img-skeleton');
  if (wrapper) {
    element.classList.add('loaded');
    wrapper.classList.add('loaded');
  }
}

function renderNode(node: CapturedNode, key: string, slots?:Record<string,ReactNode>): ReactNode {
  if (typeof node === 'string') return node;
  const slot=node.attrs['data-naeo-slot'];
  if(slot&&slots&&Object.hasOwn(slots,slot))return createElement('div',{key},slots[slot]);
  const lowerTag = node.tag.toLowerCase();
  if (blockedTags.has(lowerTag)) return null;
  const tag = svgTags[lowerTag] || lowerTag;
  const props: Record<string, unknown> = { key };
  for (const [rawName, value] of Object.entries(node.attrs || {})) {
    const lowerName = rawName.toLowerCase();
    if (/^on/i.test(rawName) || ['srcdoc', 'dangerouslysetinnerhtml', 'key', 'ref'].includes(lowerName)) continue;
    if (lowerName === 'style') { props.style = parseStyle(value); continue; }
    let name = attributeNames[lowerName] || rawName;
    if (!/^(data|aria)-/.test(name) && name.includes('-')) name = name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    if (['href', 'src', 'poster', 'action', 'formAction', 'xlinkHref'].includes(name)) {
      const url = safeUrl(value, name);
      if (url !== undefined) props[name] = url;
      continue;
    }
    if (booleanAttrs.has(name)) {
      if (name === 'selected') continue; // Selection belongs to the parent select, not individual options.
      props[name === 'checked' ? 'defaultChecked' : name] = value !== 'false';
      continue;
    }
    if (name === 'value' && ['input', 'textarea', 'select'].includes(tag)) name = 'defaultValue';
    props[name] = value;
  }
  if (tag === 'img') { props.onError = imageUnavailable; props.onLoad = imageLoaded; }
  if (tag === 'a' && props.target === '_blank') props.rel = 'noopener noreferrer';
  if (tag === 'button' && !props.type) props.type = 'button';
  if (tag === 'textarea') {
    props.defaultValue ??= node.children.filter((child): child is string => typeof child === 'string').join('');
    return createElement(tag, props);
  }
  if (tag === 'select' && props.defaultValue === undefined) {
    const selected = node.children.find(child => typeof child !== 'string' && child.tag === 'option' && 'selected' in child.attrs);
    if (selected && typeof selected !== 'string') props.defaultValue = selected.attrs.value ?? selected.children.join('');
  }
  if (voidTags.has(tag)) return createElement(tag, props);
  return createElement(tag, props, ...node.children.map((child, index) => renderNode(child, `${key}.${index}`,slots)));
}

export const NodeRenderer = memo(function NodeRenderer({ nodes,slots }: { nodes: CapturedNode[];slots?:Record<string,ReactNode> }) {
  return <>{nodes.map((node, index) => renderNode(node, String(index),slots))}</>;
});
