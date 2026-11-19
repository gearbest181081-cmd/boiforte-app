import { HashRouter, NavLink, Route, Routes } from 'react-router-dom';
import { AvisoProvider, Icone } from './components/ui';
import { Inicio } from './pages/Inicio';
import { Lotes } from './pages/Lotes';
import { LoteForm } from './pages/LoteForm';
import { LoteDetalhe } from './pages/LoteDetalhe';
import { Pesagem } from './pages/Pesagem';
import { Fazenda } from './pages/Fazenda';
import { Mais } from './pages/Mais';

export function App() {
  return (
    <HashRouter>
      <AvisoProvider>
        <Routes>
          <Route path="/" element={<Inicio />} />
          <Route path="/lotes" element={<Lotes />} />
          <Route path="/lotes/novo" element={<LoteForm />} />
          <Route path="/lotes/:id" element={<LoteDetalhe />} />
          <Route path="/lotes/:id/editar" element={<LoteForm />} />
          <Route path="/pesar" element={<Pesagem />} />
          <Route path="/pesar/:loteId" element={<Pesagem />} />
          <Route path="/fazenda" element={<Fazenda />} />
          <Route path="/mais" element={<Mais />} />
          <Route path="*" element={<Inicio />} />
        </Routes>
        <nav className="baixo" aria-label="Menu principal">
          <NavLink to="/" end><Icone nome="casa" />Início</NavLink>
          <NavLink to="/lotes"><Icone nome="lotes" />Lotes</NavLink>
          <NavLink to="/pesar" className="pesar"><span className="bola"><Icone nome="balanca" /></span><small>Pesar</small></NavLink>
          <NavLink to="/fazenda"><Icone nome="fazenda" />Fazenda</NavLink>
          <NavLink to="/mais"><Icone nome="mais" />Mais</NavLink>
        </nav>
      </AvisoProvider>
    </HashRouter>
  );
}
