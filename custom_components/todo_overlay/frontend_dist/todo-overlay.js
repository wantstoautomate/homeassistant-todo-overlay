var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __decorateClass = (decorators, target, key, kind) => {
  var result = kind > 1 ? void 0 : kind ? __getOwnPropDesc(target, key) : target;
  for (var i7 = decorators.length - 1, decorator; i7 >= 0; i7--)
    if (decorator = decorators[i7])
      result = (kind ? decorator(target, key, result) : decorator(result)) || result;
  if (kind && result) __defProp(target, key, result);
  return result;
};

// node_modules/@lit/reactive-element/css-tag.js
var t = globalThis;
var e = t.ShadowRoot && (void 0 === t.ShadyCSS || t.ShadyCSS.nativeShadow) && "adoptedStyleSheets" in Document.prototype && "replace" in CSSStyleSheet.prototype;
var s = Symbol();
var o = /* @__PURE__ */ new WeakMap();
var n = class {
  constructor(t5, e7, o7) {
    if (this._$cssResult$ = true, o7 !== s) throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");
    this.cssText = t5, this.t = e7;
  }
  get styleSheet() {
    let t5 = this.o;
    const s4 = this.t;
    if (e && void 0 === t5) {
      const e7 = void 0 !== s4 && 1 === s4.length;
      e7 && (t5 = o.get(s4)), void 0 === t5 && ((this.o = t5 = new CSSStyleSheet()).replaceSync(this.cssText), e7 && o.set(s4, t5));
    }
    return t5;
  }
  toString() {
    return this.cssText;
  }
};
var r = (t5) => new n("string" == typeof t5 ? t5 : t5 + "", void 0, s);
var i = (t5, ...e7) => {
  const o7 = 1 === t5.length ? t5[0] : e7.reduce((e8, s4, o8) => e8 + ((t6) => {
    if (true === t6._$cssResult$) return t6.cssText;
    if ("number" == typeof t6) return t6;
    throw Error("Value passed to 'css' function must be a 'css' function result: " + t6 + ". Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.");
  })(s4) + t5[o8 + 1], t5[0]);
  return new n(o7, t5, s);
};
var S = (s4, o7) => {
  if (e) s4.adoptedStyleSheets = o7.map((t5) => t5 instanceof CSSStyleSheet ? t5 : t5.styleSheet);
  else for (const e7 of o7) {
    const o8 = document.createElement("style"), n6 = t.litNonce;
    void 0 !== n6 && o8.setAttribute("nonce", n6), o8.textContent = e7.cssText, s4.appendChild(o8);
  }
};
var c = e ? (t5) => t5 : (t5) => t5 instanceof CSSStyleSheet ? ((t6) => {
  let e7 = "";
  for (const s4 of t6.cssRules) e7 += s4.cssText;
  return r(e7);
})(t5) : t5;

// node_modules/@lit/reactive-element/reactive-element.js
var { is: i2, defineProperty: e2, getOwnPropertyDescriptor: h, getOwnPropertyNames: r2, getOwnPropertySymbols: o2, getPrototypeOf: n2 } = Object;
var a = globalThis;
var c2 = a.trustedTypes;
var l = c2 ? c2.emptyScript : "";
var p = a.reactiveElementPolyfillSupport;
var d = (t5, s4) => t5;
var u = { toAttribute(t5, s4) {
  switch (s4) {
    case Boolean:
      t5 = t5 ? l : null;
      break;
    case Object:
    case Array:
      t5 = null == t5 ? t5 : JSON.stringify(t5);
  }
  return t5;
}, fromAttribute(t5, s4) {
  let i7 = t5;
  switch (s4) {
    case Boolean:
      i7 = null !== t5;
      break;
    case Number:
      i7 = null === t5 ? null : Number(t5);
      break;
    case Object:
    case Array:
      try {
        i7 = JSON.parse(t5);
      } catch (t6) {
        i7 = null;
      }
  }
  return i7;
} };
var f = (t5, s4) => !i2(t5, s4);
var b = { attribute: true, type: String, converter: u, reflect: false, useDefault: false, hasChanged: f };
Symbol.metadata ??= Symbol("metadata"), a.litPropertyMetadata ??= /* @__PURE__ */ new WeakMap();
var y = class extends HTMLElement {
  static addInitializer(t5) {
    this._$Ei(), (this.l ??= []).push(t5);
  }
  static get observedAttributes() {
    return this.finalize(), this._$Eh && [...this._$Eh.keys()];
  }
  static createProperty(t5, s4 = b) {
    if (s4.state && (s4.attribute = false), this._$Ei(), this.prototype.hasOwnProperty(t5) && ((s4 = Object.create(s4)).wrapped = true), this.elementProperties.set(t5, s4), !s4.noAccessor) {
      const i7 = Symbol(), h3 = this.getPropertyDescriptor(t5, i7, s4);
      void 0 !== h3 && e2(this.prototype, t5, h3);
    }
  }
  static getPropertyDescriptor(t5, s4, i7) {
    const { get: e7, set: r6 } = h(this.prototype, t5) ?? { get() {
      return this[s4];
    }, set(t6) {
      this[s4] = t6;
    } };
    return { get: e7, set(s5) {
      const h3 = e7?.call(this);
      r6?.call(this, s5), this.requestUpdate(t5, h3, i7);
    }, configurable: true, enumerable: true };
  }
  static getPropertyOptions(t5) {
    return this.elementProperties.get(t5) ?? b;
  }
  static _$Ei() {
    if (this.hasOwnProperty(d("elementProperties"))) return;
    const t5 = n2(this);
    t5.finalize(), void 0 !== t5.l && (this.l = [...t5.l]), this.elementProperties = new Map(t5.elementProperties);
  }
  static finalize() {
    if (this.hasOwnProperty(d("finalized"))) return;
    if (this.finalized = true, this._$Ei(), this.hasOwnProperty(d("properties"))) {
      const t6 = this.properties, s4 = [...r2(t6), ...o2(t6)];
      for (const i7 of s4) this.createProperty(i7, t6[i7]);
    }
    const t5 = this[Symbol.metadata];
    if (null !== t5) {
      const s4 = litPropertyMetadata.get(t5);
      if (void 0 !== s4) for (const [t6, i7] of s4) this.elementProperties.set(t6, i7);
    }
    this._$Eh = /* @__PURE__ */ new Map();
    for (const [t6, s4] of this.elementProperties) {
      const i7 = this._$Eu(t6, s4);
      void 0 !== i7 && this._$Eh.set(i7, t6);
    }
    this.elementStyles = this.finalizeStyles(this.styles);
  }
  static finalizeStyles(s4) {
    const i7 = [];
    if (Array.isArray(s4)) {
      const e7 = new Set(s4.flat(1 / 0).reverse());
      for (const s5 of e7) i7.unshift(c(s5));
    } else void 0 !== s4 && i7.push(c(s4));
    return i7;
  }
  static _$Eu(t5, s4) {
    const i7 = s4.attribute;
    return false === i7 ? void 0 : "string" == typeof i7 ? i7 : "string" == typeof t5 ? t5.toLowerCase() : void 0;
  }
  constructor() {
    super(), this._$Ep = void 0, this.isUpdatePending = false, this.hasUpdated = false, this._$Em = null, this._$Ev();
  }
  _$Ev() {
    this._$ES = new Promise((t5) => this.enableUpdating = t5), this._$AL = /* @__PURE__ */ new Map(), this._$E_(), this.requestUpdate(), this.constructor.l?.forEach((t5) => t5(this));
  }
  addController(t5) {
    (this._$EO ??= /* @__PURE__ */ new Set()).add(t5), void 0 !== this.renderRoot && this.isConnected && t5.hostConnected?.();
  }
  removeController(t5) {
    this._$EO?.delete(t5);
  }
  _$E_() {
    const t5 = /* @__PURE__ */ new Map(), s4 = this.constructor.elementProperties;
    for (const i7 of s4.keys()) this.hasOwnProperty(i7) && (t5.set(i7, this[i7]), delete this[i7]);
    t5.size > 0 && (this._$Ep = t5);
  }
  createRenderRoot() {
    const t5 = this.shadowRoot ?? this.attachShadow(this.constructor.shadowRootOptions);
    return S(t5, this.constructor.elementStyles), t5;
  }
  connectedCallback() {
    this.renderRoot ??= this.createRenderRoot(), this.enableUpdating(true), this._$EO?.forEach((t5) => t5.hostConnected?.());
  }
  enableUpdating(t5) {
  }
  disconnectedCallback() {
    this._$EO?.forEach((t5) => t5.hostDisconnected?.());
  }
  attributeChangedCallback(t5, s4, i7) {
    this._$AK(t5, i7);
  }
  _$ET(t5, s4) {
    const i7 = this.constructor.elementProperties.get(t5), e7 = this.constructor._$Eu(t5, i7);
    if (void 0 !== e7 && true === i7.reflect) {
      const h3 = (void 0 !== i7.converter?.toAttribute ? i7.converter : u).toAttribute(s4, i7.type);
      this._$Em = t5, null == h3 ? this.removeAttribute(e7) : this.setAttribute(e7, h3), this._$Em = null;
    }
  }
  _$AK(t5, s4) {
    const i7 = this.constructor, e7 = i7._$Eh.get(t5);
    if (void 0 !== e7 && this._$Em !== e7) {
      const t6 = i7.getPropertyOptions(e7), h3 = "function" == typeof t6.converter ? { fromAttribute: t6.converter } : void 0 !== t6.converter?.fromAttribute ? t6.converter : u;
      this._$Em = e7;
      const r6 = h3.fromAttribute(s4, t6.type);
      this[e7] = r6 ?? this._$Ej?.get(e7) ?? r6, this._$Em = null;
    }
  }
  requestUpdate(t5, s4, i7, e7 = false, h3) {
    if (void 0 !== t5) {
      const r6 = this.constructor;
      if (false === e7 && (h3 = this[t5]), i7 ??= r6.getPropertyOptions(t5), !((i7.hasChanged ?? f)(h3, s4) || i7.useDefault && i7.reflect && h3 === this._$Ej?.get(t5) && !this.hasAttribute(r6._$Eu(t5, i7)))) return;
      this.C(t5, s4, i7);
    }
    false === this.isUpdatePending && (this._$ES = this._$EP());
  }
  C(t5, s4, { useDefault: i7, reflect: e7, wrapped: h3 }, r6) {
    i7 && !(this._$Ej ??= /* @__PURE__ */ new Map()).has(t5) && (this._$Ej.set(t5, r6 ?? s4 ?? this[t5]), true !== h3 || void 0 !== r6) || (this._$AL.has(t5) || (this.hasUpdated || i7 || (s4 = void 0), this._$AL.set(t5, s4)), true === e7 && this._$Em !== t5 && (this._$Eq ??= /* @__PURE__ */ new Set()).add(t5));
  }
  async _$EP() {
    this.isUpdatePending = true;
    try {
      await this._$ES;
    } catch (t6) {
      Promise.reject(t6);
    }
    const t5 = this.scheduleUpdate();
    return null != t5 && await t5, !this.isUpdatePending;
  }
  scheduleUpdate() {
    return this.performUpdate();
  }
  performUpdate() {
    if (!this.isUpdatePending) return;
    if (!this.hasUpdated) {
      if (this.renderRoot ??= this.createRenderRoot(), this._$Ep) {
        for (const [t7, s5] of this._$Ep) this[t7] = s5;
        this._$Ep = void 0;
      }
      const t6 = this.constructor.elementProperties;
      if (t6.size > 0) for (const [s5, i7] of t6) {
        const { wrapped: t7 } = i7, e7 = this[s5];
        true !== t7 || this._$AL.has(s5) || void 0 === e7 || this.C(s5, void 0, i7, e7);
      }
    }
    let t5 = false;
    const s4 = this._$AL;
    try {
      t5 = this.shouldUpdate(s4), t5 ? (this.willUpdate(s4), this._$EO?.forEach((t6) => t6.hostUpdate?.()), this.update(s4)) : this._$EM();
    } catch (s5) {
      throw t5 = false, this._$EM(), s5;
    }
    t5 && this._$AE(s4);
  }
  willUpdate(t5) {
  }
  _$AE(t5) {
    this._$EO?.forEach((t6) => t6.hostUpdated?.()), this.hasUpdated || (this.hasUpdated = true, this.firstUpdated(t5)), this.updated(t5);
  }
  _$EM() {
    this._$AL = /* @__PURE__ */ new Map(), this.isUpdatePending = false;
  }
  get updateComplete() {
    return this.getUpdateComplete();
  }
  getUpdateComplete() {
    return this._$ES;
  }
  shouldUpdate(t5) {
    return true;
  }
  update(t5) {
    this._$Eq &&= this._$Eq.forEach((t6) => this._$ET(t6, this[t6])), this._$EM();
  }
  updated(t5) {
  }
  firstUpdated(t5) {
  }
};
y.elementStyles = [], y.shadowRootOptions = { mode: "open" }, y[d("elementProperties")] = /* @__PURE__ */ new Map(), y[d("finalized")] = /* @__PURE__ */ new Map(), p?.({ ReactiveElement: y }), (a.reactiveElementVersions ??= []).push("2.1.2");

// node_modules/lit-html/lit-html.js
var t2 = globalThis;
var i3 = (t5) => t5;
var s2 = t2.trustedTypes;
var e3 = s2 ? s2.createPolicy("lit-html", { createHTML: (t5) => t5 }) : void 0;
var h2 = "$lit$";
var o3 = `lit$${Math.random().toFixed(9).slice(2)}$`;
var n3 = "?" + o3;
var r3 = `<${n3}>`;
var l2 = document;
var c3 = () => l2.createComment("");
var a2 = (t5) => null === t5 || "object" != typeof t5 && "function" != typeof t5;
var u2 = Array.isArray;
var d2 = (t5) => u2(t5) || "function" == typeof t5?.[Symbol.iterator];
var f2 = "[ 	\n\f\r]";
var v = /<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g;
var _ = /-->/g;
var m = />/g;
var p2 = RegExp(`>|${f2}(?:([^\\s"'>=/]+)(${f2}*=${f2}*(?:[^ 	
\f\r"'\`<>=]|("|')|))|$)`, "g");
var g = /'/g;
var $ = /"/g;
var y2 = /^(?:script|style|textarea|title)$/i;
var x = (t5) => (i7, ...s4) => ({ _$litType$: t5, strings: i7, values: s4 });
var b2 = x(1);
var w = x(2);
var T = x(3);
var E = Symbol.for("lit-noChange");
var A = Symbol.for("lit-nothing");
var C = /* @__PURE__ */ new WeakMap();
var P = l2.createTreeWalker(l2, 129);
function V(t5, i7) {
  if (!u2(t5) || !t5.hasOwnProperty("raw")) throw Error("invalid template strings array");
  return void 0 !== e3 ? e3.createHTML(i7) : i7;
}
var N = (t5, i7) => {
  const s4 = t5.length - 1, e7 = [];
  let n6, l3 = 2 === i7 ? "<svg>" : 3 === i7 ? "<math>" : "", c4 = v;
  for (let i8 = 0; i8 < s4; i8++) {
    const s5 = t5[i8];
    let a3, u3, d3 = -1, f3 = 0;
    for (; f3 < s5.length && (c4.lastIndex = f3, u3 = c4.exec(s5), null !== u3); ) f3 = c4.lastIndex, c4 === v ? "!--" === u3[1] ? c4 = _ : void 0 !== u3[1] ? c4 = m : void 0 !== u3[2] ? (y2.test(u3[2]) && (n6 = RegExp("</" + u3[2], "g")), c4 = p2) : void 0 !== u3[3] && (c4 = p2) : c4 === p2 ? ">" === u3[0] ? (c4 = n6 ?? v, d3 = -1) : void 0 === u3[1] ? d3 = -2 : (d3 = c4.lastIndex - u3[2].length, a3 = u3[1], c4 = void 0 === u3[3] ? p2 : '"' === u3[3] ? $ : g) : c4 === $ || c4 === g ? c4 = p2 : c4 === _ || c4 === m ? c4 = v : (c4 = p2, n6 = void 0);
    const x2 = c4 === p2 && t5[i8 + 1].startsWith("/>") ? " " : "";
    l3 += c4 === v ? s5 + r3 : d3 >= 0 ? (e7.push(a3), s5.slice(0, d3) + h2 + s5.slice(d3) + o3 + x2) : s5 + o3 + (-2 === d3 ? i8 : x2);
  }
  return [V(t5, l3 + (t5[s4] || "<?>") + (2 === i7 ? "</svg>" : 3 === i7 ? "</math>" : "")), e7];
};
var S2 = class _S {
  constructor({ strings: t5, _$litType$: i7 }, e7) {
    let r6;
    this.parts = [];
    let l3 = 0, a3 = 0;
    const u3 = t5.length - 1, d3 = this.parts, [f3, v2] = N(t5, i7);
    if (this.el = _S.createElement(f3, e7), P.currentNode = this.el.content, 2 === i7 || 3 === i7) {
      const t6 = this.el.content.firstChild;
      t6.replaceWith(...t6.childNodes);
    }
    for (; null !== (r6 = P.nextNode()) && d3.length < u3; ) {
      if (1 === r6.nodeType) {
        if (r6.hasAttributes()) for (const t6 of r6.getAttributeNames()) if (t6.endsWith(h2)) {
          const i8 = v2[a3++], s4 = r6.getAttribute(t6).split(o3), e8 = /([.?@])?(.*)/.exec(i8);
          d3.push({ type: 1, index: l3, name: e8[2], strings: s4, ctor: "." === e8[1] ? I : "?" === e8[1] ? L : "@" === e8[1] ? z : H }), r6.removeAttribute(t6);
        } else t6.startsWith(o3) && (d3.push({ type: 6, index: l3 }), r6.removeAttribute(t6));
        if (y2.test(r6.tagName)) {
          const t6 = r6.textContent.split(o3), i8 = t6.length - 1;
          if (i8 > 0) {
            r6.textContent = s2 ? s2.emptyScript : "";
            for (let s4 = 0; s4 < i8; s4++) r6.append(t6[s4], c3()), P.nextNode(), d3.push({ type: 2, index: ++l3 });
            r6.append(t6[i8], c3());
          }
        }
      } else if (8 === r6.nodeType) if (r6.data === n3) d3.push({ type: 2, index: l3 });
      else {
        let t6 = -1;
        for (; -1 !== (t6 = r6.data.indexOf(o3, t6 + 1)); ) d3.push({ type: 7, index: l3 }), t6 += o3.length - 1;
      }
      l3++;
    }
  }
  static createElement(t5, i7) {
    const s4 = l2.createElement("template");
    return s4.innerHTML = t5, s4;
  }
};
function M(t5, i7, s4 = t5, e7) {
  if (i7 === E) return i7;
  let h3 = void 0 !== e7 ? s4._$Co?.[e7] : s4._$Cl;
  const o7 = a2(i7) ? void 0 : i7._$litDirective$;
  return h3?.constructor !== o7 && (h3?._$AO?.(false), void 0 === o7 ? h3 = void 0 : (h3 = new o7(t5), h3._$AT(t5, s4, e7)), void 0 !== e7 ? (s4._$Co ??= [])[e7] = h3 : s4._$Cl = h3), void 0 !== h3 && (i7 = M(t5, h3._$AS(t5, i7.values), h3, e7)), i7;
}
var R = class {
  constructor(t5, i7) {
    this._$AV = [], this._$AN = void 0, this._$AD = t5, this._$AM = i7;
  }
  get parentNode() {
    return this._$AM.parentNode;
  }
  get _$AU() {
    return this._$AM._$AU;
  }
  u(t5) {
    const { el: { content: i7 }, parts: s4 } = this._$AD, e7 = (t5?.creationScope ?? l2).importNode(i7, true);
    P.currentNode = e7;
    let h3 = P.nextNode(), o7 = 0, n6 = 0, r6 = s4[0];
    for (; void 0 !== r6; ) {
      if (o7 === r6.index) {
        let i8;
        2 === r6.type ? i8 = new k(h3, h3.nextSibling, this, t5) : 1 === r6.type ? i8 = new r6.ctor(h3, r6.name, r6.strings, this, t5) : 6 === r6.type && (i8 = new Z(h3, this, t5)), this._$AV.push(i8), r6 = s4[++n6];
      }
      o7 !== r6?.index && (h3 = P.nextNode(), o7++);
    }
    return P.currentNode = l2, e7;
  }
  p(t5) {
    let i7 = 0;
    for (const s4 of this._$AV) void 0 !== s4 && (void 0 !== s4.strings ? (s4._$AI(t5, s4, i7), i7 += s4.strings.length - 2) : s4._$AI(t5[i7])), i7++;
  }
};
var k = class _k {
  get _$AU() {
    return this._$AM?._$AU ?? this._$Cv;
  }
  constructor(t5, i7, s4, e7) {
    this.type = 2, this._$AH = A, this._$AN = void 0, this._$AA = t5, this._$AB = i7, this._$AM = s4, this.options = e7, this._$Cv = e7?.isConnected ?? true;
  }
  get parentNode() {
    let t5 = this._$AA.parentNode;
    const i7 = this._$AM;
    return void 0 !== i7 && 11 === t5?.nodeType && (t5 = i7.parentNode), t5;
  }
  get startNode() {
    return this._$AA;
  }
  get endNode() {
    return this._$AB;
  }
  _$AI(t5, i7 = this) {
    t5 = M(this, t5, i7), a2(t5) ? t5 === A || null == t5 || "" === t5 ? (this._$AH !== A && this._$AR(), this._$AH = A) : t5 !== this._$AH && t5 !== E && this._(t5) : void 0 !== t5._$litType$ ? this.$(t5) : void 0 !== t5.nodeType ? this.T(t5) : d2(t5) ? this.k(t5) : this._(t5);
  }
  O(t5) {
    return this._$AA.parentNode.insertBefore(t5, this._$AB);
  }
  T(t5) {
    this._$AH !== t5 && (this._$AR(), this._$AH = this.O(t5));
  }
  _(t5) {
    this._$AH !== A && a2(this._$AH) ? this._$AA.nextSibling.data = t5 : this.T(l2.createTextNode(t5)), this._$AH = t5;
  }
  $(t5) {
    const { values: i7, _$litType$: s4 } = t5, e7 = "number" == typeof s4 ? this._$AC(t5) : (void 0 === s4.el && (s4.el = S2.createElement(V(s4.h, s4.h[0]), this.options)), s4);
    if (this._$AH?._$AD === e7) this._$AH.p(i7);
    else {
      const t6 = new R(e7, this), s5 = t6.u(this.options);
      t6.p(i7), this.T(s5), this._$AH = t6;
    }
  }
  _$AC(t5) {
    let i7 = C.get(t5.strings);
    return void 0 === i7 && C.set(t5.strings, i7 = new S2(t5)), i7;
  }
  k(t5) {
    u2(this._$AH) || (this._$AH = [], this._$AR());
    const i7 = this._$AH;
    let s4, e7 = 0;
    for (const h3 of t5) e7 === i7.length ? i7.push(s4 = new _k(this.O(c3()), this.O(c3()), this, this.options)) : s4 = i7[e7], s4._$AI(h3), e7++;
    e7 < i7.length && (this._$AR(s4 && s4._$AB.nextSibling, e7), i7.length = e7);
  }
  _$AR(t5 = this._$AA.nextSibling, s4) {
    for (this._$AP?.(false, true, s4); t5 !== this._$AB; ) {
      const s5 = i3(t5).nextSibling;
      i3(t5).remove(), t5 = s5;
    }
  }
  setConnected(t5) {
    void 0 === this._$AM && (this._$Cv = t5, this._$AP?.(t5));
  }
};
var H = class {
  get tagName() {
    return this.element.tagName;
  }
  get _$AU() {
    return this._$AM._$AU;
  }
  constructor(t5, i7, s4, e7, h3) {
    this.type = 1, this._$AH = A, this._$AN = void 0, this.element = t5, this.name = i7, this._$AM = e7, this.options = h3, s4.length > 2 || "" !== s4[0] || "" !== s4[1] ? (this._$AH = Array(s4.length - 1).fill(new String()), this.strings = s4) : this._$AH = A;
  }
  _$AI(t5, i7 = this, s4, e7) {
    const h3 = this.strings;
    let o7 = false;
    if (void 0 === h3) t5 = M(this, t5, i7, 0), o7 = !a2(t5) || t5 !== this._$AH && t5 !== E, o7 && (this._$AH = t5);
    else {
      const e8 = t5;
      let n6, r6;
      for (t5 = h3[0], n6 = 0; n6 < h3.length - 1; n6++) r6 = M(this, e8[s4 + n6], i7, n6), r6 === E && (r6 = this._$AH[n6]), o7 ||= !a2(r6) || r6 !== this._$AH[n6], r6 === A ? t5 = A : t5 !== A && (t5 += (r6 ?? "") + h3[n6 + 1]), this._$AH[n6] = r6;
    }
    o7 && !e7 && this.j(t5);
  }
  j(t5) {
    t5 === A ? this.element.removeAttribute(this.name) : this.element.setAttribute(this.name, t5 ?? "");
  }
};
var I = class extends H {
  constructor() {
    super(...arguments), this.type = 3;
  }
  j(t5) {
    this.element[this.name] = t5 === A ? void 0 : t5;
  }
};
var L = class extends H {
  constructor() {
    super(...arguments), this.type = 4;
  }
  j(t5) {
    this.element.toggleAttribute(this.name, !!t5 && t5 !== A);
  }
};
var z = class extends H {
  constructor(t5, i7, s4, e7, h3) {
    super(t5, i7, s4, e7, h3), this.type = 5;
  }
  _$AI(t5, i7 = this) {
    if ((t5 = M(this, t5, i7, 0) ?? A) === E) return;
    const s4 = this._$AH, e7 = t5 === A && s4 !== A || t5.capture !== s4.capture || t5.once !== s4.once || t5.passive !== s4.passive, h3 = t5 !== A && (s4 === A || e7);
    e7 && this.element.removeEventListener(this.name, this, s4), h3 && this.element.addEventListener(this.name, this, t5), this._$AH = t5;
  }
  handleEvent(t5) {
    "function" == typeof this._$AH ? this._$AH.call(this.options?.host ?? this.element, t5) : this._$AH.handleEvent(t5);
  }
};
var Z = class {
  constructor(t5, i7, s4) {
    this.element = t5, this.type = 6, this._$AN = void 0, this._$AM = i7, this.options = s4;
  }
  get _$AU() {
    return this._$AM._$AU;
  }
  _$AI(t5) {
    M(this, t5);
  }
};
var B = t2.litHtmlPolyfillSupport;
B?.(S2, k), (t2.litHtmlVersions ??= []).push("3.3.3");
var D = (t5, i7, s4) => {
  const e7 = s4?.renderBefore ?? i7;
  let h3 = e7._$litPart$;
  if (void 0 === h3) {
    const t6 = s4?.renderBefore ?? null;
    e7._$litPart$ = h3 = new k(i7.insertBefore(c3(), t6), t6, void 0, s4 ?? {});
  }
  return h3._$AI(t5), h3;
};

