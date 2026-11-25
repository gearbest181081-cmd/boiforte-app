// Apagar com "Desfazer": tudo o que a pessoa apaga vai para a lixeira (src/lixeira.ts) e o aviso que aparece
// logo depois tem o botão Desfazer. Também dá para trazer de volta mais tarde, em Mais › Lixeira.
import { useCallback } from 'react';
import { restaurar } from '../lixeira';
import { usePapel } from '../nuvem/useNuvem';
import { useAviso } from './ui';

/** Lembrete para as perguntas de confirmação: o que se apaga não some. */
export const VAI_PARA_LIXEIRA = 'Vai para a Lixeira (em Mais) e dá para trazer de volta.';

/**
 * Uso: const apagar = useApagar();
 *      if (await apagar(() => excluirLote(id), 'Lote apagado.')) nav('/lotes');
 * fn: uma das funções excluir.../desfazer... (devolvem o pacote da lixeira). Devolve false se deu erro
 * (a mensagem já apareceu no aviso).
 */
export function useApagar() {
  const aviso = useAviso();
  const papel = usePapel();
  return useCallback(async (fn: () => Promise<string | null | undefined>, texto: string): Promise<boolean> => {
    let pacote: string | null | undefined;
    try {
      pacote = await fn();
    } catch (e) {
      aviso((e as Error).message, true);
      return false;
    }
    if (!pacote) { aviso(texto); return true; }
    aviso(`${texto} Foi para a Lixeira.`, false, {
      rotulo: 'Desfazer',
      fazer: async () => {
        try {
          const r = await restaurar(pacote!, { papel: papel ?? null, ligado: !!papel });
          aviso(r.avisos.length ? `Voltou. ${r.avisos.join(' ')}` : 'Pronto, voltou.');
        } catch (e) {
          aviso((e as Error).message, true);
        }
      },
    });
    return true;
  }, [aviso, papel]);
}
