const SONIFY_NOTES = {
  person: 261.63,
  bicycle: 293.66,
  car: 329.63,
  dog: 349.23,
  cat: 392.0,
  default: 440.0,
};

let audioContext = null;
let masterGain = null;

export function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function noteForLabel(label) {
  return SONIFY_NOTES[label] ?? SONIFY_NOTES.default;
}

function ensureAudio() {
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) {
    return null;
  }
  if (!audioContext) {
    audioContext = new Context();
    masterGain = audioContext.createGain();
    masterGain.gain.value = 0.22;
    masterGain.connect(audioContext.destination);
  }
  return audioContext;
}

export async function resumeAudio() {
  const context = ensureAudio();
  if (context?.state === "suspended") {
    try {
      await context.resume();
    } catch {
      // Autoplay policies can still block until a later gesture.
    }
  }
  return context;
}

function playTone({ frequency, duration = 0.12, type = "square", gainValue = 0.18, pan = 0, startOffset = 0 }) {
  if (prefersReducedMotion()) {
    return;
  }
  const context = ensureAudio();
  if (!context || !masterGain) {
    return;
  }
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const panner = context.createStereoPanner();
  oscillator.type = type;
  oscillator.frequency.value = frequency;
  gain.gain.value = gainValue;
  panner.pan.value = Math.max(-1, Math.min(1, pan));
  oscillator.connect(gain);
  gain.connect(panner);
  panner.connect(masterGain);
  const startAt = context.currentTime + startOffset;
  oscillator.start(startAt);
  oscillator.stop(startAt + duration);
}

export function playAlertTone() {
  playTone({ frequency: 880, duration: 0.12, type: "square", gainValue: 0.16 });
}

export function playSpatialPing(detection, frameWidth, { enabled = true } = {}) {
  if (!enabled || !detection?.box) {
    return;
  }
  const centerX = detection.box.x + detection.box.width / 2;
  const pan = (centerX / Math.max(1, frameWidth)) * 2 - 1;
  playTone({
    frequency: noteForLabel(detection.label),
    duration: 0.08,
    type: "sine",
    gainValue: 0.12,
    pan,
  });
}

export function sonifyDetections(detections, { enabled = true, chord = true } = {}) {
  if (!enabled || !detections?.length) {
    return;
  }
  const voices = chord ? detections.slice(0, 3) : detections.slice(0, 1);
  voices.forEach((detection, index) => {
    playTone({
      frequency: noteForLabel(detection.label) * (1 + index * 0.04),
      duration: 0.12,
      type: index === 0 ? "triangle" : "sine",
      gainValue: 0.08 / voices.length,
      startOffset: index * 0.03,
    });
  });
}
