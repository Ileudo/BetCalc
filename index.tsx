
import React, { useState, useMemo, Component, ErrorInfo, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { ShieldCheck, Zap, Activity, ClipboardCheck, X, Target, Crosshair, AlertTriangle, RefreshCw } from 'lucide-react';

// --- TYPES ---

interface InputState {
  w1: string;
  x: string;
  w2: string;
  totalValue: string;
  over: string;
  under: string;
}

interface HandicapResult {
  h1_fair: string;
  h2_fair: string;
  h1_market: string;
  h2_market: string;
}

interface CalculationResult {
  margin: string;
  fitError: string;
  h0: HandicapResult;
  hm025: HandicapResult;
  hp025: HandicapResult;
}

// --- ERROR BOUNDARY ---

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  // FIX: Use class property for state initialization. The constructor-based approach was causing typing errors where `this.state` and `this.props` were not recognized.
  state = { hasError: false };

  static getDerivedStateFromError(_: Error) {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-full w-full flex flex-col items-center justify-center bg-[#0f172a] text-slate-400 p-8 text-center border border-slate-800 rounded-3xl m-4">
          <AlertTriangle className="w-12 h-12 text-amber-500 mb-4" />
          <h2 className="text-xl font-bold text-white mb-2">Interface Error</h2>
          <p className="mb-4 text-sm">Something went wrong while rendering the data.</p>
          <button 
            onClick={() => this.setState({ hasError: false })}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-white text-xs font-bold uppercase transition-colors"
          >
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// --- MATH UTILITIES ---

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

const removeMarginPower = (odds: number[]): number[] => {
  try {
    const invOdds = odds.map(o => (o > 0 ? 1 / o : 0));
    if (invOdds.some(v => v === 0)) return odds.map(() => 0); // Safety check

    let k = 1.0;
    let step = 0.1;
    
    // Iterative solver for k
    for (let i = 0; i < 50; i++) {
      const sum = invOdds.reduce((acc, p) => acc + Math.pow(p, k), 0);
      if (Math.abs(sum - 1) < 0.0000001) break;
      if (sum > 1) k += step; else k -= step;
      if (sum > 1 && step > 0.0000001) step *= 0.5; 
    }
    
    // Refine
    let minK = 0.05, maxK = 15.0;
    for (let i = 0; i < 30; i++) {
      const midK = (minK + maxK) / 2;
      const sum = invOdds.reduce((acc, p) => acc + Math.pow(p, midK), 0);
      if (sum > 1) minK = midK; else maxK = midK;
      k = midK;
    }

    return invOdds.map(p => Math.pow(p, k));
  } catch (e) {
    console.warn("Margin removal failed", e);
    return odds.map(o => 1/o); // Fallback to raw probabilities
  }
};

// --- CORE CALCULATION LOGIC ---

const calculateOdds = (inputs: InputState): CalculationResult | null => {
  try {
    const w1 = parseFloat(inputs.w1) || 0;
    const x = parseFloat(inputs.x) || 0;
    const w2 = parseFloat(inputs.w2) || 0;
    const totalV = parseFloat(inputs.totalValue) || 2.5;
    const over = parseFloat(inputs.over) || 0;
    const under = parseFloat(inputs.under) || 0;

    if (w1 <= 1 || x <= 1 || w2 <= 1 || over <= 1 || under <= 1) return null;

    const [fP1, fPX, fP2] = removeMarginPower([w1, x, w2]);
    const [fPOver, fPUnder] = removeMarginPower([over, under]);

    const m1X2 = 1/w1 + 1/x + 1/w2;

    const initL = Math.max(0.4, totalV / 2);
    let bestL1 = initL, bestL2 = initL, bestRho = 0;
    let minError = Infinity;

    const isDrawHeavy = x < 2.95;
    const w_P1 = 20.0;
    const w_P2 = 20.0;
    const w_PX = isDrawHeavy ? 35.0 : 12.0; 
    const w_Tot = 10.0;

    const getModelUnderProb = (l1: number, l2: number, rho: number, v: number) => {
      let pUnder = 0;
      let pPush = 0;
      const isInteger = v % 1 === 0;
      const isHalf = v % 1 === 0.5;
      const isQuarter = !isInteger && !isHalf;

      for (let i = 0; i <= 14; i++) {
        const pi = poisson(i, l1);
        for (let j = 0; j <= 14; j++) {
          const prob = pi * poisson(j, l2) * getDixonColesAdj(i, j, l1, l2, rho);
          const score = i + j;

          if (isInteger) {
            if (score < v) pUnder += prob;
            else if (score === v) pPush += prob;
          } else if (isQuarter) {
             const floor = Math.floor(v);
             if (Math.abs(v % 1 - 0.25) < 0.01) { // -0.25 type logic
                if (score < floor) pUnder += prob;
                else if (score === floor) pUnder += prob * 0.5;
             } else if (Math.abs(v % 1 - 0.75) < 0.01) { // -0.75 type logic
                if (score <= Math.floor(v)) pUnder += prob;
                else if (score === Math.ceil(v)) pUnder += prob * 0.5;
             }
          } else {
             if (score < v) pUnder += prob;
          }
        }
      }

      if (isInteger) {
        return pPush >= 0.99 ? 0 : pUnder / (1 - pPush);
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
        Math.pow(p1 - fP1, 2) * w_P1 + 
        Math.pow(pX - fPX, 2) * w_PX + 
        Math.pow(p2 - fP2, 2) * w_P2 + 
        Math.pow(pModelUnder - fPUnder, 2) * w_Tot
      );
    };

    let step = 0.4;
    for (let pass = 0; pass < 9; pass++) {
      const l1Range = [bestL1 - step * 3, bestL1 + step * 3];
      const l2Range = [bestL2 - step * 3, bestL2 + step * 3];
      
      const startL1 = Math.max(0.01, l1Range[0]);
      const startL2 = Math.max(0.01, l2Range[0]);

      // Safety break for loop limits
      const endL1 = Math.min(l1Range[1], 10);
      const endL2 = Math.min(l2Range[1], 10);

      for (let l1 = startL1; l1 <= endL1; l1 += step) {
        for (let l2 = startL2; l2 <= endL2; l2 += step) {
          const rSteps = pass < 4 
            ? [bestRho - 0.15, bestRho - 0.05, bestRho, bestRho + 0.05, bestRho + 0.15] 
            : [bestRho];

          for (let r of rSteps) {
            const clippedR = Math.max(-0.45, Math.min(0.45, r));
            const err = calcError(l1, l2, clippedR);
            if (err < minError) { 
              minError = err; bestL1 = l1; bestL2 = l2; bestRho = clippedR; 
            }
          }
        }
      }
      step /= 2.2;
    }

    // Final Refinement for Rho
    for (let r = -0.45; r <= 0.45; r += 0.002) { // increased step slightly for perf
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

    const totalMargin = m1X2 - 1;
    // Cap margin adjustment to realistic bounds to prevent divide by zero
    const ahMargin = Math.max(1.01, Math.min(1.10, 1 + totalMargin * 0.82));

    const safeDiv = (val: number, margin: number) => (val > 0.0001 ? (val / margin).toFixed(3) : "---");
    const safeRaw = (val: number) => (val > 0.0001 ? val.toFixed(3) : "---");

    // DNB
    const fairDNB1 = finalP1 / (finalP1 + finalP2); // Normalized
    const fairDNB2 = finalP2 / (finalP1 + finalP2); // Normalized

    // -0.25 (T1 -0.25, T2 +0.25)
    // T1 Wins: Full Win. Draw: Half Loss. T2 Win: Loss.
    // T1 -0.25 equivalent Prob: P(T1) + 0.5 * P(X) ??? No, 
    // Handi -0.25: Win if Team wins. Half Lose if Draw.
    // Equity = P(Win) * 1 + P(Draw) * 0.5.
    // Odds = 1 / Equity.
    const eq_T1_m025 = finalP1 + 0.5 * finalPX; // Probability of winning (half win on draw? No, -0.25 loses half on draw).
    
    // Correct logic for Asian Handicap -0.25 / +0.25 conversion to Odds
    // T1 (-0.25): Win=Win. Draw=Half Loss.
    // To calculate fair odds: 
    // We need the probability that makes the bet a "winner".
    // Actually, simple conversion: 
    const fair_T1_m025_dec = (1 - 0.5 * finalPX) / finalP1; // From original code
    const fair_T2_p025_dec = (1 - 0.5 * finalPX) / (finalP2 + 0.5 * finalPX); // From original code

    const fair_T1_p025_dec = (1 - 0.5 * finalPX) / (finalP1 + 0.5 * finalPX);
    const fair_T2_m025_dec = (1 - 0.5 * finalPX) / finalP2;

    const fairDNB1_dec = 1/fairDNB1;
    const fairDNB2_dec = 1/fairDNB2;

    return {
      margin: (totalMargin * 100).toFixed(2),
      fitError: (minError * 100).toFixed(6),
      
      h0: {
        h1_fair: safeRaw(fairDNB1_dec),
        h2_fair: safeRaw(fairDNB2_dec),
        h1_market: safeDiv(fairDNB1_dec, ahMargin),
        h2_market: safeDiv(fairDNB2_dec, ahMargin)
      },
      
      hm025: {
        h1_fair: safeRaw(fair_T1_m025_dec),
        h2_fair: safeRaw(fair_T2_p025_dec),
        h1_market: safeDiv(fair_T1_m025_dec, ahMargin),
        h2_market: safeDiv(fair_T2_p025_dec, ahMargin)
      },

      hp025: {
        h1_fair: safeRaw(fair_T1_p025_dec),
        h2_fair: safeRaw(fair_T2_m025_dec),
        h1_market: safeDiv(fair_T1_p025_dec, ahMargin),
        h2_market: safeDiv(fair_T2_m025_dec, ahMargin)
      }
    };
  } catch (err) {
    console.error("Calculation Error", err);
    return null;
  }
};

// --- SUB-COMPONENTS ---

const InputCard = ({ 
  label, 
  inputs, 
  onChange, 
  keys,
  colors 
}: { 
  label: string, 
  inputs: InputState, 
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void,
  keys: { key: keyof InputState, label: string }[],
  colors: string[]
}) => (
  <div className="bg-[#1e293b] p-6 rounded-3xl border border-slate-700 shadow-xl">
    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3 block">{label}</span>
    <div className="grid grid-cols-3 gap-3">
      {keys.map((k, idx) => (
        <div key={k.key} className="bg-[#0f172a] p-3 rounded-xl border border-slate-800 focus-within:border-slate-600 transition-colors">
          <span className={`block text-xs ${colors[idx] || 'text-slate-500'} font-bold mb-1 uppercase`}>
            {k.label}
          </span>
          <input 
            name={k.key} 
            value={inputs[k.key]} 
            onChange={onChange} 
            className={`w-full bg-transparent text-xl font-mono outline-none font-bold ${colors[idx] ? 'text-white' : 'text-slate-300'}`}
          />
        </div>
      ))}
    </div>
  </div>
);

const ResultsTable = ({ results }: { results: CalculationResult }) => (
  <div className="h-48 bg-[#1e293b] rounded-3xl border border-slate-800 p-0 flex flex-col justify-center">
    <div className="w-full px-8">
      <table className="w-full text-center border-collapse">
        <thead>
          <tr className="text-[10px] font-black text-slate-500 uppercase tracking-widest border-b border-slate-700/50">
            <th className="pb-3 text-center w-1/3">HANDICAP</th>
            <th className="pb-3 text-center w-1/3">TEAM 1 (MKT)</th>
            <th className="pb-3 text-center w-1/3">TEAM 2 (MKT)</th>
          </tr>
        </thead>
        <tbody className="font-mono text-sm">
          <tr className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
            <td className="py-3 text-center font-bold text-slate-300">-0.25</td>
            <td className="text-center text-white font-bold">{results.hm025.h1_market}</td>
            <td className="text-center text-emerald-400 font-bold">{results.hp025.h2_market}</td>
          </tr>
          <tr className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
            <td className="py-3 text-center font-bold text-slate-300">0</td>
            <td className="text-center text-white font-bold">{results.h0.h1_market}</td>
            <td className="text-center text-blue-400 font-bold">{results.h0.h2_market}</td>
          </tr>
          <tr className="hover:bg-slate-800/30 transition-colors">
            <td className="py-3 text-center font-bold text-slate-300">+0.25</td>
            <td className="text-center text-white font-bold">{results.hp025.h1_market}</td>
            <td className="text-center text-white font-bold">{results.hm025.h2_market}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
);

const MetricTooltip = ({ title, value, info }: { title: string, value: ReactNode, info: string }) => (
  <div className="group relative flex flex-col items-end cursor-help">
    <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest border-b border-dotted border-slate-700 group-hover:border-emerald-500/50 group-hover:text-emerald-500/80 transition-all duration-300 mb-0.5">{title}</span>
    {value}
    <div className="absolute top-full right-0 mt-4 w-64 p-4 bg-[#0f172a] rounded-xl border border-slate-700 shadow-2xl opacity-0 translate-y-2 invisible group-hover:opacity-100 group-hover:translate-y-0 group-hover:visible transition-all duration-300 z-50 pointer-events-none">
      <div className="absolute -top-1.5 right-6 w-3 h-3 bg-[#0f172a] border-t border-l border-slate-700 transform rotate-45"></div>
      <div className="flex gap-3">
         <div className="mt-0.5 min-w-[16px] h-4 rounded-full bg-slate-800 border border-slate-600 flex items-center justify-center text-[10px] font-bold text-slate-400">i</div>
         <p className="text-xs font-medium text-slate-300 leading-relaxed text-left">{info}</p>
      </div>
    </div>
  </div>
);

// --- MAIN APP ---

function App() {
  const [inputs, setInputs] = useState<InputState>({
    w1: '2.13',
    x: '3.22',
    w2: '3.29',
    totalValue: '2.00',
    over: '1.787',
    under: '2.01',
  });

  const [rawText, setRawText] = useState('');
  const [isImportSuccess, setIsImportSuccess] = useState(false);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    // Allow digits, dots, commas. Replace comma with dot for state logic if needed, 
    // but better to keep UI flexible and parse on calc.
    // Here we normalize immediately to keep state clean.
    const normalizedValue = value.replace(',', '.');
    if (/^\d*\.?\d*$/.test(normalizedValue)) {
      setInputs(prev => ({ ...prev, [name]: normalizedValue }));
    }
  };

  const parseInputText = (text: string) => {
    try {
      const findValue = (regex: RegExp) => {
        const match = text.match(regex);
        return match ? match[1].trim().replace(',', '.') : null;
      };

      const num = "(\\d+(?:[.,]\\d+)?)";
      const overLineMatch = text.match(new RegExp(`ТБ\\((${num})\\)\\s*=\\s*${num}`, 'i'));
      const underLineMatch = text.match(new RegExp(`ТМ\\((${num})\\)\\s*=\\s*${num}`, 'i'));
      
      let parsedTotal = null;
      let overVal = findValue(new RegExp(`ТБ\\([\\d.,]+\\)\\s*=\\s*${num}`, 'i'));
      let underVal = findValue(new RegExp(`ТМ\\([\\d.,]+\\)\\s*=\\s*${num}`, 'i'));

      // Smart total detection logic
      if (overLineMatch && underLineMatch) {
        const l1 = parseFloat(overLineMatch[1].replace(',', '.'));
        const l2 = parseFloat(underLineMatch[1].replace(',', '.'));
        const o1 = parseFloat(overVal || '0');
        const o2 = parseFloat(underVal || '0');
        
        // Pick the line closest to 2.0 odds as the "main" line
        if (Math.abs(l1 - l2) > 0.01) {
          parsedTotal = (Math.abs(o1 - 2.0) < Math.abs(o2 - 2.0)) ? l1.toString() : l2.toString();
        } else {
          parsedTotal = l1.toString();
        }
      } else if (overLineMatch) {
        parsedTotal = overLineMatch[1].replace(',', '.');
      } else if (underLineMatch) {
        parsedTotal = underLineMatch[1].replace(',', '.');
      } else {
        parsedTotal = findValue(new RegExp(`ТБ\\(${num}\\)`, 'i'));
      }

      const parsedData = {
        w1: findValue(new RegExp(`П1\\s*=\\s*${num}`, 'i')),
        x: findValue(new RegExp(`X\\s*=\\s*${num}`, 'i')),
        w2: findValue(new RegExp(`П2\\s*=\\s*${num}`, 'i')),
        totalValue: parsedTotal,
        over: overVal,
        under: underVal,
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
    } catch (e) {
      console.error("Parse Error", e);
    }
  };

  const results = useMemo(() => calculateOdds(inputs), [inputs]);

  return (
    <div className="h-screen w-full bg-[#0f172a] text-slate-200 font-sans selection:bg-emerald-500/30 overflow-hidden flex flex-col p-6">
      <div className="flex-1 max-w-[1920px] mx-auto w-full grid grid-cols-12 gap-8">
        
        {/* LEFT COLUMN: Input & Verification */}
        <div className="col-span-4 flex flex-col gap-8 h-full">
           {/* Branding */}
           <div className="flex items-center gap-3">
              <div className="p-2.5 bg-emerald-600 rounded-xl shadow-lg shadow-emerald-500/20">
                <ShieldCheck className="w-6 h-6 text-white" />
              </div>
              <h1 className="text-xl font-black text-white uppercase tracking-tighter italic">
                BetCalc <span className="text-emerald-500">Pure</span>
              </h1>
           </div>

           {/* Smart Input */}
           <div className="relative group flex-shrink-0">
              <textarea 
                value={rawText}
                onChange={(e) => {
                  setRawText(e.target.value);
                  parseInputText(e.target.value);
                }}
                placeholder='Paste Pinnacle Data Here...'
                className={`w-full bg-[#1e293b] border-2 rounded-2xl p-6 text-xs font-mono transition-all duration-300 outline-none resize-none h-64 overflow-y-auto shadow-lg ${
                  isImportSuccess ? 'border-emerald-500 ring-4 ring-emerald-500/10' : 'border-slate-800 focus:border-emerald-500/50'
                }`}
              />
              <div className="absolute top-3 right-3">
                {isImportSuccess ? (
                  <div className="flex items-center gap-1 text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-md text-[10px] font-black uppercase tracking-widest">
                    <ClipboardCheck className="w-3 h-3" /> OK
                  </div>
                ) : (
                  <div className="text-slate-600 text-[10px] font-black uppercase tracking-widest">Parser</div>
                )}
              </div>
           </div>

           {/* Manual Inputs / Verification */}
           <div className="flex-1 flex flex-col gap-4">
              <InputCard 
                label="1X2 Odds"
                inputs={inputs}
                onChange={handleInputChange}
                keys={[
                  { key: 'w1', label: '1' },
                  { key: 'x', label: 'X' },
                  { key: 'w2', label: '2' }
                ]}
                colors={['text-white', 'text-white', 'text-white']}
              />
              <InputCard 
                label="Totals"
                inputs={inputs}
                onChange={handleInputChange}
                keys={[
                  { key: 'totalValue', label: 'Line' },
                  { key: 'over', label: 'Over' },
                  { key: 'under', label: 'Under' }
                ]}
                colors={['text-blue-400', 'text-slate-300', 'text-slate-300']}
              />
           </div>
        </div>

        {/* RIGHT COLUMN: Results & Analysis */}
        <div className="col-span-8 flex flex-col h-full gap-6">
           <ErrorBoundary>
             {/* Top Bar: Quality Metrics */}
             <div className="h-16 flex items-center justify-between bg-[#1e293b] rounded-2xl px-8 border border-slate-800 shadow-lg shrink-0">
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-2">
                     <Activity className="w-4 h-4 text-emerald-500" />
                     <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Status: <span className="text-emerald-400">Optimal</span></span>
                  </div>
                </div>
                
                <div className="flex items-center gap-12">
                   {results && (
                     <>
                       <MetricTooltip 
                         title="Bookie Margin" 
                         info="The theoretical profit margin (overround) embedded in the bookmaker's odds. Lower margins (<2.5%) generally imply 'fairer' prices for the bettor."
                         value={<span className="text-lg font-mono font-bold text-rose-400">{results.margin}%</span>}
                       />
                       <MetricTooltip 
                         title="Fit Precision" 
                         info="Calculated error (MSE) of the Poisson/Dixon-Coles model calibration. Values below 0.05 indicate the model accurately reflects the market's goal distribution."
                         value={
                           <div className="flex items-center gap-2">
                             <span className={`text-lg font-mono font-bold ${parseFloat(results.fitError) < 0.05 ? 'text-emerald-400' : 'text-amber-400'}`}>{results.fitError}</span>
                             <Target className={`w-4 h-4 ${parseFloat(results.fitError) < 0.05 ? 'text-emerald-500' : 'text-amber-500'}`} />
                           </div>
                         }
                       />
                     </>
                   )}
                </div>
             </div>

             {/* MAIN ACTION AREA: Priority Handicaps */}
             <div className="flex-1 grid grid-cols-2 gap-6 overflow-hidden">
                {/* Handicap 2 (0) */}
                <div className="bg-gradient-to-br from-[#1e293b] to-[#0f172a] rounded-[2.5rem] border border-slate-700 p-8 relative overflow-hidden group hover:border-blue-500/50 transition-colors flex flex-col">
                    <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:opacity-10 transition-opacity">
                      <ShieldCheck className="w-32 h-32 text-blue-500" />
                    </div>
                    <div className="relative z-10 flex flex-col h-full justify-between">
                       <div>
                          <div className="inline-flex items-center gap-2 bg-blue-500/10 text-blue-400 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest mb-4">
                             Target 1
                          </div>
                          <h2 className="text-3xl font-black text-white uppercase tracking-tighter">Team 2 (0)</h2>
                          <p className="text-slate-500 text-xs font-medium mt-1">Draw No Bet • Away</p>
                       </div>

                       <div className="space-y-2 mt-auto">
                          <div className="flex items-baseline justify-between">
                             <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Market Est.</span>
                             <span className="text-7xl font-mono font-black text-blue-400 tracking-tighter">
                               {results ? results.h0.h2_market : '---'}
                             </span>
                          </div>
                          <div className="flex items-baseline justify-between border-t border-slate-800 pt-2">
                             <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Fair Value</span>
                             <span className="text-2xl font-mono font-bold text-slate-400">
                               {results ? results.h0.h2_fair : '---'}
                             </span>
                          </div>
                       </div>
                    </div>
                </div>

                {/* Handicap 2 (-0.25) */}
                <div className="bg-gradient-to-br from-[#1e293b] to-[#0f172a] rounded-[2.5rem] border border-slate-700 p-8 relative overflow-hidden group hover:border-emerald-500/50 transition-colors flex flex-col">
                    <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:opacity-10 transition-opacity">
                      <Crosshair className="w-32 h-32 text-emerald-500" />
                    </div>
                    <div className="relative z-10 flex flex-col h-full justify-between">
                       <div>
                          <div className="inline-flex items-center gap-2 bg-emerald-500/10 text-emerald-400 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest mb-4">
                             Target 2
                          </div>
                          <h2 className="text-3xl font-black text-white uppercase tracking-tighter">Team 2 (-0.25)</h2>
                          <p className="text-slate-500 text-xs font-medium mt-1">Asian Handicap • Away</p>
                       </div>

                       <div className="space-y-2 mt-auto">
                          <div className="flex items-baseline justify-between">
                             <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Market Est.</span>
                             <span className="text-7xl font-mono font-black text-emerald-400 tracking-tighter">
                               {results ? results.hm025.h2_market : '---'}
                             </span>
                          </div>
                          <div className="flex items-baseline justify-between border-t border-slate-800 pt-2">
                             <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Fair Value</span>
                             <span className="text-2xl font-mono font-bold text-slate-400">
                               {results ? results.hm025.h2_fair : '---'}
                             </span>
                          </div>
                       </div>
                    </div>
                </div>
             </div>

             {/* SECONDARY: Full Table Verification */}
             {results && <ResultsTable results={results} />}
           </ErrorBoundary>
        </div>
      </div>
    </div>
  );
}

const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(<App />);
}
