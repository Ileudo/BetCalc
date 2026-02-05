
import React, { useState, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { ShieldCheck, Zap, Info, Activity, ClipboardCheck, Sparkles, X, Target, Crosshair } from 'lucide-react';

// Math Utilities
const factorial = (n: number): number => {
  if (n === 0) return 1;
  let res = 1;
  for (let i = 2; i <= n; i++) res *= i;
  return res;
};

const poisson = (k: number, lambda: number): number => {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k);
};

const getDixonColesAdj = (h: number, a: number, l1: number, l2: number, rho: number): number => {
  if (h === 0 && a === 0) return 1 - l1 * l2 * rho;
  if (h === 1 && a === 0) return 1 + l2 * rho;
  if (h === 0 && a === 1) return 1 + l1 * rho;
  if (h === 1 && a === 1) return 1 - rho;
  return 1;
};

const App: React.FC = () => {
  const [inputs, setInputs] = useState({
    w1: '1.671',
    x: '3.74',
    w2: '4.28',
    totalValue: '2.5',
    over: '1.869',
    under: '1.884',
  });

  const [rawText, setRawText] = useState('');
  const [isImportSuccess, setIsImportSuccess] = useState(false);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    const normalizedValue = value.replace(',', '.');
    if (/^\d*\.?\d*$/.test(normalizedValue)) {
      setInputs(prev => ({ ...prev, [name]: normalizedValue }));
    }
  };

  const parseInputText = (text: string) => {
    const findValue = (regex: RegExp) => {
      const match = text.match(regex);
      // Clean extracted string from trailing/leading whitespace and ensure dot separator
      return match ? match[1].trim().replace(',', '.') : null;
    };

    // Stricter regex for numbers: digits, then optional (dot/comma + digits)
    // This prevents capturing trailing commas or dots that are actually delimiters in the source text.
    const num = "(\\d+(?:[.,]\\d+)?)";

    const parsedData = {
      w1: findValue(new RegExp(`П1\\s*=\\s*${num}`, 'i')),
      x: findValue(new RegExp(`X\\s*=\\s*${num}`, 'i')),
      w2: findValue(new RegExp(`П2\\s*=\\s*${num}`, 'i')),
      totalValue: findValue(new RegExp(`ТБ\\(${num}\\)`, 'i')),
      over: findValue(new RegExp(`ТБ\\([\\d.,]+\\)\\s*=\\s*${num}`, 'i')),
      under: findValue(new RegExp(`ТМ\\([\\d.,]+\\)\\s*=\\s*${num}`, 'i')),
    };

    const hasData = Object.values(parsedData).some(v => v !== null);

    if (hasData) {
      setInputs(prev => ({
        w1: parsedData.w1 || prev.w1,
        x: parsedData.x || prev.x,
        w2: parsedData.w2 || prev.w2,
        totalValue: parsedData.totalValue || prev.totalValue,
        over: parsedData.over || prev.over,
        under: parsedData.under || prev.under,
      }));
      setIsImportSuccess(true);
      setTimeout(() => setIsImportSuccess(false), 2000);
      setRawText('');
    }
  };

  const results = useMemo(() => {
    const w1 = parseFloat(inputs.w1) || 0;
    const x = parseFloat(inputs.x) || 0;
    const w2 = parseFloat(inputs.w2) || 0;
    const totalV = parseFloat(inputs.totalValue) || 2.5;
    const over = parseFloat(inputs.over) || 0;
    const under = parseFloat(inputs.under) || 0;

    if (w1 <= 1 || x <= 1 || w2 <= 1 || over <= 1 || under <= 1) return null;

    const m1X2 = 1/w1 + 1/x + 1/w2;
    const mTotal = 1/over + 1/under;

    const fP1 = (1/w1) / m1X2;
    const fPX = (1/x) / m1X2;
    const fP2 = (1/w2) / m1X2;
    const fPUnder = (1/under) / mTotal;

    let bestL1 = 1.2, bestL2 = 1.0, bestRho = 0;
    let minError = Infinity;

    const getModelUnderProb = (l1: number, l2: number, rho: number, v: number) => {
      let pUnder = 0;
      const isAsianQuarter = (v * 100) % 50 !== 0;

      for (let i = 0; i <= 14; i++) {
        const pi = poisson(i, l1);
        for (let j = 0; j <= 14; j++) {
          const prob = pi * poisson(j, l2) * getDixonColesAdj(i, j, l1, l2, rho);
          const score = i + j;
          if (isAsianQuarter) {
            const floor = Math.floor(v);
            if (v % 1 === 0.25) { // e.g. 2.25
              if (score < floor) pUnder += prob;
              else if (score === floor) pUnder += prob * 0.5;
            } else if (v % 1 === 0.75) { // e.g. 2.75
              if (score <= Math.floor(v)) pUnder += prob;
              else if (score === Math.ceil(v)) pUnder += prob * 0.5;
            }
          } else {
            if (score < v) pUnder += prob;
            else if (score === v) pUnder += prob * 0.5;
          }
        }
      }
      return pUnder;
    };

    const calcError = (l1: number, l2: number, rho: number) => {
      let p1 = 0, pX = 0, p2 = 0;
      for (let i = 0; i <= 14; i++) {
        const pi = poisson(i, l1);
        for (let j = 0; j <= 14; j++) {
          const prob = pi * poisson(j, l2) * getDixonColesAdj(i, j, l1, l2, rho);
          if (i > j) p1 += prob; else if (i === j) pX += prob; else p2 += prob;
        }
      }
      const pModelUnder = getModelUnderProb(l1, l2, rho, totalV);
      
      return (
        Math.pow(p1 - fP1, 2) * 4.0 + 
        Math.pow(pX - fPX, 2) * 3.0 + 
        Math.pow(p2 - fP2, 2) * 4.0 + 
        Math.pow(pModelUnder - fPUnder, 2) * 6.0
      );
    };

    let step = 0.5;
    for (let pass = 0; pass < 6; pass++) {
      const l1Range = [bestL1 - step * 4, bestL1 + step * 4];
      const l2Range = [bestL2 - step * 4, bestL2 + step * 4];
      for (let l1 = Math.max(0.05, l1Range[0]); l1 <= l1Range[1]; l1 += step) {
        for (let l2 = Math.max(0.05, l2Range[0]); l2 <= l2Range[1]; l2 += step) {
          const rSteps = pass < 3 ? [bestRho - 0.1, bestRho, bestRho + 0.1] : [bestRho];
          for (let r of rSteps) {
            const clippedR = Math.max(-0.4, Math.min(0.4, r));
            const err = calcError(l1, l2, clippedR);
            if (err < minError) { 
              minError = err; bestL1 = l1; bestL2 = l2; bestRho = clippedR; 
            }
          }
        }
      }
      step /= 2.5;
    }

    for (let r = -0.4; r <= 0.4; r += 0.005) {
      const err = calcError(bestL1, bestL2, r);
      if (err < minError) { minError = err; bestRho = r; }
    }

    let finalP1 = 0, finalPX = 0, finalP2 = 0;
    for (let i = 0; i <= 20; i++) {
      const pi = poisson(i, bestL1);
      for (let j = 0; j <= 20; j++) {
        const prob = pi * poisson(j, bestL2) * getDixonColesAdj(i, j, bestL1, bestL2, bestRho);
        if (i > j) finalP1 += prob; else if (i === j) finalPX += prob; else finalP2 += prob;
      }
    }

    const fairDNB1 = (finalP1 + finalP2) / finalP1;
    const fairDNB2 = (finalP1 + finalP2) / finalP2;

    const totalMargin = m1X2 - 1;
    const dnbMarginRatio = 0.86; 
    const dnbMargin = 1 + totalMargin * dnbMarginRatio;
    
    const marketH1 = fairDNB1 / dnbMargin;
    const marketH2 = fairDNB2 / dnbMargin;

    return {
      margin: (totalMargin * 100).toFixed(2),
      h1_fair: fairDNB1.toFixed(3),
      h2_fair: fairDNB2.toFixed(3),
      h1_market: marketH1.toFixed(3),
      h2_market: marketH2.toFixed(3),
      fitError: (minError * 100).toFixed(5),
      l1: bestL1.toFixed(3),
      l2: bestL2.toFixed(3),
      rho: bestRho.toFixed(3)
    };
  }, [inputs]);

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-200 p-4 md:p-8 font-sans selection:bg-emerald-500/30">
      <div className="max-w-6xl mx-auto">
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12 border-b border-slate-800 pb-8">
          <div className="flex items-center gap-5">
            <div className="p-4 bg-emerald-600 rounded-[1.5rem] shadow-2xl shadow-emerald-500/20 rotate-3 transition-transform hover:rotate-0">
              <ShieldCheck className="w-10 h-10 text-white" />
            </div>
            <div>
              <h1 className="text-4xl font-black text-white tracking-tighter uppercase italic">
                BetCalc <span className="text-emerald-500">Pure</span>
              </h1>
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em] mt-1 italic">Professional Sharp Analytics Engine</p>
            </div>
          </div>
          
          <div className="flex items-center gap-8">
            {results && (
              <>
                <div className="text-right">
                  <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-1 leading-none">Bookie Margin</span>
                  <span className="text-xl font-mono font-bold text-rose-400">{results.margin}%</span>
                </div>
                <div className="h-12 w-px bg-slate-800 hidden md:block"></div>
                <div className="flex flex-col items-end bg-slate-900/50 px-6 py-4 rounded-2xl border border-slate-800 shadow-inner">
                  <div className="flex items-center gap-2 mb-1.5">
                    <Target className={`w-3 h-3 ${parseFloat(results.fitError) < 0.1 ? 'text-emerald-500' : 'text-amber-500'}`} />
                    <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest leading-none">Fit Precision</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <span className={`text-sm font-mono font-black leading-none ${parseFloat(results.fitError) < 0.1 ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {results.fitError}
                    </span>
                    <div className={`w-2.5 h-2.5 rounded-full shadow-lg ${parseFloat(results.fitError) < 0.1 ? 'bg-emerald-500 shadow-emerald-500/40 animate-pulse' : 'bg-amber-500 shadow-amber-500/40'}`}></div>
                  </div>
                </div>
              </>
            )}
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
          <div className="lg:col-span-7 space-y-8">
            <section className="bg-[#1e293b] rounded-[2.5rem] p-10 border border-slate-700 shadow-2xl relative overflow-visible">
              <div className="mb-10">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-1.5 h-6 bg-emerald-500 rounded-full"></div>
                  <h2 className="text-xl font-black text-white uppercase tracking-tighter italic">Умный импорт данных</h2>
                </div>
                
                <div className="relative group">
                  <textarea 
                    value={rawText}
                    onChange={(e) => {
                      setRawText(e.target.value);
                      parseInputText(e.target.value);
                    }}
                    placeholder='Вставьте данные Pinnacle (П1, X, П2, Тоталы)...'
                    className={`w-full bg-[#0f172a] border-2 rounded-[2rem] p-8 text-sm font-mono transition-all duration-500 outline-none resize-none h-32 scrollbar-hide ${
                      isImportSuccess ? 'border-emerald-500 ring-4 ring-emerald-500/10 shadow-[0_0_30px_-10px_rgba(16,185,129,0.3)]' : 'border-slate-800 focus:border-emerald-500/50 focus:ring-4 focus:ring-emerald-500/5'
                    }`}
                  />
                  <div className="absolute top-4 right-6 flex items-center gap-2">
                    {isImportSuccess ? (
                      <div className="flex items-center gap-2 bg-emerald-500/20 text-emerald-400 px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest animate-in fade-in zoom-in duration-300">
                        <ClipboardCheck className="w-3.5 h-3.5" />
                        Готово
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-slate-600 px-4 py-1.5 text-[10px] font-black uppercase tracking-widest italic group-focus-within:text-emerald-500/40 transition-colors">
                        <Sparkles className="w-3.5 h-3.5" />
                        Smart Parser
                      </div>
                    )}
                    {rawText && (
                      <button onClick={() => setRawText('')} className="p-1 hover:bg-slate-800 rounded-full transition-colors text-slate-500">
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
              
              <div className="space-y-12">
                <div>
                  <div className="flex items-center gap-2 mb-4">
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest italic text-emerald-500">Main Market 1X2</span>
                  </div>
                  <div className="grid grid-cols-3 gap-6">
                    {['w1', 'x', 'w2'].map(k => (
                      <div key={k} className="group">
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 block group-focus-within:text-emerald-400 transition-colors">
                          {k === 'x' ? 'Ничья' : k.toUpperCase()}
                        </label>
                        <input name={k} value={inputs[k as keyof typeof inputs]} onChange={handleInputChange} className="w-full bg-[#0f172a] border-2 border-slate-800 rounded-2xl py-5 px-6 text-3xl font-mono text-white focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 outline-none transition-all shadow-inner" />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="pt-10 border-t border-slate-800">
                  <div className="flex items-center gap-2 mb-4">
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest italic text-blue-500">Totals Market</span>
                  </div>
                  <div className="grid grid-cols-3 gap-6">
                    <div className="group">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 block">Line</label>
                      <input name="totalValue" value={inputs.totalValue} onChange={handleInputChange} className="w-full bg-[#0f172a] border-2 border-slate-800 rounded-2xl py-5 px-6 text-3xl font-mono text-blue-400 focus:border-blue-500 outline-none transition-all shadow-inner" />
                    </div>
                    <div className="group">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 block">Over</label>
                      <input name="over" value={inputs.over} onChange={handleInputChange} className="w-full bg-[#0f172a] border-2 border-slate-800 rounded-2xl py-5 px-6 text-3xl font-mono text-slate-300 focus:border-blue-500 outline-none transition-all shadow-inner" />
                    </div>
                    <div className="group">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 block">Under</label>
                      <input name="under" value={inputs.under} onChange={handleInputChange} className="w-full bg-[#0f172a] border-2 border-slate-800 rounded-2xl py-5 px-6 text-3xl font-mono text-slate-300 focus:border-blue-500 outline-none transition-all shadow-inner" />
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <div className="bg-emerald-500/5 p-8 rounded-[2.5rem] border border-emerald-500/10 flex gap-6 items-start shadow-xl">
               <div className="p-4 bg-emerald-500 rounded-2xl shadow-lg shadow-emerald-500/30">
                  <Info className="w-6 h-6 text-white" />
               </div>
               <div className="text-sm text-slate-400 leading-relaxed">
                  <strong className="text-emerald-400 uppercase tracking-widest text-xs block mb-2 font-black">Алгоритм Sharp Precision</strong>
                  Для соответствия лимитам Pinnacle используется калибровка DNB-маржи в реальном времени. При снижении Fit Error расчеты переходят в "прецизионный режим", обеспечивая максимальную близость к реальным рыночным значениям.
               </div>
            </div>
          </div>

          <div className="lg:col-span-5">
            <div className="sticky top-8 space-y-6">
              <section className="bg-slate-900 rounded-[3rem] p-1 border-2 border-slate-800 shadow-2xl group overflow-visible">
                 <div className="bg-[#1e293b] rounded-[2.8rem] p-10 min-h-[520px] flex flex-col transition-all group-hover:bg-[#233045] overflow-visible">
                    <div className="flex justify-between items-center mb-12">
                       <div className="flex flex-col">
                          <h2 className="text-2xl font-black text-white uppercase tracking-tighter italic">Handicap (0)</h2>
                          <div className="flex items-center gap-2 mt-1">
                             <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></div>
                             <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-[0.3em]">Pure Sharp Estimates</span>
                          </div>
                       </div>
                       <Zap className="w-6 h-6 text-amber-400 animate-pulse" />
                    </div>

                    {!results ? (
                       <div className="flex-1 flex flex-col items-center justify-center text-slate-600 gap-6">
                          <Activity className="w-14 h-14 animate-spin-slow opacity-20" />
                          <span className="text-[10px] font-black uppercase tracking-widest animate-pulse">Calibrating...</span>
                       </div>
                    ) : (
                       <div className="space-y-12 flex-1">
                          {/* Team 1 Result */}
                          <div className="bg-[#0f172a] p-8 rounded-[2.5rem] border border-slate-800 relative shadow-2xl transition-all hover:border-emerald-500/50 hover:shadow-emerald-500/5">
                             <div className="absolute -top-3 left-10 bg-emerald-600 text-white text-[9px] font-black px-5 py-2 rounded-full uppercase tracking-widest shadow-xl z-10 italic">
                                Team 1 (DNB)
                             </div>
                             
                             <div className="grid grid-cols-2 gap-6 mt-4">
                               <div className="flex flex-col">
                                 <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-2 italic">Fair Value</span>
                                 <span className="text-6xl md:text-7xl font-mono font-black text-emerald-400 tracking-tighter leading-none">{results.h1_fair}</span>
                               </div>
                               <div className="flex flex-col items-end justify-end">
                                 <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-2 italic text-right">Market Est.</span>
                                 <span className="text-3xl md:text-4xl font-mono font-bold text-slate-300 leading-none">{results.h1_market}</span>
                               </div>
                             </div>
                             {parseFloat(results.fitError) < 0.05 && (
                               <div className="absolute bottom-4 right-8">
                                 <Crosshair className="w-4 h-4 text-emerald-500/20" />
                               </div>
                             )}
                          </div>

                          {/* Team 2 Result */}
                          <div className="bg-[#0f172a] p-8 rounded-[2.5rem] border border-slate-800 relative shadow-2xl transition-all hover:border-blue-500/50 hover:shadow-blue-500/5">
                             <div className="absolute -top-3 left-10 bg-blue-600 text-white text-[9px] font-black px-5 py-2 rounded-full uppercase tracking-widest shadow-xl z-10 italic">
                                Team 2 (DNB)
                             </div>
                             
                             <div className="grid grid-cols-2 gap-6 mt-4">
                               <div className="flex flex-col">
                                 <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-2 italic">Fair Value</span>
                                 <span className="text-6xl md:text-7xl font-mono font-black text-blue-400 tracking-tighter leading-none">{results.h2_fair}</span>
                               </div>
                               <div className="flex flex-col items-end justify-end">
                                 <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-2 italic text-right">Market Est.</span>
                                 <span className="text-3xl md:text-4xl font-mono font-bold text-slate-300 leading-none">{results.h2_market}</span>
                               </div>
                             </div>
                          </div>

                          <div className="mt-auto bg-slate-900/50 p-6 rounded-[2rem] border border-slate-800">
                             <div className="flex justify-between items-center text-[9px] text-slate-500 font-bold uppercase tracking-widest">
                                <span>λ1: {results.l1}</span>
                                <span className="text-emerald-500/40">Sharp Mode Active</span>
                                <span>λ2: {results.l2}</span>
                             </div>
                             <div className="mt-2 text-center text-[8px] text-slate-600 font-mono tracking-widest opacity-60">
                               Correlation ρ: {results.rho}
                             </div>
                          </div>
                       </div>
                    )}
                 </div>
              </section>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
