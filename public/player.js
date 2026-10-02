// Thin wrapper over YouTube's official IFrame Player. Playback stays inside
// YouTube's own player, so ads and rights holders are handled the normal way.
// The YouTube script is heavy, so nothing loads until music is close to playing.
// Loaded once per window: the pop-out keeps its player in its own frame.
const loadApi = (win = window) =>
  (win.__humYT ||= new Promise((resolve) => {
    if (win.YT?.Player) return resolve();
    win.onYouTubeIframeAPIReady = resolve;
    const s = win.document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    win.document.head.append(s);
  }));

export class Player extends EventTarget {
  constructor(el) {
    super();
    this.el = el;
    this.yt = null;
  }
  // Safe to call many times. Call it early (hover, focus, idle) to make the first play instant.
  warm() {
    const win = this.el.ownerDocument.defaultView || window;
    return (this.ready ||= loadApi(win).then(
      () =>
        new Promise((resolve) => {
          this.yt = new win.YT.Player(this.el, {
            width: '100%',
            height: '100%',
            playerVars: { playsinline: 1, controls: 0, disablekb: 1, rel: 0, iv_load_policy: 3, fs: 0, origin: location.origin },
            events: {
              onReady: () => resolve(),
              onStateChange: (e) => this.emit('state', e.data),
              onError: (e) => this.emit('error', e.data),
            },
          });
        }),
    ));
  }
  // Move playback into another container, even in another window (the pop-out
  // mini player). An iframe cannot change documents without reloading, so the
  // player is rebuilt there and picks up from the same second. A window without
  // an address of its own (about:blank) gets a frame of ours to hold the player,
  // or YouTube sees no referrer and refuses to play (error 153).
  async moveTo(container, { resume } = {}) {
    const id = this.yt?.getVideoData?.()?.video_id;
    const at = this.time;
    const wasPlaying = resume ?? this.state === 1;
    try {
      this.yt?.destroy?.();
    } catch {}
    this.yt = null;
    this.ready = null;
    let host = container;
    if (container.ownerDocument.defaultView?.location.protocol === 'about:') {
      const f = container.ownerDocument.createElement('iframe');
      f.allow = 'autoplay; encrypted-media; picture-in-picture';
      f.title = 'Player';
      f.style.cssText = 'width:100%;height:100%;border:0;display:block';
      const loaded = new Promise((r) => f.addEventListener('load', r, { once: true }));
      f.src = new URL('player-frame.html', location.href).href;
      container.replaceChildren(f);
      await loaded;
      host = f.contentDocument.body;
    }
    const el = host.ownerDocument.createElement('div');
    host.replaceChildren(el);
    this.el = el;
    await this.warm();
    if (id) await this.load(id, { autoplay: wasPlaying, start: Math.floor(at) });
    return wasPlaying;
  }
  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
  async load(id, { autoplay = true, start = 0 } = {}) {
    await this.warm();
    const opts = { videoId: id, startSeconds: start };
    autoplay ? this.yt.loadVideoById(opts) : this.yt.cueVideoById(opts);
    if (window.__humSilent) this.yt.mute();
  }
  play() { this.yt?.playVideo?.(); }
  pause() { this.yt?.pauseVideo?.(); }
  seek(t) { this.yt?.seekTo?.(Math.max(0, t), true); }
  // Automated tests set window.__humSilent so nothing is ever audible while they run.
  setVolume(v) { this.yt?.setVolume?.(Math.round(v * 100)); v > 0 && !window.__humSilent ? this.yt?.unMute?.() : this.yt?.mute?.(); }
  get time() { return this.yt?.getCurrentTime?.() || 0; }
  get duration() { return this.yt?.getDuration?.() || 0; }
  get state() { return this.yt?.getPlayerState?.() ?? -1; }
}
