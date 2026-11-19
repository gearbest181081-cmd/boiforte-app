import { describe, it, expect } from 'vitest';
import { FONTES_PADRAO, lerFontes, lerTabelaIndicador } from '../../supabase/functions/_shared/cotacoes';

describe('coleta de cotações', () => {
  it('acha a data mais recente e o valor da tabela do indicador', () => {
    const html = `<script>var x = "01/01/2030 | 9,99"</script><table><tr><th>Data</th><th>Valor R$*</th></tr>
      <tr><td>17/11/2026</td><td>310,25</td><td>-0,2%</td></tr>
      <tr><td>18/11/2026</td><td>312,40</td><td>0,7%</td></tr></table>`;
    expect(lerTabelaIndicador(html)).toEqual({ data: '2026-11-18', valor: 312.4 });
    expect(lerTabelaIndicador('<td>18/11/2026</td><td>R$ 2.910,00</td>')).toEqual({ data: '2026-11-18', valor: 2910 });
    expect(lerTabelaIndicador('<p>sem tabela</p>')).toBeNull();
  });
  it('fontes: padrão, ou lista trocada sem mexer no código (só https)', () => {
    expect(lerFontes(undefined)).toBe(FONTES_PADRAO);
    expect(lerFontes(JSON.stringify([{ produto: 'milho', praca: 'X', unidade: 'R$/sc60', url: 'http://inseguro', fonte: 'x' }]))).toEqual([]);
  });
});
