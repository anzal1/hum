// Thin wrapper over YouTube's official IFrame Player. Playback stays inside
// YouTube's own player, so ads and rights holders are handled the normal way.
// The YouTube script is heavy, so nothing loads until music is close to playing.
let apiReady;
const loadApi = () =>
  (apiReady ||= new Promise((resolve) => {
    if (window.YT?.Player) return resolve();
    window.onYouTubeIframeAPIReady = resolve;
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    document.head.append(s);
  }));

export class Player extends EventTarget {
  constructor(el) {
    super();
    this.el = el;
    this.yt = null;
  }
  // Safe to call many times. Call it early (hover, focus, idle) to make the first play instant.
  warm() {
    return (this.ready ||= loadApi().then(
      () =>
        new Promise((resolve) => {
          this.yt = new YT.Player(this.el, {
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
  // player is rebuilt there and picks up from the same second.
  async moveTo(container, { resume } = {}) {
    const id = this.yt?.getVideoData?.()?.video_id;
    const at = this.time;
    const wasPlaying = resume ?? this.state === 1;
    try {
      this.yt?.destroy?.();
    } catch {}
    this.yt = null;
    this.ready = null;
    const el = container.ownerDocument.createElement('div');
    container.replaceChildren(el);
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