// node_modules/lit-element/lit-element.js
var s3 = globalThis;
var i4 = class extends y {
  constructor() {
    super(...arguments), this.renderOptions = { host: this }, this._$Do = void 0;
  }
  createRenderRoot() {
    const t5 = super.createRenderRoot();
    return this.renderOptions.renderBefore ??= t5.firstChild, t5;
  }
  update(t5) {
    const r6 = this.render();
    this.hasUpdated || (this.renderOptions.isConnected = this.isConnected), super.update(t5), this._$Do = D(r6, this.renderRoot, this.renderOptions);
  }
  connectedCallback() {
    super.connectedCallback(), this._$Do?.setConnected(true);
  }
  disconnectedCallback() {
    super.disconnectedCallback(), this._$Do?.setConnected(false);
  }
  render() {
    return E;
  }
};
i4._$litElement$ = true, i4["finalized"] = true, s3.litElementHydrateSupport?.({ LitElement: i4 });
var o4 = s3.litElementPolyfillSupport;
o4?.({ LitElement: i4 });
(s3.litElementVersions ??= []).push("4.2.2");

// node_modules/@lit/reactive-element/decorators/custom-element.js
var t3 = (t5) => (e7, o7) => {
  void 0 !== o7 ? o7.addInitializer(() => {
    customElements.define(t5, e7);
  }) : customElements.define(t5, e7);
};

// node_modules/@lit/reactive-element/decorators/property.js
var o5 = { attribute: true, type: String, converter: u, reflect: false, hasChanged: f };
var r4 = (t5 = o5, e7, r6) => {
  const { kind: n6, metadata: i7 } = r6;
  let s4 = globalThis.litPropertyMetadata.get(i7);
  if (void 0 === s4 && globalThis.litPropertyMetadata.set(i7, s4 = /* @__PURE__ */ new Map()), "setter" === n6 && ((t5 = Object.create(t5)).wrapped = true), s4.set(r6.name, t5), "accessor" === n6) {
    const { name: o7 } = r6;
    return { set(r7) {
      const n7 = e7.get.call(this);
      e7.set.call(this, r7), this.requestUpdate(o7, n7, t5, true, r7);
    }, init(e8) {
      return void 0 !== e8 && this.C(o7, void 0, t5, e8), e8;
    } };
  }
  if ("setter" === n6) {
    const { name: o7 } = r6;
    return function(r7) {
      const n7 = this[o7];
      e7.call(this, r7), this.requestUpdate(o7, n7, t5, true, r7);
    };
  }
  throw Error("Unsupported decorator location: " + n6);
};
function n4(t5) {
  return (e7, o7) => "object" == typeof o7 ? r4(t5, e7, o7) : ((t6, e8, o8) => {
    const r6 = e8.hasOwnProperty(o8);
    return e8.constructor.createProperty(o8, t6), r6 ? Object.getOwnPropertyDescriptor(e8, o8) : void 0;
  })(t5, e7, o7);
}

// node_modules/@lit/reactive-element/decorators/state.js
function r5(r6) {
  return n4({ ...r6, state: true, attribute: false });
}

// node_modules/lit-html/directive.js
var t4 = { ATTRIBUTE: 1, CHILD: 2, PROPERTY: 3, BOOLEAN_ATTRIBUTE: 4, EVENT: 5, ELEMENT: 6 };
var e5 = (t5) => (...e7) => ({ _$litDirective$: t5, values: e7 });
var i5 = class {
  constructor(t5) {
  }
  get _$AU() {
    return this._$AM._$AU;
  }
  _$AT(t5, e7, i7) {
    this._$Ct = t5, this._$AM = e7, this._$Ci = i7;
  }
  _$AS(t5, e7) {
    return this.update(t5, e7);
  }
  update(t5, e7) {
    return this.render(...e7);
  }
};

// node_modules/lit-html/directives/class-map.js
var e6 = e5(class extends i5 {
  constructor(t5) {
    if (super(t5), t5.type !== t4.ATTRIBUTE || "class" !== t5.name || t5.strings?.length > 2) throw Error("`classMap()` can only be used in the `class` attribute and must be the only part in the attribute.");
  }
  render(t5) {
    return " " + Object.keys(t5).filter((s4) => t5[s4]).join(" ") + " ";
  }
  update(s4, [i7]) {
    if (void 0 === this.st) {
      this.st = /* @__PURE__ */ new Set(), void 0 !== s4.strings && (this.nt = new Set(s4.strings.join(" ").split(/\s/).filter((t5) => "" !== t5)));
      for (const t5 in i7) i7[t5] && !this.nt?.has(t5) && this.st.add(t5);
      return this.render(i7);
    }
    const r6 = s4.element.classList;
    for (const t5 of this.st) t5 in i7 || (r6.remove(t5), this.st.delete(t5));
    for (const t5 in i7) {
      const s5 = !!i7[t5];
      s5 === this.st.has(t5) || this.nt?.has(t5) || (s5 ? (r6.add(t5), this.st.add(t5)) : (r6.remove(t5), this.st.delete(t5)));
    }
    return E;
  }
});

// node_modules/lit-html/directives/style-map.js
var n5 = "important";
var i6 = " !" + n5;
var o6 = e5(class extends i5 {
  constructor(t5) {
    if (super(t5), t5.type !== t4.ATTRIBUTE || "style" !== t5.name || t5.strings?.length > 2) throw Error("The `styleMap` directive must be used in the `style` attribute and must be the only part in the attribute.");
  }
  render(t5) {
    return Object.keys(t5).reduce((e7, r6) => {
      const s4 = t5[r6];
      return null == s4 ? e7 : e7 + `${r6 = r6.includes("-") ? r6 : r6.replace(/(?:^(webkit|moz|ms|o)|)(?=[A-Z])/g, "-$&").toLowerCase()}:${s4};`;
    }, "");
  }
  update(e7, [r6]) {
    const { style: s4 } = e7.element;
    if (void 0 === this.ft) return this.ft = new Set(Object.keys(r6)), this.render(r6);
    for (const t5 of this.ft) null == r6[t5] && (this.ft.delete(t5), t5.includes("-") ? s4.removeProperty(t5) : s4[t5] = null);
    for (const t5 in r6) {
      const e8 = r6[t5];
      if (null != e8) {
        this.ft.add(t5);
        const r7 = "string" == typeof e8 && e8.endsWith(i6);
        t5.includes("-") || r7 ? s4.setProperty(t5, r7 ? e8.slice(0, -11) : e8, r7 ? n5 : "") : s4[t5] = e8;
      }
    }
    return E;
  }
});

// src/api.ts
async function getList(hass, entityId, groupCompleted) {
  return await hass.connection.sendMessagePromise({
    type: "todo_overlay/get_list",
    entity_id: entityId,
    group_completed: groupCompleted
  });
}
async function moveItem(hass, entityId, childId, referenceId, placement) {
  await hass.connection.sendMessagePromise({
    type: "todo_overlay/move_item",
    entity_id: entityId,
    child_id: childId,
    reference_id: referenceId,
    placement
  });
}
async function transferItem(hass, sourceEntityId, itemId, targetEntityId, referenceId, placement) {
  const result = await hass.connection.sendMessagePromise({
    type: "todo_overlay/transfer_item",
    source_entity_id: sourceEntityId,
    item_id: itemId,
    target_entity_id: targetEntityId,
    reference_id: referenceId,
    placement
  });
  return result.id;
}
async function setCompleted(hass, entityId, itemId, completed, reposition) {
  const result = await hass.connection.sendMessagePromise({
    type: "todo_overlay/set_completed",
    entity_id: entityId,
    item_id: itemId,
    completed,
    reposition
  });
  return result.changed;
}
async function restoreCompleted(hass, entityId, changes) {
  await hass.connection.sendMessagePromise({
    type: "todo_overlay/restore_completed",
    entity_id: entityId,
    changes
  });
}
async function createItem(hass, entityId, fields) {
  const result = await hass.connection.sendMessagePromise({
    type: "todo_overlay/create_item",
    entity_id: entityId,
    title: fields.title,
    description: fields.description,
    due_date: fields.dueDate,
    due_datetime: fields.dueDatetime,
    quantity: fields.quantity,
    tags: fields.tags,
    trigger_on_due: fields.triggerOnDue,
    reference_id: fields.referenceId,
    placement: fields.placement,
    pin_type: fields.pinType
  });
  return result.id;
}
async function updateItem(hass, entityId, itemId, fields) {
  await hass.connection.sendMessagePromise({
    type: "todo_overlay/update_item",
    entity_id: entityId,
    item_id: itemId,
    title: fields.title,
    description: fields.description,
    due_date: fields.dueDate,
    due_datetime: fields.dueDatetime
  });
}
async function deleteItem(hass, entityId, itemId) {
  await hass.connection.sendMessagePromise({
    type: "todo_overlay/delete_item",
    entity_id: entityId,
    item_id: itemId
  });
}
async function setQuantity(hass, entityId, itemId, quantity) {
  await hass.connection.sendMessagePromise({
    type: "todo_overlay/set_quantity",
    entity_id: entityId,
    item_id: itemId,
    quantity
  });
}
async function setTriggerOnDue(hass, entityId, itemId, enabled) {
  await hass.connection.sendMessagePromise({
    type: "todo_overlay/set_trigger_on_due",
    entity_id: entityId,
    item_id: itemId,
    enabled
  });
}
async function setPinType(hass, entityId, itemId, pinType) {
  await hass.connection.sendMessagePromise({
    type: "todo_overlay/set_pin_type",
    entity_id: entityId,
    item_id: itemId,
    pin_type: pinType
  });
}
async function setTags(hass, entityId, itemId, tags) {
  await hass.connection.sendMessagePromise({
    type: "todo_overlay/set_tags",
    entity_id: entityId,
    item_id: itemId,
    tags
  });
}
async function clearCompleted(hass, entityId) {
  const result = await hass.connection.sendMessagePromise({
    type: "todo_overlay/clear_completed",
    entity_id: entityId
  });
  return result.removed;
}
async function clearAll(hass, entityId) {
  const result = await hass.connection.sendMessagePromise({
    type: "todo_overlay/clear_all",
    entity_id: entityId
  });
  return result.removed;
}
async function saveList(hass, entityId, name, persistStates) {
  await hass.connection.sendMessagePromise({
    type: "todo_overlay/save_list",
    entity_id: entityId,
    name,
    persist_states: persistStates
  });
}
async function loadList(hass, entityId, name, mode, targetItem) {
  await hass.connection.sendMessagePromise({
    type: "todo_overlay/load_list",
    entity_id: entityId,
    name,
    mode,
    target_item: targetItem
  });
}
async function listSaved(hass) {
  const result = await hass.connection.sendMessagePromise({
    type: "todo_overlay/list_saved"
  });
  return result.names;
}
async function deleteSavedList(hass, name) {
  await hass.connection.sendMessagePromise({
    type: "todo_overlay/delete_saved_list",
    name
  });
}

// src/collapse-storage.ts
var STORAGE_KEY_PREFIX = "todo-overlay-card:collapsed:";
function loadCollapsedIds(entityId) {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_PREFIX + entityId);
    if (!raw) {
      return /* @__PURE__ */ new Set();
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((id) => typeof id === "string")) : /* @__PURE__ */ new Set();
  } catch {
    return /* @__PURE__ */ new Set();
  }
}
function saveCollapsedIds(entityId, collapsedIds) {
  try {
    window.localStorage.setItem(STORAGE_KEY_PREFIX + entityId, JSON.stringify([...collapsedIds]));
  } catch {
  }
}

// src/models.ts
var LONG_PRESS_MS = 500;
var TodoListEntityFeature = {
  CREATE_TODO_ITEM: 1,
  DELETE_TODO_ITEM: 2,
  UPDATE_TODO_ITEM: 4,
  MOVE_TODO_ITEM: 8,
  SET_DUE_DATE_ON_ITEM: 16,
  SET_DUE_DATETIME_ON_ITEM: 32,
  SET_DESCRIPTION_ON_ITEM: 64
};
function supportsFeature(supportedFeatures, feature) {
  return typeof supportedFeatures === "number" && (supportedFeatures & feature) !== 0;
}
function isOverdue(item) {
  if (item.completed) {
    return false;
  }
  const raw = item.due_datetime ?? (item.due_date ? `${item.due_date}T00:00:00` : null);
  if (!raw) {
    return false;
  }
  const due = new Date(raw);
  const now = /* @__PURE__ */ new Date();
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return dueDay.getTime() < today.getTime();
}

// src/filter.ts
function matchesMode(item, mode) {
  switch (mode) {
    case "all":
      return true;
    case "active":
      return !item.completed;
    case "completed":
      return item.completed;
    case "overdue":
      return isOverdue(item);
  }
}
function filterTree(items, mode) {
  const result = [];
  for (const item of items) {
    const filteredChildren = filterTree(item.children, mode);
    const selfMatches = matchesMode(item, mode);
    if (selfMatches || filteredChildren.length > 0) {
      result.push({ ...item, children: filteredChildren });
    }
  }
  return result;
}

// src/sort.ts
function dueTimestamp(item) {
  const raw = item.due_datetime ?? (item.due_date ? `${item.due_date}T00:00:00` : null);
  if (!raw) {
    return Number.POSITIVE_INFINITY;
  }
  const parsed = new Date(raw).getTime();
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
}
function compareItems(a3, b3, sortBy) {
  if (sortBy === "title") {
    return a3.title.localeCompare(b3.title);
  }
  if (sortBy === "due_date") {
    return dueTimestamp(a3) - dueTimestamp(b3);
  }
  return 0;
}
function sortTree(items, sortBy, sortOrder) {
  if (sortBy === "manual") {
    return items;
  }
  const direction = sortOrder === "desc" ? -1 : 1;
  const sorted = [...items].sort((a3, b3) => direction * compareItems(a3, b3, sortBy));
  return sorted.map((item) => ({ ...item, children: sortTree(item.children, sortBy, sortOrder) }));
}

// src/components/todo-item-dialog.ts
var CALENDAR_ICON = b2`
    <svg viewBox="0 0 24 24">
        <path d="M19,19H5V8H19M16,1V3H8V1H6V3H5C3.89,3 3,3.89 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V5C21,3.89 20.1,3 19,3H18V1M17,12H12V17H17V12Z"></path>
    </svg>
`;
var MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
];
var WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
function daysInMonth(year, month0) {
  return new Date(year, month0 + 1, 0).getDate();
}
function firstWeekdayOfMonth(year, month0) {
  return new Date(year, month0, 1).getDay();
}
var EMPTY_FORM_VALUE = {
  title: "",
  quantity: "",
  tags: "",
  description: "",
  dueDate: "",
  dueTime: "",
  triggerOnDue: false,
  pinType: ""
};
function digitsOnly(raw, maxLen) {
  return raw.replace(/\D/g, "").slice(0, maxLen);
}
var TodoItemDialog = class extends i4 {
  constructor() {
    super(...arguments);
    this.heading = "Item";
    // What the parent last handed in - read ONLY by willUpdate() to seed
    // draftValue exactly once (see below). Never read anywhere else.
    this._seedValue = EMPTY_FORM_VALUE;
    this.draftValue = EMPTY_FORM_VALUE;
    this.fieldSupport = {
      description: false,
      dueDate: false,
      dueDateTime: false
    };
    this.showDelete = false;
    this.showCompleteToggle = false;
    this.completed = false;
    this.confirmDelete = true;
    this.confirmingDelete = false;
    this.dueDay = "";
    this.dueMonth = "";
    this.dueYear = "";
    this.dueHour12 = "";
    this.dueMinute = "";
    this.dueAmPm = "AM";
    this.dateTimePartsInitialized = false;
    this.datePickerOpen = false;
    this.datePickerViewYear = 0;
    this.datePickerViewMonth = 0;
  }
  set value(newValue) {
    this._seedValue = newValue;
  }
  get value() {
    return this.draftValue;
  }
  openDatePicker() {
    const now = /* @__PURE__ */ new Date();
    this.datePickerViewYear = this.dueYear.length === 4 ? Number(this.dueYear) : now.getFullYear();
    this.datePickerViewMonth = this.dueMonth ? Number(this.dueMonth) - 1 : now.getMonth();
    this.datePickerOpen = true;
  }
  toggleDatePicker() {
    if (this.datePickerOpen) {
      this.datePickerOpen = false;
    } else {
      this.openDatePicker();
    }
  }
  shiftDatePickerMonth(delta) {
    let month = this.datePickerViewMonth + delta;
    let year = this.datePickerViewYear;
    if (month < 0) {
      month = 11;
      year -= 1;
    } else if (month > 11) {
      month = 0;
      year += 1;
    }
    this.datePickerViewMonth = month;
    this.datePickerViewYear = year;
  }
  pickDate(day) {
    this.dueDay = String(day).padStart(2, "0");
    this.dueMonth = String(this.datePickerViewMonth + 1).padStart(2, "0");
    this.dueYear = String(this.datePickerViewYear);
    this.syncDueDate();
    this.datePickerOpen = false;
  }
  willUpdate(changed) {
    if (!changed.has("value") || this.dateTimePartsInitialized) {
      return;
    }
    this.dateTimePartsInitialized = true;
    this.draftValue = this._seedValue;
    const [year, month, day] = this._seedValue.dueDate ? this._seedValue.dueDate.split("-") : ["", "", ""];
    this.dueYear = year ?? "";
    this.dueMonth = month ?? "";
    this.dueDay = day ?? "";
    const [hour24Str, minute] = this._seedValue.dueTime ? this._seedValue.dueTime.split(":") : ["", ""];
    this.dueMinute = minute ?? "";
    if (hour24Str) {
      const hour24 = Number(hour24Str);
      const hour12 = hour24 % 12 || 12;
      this.dueHour12 = String(hour12).padStart(2, "0");
      this.dueAmPm = hour24 >= 12 ? "PM" : "AM";
    } else {
      this.dueHour12 = "";
      this.dueAmPm = "AM";
    }
  }
  close() {
    this.dispatchEvent(
      new CustomEvent("dialog-close", { bubbles: true, composed: true })
    );
  }
  save() {
    if (this.triggerOnDueBlocked) {
      return;
    }
    this.dispatchEvent(
      new CustomEvent("dialog-save", {
        detail: this.draftValue,
        bubbles: true,
        composed: true
      })
    );
  }
  requestDelete() {
    if (this.confirmDelete) {
      this.confirmingDelete = true;
      return;
    }
    this.dispatchEvent(
      new CustomEvent("dialog-delete", { bubbles: true, composed: true })
    );
  }
  cancelDelete() {
    this.confirmingDelete = false;
  }
  confirmDeleteNow() {
    this.confirmingDelete = false;
    this.dispatchEvent(
      new CustomEvent("dialog-delete", { bubbles: true, composed: true })
    );
  }
  // Bound to "change", not "click" - ha-checkbox wraps a native
  // <input type="checkbox"> inside an internal <label>, and a single
  // physical click on it fires TWO bubbling "click" events (the
  // label's own, plus the browser's automatic forwarded click to the
  // input it labels - standard native label/control behavior). A
  // click-driven toggle (this.value.triggerOnDue = !this.value.
  // triggerOnDue) silently cancelled itself out on every real click:
  // on, then immediately back off, net no-op - confirmed live via a
  // real (not synthetic) click, the actual bug behind "the toggle
  // doesn't work" that a directly-dispatched synthetic click event
  // never reproduced, since it bypasses the internal label entirely.
  // "change" fires exactly once per genuine state transition
  // regardless of how many internal clicks produced it, so both
  // toggles below read the checkbox's own resulting .checked state
  // rather than blindly flipping a local boolean.
  toggleComplete() {
    this.dispatchEvent(
      new CustomEvent("dialog-toggle-complete", { bubbles: true, composed: true })
    );
  }
  onTriggerOnDueChanged(e7) {
    const checked = e7.target.checked;
    this.draftValue = { ...this.draftValue, triggerOnDue: checked };
  }
  updateField(field, fieldValue) {
    this.draftValue = { ...this.draftValue, [field]: fieldValue };
  }
  // Combines the three segments into "YYYY-MM-DD" only once all three
  // are actually present - a day and month with no year yet (etc.)
  // isn't a real date, so dueDate stays empty (matching what a native
  // date input's .value does while incomplete) rather than guessing.
  syncDueDate() {
    if (this.dueDay && this.dueMonth && this.dueYear.length === 4) {
      this.updateField(
        "dueDate",
        `${this.dueYear}-${this.dueMonth.padStart(2, "0")}-${this.dueDay.padStart(2, "0")}`
      );
    } else {
      this.updateField("dueDate", "");
    }
  }
  syncDueTime() {
    if (this.dueHour12 && this.dueMinute) {
      const hour12 = Number(this.dueHour12) % 12;
      const hour24 = this.dueAmPm === "PM" ? hour12 + 12 : hour12;
      this.updateField("dueTime", `${String(hour24).padStart(2, "0")}:${this.dueMinute.padStart(2, "0")}`);
    } else {
      this.updateField("dueTime", "");
    }
  }
  updateDueDay(raw) {
    this.dueDay = digitsOnly(raw, 2);
    this.syncDueDate();
  }
  updateDueMonth(raw) {
    this.dueMonth = digitsOnly(raw, 2);
    this.syncDueDate();
  }
  updateDueYear(raw) {
    this.dueYear = digitsOnly(raw, 4);
    this.syncDueDate();
  }
  updateDueHour12(raw) {
    this.dueHour12 = digitsOnly(raw, 2);
    this.syncDueTime();
  }
  updateDueMinute(raw) {
    this.dueMinute = digitsOnly(raw, 2);
    this.syncDueTime();
  }
  setDueAmPm(period) {
    this.dueAmPm = period;
    this.syncDueTime();
  }
  // Enabling "trigger on due" without a due time is meaningless - the
  // backend enforces the same rule (see DueTimeRequiredError), but
  // blocking Save here gives immediate feedback instead of a
  // round-trip error.
  get triggerOnDueBlocked() {
    return this.draftValue.triggerOnDue && !(this.draftValue.dueDate && this.draftValue.dueTime);
  }
  // Rendered inline, full-width, right below .due-row - not as an
  // absolutely-positioned floating popup. ha-dialog's own content area
  // is externally defined and out of this component's control; an
  // absolutely-positioned child risks being silently clipped by
  // whatever overflow behavior that container happens to have. Pushing
  // the rest of the dialog down instead has no such risk, at the minor
  // cost of the dialog growing taller while the panel is open - the
  // same tradeoff the quick-add "Details…" panel elsewhere in this
  // card already makes.
  renderDatePickerPanel() {
    const year = this.datePickerViewYear;
    const month = this.datePickerViewMonth;
    const leadingBlanks = firstWeekdayOfMonth(year, month);
    const totalDays = daysInMonth(year, month);
    const selectedDay = Number(this.dueDay) || void 0;
    const selectedMonth = this.dueMonth ? Number(this.dueMonth) - 1 : void 0;
    const selectedYear = this.dueYear.length === 4 ? Number(this.dueYear) : void 0;
    return b2`
            <div class="date-picker-panel">
                <div class="date-picker-header">
                    <button
                        type="button"
                        class="date-picker-nav"
                        aria-label="Previous month"
                        @click=${() => this.shiftDatePickerMonth(-1)}
                    >‹</button>
                    <span>${MONTH_NAMES[month]} ${year}</span>
                    <button
                        type="button"
                        class="date-picker-nav"
                        aria-label="Next month"
                        @click=${() => this.shiftDatePickerMonth(1)}
                    >›</button>
                </div>
                <div class="date-picker-grid">
                    ${WEEKDAY_LABELS.map((label) => b2`<span class="date-picker-weekday">${label}</span>`)}
                    ${Array.from({ length: leadingBlanks }, () => b2`<span></span>`)}
                    ${Array.from({ length: totalDays }, (_2, i7) => {
      const day = i7 + 1;
      const isSelected = day === selectedDay && month === selectedMonth && year === selectedYear;
      return b2`
                                <button
                                    type="button"
                                    class=${e6({ "date-picker-day": true, selected: isSelected })}
                                    @click=${() => this.pickDate(day)}
                                >${day}</button>
                            `;
    })}
                </div>
            </div>
        `;
  }
  render() {
    const showDue = this.fieldSupport.dueDate || this.fieldSupport.dueDateTime;
    return b2`
            <ha-dialog open .heading=${this.heading} @closed=${this.close}>
                <div class="title-row">
                    <div class="field title">
                        <label for="todo-item-title">Title</label>
                        <input
                            id="todo-item-title"
                            type="text"
                            .value=${this.draftValue.title}
                            @input=${(e7) => this.updateField("title", e7.target.value)}
                        />
                    </div>

                    <div class="field quantity">
                        <label for="todo-item-quantity">Quantity</label>
                        <input
                            id="todo-item-quantity"
                            type="text"
                            placeholder="e.g. 150g"
                            .value=${this.draftValue.quantity}
                            @input=${(e7) => this.updateField("quantity", e7.target.value)}
                        />
                    </div>
                </div>

                ${this.showCompleteToggle ? b2`
                            <div class="complete-toggle">
                                <ha-checkbox
                                    .checked=${this.completed}
                                    @change=${this.toggleComplete}
                                ></ha-checkbox>
                                <span>${this.completed ? "Completed" : "Mark complete"}</span>
                            </div>
                        ` : ""}

                ${this.fieldSupport.description ? b2`
                            <div class="field">
                                <label for="todo-item-description">Description</label>
                                <textarea
                                    id="todo-item-description"
                                    .value=${this.draftValue.description}
                                    @input=${(e7) => this.updateField(
      "description",
      e7.target.value
    )}
                                ></textarea>
                            </div>
                        ` : ""}

                <div class="field">
                    <label for="todo-item-tags">Tags</label>
                    <input
                        id="todo-item-tags"
                        type="text"
                        placeholder="e.g. urgent, weekend"
                        .value=${this.draftValue.tags}
                        @input=${(e7) => this.updateField("tags", e7.target.value)}
                    />
                </div>

                <div class="field">
                    <label for="todo-item-pin-type">Show as</label>
                    <select
                        id="todo-item-pin-type"
                        class="pin-type-select"
                        .value=${this.draftValue.pinType}
                        @change=${(e7) => this.updateField("pinType", e7.target.value)}
                    >
                        <option value="">Normal item</option>
                        <option value="category">Category (e.g. "Groceries")</option>
                        <option value="person">Person (e.g. "Brodie")</option>
                    </select>
                    ${this.draftValue.pinType ? b2`
                                <div class="field-hint pin-type-hint">
                                    Always shown as a section header, even with nothing under it yet.
                                </div>
                            ` : ""}
                </div>

                ${showDue ? b2`
                            <div class="due-row">
                                <div class="field">
                                    <label id="due-date-label">Due date</label>
                                    <div class="dmy-row" aria-labelledby="due-date-label">
                                        <input
                                            class="segment day"
                                            type="text"
                                            inputmode="numeric"
                                            maxlength="2"
                                            placeholder="DD"
                                            aria-label="Day"
                                            .value=${this.dueDay}
                                            @input=${(e7) => this.updateDueDay(e7.target.value)}
                                        />
                                        <span class="segment-sep">/</span>
                                        <input
                                            class="segment month"
                                            type="text"
                                            inputmode="numeric"
                                            maxlength="2"
                                            placeholder="MM"
                                            aria-label="Month"
                                            .value=${this.dueMonth}
                                            @input=${(e7) => this.updateDueMonth(e7.target.value)}
                                        />
                                        <span class="segment-sep">/</span>
                                        <input
                                            class="segment year"
                                            type="text"
                                            inputmode="numeric"
                                            maxlength="4"
                                            placeholder="YYYY"
                                            aria-label="Year"
                                            .value=${this.dueYear}
                                            @input=${(e7) => this.updateDueYear(e7.target.value)}
                                        />
                                        <button
                                            type="button"
                                            class="calendar-toggle"
                                            aria-label=${this.datePickerOpen ? "Close date picker" : "Open date picker"}
                                            @click=${this.toggleDatePicker}
                                        >
                                            ${CALENDAR_ICON}
                                        </button>
                                    </div>
                                </div>

                                ${this.fieldSupport.dueDateTime ? b2`
                                            <div class="field">
                                                <label id="due-time-label">Due time</label>
                                                <div class="hm-row" aria-labelledby="due-time-label">
                                                    <input
                                                        class="segment hour"
                                                        type="text"
                                                        inputmode="numeric"
                                                        maxlength="2"
                                                        placeholder="HH"
                                                        aria-label="Hour"
                                                        .value=${this.dueHour12}
                                                        @input=${(e7) => this.updateDueHour12(e7.target.value)}
                                                    />
                                                    <span class="segment-sep">:</span>
                                                    <input
                                                        class="segment minute"
                                                        type="text"
                                                        inputmode="numeric"
                                                        maxlength="2"
                                                        placeholder="MM"
                                                        aria-label="Minute"
                                                        .value=${this.dueMinute}
                                                        @input=${(e7) => this.updateDueMinute(e7.target.value)}
                                                    />
                                                    <select
                                                        class="ampm-select"
                                                        aria-label="AM or PM"
                                                        .value=${this.dueAmPm}
                                                        @change=${(e7) => this.setDueAmPm(e7.target.value)}
                                                    >
                                                        <option value="AM">AM</option>
                                                        <option value="PM">PM</option>
                                                    </select>
                                                </div>
                                            </div>
                                        ` : ""}
                            </div>

                            ${this.datePickerOpen ? this.renderDatePickerPanel() : ""}

                            ${this.fieldSupport.dueDateTime ? b2`
                                        <div class="complete-toggle">
                                            <ha-checkbox
                                                .checked=${this.draftValue.triggerOnDue}
                                                @change=${this.onTriggerOnDueChanged}
                                            ></ha-checkbox>
                                            <span>Trigger automation when due</span>
                                        </div>
                                        ${this.triggerOnDueBlocked ? b2`
                                                    <div class="field-hint">
                                                        Requires a due time to enable
                                                    </div>
                                                ` : ""}
                                    ` : ""}
                        ` : ""}

                <div class="actions" slot="footer">
                    ${this.confirmingDelete ? b2`
                                <div class="confirm-delete">
                                    <span>Delete this item?</span>
                                    <button @click=${this.cancelDelete}>
                                        Cancel
                                    </button>
                                    <button class="destructive" @click=${this.confirmDeleteNow}>
                                        Delete
                                    </button>
                                </div>
                            ` : b2`
                                ${this.showDelete ? b2`
                                            <button class="destructive" @click=${this.requestDelete}>
                                                Delete
                                            </button>
                                        ` : ""}
                                <button @click=${this.save} ?disabled=${this.triggerOnDueBlocked}>
                                    Save
                                </button>
                            `}
                </div>
            </ha-dialog>
        `;
  }
};
TodoItemDialog.styles = i`
        .field {
            display: flex;
            flex-direction: column;
            gap: 4px;
            margin-bottom: 16px;
            font-family: Roboto, "Noto Sans", sans-serif;
        }

        .due-row {
            display: flex;
            flex-wrap: wrap;
            gap: 16px;
        }

        .due-row .field {
            flex: 1;
            min-width: 140px;
        }

        .title-row {
            display: flex;
            gap: 16px;
        }

        .title-row .field.title {
            flex: 2;
            min-width: 0;
        }

        .title-row .field.quantity {
            flex: 1;
            min-width: 90px;
        }

        .complete-toggle {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 16px;
            font-family: Roboto, "Noto Sans", sans-serif;
            font-size: 14px;
            color: var(--primary-text-color);
        }

        .complete-toggle ha-checkbox {
            margin-inline-start: -12px;
        }

        label {
            font-size: 12px;
            color: var(--secondary-text-color);
        }

        input,
        textarea {
            box-sizing: border-box;
            width: 100%;
            font-family: inherit;
            font-size: 16px;
            color: var(--primary-text-color);
            background: none;
            border: none;
            border-bottom: 1px solid var(--divider-color);
            padding: 8px 0;
            outline: none;
            color-scheme: light dark;
        }

        input:focus,
        textarea:focus {
            border-bottom: 2px solid var(--primary-color);
            padding-bottom: 7px;
        }

        select.pin-type-select {
            box-sizing: border-box;
            width: 100%;
            font-family: inherit;
            font-size: 16px;
            color: var(--primary-text-color);
            background: none;
            border: none;
            border-bottom: 1px solid var(--divider-color);
            padding: 8px 0;
            outline: none;
        }

        select.pin-type-select:focus {
            border-bottom: 2px solid var(--primary-color);
            padding-bottom: 7px;
        }

        .field-hint.pin-type-hint {
            margin-top: 2px;
        }

        /* Day/month/year and hour/minute, always in that fixed order
           regardless of browser or OS locale - see the .dueDay field's
           own doc comment for why this isn't a single native
           <input type="date">/<input type="time"> or ha-date-input/
           ha-time-input. */
        .dmy-row,
        .hm-row {
            display: flex;
            align-items: baseline;
            gap: 4px;
        }

        input.segment {
            width: 2.2em;
            flex: none;
            text-align: center;
            /* Hides the native up/down spinner some browsers add to a
               numeric-inputmode text field - these segments are typed
               into, not incremented. */
            -moz-appearance: textfield;
        }

        input.segment.year {
            width: 3.6em;
        }

        .segment-sep {
            color: var(--secondary-text-color);
            font-size: 16px;
        }

        .ampm-select {
            margin-inline-start: 4px;
            font-family: inherit;
            font-size: 14px;
            font-weight: 500;
            color: var(--primary-text-color);
            background: none;
            border: none;
            border-bottom: 1px solid var(--divider-color);
            padding: 8px 2px;
            outline: none;
        }

        .calendar-toggle {
            flex: none;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 28px;
            height: 28px;
            margin-inline-start: 4px;
            border: none;
            border-radius: 50%;
            background: none;
            padding: 0;
            color: var(--secondary-text-color);
            cursor: pointer;
        }

        .calendar-toggle:hover {
            background: rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.06);
        }

        .calendar-toggle svg {
            width: 18px;
            height: 18px;
            fill: currentColor;
        }

        .date-picker-panel {
            margin: 0 0 16px;
            padding: 12px;
            border: 1px solid var(--divider-color);
            border-radius: 8px;
            font-family: Roboto, "Noto Sans", sans-serif;
        }

        .date-picker-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 8px;
            font-size: 14px;
            font-weight: 500;
            color: var(--primary-text-color);
        }

        .date-picker-nav {
            border: none;
            background: none;
            padding: 4px 10px;
            border-radius: 4px;
            font-size: 16px;
            color: var(--secondary-text-color);
            cursor: pointer;
        }

        .date-picker-nav:hover {
            background: rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.06);
        }

        .date-picker-grid {
            display: grid;
            grid-template-columns: repeat(7, 1fr);
            gap: 2px;
        }

        .date-picker-weekday {
            text-align: center;
            font-size: 11px;
            color: var(--secondary-text-color);
            padding: 4px 0;
        }

        .date-picker-day {
            border: none;
            background: none;
            font-family: inherit;
            font-size: 13px;
            color: var(--primary-text-color);
            padding: 6px 0;
            border-radius: 50%;
            cursor: pointer;
        }

        .date-picker-day:hover {
            background: rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.08);
        }

        .date-picker-day.selected {
            background: var(--primary-color);
            color: var(--text-primary-color, #fff);
        }

        textarea {
            resize: vertical;
            min-height: 48px;
        }

        .actions {
            display: flex;
            align-items: center;
            width: 100%;
        }

        button {
            font-family: Roboto, "Noto Sans", sans-serif;
            font-size: 14px;
            font-weight: 500;
            text-transform: uppercase;
            border: none;
            background: none;
            cursor: pointer;
            padding: 8px 12px;
            border-radius: 4px;
            color: var(--primary-color);
        }

        button.destructive {
            color: var(--error-color);
            margin-inline-end: auto;
        }

        .confirm-delete {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 8px;
            width: 100%;
            font-family: Roboto, "Noto Sans", sans-serif;
            font-size: 14px;
            color: var(--primary-text-color);
        }

        /* flex-basis 100% forces this onto its own row rather than
           shrinking, so on a narrow (phone) dialog the Cancel/Delete
           buttons wrap onto the next line instead of ever being pushed
           out past the dialog's edge - a real risk with the plain
           flex:1 this used to have, since nothing capped how wide the
           text could push. */
        .confirm-delete span {
            flex: 1 1 100%;
            min-width: 0;
        }

        .field-hint {
            font-size: 12px;
            color: var(--error-color);
            margin-top: -8px;
            margin-bottom: 16px;
            font-family: Roboto, "Noto Sans", sans-serif;
        }

        button:disabled {
            opacity: 0.4;
            cursor: default;
        }
    `;
