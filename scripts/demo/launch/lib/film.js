(function () {
  const FMT = document.documentElement.dataset.fmt === "v" ? "v" : "h";
  const H = FMT === "h";
  const FRAME = H ? { w: 1920, h: 1080 } : { w: 1080, h: 1920 };
  const SAFE_BOTTOM = H ? 1026 : 1330;

  gsap.config({ force3D: false, nullTargetWarn: false });

  const cues = (window.__filmCues = window.__filmCues || {});
  const fontsReady = Promise.all(
    [...document.fonts].map((f) =>
      f.load().catch((error) => console.warn(`font ${f.family} did not load`, error)),
    ),
  ).then(() => document.fonts.ready);

  function driven(fn, start = 0) {
    let v = start;
    return {
      get v() {
        return v;
      },
      set v(next) {
        v = next;
        fn(next);
      },
    };
  }

  function scene(id, dur, build) {
    const host = document.getElementById(id);
    const root = host.querySelector("[data-hf-inner-root]") || host;
    fontsReady
      .then(() => {
        const tl = gsap.timeline({ paused: true });
        const S = api(root, tl, dur);
        const undisplayed = [];
        for (let el = root; el && el !== document.documentElement; el = el.parentElement) {
          if (getComputedStyle(el).display !== "none") continue;
          undisplayed.push([
            el,
            el.style.getPropertyValue("display"),
            el.style.getPropertyPriority("display"),
          ]);
          el.style.setProperty("display", "block", "important");
        }
        try {
          for (const el of root.querySelectorAll("[data-st]")) S.scroller(el).set(+el.dataset.st);
          build(S);
        } finally {
          for (const [el, value, priority] of undisplayed) {
            if (value) el.style.setProperty("display", value, priority);
            else el.style.removeProperty("display");
          }
        }
        tl.to({}, { duration: 0.001 }, Math.max(0, dur - 0.001));
        const a = +(host.dataset.filmIn ?? 0);
        const b = +(host.dataset.filmOut ?? dur);
        const slot = +(host.dataset.filmSlot ?? b - a);
        const at = (p) => tl.time(Math.max(0.0001, a + (b - a) * p));
        const outer = gsap.timeline({ paused: true });
        outer.to(driven(at), { v: 1, duration: slot, ease: "none" }, 0);
        at(0);
        cues[id] = { start: +(host.dataset.filmStart ?? 0), slot, in: a, out: b, list: S.cues };
        window.__timelines[id] = outer;
      })
      .catch((e) => console.error(`[film] ${id}: ${e.stack || e}`));
  }

  function api(root, tl, dur) {
    const q = (sel) => (typeof sel === "string" ? root.querySelector(sel) : sel);
    const qa = (sel) =>
      typeof sel === "string"
        ? [...root.querySelectorAll(sel)]
        : Array.isArray(sel)
          ? sel.map(q)
          : [sel];
    const list = [];
    const sfx = (t, name, extra) => list.push({ t: +t.toFixed(3), name, ...extra });

    const stageScale = () => root.getBoundingClientRect().width / FRAME.w || 1;
    const rect = (el) => {
      const r = q(el).getBoundingClientRect();
      const o = root.getBoundingClientRect();
      const k = stageScale();
      return { x: (r.left - o.left) / k, y: (r.top - o.top) / k, w: r.width / k, h: r.height / k };
    };

    function camera(camSel) {
      const el = q(camSel);
      const vp = rect(el.parentElement);
      const winEl = el.querySelector(".appwin");
      const win = { w: winEl.offsetWidth, h: winEl.offsetHeight };
      const safeH = Math.min(vp.h, SAFE_BOTTOM - vp.y);
      const hist = [];
      const local = (target) => {
        if (target && typeof target === "object" && "w" in target) return target;
        const r = q(target).getBoundingClientRect();
        const c = el.getBoundingClientRect();
        const k = stageScale() * (gsap.getProperty(el, "scaleX") || 1);
        return {
          x: (r.left - c.left) / k,
          y: (r.top - c.top) / k,
          w: r.width / k,
          h: r.height / k,
        };
      };
      const cam = {
        el,
        vp,
        win,
        local,
        full: () => ({ x: 0, y: 0, scale: vp.w / win.w }),
        frame(target, o = {}) {
          const L = local(target);
          const full = vp.w / win.w;
          let s = o.scale ?? (o.fit ? (vp.w * o.fit) / L.w : full);
          if (o.maxScale) s = Math.min(s, o.maxScale);
          s = Math.max(s, full);
          let x = vp.w * (o.ax ?? 0.5) - (L.x + L.w * (o.px ?? 0.5)) * s + (o.dx ?? 0);
          let y = safeH * (o.ay ?? 0.5) - (L.y + L.h * (o.py ?? 0.5)) * s + (o.dy ?? 0);
          x = Math.min(0, Math.max(vp.w - win.w * s, x));
          y = Math.min(0, Math.max(Math.min(0, vp.h - win.h * s), y));
          return { x, y, scale: s };
        },
        set(f) {
          gsap.set(el, f);
          hist.push({ t: 0, f });
          return cam;
        },
        to(t, f, d = 0.6, ease = "power2.inOut") {
          tl.to(el, { x: f.x, y: f.y, scale: f.scale, duration: d, ease }, t);
          hist.push({ t: t + d, f });
          return t + d;
        },
        at(t) {
          let f = hist[0]?.f ?? { x: 0, y: 0, scale: 1 };
          for (const h of hist) if (h.t <= t + 1e-6) f = h.f;
          return f;
        },
        point(target, t, px = 0.5, py = 0.5) {
          const L = local(target);
          const f = cam.at(t);
          return {
            x: vp.x + f.x + (L.x + L.w * px) * f.scale,
            y: vp.y + f.y + (L.y + L.h * py) * f.scale,
          };
        },
      };
      return cam;
    }

    function listPanel(cam, sidebar, bots) {
      const W = 760;
      const b = cam.local(sidebar);
      const k = W / b.w;
      const list = bots ? cam.local(bots) : null;
      const y = list ? -(list.y - 12) * k : 0;
      const height = list ? Math.min(cam.vp.h, Math.round((list.h + 30) * k)) : cam.vp.h;
      return {
        vp: { left: (FRAME.w - W) / 2, width: W, height },
        cam: { x: -b.x * k, y, scale: k },
        wide: { left: cam.vp.x, width: cam.vp.w, height: cam.vp.h },
      };
    }

    function cursor(sel = ".cursor") {
      const el = q(sel);
      const art = el.firstElementChild;
      const tip = { x: el.offsetWidth * 0.2, y: el.offsetHeight * 0.1 };
      gsap.set(el, { opacity: 0 });
      const cur = {
        el,
        place(p) {
          gsap.set(el, { x: p.x - tip.x, y: p.y - tip.y, opacity: 1 });
          return cur;
        },
        enter(t, from, to, d = 0.7) {
          tl.set(el, { x: from.x - tip.x, y: from.y - tip.y }, t);
          tl.to(el, { opacity: 1, duration: 0.12 }, t);
          return cur.to(t, to, d, "power3.out");
        },
        to(t, p, d = 0.55, ease = "power2.inOut") {
          tl.to(el, { x: p.x - tip.x, y: p.y - tip.y, duration: d, ease }, t);
          return t + d;
        },
        click(t) {
          tl.to(art, { scale: 0.8, duration: 0.07, ease: "power2.in" }, t);
          tl.to(art, { scale: 1, duration: 0.22, ease: "power3.out" }, t + 0.07);
          sfx(t + 0.05, "click");
          return t + 0.07;
        },
        hide(t, d = 0.15) {
          tl.to(el, { opacity: 0, duration: d }, t);
        },
      };
      return cur;
    }

    function tap(sel, t, p) {
      const el = q(sel);
      tl.set(el, { x: p.x, y: p.y }, t - 0.18);
      tl.fromTo(
        el,
        { opacity: 0, scale: 1.5 },
        { opacity: 1, scale: 1, duration: 0.16, ease: "power2.out", immediateRender: false },
        t - 0.16,
      );
      tl.to(el, { opacity: 0, scale: 0.86, duration: 0.2, ease: "power2.in" }, t + 0.06);
      sfx(t + 0.03, "tap");
    }

    const splitWords = (el, cls) => {
      if (el.dataset.split) return [...el.querySelectorAll("." + cls)];
      el.dataset.split = "1";
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const texts = [];
      while (walk.nextNode()) texts.push(walk.currentNode);
      for (const node of texts) {
        if (!node.nodeValue.trim()) continue;
        const frag = document.createDocumentFragment();
        for (const part of node.nodeValue.split(/(\s+)/)) {
          if (!part) continue;
          if (/^\s+$/.test(part)) {
            frag.appendChild(document.createTextNode(part));
            continue;
          }
          const span = document.createElement("span");
          span.className = cls;
          span.textContent = part;
          frag.appendChild(span);
        }
        node.replaceWith(frag);
      }
      return [...el.querySelectorAll("." + cls)];
    };

    function cap(sel, t0, t1) {
      const el = q(sel);
      const words = splitWords(el, "w");
      tl.fromTo(
        words,
        { opacity: 0, filter: "blur(8px)" },
        { opacity: 1, filter: "blur(0px)", duration: 0.16, stagger: 0.07, ease: "power2.out" },
        t0,
      );
      if (t1 != null)
        tl.to(
          words,
          { opacity: 0, filter: "blur(6px)", duration: 0.18, ease: "power2.in" },
          t1 - 0.18,
        );
    }

    const scrollers = new Map();
    function scroller(target) {
      const el = q(target);
      if (scrollers.has(el)) return scrollers.get(el);
      const content = el.firstElementChild;
      const max = Math.max(0, el.scrollHeight - el.clientHeight);
      el.scrollTop = 0;
      el.style.overflow = "hidden";
      const sc = {
        el,
        max,
        value: 0,
        set(v) {
          sc.value = Math.max(0, Math.min(max, v));
          gsap.set(content, { y: -sc.value });
          return sc;
        },
        to(t, v, d = 0.6, ease = "power2.inOut") {
          sc.value = Math.max(0, Math.min(max, v));
          tl.to(content, { y: -sc.value, duration: d, ease }, t);
          return t + d;
        },
      };
      scrollers.set(el, sc);
      return sc;
    }

    const show = (t, target, o = {}) =>
      tl.fromTo(
        qa(target),
        { opacity: 0, y: o.y ?? 8, ...o.from },
        {
          opacity: 1,
          y: 0,
          duration: o.d ?? 0.3,
          ease: o.ease ?? "power3.out",
          stagger: o.stagger,
          ...o.to,
        },
        t,
      );
    const hide = (t, target, o = {}) =>
      tl.to(
        qa(target),
        { opacity: 0, duration: o.d ?? 0.18, ease: "power2.in", stagger: o.stagger, ...o.to },
        t,
      );

    function stream(t, target, d = 1.2) {
      const words = qa(target).flatMap((el) => splitWords(el, "sw"));
      if (!words.length) return t;
      const each = Math.min(0.09, d / words.length);
      tl.fromTo(
        words,
        { opacity: 0 },
        { opacity: 1, duration: 0.1, stagger: each, ease: "none" },
        t,
      );
      return t + each * words.length + 0.1;
    }

    function type(t, target, text, o = {}) {
      const el = q(target);
      const d = text.length / (o.cps ?? 26);
      const put = (s) => ("value" in el ? (el.value = s) : (el.textContent = s));
      const st = driven((n) => put(text.slice(0, Math.round(n))));
      tl.to(st, { v: text.length, duration: d, ease: "none" }, t);
      sfx(t, "type", { d: +d.toFixed(3) });
      return t + d;
    }

    function swap(t, from, to, d = 0.16) {
      if (from) tl.to(qa(from), { autoAlpha: 0, duration: d, ease: "none" }, t);
      tl.fromTo(qa(to), { autoAlpha: 0 }, { autoAlpha: 1, duration: d, ease: "none" }, t);
    }

    function press(t, target) {
      const el = q(target);
      tl.to(el, { filter: "brightness(0.9)", duration: 0.07 }, t);
      tl.to(el, { filter: "brightness(1)", duration: 0.2 }, t + 0.07);
    }

    return {
      root,
      tl,
      dur,
      q,
      qa,
      rect,
      camera,
      scroller,
      listPanel,
      cursor,
      tap,
      cap,
      show,
      hide,
      stream,
      type,
      swap,
      press,
      sfx,
      cues: list,
      FMT,
      H,
      FRAME,
    };
  }

  window.Film = { scene, driven, FMT, H, FRAME };
})();
