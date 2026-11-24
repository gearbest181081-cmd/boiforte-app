import { HashRouter, NavLink, Route, Routes } from 'react-router-dom';
import { AvisoProvider, Icone, VozProvider } from './components/ui';
import { Inicio } from './pages/Inicio';
import { Lotes } from './pages/Lotes';
import { LoteForm } from './pages/LoteForm';
import { LoteDetalhe } from './pages/LoteDetalhe';
import { MudarFase } from './pages/MudarFase';
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
import { Nuvem } from './pages/Nuvem';
import { FuncionarioForm, Funcionarios } from './pages/Funcionarios';
import { AnotacaoDetalhe, AnotacaoForm, Anotacoes } from './pages/Anotacoes';
import { Cria } from './pages/Cria';
import { AnimalCriaForm, DesmamaCria, EventoCria, GrupoCria, PesagemCria } from './pages/CriaForms';
import { AnimalCria } from './pages/CriaAnimal';
import { CriaSimular } from './pages/CriaSimular';
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
              <Route path="/lotes/:id/fase" element={<MudarFase />} />
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
              <Route path="/funcionarios" element={<Funcionarios />} />
              <Route path="/funcionarios/:id" element={<FuncionarioForm />} />
              <Route path="/anotacoes" element={<Anotacoes />} />
              <Route path="/anotacoes/nova" element={<AnotacaoForm />} />
              <Route path="/anotacoes/:id" element={<AnotacaoDetalhe />} />
              <Route path="/anotacoes/:id/editar" element={<AnotacaoForm />} />
              <Route path="/cria" element={<Cria />} />
              <Route path="/cria/grupo/:id" element={<GrupoCria />} />
              <Route path="/cria/animal/novo" element={<AnimalCriaForm />} />
              <Route path="/cria/animal/:id" element={<AnimalCria />} />
              <Route path="/cria/animal/:id/editar" element={<AnimalCriaForm />} />
              <Route path="/cria/evento/:tipo" element={<EventoCria />} />
              <Route path="/cria/pesar" element={<PesagemCria />} />
              <Route path="/cria/desmama" element={<DesmamaCria />} />
              <Route path="/cria/simular" element={<CriaSimular />} />
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