__decorateClass([
  n4({ attribute: false })
], TodoItemDialog.prototype, "heading", 2);
__decorateClass([
  r5()
], TodoItemDialog.prototype, "draftValue", 2);
__decorateClass([
  n4({ attribute: false, hasChanged: () => true })
], TodoItemDialog.prototype, "value", 1);
__decorateClass([
  n4({ attribute: false })
], TodoItemDialog.prototype, "fieldSupport", 2);
__decorateClass([
  n4({ type: Boolean })
], TodoItemDialog.prototype, "showDelete", 2);
__decorateClass([
  n4({ type: Boolean })
], TodoItemDialog.prototype, "showCompleteToggle", 2);
__decorateClass([
  n4({ type: Boolean })
], TodoItemDialog.prototype, "completed", 2);
__decorateClass([
  n4({ type: Boolean })
], TodoItemDialog.prototype, "confirmDelete", 2);
__decorateClass([
  r5()
], TodoItemDialog.prototype, "confirmingDelete", 2);
__decorateClass([
  r5()
], TodoItemDialog.prototype, "dueDay", 2);
__decorateClass([
  r5()
], TodoItemDialog.prototype, "dueMonth", 2);
__decorateClass([
  r5()
], TodoItemDialog.prototype, "dueYear", 2);
__decorateClass([
  r5()
], TodoItemDialog.prototype, "dueHour12", 2);
__decorateClass([
  r5()
], TodoItemDialog.prototype, "dueMinute", 2);
__decorateClass([
  r5()
], TodoItemDialog.prototype, "dueAmPm", 2);
__decorateClass([
  r5()
], TodoItemDialog.prototype, "datePickerOpen", 2);
__decorateClass([
  r5()
], TodoItemDialog.prototype, "datePickerViewYear", 2);
__decorateClass([
  r5()
], TodoItemDialog.prototype, "datePickerViewMonth", 2);
TodoItemDialog = __decorateClass([
  t3("todo-overlay-item-dialog")
], TodoItemDialog);

// src/components/todo-save-load-dialog.ts
var EMPTY_SAVE_LOAD_VALUE = {
  name: "",
  persistStates: false,
  mode: "merge",
  targetItem: ""
};
var MODE_LABELS = {
  merge: "Merge (skip items already there)",
  full_merge: "Add all (allow duplicates)",
  replace: "Replace (clear the list first)"
};
var TodoSaveLoadDialog = class extends i4 {
  constructor() {
    super(...arguments);
    this.action = "save";
    // What the parent last handed in - read ONLY by willUpdate() to seed
    // draftValue exactly once. Never read anywhere else. See draftValue's
    // own comment, and todo-item-dialog.ts's identical pattern (this
    // dialog had the exact same bug: typing a save name on mobile could
    // get silently wiped mid-type by an unrelated parent re-render).
    this._seedValue = EMPTY_SAVE_LOAD_VALUE;
    this.draftValue = EMPTY_SAVE_LOAD_VALUE;
    this.savedNames = [];
    this.targetOptions = [];
    this.valueInitialized = false;
  }
  set value(newValue) {
    this._seedValue = newValue;
  }
  get value() {
    return this.draftValue;
  }
  willUpdate(changed) {
    if (!changed.has("value") || this.valueInitialized) {
      return;
    }
    this.valueInitialized = true;
    this.draftValue = this._seedValue;
  }
  close() {
    this.dispatchEvent(
      new CustomEvent("dialog-close", { bubbles: true, composed: true })
    );
  }
  confirm() {
    this.dispatchEvent(
      new CustomEvent("dialog-confirm", {
        detail: this.value,
        bubbles: true,
        composed: true
      })
    );
  }
  requestDeleteSaved() {
    this.dispatchEvent(
      new CustomEvent("dialog-delete-saved", {
        detail: { name: this.value.name },
        bubbles: true,
        composed: true
      })
    );
  }
  updateName(name) {
    this.draftValue = { ...this.draftValue, name };
  }
  updatePersistStates(persistStates) {
    this.draftValue = { ...this.draftValue, persistStates };
  }
  updateMode(mode) {
    this.draftValue = { ...this.draftValue, mode };
  }
  updateTargetItem(targetItem) {
    this.draftValue = { ...this.draftValue, targetItem };
  }
  render() {
    const isSave = this.action === "save";
    return b2`
            <ha-dialog open .heading=${isSave ? "Save list" : "Load list"} @closed=${this.close}>
                ${isSave ? b2`
                            <div class="field">
                                <label for="save-load-name">Name</label>
                                <input
                                    id="save-load-name"
                                    type="text"
                                    list="save-load-existing-names"
                                    placeholder="e.g. weekly_groceries"
                                    .value=${this.draftValue.name}
                                    @input=${(e7) => this.updateName(e7.target.value)}
                                />
                                <datalist id="save-load-existing-names">
                                    ${this.savedNames.map((name) => b2`<option value=${name}></option>`)}
                                </datalist>
                            </div>

                            <div class="field checkbox-field">
                                <input
                                    id="save-load-persist"
                                    type="checkbox"
                                    .checked=${this.draftValue.persistStates}
                                    @change=${(e7) => this.updatePersistStates(e7.target.checked)}
                                />
                                <label for="save-load-persist">Persist completion states</label>
                            </div>
                        ` : b2`
                            <div class="field">
                                <label for="save-load-select">Saved list</label>
                                <select
                                    id="save-load-select"
                                    .value=${this.draftValue.name}
                                    @change=${(e7) => this.updateName(e7.target.value)}
                                >
                                    <option value="" disabled ?selected=${!this.draftValue.name}>
                                        Choose a saved list…
                                    </option>
                                    ${this.savedNames.map(
      (name) => b2`
                                            <option value=${name} ?selected=${this.draftValue.name === name}>
                                                ${name}
                                            </option>
                                        `
    )}
                                </select>
                            </div>

                            ${this.draftValue.name ? b2`
                                        <div class="delete-row">
                                            <button @click=${this.requestDeleteSaved}>
                                                Delete "${this.draftValue.name}"
                                            </button>
                                        </div>
                                    ` : ""}

                            <div class="field">
                                <label for="save-load-mode">Mode</label>
                                <select
                                    id="save-load-mode"
                                    .value=${this.draftValue.mode}
                                    @change=${(e7) => this.updateMode(e7.target.value)}
                                >
                                    ${Object.keys(MODE_LABELS).map(
      (mode) => b2`
                                            <option value=${mode} ?selected=${this.draftValue.mode === mode}>
                                                ${MODE_LABELS[mode]}
                                            </option>
                                        `
    )}
                                </select>
                            </div>

                            <div class="field">
                                <label for="save-load-target">Load into</label>
                                <select
                                    id="save-load-target"
                                    .value=${this.draftValue.targetItem}
                                    @change=${(e7) => this.updateTargetItem(e7.target.value)}
                                >
                                    <option value="" ?selected=${!this.draftValue.targetItem}>
                                        Top level
                                    </option>
                                    ${this.targetOptions.map(
      (option) => b2`
                                            <option
                                                value=${option.id}
                                                ?selected=${this.draftValue.targetItem === option.id}
                                            >
                                                ${option.label}
                                            </option>
                                        `
    )}
                                </select>
                                ${this.draftValue.targetItem && this.draftValue.mode === "replace" ? b2`
                                            <div class="field-hint">
                                                Only this item's own existing children are cleared first -
                                                the rest of the list is untouched.
                                            </div>
                                        ` : ""}
                            </div>
                        `}

                <div class="actions" slot="footer">
                    <button @click=${this.close}>Cancel</button>
                    <button @click=${this.confirm} ?disabled=${!this.draftValue.name}>
                        ${isSave ? "Save" : "Load"}
                    </button>
                </div>
            </ha-dialog>
        `;
  }
};
TodoSaveLoadDialog.styles = i`
        .field {
            display: flex;
            flex-direction: column;
            gap: 4px;
            margin-bottom: 16px;
            font-family: Roboto, "Noto Sans", sans-serif;
        }

        label {
            font-size: 12px;
            color: var(--secondary-text-color);
        }

        .field-hint {
            font-size: 12px;
            color: var(--secondary-text-color);
            margin-top: 2px;
        }

        input,
        select {
            box-sizing: border-box;
            width: 100%;
            font-family: inherit;
            font-size: 16px;
            color: var(--primary-text-color);
            background: none;
            border: none;
            border-bottom: 1px solid var(--divider-color);
            padding: 8px 0;
            outline: none;
            color-scheme: light dark;
        }

        input:focus,
        select:focus {
            border-bottom: 2px solid var(--primary-color);
            padding-bottom: 7px;
        }

        .checkbox-field {
            flex-direction: row;
            align-items: center;
            gap: 8px;
        }

        .checkbox-field input {
            width: auto;
            border: none;
        }

        .checkbox-field label {
            font-size: 14px;
            color: var(--primary-text-color);
        }

        .delete-row {
            display: flex;
            justify-content: flex-end;
            margin-top: -8px;
            margin-bottom: 16px;
        }

        .delete-row button {
            font-family: inherit;
            font-size: 12px;
            color: var(--error-color);
            background: none;
            border: none;
            cursor: pointer;
            padding: 4px;
        }

        .actions {
            display: flex;
            align-items: center;
            justify-content: flex-end;
            width: 100%;
            gap: 8px;
        }

        button {
            font-family: Roboto, "Noto Sans", sans-serif;
            font-size: 14px;
            font-weight: 500;
            text-transform: uppercase;
            border: none;
            background: none;
            cursor: pointer;
            padding: 8px 12px;
            border-radius: 4px;
            color: var(--primary-color);
        }

        button:disabled {
            color: var(--disabled-text-color);
            cursor: default;
        }
    `;
__decorateClass([
  n4({ attribute: false })
], TodoSaveLoadDialog.prototype, "action", 2);
__decorateClass([
  r5()
], TodoSaveLoadDialog.prototype, "draftValue", 2);
__decorateClass([
  n4({ attribute: false, hasChanged: () => true })
], TodoSaveLoadDialog.prototype, "value", 1);
__decorateClass([
  n4({ attribute: false })
], TodoSaveLoadDialog.prototype, "savedNames", 2);
__decorateClass([
  n4({ attribute: false })
], TodoSaveLoadDialog.prototype, "targetOptions", 2);
TodoSaveLoadDialog = __decorateClass([
  t3("todo-overlay-save-load-dialog")
], TodoSaveLoadDialog);

// src/grouping.ts
var OTHER_TITLE = "Other";
var OTHER_BUCKET_THRESHOLD = 2;
function isStructural(item) {
  return item.children.length > 0 || item.pin_type != null;
}
function otherGroupId(parentId) {
  return `__other__:${parentId ?? "root"}`;
}
function groupSiblingsForDisplay(items, parentId) {
  const structuralCount = items.reduce((count, item) => count + (isStructural(item) ? 1 : 0), 0);
  if (structuralCount < OTHER_BUCKET_THRESHOLD) {
    return items;
  }
  const structural = [];
  const plain = [];
  for (const item of items) {
    (isStructural(item) ? structural : plain).push(item);
  }
  if (plain.length === 0) {
    return items;
  }
  const other = {
    id: otherGroupId(parentId),
    title: OTHER_TITLE,
    completed: plain.every((item) => item.completed),
    description: null,
    due_date: null,
    due_datetime: null,
    quantity: null,
    tags: [],
    trigger_on_due: false,
    pin_type: null,
    children: plain,
    synthetic: true
  };
  return [...structural, other];
}

