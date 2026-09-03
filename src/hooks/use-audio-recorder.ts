import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Gravação de áudio do chat.
 *
 * O `MediaRecorder` grava no contêiner que o navegador oferecer — webm/opus no
 * Chrome e no Firefox, mp4 no Safari. Os dois estão na lista que o modelo de
 * transcrição aceita, então não há conversão a fazer no cliente: converter
 * áudio no navegador custaria uma biblioteca inteira para resolver um problema
 * que não existe.
 *
 * O microfone é liberado assim que a gravação termina (`stop()` em cada trilha).
 * Sem isso, a luz da webcam/microfone fica acesa depois de a pessoa já ter
 * enviado a mensagem — o navegador só corta quando a aba é fechada.
 */

/** Teto de segurança: a essa altura já não é um comando falado. */
const MAX_SEGUNDOS = 120;

export type GravacaoAudio = {
  gravando: boolean;
  /** Segundos decorridos, para o contador da tela. */
  duracao: number;
  /** `false` quando o navegador não tem MediaRecorder ou getUserMedia. */
  suportado: boolean;
  iniciar: () => Promise<void>;
  /** Encerra e devolve o áudio; `null` se nada foi capturado. */
  parar: () => Promise<Blob | null>;
  /** Encerra e joga fora o que foi gravado. */
  cancelar: () => void;
  /** Falha ao pedir o microfone, para a tela explicar o que aconteceu. */
  erro: string | null;
};

export function useAudioRecorder(): GravacaoAudio {
  const [gravando, setGravando] = useState(false);
  const [duracao, setDuracao] = useState(0);
  const [erro, setErro] = useState<string | null>(null);

  const recorder = useRef<MediaRecorder | null>(null);
  const pedacos = useRef<Blob[]>([]);
  const intervalo = useRef<ReturnType<typeof setInterval> | null>(null);

  const suportado =
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia;

  const encerrar = useCallback(() => {
    if (intervalo.current) {
      clearInterval(intervalo.current);
      intervalo.current = null;
    }
    recorder.current?.stream.getTracks().forEach((trilha) => trilha.stop());
    setGravando(false);
    setDuracao(0);
  }, []);

  // Sair da tela no meio de uma gravação não pode deixar o microfone ligado.
  useEffect(() => encerrar, [encerrar]);

  const iniciar = useCallback(async () => {
    setErro(null);
    if (!suportado) {
      setErro("Este navegador não grava áudio.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const gravador = new MediaRecorder(stream);
      pedacos.current = [];
      gravador.ondataavailable = (evento) => {
        if (evento.data.size > 0) pedacos.current.push(evento.data);
      };
      gravador.start();
      recorder.current = gravador;
      setGravando(true);
      setDuracao(0);

      intervalo.current = setInterval(() => {
        setDuracao((atual) => {
          // No teto, para sozinho: os dados já gravados continuam válidos e a
          // pessoa envia o que falou, em vez de perder tudo.
          if (atual + 1 >= MAX_SEGUNDOS) gravador.stop();
          return atual + 1;
        });
      }, 1000);
    } catch (falha) {
      setErro(
        falha instanceof DOMException && falha.name === "NotAllowedError"
          ? "Preciso de permissão para usar o microfone."
          : "Não consegui acessar o microfone.",
      );
      encerrar();
    }
  }, [suportado, encerrar]);

  const parar = useCallback(async (): Promise<Blob | null> => {
    const gravador = recorder.current;
    if (!gravador || gravador.state === "inactive") {
      encerrar();
      return null;
    }

    const tipo = gravador.mimeType || "audio/webm";
    const pronto = new Promise<Blob | null>((resolve) => {
      gravador.onstop = () => {
        const blob = pedacos.current.length ? new Blob(pedacos.current, { type: tipo }) : null;
        pedacos.current = [];
        resolve(blob);
      };
    });

    gravador.stop();
    const blob = await pronto;
    encerrar();
    return blob;
  }, [encerrar]);

  const cancelar = useCallback(() => {
    const gravador = recorder.current;
    if (gravador && gravador.state !== "inactive") {
      gravador.onstop = null;
      gravador.stop();
    }
    pedacos.current = [];
    encerrar();
  }, [encerrar]);

  return { gravando, duracao, suportado, iniciar, parar, cancelar, erro };
}
