import { HashRouter, NavLink, Route, Routes } from 'react-router-dom';
import { AvisoProvider, Icone, VozProvider } from './components/ui';
import { Inicio } from './pages/Inicio';
import { Lotes } from './pages/Lotes';
import { LoteForm } from './pages/LoteForm';
import { LoteDetalhe } from './pages/LoteDetalhe';
import { Pesagem } from './pages/Pesagem';
import { Fazenda } from './pages/Fazenda';
import { Mais } from './pages/Mais';
import { Nutricao } from './pages/Nutricao';
import { FormulaForm } from './pages/FormulaForm';
import { IngredienteForm } from './pages/IngredienteForm';
import { Estoque } from './pages/Estoque';
import { Trato } from './pages/Trato';
import { Financeiro } from './pages/Financeiro';
import { Sanidade } from './pages/Sanidade';
import { Simular } from './pages/Simular';
import { Relatorios } from './pages/Relatorios';
import { RelatorioPesagem } from './pages/RelatorioPesagem';
import { Cotacoes } from './pages/Cotacoes';
import { Nuvem } from './pages/Nuvem';
import { SincAutomatica } from './nuvem/useNuvem';
import { SessaoProvider } from './nuvem/sessao';
import { Porta } from './pages/Login';

export function App() {
  return (
    <HashRouter>
      <AvisoProvider>
        <VozProvider>
        <SessaoProvider>
          <Porta>
            <SincAutomatica />
            <Routes>
              <Route path="/" element={<Inicio />} />
              <Route path="/lotes" element={<Lotes />} />
              <Route path="/lotes/novo" element={<LoteForm />} />
              <Route path="/lotes/:id" element={<LoteDetalhe />} />
              <Route path="/lotes/:id/editar" element={<LoteForm />} />
              <Route path="/lotes/:id/relatorio" element={<RelatorioPesagem />} />
              <Route path="/pesar" element={<Pesagem />} />
              <Route path="/pesar/:loteId" element={<Pesagem />} />
              <Route path="/fazenda" element={<Fazenda />} />
              <Route path="/mais" element={<Mais />} />
              <Route path="/nutricao" element={<Nutricao />} />
              <Route path="/nutricao/formula/:id" element={<FormulaForm />} />
              <Route path="/nutricao/ingrediente/:id" element={<IngredienteForm />} />
              <Route path="/estoque" element={<Estoque />} />
              <Route path="/trato" element={<Trato />} />
              <Route path="/financeiro" element={<Financeiro />} />
              <Route path="/sanidade" element={<Sanidade />} />
              <Route path="/simular" element={<Simular />} />
              <Route path="/relatorios" element={<Relatorios />} />
              <Route path="/nuvem" element={<Nuvem />} />
              <Route path="/cotacoes" element={<Cotacoes />} />
              <Route path="*" element={<Inicio />} />
            </Routes>
            <nav className="baixo" aria-label="Menu principal">
              <NavLink to="/" end><Icone nome="casa" />Início</NavLink>
              <NavLink to="/lotes"><Icone nome="lotes" />Lotes</NavLink>
              <NavLink to="/pesar" className="pesar"><span className="bola"><Icone nome="balanca" /></span><small>Pesar</small></NavLink>
              <NavLink to="/trato"><Icone nome="cocho" />Trato</NavLink>
              <NavLink to="/mais"><Icone nome="mais" />Mais</NavLink>
            </nav>
          </Porta>
        </SessaoProvider>
        </VozProvider>
      </AvisoProvider>
    </HashRouter>
  );
}