// src/components/todo-tree-item.ts
var BEFORE_AFTER_ZONE = 0.3;
var ROW_INDENT_PX = 20;
var rowIndentPx = r(`${ROW_INDENT_PX}px`);
var DROP_GAP_PX = 52;
var dropGapPx = r(`${DROP_GAP_PX}px`);
var MOVE_CANCEL_THRESHOLD_PX = 6;
var HOLD_RIPPLE_SIZE = 72;
var holdRippleSizePx = r(`${HOLD_RIPPLE_SIZE}px`);
var CLICK_DEBOUNCE_MS = 250;
var SWIPE_AXIS_LOCK_PX = 12;
var SWIPE_ACTION_THRESHOLD_PX = 88;
var SWIPE_MAX_REVEAL_PX = 132;
var CLOCK_ICON = b2`
    <svg viewBox="0 0 24 24">
        <path
            d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm.5 5v5.4l4.2 2.5-.8 1.3-5-3V7h1.6z"
        ></path>
    </svg>
`;
var CHEVRON_ICON = b2`
    <svg viewBox="0 0 24 24">
        <path d="M8.59 16.59 13.17 12 8.59 7.41 10 6l6 6-6 6z"></path>
    </svg>
`;
var BELL_ICON = b2`
    <svg class="trigger-armed-icon" viewBox="0 0 24 24">
        <path
            d="M12,22C13.1,22 14,21.1 14,20H10C10,21.1 10.9,22 12,22M18,16V11C18,7.93 16.36,5.36 13.5,4.68V4C13.5,3.17 12.83,2.5 12,2.5C11.17,2.5 10.5,3.17 10.5,4V4.68C7.63,5.36 6,7.92 6,11V16L4,18V19H20V18L18,16Z"
        ></path>
    </svg>
`;
var CROSS_ICON = b2`
    <svg viewBox="0 0 24 24">
        <path d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"></path>
    </svg>
`;
var PLUS_ICON = b2`
    <svg viewBox="0 0 24 24"><path d="M19 13H13V19H11V13H5V11H11V5H13V11H19V13Z"></path></svg>
`;
var DRAG_HANDLE_ICON = b2`
    <svg viewBox="0 0 24 24">
        <path d="M9,3H11V5H9V3M13,3H15V5H13V3M9,7H11V9H9V7M13,7H15V9H13V7M9,11H11V13H9V11M13,11H15V13H13V11M9,15H11V17H9V15M13,15H15V17H13V15M9,19H11V21H9V19M13,19H15V21H13V19Z"></path>
    </svg>
`;
var DELETE_CONFIRM_WINDOW_MS = 3e3;
var ROW_COLLAPSE_MS = 180;
function formatDue(item) {
  const raw = item.due_datetime ?? (item.due_date ? `${item.due_date}T00:00:00` : null);
  if (!raw) {
    return void 0;
  }
  const due = new Date(raw);
  const now = /* @__PURE__ */ new Date();
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((dueDay.getTime() - today.getTime()) / 864e5);
  let label;
  if (diffDays === 0) {
    label = "Today";
  } else if (diffDays === 1) {
    label = "Tomorrow";
  } else if (diffDays === -1) {
    label = "Yesterday";
  } else {
    label = due.toLocaleDateString(void 0, {
      month: "short",
      day: "numeric",
      year: dueDay.getFullYear() !== today.getFullYear() ? "numeric" : void 0
    });
  }
  return {
    label,
    overdue: isOverdue(item)
  };
}
var TodoTreeItem = class extends i4 {
  constructor() {
    super(...arguments);
    this.hoverDepth = 0;
    this.hideCompleteForParents = false;
    this.showCheckboxes = false;
    this.confirmDelete = true;
    this.dragDisabled = false;
    this.collapsedIds = /* @__PURE__ */ new Set();
    this.dimmedByAncestorDrag = false;
    this.reorderModeActive = false;
    this.childQuickAddParentIds = /* @__PURE__ */ new Set();
    this.addModeActive = false;
    this.deleteModeActive = false;
    this.dragEngaged = false;
    this.confirmingDelete = false;
    this.swipeOffsetX = 0;
    this.swipeDragging = false;
    this.childQuickAddValue = "";
    this.pointerDownAt = 0;
    this.hasMoved = false;
    // Mouse users have no reason to wait out the hold timer before a drag
    // picks up - there's no competing "swipe to scroll" gesture to protect
    // against, unlike touch, where a quick swipe must be left alone (see
    // onWindowPointerMove) so the page still scrolls normally.
    this.pointerIsMouse = false;
    // Set only by handlePointerDown (the dedicated .drag-handle, touch's
    // only path to a drag) - engages immediately on the first move past
    // the jitter threshold, same as pointerIsMouse, since the handle has
    // no "quick swipe = scroll" ambiguity to wait out in the first place.
    this.initiatedFromHandle = false;
    // Gates onWindowTouchTail - deliberately a SEPARATE flag from
    // swipeAxis, not a re-read of it, because pointerup and this same
    // gesture's own trailing touchend are two independent events for
    // one physical release, and pointerup's own handling (see
    // pointerUp/resolveSwipe) can finish running - clearing swipeAxis
    // in the process - before the browser has even dispatched that
    // touchend yet (confirmed live, via real Chrome touch simulation,
    // not assumed: swipe-navigation's own touchend listener still ran
    // once out of every real gesture tested, despite swipeAxis already
    // being "horizontal" throughout). This flag instead stays true for
    // exactly as long as the touch-tail listeners themselves stay
    // attached (see detachWindowListeners' own deferred cleanup),
    // spanning past that gap on purpose.
    this.touchTailArmed = false;
    // .drag-handle's own pointerdown - stops propagation so the row's own
    // pointerDown (bound on .row) doesn't ALSO fire for the same press
    // (it would otherwise, since the handle is a child of .row). Runs the
    // exact same setup as a normal press, then marks it as handle-
    // initiated so onWindowPointerMove engages immediately instead of
    // waiting out (or ever reaching) the hold threshold.
    this.handlePointerDown = (e7) => {
      e7.stopPropagation();
      this.pointerDown(e7);
      this.initiatedFromHandle = true;
    };
    this.onWindowPointerMove = (e7) => {
      if (!this.pointerDownScreenPos || this.dragEngaged) {
        return;
      }
      const dx = e7.clientX - this.pointerDownScreenPos.x;
      const dy = e7.clientY - this.pointerDownScreenPos.y;
      if (Math.hypot(dx, dy) <= MOVE_CANCEL_THRESHOLD_PX) {
        return;
      }
      if (!this.dragDisabled && (this.pointerIsMouse || this.initiatedFromHandle)) {
        this.hasMoved = true;
        this.dragEngaged = true;
        if (this.initiatedFromHandle) {
          e7.preventDefault();
        }
        const grabOffset = this.holdRippleOrigin ?? { x: 0, y: 0 };
        this.clearHoldRipple();
        const rowEl = this.shadowRoot?.querySelector(".row");
        const rect = rowEl?.getBoundingClientRect();
        this.dispatchEvent(
          new CustomEvent("tree-drag-start", {
            detail: {
              id: this.item.id,
              rect: rect ? { x: rect.left, y: rect.top, width: rect.width, height: rect.height } : void 0,
              grabOffsetX: grabOffset.x,
              grabOffsetY: grabOffset.y,
              pointerX: e7.clientX,
              pointerY: e7.clientY,
              pointerType: e7.pointerType
            },
            bubbles: true,
            composed: true
          })
        );
        return;
      }
      this.cancelHoldForMovement();
      if (this.pointerIsMouse || this.reorderModeActive) {
        return;
      }
      this.trackSwipe(dx, dy, e7);
    };
    this.onWindowPointerUp = () => {
      this.pointerUp();
    };
    // Stops a locked-in horizontal swipe's raw touch events from ever
    // reaching a page-level gesture recognizer attached higher up the
    // DOM (e.g. a swipe-between-tabs add-on listening on the app's own
    // layout element, in the default bubble phase) - this listener is
    // attached at window with {capture: true} (see pointerDown), which
    // runs BEFORE any bubble-phase listener anywhere else on the page,
    // so stopping propagation here reliably keeps it from ever seeing
    // enough of the gesture to register its own swipe. Left alone
    // entirely for anything that isn't a locked-in horizontal swipe on
    // THIS row (an ambiguous press, a vertical scroll, a reorder-handle
    // drag) - swiping to navigate everywhere else on the dashboard is
    // completely unaffected. Gated on touchTailArmed, not swipeAxis
    // directly - see that field's own comment for why.
    this.onWindowTouchTail = (e7) => {
      if (this.touchTailArmed) {
        e7.stopPropagation();
      }
    };
  }
  get isPressed() {
    return this.draggedId === this.item.id;
  }
  get isBeingDragged() {
    return this.isPressed && this.dragEngaged;
  }
  get isDropTarget() {
    return this.hoverId === this.item.id && this.draggedId !== void 0 && this.draggedId !== this.item.id;
  }
  // Ticking a parent normally cascades completion to every descendant -
  // easy to trigger by accident on a row that's mostly there to show
  // hierarchy. With hideCompleteForParents on, such a row shows no
  // checkbox at all; completing it becomes a deliberate action via the
  // edit dialog instead (see todo-overlay.ts's onPointerUp and
  // todo-item-dialog.ts's complete toggle).
  //
  // A pinned item (see isPinned) or the synthetic Other row (see
  // isSynthetic) never shows a checkbox at all, unconditionally - not
  // gated by hideCompleteForParents/showCheckboxes the way a REAL
  // parent's is. Both are a deliberate structural declaration ("this
  // is a category/person", "this is a grouping, not a real item"),
  // categorically different from "this happens to have accumulated
  // children" - the one case the existing toggle is actually about.
  get checkboxHidden() {
    if (this.isPinned || this.isSynthetic) {
      return true;
    }
    if (!this.showCheckboxes) {
      return true;
    }
    return this.hideCompleteForParents && this.item.children.length > 0;
  }
  get isPinned() {
    return this.item.pin_type != null;
  }
  // True only for the one synthetic "Other" row groupSiblingsForDisplay
  // generates when a level's plain siblings get swept up (see
  // grouping.ts) - never a real item, so every interactive affordance
  // a normal row has (edit, delete, add-child, drag, swipe) is
  // suppressed for it; only collapse/expand still works, exactly like
  // any other structural row.
  get isSynthetic() {
    return Boolean(this.item.synthetic);
  }
  // Always shown as a section header - bold/tracked title, no
  // checkbox - regardless of whether it currently has any children:
  // either because it genuinely does, or because it's pinned as a
  // stand-in for one that will. The leading collapse-slot glyph (see
  // the template's own collapse-toggle branch) reacts to this too,
  // but not uniformly - see its own comment for why a childless
  // pinned row gets a distinct, non-interactive placeholder rather
  // than the real (clickable) chevron a row with actual children
  // gets. The completed-count badge (see childStatus) deliberately
  // stays gated on REAL children only - a pin alone shouldn't ever
  // show a "0/0".
  get isStructural() {
    return this.hasChildren || this.isPinned;
  }
  get hasChildren() {
    return this.item.children.length > 0;
  }
  get isCollapsed() {
    return this.hasChildren && this.collapsedIds.has(this.item.id);
  }
  get childStatus() {
    if (!this.hasChildren) {
      return void 0;
    }
    return {
      completed: this.item.children.filter((child) => child.completed).length,
      total: this.item.children.length
    };
  }
  toggleCollapse(e7) {
    e7.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("tree-toggle-collapse", {
        detail: { id: this.item.id },
        bubbles: true,
        composed: true
      })
    );
  }
  onDeleteClick(e7) {
    e7.stopPropagation();
    window.clearTimeout(this.deleteConfirmTimer);
    if (this.confirmDelete && !this.confirmingDelete) {
      this.confirmingDelete = true;
      this.deleteConfirmTimer = window.setTimeout(() => {
        this.confirmingDelete = false;
      }, DELETE_CONFIRM_WINDOW_MS);
      return;
    }
    this.confirmingDelete = false;
    this.dispatchDeleteAfterCollapse();
  }
  // Collapses this row's own <li> (height, opacity, margin, padding)
  // before actually dispatching tree-delete-item - see
  // ROW_COLLAPSE_MS's own comment for why. Falls back to dispatching
  // immediately if the <li> can't be found for some reason (should
  // never happen, but a delete action must never silently no-op just
  // because a cosmetic animation setup failed). A plain
  // window.setTimeout, not transitionend, drives the actual dispatch -
  // more robust against edge cases (e.g. prefers-reduced-motion
  // collapsing the transition to 0 duration, or the element being
  // torn down mid-transition for an unrelated reason) than depending
  // on the event actually firing.
  dispatchDeleteAfterCollapse() {
    const li = this.renderRoot.querySelector("li");
    if (!li) {
      this.dispatchDeleteEvent();
      return;
    }
    const height = li.getBoundingClientRect().height;
    li.style.overflow = "hidden";
    li.style.height = `${height}px`;
    li.style.transition = [
      `height ${ROW_COLLAPSE_MS}ms ease`,
      `opacity ${ROW_COLLAPSE_MS}ms ease`,
      `margin ${ROW_COLLAPSE_MS}ms ease`,
      `padding ${ROW_COLLAPSE_MS}ms ease`
    ].join(", ");
    li.style.opacity = "1";
    li.getBoundingClientRect();
    requestAnimationFrame(() => {
      li.style.height = "0px";
      li.style.opacity = "0";
      li.style.marginTop = "0px";
      li.style.marginBottom = "0px";
      li.style.paddingTop = "0px";
      li.style.paddingBottom = "0px";
    });
    window.setTimeout(() => this.dispatchDeleteEvent(), ROW_COLLAPSE_MS);
  }
  dispatchDeleteEvent() {
    this.dispatchEvent(
      new CustomEvent("tree-delete-item", {
        detail: { id: this.item.id },
        bubbles: true,
        composed: true
      })
    );
  }
  onToggleChildQuickAddClick(e7) {
    e7.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("tree-toggle-child-quick-add", {
        detail: { id: this.item.id },
        bubbles: true,
        composed: true
      })
    );
  }
  onChildQuickAddInput(e7) {
    this.childQuickAddValue = e7.target.value;
  }
  onChildQuickAddKeydown(e7) {
    if (e7.key === "Enter") {
      this.submitChildQuickAdd();
    }
  }
  // Clears the field the moment it's sent, not once todo-overlay-list.ts
  // confirms the create actually succeeded (unlike the root quick-add's
  // own submitQuickAdd, which can afford to wait since it's the one
  // holding the value) - this component has no way to know that
  // outcome without a value threaded back down just to say "clear
  // now", so an error banner (see reportError) is the fallback if the
  // create fails, same as it would be for any other failed action.
  submitChildQuickAdd() {
    const title = this.childQuickAddValue.trim();
    if (!title) {
      return;
    }
    this.childQuickAddValue = "";
    this.dispatchEvent(
      new CustomEvent("tree-quick-add-child", {
        detail: { parentId: this.item.id, title },
        bubbles: true,
        composed: true
      })
    );
  }
  pointerDown(e7) {
    if (this.isSynthetic) {
      return;
    }
    this.pointerDownAt = Date.now();
    this.pointerDownScreenPos = { x: e7.clientX, y: e7.clientY };
    this.hasMoved = false;
    this.dragEngaged = false;
    this.initiatedFromHandle = false;
    this.swipeAxis = void 0;
    this.touchTailArmed = false;
    this.pointerIsMouse = e7.pointerType === "mouse";
    const rect = this.shadowRoot?.querySelector(".row")?.getBoundingClientRect() ?? e7.currentTarget.getBoundingClientRect();
    this.holdRippleOrigin = { x: e7.clientX - rect.left, y: e7.clientY - rect.top };
    window.clearTimeout(this.holdTimer);
    this.holdTimer = window.setTimeout(() => {
      this.requestUpdate();
    }, LONG_PRESS_MS);
    window.addEventListener("pointermove", this.onWindowPointerMove, { capture: true });
    window.addEventListener("pointerup", this.onWindowPointerUp, { capture: true });
    window.addEventListener("pointercancel", this.onWindowPointerUp, { capture: true });
    window.addEventListener("touchmove", this.onWindowTouchTail, { capture: true });
    window.addEventListener("touchend", this.onWindowTouchTail, { capture: true });
    window.addEventListener("touchcancel", this.onWindowTouchTail, { capture: true });
    this.dispatchEvent(
      new CustomEvent("tree-pointer-down", {
        detail: { id: this.item.id },
        bubbles: true,
        composed: true
      })
    );
  }
  get holdReady() {
    return this.isPressed && Date.now() - this.pointerDownAt >= LONG_PRESS_MS;
  }
  clearHoldRipple() {
    window.clearTimeout(this.holdTimer);
    this.holdRippleOrigin = void 0;
  }
  // Hold and drag are mutually exclusive - once the pointer has moved
  // meaningfully before the hold threshold, this permanently cancels
  // the hold for the rest of the gesture (the ripple disappears, and
  // pointerUp will treat it as an ambiguous no-op rather than a hold).
  cancelHoldForMovement() {
    if (this.hasMoved) {
      return;
    }
    this.hasMoved = true;
    this.clearHoldRipple();
  }
  // Determines the gesture's dominant axis once movement clears
  // SWIPE_AXIS_LOCK_PX, then either drives .row's own live translateX
  // (horizontal) or leaves the rest of the gesture alone entirely
  // (vertical - native scroll, via .row's own touch-action: pan-y,
  // already owns it). Locked for the remainder of THIS gesture either
  // way - see swipeAxis's own comment for why a fresh decision is
  // only ever made at the next pointerDown.
  trackSwipe(dx, dy, e7) {
    if (this.swipeAxis === void 0) {
      if (Math.abs(dx) < SWIPE_AXIS_LOCK_PX && Math.abs(dy) < SWIPE_AXIS_LOCK_PX) {
        return;
      }
      this.swipeAxis = Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
      if (this.swipeAxis === "horizontal") {
        this.swipeDragging = true;
        this.touchTailArmed = true;
      }
    }
    if (this.swipeAxis !== "horizontal") {
      return;
    }
    e7.preventDefault();
    this.swipeOffsetX = Math.max(-SWIPE_MAX_REVEAL_PX, Math.min(SWIPE_MAX_REVEAL_PX, dx));
  }
  detachWindowListeners() {
    window.removeEventListener("pointermove", this.onWindowPointerMove, { capture: true });
    window.removeEventListener("pointerup", this.onWindowPointerUp, { capture: true });
    window.removeEventListener("pointercancel", this.onWindowPointerUp, { capture: true });
    window.setTimeout(() => {
      this.touchTailArmed = false;
      window.removeEventListener("touchmove", this.onWindowTouchTail, { capture: true });
      window.removeEventListener("touchend", this.onWindowTouchTail, { capture: true });
      window.removeEventListener("touchcancel", this.onWindowTouchTail, { capture: true });
    }, 0);
  }
  emitPointerUp(pressDurationMs, moved = false) {
    this.dispatchEvent(
      new CustomEvent("tree-pointer-up", {
        detail: { id: this.item.id, pressDurationMs, moved },
        bubbles: true,
        composed: true
      })
    );
  }
  pointerUp() {
    this.detachWindowListeners();
    this.clearHoldRipple();
    const pressDurationMs = Date.now() - this.pointerDownAt;
    if (this.dragEngaged) {
      this.dragEngaged = false;
      return;
    }
    if (this.swipeAxis === "horizontal") {
      this.resolveSwipe();
      return;
    }
    if (this.hasMoved || pressDurationMs >= LONG_PRESS_MS) {
      this.emitPointerUp(pressDurationMs, this.hasMoved);
      return;
    }
    if (this.clickTimer !== void 0) {
      window.clearTimeout(this.clickTimer);
      this.clickTimer = void 0;
      this.emitPointerUp(LONG_PRESS_MS, false);
      return;
    }
    this.clickTimer = window.setTimeout(() => {
      this.clickTimer = void 0;
      this.emitPointerUp(pressDurationMs, false);
    }, CLICK_DEBOUNCE_MS);
  }
  // Release past SWIPE_ACTION_THRESHOLD_PX commits to whichever
  // action that direction means (delete on the left, add-child on
  // the right) - no separate confirm tap, the swipe-then-release-
  // past-the-line already IS the confirmation, the same "reveals,
  // release-past-threshold confirms" model a native iOS/Android
  // swipe-to-delete list row uses. Short of the threshold - or
  // dragged back toward 0 before release - springs back as a no-op
  // instead. Reuses the exact same tree-delete-item/
  // tree-toggle-child-quick-add events the desktop per-row buttons
  // already dispatch (see onDeleteClick/onToggleChildQuickAddClick),
  // not a separate touch-only code path on the list side - swiping
  // right on an already-open field closes it, same as tapping its
  // toggle button a second time would on desktop.
  resolveSwipe() {
    const offset = this.swipeOffsetX;
    this.swipeAxis = void 0;
    this.swipeDragging = false;
    this.swipeOffsetX = 0;
    if (offset <= -SWIPE_ACTION_THRESHOLD_PX) {
      this.dispatchDeleteAfterCollapse();
    } else if (offset >= SWIPE_ACTION_THRESHOLD_PX) {
      this.dispatchEvent(
        new CustomEvent("tree-toggle-child-quick-add", {
          detail: { id: this.item.id },
          bubbles: true,
          composed: true
        })
      );
    }
  }
  render() {
    const isDropTarget = this.isDropTarget;
    const isBeingDragged = this.isBeingDragged;
    const displayChildren = groupSiblingsForDisplay(this.item.children, this.item.id);
    const rowClasses = {
      row: true,
      pressed: this.isPressed && !isBeingDragged,
      lifted: isBeingDragged,
      dimmed: this.dimmedByAncestorDrag,
      "drop-inside": isDropTarget && this.hoverPlacement === "inside",
      "gap-before": isDropTarget && this.hoverPlacement === "before",
      "gap-after": isDropTarget && this.hoverPlacement === "after",
      completed: this.item.completed,
      // Any drag from THIS list being active, not just this row's
      // own - see .row:not(.drag-active):hover's own comment.
      "drag-active": this.draggedId !== void 0
    };
    const due = formatDue(this.item);
    const hasMeta = due || this.item.description || this.item.tags.length > 0;
    const status = this.childStatus;
    return b2`
            <li>

                <div class="row-wrapper">
                    ${this.swipeOffsetX !== 0 ? b2`
                                <div class="swipe-action-layer">
                                    ${this.swipeOffsetX < 0 ? b2`
                                                <div class=${e6({
      "swipe-action": true,
      delete: true,
      armed: this.swipeOffsetX <= -SWIPE_ACTION_THRESHOLD_PX
    })}>
                                                    ${CROSS_ICON}
                                                </div>
                                            ` : b2`
                                                <div class=${e6({
      "swipe-action": true,
      add: true,
      armed: this.swipeOffsetX >= SWIPE_ACTION_THRESHOLD_PX
    })}>
                                                    ${PLUS_ICON}
                                                </div>
                                            `}
                                </div>
                            ` : ""}
                    <div
                        class=${e6({ ...rowClasses, swiping: this.swipeDragging })}
                        style=${o6({ transform: this.swipeOffsetX ? `translateX(${this.swipeOffsetX}px)` : "" })}
                        ?data-synthetic=${this.isSynthetic}

                        @pointerdown=${this.pointerDown}
                    >
                    ${// Reordering (before/after) shows the shadow box in
    // the gap it just opened; becoming a child ("inside")
    // shows no shadow box at all - the bounding-box
    // outline on THIS row (see rowClasses' drop-inside)
    // is the whole highlight for that case.
    isDropTarget && this.hoverPlacement !== "inside" ? b2`
                                <div
                                    class=${e6({
      "drop-shadow-box": true,
      above: this.hoverPlacement === "before",
      below: this.hoverPlacement === "after"
    })}
                                    style=${o6({ left: `${this.hoverDepth * ROW_INDENT_PX}px` })}
                                ></div>
                            ` : ""}
                    ${isBeingDragged ? "" : b2`
                                ${this.hasChildren ? b2`
                                            <button
                                                class=${e6({
      "collapse-toggle": true,
      collapsed: this.isCollapsed
    })}
                                                aria-label=${this.isCollapsed ? "Expand" : "Collapse"}
                                                @click=${this.toggleCollapse}
                                                @pointerdown=${(e7) => e7.stopPropagation()}
                                            >
                                                ${CHEVRON_ICON}
                                            </button>
                                        ` : this.isStructural ? b2`
                                                <span class="structural-placeholder" aria-hidden="true">
                                                    <span class="dash"></span>
                                                </span>
                                            ` : b2`<span class="collapse-toggle-spacer"></span>`}

                                ${// A person pin gets a small initial
    // avatar in place of the checkbox
    // slot - never for the synthetic
    // Other row, which has no title
    // that means anything as a "person"
    // (and is never pinned to begin
    // with - see isSynthetic).
    this.item.pin_type === "person" && !this.isSynthetic ? b2`
                                            <div class="person-avatar" aria-hidden="true">
                                                ${this.item.title.trim().charAt(0).toUpperCase() || "?"}
                                            </div>
                                        ` : this.checkboxHidden ? "" : b2`
                                                <div class="checkbox-slot">
                                                    <ha-checkbox .checked=${this.item.completed}></ha-checkbox>
                                                </div>
                                            `}

                                <div class="content">
                                    <div class="title-line">
                                        <span class=${e6({ summary: true, structural: this.isStructural })}>${this.item.title}</span>
                                        ${this.item.quantity ? b2`<span class="quantity-chip">${this.item.quantity}</span>` : ""}
                                        ${status ? b2`
                                                    <span class=${e6({
      "status-chip": true,
      "all-done": status.completed === status.total
    })}>
                                                        ${status.completed}/${status.total}
                                                    </span>
                                                ` : ""}
                                    </div>

                                    ${hasMeta ? b2`
                                                <div class="row-meta">
                                                    ${due ? b2`
                                                                <span
                                                                    class=${e6({ "due-chip": true, overdue: due.overdue })}
                                                                    title=${this.item.trigger_on_due ? "Triggers an automation when due" : A}
                                                                >
                                                                    ${CLOCK_ICON}${due.label}
                                                                    ${this.item.trigger_on_due ? BELL_ICON : ""}
                                                                </span>
                                                            ` : ""}
                                                    ${this.item.tags.map((tag) => b2`<span class="tag-chip">${tag}</span>`)}
                                                    ${this.item.description ? b2`<span class="description-text">${this.item.description}</span>` : ""}
                                                </div>
                                            ` : ""}
                                </div>

                                ${// The synthetic Other row (see
    // isSynthetic) is never draggable,
    // never gains a child, never gets
    // deleted - it isn't a real item at
    // all, just a view-time grouping
    // over some of this level's real
    // siblings. Only collapse/expand
    // still works for it, same as any
    // other structural row.
    this.isSynthetic ? "" : this.reorderModeActive ? b2`
                                                <button
                                                    class="drag-handle"
                                                    aria-label="Drag to reorder"
                                                    @pointerdown=${this.handlePointerDown}
                                                >
                                                    ${DRAG_HANDLE_ICON}
                                                </button>
                                            ` : this.addModeActive ? b2`
                                                    <button
                                                        class=${e6({
      "child-quick-add-toggle": true,
      active: this.childQuickAddParentIds.has(this.item.id)
    })}
                                                        aria-label=${this.childQuickAddParentIds.has(this.item.id) ? "Close add-child field" : "Add child item"}
                                                        @click=${this.onToggleChildQuickAddClick}
                                                        @pointerdown=${(e7) => e7.stopPropagation()}
                                                    >
                                                        ${this.childQuickAddParentIds.has(this.item.id) ? CROSS_ICON : PLUS_ICON}
                                                    </button>
                                                ` : this.deleteModeActive && !this.hasChildren ? b2`
                                                        <button
                                                            class=${e6({
      "delete-button": true,
      confirming: this.confirmingDelete
    })}
                                                            aria-label=${this.confirmingDelete ? "Confirm delete" : "Delete"}
                                                            @click=${this.onDeleteClick}
                                                            @pointerdown=${(e7) => e7.stopPropagation()}
                                                        >
                                                            ${CROSS_ICON}
                                                        </button>
                                                    ` : ""}

                                ${this.holdRippleOrigin ? b2`
                                            <div
                                                class=${e6({ "hold-ripple": true, active: this.holdReady })}
                                                style=${o6({
      left: `${this.holdRippleOrigin.x}px`,
      top: `${this.holdRippleOrigin.y}px`
    })}
                                            ></div>
                                        ` : ""}
                            `}
                    </div>
                </div>

                ${this.childQuickAddParentIds.has(this.item.id) ? b2`
                            <div class="child-quick-add-row">
                                <input
                                    type="text"
                                    placeholder="Add item"
                                    .value=${this.childQuickAddValue}
                                    @input=${this.onChildQuickAddInput}
                                    @keydown=${this.onChildQuickAddKeydown}
                                    @pointerdown=${(e7) => e7.stopPropagation()}
                                />
                                <button @click=${this.submitChildQuickAdd}>
                                    Add
                                </button>
                            </div>
                        ` : ""}

                ${this.hasChildren && !this.isCollapsed ? b2`
                            <ul>
                                ${displayChildren.map(
      (child) => b2`
                                        <todo-overlay-tree-item
                                            .item=${child}
                                            .draggedId=${this.draggedId}
                                            .hoverId=${this.hoverId}
                                            .hoverPlacement=${this.hoverPlacement}
                                            .hoverDepth=${this.hoverDepth}
                                            .hideCompleteForParents=${this.hideCompleteForParents}
                                            .showCheckboxes=${this.showCheckboxes}
                                            .confirmDelete=${this.confirmDelete}
                                            .dragDisabled=${this.dragDisabled}
                                            .collapsedIds=${this.collapsedIds}
                                            .dimmedByAncestorDrag=${isBeingDragged || this.dimmedByAncestorDrag}
                                            .reorderModeActive=${this.reorderModeActive}
                                            .childQuickAddParentIds=${this.childQuickAddParentIds}
                                            .addModeActive=${this.addModeActive}
                                            .deleteModeActive=${this.deleteModeActive}
                                        ></todo-overlay-tree-item>
                                    `
    )}
                            </ul>
                        ` : ""}

            </li>
        `;
  }
};
TodoTreeItem.styles = i`
        :host {
            display: block;
        }

        ul {
            list-style: none;
            margin: 0;
            padding-inline-start: ${rowIndentPx};
        }

        .row {
            position: relative;
            display: flex;
            align-items: center;
            gap: 8px;
            min-height: 32px;
            padding: 5px 12px;
            border-radius: 4px;
            outline: 2px solid transparent;
            outline-offset: -2px;
            user-select: none;
            cursor: pointer;
            transition: background-color 0.15s ease, outline-color 0.15s ease, margin 150ms ease;
            /* Leaves vertical panning to the browser's own native
               scroll (so the page still scrolls normally on a quick
               vertical touch, no different from before this existed)
               while claiming horizontal movement for trackSwipe below
               instead of letting the browser interpret it as anything
               native (e.g. an edge back-navigation gesture) - the
               standard, purpose-built tool for exactly this "one axis
               is native, the other is mine" split, unlike trying to
               toggle touch-action mid-gesture (tried first for drag,
               doesn't reliably work - see the class docstring above),
               which this sidesteps entirely by being static from the
               very first touchstart. */
            touch-action: pan-y;
        }

        /* Suppressed while a drag is active (see rowClasses' drag-active) -
           :hover tracks the literal cursor position, which is a
           genuinely different (and, once hysteresis/gap-correction are
           involved, not always identical) thing from the actual resolved
           drop target the orange/gap highlighting already shows. Live-
           reported as confusing to have both visible and drifting apart
           at once - the drop-target highlight is the only "where is this
           going" signal needed once a drag is underway. */
        .row:not(.drag-active):hover {
            background: rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.06);
        }

        .row.pressed {
            background: rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.12);
        }

        /* The dragged row itself is fully removed from the flow, not
           shrunk to a placeholder box - a lingering box here (whatever
           its size or fill) reads as debris left behind by the item,
           disconnected from the ghost that's now following the pointer
           (see renderDragGhost) elsewhere on screen. Hit-testing already
           treats this row as gone (collectAllRows/snapshotRows exclude
           it), so the visual now matches: nothing stays behind, the list
           closes up around the gap immediately, and the ghost is the
           only thing representing the item until it drops. */
        .row.lifted {
            display: none;
        }

        /* Marks every row inside a dragged parent's subtree as moving
           along with it - no height/layout change (unlike .lifted, which
           collapses), so nothing reflows and nothing else on the row
           shifts position mid-drag. */
        .row.dimmed {
            opacity: 0.45;
        }

        /* "inside" (becoming this row's child) draws a bounding box
           around the row itself, rather than opening a gap - dragging
           OVER an existing parent to nest under it is a fundamentally
           different gesture from reordering past a sibling, and reads
           more clearly as "drop into this container" when the container
           itself is outlined, the same way a file manager highlights a
           folder you're dragging onto rather than showing a shadow copy
           of the file inside it. */
        .row.drop-inside {
            outline-color: var(--accent-color, var(--primary-color));
            background: rgba(var(--rgb-accent-color, 255, 152, 0), 0.08);
        }

        /* Instead of a static line, the sibling next to the drop point
           opens a live gap (matching the space a lifted row leaves
           behind), so the list visibly reflows to show where the item
           would land rather than just marking the spot. Reordering only -
           see .row.drop-inside above for why becoming a child looks
           different. */
        .row.gap-before {
            margin-top: ${dropGapPx};
        }

        .row.gap-after {
            margin-bottom: ${dropGapPx};
        }

        /* The actual "it'll go here" preview for a reorder (before/after
           only - see .row.drop-inside above), rendered into whichever
           gap the row above just opened - a dashed placeholder the size
           of a real row, indented to match the target's own depth.
           Absolutely positioned against the row (which has its own
           position:relative) so it overlays the margin gap without
           adding any height of its own - the margin is what actually
           reflows the list; this just fills the space it opened. */
        .drop-shadow-box {
            position: absolute;
            left: 0;
            right: 8px;
            height: 44px;
            border: 2px dashed var(--accent-color, var(--primary-color));
            border-radius: 4px;
            background: rgba(var(--rgb-accent-color, 255, 152, 0), 0.08);
            transition: left 100ms ease;
            pointer-events: none;
        }

        .drop-shadow-box.above {
            top: -48px;
        }

        .drop-shadow-box.below {
            bottom: -48px;
        }

        .content {
            flex: 1;
            min-width: 0;
            display: flex;
            flex-direction: column;
            gap: 2px;
        }

        .title-line {
            display: flex;
            align-items: baseline;
            gap: 6px;
            min-width: 0;
        }

        .summary {
            min-width: 0;
            flex-shrink: 1;
            font-family: Roboto, "Noto Sans", sans-serif;
            font-size: 14px;
            font-weight: 400;
            line-height: 21px;
            color: var(--primary-text-color);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .quantity-chip {
            flex-shrink: 0;
            font-family: Roboto, "Noto Sans", sans-serif;
            font-size: 12px;
            font-weight: 600;
            color: var(--primary-color);
            background: rgba(var(--rgb-primary-color, 3, 169, 244), 0.12);
            padding: 1px 7px;
            border-radius: 10px;
            white-space: nowrap;
        }

        .row.completed .quantity-chip {
            color: var(--secondary-text-color);
            background: rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.08);
        }

        .row.completed .summary {
            text-decoration: line-through;
            color: var(--secondary-text-color);
        }

        /* A structural row (see isStructural - real children, or
           pinned) needs to read as a section header at a glance, not
           just a heavier task - it never shows a checkbox at all (see
           checkboxHidden, which drops the checkbox slot from the
           layout entirely rather than reserving empty space for it),
           so a small uppercase, letter-spaced label carries that
           signal on its own instead - the same treatment already used
           for the Active/Completed section headers elsewhere in this
           card (see todo-overlay-list.ts's own .section-header), so a
           category reads as "the same KIND of thing" as those rather
           than an unrelated new visual language. */
        .summary.structural {
            font-size: 11.5px;
            font-weight: 700;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            color: var(--secondary-text-color);
        }

        .row.completed .summary.structural {
            text-decoration: none;
        }

        ha-checkbox {
            pointer-events: none;
            flex-shrink: 0;
        }

        /* Only ever rendered around a real, visible checkbox (see the
           template's checkboxHidden branch) - never reserved as empty
           space, so there's nothing here for a hidden-checkbox parent
           row to misalign against. Deliberately does NOT clip overflow:
           an earlier version used overflow:hidden to crop ha-checkbox's
           own larger touch-target box down to this slot's tighter
           footprint, but ha-checkbox's actual VISIBLE glyph (not just
           its invisible touch padding) is wider than that box, so it
           was cropping part of the real checkmark - left un-clipped and
           centered instead, same alignment contribution, nothing gets
           cut off. */
        .checkbox-slot {
            flex-shrink: 0;
            width: 28px;
            height: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        /* Same slot width as .checkbox-slot (see the template, which
           renders one or the other, never both) so a person row's
           title lines up with every other row's, pinned or not. */
        .person-avatar {
            flex-shrink: 0;
            width: 22px;
            height: 22px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: Roboto, "Noto Sans", sans-serif;
            font-size: 11px;
            font-weight: 700;
            color: #fff;
            background: var(--accent-color, var(--primary-color));
        }

        .collapse-toggle {
            flex-shrink: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 20px;
            height: 20px;
            margin-inline-start: -4px;
            border: none;
            background: none;
            padding: 0;
            cursor: pointer;
            color: var(--secondary-text-color);
        }

        .collapse-toggle svg {
            width: 18px;
            height: 18px;
            fill: currentColor;
            transition: transform 150ms ease;
            transform: rotate(90deg);
        }

        .collapse-toggle.collapsed svg {
            transform: rotate(0deg);
        }

        .collapse-toggle-spacer {
            flex-shrink: 0;
            width: 20px;
            margin-inline-start: -4px;
        }

        /* A pinned item with no children yet (see isStructural) gets
           this instead of the real collapse-toggle - same slot
           geometry as both that and the spacer, so nothing else in the
           row shifts depending on which of the three renders. A short
           static rule, deliberately not a button and not shaped like
           the chevron - there's nothing to collapse, and the whole
           point is to say that immediately rather than invite a click
           that would do nothing (see the live-reported feedback this
           replaced: the real chevron here read as "this has content to
           expand," which was actively misleading). */
        .structural-placeholder {
            flex-shrink: 0;
            width: 20px;
            height: 20px;
            margin-inline-start: -4px;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .structural-placeholder .dash {
            width: 8px;
            height: 2px;
            border-radius: 1px;
            background: var(--secondary-text-color);
            opacity: 0.6;
        }

        .status-chip {
            flex-shrink: 0;
            font-family: Roboto, "Noto Sans", sans-serif;
            font-size: 12px;
            font-weight: 600;
            color: var(--secondary-text-color);
            background: rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.08);
            padding: 1px 7px;
            border-radius: 10px;
            white-space: nowrap;
        }

        .status-chip.all-done {
            color: var(--success-color, #4caf50);
            background: rgba(var(--rgb-success-color, 76, 175, 80), 0.12);
        }

        /* Secondary metadata line: due date + description today, with
           room to append more chips (e.g. tags) here later without
           restructuring the row. Lives in the same content column as
           the title, so it naturally lines up under it with no manual
           indent - the checkbox centers against the whole column. */
        .row-meta {
            display: flex;
            align-items: center;
            gap: 8px;
            font-family: Roboto, "Noto Sans", sans-serif;
            font-size: 12px;
            line-height: 14px;
            color: var(--secondary-text-color);
        }

        .due-chip {
            display: flex;
            align-items: center;
            gap: 4px;
            flex-shrink: 0;
            white-space: nowrap;
        }

        .due-chip.overdue {
            color: var(--error-color);
        }

        .due-chip svg {
            width: 14px;
            height: 14px;
            fill: currentColor;
        }

        .due-chip .trigger-armed-icon {
            width: 12px;
            height: 12px;
            fill: var(--primary-color);
        }

        .due-chip.overdue .trigger-armed-icon {
            fill: currentColor;
        }

        .tag-chip {
            flex-shrink: 0;
            padding: 0 6px;
            border-radius: 8px;
            border: 1px solid var(--divider-color);
            white-space: nowrap;
        }

        .description-text {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        /* Only ever shown on a leaf row (see hasChildren in the
           template) - a group header is deleted via its own edit
           dialog, same as before, since removing a whole subtree in one
           tap is a much bigger action than removing a single item. */
        .delete-button {
            flex-shrink: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 24px;
            height: 24px;
            margin-inline-end: -4px;
            border: none;
            background: none;
            padding: 0;
            border-radius: 50%;
            cursor: pointer;
            color: var(--secondary-text-color);
            opacity: 0.5;
            transition: opacity 0.15s ease, background-color 0.15s ease, color 0.15s ease;
        }

        .row:hover .delete-button {
            opacity: 1;
        }

        .delete-button svg {
            width: 16px;
            height: 16px;
            fill: currentColor;
        }

        /* Armed by a first tap - a second tap within
           DELETE_CONFIRM_WINDOW_MS actually deletes, otherwise it quietly
           disarms itself. Red + a filled background makes that state
           change unmistakable even on a small screen, since there's no
           room in the row for a second "are you sure" button. */
        .delete-button.confirming {
            opacity: 1;
            color: var(--error-color);
            background: rgba(var(--rgb-error-color, 219, 68, 55), 0.15);
        }

        /* Fills the exact slot the delete button leaves empty for a
           parent row (see hasChildren in the template, and the delete
           button's own comment above) - same dimensions/opacity
           treatment as that button, so it reads as "the same kind of
           control" rather than a mismatched addition. Toggles to the
           cross glyph (and stays fully opaque) while this parent's own
           quick-add field is open - see .child-quick-add-row below. */
        .child-quick-add-toggle {
            flex-shrink: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 24px;
            height: 24px;
            margin-inline-end: -4px;
            border: none;
            background: none;
            padding: 0;
            border-radius: 50%;
            cursor: pointer;
            color: var(--secondary-text-color);
            opacity: 0.5;
            transition: opacity 0.15s ease, background-color 0.15s ease, color 0.15s ease;
        }

        .row:hover .child-quick-add-toggle {
            opacity: 1;
        }

        .child-quick-add-toggle.active {
            opacity: 1;
            color: var(--primary-color);
        }

        .child-quick-add-toggle svg {
            width: 16px;
            height: 16px;
            fill: currentColor;
        }

        /* Directly below the parent's own row, above its existing
           children (see the template) - indented to the SAME depth a
           real child would be (matches the child <ul>'s own
           padding-inline-start), so it's unambiguous this is adding a
           child of THIS row, not a sibling of it. Same field styling as
           the toolbar's own root-level quick-add row
           (todo-overlay-list.ts's .quick-add-row) - a different
           attachment point, not a different-looking control. */
        .child-quick-add-row {
            display: flex;
            align-items: center;
            gap: 8px;
            margin: 4px 0;
            padding-inline-start: ${rowIndentPx};
        }

        .child-quick-add-row input {
            flex: 1;
            min-width: 0;
            font-family: Roboto, "Noto Sans", sans-serif;
            font-size: 14px;
            color: var(--primary-text-color);
            background: none;
            border: none;
            border-bottom: 1px solid var(--divider-color);
            padding: 6px 0;
            outline: none;
        }

        .child-quick-add-row input:focus {
            border-bottom: 2px solid var(--primary-color);
            padding-bottom: 5px;
        }

        .child-quick-add-row button {
            flex-shrink: 0;
            border: none;
            background: none;
            font-family: Roboto, "Noto Sans", sans-serif;
            font-size: 14px;
            color: var(--primary-color);
            font-weight: 500;
            cursor: pointer;
        }

        /* Desktop-only, unconditionally - (pointer: coarse) is the
           reliable "primary input is imprecise" signal (same one
           todo-overlay-list.ts's own .reorder-toggle uses), not a
           viewport-width breakpoint. Touch relies on swipe instead of
           either of these: swipe right to add a child, swipe left to
           delete (see the swipe handling below) - removed entirely
           rather than left as a smaller/harder-to-hit tap target, which
           is what "remove the crosses from mobile entirely" asked for. */
        @media (pointer: coarse) {
            .child-quick-add-toggle,
            .delete-button {
                display: none;
            }
        }

        /* Wraps just the row itself (not its children <ul> or its own
           quick-add field below) so the swipe reveal panel's absolute
           bounds always match the row's own box exactly, regardless of
           how deep this item is nested. flow-root (rather than plain
           position:relative alone) additionally gives .row's own
           gap-before/gap-after margins a containing block that can't
           collapse them out through this wrapper - without it, the
           reorder-mode gap those classes open risks collapsing against
           this wrapper's boundary instead of staying scoped exactly the
           way it already did before this wrapper existed. */
        .row-wrapper {
            position: relative;
            display: flow-root;
        }

        /* Sits directly behind .row at the same bounds - revealed only
           in the strip .row's own translateX vacates as it slides away
           (see trackSwipe/resolveSwipe below), so no width animation or
           explicit reveal-amount styling is needed here at all, just
           correct stacking (DOM order alone puts .row on top, since
           neither element sets z-index) and a matching border-radius so
           the reveal never pokes out past the row's own rounded
           corners. */
        .swipe-action-layer {
            position: absolute;
            inset: 0;
            overflow: hidden;
            border-radius: 4px;
            display: flex;
        }

        .swipe-action {
            flex: 1;
            display: flex;
            align-items: center;
            padding: 0 18px;
            color: #fff;
            opacity: 0.55;
            transition: opacity 0.15s ease;
        }

        .swipe-action svg {
            width: 20px;
            height: 20px;
            fill: currentColor;
        }

        .swipe-action.delete {
            justify-content: flex-end;
            background: var(--error-color, #db4437);
        }

        .swipe-action.add {
            justify-content: flex-start;
            background: var(--accent-color, var(--primary-color));
        }

        /* Past the action threshold - i.e. releasing right now commits
           - full opacity and a slightly larger glyph make that "it's
           live" moment unmistakable without needing a second, separate
           confirm step of its own (see resolveSwipe). */
        .swipe-action.armed {
            opacity: 1;
        }

        .swipe-action.armed svg {
            width: 24px;
            height: 24px;
        }

        /* Adds transform to the transition list ONLY while not actively
           swiping (see trackSwipe/resolveSwipe's own swipeDragging) -
           the higher-specificity :not() selector wins over the base
           .row rule above outright rather than merging with it (a
           shorthand property can't partially override), so a live
           swipe's translateX tracks the finger with zero added lag,
           and only the release - whether committing or springing back
           to 0 - animates. */
        .row:not(.swiping) {
            transition: background-color 0.15s ease, outline-color 0.15s ease, margin 150ms ease, transform 200ms ease;
        }

        /* Shown instead of the delete button (see the template) while
           reorderModeActive, for every row regardless of hasChildren -
           dragging needs to work on parents too, unlike delete.
           touch-action: none is static here, never toggled - that's the
           whole point: a dedicated element the browser knows from the
           very first touchstart is drag-only means its gesture
           recognition never has a native-scroll option to race against
           in the first place, unlike trying to flip touch-action on the
           row mid-gesture once a hold is judged "ready" (tried first,
           doesn't reliably work - see the class docstring above). */
        .drag-handle {
            touch-action: none;
            flex-shrink: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 24px;
            height: 24px;
            margin-inline-end: -4px;
            border: none;
            background: none;
            padding: 0;
            border-radius: 50%;
            cursor: grab;
            color: var(--secondary-text-color);
        }

        .drag-handle svg {
            width: 18px;
            height: 18px;
            fill: currentColor;
        }

        .hold-ripple {
            position: absolute;
            width: ${holdRippleSizePx};
            height: ${holdRippleSizePx};
            margin-left: calc(${holdRippleSizePx} / -2);
            margin-top: calc(${holdRippleSizePx} / -2);
            border-radius: 50%;
            background: var(--primary-color);
            opacity: 0.2;
            pointer-events: none;
            transform: scale(0);
            transition: transform 180ms ease-in-out;
        }

        .hold-ripple.active {
            transform: scale(1);
        }
    `;
