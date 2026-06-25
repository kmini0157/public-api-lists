// Server-side speech-to-text for Telegram voice notes.
// Key-less: ffmpeg decodes the audio (Telegram sends OGG/Opus) to 16 kHz mono
// PCM, then a local Transformers.js Whisper model transcribes it — same WASM
// approach as embeddings, so no API key and no native build.
//
// Requires `ffmpeg` on PATH. The browser PWA path does NOT use this (it uses the
// browser's own Web Speech API), so ffmpeg is only needed if you enable Telegram.
import { spawn } from "node:child_process";
import { pipeline } from "@huggingface/transformers";

const MODEL = process.env.WHISPER_MODEL || "Xenova/whisper-base";
let asrPromise = null;
const getAsr = () => (asrPromise ??= pipeline("automatic-speech-recognition", MODEL));

// Decode any ffmpeg-readable audio buffer to a 16 kHz mono Float32Array.
function decodeToPcm(buf) {
  return new Promise((resolve, reject) => {
    const ff = spawn(
      "ffmpeg",
      ["-i", "pipe:0", "-ar", "16000", "-ac", "1", "-f", "f32le", "pipe:1"],
      { stdio: ["pipe", "pipe", "ignore"] },
    );
    const out = [];
    ff.stdout.on("data", (d) => out.push(d));
    ff.on("error", (e) =>
      reject(new Error(`ffmpeg not runnable (${e.code || e.message}); install ffmpeg to enable Telegram STT`)),
    );
    ff.on("close", (code) =>
      code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`ffmpeg exited ${code}`)),
    );
    ff.stdin.on("error", () => {}); // ignore EPIPE if ffmpeg dies early
    ff.stdin.end(buf);
  });
}

export async function transcribe(buf, { language = "korean" } = {}) {
  const pcm = await decodeToPcm(buf);
  // Copy into an aligned, exactly-sized Float32Array.
  const samples = new Float32Array(pcm.length / 4);
  for (let i = 0; i < samples.length; i++) samples[i] = pcm.readFloatLE(i * 4);

  const asr = await getAsr();
  const out = await asr(samples, {
    language,
    task: "transcribe",
    chunk_length_s: 30,
    stride_length_s: 5,
  });
  return (out.text || "").trim();
}

// Warm the ASR model lazily; safe to call at boot only when Telegram is on.
export function warmupStt() {
  return getAsr();
}
