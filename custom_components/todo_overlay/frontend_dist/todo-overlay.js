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
async function getList(hass, entityId) {
  return await hass.connection.sendMessagePromise({
    type: "todo_overlay/get_list",
    entity_id: entityId
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
async function setCompleted(hass, entityId, itemId, completed) {
  const result = await hass.connection.sendMessagePromise({
    type: "todo_overlay/set_completed",
    entity_id: entityId,
    item_id: itemId,
    completed
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
    tags: fields.tags
  });
  return result.id;
}
async function setQuantity(hass, entityId, itemId, quantity) {
  await hass.connection.sendMessagePromise({
    type: "todo_overlay/set_quantity",
    entity_id: entityId,
    item_id: itemId,
    quantity
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
async function saveList(hass, entityId, name, persistStates) {
  await hass.connection.sendMessagePromise({
    type: "todo_overlay/save_list",
    entity_id: entityId,
    name,
    persist_states: persistStates
  });
}
async function loadList(hass, entityId, name, mode) {
  await hass.connection.sendMessagePromise({
    type: "todo_overlay/load_list",
    entity_id: entityId,
    name,
    mode
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

// src/components/todo-item-dialog.ts
var EMPTY_FORM_VALUE = {
  title: "",
  quantity: "",
  tags: "",
  description: "",
  dueDate: "",
  dueTime: ""
};
var TodoItemDialog = class extends i4 {
  constructor() {
    super(...arguments);
    this.heading = "Item";
    this.value = EMPTY_FORM_VALUE;
    this.fieldSupport = {
      description: false,
      dueDate: false,
      dueDateTime: false
    };
    this.showDelete = false;
  }
  close() {
    this.dispatchEvent(
      new CustomEvent("dialog-close", { bubbles: true, composed: true })
    );
  }
  save() {
    this.dispatchEvent(
      new CustomEvent("dialog-save", {
        detail: this.value,
        bubbles: true,
        composed: true
      })
    );
  }
  requestDelete() {
    this.dispatchEvent(
      new CustomEvent("dialog-delete", { bubbles: true, composed: true })
    );
  }
  updateField(field, fieldValue) {
    this.value = { ...this.value, [field]: fieldValue };
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
                            .value=${this.value.title}
                            @input=${(e7) => this.updateField("title", e7.target.value)}
                        />
                    </div>

                    <div class="field quantity">
                        <label for="todo-item-quantity">Quantity</label>
                        <input
                            id="todo-item-quantity"
                            type="text"
                            placeholder="e.g. 150g"
                            .value=${this.value.quantity}
                            @input=${(e7) => this.updateField("quantity", e7.target.value)}
                        />
                    </div>
                </div>

                ${this.fieldSupport.description ? b2`
                            <div class="field">
                                <label for="todo-item-description">Description</label>
                                <textarea
                                    id="todo-item-description"
                                    .value=${this.value.description}
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
                        .value=${this.value.tags}
                        @input=${(e7) => this.updateField("tags", e7.target.value)}
                    />
                </div>

                ${showDue ? b2`
                            <div class="due-row">
                                <div class="field">
                                    <label for="todo-item-due-date">Due date</label>
                                    <input
                                        id="todo-item-due-date"
                                        type="date"
                                        .value=${this.value.dueDate}
                                        @input=${(e7) => this.updateField(
      "dueDate",
      e7.target.value
    )}
                                    />
                                </div>

                                ${this.fieldSupport.dueDateTime ? b2`
                                            <div class="field">
                                                <label for="todo-item-due-time">Due time</label>
                                                <input
                                                    id="todo-item-due-time"
                                                    type="time"
                                                    .value=${this.value.dueTime}
                                                    @input=${(e7) => this.updateField(
      "dueTime",
      e7.target.value
    )}
                                                />
                                            </div>
                                        ` : ""}
                            </div>
                        ` : ""}

                <div class="actions" slot="footer">
                    ${this.showDelete ? b2`
                                <button class="destructive" @click=${this.requestDelete}>
                                    Delete
                                </button>
                            ` : ""}
                    <button @click=${this.save}>
                        Save
                    </button>
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
            /* Without this, the native calendar/clock picker icons render
               black-on-transparent and vanish against a dark theme. */
            color-scheme: light dark;
        }

        input:focus,
        textarea:focus {
            border-bottom: 2px solid var(--primary-color);
            padding-bottom: 7px;
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
    `;
__decorateClass([
  n4({ attribute: false })
], TodoItemDialog.prototype, "heading", 2);
__decorateClass([
  n4({ attribute: false })
], TodoItemDialog.prototype, "value", 2);
__decorateClass([
  n4({ attribute: false })
], TodoItemDialog.prototype, "fieldSupport", 2);
__decorateClass([
  n4({ type: Boolean })
], TodoItemDialog.prototype, "showDelete", 2);
TodoItemDialog = __decorateClass([
  t3("todo-overlay-item-dialog")
], TodoItemDialog);

// src/components/todo-save-load-dialog.ts
var EMPTY_SAVE_LOAD_VALUE = {
  name: "",
  persistStates: false,
  mode: "merge"
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
    this.value = EMPTY_SAVE_LOAD_VALUE;
    this.savedNames = [];
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
    this.value = { ...this.value, name };
  }
  updatePersistStates(persistStates) {
    this.value = { ...this.value, persistStates };
  }
  updateMode(mode) {
    this.value = { ...this.value, mode };
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
                                    .value=${this.value.name}
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
                                    .checked=${this.value.persistStates}
                                    @change=${(e7) => this.updatePersistStates(e7.target.checked)}
                                />
                                <label for="save-load-persist">Persist completion states</label>
                            </div>
                        ` : b2`
                            <div class="field">
                                <label for="save-load-select">Saved list</label>
                                <select
                                    id="save-load-select"
                                    .value=${this.value.name}
                                    @change=${(e7) => this.updateName(e7.target.value)}
                                >
                                    <option value="" disabled ?selected=${!this.value.name}>
                                        Choose a saved list…
                                    </option>
                                    ${this.savedNames.map(
      (name) => b2`
                                            <option value=${name} ?selected=${this.value.name === name}>
                                                ${name}
                                            </option>
                                        `
    )}
                                </select>
                            </div>

                            ${this.value.name ? b2`
                                        <div class="delete-row">
                                            <button @click=${this.requestDeleteSaved}>
                                                Delete "${this.value.name}"
                                            </button>
                                        </div>
                                    ` : ""}

                            <div class="field">
                                <label for="save-load-mode">Mode</label>
                                <select
                                    id="save-load-mode"
                                    .value=${this.value.mode}
                                    @change=${(e7) => this.updateMode(e7.target.value)}
                                >
                                    ${Object.keys(MODE_LABELS).map(
      (mode) => b2`
                                            <option value=${mode} ?selected=${this.value.mode === mode}>
                                                ${MODE_LABELS[mode]}
                                            </option>
                                        `
    )}
                                </select>
                            </div>
                        `}

                <div class="actions" slot="footer">
                    <button @click=${this.close}>Cancel</button>
                    <button @click=${this.confirm} ?disabled=${!this.value.name}>
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
  n4({ attribute: false })
], TodoSaveLoadDialog.prototype, "value", 2);
__decorateClass([
  n4({ attribute: false })
], TodoSaveLoadDialog.prototype, "savedNames", 2);
TodoSaveLoadDialog = __decorateClass([
  t3("todo-overlay-save-load-dialog")
], TodoSaveLoadDialog);

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

// src/components/todo-tree-item.ts
var BEFORE_AFTER_ZONE = 0.3;
var MOVE_CANCEL_THRESHOLD_PX = 6;
var HOLD_RIPPLE_SIZE = 72;
var holdRippleSizePx = r(`${HOLD_RIPPLE_SIZE}px`);
var CLICK_DEBOUNCE_MS = 250;
var CLOCK_ICON = b2`
    <svg viewBox="0 0 24 24">
        <path
            d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm.5 5v5.4l4.2 2.5-.8 1.3-5-3V7h1.6z"
        ></path>
    </svg>
`;
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
    overdue: !item.completed && dueDay.getTime() < today.getTime()
  };
}
var TodoTreeItem = class extends i4 {
  constructor() {
    super(...arguments);
    this.dragEngaged = false;
    this.pointerDownAt = 0;
    this.hasMoved = false;
    this.onWindowPointerMove = (e7) => {
      if (!this.pointerDownScreenPos || this.dragEngaged) {
        return;
      }
      const dx = e7.clientX - this.pointerDownScreenPos.x;
      const dy = e7.clientY - this.pointerDownScreenPos.y;
      if (Math.hypot(dx, dy) <= MOVE_CANCEL_THRESHOLD_PX) {
        return;
      }
      if (this.holdReady) {
        this.hasMoved = true;
        this.dragEngaged = true;
        this.clearHoldRipple();
        const rowEl = this.shadowRoot?.querySelector(".row");
        const rect = rowEl?.getBoundingClientRect();
        this.dispatchEvent(
          new CustomEvent("tree-drag-start", {
            detail: {
              id: this.item.id,
              rect: rect ? { x: rect.left, y: rect.top, width: rect.width, height: rect.height } : void 0,
              pointerX: e7.clientX,
              pointerY: e7.clientY
            },
            bubbles: true,
            composed: true
          })
        );
      } else {
        this.cancelHoldForMovement();
      }
    };
    this.onWindowPointerUp = () => {
      this.pointerUp();
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
  pointerDown(e7) {
    this.pointerDownAt = Date.now();
    this.pointerDownScreenPos = { x: e7.clientX, y: e7.clientY };
    this.hasMoved = false;
    this.dragEngaged = false;
    const rect = e7.currentTarget.getBoundingClientRect();
    this.holdRippleOrigin = { x: e7.clientX - rect.left, y: e7.clientY - rect.top };
    window.clearTimeout(this.holdTimer);
    this.holdTimer = window.setTimeout(() => {
      this.requestUpdate();
    }, LONG_PRESS_MS);
    window.addEventListener("pointermove", this.onWindowPointerMove, { capture: true });
    window.addEventListener("pointerup", this.onWindowPointerUp, { capture: true });
    window.addEventListener("pointercancel", this.onWindowPointerUp, { capture: true });
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
  detachWindowListeners() {
    window.removeEventListener("pointermove", this.onWindowPointerMove, { capture: true });
    window.removeEventListener("pointerup", this.onWindowPointerUp, { capture: true });
    window.removeEventListener("pointercancel", this.onWindowPointerUp, { capture: true });
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
    if (this.hasMoved || pressDurationMs >= LONG_PRESS_MS) {
      this.emitPointerUp(pressDurationMs, this.hasMoved);
      return;
    }
    window.clearTimeout(this.clickTimer);
    this.clickTimer = window.setTimeout(() => {
      this.emitPointerUp(pressDurationMs, false);
    }, CLICK_DEBOUNCE_MS);
  }
  onDoubleClick() {
    window.clearTimeout(this.clickTimer);
    this.dispatchEvent(
      new CustomEvent("tree-pointer-down", {
        detail: { id: this.item.id },
        bubbles: true,
        composed: true
      })
    );
    this.emitPointerUp(LONG_PRESS_MS);
  }
  render() {
    const isDropTarget = this.isDropTarget;
    const isBeingDragged = this.isBeingDragged;
    const rowClasses = {
      row: true,
      pressed: this.isPressed && !isBeingDragged,
      lifted: isBeingDragged,
      "drop-inside": isDropTarget && this.hoverPlacement === "inside",
      "gap-before": isDropTarget && this.hoverPlacement === "before",
      "gap-after": isDropTarget && this.hoverPlacement === "after",
      completed: this.item.completed
    };
    const due = formatDue(this.item);
    const hasMeta = due || this.item.description || this.item.tags.length > 0;
    return b2`
            <li>

                <div
                    class=${e6(rowClasses)}

                    @pointerdown=${this.pointerDown}
                    @dblclick=${this.onDoubleClick}
                >
                    ${isBeingDragged ? "" : b2`
                                <ha-checkbox .checked=${this.item.completed}></ha-checkbox>

                                <div class="content">
                                    <div class="title-line">
                                        <span class="summary">${this.item.title}</span>
                                        ${this.item.quantity ? b2`<span class="quantity-chip">${this.item.quantity}</span>` : ""}
                                    </div>

                                    ${hasMeta ? b2`
                                                <div class="row-meta">
                                                    ${due ? b2`
                                                                <span class=${e6({ "due-chip": true, overdue: due.overdue })}>
                                                                    ${CLOCK_ICON}${due.label}
                                                                </span>
                                                            ` : ""}
                                                    ${this.item.tags.map((tag) => b2`<span class="tag-chip">${tag}</span>`)}
                                                    ${this.item.description ? b2`<span class="description-text">${this.item.description}</span>` : ""}
                                                </div>
                                            ` : ""}
                                </div>

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

                ${this.item.children.length ? b2`
                            <ul>
                                ${this.item.children.map(
      (child) => b2`
                                        <todo-overlay-tree-item
                                            .item=${child}
                                            .draggedId=${this.draggedId}
                                            .hoverId=${this.hoverId}
                                            .hoverPlacement=${this.hoverPlacement}
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
            padding-inline-start: 32px;
        }

        .row {
            position: relative;
            display: flex;
            align-items: center;
            gap: 12px;
            min-height: 40px;
            padding: 8px 20px;
            border-radius: 4px;
            outline: 2px solid transparent;
            outline-offset: -2px;
            user-select: none;
            cursor: pointer;
            transition: background-color 0.15s ease, outline-color 0.15s ease, margin 150ms ease;
        }

        .row:hover {
            background: rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.06);
        }

        .row.pressed {
            background: rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.12);
        }

        .row.lifted {
            min-height: 10px;
            padding: 4px 20px;
            border-radius: 4px;
            border: 1px dashed var(--divider-color);
            background: rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.03);
            cursor: grabbing;
        }

        .row.drop-inside {
            outline-color: var(--accent-color, var(--primary-color));
            background: rgba(var(--rgb-accent-color, 255, 152, 0), 0.08);
        }

        /* Instead of a static line, the sibling next to the drop point
           opens a live gap (matching the space a lifted row leaves
           behind), so the list visibly reflows to show where the item
           would land rather than just marking the spot. */
        .row.gap-before {
            margin-top: 52px;
        }

        .row.gap-after {
            margin-bottom: 52px;
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

        ha-checkbox {
            pointer-events: none;
            flex-shrink: 0;
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
  r5()
], TodoTreeItem.prototype, "holdRippleOrigin", 2);
__decorateClass([
  r5()
], TodoTreeItem.prototype, "dragEngaged", 2);
TodoTreeItem = __decorateClass([
  t3("todo-overlay-tree-item")
], TodoTreeItem);

// src/components/todo-tree.ts
var TodoTree = class extends i4 {
  constructor() {
    super(...arguments);
    this.items = [];
  }
  render() {
    return b2`
            <ul>
                ${this.items.map(
      (item) => b2`
                        <todo-overlay-tree-item
                            .item=${item}
                            .draggedId=${this.draggedId}
                            .hoverId=${this.hoverId}
                            .hoverPlacement=${this.hoverPlacement}
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
TodoTree = __decorateClass([
  t3("todo-overlay-tree")
], TodoTree);

// src/todo-overlay.ts
function deepElementFromPoint(x2, y3) {
  let el = document.elementFromPoint(x2, y3);
  while (el && el.shadowRoot) {
    const inner = el.shadowRoot.elementFromPoint(x2, y3);
    if (!inner || inner === el) {
      break;
    }
    el = inner;
  }
  return el;
}
function closestAcrossShadowRoots(start, selector) {
  let current = start;
  while (current) {
    const found = current.closest(selector);
    if (found) {
      return found;
    }
    const root = current.getRootNode();
    current = root instanceof ShadowRoot ? root.host : null;
  }
  return null;
}
function hitTestRow(x2, y3) {
  const el = deepElementFromPoint(x2, y3);
  const itemEl = closestAcrossShadowRoots(el, "todo-overlay-tree-item");
  if (!itemEl?.item) {
    return void 0;
  }
  const rowEl = itemEl.shadowRoot?.querySelector(".row");
  const rect = (rowEl ?? itemEl).getBoundingClientRect();
  const relativeY = (y3 - rect.top) / rect.height;
  let placement;
  if (relativeY < BEFORE_AFTER_ZONE) {
    placement = "before";
  } else if (relativeY > 1 - BEFORE_AFTER_ZONE) {
    placement = "after";
  } else {
    placement = "inside";
  }
  return { id: itemEl.item.id, placement };
}
var UNDO_TIMEOUT_MS = 8e3;
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
function splitDueDateTime(iso) {
  if (!iso) {
    return { date: "", time: "" };
  }
  const [date, time] = iso.split("T");
  return { date: date ?? "", time: (time ?? "").slice(0, 5) };
}
var TodoOverlayCard = class extends i4 {
  constructor() {
    super(...arguments);
    this.dragGhostOffset = { x: 0, y: 0 };
    this.quickAddValue = "";
    this.saveLoadValue = EMPTY_SAVE_LOAD_VALUE;
    this.savedNames = [];
    this.onGlobalPointerMove = (e7) => {
      this.ghostPosition = { x: e7.clientX, y: e7.clientY };
      const hit = hitTestRow(e7.clientX, e7.clientY);
      this.hoverId = hit && hit.id !== this.draggedId ? hit.id : void 0;
      this.hoverPlacement = hit && hit.id !== this.draggedId ? hit.placement : void 0;
    };
    this.onGlobalPointerUp = async () => {
      window.removeEventListener("pointermove", this.onGlobalPointerMove, { capture: true });
      window.removeEventListener("pointerup", this.onGlobalPointerUp, { capture: true });
      window.removeEventListener("pointercancel", this.onGlobalPointerUp, { capture: true });
      const draggedId = this.draggedId;
      const hoverId = this.hoverId;
      const hoverPlacement = this.hoverPlacement;
      this.ghostPosition = void 0;
      this.draggedId = void 0;
      this.hoverId = void 0;
      this.hoverPlacement = void 0;
      if (draggedId && hoverId && draggedId !== hoverId) {
        try {
          await moveItem(
            this.hass,
            this.config.entity,
            draggedId,
            hoverId,
            hoverPlacement ?? "inside"
          );
          await this.load();
        } catch (err) {
          this.error = err instanceof Error ? err.message : String(err);
        }
      }
    };
  }
  setConfig(config) {
    if (!config.entity) {
      throw new Error("todo-overlay-card: 'entity' is required");
    }
    this.config = config;
  }
  updated(changed) {
    if (!changed.has("hass") || !this.hass || !this.config) {
      return;
    }
    const entityUpdate = this.hass.states[this.config.entity]?.last_updated;
    const entityChanged = entityUpdate !== void 0 && entityUpdate !== this.lastEntityUpdate;
    this.lastEntityUpdate = entityUpdate;
    if (!this.list && !this.error) {
      this.load();
    } else if (entityChanged) {
      this.load();
    }
  }
  async load() {
    try {
      this.list = await getList(
        this.hass,
        this.config.entity
      );
      this.error = void 0;
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    }
  }
  get fieldSupport() {
    const supportedFeatures = this.hass.states[this.config.entity]?.attributes.supported_features;
    return {
      description: supportsFeature(supportedFeatures, TodoListEntityFeature.SET_DESCRIPTION_ON_ITEM),
      dueDate: supportsFeature(supportedFeatures, TodoListEntityFeature.SET_DUE_DATE_ON_ITEM),
      dueDateTime: supportsFeature(supportedFeatures, TodoListEntityFeature.SET_DUE_DATETIME_ON_ITEM)
    };
  }
  // --- drag / tap / hold ---------------------------------------------
  //
  // A drag only ever reaches the "live" ghost-follow stage below once
  // the item's own hold threshold has been reached AND the pointer
  // then moves (see todo-tree-item.ts) - so a quick swipe on mobile
  // still scrolls the page normally, and only a sustained hold-then-
  // move actually picks an item up. Once that happens, this component
  // takes over entirely via window-level listeners and its own
  // hit-testing (hitTestRow), rather than relying on the dragged
  // item's own bubbled events for hover detection.
  onPointerDown(e7) {
    this.draggedId = e7.detail.id;
  }
  onDragStart(e7) {
    const { rect, pointerX, pointerY } = e7.detail;
    this.dragGhostOffset = rect ? { x: pointerX - rect.x, y: pointerY - rect.y } : { x: 0, y: 0 };
    this.dragGhostSize = rect ? { width: rect.width, height: rect.height } : void 0;
    this.ghostPosition = { x: pointerX, y: pointerY };
    window.addEventListener("pointermove", this.onGlobalPointerMove, { capture: true });
    window.addEventListener("pointerup", this.onGlobalPointerUp, { capture: true });
    window.addEventListener("pointercancel", this.onGlobalPointerUp, { capture: true });
  }
  async onPointerUp(e7) {
    if (!e7.detail.moved && this.draggedId && this.list) {
      const item = findItem(this.list.items, this.draggedId);
      if (item) {
        const pressDurationMs = e7.detail.pressDurationMs;
        if (pressDurationMs < LONG_PRESS_MS) {
          await this.toggleComplete(item);
        } else {
          this.openEditDialog(item);
        }
      }
    }
    this.draggedId = void 0;
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("pointermove", this.onGlobalPointerMove, { capture: true });
    window.removeEventListener("pointerup", this.onGlobalPointerUp, { capture: true });
    window.removeEventListener("pointercancel", this.onGlobalPointerUp, { capture: true });
  }
  // --- completion + cascade undo --------------------------------------
  async toggleComplete(item) {
    try {
      const changes = await setCompleted(
        this.hass,
        this.config.entity,
        item.id,
        !item.completed
      );
      await this.load();
      if (changes.length > 1) {
        this.showUndo(
          `Marked ${changes.length} items ${!item.completed ? "complete" : "incomplete"}`,
          changes
        );
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
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
      await restoreCompleted(this.hass, this.config.entity, this.undoState.changes);
      await this.load();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    }
    this.undoState = void 0;
  }
  async onClearCompleted() {
    try {
      await clearCompleted(this.hass, this.config.entity);
      await this.load();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    }
  }
  // --- save / load ---------------------------------------------------
  async openSaveDialog() {
    try {
      this.savedNames = await listSaved(this.hass);
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      return;
    }
    this.saveLoadValue = EMPTY_SAVE_LOAD_VALUE;
    this.saveLoadAction = "save";
  }
  async openLoadDialog() {
    try {
      this.savedNames = await listSaved(this.hass);
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      return;
    }
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
        await saveList(this.hass, this.config.entity, value.name, value.persistStates);
      } else {
        await loadList(this.hass, this.config.entity, value.name, value.mode);
      }
      await this.load();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    }
    this.closeSaveLoadDialog();
  }
  async onSaveLoadDeleteSaved(e7) {
    try {
      await deleteSavedList(this.hass, e7.detail.name);
      this.savedNames = await listSaved(this.hass);
      this.saveLoadValue = { ...this.saveLoadValue, name: "" };
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    }
  }
  // --- add / edit / delete dialog --------------------------------------
  openEditDialog(item) {
    this.dialogMode = "edit";
    this.dialogItem = item;
  }
  openCreateDialog() {
    this.dialogMode = "create";
    this.dialogItem = void 0;
  }
  closeDialog() {
    this.dialogMode = void 0;
    this.dialogItem = void 0;
  }
  dialogValue() {
    if (this.dialogMode === "edit" && this.dialogItem) {
      const due = this.dialogItem.due_datetime ? splitDueDateTime(this.dialogItem.due_datetime) : { date: this.dialogItem.due_date ?? "", time: "" };
      return {
        title: this.dialogItem.title,
        quantity: this.dialogItem.quantity ?? "",
        tags: this.dialogItem.tags.join(", "),
        description: this.dialogItem.description ?? "",
        dueDate: due.date,
        dueTime: due.time
      };
    }
    return EMPTY_FORM_VALUE;
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
    try {
      if (this.dialogMode === "edit" && this.dialogItem) {
        const serviceData = {
          entity_id: this.config.entity,
          item: this.dialogItem.id,
          rename: value.title
        };
        if (description !== void 0) {
          serviceData.description = description;
        }
        if (dueDatetime) {
          serviceData.due_datetime = dueDatetime;
        } else if (dueDate) {
          serviceData.due_date = dueDate;
        }
        await this.hass.callService("todo", "update_item", serviceData);
        await setQuantity(this.hass, this.config.entity, this.dialogItem.id, quantity);
        await setTags(this.hass, this.config.entity, this.dialogItem.id, tags);
      } else {
        await createItem(this.hass, this.config.entity, {
          title: value.title,
          description,
          dueDate,
          dueDatetime,
          quantity,
          tags
        });
      }
      await this.load();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    }
    this.closeDialog();
  }
  async onDialogDelete() {
    if (!this.dialogItem) {
      return;
    }
    try {
      await this.hass.callService("todo", "remove_item", {
        entity_id: this.config.entity,
        item: this.dialogItem.id
      });
      await this.load();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    }
    this.closeDialog();
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
      await this.hass.callService("todo", "add_item", {
        entity_id: this.config.entity,
        item: title
      });
      this.quickAddValue = "";
      await this.load();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    }
  }
  renderTree(list) {
    const completedItems = list.items.filter((item) => item.completed);
    if (completedItems.length === 0) {
      return b2`
                <todo-overlay-tree
                    .items=${list.items}
                    .draggedId=${this.draggedId}
                    .hoverId=${this.hoverId}
                    .hoverPlacement=${this.hoverPlacement}

                    @tree-pointer-down=${this.onPointerDown}
                    @tree-drag-start=${this.onDragStart}
                    @tree-pointer-up=${this.onPointerUp}

                ></todo-overlay-tree>
            `;
    }
    const activeItems = list.items.filter((item) => !item.completed);
    return b2`
            ${activeItems.length ? b2`
                        <div class="section-header">Active</div>
                        <todo-overlay-tree
                            .items=${activeItems}
                            .draggedId=${this.draggedId}
                            .hoverId=${this.hoverId}
                            .hoverPlacement=${this.hoverPlacement}

                            @tree-pointer-down=${this.onPointerDown}
                            @tree-drag-start=${this.onDragStart}
                            @tree-pointer-up=${this.onPointerUp}

                        ></todo-overlay-tree>
                    ` : ""}

            <div class="section-header">
                <span>Completed</span>
                <button class="clear-completed" @click=${this.onClearCompleted}>
                    Clear completed
                </button>
            </div>
            <todo-overlay-tree
                .items=${completedItems}
                .draggedId=${this.draggedId}
                .hoverId=${this.hoverId}
                .hoverPlacement=${this.hoverPlacement}

                @tree-pointer-down=${this.onPointerDown}
                @tree-drag-start=${this.onDragStart}
                @tree-pointer-up=${this.onPointerUp}

            ></todo-overlay-tree>
        `;
  }
  renderDragGhost() {
    if (!this.ghostPosition || !this.draggedId || !this.list) {
      return "";
    }
    const item = findItem(this.list.items, this.draggedId);
    if (!item) {
      return "";
    }
    const left = this.ghostPosition.x - this.dragGhostOffset.x;
    const top = this.ghostPosition.y - this.dragGhostOffset.y;
    return b2`
            <div
                class="drag-ghost"
                style=${o6({
      left: `${left}px`,
      top: `${top}px`,
      width: this.dragGhostSize ? `${this.dragGhostSize.width}px` : void 0
    })}
            >
                <ha-checkbox .checked=${item.completed}></ha-checkbox>
                <span class="drag-ghost-title">${item.title}</span>
                ${item.quantity ? b2`<span class="drag-ghost-quantity">${item.quantity}</span>` : ""}
            </div>
        `;
  }
  render() {
    return b2`
            <ha-card header="Todo Overlay">

                <div class="list-actions">
                    <button @click=${this.openSaveDialog}>Save list</button>
                    <button @click=${this.openLoadDialog}>Load list</button>
                </div>

                <div class="quick-add">
                    <input
                        type="text"
                        placeholder="Add item"
                        .value=${this.quickAddValue}
                        @input=${this.onQuickAddInput}
                        @keydown=${this.onQuickAddKeydown}
                    />
                    <button class="add" @click=${this.submitQuickAdd}>
                        Add
                    </button>
                    <button class="details" @click=${this.openCreateDialog}>
                        Details…
                    </button>
                </div>

                ${this.error ? b2`
                            <div style="padding:16px; color: var(--error-color)">
                                ${this.error}
                            </div>
                        ` : this.list ? this.renderTree(this.list) : b2`
                                <div style="padding:16px">
                                    Loading...
                                </div>
                            `}

            </ha-card>

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
                            .value=${this.dialogValue()}
                            .fieldSupport=${this.fieldSupport}
                            ?showDelete=${this.dialogMode === "edit"}

                            @dialog-close=${this.closeDialog}
                            @dialog-save=${this.onDialogSave}
                            @dialog-delete=${this.onDialogDelete}
                        ></todo-overlay-item-dialog>
                    ` : ""}

            ${this.saveLoadAction ? b2`
                        <todo-overlay-save-load-dialog
                            .action=${this.saveLoadAction}
                            .value=${this.saveLoadValue}
                            .savedNames=${this.savedNames}

                            @dialog-close=${this.closeSaveLoadDialog}
                            @dialog-confirm=${this.onSaveLoadConfirm}
                            @dialog-delete-saved=${this.onSaveLoadDeleteSaved}
                        ></todo-overlay-save-load-dialog>
                    ` : ""}

            ${this.renderDragGhost()}
        `;
  }
};
TodoOverlayCard.styles = i`
        .quick-add {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 4px 20px 12px;
            font-family: Roboto, "Noto Sans", sans-serif;
        }

        .quick-add input {
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

        .quick-add input:focus {
            border-bottom: 2px solid var(--primary-color);
            padding-bottom: 5px;
        }

        .quick-add button {
            border: none;
            background: none;
            font-family: inherit;
            cursor: pointer;
        }

        .list-actions {
            display: flex;
            justify-content: flex-end;
            gap: 16px;
            padding: 8px 20px 0;
        }

        .list-actions button {
            border: none;
            background: none;
            font-family: Roboto, "Noto Sans", sans-serif;
            font-size: 12px;
            color: var(--secondary-text-color);
            cursor: pointer;
            padding: 4px;
        }

        .quick-add .add {
            color: var(--primary-color);
            font-weight: 500;
        }

        .quick-add .details {
            color: var(--secondary-text-color);
            font-size: 12px;
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

        .section-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 16px 20px 4px;
            font-family: Roboto, "Noto Sans", sans-serif;
            font-size: 14px;
            font-weight: 500;
            color: var(--secondary-text-color);
        }

        .section-header .clear-completed {
            border: none;
            background: none;
            color: var(--primary-color);
            font-family: inherit;
            font-size: 12px;
            font-weight: 500;
            cursor: pointer;
            padding: 4px;
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
    `;
__decorateClass([
  n4({ attribute: false })
], TodoOverlayCard.prototype, "hass", 2);
__decorateClass([
  n4()
], TodoOverlayCard.prototype, "config", 2);
__decorateClass([
  r5()
], TodoOverlayCard.prototype, "list", 2);
__decorateClass([
  r5()
], TodoOverlayCard.prototype, "error", 2);
__decorateClass([
  r5()
], TodoOverlayCard.prototype, "draggedId", 2);
__decorateClass([
  r5()
], TodoOverlayCard.prototype, "hoverId", 2);
__decorateClass([
  r5()
], TodoOverlayCard.prototype, "hoverPlacement", 2);
__decorateClass([
  r5()
], TodoOverlayCard.prototype, "ghostPosition", 2);
__decorateClass([
  r5()
], TodoOverlayCard.prototype, "dialogMode", 2);
__decorateClass([
  r5()
], TodoOverlayCard.prototype, "dialogItem", 2);
__decorateClass([
  r5()
], TodoOverlayCard.prototype, "quickAddValue", 2);
__decorateClass([
  r5()
], TodoOverlayCard.prototype, "undoState", 2);
__decorateClass([
  r5()
], TodoOverlayCard.prototype, "saveLoadAction", 2);
__decorateClass([
  r5()
], TodoOverlayCard.prototype, "saveLoadValue", 2);
__decorateClass([
  r5()
], TodoOverlayCard.prototype, "savedNames", 2);
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

lit-html/directives/style-map.js:
lit-html/directives/class-map.js:
  (**
   * @license
   * Copyright 2018 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)
*/
