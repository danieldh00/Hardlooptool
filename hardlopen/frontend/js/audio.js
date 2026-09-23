// Geluidssignalen tijdens het lopen.
//
// Het lastige: een telefoon in je zak of armband zet het scherm uit, en dan
// remt de browser JavaScript-timers flink af (iOS pauzeert ze zelfs). Daarom:
//  - Alle piepjes worden vooraf ingepland in de Web Audio-klok
//    (`osc.start(when)`); die loopt door zolang de audiosessie actief is, ook
//    als er geen JavaScript draait.
//  - In de modus 'background' speelt er een stil <audio>-bestand in een lus
//    en staat de audiosessie op 'playback'. Dat houdt de audiosessie (en
//    daarmee de pagina) wakker met het scherm uit. Nadeel op iOS: andere
//    muziek wordt dan gepauzeerd.
//  - In de modus 'mix' spelen de signalen over je muziek heen, maar dan moet
//    het scherm aan blijven (de app vraagt daarom een wake lock aan).
//  - Gesproken aankondigingen (speechSynthesis) kunnen niet vooraf ingepland
//    worden; die komen zodra de pagina weer een tik krijgt.
const Cues = (() => {
  let ctx = null;
  let master = null;
  let keepAlive = null;
  let scheduled = [];
  let settings = null;

  function silentWavUrl(seconds = 2) {
    const rate = 8000;
    const samples = rate * seconds;
    const buf = new ArrayBuffer(44 + samples * 2);
    const v = new DataView(buf);
    const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    str(0, 'RIFF');
    v.setUint32(4, 36 + samples * 2, true);
    str(8, 'WAVE');
    str(12, 'fmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); // PCM
    v.setUint16(22, 1, true); // mono
    v.setUint32(24, rate, true);
    v.setUint32(28, rate * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    str(36, 'data');
    v.setUint32(40, samples * 2, true);
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  }

  function setSessionType(type) {
    try {
      if (navigator.audioSession) navigator.audioSession.type = type;
    } catch {
      /* niet ondersteund */
    }
  }

  // Moet vanuit een tik van de gebruiker aangeroepen worden (autoplay-regels).
  function unlock(currentSettings) {
    settings = currentSettings;
    const background = settings.audioMode === 'background';
    setSessionType(background ? 'playback' : 'transient');
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.connect(ctx.destination);
    }
    master.gain.value = settings.volume;
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    // Onhoorbaar piepje: ontgrendelt de uitvoer op iOS binnen dezelfde tik.
    beep(440, 0.01, 0, 0.0001);
    if (background) {
      if (!keepAlive) {
        keepAlive = new Audio(silentWavUrl());
        keepAlive.loop = true;
        keepAlive.setAttribute('playsinline', '');
      }
      keepAlive.play().catch(() => {});
    } else if (keepAlive) {
      keepAlive.pause();
    }
    if (window.speechSynthesis) {
      // Een lege uitspraak binnen de tik ontgrendelt spraak op iOS.
      const u = new SpeechSynthesisUtterance('');
      window.speechSynthesis.speak(u);
    }
  }

  function release() {
    cancelAll();
    if (keepAlive) keepAlive.pause();
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    setSessionType('auto');
  }

  function resumeIfNeeded() {
    if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {});
    if (keepAlive && settings && settings.audioMode === 'background' && keepAlive.paused) keepAlive.play().catch(() => {});
  }

  function beep(freq, duration, when = 0, gain = 1) {
    if (!ctx) return null;
    const start = Math.max(ctx.currentTime, ctx.currentTime + when);
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    // Korte aan/uit-flank tegen klikken.
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(gain, start + 0.01);
    env.gain.setValueAtTime(gain, start + Math.max(0.01, duration - 0.03));
    env.gain.linearRampToValueAtTime(0, start + duration);
    osc.connect(env);
    env.connect(master);
    osc.start(start);
    osc.stop(start + duration + 0.02);
    return osc;
  }

  // Signaaltypes: 'tick' (aftellen), 'go' (nieuwe stap), 'half' (halverwege),
  // 'done' (training klaar).
  function sound(type, when) {
    const nodes = [];
    if (type === 'tick') nodes.push(beep(880, 0.12, when, 0.6));
    else if (type === 'half') nodes.push(beep(660, 0.1, when, 0.5), beep(660, 0.1, when + 0.18, 0.5));
    else if (type === 'go') nodes.push(beep(1320, 0.45, when, 0.9));
    else if (type === 'done') {
      nodes.push(beep(988, 0.18, when, 0.9), beep(1175, 0.18, when + 0.22, 0.9), beep(1568, 0.6, when + 0.44, 0.9));
    }
    return nodes.filter(Boolean);
  }

  // cues: [{ at: epoch-ms, type }]. Vervangt alles wat eerder ingepland was.
  function schedule(cues) {
    cancelAll();
    if (!ctx || !settings || !settings.beeps) return;
    const now = Date.now();
    for (const cue of cues) {
      if (cue.type === 'tick' && !settings.countdown) continue;
      if (cue.type === 'half' && !settings.halfway) continue;
      const when = (cue.at - now) / 1000;
      if (when < -0.05) continue;
      scheduled.push(...sound(cue.type, Math.max(0, when)));
    }
  }

  function cancelAll() {
    for (const osc of scheduled) {
      try {
        osc.stop();
        osc.disconnect();
      } catch {
        /* al gestopt */
      }
    }
    scheduled = [];
  }

  function voices() {
    if (!window.speechSynthesis) return [];
    return window.speechSynthesis.getVoices().filter((v) => /^nl/i.test(v.lang));
  }

  function speak(text) {
    if (!settings || !settings.speech || !window.speechSynthesis) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'nl-NL';
    const voice = voices().find((v) => v.voiceURI === settings.voiceURI) || voices()[0];
    if (voice) u.voice = voice;
    u.volume = settings.volume;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }

  function vibrate(pattern) {
    if (settings && settings.vibrate && navigator.vibrate) navigator.vibrate(pattern);
  }

  function test(currentSettings) {
    unlock(currentSettings);
    const saved = settings.beeps;
    settings.beeps = true;
    sound('tick', 0.1);
    sound('tick', 1.1);
    sound('go', 2.1);
    settings.beeps = saved;
    setTimeout(() => speak('Hardlopen, 2 minuten'), 2800);
    vibrate([200, 100, 200]);
  }

  return { unlock, release, resumeIfNeeded, schedule, cancelAll, speak, vibrate, voices, test };
})();
