/* S8 デッキの操作
   → / Space / Enter / PageDown : 次へ（.st があれば1つずつ点灯）
   ← / PageUp / Backspace     : 前へ
   Home / End : 最初 / 最後　　P : 発表者ビュー　　F : 全画面
   印刷（⌘P）: 全枚を PDF に。URL に ?dist を付けて印刷すると、悪い例の画像を外した配布用になる
   埋め込み資料をめくった後は、枠の外を1回クリックすると ← → がデッキに戻る */
(function () {
  'use strict';
  var slides = [].slice.call(document.querySelectorAll('.slide'));
  var N = slides.length, i = 0, step = 0, presenter = null;
  if (/[?&]dist\b/.test(location.search)) document.body.classList.add('dist');
  if (/[?&]all\b/.test(location.search)) { document.body.classList.add('all'); }
  if (/[?&]sheet\b/.test(location.search)) {
    document.body.classList.add('sheet');
    [].forEach.call(document.querySelectorAll('.embed iframe'), function (f) { f.remove(); });
    var q = new URLSearchParams(location.search), from = +(q.get('from') || 1), to = +(q.get('to') || 999);
    slides.forEach(function (s, k) { if (k + 1 < from || k + 1 > to) s.style.display = 'none'; });
  }

  // ページ番号（.pno がある枚だけ、通し番号を入れる）
  slides.forEach(function (s, k) { var p = s.querySelector('.pno'); if (p) p.textContent = String(k + 1); });

  // 届いていない画像は、オレンジの点線枠に差し替える（alt が発注メモ）
  [].forEach.call(document.querySelectorAll('.shot img'), function (img) {
    function miss() {
      var d = document.createElement('div');
      d.className = 'ph-missing';
      d.innerHTML = '素材待ち<small>' + (img.getAttribute('alt') || '') + '<br>' + img.getAttribute('src') + '</small>';
      img.replaceWith(d);
    }
    if (img.complete && img.naturalWidth === 0) miss(); else img.addEventListener('error', miss);
  });

  function steps(s) { return [].slice.call(s.querySelectorAll('.st')); }
  function scale() {
    var k = Math.min(innerWidth / 1280, innerHeight / 720);
    slides.forEach(function (s) { s.style.transform = 'scale(' + k + ')'; });
  }
  var shown = -1;
  function paint() {
    slides.forEach(function (s, k) { s.classList.toggle('on', k === i); });
    if (shown !== i) { shown = i; document.dispatchEvent(new CustomEvent('deck:slide', { detail: { index: i, slide: slides[i] } })); }  // 枚が変わった合図（OHYA の見本の動きが使う）
    steps(slides[i]).forEach(function (e, k) { e.classList.toggle('on', k < step); });
    if (location.hash !== '#' + (i + 1)) history.replaceState(null, '', '#' + (i + 1));
    hud();
    if (presenter) presenter.render();
  }
  function go(n, full) {
    i = Math.max(0, Math.min(N - 1, n));
    step = full ? steps(slides[i]).length : 0;
    paint();
  }
  function next() { if (step < steps(slides[i]).length) { step++; paint(); } else if (i < N - 1) go(i + 1); }
  function prev() { if (step > 0) { step--; paint(); } else if (i > 0) go(i - 1, true); }

  var hudEl = document.createElement('div'); hudEl.className = 'hud'; document.body.appendChild(hudEl);
  var hudT = null;
  function hud() { hudEl.textContent = (i + 1) + ' / ' + N; hudEl.classList.add('on'); clearTimeout(hudT); hudT = setTimeout(function () { hudEl.classList.remove('on'); }, 1600); }

  // 資料のページめくり（PDF を画像にしたもの）：‹ › でめくる、⤢ で全画面（全画面では ← → でめくり Esc で戻る）
  function vPad(n) { return ('00' + n).slice(-3); }
  function vShow(v, n) {
    var max = +v.getAttribute('data-n');
    n = Math.max(1, Math.min(max, n));
    v._p = n;
    var dir = v.getAttribute('data-dir');
    v.querySelector('.vimg').src = dir + '/p' + vPad(n) + '.jpg';
    v.querySelector('.vpage').textContent = n + ' / ' + max;
    [n - 1, n + 1].forEach(function (k) { if (k >= 1 && k <= max) { var im = new Image(); im.src = dir + '/p' + vPad(k) + '.jpg'; } });
    if (zoomOv && zoomOv._v === v) zoomOv.querySelector('img').src = v.querySelector('.vimg').src;
  }
  [].forEach.call(document.querySelectorAll('.viewer'), function (v) { v._p = +v.getAttribute('data-start') || 1; });

  // 画像をクリックすると大きく表示（もう一度クリックか Esc で戻る）
  var zoomOv = null;
  function closeZoom() { if (zoomOv) { zoomOv.remove(); zoomOv = null; } }
  function openZoom(src, v) {
    zoomOv = document.createElement('div'); zoomOv.className = 'zoom-ov';
    var big = document.createElement('img'); big.src = src; zoomOv.appendChild(big);
    if (v) { zoomOv._v = v; var hint = document.createElement('p'); hint.className = 'zoom-hint'; hint.textContent = '← → でめくる　Esc で戻る'; zoomOv.appendChild(hint); }
    document.body.appendChild(zoomOv);
  }
  // 動画：押すと、この画面の中に小窓（ポップアップ）を開いて再生する
  //   data-title / data-sub … 小窓の上に出す日本語の題と、出どころ
  //   data-mp4  … 手元の動画をそのまま再生
  //   data-yt   … YouTube の動画 ID。data-segs="0-12.4,36.8-98" で流す場面をつなぐ。data-cues に字幕（JSON を入れた script の id）
  //   YouTube は、ファイルを直接開いていると「エラー153」で再生できないので、その時は小窓に案内を出す（S8デッキを開く.app から開けば再生できる）
  var vidOv = null, vidTimer = null, ytPlayer = null, ytQueue = [];
  function esc(t) { return String(t || '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function closeVideo() {
    if (vidTimer) { clearInterval(vidTimer); vidTimer = null; }
    if (ytPlayer && ytPlayer.destroy) { try { ytPlayer.destroy(); } catch (e) {} }
    ytPlayer = null;
    if (vidOv) { vidOv.remove(); vidOv = null; }
  }
  // S10 で追加：data-inline の付いた手元の動画は、小窓を開かずにスライドの中でそのまま流す
  //   data-segs の場面を順に一続きで流し、data-cues の字幕を動画の上に出す
  //   同じ枚の [data-seg="k"] は、k 番目の場面を流している間だけ .now になる（右側の要点が光る）
  //   枚をめくると止まり、元の静止画に戻る
  var inl = null;
  function stopInline() {
    if (!inl) return;
    clearInterval(inl.timer);
    try { inl.v.pause(); } catch (e) {}
    inl.el.innerHTML = inl.html; inl.el.classList.remove('playing');
    [].forEach.call(inl.items, function (it) { it.classList.remove('now'); });
    inl = null;
  }
  function playInline(el) {
    stopInline();
    var segs = (el.getAttribute('data-segs') || '').split(',').filter(Boolean).map(function (x) { var a = x.split('-'); return { s: +a[0], e: +a[1] }; });
    var cues = []; var cueEl = el.getAttribute('data-cues') && document.getElementById(el.getAttribute('data-cues'));
    if (cueEl) { try { cues = JSON.parse(cueEl.textContent); } catch (e) {} }
    var html = el.innerHTML, slide = el.closest('.slide'), items = slide ? slide.querySelectorAll('[data-seg]') : [];
    el.classList.add('playing');
    el.innerHTML = '<video src="' + esc(el.getAttribute('data-mp4')) + (segs.length ? '#t=' + segs[0].s : '') + '" controls autoplay playsinline></video><p class="icap"></p>';
    var v = el.querySelector('video'), cap = el.querySelector('.icap'), k = 0;
    if (segs.length) v.addEventListener('loadedmetadata', function () { if (v.currentTime < segs[0].s - 0.5) v.currentTime = segs[0].s; });
    inl = { el: el, html: html, v: v, items: items, timer: setInterval(function () {
      var t = v.currentTime;
      if (segs.length && t >= segs[k].e) { if (k + 1 < segs.length) { k++; v.currentTime = segs[k].s; } else { v.pause(); } }
      [].forEach.call(items, function (it) { it.classList.toggle('now', +it.getAttribute('data-seg') === k); });
      var c = null; for (var i = 0; i < cues.length; i++) if (t >= cues[i][0] && t < cues[i][1]) { c = cues[i][2]; break; }
      cap.textContent = c || ''; cap.style.visibility = c ? 'visible' : 'hidden';
    }, 150) };
  }
  document.addEventListener('deck:slide', stopInline);
  function loadYT(cb) {
    if (window.YT && window.YT.Player) { cb(); return; }
    ytQueue.push(cb);
    if (ytQueue.length > 1) return;
    var prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = function () { if (prev) prev(); var q = ytQueue; ytQueue = []; q.forEach(function (f) { f(); }); };
    var sc = document.createElement('script'); sc.src = 'https://www.youtube.com/iframe_api'; document.head.appendChild(sc);
  }
  function openVideo(el) {
    var id = el.getAttribute('data-yt'), st = parseInt(el.getAttribute('data-start'), 10) || 0, mp4 = el.getAttribute('data-mp4');
    var title = el.getAttribute('data-title') || '', sub = el.getAttribute('data-sub') || '';
    var segs = (el.getAttribute('data-segs') || '').split(',').filter(Boolean).map(function (x) { var a = x.split('-'); return { s: +a[0], e: +a[1] }; });
    var cues = []; var cueEl = el.getAttribute('data-cues') && document.getElementById(el.getAttribute('data-cues'));
    if (cueEl) { try { cues = JSON.parse(cueEl.textContent); } catch (e) {} }
    vidOv = document.createElement('div'); vidOv.className = 'vid-ov';
    vidOv.innerHTML = '<div class="vbox">' + (title ? '<div class="vhead"><p class="vt">' + esc(title) + '</p>' + (sub ? '<p class="vs">' + esc(sub) + '</p>' : '') + '</div>' : '') +
      '<div class="vframe"><div class="vplayer"></div><p class="vcap"></p></div><p class="vhint">Esc か ← → で閉じる</p></div>';
    document.body.appendChild(vidOv);
    var frame = vidOv.querySelector('.vplayer'), cap = vidOv.querySelector('.vcap');
    if (mp4) {   // S10 で追加：手元の動画でも data-segs（流す場面）と data-cues（字幕）を使えるようにした
      frame.innerHTML = '<video src="' + esc(mp4) + '" controls autoplay playsinline></video>';
      var mv = frame.querySelector('video'), mk = 0;
      if (segs.length) mv.addEventListener('loadedmetadata', function () { mv.currentTime = segs[0].s; });
      if (segs.length || cues.length) vidTimer = setInterval(function () {
        var t = mv.currentTime;
        if (segs.length && t >= segs[mk].e) { if (mk + 1 < segs.length) { mk++; mv.currentTime = segs[mk].s; } else { mv.pause(); } }
        var c = null; for (var i = 0; i < cues.length; i++) if (t >= cues[i][0] && t < cues[i][1]) { c = cues[i][2]; break; }
        cap.textContent = c || ''; cap.style.visibility = c ? 'visible' : 'hidden';
      }, 150);
      return;
    }
    if (!id) return;
    var watch = 'https://www.youtube.com/watch?v=' + id + '&t=' + (segs.length ? Math.floor(segs[0].s) : st) + 's';
    if (!/^https?:$/.test(location.protocol)) {
      frame.innerHTML = '<div class="voff"><p class="k">この動画は、ここでは再生できません</p><p class="d">ファイルを直接開いているため、YouTube が埋め込みを断っています。<br>「S8デッキを開く」から開き直すと、この画面の中で再生できます。</p><a class="btn" href="' + watch + '" target="_blank" rel="noopener">YouTube で見る</a></div>';
      return;
    }
    frame.innerHTML = '<div id="ytp"></div>';
    var start = segs.length ? segs[0].s : st, k = 0, loaded = false;
    setTimeout(function () { if (!loaded && vidOv) frame.innerHTML = '<div class="voff"><p class="k">動画を読み込めません</p><p class="d">ネットにつながっているか確かめてください。</p><a class="btn" href="' + watch + '" target="_blank" rel="noopener">YouTube で見る</a></div>'; }, 8000);
    loadYT(function () {
      if (!vidOv) return;
      ytPlayer = new YT.Player('ytp', { width: '100%', height: '100%', videoId: id,
        playerVars: { start: Math.floor(start), autoplay: 1, rel: 0, playsinline: 1, hl: 'ja', cc_load_policy: 0, iv_load_policy: 3 },
        events: { onReady: function (e) { loaded = true; try { e.target.unloadModule('captions'); e.target.unloadModule('cc'); } catch (x) {} if (start % 1) e.target.seekTo(start, true); e.target.playVideo(); } } });
      window.__deckYT = ytPlayer;  // 確認用（字幕の時刻合わせを外から確かめる）
      vidTimer = setInterval(function () {
        if (!ytPlayer || !ytPlayer.getCurrentTime) return;
        var t = ytPlayer.getCurrentTime();
        if (segs.length && t >= segs[k].e) {   // この場面が終わったら、次の場面へ飛ぶ。最後なら止める
          if (k + 1 < segs.length) { k++; ytPlayer.seekTo(segs[k].s, true); } else { ytPlayer.pauseVideo(); }
        }
        var c = null; for (var i = 0; i < cues.length; i++) if (t >= cues[i][0] && t < cues[i][1]) { c = cues[i][2]; break; }
        cap.textContent = c || ''; cap.style.visibility = c ? 'visible' : 'hidden';
      }, 200);
    });
  }
  document.addEventListener('click', function (e) {
    if (vidOv) { if (e.target === vidOv) closeVideo(); return; }
    if (zoomOv) { closeZoom(); return; }
    var vd = e.target.closest && e.target.closest('.vid');
    if (vd && !document.body.classList.contains('sheet')) {
      if (vd.hasAttribute('data-inline')) { if (!vd.classList.contains('playing')) playInline(vd); return; }
      openVideo(vd); return;
    }
    var t = e.target, v = t.closest && t.closest('.viewer');
    if (v && !document.body.classList.contains('sheet')) {
      if (t.closest('.vprev')) { vShow(v, v._p - 1); return; }
      if (t.closest('.vnext')) { vShow(v, v._p + 1); return; }
      if (t.closest('.vzoom') || t.closest('.vimg')) { openZoom(v.querySelector('.vimg').src, v); return; }
      return;
    }
    var img = t.closest && t.closest('img.zoom');
    if (!img || document.body.classList.contains('sheet')) return;
    openZoom(img.src, null);
  });

  function key(e) {
    if (vidOv) { if (e.key === 'Escape' || e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); closeVideo(); } return; }
    if (zoomOv) {
      e.preventDefault();
      if (zoomOv._v && (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown')) { vShow(zoomOv._v, zoomOv._v._p + 1); return; }
      if (zoomOv._v && (e.key === 'ArrowLeft' || e.key === 'PageUp')) { vShow(zoomOv._v, zoomOv._v._p - 1); return; }
      closeZoom(); return;
    }
    if (e.target && e.target.isContentEditable) { if (e.key === 'Escape') e.target.blur(); return; }  // 書き込み欄では←→を効かせない（Esc で抜ける）
    var k = e.key;
    if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown' || k === ' ' || k === 'Enter') { e.preventDefault(); next(); }
    else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp' || k === 'Backspace') { e.preventDefault(); prev(); }
    else if (k === 'Home') go(0);
    else if (k === 'End') go(N - 1, true);
    else if (k === 'p' || k === 'P') openPresenter();
    else if (k === 'f' || k === 'F') { if (!document.fullscreenElement) document.documentElement.requestFullscreen(); else document.exitFullscreen(); }
  }
  addEventListener('keydown', key);
  addEventListener('resize', scale);
  addEventListener('hashchange', function () { var n = parseInt(location.hash.slice(1), 10); if (n && n - 1 !== i) go(n - 1); });
  addEventListener('beforeprint', function () { slides.forEach(function (s) { steps(s).forEach(function (e) { e.classList.add('on'); }); }); });
  addEventListener('afterprint', paint);

  // 発表者ビュー：今の枚・次の枚・話す内容・経過時間
  function openPresenter() {
    if (presenter && presenter.win && !presenter.win.closed) { presenter.win.focus(); return; }
    var w = open('', 'presenter', 'width=1200,height=760');
    if (!w) return;
    var css = [].map.call(document.querySelectorAll('link[rel=stylesheet]'), function (l) { return '<link rel="stylesheet" href="' + l.href + '">'; }).join('');
    w.document.write('<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>発表者ビュー</title>' + css +
      '<style>body{overflow:auto;background:#1e1e1e;color:#eee;font-family:var(--font);padding:16px;display:grid;grid-template-columns:640px 1fr;grid-template-rows:auto 1fr;gap:16px;height:100vh;box-sizing:border-box}' +
      '.box{position:relative;overflow:hidden;background:#000}.box .slide{position:absolute;left:0;top:0;margin:0;transform-origin:0 0;visibility:visible}' +
      '#cur{width:640px;height:360px}#nxt{width:384px;height:216px}.side{display:flex;flex-direction:column;gap:12px}' +
      '.meta{font-size:22px;font-weight:700}.t{font-size:40px;font-weight:900;color:#f3dc7a}' +
      '#nt{grid-column:1/3;font-size:20px;line-height:1.75;white-space:pre-wrap;background:#2a2a2a;border-radius:8px;padding:18px 22px;overflow:auto}' +
      '.lbl{font-size:14px;color:#999}</style></head><body>' +
      '<div class="box" id="cur"></div><div class="side"><div class="t" id="tm">0:00</div><div class="meta" id="ps"></div>' +
      '<div class="lbl">次の枚</div><div class="box" id="nxt"></div></div><div id="nt"></div></body></html>');
    w.document.close();
    var t0 = Date.now();
    setInterval(function () { if (w.closed) return; var s = Math.floor((Date.now() - t0) / 1000); w.document.getElementById('tm').textContent = Math.floor(s / 60) + ':' + ('0' + s % 60).slice(-2); }, 1000);
    function put(host, idx, sc, stp) {
      var h = w.document.getElementById(host); h.innerHTML = '';
      if (idx >= N) return;
      var c = slides[idx].cloneNode(true);
      c.style.transform = 'scale(' + sc + ')';
      [].forEach.call(c.querySelectorAll('iframe'), function (f) { f.remove(); });
      [].forEach.call(c.querySelectorAll('.st'), function (e, k) { e.classList.toggle('on', stp === -1 || k < stp); });
      h.appendChild(w.document.importNode(c, true));
    }
    function render() {
      if (w.closed) return;
      put('cur', i, 0.5, step);
      put('nxt', i + 1, 0.3, -1);
      var n = slides[i].querySelector('.notes');
      var total = steps(slides[i]).length;
      w.document.getElementById('ps').textContent = (i + 1) + ' / ' + N + (total ? '　（点灯 ' + step + ' / ' + total + '）' : '');
      w.document.getElementById('nt').textContent = n ? n.textContent.trim().replace(/\n\s+/g, '\n') : '';
    }
    w.addEventListener('keydown', key);
    presenter = { win: w, render: render };
    render();
  }

  if (document.body.classList.contains('all') || document.body.classList.contains('sheet')) { slides.forEach(function (s) { s.classList.add('on'); }); return; }
  scale();
  var start = parseInt(location.hash.slice(1), 10);
  go(start ? start - 1 : 0);
})();
