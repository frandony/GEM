/**
 * Aviso de fim de timer — Pomodoro (Estudo.tsx) e descanso entre séries
 * (SessaoTreino.tsx). Dois canais, cada um best-effort:
 *
 * 1. Som: dois beeps curtos via Web Audio API. Não usa um arquivo de
 *    áudio — evita mais um asset pra cachear no PWA, e o beep sintetizado
 *    não depende de autoplay de <audio> (que o Safari bloqueia sem gesto
 *    prévio; aqui o AudioContext já foi desbloqueado pelo toque que
 *    iniciou o timer).
 * 2. Vibração: padrão curto-pausa-curto, só onde a API existe (iOS Safari
 *    não implementa `navigator.vibrate` — falha em silêncio).
 *
 * Nenhum dos dois pode lançar: um erro aqui não pode derrubar o timer que
 * acabou de zerar.
 */

let contextoAudio: AudioContext | null = null;

function tocarSom() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    contextoAudio ??= new Ctx();
    const ctx = contextoAudio;
    if (ctx.state === "suspended") void ctx.resume();

    const agora = ctx.currentTime;
    [0, 0.18].forEach((atraso) => {
      const osc = ctx.createOscillator();
      const ganho = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      ganho.gain.setValueAtTime(0, agora + atraso);
      ganho.gain.linearRampToValueAtTime(0.2, agora + atraso + 0.01);
      ganho.gain.exponentialRampToValueAtTime(0.0001, agora + atraso + 0.15);
      osc.connect(ganho).connect(ctx.destination);
      osc.start(agora + atraso);
      osc.stop(agora + atraso + 0.16);
    });
  } catch {
    // Web Audio indisponível ou bloqueado — o toast na tela já avisa.
  }
}

function vibrar() {
  try {
    navigator.vibrate?.([200, 100, 200]);
  } catch {
    // Sem suporte (iOS Safari, por exemplo).
  }
}

export function notificarFimDoTimer() {
  tocarSom();
  vibrar();
}
