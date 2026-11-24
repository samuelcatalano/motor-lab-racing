function tireVoice(ctx, noise, side) {
  const tone = ctx.createOscillator();
  tone.type = 'triangle';
  const overtone = ctx.createOscillator();
  const overtoneLevel = ctx.createGain();
  overtoneLevel.gain.value = .16;

  const scrape = ctx.createBufferSource();
  scrape.buffer = noise;
  scrape.loop = true;
  const rubber = ctx.createBiquadFilter();
  rubber.type = 'bandpass';
  rubber.Q.value = .85;
  const scrapeLevel = ctx.createGain();
  scrapeLevel.gain.value = 1.35;

  const level = ctx.createGain();
  level.gain.value = 0;
  const pan = ctx.createStereoPanner();
  pan.pan.value = side * .46;
  tone.connect(level);
  overtone.connect(overtoneLevel).connect(level);
  scrape.connect(rubber).connect(scrapeLevel).connect(level);
  level.connect(pan).connect(ctx.destination);
  tone.start();
  overtone.start();
  scrape.start(0, side < 0 ? .21 : .69);

  let previous = 0;
  return (squeal, speed, steer, time) => {
    const pitch = (825 + squeal * 360 + speed * 7) * (1 + .029 * side)
      + Math.sin(time * 46 + side) * 24 + Math.sin(time * 91 - side) * 10;
    const grip = squeal * (1 - steer * side * .26);
    const volume = .135 * grip ** 1.25 * (1 + .14 * Math.sin(time * 54 + side));
    tone.frequency.setTargetAtTime(pitch, time, .015);
    overtone.frequency.setTargetAtTime(pitch * 2.06, time, .015);
    rubber.frequency.setTargetAtTime(1260 + speed * 29, time, .05);
    level.gain.setTargetAtTime(volume, time, volume > previous ? .018 : .052);
    previous = volume;
  };
}

export function makeSound() {
  let ctx, engine, gain, filter, tires, rainGain, rainTone;
  let enabled = true;
  return {
    get enabled() { return enabled; },
    async activate() {
      if (!enabled) return;
      try {
        if (!ctx) {
          ctx = new AudioContext();
          engine = ctx.createOscillator();
          filter = ctx.createBiquadFilter();
          gain = ctx.createGain();
          engine.type = 'sawtooth';
          filter.type = 'lowpass';
          gain.gain.value = 0;
          engine.connect(filter).connect(gain).connect(ctx.destination);
          engine.start();

          const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
          const samples = noise.getChannelData(0);
          for (let i = 0; i < samples.length; i++) samples[i] = 2 * Math.random() - 1;
          tires = [-1, 1].map(side => tireVoice(ctx, noise, side));
          const rain=ctx.createBufferSource();
          rain.buffer=noise;
          rain.loop=true;
          rainTone=ctx.createBiquadFilter();
          rainTone.type='lowpass';
          rainGain=ctx.createGain();
          rainGain.gain.value=0;
          rain.connect(rainTone).connect(rainGain).connect(ctx.destination);
          rain.start();
        }
        await ctx.resume();
      } catch { /* Driving works without audio. */ }
    },
    toggle() { enabled = !enabled; },
    update(active, speed, throttle, squeal = 0, steer = 0, wetness = 0) {
      if (!rainGain) return;
      const time = ctx.currentTime;
      engine.frequency.setTargetAtTime(43 + speed * 5.9 + throttle * 17, time, .075);
      filter.frequency.setTargetAtTime(130 + speed * 16 + throttle * 230, time, .09);
      gain.gain.setTargetAtTime(enabled && active ? .029 + throttle * .036 : 0, time, .075);
      const stress = enabled && active ? squeal : 0;
      for (const updateTire of tires) updateTire(stress, speed, steer, time);
      rainTone.frequency.setTargetAtTime(870+speed*60,time,.19);
      rainGain.gain.setTargetAtTime(enabled&&active ? wetness*(.105+speed*.004) : 0,time,.14);
    },
  };
}
