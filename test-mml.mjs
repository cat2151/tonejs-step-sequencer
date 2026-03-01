import { initWasm, mml2json } from './node_modules/tonejs-mml-to-json/dist/index.js';

await initWasm();

const mml = `@Synth{
  "volume": 0,
  "oscillator": { "type": "sawtooth" },
  "envelope": { "attack": 0.08, "decay": 0.2, "sustain": 0.4, "release": 0.9 }
}
@AutoWah{
  "wet": 0.8,
  "baseFrequency": 80,
  "octaves": 5,
  "sensitivity": -20,
  "Q": 3,
  "gain": 2,
  "follower": 0.15
}
o4 l8 c e g a g e c`;

const result = mml2json(mml);
console.log(JSON.stringify(result, null, 2));