__decorateClass([
  n4({ attribute: false })
], TodoTreeItem.prototype, "item", 2);
__decorateClass([
  n4({ attribute: false })
], TodoTreeItem.prototype, "draggedId", 2);
__decorateClass([
  n4({ attribute: false })
], TodoTreeItem.prototype, "hoverId", 2);
__decorateClass([
  n4({ attribute: false })
], TodoTreeItem.prototype, "hoverPlacement", 2);
__decorateClass([
  n4({ attribute: false })
], TodoTreeItem.prototype, "hoverDepth", 2);
__decorateClass([
  n4({ attribute: false })
], TodoTreeItem.prototype, "hideCompleteForParents", 2);
__decorateClass([
  n4({ attribute: false })
], TodoTreeItem.prototype, "showCheckboxes", 2);
__decorateClass([
  n4({ attribute: false })
], TodoTreeItem.prototype, "confirmDelete", 2);
__decorateClass([
  n4({ attribute: false })
], TodoTreeItem.prototype, "dragDisabled", 2);
__decorateClass([
  n4({ attribute: false })
], TodoTreeItem.prototype, "collapsedIds", 2);
__decorateClass([
  n4({ attribute: false })
], TodoTreeItem.prototype, "dimmedByAncestorDrag", 2);
__decorateClass([
  n4({ attribute: false })
], TodoTreeItem.prototype, "reorderModeActive", 2);
__decorateClass([
  n4({ attribute: false })
], TodoTreeItem.prototype, "childQuickAddParentIds", 2);
__decorateClass([
  n4({ attribute: false })
], TodoTreeItem.prototype, "addModeActive", 2);
__decorateClass([
  n4({ attribute: false })
], TodoTreeItem.prototype, "deleteModeActive", 2);
__decorateClass([
  r5()
], TodoTreeItem.prototype, "holdRippleOrigin", 2);
__decorateClass([
  r5()
], TodoTreeItem.prototype, "dragEngaged", 2);
__decorateClass([
  r5()
], TodoTreeItem.prototype, "confirmingDelete", 2);
__decorateClass([
  r5()
], TodoTreeItem.prototype, "swipeOffsetX", 2);
__decorateClass([
  r5()
], TodoTreeItem.prototype, "swipeDragging", 2);
__decorateClass([
  r5()
], TodoTreeItem.prototype, "childQuickAddValue", 2);
TodoTreeItem = __decorateClass([
  t3("todo-overlay-tree-item")
], TodoTreeItem);

// src/components/todo-tree.ts
var TodoTree = class extends i4 {
  constructor() {
    super(...arguments);
    this.items = [];
    this.hoverDepth = 0;
    this.emptyDropHighlight = false;
    this.hideCompleteForParents = false;
    this.showCheckboxes = false;
    this.confirmDelete = true;
    this.dragDisabled = false;
    this.collapsedIds = /* @__PURE__ */ new Set();
    this.reorderModeActive = false;
    this.childQuickAddParentIds = /* @__PURE__ */ new Set();
    this.addModeActive = false;
    this.deleteModeActive = false;
  }
  render() {
    const displayItems = groupSiblingsForDisplay(this.items, void 0);
    return b2`
            <ul>
                ${this.items.length === 0 ? b2`
                            <li>
                                <div
                                    class=${e6({ "empty-drop-zone": true, "drop-target": this.emptyDropHighlight })}
                                    data-empty-drop-zone
                                >
                                    ${this.emptyDropHighlight ? "Drop here" : "No items"}
                                </div>
                            </li>
                        ` : displayItems.map(
      (item) => b2`
                                <todo-overlay-tree-item
                                    .item=${item}
                                    .draggedId=${this.draggedId}
                                    .hoverId=${this.hoverId}
                                    .hoverPlacement=${this.hoverPlacement}
                                    .hoverDepth=${this.hoverDepth}
                                    .hideCompleteForParents=${this.hideCompleteForParents}
                                    .showCheckboxes=${this.showCheckboxes}
                                    .confirmDelete=${this.confirmDelete}
                                    .dragDisabled=${this.dragDisabled}
                                    .collapsedIds=${this.collapsedIds}
                                    .reorderModeActive=${this.reorderModeActive}
                                    .childQuickAddParentIds=${this.childQuickAddParentIds}
                                    .addModeActive=${this.addModeActive}
                                    .deleteModeActive=${this.deleteModeActive}
                                ></todo-overlay-tree-item>
                            `
    )}
            </ul>
        `;
  }
};
TodoTree.styles = i`
        ul {
            list-style: none;
            margin: 0;
            padding: 0;
        }

        /* Rendered instead of the item list when there's nothing in it -
           an empty <ul> has zero height, so without this there'd be
           nothing to see AND nothing for a drag-and-drop to hit-test
           against (see todo-overlay-list.ts's collectAllRows, which
           looks for this element specifically by its data attribute) -
           dragging an item into a list with nothing in it yet would
           have no possible drop target at all otherwise. */
        .empty-drop-zone {
            margin: 4px 8px;
            padding: 16px 12px;
            border: 1px dashed var(--divider-color);
            border-radius: 4px;
            outline: 2px solid transparent;
            outline-offset: -2px;
            text-align: center;
            font-family: Roboto, "Noto Sans", sans-serif;
            font-size: 13px;
            color: var(--secondary-text-color);
            transition: outline-color 0.15s ease, background-color 0.15s ease;
        }

        .empty-drop-zone.drop-target {
            outline-color: var(--accent-color, var(--primary-color));
            background: rgba(var(--rgb-accent-color, 255, 152, 0), 0.08);
            color: var(--primary-text-color);
        }
    `;
__decorateClass([
  n4({ attribute: false })
], TodoTree.prototype, "items", 2);
__decorateClass([
  n4({ attribute: false })
], TodoTree.prototype, "draggedId", 2);
__decorateClass([
  n4({ attribute: false })
], TodoTree.prototype, "hoverId", 2);
__decorateClass([
  n4({ attribute: false })
], TodoTree.prototype, "hoverPlacement", 2);
__decorateClass([
  n4({ attribute: false })
], TodoTree.prototype, "hoverDepth", 2);
__decorateClass([
  n4({ attribute: false })
], TodoTree.prototype, "emptyDropHighlight", 2);
__decorateClass([
  n4({ attribute: false })
], TodoTree.prototype, "hideCompleteForParents", 2);
__decorateClass([
  n4({ attribute: false })
], TodoTree.prototype, "showCheckboxes", 2);
__decorateClass([
  n4({ attribute: false })
], TodoTree.prototype, "confirmDelete", 2);
__decorateClass([
  n4({ attribute: false })
], TodoTree.prototype, "dragDisabled", 2);
__decorateClass([
  n4({ attribute: false })
], TodoTree.prototype, "collapsedIds", 2);
__decorateClass([
  n4({ attribute: false })
], TodoTree.prototype, "reorderModeActive", 2);
__decorateClass([
  n4({ attribute: false })
], TodoTree.prototype, "childQuickAddParentIds", 2);
__decorateClass([
  n4({ attribute: false })
], TodoTree.prototype, "addModeActive", 2);
__decorateClass([
  n4({ attribute: false })
], TodoTree.prototype, "deleteModeActive", 2);
TodoTree = __decorateClass([
  t3("todo-overlay-tree")
], TodoTree);

// src/components/todo-confirm-dialog.ts
var TodoConfirmDialog = class extends i4 {
  constructor() {
    super(...arguments);
    this.heading = "Are you sure?";
    this.message = "";
    this.confirmLabel = "Confirm";
  }
  close() {
    this.dispatchEvent(
      new CustomEvent("dialog-close", { bubbles: true, composed: true })
    );
  }
  confirm() {
    this.dispatchEvent(
      new CustomEvent("dialog-confirm", { bubbles: true, composed: true })
    );
  }
  render() {
    return b2`
            <ha-dialog open .heading=${this.heading} @closed=${this.close}>
                <p>${this.message}</p>
                <div class="actions" slot="footer">
                    <button @click=${this.close}>Cancel</button>
                    <button class="destructive" @click=${this.confirm}>${this.confirmLabel}</button>
                </div>
            </ha-dialog>
        `;
  }
};
TodoConfirmDialog.styles = i`
        /* A short yes/no message doesn't need (and looks strange in) the
           same wide dialog the multi-field item/save-load dialogs need -
           left unconstrained, ha-dialog's default sizing reads as
           oddly large and empty for one line of text. Only bounded on
           the desktop side (min/max-width); mobile still gets the same
           edge-to-edge behavior every other dialog in this card already
           has at narrow viewports, via ha-dialog's own responsive
           default. */
        ha-dialog {
            --mdc-dialog-min-width: 280px;
            --mdc-dialog-max-width: 420px;
        }

        p {
            font-family: Roboto, "Noto Sans", sans-serif;
            font-size: 14px;
            color: var(--primary-text-color);
            margin: 0;
        }

        .actions {
            display: flex;
            align-items: center;
            justify-content: flex-end;
            width: 100%;
            gap: 8px;
        }

        button {
            font-family: Roboto, "Noto Sans", sans-serif;
            font-size: 14px;
            font-weight: 500;
            text-transform: uppercase;
            border: none;
            background: none;
            cursor: pointer;
            padding: 8px 12px;
            border-radius: 4px;
            color: var(--primary-color);
        }

        button.destructive {
            color: var(--error-color);
        }
    `;
