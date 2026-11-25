// Aba de uma tela guardada no endereço (/lotes/12?aba=saude, /financeiro?aba=fixos): o Menu, um aviso ou um botão
// abrem a tela já na parte certa, e o Voltar de outra tela volta para a mesma aba.
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Aba atual, a ação pedida (?acao=venda, ?acao=novo: já abre o formulário) e como trocar.
 * Ao tocar, a aba troca na hora; o endereço muda logo depois, sem criar um passo a mais no Voltar.
 * Um link para outra aba da mesma tela também troca.
 */
export function useAbaNoEndereco(padrao: string): { aba: string; acao: string | null; trocar: (aba: string, acao?: string) => void } {
  const [params, setParams] = useSearchParams();
  const abaUrl = params.get('aba') ?? padrao;
  const acaoUrl = params.get('acao');
  const [estado, setEstado] = useState({ aba: abaUrl, acao: acaoUrl });
  useEffect(() => {
    setEstado((e) => (e.aba === abaUrl && e.acao === acaoUrl ? e : { aba: abaUrl, acao: acaoUrl }));
  }, [abaUrl, acaoUrl]);
  const trocar = (aba: string, acao?: string) => {
    setEstado({ aba, acao: acao ?? null });
    setParams({ ...(aba === padrao ? {} : { aba }), ...(acao ? { acao } : {}) }, { replace: true });
  };
  return { ...estado, trocar };
}