__decorateClass([
  n4({ attribute: false })
], TodoConfirmDialog.prototype, "heading", 2);
__decorateClass([
  n4({ attribute: false })
], TodoConfirmDialog.prototype, "message", 2);
__decorateClass([
  n4({ attribute: false })
], TodoConfirmDialog.prototype, "confirmLabel", 2);
TodoConfirmDialog = __decorateClass([
  t3("todo-overlay-confirm-dialog")
], TodoConfirmDialog);

// src/components/todo-overlay-list.ts
var PLUS_ICON2 = b2`
    <svg viewBox="0 0 24 24"><path d="M19 13H13V19H11V13H5V11H11V5H13V11H19V13Z"></path></svg>
`;
var LINK_ICON = b2`
    <svg viewBox="0 0 24 24">
        <path d="M3.9,12C3.9,10.29 5.29,8.9 7,8.9H11V7H7A5,5 0 0,0 2,12A5,5 0 0,0 7,17H11V15.1H7C5.29,15.1 3.9,13.71 3.9,12M8,13H16V11H8V13M17,7H13V8.9H17C18.71,8.9 20.1,10.29 20.1,12C20.1,13.71 18.71,15.1 17,15.1H13V17H17A5,5 0 0,0 22,12A5,5 0 0,0 17,7Z"></path>
    </svg>
`;
var FILTER_ICON = b2`
    <svg viewBox="0 0 24 24">
        <path d="M14,12V19.88C14.04,20.18 13.94,20.5 13.71,20.71C13.32,21.1 12.69,21.1 12.3,20.71L10.29,18.7C10.06,18.47 9.96,18.16 10,17.87V12H9.97L4.21,4.62C3.87,4.19 3.95,3.56 4.38,3.22C4.57,3.08 4.78,3 5,3V3H19V3C19.22,3 19.43,3.08 19.62,3.22C20.05,3.56 20.13,4.19 19.79,4.62L14.03,12H14Z"></path>
    </svg>
`;
var SAVE_ICON = b2`
    <svg viewBox="0 0 24 24">
        <path d="M17,3H5C3.89,3 3,3.9 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V7L17,3M19,19H5V5H16.17L19,7.83V19M12,12A3,3 0 0,0 9,15A3,3 0 0,0 12,18A3,3 0 0,0 15,15A3,3 0 0,0 12,12M6,6H15V10H6V6Z"></path>
    </svg>
`;
var LOAD_ICON = b2`
    <svg viewBox="0 0 24 24">
        <path d="M20,18H4V8H20M20,6H12L10,4H4C2.89,4 2,4.89 2,6V18A2,2 0 0,0 4,20H20A2,2 0 0,0 22,18V8C22,6.89 21.1,6 20,6Z"></path>
    </svg>
`;
var CLEAR_COMPLETED_ICON = b2`
    <svg viewBox="0 0 24 24">
        <path d="M9,3V4H4V6H5V19A2,2 0 0,0 7,21H17A2,2 0 0,0 19,19V6H20V4H15V3H9M7,6H17V19H7V6M9,8V17H11V8H9M13,8V17H15V8H13Z"></path>
    </svg>
`;
var CLOSE_ICON = b2`
    <svg viewBox="0 0 24 24">
        <path d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"></path>
    </svg>
`;
var REORDER_TOGGLE_ICON = b2`
    <svg viewBox="0 0 24 24">
        <path d="M9,3L5,6.99H8V14H10V6.99H13M16,17.01V10H14V17.01H11L15,21L19,17.01H16Z"></path>
    </svg>
`;
var ITEM_CHANGED_EVENT = "todo_overlay_item_event";
var HOVER_DEAD_ZONE_PX = 12;
var DRAG_GHOST_LABEL_GAP_PX = 8;
var DRAG_GHOST_FALLBACK_HEIGHT_PX = 40;
var DRAG_GHOST_SHRINK_WIDTH_PX = 44;
var TOUCH_DRAG_MAX_GRAB_OFFSET_X_PX = 32;
var GHOST_VIEWPORT_MARGIN_PX = 8;
var DRAG_GHOST_LABEL_FALLBACK_HEIGHT_PX = 36;
var DRAG_GHOST_FALLBACK_WIDTH_PX = 200;
function collectAllRows(root, currentEntity, currentDepth = 0) {
  const rows = [];
  for (const el of Array.from(root.querySelectorAll("*"))) {
    const itemEl = el;
    const isTreeItem = el.localName === "todo-overlay-tree-item" && Boolean(itemEl.item);
    if (isTreeItem && currentEntity) {
      const rowEl = itemEl.shadowRoot?.querySelector(".row");
      if (rowEl && !rowEl.hasAttribute("data-synthetic")) {
        const hasVisibleChildren = itemEl.shadowRoot?.querySelector("ul") != null;
        rows.push({
          id: itemEl.item.id,
          entityId: currentEntity,
          children: hasVisibleChildren ? itemEl.item.children : [],
          rect: rowEl.getBoundingClientRect(),
          depth: currentDepth
        });
      }
    }
    if (el.localName === "todo-overlay-tree" && currentEntity) {
      const emptyZone = el.shadowRoot?.querySelector("[data-empty-drop-zone]");
      if (emptyZone) {
        rows.push({
          id: void 0,
          entityId: currentEntity,
          children: [],
          rect: emptyZone.getBoundingClientRect(),
          depth: 0
        });
      }
    }
    if (el.shadowRoot) {
      const isList = el.localName === "todo-overlay-list";
      const nextEntity = isList ? el.entity : currentEntity;
      const nextDepth = isList ? 0 : isTreeItem ? currentDepth + 1 : currentDepth;
      rows.push(...collectAllRows(el.shadowRoot, nextEntity, nextDepth));
    }
  }
  return rows;
}
var ZONE_HYSTERESIS = 0.05;
function resolvePlacement(rowId, rowChildren, relativeY, sticky) {
  if (rowChildren.length > 0) {
    if (relativeY < BEFORE_AFTER_ZONE) {
      return { id: rowId, placement: "before" };
    }
    return { id: rowChildren[0].id, placement: "before" };
  }
  const beforeBoundary = sticky?.id === rowId && sticky.placement === "before" ? BEFORE_AFTER_ZONE + ZONE_HYSTERESIS : BEFORE_AFTER_ZONE - ZONE_HYSTERESIS;
  const afterBoundary = sticky?.id === rowId && sticky.placement === "after" ? 1 - BEFORE_AFTER_ZONE - ZONE_HYSTERESIS : 1 - BEFORE_AFTER_ZONE + ZONE_HYSTERESIS;
  if (relativeY < beforeBoundary) {
    return { id: rowId, placement: "before" };
  }
  if (relativeY > afterBoundary) {
    return { id: rowId, placement: "after" };
  }
  return { id: rowId, placement: "inside" };
}
function shiftRectDown(rect, amount) {
  return {
    top: rect.top + amount,
    bottom: rect.bottom + amount,
    left: rect.left,
    right: rect.right,
    width: rect.width,
    height: rect.height,
    x: rect.x,
    y: rect.y + amount,
    toJSON: rect.toJSON
  };
}
function applyGapCorrection(rows, sticky) {
  if (!sticky || sticky.placement === "inside") {
    return rows;
  }
  const sortedByTop = [...rows].sort((a3, b3) => a3.rect.top - b3.rect.top);
  const targetIndex = sortedByTop.findIndex((r6) => r6.id === sticky.id);
  if (targetIndex === -1) {
    return rows;
  }
  const shiftFromIndex = sticky.placement === "before" ? targetIndex : targetIndex + 1;
  const shiftedIds = new Set(sortedByTop.slice(shiftFromIndex).map((r6) => r6.id));
  if (shiftedIds.size === 0) {
    return rows;
  }
  return rows.map((row) => shiftedIds.has(row.id) ? { ...row, rect: shiftRectDown(row.rect, DROP_GAP_PX) } : row);
}
var ROW_SWITCH_HYSTERESIS_PX = 24;
function findDropTarget(y3, rows, sticky, stickyNearestRowId) {
  if (rows.length === 0) {
    return void 0;
  }
  let nearestRaw = rows[0];
  let nearestRawDistance = Infinity;
  let nearestWithHysteresis = rows[0];
  let nearestWithHysteresisDistance = Infinity;
  for (const row of rows) {
    const distance = y3 < row.rect.top ? row.rect.top - y3 : y3 > row.rect.bottom ? y3 - row.rect.bottom : 0;
    if (distance < nearestRawDistance) {
      nearestRaw = row;
      nearestRawDistance = distance;
    }
    const hysteresisDistance = stickyNearestRowId !== void 0 && row.id === stickyNearestRowId ? Math.max(0, distance - ROW_SWITCH_HYSTERESIS_PX) : distance;
    if (hysteresisDistance < nearestWithHysteresisDistance) {
      nearestWithHysteresis = row;
      nearestWithHysteresisDistance = hysteresisDistance;
    }
  }
  const nearest = nearestRawDistance === 0 ? nearestRaw : nearestWithHysteresis;
  if (nearest.id === void 0) {
    return { id: void 0, entityId: nearest.entityId, placement: "inside", depth: 0, nearestRowId: void 0 };
  }
  const relativeY = (y3 - nearest.rect.top) / nearest.rect.height;
  const resolved = {
    ...resolvePlacement(nearest.id, nearest.children, relativeY, sticky),
    entityId: nearest.entityId
  };
  const resolvedRow = rows.find((r6) => r6.id === resolved.id) ?? nearest;
  const depth = resolvedRow.depth + (resolved.placement === "inside" ? 1 : 0);
  return { ...resolved, depth, nearestRowId: nearest.id };
}
function findItem(items, id) {
  for (const item of items) {
    if (item.id === id) {
      return item;
    }
    const found = findItem(item.children, id);
    if (found) {
      return found;
    }
  }
  return void 0;
}
function flattenForTargetPicker(items, depth = 0) {
  const options = [];
  for (const item of items) {
    const prefix = depth > 0 ? `${"  ".repeat(depth)}\u2014 ` : "";
    options.push({ id: item.id, label: `${prefix}${item.title}` });
    options.push(...flattenForTargetPicker(item.children, depth + 1));
  }
  return options;
}
function collectDescendantIds(item, into = /* @__PURE__ */ new Set()) {
  for (const child of item.children) {
    into.add(child.id);
    collectDescendantIds(child, into);
  }
  return into;
}
function splitDueDateTime(iso) {
  if (!iso) {
    return { date: "", time: "" };
  }
  const [date, time] = iso.split("T");
  return { date: date ?? "", time: (time ?? "").slice(0, 5) };
}
var UNDO_TIMEOUT_MS = 8e3;
var ERROR_TIMEOUT_MS = 8e3;
var FILTER_MODES = ["all", "active", "completed", "overdue"];
var FILTER_LABELS = {
  all: "All",
  active: "Active",
  completed: "Completed",
  overdue: "Overdue"
};
var TodoOverlayList = class extends i4 {
  constructor() {
    super(...arguments);
    this.hideCompleteForParents = false;
    this.showCheckboxes = false;
    this.sortBy = "manual";
    this.sortOrder = "asc";
    this.showClearButton = true;
    this.showSaveLoadButtons = true;
    this.showQuickAdd = true;
    this.confirmDelete = true;
    this.showFilterMenu = false;
    this.showReorderToggle = true;
    this.moveCompletedItems = false;
    this.dragGhostStyle = "label";
    this.collapsedIds = /* @__PURE__ */ new Set();
    this.filterMode = "all";
    this.addModeActive = false;
    this.childQuickAddParentIds = /* @__PURE__ */ new Set();
    this.deleteModeActive = false;
    this.reorderModeActive = false;
    this.onToggleReorderMode = () => {
      if (this.reorderModeActive) {
        this.reorderModeActive = false;
        return;
      }
      this.addModeActive = false;
      this.deleteModeActive = false;
      if (this.childQuickAddParentIds.size > 0) {
        this.childQuickAddParentIds = /* @__PURE__ */ new Set();
      }
      this.reorderModeActive = true;
    };
    this.hoverDepth = 0;
    this.foreignDragActive = false;
    this.onForeignDragHover = (e7) => {
      const wasEmptyTarget = this.isEmptyDropTarget;
      this.foreignDragActive = e7.detail.draggedId !== void 0;
      this.foreignDragHoverEntityId = e7.detail.hoverEntityId;
      this.foreignDragHoverId = e7.detail.hoverId;
      if (wasEmptyTarget !== this.isEmptyDropTarget) {
        this.requestUpdate();
      }
    };
    this.dragGhostOffset = { x: 0, y: 0 };
    this.rowSnapshot = [];
    this.dragStartPointerPos = { x: 0, y: 0 };
    this.dialogFormValue = EMPTY_FORM_VALUE;
    this.quickAddValue = "";
    this.saveLoadValue = EMPTY_SAVE_LOAD_VALUE;
    this.savedNames = [];
    this.targetOptions = [];
    this.confirmingClearAll = false;
    this.itemChangedSubscribeStarted = false;
    this.onGlobalPointerMove = (e7) => {
      if (e7.pointerType !== "mouse") {
        e7.preventDefault();
      }
      this.ghostPosition = {
        x: this.reorderModeActive ? this.dragStartPointerPos.x : e7.clientX,
        y: e7.clientY
      };
      const distanceFromStart = Math.hypot(
        e7.clientX - this.dragStartPointerPos.x,
        e7.clientY - this.dragStartPointerPos.y
      );
      if (distanceFromStart < HOVER_DEAD_ZONE_PX) {
        return;
      }
      const sticky = this.hoverId !== void 0 && this.hoverPlacement !== void 0 ? { id: this.hoverId, placement: this.hoverPlacement } : void 0;
      const hit = findDropTarget(
        e7.clientY,
        applyGapCorrection(this.rowSnapshot, sticky),
        sticky,
        this.hoverNearestRowId
      );
      const valid = hit && hit.id !== this.draggedId;
      const previousHoverId = this.hoverId;
      const previousHoverPlacement = this.hoverPlacement;
      this.hoverNearestRowId = hit?.nearestRowId;
      this.hoverId = valid ? hit.id : void 0;
      this.hoverPlacement = valid ? hit.placement : void 0;
      this.hoverDepth = valid ? hit.depth : 0;
      this.hoverEntityId = valid ? hit.entityId : void 0;
      const targetChanged = this.hoverId !== previousHoverId || this.hoverPlacement !== previousHoverPlacement;
      if (e7.pointerType !== "mouse" && targetChanged) {
        navigator.vibrate?.(10);
      }
      this.broadcastDragHover();
    };
    this.onGlobalPointerUp = async () => {
      window.removeEventListener("pointermove", this.onGlobalPointerMove, { capture: true });
      window.removeEventListener("pointerup", this.onGlobalPointerUp, { capture: true });
      window.removeEventListener("pointercancel", this.onGlobalPointerUp, { capture: true });
      const draggedId = this.draggedId;
      const hoverId = this.hoverId;
      const hoverPlacement = this.hoverPlacement;
      const hoverEntityId = this.hoverEntityId;
      this.ghostPosition = void 0;
      this.draggedId = void 0;
      this.hoverId = void 0;
      this.hoverPlacement = void 0;
      this.hoverDepth = 0;
      this.hoverEntityId = void 0;
      this.hoverNearestRowId = void 0;
      this.rowSnapshot = [];
      this.broadcastDragHover();
      if (draggedId && hoverEntityId) {
        try {
          if (hoverEntityId !== this.entity) {
            await transferItem(
              this.hass,
              this.entity,
              draggedId,
              hoverEntityId,
              hoverId,
              hoverPlacement ?? "inside"
            );
          } else if (hoverId && hoverId !== draggedId) {
            await moveItem(
              this.hass,
              this.entity,
              draggedId,
              hoverId,
              hoverPlacement ?? "inside"
            );
          } else {
            return;
          }
          await this.load();
        } catch (err) {
          this.reportError("moving the item", err);
        }
      }
    };
    // HOLDING the clear-completed button (past LONG_PRESS_MS, same
    // threshold a row's own hold-to-edit uses) and then releasing offers
    // the much more destructive "delete literally everything" instead -
    // gated behind both the hold itself and the confirm dialog below,
    // since there's no undo for this one (see clear_all's own docstring
    // - same no-undo precedent as clear_completed already has).
    //
    // clearButtonPressedAt/clearButtonHoldTimer are deliberately plain
    // fields, not @state - mirrors todo-tree-item.ts's own row hold
    // gesture exactly (pointerDownAt/holdTimer there), including the
    // same "schedule a requestUpdate() for the moment the threshold is
    // crossed" trick, since holdReady below is a plain getter computed
    // from Date.now() rather than something Lit can track reactively on
    // its own.
    this.clearButtonPressedAt = 0;
    this.onClearButtonPointerDown = () => {
      this.clearButtonPressedAt = Date.now();
      this.requestUpdate();
      window.clearTimeout(this.clearButtonHoldTimer);
      this.clearButtonHoldTimer = window.setTimeout(() => {
        this.requestUpdate();
      }, LONG_PRESS_MS);
    };
    this.onClearButtonPointerUp = () => {
      if (this.clearButtonPressedAt === 0) {
        return;
      }
      const pressDurationMs = Date.now() - this.clearButtonPressedAt;
      this.clearButtonPressedAt = 0;
      window.clearTimeout(this.clearButtonHoldTimer);
      this.requestUpdate();
      if (pressDurationMs >= LONG_PRESS_MS) {
        this.confirmingClearAll = true;
      } else {
        this.onClearButtonTap();
      }
    };
    this.onClearButtonPointerCancel = () => {
      this.clearButtonPressedAt = 0;
      window.clearTimeout(this.clearButtonHoldTimer);
      this.requestUpdate();
    };
    this.closeClearAllConfirm = () => {
      this.confirmingClearAll = false;
    };
  }
  // add-mode, delete-mode, and reorder-mode all want the same per-row
  // trailing-icon slot (see todo-tree-item.ts's rowClasses) - only one
  // can sensibly occupy it at a time, so turning any one of them on
  // turns the other two off. Each enter* method is the single place
  // that transition happens, including whatever cleanup turning a mode
  // OFF needs (childQuickAddParentIds for add-mode; nothing extra for
  // the other two, which have no per-row draft state of their own).
  enterAddMode() {
    this.deleteModeActive = false;
    this.reorderModeActive = false;
    this.addModeActive = true;
  }
  exitAddMode() {
    this.addModeActive = false;
    if (this.childQuickAddParentIds.size > 0) {
      this.childQuickAddParentIds = /* @__PURE__ */ new Set();
    }
  }
  enterDeleteMode() {
    this.addModeActive = false;
    this.reorderModeActive = false;
    this.deleteModeActive = true;
    if (this.childQuickAddParentIds.size > 0) {
      this.childQuickAddParentIds = /* @__PURE__ */ new Set();
    }
  }
  // Native hass.states-based reloading (below) only fires for changes
  // that touch the native entity itself - a same-list reorder is purely
  // overlay metadata and never does (see manager_position.py's
  // move_item, which fires this event for exactly that reason). Without
  // this, another open card (a different browser/device/tab) has no
  // way to know a reorder - or a tag/quantity change, which also don't
  // reliably touch native state - happened at all. Subscribed once,
  // the first time hass becomes available - the callback re-reads
  // this.entity fresh on every event rather than closing over it, so a
  // live card-editor repoint to a different entity doesn't need a
  // fresh subscription.
  async subscribeToItemChanged() {
    this.unsubItemChanged = await this.hass.connection.subscribeEvents(
      (event) => {
        if (event.data.entity_id === this.entity) {
          this.load();
        }
      },
      ITEM_CHANGED_EVENT
    );
  }
  updated(changed) {
    if (changed.has("entity") && this.entity) {
      this.collapsedIds = loadCollapsedIds(this.entity);
    }
    if (this.hass && !this.itemChangedSubscribeStarted) {
      this.itemChangedSubscribeStarted = true;
      this.subscribeToItemChanged();
    }
    if (!changed.has("hass") || !this.hass || !this.entity) {
      return;
    }
    const entityUpdate = this.hass.states[this.entity]?.last_updated;
    const entityChanged = entityUpdate !== void 0 && entityUpdate !== this.lastEntityUpdate;
    this.lastEntityUpdate = entityUpdate;
    if (!this.list && !this.error) {
      this.load();
    } else if (entityChanged) {
      this.load();
    }
  }
  // A raw backend exception (a Python traceback line, an "already
  // exists" ValueError, etc.) is meaningless to whoever's actually
  // using this card - it's logged in full for whoever's debugging,
  // and everyone else just sees one plain, consistent message.
  //
  // This never hides an already-loaded list (see render()): a failed
  // drag, tap, or edit is just one action not going through, not a
  // reason to make every item the user can already see vanish until
  // they refresh the page. The banner auto-dismisses the same way the
  // undo snackbar does, rather than sitting there forever.
  reportError(action, err) {
    console.error(`todo-overlay-card: ${action} failed`, err);
    window.clearTimeout(this.errorTimer);
    this.error = "Something went wrong. Check the browser console for details.";
    this.errorTimer = window.setTimeout(() => {
      this.error = void 0;
    }, ERROR_TIMEOUT_MS);
  }
  dismissError() {
    window.clearTimeout(this.errorTimer);
    this.error = void 0;
  }
  async load() {
    try {
      this.list = await getList(
        this.hass,
        this.entity,
        this.moveCompletedItems
      );
      window.clearTimeout(this.errorTimer);
      this.error = void 0;
    } catch (err) {
      this.reportError("loading the list", err);
    }
  }
  get fieldSupport() {
    const supportedFeatures = this.hass.states[this.entity]?.attributes.supported_features;
    return {
      description: supportsFeature(supportedFeatures, TodoListEntityFeature.SET_DESCRIPTION_ON_ITEM),
      dueDate: supportsFeature(supportedFeatures, TodoListEntityFeature.SET_DUE_DATE_ON_ITEM),
      dueDateTime: supportsFeature(supportedFeatures, TodoListEntityFeature.SET_DUE_DATETIME_ON_ITEM)
    };
  }
  get dragDisabled() {
    return this.sortBy !== "manual";
  }
  // True while a drag - from this instance or (far more commonly,
  // since an entity being dragged FROM can't also be empty) another
  // one entirely - is hovering this list's own empty-state placeholder
  // (see todo-tree.ts) as its drop target. Driven by the
  // foreignDragActive broadcast (see its own doc comment) rather than
  // this instance's own draggedId/hoverEntityId/hoverId, which are
  // only ever populated on whichever instance the drag actually
  // started from.
  get isEmptyDropTarget() {
    return this.foreignDragActive && this.foreignDragHoverEntityId === this.entity && this.foreignDragHoverId === void 0;
  }
  // --- drag / tap / hold ---------------------------------------------
  //
  // A drag only ever reaches the "live" ghost-follow stage below once
  // the item's own hold threshold has been reached AND the pointer
  // then moves (see todo-tree-item.ts) - so a quick swipe on mobile
  // still scrolls the page normally, and only a sustained hold-then-
  // move actually picks an item up. Once that happens, this component
  // takes over entirely via window-level listeners and its own
  // hit-testing (findDropTarget against a frozen row snapshot, see
  // its own comment for why it's frozen), rather than relying on the
  // dragged item's own bubbled events for hover detection.
  onPointerDown(e7) {
    this.draggedId = e7.detail.id;
  }
  snapshotRows() {
    const excluded = /* @__PURE__ */ new Set();
    if (this.draggedId) {
      excluded.add(this.draggedId);
      const dragged = this.list && findItem(this.list.items, this.draggedId);
      if (dragged) {
        collectDescendantIds(dragged, excluded);
      }
    }
    this.rowSnapshot = collectAllRows(document).filter((row) => row.id === void 0 || !excluded.has(row.id)).map((row) => excluded.size > 0 && row.children.some((child) => excluded.has(child.id)) ? { ...row, children: row.children.filter((child) => !excluded.has(child.id)) } : row);
  }
  onDragStart(e7) {
    const { rect, pointerX, pointerY, grabOffsetX, grabOffsetY, pointerType } = e7.detail;
    const cappedGrabOffsetX = pointerType !== "mouse" ? Math.min(grabOffsetX ?? 0, TOUCH_DRAG_MAX_GRAB_OFFSET_X_PX) : grabOffsetX ?? 0;
    this.dragGhostOffset = { x: cappedGrabOffsetX, y: grabOffsetY ?? 0 };
    this.dragGhostSize = rect ? { width: rect.width, height: rect.height } : void 0;
    this.ghostPosition = { x: pointerX, y: pointerY };
    this.dragStartPointerPos = { x: pointerX, y: pointerY };
    this.snapshotRows();
    requestAnimationFrame(() => this.snapshotRows());
    window.addEventListener("pointermove", this.onGlobalPointerMove, { capture: true });
    window.addEventListener("pointerup", this.onGlobalPointerUp, { capture: true });
    window.addEventListener("pointercancel", this.onGlobalPointerUp, { capture: true });
  }
  // Lets every OTHER todo-overlay-list on the page (any other section
  // of a multi-entity card, or a separate card entirely) know this
  // instance's current drag/hover state - see foreignDragActive's own
  // doc comment for why that's needed at all.
  broadcastDragHover() {
    window.dispatchEvent(new CustomEvent("todo-overlay-drag-hover", {
      detail: {
        draggedId: this.draggedId,
        hoverEntityId: this.hoverEntityId,
        hoverId: this.hoverId
      }
    }));
  }
  async onPointerUp(e7) {
    if (!e7.detail.moved && this.draggedId && this.list) {
      const item = findItem(this.list.items, this.draggedId);
      if (item) {
        const pressDurationMs = e7.detail.pressDurationMs;
        const checkboxHidden = this.hideCompleteForParents && item.children.length > 0;
        if (pressDurationMs < LONG_PRESS_MS) {
          if (checkboxHidden) {
            this.toggleCollapseId(item.id);
          } else {
            await this.toggleComplete(item);
          }
        } else {
          this.openEditDialog(item);
        }
      }
    }
    this.draggedId = void 0;
  }
  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("todo-overlay-drag-hover", this.onForeignDragHover);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("pointermove", this.onGlobalPointerMove, { capture: true });
    window.removeEventListener("pointerup", this.onGlobalPointerUp, { capture: true });
    window.removeEventListener("pointercancel", this.onGlobalPointerUp, { capture: true });
    window.removeEventListener("todo-overlay-drag-hover", this.onForeignDragHover);
    window.clearTimeout(this.undoTimer);
    window.clearTimeout(this.errorTimer);
    this.unsubItemChanged?.();
  }
  // --- collapse / filter -------------------------------------------------
  toggleCollapseId(id) {
    const next = new Set(this.collapsedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    this.collapsedIds = next;
    saveCollapsedIds(this.entity, next);
  }
  onToggleCollapse(e7) {
    this.toggleCollapseId(e7.detail.id);
  }
  onFilterSelectChange(e7) {
    this.filterMode = e7.target.value;
  }
  onToggleQuickAdd() {
    if (!this.showQuickAdd) {
      this.openCreateDialog();
      return;
    }
    if (this.addModeActive) {
      this.exitAddMode();
    } else {
      this.enterAddMode();
    }
  }
  // --- completion + cascade undo --------------------------------------
  async toggleComplete(item) {
    try {
      const changes = await setCompleted(
        this.hass,
        this.entity,
        item.id,
        !item.completed,
        this.moveCompletedItems
      );
      await this.load();
      if (changes.length > 1) {
        this.showUndo(
          `Marked ${changes.length} items ${!item.completed ? "complete" : "incomplete"}`,
          changes
        );
      }
    } catch (err) {
      this.reportError("updating completion", err);
    }
  }
  showUndo(message, changes) {
    window.clearTimeout(this.undoTimer);
    this.undoState = { message, changes };
    this.undoTimer = window.setTimeout(() => {
      this.undoState = void 0;
    }, UNDO_TIMEOUT_MS);
  }
  async onUndo() {
    if (!this.undoState) {
      return;
    }
    window.clearTimeout(this.undoTimer);
    try {
      await restoreCompleted(this.hass, this.entity, this.undoState.changes);
      await this.load();
    } catch (err) {
      this.reportError("undoing", err);
    }
    this.undoState = void 0;
  }
  async onClearCompleted() {
    try {
      await clearCompleted(this.hass, this.entity);
      await this.load();
    } catch (err) {
      this.reportError("clearing completed items", err);
    }
  }
  // A plain tap's behavior depends on what's actually true right now:
  // - delete-mode already active -> exit it (the crosses it revealed
  //   are the one thing a tap can always turn back off).
  // - otherwise, any top-level item currently complete -> clear them,
  //   exactly like this button always used to (see onClearCompleted).
  // - otherwise (nothing to clear) -> there's nothing useful a plain
  //   clear-completed tap could DO, so it enters delete-mode instead,
  //   revealing per-row crosses (desktop only - see deleteModeActive's
  //   own comment) so individual items can still be removed by hand.
  onClearButtonTap() {
    if (this.deleteModeActive) {
      this.deleteModeActive = false;
      return;
    }
    if (this.list?.items.some((item) => item.completed)) {
      this.onClearCompleted();
    } else {
      this.enterDeleteMode();
    }
  }
  get clearButtonHoldReady() {
    return this.clearButtonPressedAt !== 0 && Date.now() - this.clearButtonPressedAt >= LONG_PRESS_MS;
  }
  async onClearAllConfirmed() {
    this.confirmingClearAll = false;
    try {
      await clearAll(this.hass, this.entity);
      await this.load();
    } catch (err) {
      this.reportError("deleting all items", err);
    }
  }
  // --- save / load ---------------------------------------------------
  async openSaveDialog() {
    try {
      this.savedNames = await listSaved(this.hass);
    } catch (err) {
      this.reportError("loading saved list names", err);
      return;
    }
    this.saveLoadValue = EMPTY_SAVE_LOAD_VALUE;
    this.saveLoadAction = "save";
  }
  async openLoadDialog() {
    try {
      this.savedNames = await listSaved(this.hass);
    } catch (err) {
      this.reportError("loading saved list names", err);
      return;
    }
    this.targetOptions = flattenForTargetPicker(this.list?.items ?? []);
    this.saveLoadValue = EMPTY_SAVE_LOAD_VALUE;
    this.saveLoadAction = "load";
  }
  closeSaveLoadDialog() {
    this.saveLoadAction = void 0;
  }
  async onSaveLoadConfirm(e7) {
    const value = e7.detail;
    try {
      if (this.saveLoadAction === "save") {
        await saveList(this.hass, this.entity, value.name, value.persistStates);
      } else {
        await loadList(this.hass, this.entity, value.name, value.mode, value.targetItem || void 0);
      }
      await this.load();
    } catch (err) {
      this.reportError(
        this.saveLoadAction === "save" ? "saving the list" : "loading the saved list",
        err
      );
    }
    this.closeSaveLoadDialog();
  }
  async onSaveLoadDeleteSaved(e7) {
    try {
      await deleteSavedList(this.hass, e7.detail.name);
      this.savedNames = await listSaved(this.hass);
      this.saveLoadValue = { ...this.saveLoadValue, name: "" };
    } catch (err) {
      this.reportError("deleting the saved list", err);
    }
  }
  // --- add / edit / delete dialog --------------------------------------
  openEditDialog(item) {
    this.dialogMode = "edit";
    this.dialogItem = item;
    this.dialogFormValue = this.toFormValue(item);
  }
  openCreateDialog() {
    this.dialogMode = "create";
    this.dialogItem = void 0;
    this.dialogFormValue = EMPTY_FORM_VALUE;
  }
  closeDialog() {
    this.dialogMode = void 0;
    this.dialogItem = void 0;
  }
  async onDialogToggleComplete() {
    if (!this.dialogItem) {
      return;
    }
    await this.toggleComplete(this.dialogItem);
    this.closeDialog();
  }
  // Seeded ONCE into dialogFormValue when the dialog opens (see
  // openEditDialog/openCreateDialog), never recomputed from here again
  // while it's open. Live-reproduced bug: this used to be called fresh
  // from render() on every parent re-render (an error banner timing
  // out, another item elsewhere in the same list changing, a linked
  // list's incoming sync notification - anything reactive), which
  // handed the child dialog a brand-new .value prop built from this
  // frozen dialogItem snapshot - silently overwriting whatever the
  // user had already typed into title/quantity/tags/description back
  // to the value the dialog opened with, before Save was ever pressed.
  toFormValue(item) {
    const due = item.due_datetime ? splitDueDateTime(item.due_datetime) : { date: item.due_date ?? "", time: "" };
    return {
      title: item.title,
      quantity: item.quantity ?? "",
      tags: item.tags.join(", "),
      description: item.description ?? "",
      dueDate: due.date,
      dueTime: due.time,
      triggerOnDue: item.trigger_on_due,
      pinType: item.pin_type ?? ""
    };
  }
  async onDialogSave(e7) {
    const value = e7.detail;
    const support = this.fieldSupport;
    const description = support.description ? value.description : void 0;
    let dueDate;
    let dueDatetime;
    if (support.dueDateTime && value.dueDate && value.dueTime) {
      dueDatetime = `${value.dueDate}T${value.dueTime}:00`;
    } else if (support.dueDate && value.dueDate) {
      dueDate = value.dueDate;
    }
    const quantity = value.quantity.trim() || void 0;
    const tags = value.tags.split(",").map((tag) => tag.trim()).filter((tag) => tag.length > 0);
    const pinType = value.pinType || void 0;
    try {
      if (this.dialogMode === "edit" && this.dialogItem) {
        await updateItem(this.hass, this.entity, this.dialogItem.id, {
          title: value.title,
          description,
          dueDate,
          dueDatetime
        });
        await Promise.all([
          setQuantity(this.hass, this.entity, this.dialogItem.id, quantity),
          setTags(this.hass, this.entity, this.dialogItem.id, tags),
          setTriggerOnDue(this.hass, this.entity, this.dialogItem.id, value.triggerOnDue),
          setPinType(this.hass, this.entity, this.dialogItem.id, pinType)
        ]);
      } else {
        await createItem(this.hass, this.entity, {
          title: value.title,
          description,
          dueDate,
          dueDatetime,
          quantity,
          tags,
          triggerOnDue: value.triggerOnDue,
          pinType
        });
      }
      await this.load();
    } catch (err) {
      this.reportError("saving the item", err);
    }
    this.closeDialog();
  }
  async onDialogDelete() {
    if (!this.dialogItem) {
      return;
    }
    try {
      await deleteItem(this.hass, this.entity, this.dialogItem.id);
      await this.load();
    } catch (err) {
      this.reportError("deleting the item", err);
    }
    this.closeDialog();
  }
  // A row's own delete cross (see todo-tree-item.ts - leaf rows only,
  // already confirmed there before this ever fires) rather than the
  // edit dialog's Delete button - a separate, more direct path to the
  // same underlying delete.
  async onDeleteItem(e7) {
    try {
      await deleteItem(this.hass, this.entity, e7.detail.id);
      await this.load();
    } catch (err) {
      this.reportError("deleting the item", err);
    }
  }
  // --- quick add ---------------------------------------------------
  onQuickAddInput(e7) {
    this.quickAddValue = e7.target.value;
  }
  onQuickAddKeydown(e7) {
    if (e7.key === "Enter") {
      this.submitQuickAdd();
    }
  }
  async submitQuickAdd() {
    const title = this.quickAddValue.trim();
    if (!title) {
      return;
    }
    try {
      await createItem(this.hass, this.entity, { title });
      this.quickAddValue = "";
      await this.load();
    } catch (err) {
      this.reportError("adding the item", err);
    }
  }
  // Toggling a specific parent's own inline "add a child" field open/
  // closed (see todo-tree-item.ts's per-row plus icon) - independent
  // of the root quick-add and of every other parent's own field; see
  // childQuickAddParentIds' own comment for how the two relate.
  onToggleChildQuickAdd(e7) {
    const parentId = e7.detail.id;
    const next = new Set(this.childQuickAddParentIds);
    if (next.has(parentId)) {
      next.delete(parentId);
    } else {
      next.add(parentId);
      if (this.collapsedIds.has(parentId)) {
        const nextCollapsed = new Set(this.collapsedIds);
        nextCollapsed.delete(parentId);
        this.collapsedIds = nextCollapsed;
        saveCollapsedIds(this.entity, nextCollapsed);
      }
    }
    this.childQuickAddParentIds = next;
  }
  async onChildQuickAddSubmit(e7) {
    const title = e7.detail.title.trim();
    if (!title || !this.list) {
      return;
    }
    const parent = findItem(this.list.items, e7.detail.parentId);
    if (!parent) {
      return;
    }
    const referenceId = parent.children.length > 0 ? parent.children[0].id : e7.detail.parentId;
    const placement = parent.children.length > 0 ? "before" : "inside";
    try {
      await createItem(this.hass, this.entity, { title, referenceId, placement });
      await this.load();
    } catch (err) {
      this.reportError("adding the item", err);
    }
  }
  renderTree(list) {
    const filtered = filterTree(list.items, this.filterMode);
    const items = sortTree(filtered, this.sortBy, this.sortOrder);
    if (!this.moveCompletedItems) {
      return b2`
                <todo-overlay-tree
                    .items=${items}
                    .draggedId=${this.draggedId}
                    .hoverId=${this.hoverId}
                    .hoverPlacement=${this.hoverPlacement}
                    .hoverDepth=${this.hoverDepth}
                    .emptyDropHighlight=${this.isEmptyDropTarget}
                    .hideCompleteForParents=${this.hideCompleteForParents}
                    .showCheckboxes=${this.showCheckboxes}
                    .confirmDelete=${this.confirmDelete}
                    .dragDisabled=${this.dragDisabled}
                    .collapsedIds=${this.collapsedIds}
                    .childQuickAddParentIds=${this.childQuickAddParentIds}
                    .addModeActive=${this.addModeActive}
                    .deleteModeActive=${this.deleteModeActive}
                    .reorderModeActive=${this.reorderModeActive}

                    @tree-pointer-down=${this.onPointerDown}
                    @tree-drag-start=${this.onDragStart}
                    @tree-pointer-up=${this.onPointerUp}
                    @tree-toggle-collapse=${this.onToggleCollapse}
                    @tree-delete-item=${this.onDeleteItem}
                    @tree-toggle-child-quick-add=${this.onToggleChildQuickAdd}
                    @tree-quick-add-child=${this.onChildQuickAddSubmit}

                ></todo-overlay-tree>
            `;
    }
    const completedItems = items.filter((item) => item.completed);
    if (completedItems.length === 0) {
      return b2`
                <todo-overlay-tree
                    .items=${items}
                    .draggedId=${this.draggedId}
                    .hoverId=${this.hoverId}
                    .hoverPlacement=${this.hoverPlacement}
                    .hoverDepth=${this.hoverDepth}
                    .emptyDropHighlight=${this.isEmptyDropTarget}
                    .hideCompleteForParents=${this.hideCompleteForParents}
                    .showCheckboxes=${this.showCheckboxes}
                    .confirmDelete=${this.confirmDelete}
                    .dragDisabled=${this.dragDisabled}
                    .collapsedIds=${this.collapsedIds}
                    .childQuickAddParentIds=${this.childQuickAddParentIds}
                    .addModeActive=${this.addModeActive}
                    .deleteModeActive=${this.deleteModeActive}
                    .reorderModeActive=${this.reorderModeActive}

                    @tree-pointer-down=${this.onPointerDown}
                    @tree-drag-start=${this.onDragStart}
                    @tree-pointer-up=${this.onPointerUp}
                    @tree-toggle-collapse=${this.onToggleCollapse}
                    @tree-delete-item=${this.onDeleteItem}
                    @tree-toggle-child-quick-add=${this.onToggleChildQuickAdd}
                    @tree-quick-add-child=${this.onChildQuickAddSubmit}

                ></todo-overlay-tree>
            `;
    }
    const activeItems = items.filter((item) => !item.completed);
    return b2`
            ${activeItems.length ? b2`
                        <div class="section-header">Active</div>
                        <todo-overlay-tree
                            .items=${activeItems}
                            .draggedId=${this.draggedId}
                            .hoverId=${this.hoverId}
                            .hoverPlacement=${this.hoverPlacement}
                            .hoverDepth=${this.hoverDepth}
                            .hideCompleteForParents=${this.hideCompleteForParents}
                            .showCheckboxes=${this.showCheckboxes}
                            .confirmDelete=${this.confirmDelete}
                            .dragDisabled=${this.dragDisabled}
                            .collapsedIds=${this.collapsedIds}
                            .childQuickAddParentIds=${this.childQuickAddParentIds}
                            .addModeActive=${this.addModeActive}
                            .deleteModeActive=${this.deleteModeActive}
                    .reorderModeActive=${this.reorderModeActive}

                            @tree-pointer-down=${this.onPointerDown}
                            @tree-drag-start=${this.onDragStart}
                            @tree-pointer-up=${this.onPointerUp}
                            @tree-toggle-collapse=${this.onToggleCollapse}
                            @tree-delete-item=${this.onDeleteItem}
                            @tree-toggle-child-quick-add=${this.onToggleChildQuickAdd}
                            @tree-quick-add-child=${this.onChildQuickAddSubmit}

                        ></todo-overlay-tree>
                    ` : ""}

            <div class="section-header">Completed</div>
            <todo-overlay-tree
                .items=${completedItems}
                .draggedId=${this.draggedId}
                .hoverId=${this.hoverId}
                .hoverPlacement=${this.hoverPlacement}
                .hoverDepth=${this.hoverDepth}
                .hideCompleteForParents=${this.hideCompleteForParents}
                .showCheckboxes=${this.showCheckboxes}
                .confirmDelete=${this.confirmDelete}
                .dragDisabled=${this.dragDisabled}
                .collapsedIds=${this.collapsedIds}
                .childQuickAddParentIds=${this.childQuickAddParentIds}
                .addModeActive=${this.addModeActive}
                .deleteModeActive=${this.deleteModeActive}
                .reorderModeActive=${this.reorderModeActive}

                @tree-pointer-down=${this.onPointerDown}
                @tree-drag-start=${this.onDragStart}
                @tree-pointer-up=${this.onPointerUp}
                @tree-toggle-collapse=${this.onToggleCollapse}
                @tree-delete-item=${this.onDeleteItem}
                @tree-toggle-child-quick-add=${this.onToggleChildQuickAdd}
                @tree-quick-add-child=${this.onChildQuickAddSubmit}

            ></todo-overlay-tree>
        `;
  }
  // Keeps a box positioned at (left, top) with the given size fully
  // on-screen - a backstop alongside onDragStart's own grab-offset
  // cap for touch, not a replacement for it: the cap addresses WHY
  // the ghost drifts far from the pointer in the first place (see its
  // own comment), this just guarantees nothing ever renders off-
  // screen regardless of cause.
  clampToViewport(left, top, width, height) {
    const maxLeft = Math.max(GHOST_VIEWPORT_MARGIN_PX, window.innerWidth - width - GHOST_VIEWPORT_MARGIN_PX);
    const maxTop = Math.max(GHOST_VIEWPORT_MARGIN_PX, window.innerHeight - height - GHOST_VIEWPORT_MARGIN_PX);
    return {
      left: Math.min(Math.max(left, GHOST_VIEWPORT_MARGIN_PX), maxLeft),
      top: Math.min(Math.max(top, GHOST_VIEWPORT_MARGIN_PX), maxTop)
    };
  }
  renderDragGhost() {
    if (!this.ghostPosition || !this.draggedId || !this.list) {
      return "";
    }
    const item = findItem(this.list.items, this.draggedId);
    if (!item) {
      return "";
    }
    const rawLeft = this.ghostPosition.x - this.dragGhostOffset.x;
    const rawTop = this.ghostPosition.y - this.dragGhostOffset.y;
    const hoveringParent = this.hoverPlacement === "inside" && this.hoverId !== void 0;
    const targetItem = hoveringParent ? findItem(this.list.items, this.hoverId) : void 0;
    const applyTreatment = hoveringParent && targetItem !== void 0 && this.dragGhostStyle !== "none";
    const shrinking = applyTreatment && this.dragGhostStyle === "shrink";
    const ghostWidth = shrinking ? DRAG_GHOST_SHRINK_WIDTH_PX : this.dragGhostSize?.width ?? DRAG_GHOST_FALLBACK_WIDTH_PX;
    const ghostHeight = this.dragGhostSize?.height ?? DRAG_GHOST_FALLBACK_HEIGHT_PX;
    const { left, top } = this.clampToViewport(rawLeft, rawTop, ghostWidth, ghostHeight);
    return b2`
            <div
                class=${e6({
      "drag-ghost": true,
      shrink: shrinking,
      translucent: applyTreatment && this.dragGhostStyle === "translucent"
    })}
                style=${o6({
      left: `${left}px`,
      top: `${top}px`,
      width: `${ghostWidth}px`
    })}
            >
                <ha-checkbox .checked=${item.completed}></ha-checkbox>
                <span class="drag-ghost-title">${item.title}</span>
                ${item.quantity ? b2`<span class="drag-ghost-quantity">${item.quantity}</span>` : ""}
            </div>
            ${(() => {
      if (!(applyTreatment && this.dragGhostStyle === "label")) {
        return "";
      }
      const labelPos = this.clampToViewport(
        left,
        top + ghostHeight + DRAG_GHOST_LABEL_GAP_PX,
        ghostWidth,
        DRAG_GHOST_LABEL_FALLBACK_HEIGHT_PX
      );
      return b2`
                        <div
                            class="drag-ghost-label"
                            style=${o6({ left: `${labelPos.left}px`, top: `${labelPos.top}px` })}
                        >
                            Add to: ${targetItem.title}
                        </div>
                    `;
    })()}
        `;
  }
  render() {
    const hasToolbar = this.showQuickAdd || this.showFilterMenu || this.showSaveLoadButtons || this.showClearButton || this.showReorderToggle;
    const hasHeaderRow = !!this.headerTitle || hasToolbar;
    return b2`
            ${hasHeaderRow ? b2`
                        <div class="list-header-row">
                            ${this.headerTitle ? b2`
                                        <div class="list-title-group">
                                            <span class="list-title">${this.headerTitle}</span>
                                            ${this.list?.link_id ? b2`
                                                        <span class="link-badge" title="Linked list">
                                                            ${LINK_ICON}
                                                        </span>
                                                    ` : ""}
                                        </div>
                                    ` : ""}
                            ${hasToolbar ? b2`
                                        <div class="toolbar">
                                            <button
                                                class=${e6({
      "toolbar-icon": true,
      "quick-add-toggle": true,
      expanded: this.addModeActive
    })}
                                                aria-label="Add item"
                                                title="Add item"
                                                @click=${this.onToggleQuickAdd}
                                            >
                                                ${PLUS_ICON2}
                                            </button>

                                            ${this.showFilterMenu ? b2`
                                                        <div
                                                            class=${e6({
      "toolbar-icon": true,
      "filter-select-wrapper": true,
      active: this.filterMode !== "all"
    })}
                                                            title="Filter items"
                                                        >
                                                            ${FILTER_ICON}
                                                            ${this.filterMode !== "all" ? b2`<span class="badge-dot"></span>` : ""}
                                                            <select
                                                                class="filter-select"
                                                                aria-label="Filter"
                                                                .value=${this.filterMode}
                                                                @change=${this.onFilterSelectChange}
                                                            >
                                                                ${FILTER_MODES.map((mode) => b2`
                                                                    <option value=${mode}>${FILTER_LABELS[mode]}</option>
                                                                `)}
                                                            </select>
                                                        </div>
                                                    ` : ""}

                                            ${this.showSaveLoadButtons ? b2`
                                                        <button
                                                            class="toolbar-icon"
                                                            aria-label="Save list"
                                                            title="Save list"
                                                            @click=${this.openSaveDialog}
                                                        >
                                                            ${SAVE_ICON}
                                                        </button>
                                                        <button
                                                            class="toolbar-icon"
                                                            aria-label="Load list"
                                                            title="Load list"
                                                            @click=${this.openLoadDialog}
                                                        >
                                                            ${LOAD_ICON}
                                                        </button>
                                                    ` : ""}

                                            ${this.showClearButton ? b2`
                                                        <button
                                                            class=${e6({
      "toolbar-icon": true,
      active: this.deleteModeActive
    })}
                                                            aria-label=${this.deleteModeActive ? "Done deleting" : "Clear completed"}
                                                            title="Tap: clear completed (or delete items). Hold: delete all."
                                                            @pointerdown=${this.onClearButtonPointerDown}
                                                            @pointerup=${this.onClearButtonPointerUp}
                                                            @pointercancel=${this.onClearButtonPointerCancel}
                                                        >
                                                            ${this.clearButtonPressedAt !== 0 ? b2`
                                                                        <div
                                                                            class=${e6({
      "hold-ripple": true,
      active: this.clearButtonHoldReady
    })}
                                                                        ></div>
                                                                    ` : ""}
                                                            ${CLEAR_COMPLETED_ICON}
                                                        </button>
                                                    ` : ""}

                                            ${this.showReorderToggle ? b2`
                                                        <button
                                                            class=${e6({
      "toolbar-icon": true,
      "reorder-toggle": true,
      active: this.reorderModeActive
    })}
                                                            aria-label=${this.reorderModeActive ? "Done reordering" : "Reorder items"}
                                                            title=${this.reorderModeActive ? "Done reordering" : "Reorder items"}
                                                            @click=${this.onToggleReorderMode}
                                                        >
                                                            ${REORDER_TOGGLE_ICON}
                                                        </button>
                                                    ` : ""}
                                        </div>
                                    ` : ""}
                        </div>
                    ` : ""}

            ${this.addModeActive ? b2`
                        <div class="quick-add-panel">
                            <div class="quick-add-row">
                                <input
                                    type="text"
                                    placeholder="Add item"
                                    .value=${this.quickAddValue}
                                    @input=${this.onQuickAddInput}
                                    @keydown=${this.onQuickAddKeydown}
                                />
                                <button @click=${this.submitQuickAdd}>
                                    Add
                                </button>
                            </div>
                            <button class="quick-add-details" @click=${this.openCreateDialog}>
                                Details…
                            </button>
                        </div>
                    ` : ""}

            ${this.list ? b2`
                        ${this.error ? b2`
                                    <div class="error-banner">
                                        <span>${this.error}</span>
                                        <button aria-label="Dismiss" @click=${this.dismissError}>
                                            ${CLOSE_ICON}
                                        </button>
                                    </div>
                                ` : ""}
                        ${this.renderTree(this.list)}
                    ` : this.error ? b2`
                            <div style="padding:16px; color: var(--error-color)">
                                ${this.error}
                            </div>
                        ` : b2`
                            <div style="padding:16px">
                                Loading...
                            </div>
                        `}

            ${this.undoState ? b2`
                        <div class="undo-snackbar">
                            <span>${this.undoState.message}</span>
                            <button @click=${this.onUndo}>
                                Undo
                            </button>
                        </div>
                    ` : ""}

            ${this.dialogMode ? b2`
                        <todo-overlay-item-dialog
                            .heading=${this.dialogMode === "edit" ? "Edit item" : "Add item"}
                            .value=${this.dialogFormValue}
                            .fieldSupport=${this.fieldSupport}
                            ?showDelete=${this.dialogMode === "edit"}
                            ?confirmDelete=${this.confirmDelete}
                            ?showCompleteToggle=${this.dialogMode === "edit" && this.hideCompleteForParents && (this.dialogItem?.children.length ?? 0) > 0}
                            ?completed=${this.dialogItem?.completed ?? false}

                            @dialog-close=${this.closeDialog}
                            @dialog-save=${this.onDialogSave}
                            @dialog-delete=${this.onDialogDelete}
                            @dialog-toggle-complete=${this.onDialogToggleComplete}
                        ></todo-overlay-item-dialog>
                    ` : ""}

            ${this.saveLoadAction ? b2`
                        <todo-overlay-save-load-dialog
                            .action=${this.saveLoadAction}
                            .value=${this.saveLoadValue}
                            .savedNames=${this.savedNames}
                            .targetOptions=${this.targetOptions}

                            @dialog-close=${this.closeSaveLoadDialog}
                            @dialog-confirm=${this.onSaveLoadConfirm}
                            @dialog-delete-saved=${this.onSaveLoadDeleteSaved}
                        ></todo-overlay-save-load-dialog>
                    ` : ""}

            ${this.confirmingClearAll ? b2`
                        <todo-overlay-confirm-dialog
                            .heading=${"Delete all items?"}
                            .message=${"This permanently deletes every item in this list - active and completed, parents and children. This can't be undone."}
                            .confirmLabel=${"Delete all"}

                            @dialog-close=${this.closeClearAllConfirm}
                            @dialog-confirm=${this.onClearAllConfirmed}
                        ></todo-overlay-confirm-dialog>
                    ` : ""}

            ${this.renderDragGhost()}
        `;
  }
};
TodoOverlayList.styles = i`
        .list-header-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            padding: 8px 8px 8px 12px;
        }

        .list-title-group {
            display: flex;
            align-items: center;
            gap: 6px;
            min-width: 0;
        }

        .list-title {
            font-family: Roboto, "Noto Sans", sans-serif;
            font-size: 16px;
            font-weight: 500;
            color: var(--primary-text-color);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            min-width: 0;
        }

        .link-badge {
            display: flex;
            align-items: center;
            flex-shrink: 0;
            color: var(--secondary-text-color);
        }

        .link-badge svg {
            width: 14px;
            height: 14px;
            fill: currentColor;
        }

        .toolbar {
            display: flex;
            align-items: center;
            gap: 4px;
            flex-shrink: 0;
        }

        .toolbar-icon {
            position: relative;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 36px;
            height: 36px;
            flex-shrink: 0;
            border: none;
            border-radius: 50%;
            background: none;
            padding: 0;
            color: var(--secondary-text-color);
            cursor: pointer;
        }

        .toolbar-icon:hover {
            background: rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.06);
        }

        .toolbar-icon.active {
            color: var(--primary-color);
        }

        .toolbar-icon svg {
            width: 20px;
            height: 20px;
            fill: currentColor;
        }

        .toolbar-icon .badge-dot {
            position: absolute;
            top: 6px;
            right: 6px;
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: var(--primary-color);
        }

        /* Same visual language as a row's own hold-to-edit ripple
           (todo-tree-item.ts's .hold-ripple) - pops in once the press
           has been held long enough to trigger the hold action instead
           of a plain tap, so there's a clear "you can let go now"
           signal rather than needing to guess how long is long enough. */
        .toolbar-icon .hold-ripple {
            position: absolute;
            top: 50%;
            left: 50%;
            width: 32px;
            height: 32px;
            margin-left: -16px;
            margin-top: -16px;
            border-radius: 50%;
            background: var(--primary-color);
            opacity: 0.2;
            pointer-events: none;
            transform: scale(0);
            transition: transform 180ms ease-in-out;
        }

        .toolbar-icon .hold-ripple.active {
            transform: scale(1);
        }

        .toolbar-icon.quick-add-toggle svg {
            transition: transform 150ms ease;
        }

        .toolbar-icon.quick-add-toggle.expanded svg {
            transform: rotate(45deg);
        }

        /* Hidden by default (mouse/trackpad primary input) - hold-
           anywhere-to-drag already works reliably for a mouse, so this
           would just be clutter. (pointer: coarse) is the actual primary-
           input-is-imprecise signal, not a viewport-width breakpoint - a
           narrow desktop browser window shouldn't show it, and a tablet
           in the HA Companion App should, regardless of its screen size.
           See todo-tree-item.ts's .drag-handle for what this puts each
           row into once active. */
        .reorder-toggle {
            display: none;
        }

        @media (pointer: coarse) {
            .reorder-toggle {
                display: flex;
            }
        }

        .quick-add-panel {
            padding: 0 16px 10px;
            font-family: Roboto, "Noto Sans", sans-serif;
        }

        .quick-add-row {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .quick-add-row input {
            flex: 1;
            font-family: inherit;
            font-size: 14px;
            color: var(--primary-text-color);
            background: none;
            border: none;
            border-bottom: 1px solid var(--divider-color);
            padding: 6px 0;
            outline: none;
        }

        .quick-add-row input:focus {
            border-bottom: 2px solid var(--primary-color);
            padding-bottom: 5px;
        }

        .quick-add-row button {
            border: none;
            background: none;
            font-family: inherit;
            font-size: 14px;
            color: var(--primary-color);
            font-weight: 500;
            cursor: pointer;
        }

        .quick-add-details {
            display: block;
            margin-top: 4px;
            border: none;
            background: none;
            font-family: inherit;
            font-size: 12px;
            color: var(--secondary-text-color);
            cursor: pointer;
            padding: 4px 0;
        }

        /* The visible icon is purely decorative - an invisible native
           <select> is stretched over the whole button, so a click
           anywhere on the icon opens the browser's own dropdown. This
           gives a genuinely transient "pop out, pick one, gone" menu for
           free (native selects always auto-dismiss on choice or
           click-away) instead of a panel that has to be toggled open
           and closed by hand. */
        .filter-select-wrapper {
            padding: 0;
        }

        .filter-select {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            margin: 0;
            border: none;
            background: none;
            opacity: 0;
            cursor: pointer;
            appearance: none;
            -webkit-appearance: none;
        }

        .undo-snackbar {
            position: fixed;
            bottom: 16px;
            left: 50%;
            transform: translateX(-50%);
            display: flex;
            align-items: center;
            gap: 16px;
            padding: 12px 16px;
            border-radius: 4px;
            background: var(--primary-text-color);
            color: var(--primary-background-color);
            font-family: Roboto, "Noto Sans", sans-serif;
            font-size: 14px;
            z-index: 10;
        }

        .undo-snackbar button {
            border: none;
            background: none;
            color: var(--primary-color);
            font-family: inherit;
            font-weight: 600;
            text-transform: uppercase;
            cursor: pointer;
        }

        /* Sits above the list rather than replacing it (see render()) -
           an action failing is never a reason to hide items the user can
           already see, only to flag that the one action didn't go
           through. Auto-dismisses like the undo snackbar, and can be
           closed early by hand. */
        .error-banner {
            display: flex;
            align-items: center;
            gap: 12px;
            margin: 0 12px 8px;
            padding: 10px 12px;
            border-radius: 4px;
            background: rgba(var(--rgb-error-color, 219, 68, 55), 0.1);
            color: var(--error-color);
            font-family: Roboto, "Noto Sans", sans-serif;
            font-size: 13px;
        }

        .error-banner span {
            flex: 1;
        }

        .error-banner button {
            flex-shrink: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 20px;
            height: 20px;
            border: none;
            background: none;
            padding: 0;
            color: inherit;
            cursor: pointer;
            opacity: 0.7;
        }

        .error-banner button:hover {
            opacity: 1;
        }

        .error-banner button svg {
            width: 16px;
            height: 16px;
            fill: currentColor;
        }

        .section-header {
            padding: 14px 16px 6px;
            font-family: Roboto, "Noto Sans", sans-serif;
            font-size: 12px;
            font-weight: 700;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            color: var(--secondary-text-color);
        }

        /* Follows the pointer while an item is being dragged (see
           onDragStart/onGlobalPointerMove) - pointer-events:none is
           essential, not just cosmetic: without it, this element would
           itself be hit by our own elementFromPoint-based hit-testing,
           since it's rendered on top of everything else. */
        .drag-ghost {
            position: fixed;
            z-index: 10;
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 8px 20px;
            border-radius: 4px;
            background: var(--card-background-color, var(--primary-background-color));
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            pointer-events: none;
            font-family: Roboto, "Noto Sans", sans-serif;
            font-size: 14px;
            color: var(--primary-text-color);
        }

        .drag-ghost-title {
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .drag-ghost-quantity {
            flex-shrink: 0;
            font-size: 12px;
            font-weight: 600;
            color: var(--primary-color);
            background: rgba(var(--rgb-primary-color, 3, 169, 244), 0.12);
            padding: 1px 7px;
            border-radius: 10px;
        }

        /* "shrink" drag-ghost style only (see DragGhostStyle/
           renderDragGhost) - width is set inline per-instance (see
           DRAG_GHOST_SHRINK_WIDTH_PX), this just hides the content that
           no longer fits so nothing overflows or wraps oddly inside the
           collapsed box. */
        .drag-ghost.shrink {
            padding: 8px;
            justify-content: center;
            gap: 0;
        }

        .drag-ghost.shrink .drag-ghost-title,
        .drag-ghost.shrink .drag-ghost-quantity,
        .drag-ghost.shrink ha-checkbox {
            display: none;
        }

        /* "translucent" drag-ghost style only - lets the highlighted
           target row show through well enough to read while still
           fully covering it, unlike shrink (smaller box) or label (an
           entirely separate element). */
        .drag-ghost.translucent {
            opacity: 0.4;
        }

        /* "label" drag-ghost style only - a small satellite pill near
           (not on top of) the pointer, naming the parent a release
           right now would nest under. Never requires seeing the target
           row at all, which is what makes it work identically on touch
           (a finger blocks far more of the view than a mouse cursor
           does) and mouse alike. */
        /* Anchored directly under the ghost's own box (same left edge,
           see renderDragGhost) with a small upward-pointing arrow (see
           ::before below) so it reads as clearly attached to the thing
           being dragged, not as an independent floating chip with no
           obvious connection to it - the exact "dissociated" look
           live-reported against the first version, which anchored this
           near the raw pointer instead. */
        .drag-ghost-label {
            position: fixed;
            z-index: 11;
            pointer-events: none;
            display: inline-block;
            background: var(--accent-color, var(--primary-color));
            color: #fff;
            font-family: Roboto, "Noto Sans", sans-serif;
            font-size: 14px;
            font-weight: 600;
            padding: 7px 14px;
            border-radius: 8px;
            max-width: 260px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
        }

        .drag-ghost-label::before {
            content: "";
            position: absolute;
            top: -6px;
            left: 16px;
            border-left: 6px solid transparent;
            border-right: 6px solid transparent;
            border-bottom: 6px solid var(--accent-color, var(--primary-color));
        }
    `;
__decorateClass([
  n4({ attribute: false })
], TodoOverlayList.prototype, "hass", 2);
__decorateClass([
  n4()
], TodoOverlayList.prototype, "entity", 2);
__decorateClass([
  n4()
], TodoOverlayList.prototype, "headerTitle", 2);
__decorateClass([
  n4({ type: Boolean })
], TodoOverlayList.prototype, "hideCompleteForParents", 2);
__decorateClass([
  n4({ type: Boolean })
], TodoOverlayList.prototype, "showCheckboxes", 2);
__decorateClass([
  n4()
], TodoOverlayList.prototype, "sortBy", 2);
__decorateClass([
  n4()
], TodoOverlayList.prototype, "sortOrder", 2);
__decorateClass([
  n4({ type: Boolean })
], TodoOverlayList.prototype, "showClearButton", 2);
__decorateClass([
  n4({ type: Boolean })
], TodoOverlayList.prototype, "showSaveLoadButtons", 2);
__decorateClass([
  n4({ type: Boolean })
], TodoOverlayList.prototype, "showQuickAdd", 2);
__decorateClass([
  n4({ type: Boolean })
], TodoOverlayList.prototype, "confirmDelete", 2);
__decorateClass([
  n4({ type: Boolean })
], TodoOverlayList.prototype, "showFilterMenu", 2);
__decorateClass([
  n4({ type: Boolean })
], TodoOverlayList.prototype, "showReorderToggle", 2);
__decorateClass([
  n4({ type: Boolean })
], TodoOverlayList.prototype, "moveCompletedItems", 2);
__decorateClass([
  n4()
], TodoOverlayList.prototype, "dragGhostStyle", 2);
__decorateClass([
  r5()
], TodoOverlayList.prototype, "list", 2);
__decorateClass([
  r5()
], TodoOverlayList.prototype, "collapsedIds", 2);
__decorateClass([
  r5()
], TodoOverlayList.prototype, "filterMode", 2);
__decorateClass([
  r5()
], TodoOverlayList.prototype, "addModeActive", 2);
__decorateClass([
  r5()
], TodoOverlayList.prototype, "childQuickAddParentIds", 2);
__decorateClass([
  r5()
], TodoOverlayList.prototype, "deleteModeActive", 2);
__decorateClass([
  r5()
], TodoOverlayList.prototype, "reorderModeActive", 2);
__decorateClass([
  r5()
], TodoOverlayList.prototype, "error", 2);
__decorateClass([
  r5()
], TodoOverlayList.prototype, "draggedId", 2);
__decorateClass([
  r5()
], TodoOverlayList.prototype, "hoverId", 2);
__decorateClass([
  r5()
], TodoOverlayList.prototype, "hoverPlacement", 2);
__decorateClass([
  r5()
], TodoOverlayList.prototype, "hoverDepth", 2);
__decorateClass([
  r5()
], TodoOverlayList.prototype, "foreignDragActive", 2);
__decorateClass([
  r5()
], TodoOverlayList.prototype, "ghostPosition", 2);
__decorateClass([
  r5()
], TodoOverlayList.prototype, "dialogMode", 2);
__decorateClass([
  r5()
], TodoOverlayList.prototype, "dialogItem", 2);
__decorateClass([
  r5()
], TodoOverlayList.prototype, "dialogFormValue", 2);
__decorateClass([
  r5()
], TodoOverlayList.prototype, "quickAddValue", 2);
__decorateClass([
  r5()
], TodoOverlayList.prototype, "undoState", 2);
__decorateClass([
  r5()
], TodoOverlayList.prototype, "saveLoadAction", 2);
__decorateClass([
  r5()
], TodoOverlayList.prototype, "saveLoadValue", 2);
__decorateClass([
  r5()
], TodoOverlayList.prototype, "savedNames", 2);
__decorateClass([
  r5()
], TodoOverlayList.prototype, "targetOptions", 2);
__decorateClass([
  r5()
], TodoOverlayList.prototype, "confirmingClearAll", 2);
TodoOverlayList = __decorateClass([
  t3("todo-overlay-list")
], TodoOverlayList);

// src/components/todo-overlay-card-editor.ts
var EMPTY_CONFIG = { entity: "" };
var ENTITY_SELECTOR = { entity: { multiple: true, domain: "todo" } };
var TodoOverlayCardEditor = class extends i4 {
  constructor() {
    super(...arguments);
    this._config = EMPTY_CONFIG;
  }
  setConfig(config) {
    this._config = config;
  }
  emitConfigChanged(config) {
    this._config = config;
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config },
        bubbles: true,
        composed: true
      })
    );
  }
  // Always edited as a list, even when it's a single entry - a config
  // written by hand can still use the older singular `entity` field
  // (TodoOverlayCard's render() falls back to it when `entities` is
  // empty), but any edit made here migrates it to `entities`, since
  // that's the one field capable of expressing both single- and
  // multi-entity configs.
  get entities() {
    if (this._config.entities?.length) {
      return this._config.entities;
    }
    return this._config.entity ? [this._config.entity] : [];
  }
  onEntitiesChanged(e7) {
    const { entity: _entity, ...rest } = this._config;
    this.emitConfigChanged({ ...rest, entities: e7.detail.value });
  }
  onTitleChanged(e7) {
    const value = e7.target.value;
    this.emitConfigChanged({ ...this._config, title: value || void 0 });
  }
  onSortByChanged(e7) {
    const value = e7.target.value;
    this.emitConfigChanged({ ...this._config, sort_by: value });
  }
  onSortOrderChanged(e7) {
    const value = e7.target.value;
    this.emitConfigChanged({ ...this._config, sort_order: value });
  }
  onDragGhostStyleChanged(e7) {
    const value = e7.target.value;
    this.emitConfigChanged({ ...this._config, drag_ghost_style: value === "label" ? void 0 : value });
  }
  onSwitchChanged(field, defaultValue) {
    return (e7) => {
      const checked = e7.target.checked;
      this.emitConfigChanged({
        ...this._config,
        [field]: checked === defaultValue ? void 0 : checked
      });
    };
  }
  render() {
    const sortBy = this._config.sort_by ?? "manual";
    return b2`
            <div class="field">
                <ha-selector
                    .hass=${this.hass}
                    .selector=${ENTITY_SELECTOR}
                    .value=${this.entities}
                    label="Todo entities"
                    @value-changed=${this.onEntitiesChanged}
                ></ha-selector>
            </div>

            <div class="field text-field">
                <label for="todo-overlay-title">Title</label>
                <input
                    id="todo-overlay-title"
                    type="text"
                    placeholder="Todo Overlay"
                    .value=${this._config.title ?? ""}
                    @input=${this.onTitleChanged}
                />
            </div>

            <div class="section-title">Sorting</div>

            <div class="row">
                <div class="field select-field">
                    <label for="todo-overlay-sort-by">Sort by</label>
                    <select id="todo-overlay-sort-by" .value=${sortBy} @change=${this.onSortByChanged}>
                        <option value="manual">Manual (drag and drop)</option>
                        <option value="title">Title</option>
                        <option value="due_date">Due date</option>
                    </select>
                </div>

                ${sortBy !== "manual" ? b2`
                            <div class="field select-field">
                                <label for="todo-overlay-sort-order">Order</label>
                                <select
                                    id="todo-overlay-sort-order"
                                    .value=${this._config.sort_order ?? "asc"}
                                    @change=${this.onSortOrderChanged}
                                >
                                    <option value="asc">Ascending</option>
                                    <option value="desc">Descending</option>
                                </select>
                            </div>
                        ` : ""}
            </div>

            <div class="section-title">Behavior</div>

            <ha-formfield label="Hide complete checkbox for parents">
                <ha-switch
                    .checked=${this._config.hide_complete_for_parents ?? true}
                    @change=${this.onSwitchChanged("hide_complete_for_parents", true)}
                ></ha-switch>
            </ha-formfield>

            <ha-formfield label="Show checkboxes">
                <ha-switch
                    .checked=${this._config.show_checkboxes ?? false}
                    @change=${this.onSwitchChanged("show_checkboxes", false)}
                ></ha-switch>
            </ha-formfield>

            <div class="section-title">Show</div>

            <ha-formfield label="Clear completed button">
                <ha-switch
                    .checked=${this._config.show_clear_completed_button ?? true}
                    @change=${this.onSwitchChanged("show_clear_completed_button", true)}
                ></ha-switch>
            </ha-formfield>

            <ha-formfield label="Quick-add bar">
                <ha-switch
                    .checked=${this._config.show_quick_add ?? true}
                    @change=${this.onSwitchChanged("show_quick_add", true)}
                ></ha-switch>
            </ha-formfield>

            <details class="advanced">
                <summary>Advanced</summary>
                <div class="advanced-content">
                    <ha-formfield label="Move completed items to the bottom">
                        <ha-switch
                            .checked=${this._config.move_completed_items ?? false}
                            @change=${this.onSwitchChanged("move_completed_items", false)}
                        ></ha-switch>
                    </ha-formfield>

                    <ha-formfield label="Confirm before deleting an item">
                        <ha-switch
                            .checked=${this._config.confirm_delete ?? true}
                            @change=${this.onSwitchChanged("confirm_delete", true)}
                        ></ha-switch>
                    </ha-formfield>

                    <ha-formfield label="Save/load list buttons">
                        <ha-switch
                            .checked=${this._config.show_save_load_buttons ?? true}
                            @change=${this.onSwitchChanged("show_save_load_buttons", true)}
                        ></ha-switch>
                    </ha-formfield>

                    <ha-formfield label="Filter icon in toolbar">
                        <ha-switch
                            .checked=${this._config.show_filter_menu ?? false}
                            @change=${this.onSwitchChanged("show_filter_menu", false)}
                        ></ha-switch>
                    </ha-formfield>

                    <ha-formfield label="Reorder-mode toggle (touch devices only)">
                        <ha-switch
                            .checked=${this._config.show_reorder_toggle ?? true}
                            @change=${this.onSwitchChanged("show_reorder_toggle", true)}
                        ></ha-switch>
                    </ha-formfield>

                    <div class="field select-field">
                        <label for="todo-overlay-drag-ghost-style">
                            Drag ghost style while hovering a parent
                        </label>
                        <select
                            id="todo-overlay-drag-ghost-style"
                            .value=${this._config.drag_ghost_style ?? "label"}
                            @change=${this.onDragGhostStyleChanged}
                        >
                            <option value="label">Floating label naming the parent (default)</option>
                            <option value="shrink">Shrink the ghost</option>
                            <option value="translucent">Make the ghost translucent</option>
                            <option value="none">None</option>
                        </select>
                    </div>
                </div>
            </details>
        `;
  }
};
TodoOverlayCardEditor.styles = i`
        .field {
            margin-bottom: 16px;
        }

        .row {
            display: flex;
            gap: 16px;
        }

        .row > .field {
            flex: 1;
            min-width: 0;
        }

        .text-field label,
        .select-field label {
            display: block;
            font-size: 12px;
            color: var(--secondary-text-color);
            margin-bottom: 4px;
        }

        .text-field input,
        .select-field select {
            width: 100%;
            box-sizing: border-box;
            font-family: inherit;
            font-size: 14px;
            color: var(--primary-text-color);
            background: none;
            border: none;
            border-bottom: 1px solid var(--divider-color);
            padding: 8px 0;
            outline: none;
        }

        .text-field input:focus,
        .select-field select:focus {
            border-bottom: 2px solid var(--primary-color);
        }

        .section-title {
            font-size: 12px;
            font-weight: 500;
            text-transform: uppercase;
            color: var(--secondary-text-color);
            margin: 24px 0 8px;
        }

        ha-formfield {
            display: block;
        }

        .advanced {
            margin-top: 24px;
        }

        .advanced summary {
            font-size: 12px;
            font-weight: 500;
            text-transform: uppercase;
            color: var(--secondary-text-color);
            cursor: pointer;
        }

        .advanced-content {
            margin-top: 8px;
        }
    `;
__decorateClass([
  n4({ attribute: false })
], TodoOverlayCardEditor.prototype, "hass", 2);
__decorateClass([
  r5()
], TodoOverlayCardEditor.prototype, "_config", 2);
TodoOverlayCardEditor = __decorateClass([
  t3("todo-overlay-card-editor")
], TodoOverlayCardEditor);

// src/todo-overlay.ts
function friendlyName(hass, entityId) {
  const name = hass.states[entityId]?.attributes.friendly_name;
  return typeof name === "string" && name ? name : entityId;
}
var TodoOverlayCard = class extends i4 {
  setConfig(config) {
    const hasEntities = Array.isArray(config.entities) && config.entities.length > 0;
    if (!config.entity && !hasEntities) {
      throw new Error("todo-overlay-card: 'entity' or 'entities' is required");
    }
    this.config = config;
  }
  // Picked up by Home Assistant's edit-card dialog to show a UI editor
  // instead of leaving the user to hand-write YAML - the returned
  // element just needs a setConfig() method and to emit "config-changed"
  // (see todo-overlay-card-editor.ts), the same contract every native
  // card's editor follows.
  static getConfigElement() {
    return document.createElement("todo-overlay-card-editor");
  }
  // Called by the card picker when this card is first added to a
  // dashboard, so it starts from a usable config rather than an empty
  // one the editor would immediately complain about. HA's own call
  // signature for this varies by version (some pass only `hass`), so
  // every parameter here is optional and this falls back to scanning
  // hass.states directly if entities/entitiesFallback come back empty.
  static getStubConfig(hass, entities = [], entitiesFallback = []) {
    const isTodoEntity = (entityId) => entityId.startsWith("todo.");
    const fromStates = hass ? Object.keys(hass.states).filter(isTodoEntity) : [];
    const entity = entities.find(isTodoEntity) ?? entitiesFallback.find(isTodoEntity) ?? fromStates[0] ?? "";
    return { entity };
  }
  render() {
    const entityIds = this.config.entities?.length ? this.config.entities : this.config.entity ? [this.config.entity] : [];
    const isMulti = entityIds.length > 1;
    const cardHeader = isMulti ? this.config.title : void 0;
    const entityTitle = (entityId) => isMulti ? friendlyName(this.hass, entityId) : this.config.title ?? "Todo Overlay";
    return b2`
            <ha-card header=${cardHeader || A}>
                ${entityIds.map((entityId) => b2`
                    <div class="entity-section">
                        <todo-overlay-list
                            .hass=${this.hass}
                            .entity=${entityId}
                            .headerTitle=${entityTitle(entityId)}
                            .hideCompleteForParents=${this.config.hide_complete_for_parents ?? true}
                            .showCheckboxes=${this.config.show_checkboxes ?? false}
                            .sortBy=${this.config.sort_by ?? "manual"}
                            .sortOrder=${this.config.sort_order ?? "asc"}
                            .showClearButton=${this.config.show_clear_completed_button ?? true}
                            .showSaveLoadButtons=${this.config.show_save_load_buttons ?? true}
                            .showQuickAdd=${this.config.show_quick_add ?? true}
                            .confirmDelete=${this.config.confirm_delete ?? true}
                            .showFilterMenu=${this.config.show_filter_menu ?? false}
                            .showReorderToggle=${this.config.show_reorder_toggle ?? true}
                            .moveCompletedItems=${this.config.move_completed_items ?? false}
                            .dragGhostStyle=${this.config.drag_ghost_style ?? "label"}
                        ></todo-overlay-list>
                    </div>
                `)}
            </ha-card>
        `;
  }
};
TodoOverlayCard.styles = i`
        .entity-section + .entity-section {
            border-top: 1px solid var(--divider-color);
        }
    `;
__decorateClass([
  n4({ attribute: false })
], TodoOverlayCard.prototype, "hass", 2);
__decorateClass([
  n4()
], TodoOverlayCard.prototype, "config", 2);
TodoOverlayCard = __decorateClass([
  t3("todo-overlay-card")
], TodoOverlayCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "todo-overlay-card",
  name: "Todo Overlay",
  description: "Hierarchical overlay for a Home Assistant Todo list."
});
export {
  TodoOverlayCard
};
/*! Bundled license information:

@lit/reactive-element/css-tag.js:
  (**
   * @license
   * Copyright 2019 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)

@lit/reactive-element/reactive-element.js:
lit-html/lit-html.js:
lit-element/lit-element.js:
@lit/reactive-element/decorators/custom-element.js:
@lit/reactive-element/decorators/property.js:
@lit/reactive-element/decorators/state.js:
@lit/reactive-element/decorators/event-options.js:
@lit/reactive-element/decorators/base.js:
@lit/reactive-element/decorators/query.js:
@lit/reactive-element/decorators/query-all.js:
@lit/reactive-element/decorators/query-async.js:
@lit/reactive-element/decorators/query-assigned-nodes.js:
lit-html/directive.js:
  (**
   * @license
   * Copyright 2017 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)

lit-html/is-server.js:
  (**
   * @license
   * Copyright 2022 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)

@lit/reactive-element/decorators/query-assigned-elements.js:
  (**
   * @license
   * Copyright 2021 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)

lit-html/directives/class-map.js:
lit-html/directives/style-map.js:
  (**
   * @license
   * Copyright 2018 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)
*/
