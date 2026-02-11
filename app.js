import React, { useState, useMemo, useRef, useEffect } from 'react';
import { 
  CheckCircle, 
  AlertCircle, 
  RefreshCcw, 
  FileText, 
  X, 
  Zap, 
  Info, 
  Lightbulb, 
  Trash2,
  Play,
  Check,
  AlertTriangle,
  HelpCircle
} from 'lucide-react';

// --- 定数定義 (JIS規格・施工条件準拠) ---
const COLORS = {
  black: { hex: '#1e293b', label: '黒', stroke: '#1e293b' },
  white: { hex: '#ffffff', label: '白', stroke: '#94a3b8' },
  red: { hex: '#ef4444', label: '赤', stroke: '#ef4444' }
};

const THICKNESS_OPTS = {
  1.6: { stroke: 5, label: '1.6', score: 1 },
  2.0: { stroke: 9, label: '2.0', score: 2 }
};

const STAMP_OPTS = ["○", "小", "中"];

// レイアウト定数 (視認性確保のため器具をボックスから離して配置)
const JOINT_BOX = { x: 175, y: 100, w: 250, h: 220, centerX: 300, centerY: 210 };
const SNAP_RADIUS = 25; 
const LONG_PRESS_MS = 1000;

const COMPONENTS = [
  { id: 'pwr', label: '電源 (遮断器)', x: 60, y: 150, type: 'breaker', labelPos: 'top' },
  { id: 'lmp', label: '引掛シーリング', x: 300, y: 40, type: 'lamp', labelPos: 'top' },
  { id: 'swi', label: 'スイッチ', x: 300, y: 405, type: 'switch', labelPos: 'bottom' },
  { id: 'out', label: 'コンセント', x: 60, y: 405, type: 'outlet', labelPos: 'bottom' },
  { id: 'omt', label: '施工省略 (負荷)', x: 540, y: 150, type: 'omitted', labelPos: 'top' },
];

const TERMINAL_DEFS = [
  { id: 'p_n', parentId: 'pwr', ox: 45, oy: -20, isW: true, label: 'W', role: '電源N' },
  { id: 'p_l', parentId: 'pwr', ox: 45, oy: 20, isW: false, label: 'L', role: '電源L' },
  { id: 'r_n', parentId: 'lmp', ox: -25, oy: 0, isW: true, label: 'W', role: 'シーリングW' },
  { id: 'r_s', parentId: 'lmp', ox: 25, oy: 0, isW: false, label: '', role: 'シーリングL' },
  { id: 's_l', parentId: 'swi', ox: -25, oy: 0, isW: false, label: 'L', role: 'スイッチL' },
  { id: 's_s', parentId: 'swi', ox: 25, oy: 0, isW: false, label: 'S', role: 'スイッチS' },
  { id: 'c_n', parentId: 'out', ox: 25, oy: -15, isW: true, label: 'W', role: 'コンセントW' },
  { id: 'c_l', parentId: 'out', ox: 25, oy: 15, isW: false, label: 'L', role: 'コンセントL' },
  { id: 'o_n', parentId: 'omt', ox: -35, oy: -20, isW: true, label: 'W', role: '省略負荷W' },
  { id: 'o_s', parentId: 'omt', ox: -35, oy: 20, isW: false, label: '', role: '省略負荷L' },
];

export default function App() {
  // --- States ---
  const [joints, setJoints] = useState([]); 
  const [segments, setSegments] = useState([]); 
  const [selectedTerminal, setSelectedTerminal] = useState(null);
  const [currentColor, setCurrentColor] = useState('black');
  const [currentThickness, setCurrentThickness] = useState(1.6);
  const [showSLD, setShowSLD] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [editingJointId, setEditingJointId] = useState(null);
  const [judgment, setJudgment] = useState(null);
  
  const [pressingId, setPressingId] = useState(null);
  const timerRef = useRef(null);
  const svgRef = useRef(null);

  // 端末座標の算出
  const terminals = useMemo(() => {
    return TERMINAL_DEFS.map(t => {
      const parent = COMPONENTS.find(c => c.id === t.parentId);
      return { ...t, x: parent.x + t.ox, y: parent.y + t.oy };
    });
  }, []);

  // L字配線計算ロジック
  const getLPath = (t, j) => {
    if (!t || !j) return "";
    return `M ${t.x} ${t.y} L ${j.x} ${t.y} L ${j.x} ${j.y}`;
  };

  // --- Handlers ---

  const handleAllClear = () => {
    setSegments([]);
    setJoints([]);
    setSelectedTerminal(null);
    setEditingJointId(null);
    setJudgment(null);
    setPressingId(null);
    setShowResetConfirm(false);
  };

  const handleTerminalClick = (e, id) => {
    e.stopPropagation();
    setEditingJointId(null);
    setSelectedTerminal(id === selectedTerminal ? null : id);
    setJudgment(null);
  };

  const handleCanvasClick = (e) => {
    if (editingJointId) {
      setEditingJointId(null);
      return;
    }
    if (!selectedTerminal) return;

    const svg = svgRef.current;
    const rect = svg.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (600 / rect.width);
    const y = (e.clientY - rect.top) * (450 / rect.height);

    // ボックス経由ルール：ボックス外のタップは無効
    const margin = 20;
    if (x < JOINT_BOX.x - margin || x > JOINT_BOX.x + JOINT_BOX.w + margin || 
        y < JOINT_BOX.y - margin || y > JOINT_BOX.y + JOINT_BOX.h + margin) {
      return;
    }

    const snapTarget = joints.find(j => Math.hypot(j.x - x, j.y - y) < SNAP_RADIUS);

    if (snapTarget) {
      if (!segments.some(s => s.terminalId === selectedTerminal && s.jointId === snapTarget.id)) {
        setSegments(prev => [...prev, { 
          id: `seg-${Date.now()}`, 
          terminalId: selectedTerminal, 
          jointId: snapTarget.id, 
          color: currentColor,
          thickness: currentThickness 
        }]);
      }
    } else {
      const newId = `joint-${Date.now()}`;
      setJoints(prev => [...prev, { id: newId, x, y, stamp: "" }]);
      setSegments(prev => [...prev, { 
        id: `seg-${Date.now()}`, 
        terminalId: selectedTerminal, 
        jointId: newId, 
        color: currentColor,
        thickness: currentThickness 
      }]);
    }
    setSelectedTerminal(null);
  };

  const handleJointClick = (e, jointId) => {
    e.stopPropagation();
    if (selectedTerminal) {
      handleCanvasClick(e);
      return;
    }
    const connectedCount = segments.filter(s => s.jointId === jointId).length;
    if (connectedCount >= 2) {
      setEditingJointId(jointId);
    }
    setJudgment(null);
  };

  const selectStamp = (stamp) => {
    setJoints(prev => prev.map(j => j.id === editingJointId ? { ...j, stamp } : j));
    setEditingJointId(null);
  };

  // --- Deletion Logic ---
  const startLongPress = (e, segId) => {
    e.preventDefault();
    setPressingId(segId);
    timerRef.current = setTimeout(() => {
      executeDelete(segId);
    }, LONG_PRESS_MS);
  };

  const cancelLongPress = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setPressingId(null);
  };

  const executeDelete = (segId) => {
    setSegments(prev => {
      const target = prev.find(s => s.id === segId);
      if (!target) return prev;
      const nextSegs = prev.filter(s => s.id !== segId);
      const jointId = target.jointId;
      if (nextSegs.filter(s => s.jointId === jointId).length === 0) {
        setJoints(js => js.filter(j => j.id !== jointId));
      }
      return nextSegs;
    });
    setPressingId(null);
    setJudgment(null);
  };

  // --- 合否判定 (経路・色・太さ・刻印) ---
  const runJudge = () => {
    const errors = [];
    const advice = [];
    
    if (segments.length === 0) {
      setJudgment({ success: false, msg: "配線がありません。", advice: "施工を開始してください。" });
      return;
    }

    // 1. 経路・色チェック
    const nSeg = segments.find(s => s.terminalId === 'p_n');
    if (!nSeg) {
      errors.push("電源の接地側(N)が未結線です。");
    } else {
      const nJointId = nSeg.jointId;
      const nGroup = segments.filter(s => s.jointId === nJointId);
      terminals.filter(t => t.isW).forEach(t => {
        const seg = nGroup.find(s => s.terminalId === t.id);
        if (!seg) errors.push(`${t.role} が接地されていません。`);
        else if (seg.color !== 'white') errors.push(`${t.role} が白線ではありません。`);
      });
    }

    // 2. 太さチェック (電源2.0 / 他1.6)
    segments.forEach(s => {
      const term = terminals.find(t => t.id === s.terminalId);
      if (term.parentId === 'pwr') {
        if (s.thickness !== 2.0) {
          errors.push("電源引込線の太さが不正。");
          advice.push("電源(B)からの線は「2.0mm」で施工してください。");
        }
      } else {
        if (s.thickness !== 1.6) {
          errors.push(`${term.role} の太さが不正。`);
          advice.push("器具への送りは「1.6mm」を使用してください。");
        }
      }
    });

    // 3. リングスリーブ刻印判定
    joints.forEach(j => {
      const jointSegs = segments.filter(s => s.jointId === j.id);
      if (jointSegs.length < 2) return;
      let score = 0; let count16 = 0;
      jointSegs.forEach(s => { score += (s.thickness === 2.0 ? 2 : 1); if (s.thickness === 1.6) count16++; });
      let correct = "";
      if (score === 2 && count16 === 2) correct = "○";
      else if (score >= 3 && score <= 4) correct = "小";
      else if (score >= 5 && score <= 8) correct = "中";
      
      if (!j.stamp || j.stamp !== correct) {
        errors.push(`接続点の刻印ミス。`);
        advice.push(`合計${score}点の場合の正解は「${correct}」です。`);
      }
    });

    if (errors.length === 0) {
      setJudgment({ success: true, msg: "合格！完璧です。", advice: "本番でもこの冷静さを保って施工してください。" });
    } else {
      setJudgment({ success: false, msg: "不合格", advice: errors[0] + (advice[0] ? " " + advice[0] : "") });
    }
  };

  return (
    <div className="flex flex-col h-[100dvh] bg-white font-sans text-slate-800 overflow-hidden select-none" style={{ touchAction: 'manipulation' }}>
      {/* Header */}
      <header className="bg-slate-900 h-11 flex justify-between items-center px-4 shadow-md shrink-0 z-40">
        <div className="flex items-center gap-2">
          <h2 className="text-white text-[11px] font-black tracking-tighter uppercase flex items-center gap-1">
            <Zap size={13} className="text-yellow-400" fill="currentColor" />
            No.1 Master V26
          </h2>
          <button onClick={() => setShowSLD(true)} className="bg-slate-700 hover:bg-slate-600 text-white text-[9px] font-bold px-2 py-1 rounded transition">単線図</button>
          <button onClick={() => setShowManual(true)} className="p-1 text-slate-400 hover:text-white transition"><HelpCircle size={18} /></button>
        </div>
        <button onClick={runJudge} className="bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-1.5 rounded-lg text-[10px] font-black shadow-lg flex items-center gap-1 active:scale-95 transition">
          <Play size={10} fill="currentColor" /> 判定実行
        </button>
      </header>

      {/* Main Board */}
      <main className="flex-1 relative bg-slate-100/30 flex flex-col items-center justify-center p-1 overflow-hidden">
        <div className="w-full h-full max-w-5xl bg-white relative overflow-hidden">
          <svg 
            ref={svgRef}
            viewBox="0 0 600 450" 
            className="w-full h-full touch-none" 
            onClick={handleCanvasClick}
            onPointerLeave={cancelLongPress}
            onContextMenu={(e) => e.preventDefault()}
          >
            <defs>
              <pattern id="dotGrid" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1" fill="#e2e8f0" /></pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#dotGrid)" />
            <rect x={JOINT_BOX.x} y={JOINT_BOX.y} width={JOINT_BOX.w} height={JOINT_BOX.h} rx="20" fill="#f8fafc" stroke="#e2e8f0" strokeWidth="1.5" strokeDasharray="6 3" />

            {/* Components */}
            {COMPONENTS.map(c => {
              const stroke = "#334155";
              const isTop = c.labelPos === 'top';
              return (
                <g key={c.id}>
                  {c.type === 'breaker' && <rect x={c.x-40} y={c.y-35} width="80" height="70" fill="white" stroke={stroke} strokeWidth="2.5" rx="4" />}
                  {c.type === 'lamp' && <circle cx={c.x} cy={c.y} r="32" fill="white" stroke={stroke} strokeWidth="2.5" />}
                  {c.type === 'switch' && <circle cx={c.x} cy={c.y} r="26" fill="white" stroke={stroke} strokeWidth="2.5" />}
                  {c.type === 'outlet' && <circle cx={c.x} cy={c.y} r="32" fill="white" stroke={stroke} strokeWidth="2.5" />}
                  {c.type === 'omitted' && <rect x={c.x-35} y={c.y-35} width="70" height="70" fill="none" stroke="#94a3b8" strokeWidth="1.8" strokeDasharray="5" rx="8" />}
                  {c.type === 'breaker' && <text x={c.x} y={c.y+12} textAnchor="middle" className="text-xl font-black fill-slate-100 italic">B</text>}
                  {c.type === 'lamp' && <><line x1={c.x-20} y1={c.y-20} x2={c.x+20} y2={c.y+20} stroke={stroke} strokeWidth="2.5" /><line x1={c.x+20} y1={c.y-20} x2={c.x-20} y2={c.y+20} stroke={stroke} strokeWidth="2.5" /></>}
                  {c.type === 'switch' && <text x={c.x} y={c.y+8} textAnchor="middle" className="text-xl font-bold fill-slate-100">S</text>}
                  {c.type === 'outlet' && <><line x1={c.x-15} y1={c.y-6} x2={c.x+15} y2={c.y-6} stroke={stroke} strokeWidth="2.5" /><line x1={c.x-15} y1={c.y+6} x2={c.x+15} y2={c.y+6} stroke={stroke} strokeWidth="2.5" /></>}
                  <g transform={`translate(${c.x}, ${isTop ? c.y-54 : c.y+58})`}>
                    <rect x="-40" y="-8" width="80" height="16" fill="white" fillOpacity="0.9" rx="4" />
                    <text textAnchor="middle" y="4" className="text-[10px] font-black fill-slate-500 uppercase tracking-tighter">{c.label}</text>
                  </g>
                </g>
              );
            })}

            {/* Segments */}
            {segments.map(s => {
              const term = terminals.find(t => t.id === s.terminalId);
              const joint = joints.find(j => j.id === s.jointId);
              if (!term || !joint) return null;
              const path = getLPath(term, joint);
              const isDeleting = pressingId === s.id;
              const thickness = THICKNESS_OPTS[s.thickness].stroke;
              return (
                <g key={s.id} onPointerDown={(e) => startLongPress(e, s.id)} onPointerUp={cancelLongPress} className="cursor-pointer">
                  <path d={path} fill="none" stroke="transparent" strokeWidth="40" />
                  <path d={path} fill="none" stroke={isDeleting ? '#ef4444' : COLORS[s.color].stroke} strokeWidth={isDeleting ? thickness + 4 : thickness} strokeLinecap="round" strokeLinejoin="round" className={`transition-all duration-200 ${isDeleting ? 'opacity-80 scale-[1.01]' : 'opacity-100'}`} />
                  {s.color === 'white' && !isDeleting && <path d={path} fill="none" stroke="#fff" strokeWidth={thickness - 3} strokeLinecap="round" strokeLinejoin="round" />}
                </g>
              );
            })}

            {/* Joints (Large 8px) */}
            {joints.map(j => (
              <g key={j.id} onClick={(e) => handleJointClick(e, j.id)} className="cursor-pointer">
                <circle cx={j.x} cy={j.y} r={SNAP_RADIUS} fill="transparent" />
                <circle cx={j.x} cy={j.y} r="8" fill={editingJointId === j.id ? "#3b82f6" : "#1e293b"} stroke="white" strokeWidth="2.5" />
                {j.stamp && (
                  <g transform={`translate(${j.x + 16}, ${j.y - 14})`}>
                    <rect x="-12" y="-16" width="24" height="20" fill="#3b82f6" rx="4" />
                    <text x="0" y="0" textAnchor="middle" className="text-[14px] font-black fill-white">{j.stamp}</text>
                  </g>
                )}
              </g>
            ))}

            {/* Terminals */}
            {terminals.map(t => (
              <g key={t.id} onClick={(e) => handleTerminalClick(e, t.id)} className="cursor-pointer">
                <circle cx={t.x} cy={t.y} r={selectedTerminal === t.id ? 20 : 15} fill={selectedTerminal === t.id ? '#eff6ff' : 'transparent'} className="transition-all" />
                {t.isW ? (
                  <g>
                    <circle cx={t.x} cy={t.y} r={12} fill="white" stroke={selectedTerminal === t.id ? "#3b82f6" : "#1e293b"} strokeWidth={selectedTerminal === t.id ? 3 : 2.5} />
                    <text x={t.x} y={t.y + 4.5} textAnchor="middle" className="text-[14px] font-black fill-blue-600 select-none">W</text>
                  </g>
                ) : (
                  <circle cx={t.x} cy={t.y} r={12} fill={selectedTerminal === t.id ? "#3b82f6" : "#1e293b"} stroke="white" strokeWidth={selectedTerminal === t.id ? 2 : 1} />
                )}
                <g transform={`translate(${t.x + (t.ox > 0 ? 22 : -22)}, ${t.y + 4})`}>
                  <rect x="-12" y="-8" width="24" height="16" fill="white" fillOpacity="0.8" rx="4" />
                  <text textAnchor="middle" y="4" className={`text-[10px] font-black ${t.isW ? 'fill-blue-700' : 'fill-slate-500'}`}>{t.isW ? "W" : (t.label || "L")}</text>
                </g>
              </g>
            ))}
          </svg>

          {/* Stamp Center Modal */}
          {editingJointId && (
            <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/20 backdrop-blur-[1px]" onClick={() => setEditingJointId(null)}>
              <div className="bg-white p-4 rounded-3xl shadow-2xl border-2 border-slate-900 animate-in zoom-in-95 duration-150" onClick={e => e.stopPropagation()}>
                <div className="text-center mb-3"><span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Select Stamp</span></div>
                <div className="flex gap-3">
                  {STAMP_OPTS.map(stamp => (
                    <button key={stamp} onClick={() => selectStamp(stamp)} className="w-16 h-16 rounded-2xl border-2 border-slate-100 bg-white hover:border-blue-500 flex flex-col items-center justify-center active:scale-90 shadow-sm">
                      <span className="font-black text-2xl text-slate-800">{stamp}</span>
                      <span className="text-[8px] text-slate-400 font-bold uppercase">{stamp === "○" ? "極小" : ""}</span>
                    </button>
                  ))}
                </div>
                <button onClick={() => setEditingJointId(null)} className="w-full mt-4 py-2 text-[10px] font-black text-slate-400 uppercase tracking-widest">Cancel</button>
              </div>
            </div>
          )}

          {/* Result Toast */}
          {judgment && (
            <div className={`absolute bottom-2 left-2 right-2 p-3 rounded-2xl border flex items-start gap-3 shadow-2xl animate-in slide-in-from-bottom-4 z-50 ${judgment.success ? 'bg-emerald-50 border-emerald-100 text-emerald-800' : 'bg-rose-50 border-rose-100 text-rose-800'}`}>
               <div className="mt-0.5">{judgment.success ? <CheckCircle size={18} /> : <AlertCircle size={18} />}</div>
               <div className="flex-1 min-w-0">
                 <h4 className="text-[11px] font-black mb-0.5 uppercase tracking-tighter">【{judgment.success ? '合格' : '要修正'}】</h4>
                 <p className="text-[11px] font-bold">{judgment.msg}</p>
                 <div className="text-[10px] opacity-90 mt-1 flex items-start gap-1">
                   <Lightbulb size={12} className="shrink-0 mt-0.5 text-amber-500" />
                   <span className="leading-relaxed">{judgment.advice}</span>
                 </div>
               </div>
               <button onClick={() => setJudgment(null)} className="p-1 hover:bg-black/5 rounded-full transition-colors"><X size={16} /></button>
            </div>
          )}
        </div>
      </main>

      {/* Footer Controls */}
      <footer className="bg-white border-t border-slate-200 h-14 flex items-center justify-start px-2 shrink-0 z-40 gap-x-2">
        <div className="flex items-center gap-1">
          <span className="text-[7px] font-black text-slate-400 uppercase tracking-tighter mr-0.5">Color</span>
          <div className="flex gap-1">
            {Object.entries(COLORS).map(([key, info]) => (
              <button key={key} onClick={() => setCurrentColor(key)} className={`flex items-center px-1.5 py-1.5 rounded-full border transition-all ${currentColor === key ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-100 shadow-sm' : 'border-slate-200'}`}>
                <div className="w-3.5 h-3.5 rounded-full border border-slate-300 mr-1" style={{backgroundColor: info.hex}} />
                <span className={`text-[10px] font-black ${currentColor === key ? 'text-blue-700' : 'text-slate-500'}`}>{info.label}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="h-7 w-[1px] bg-slate-200 mx-0.5" />
        <div className="flex items-center gap-1">
          <span className="text-[7px] font-black text-slate-400 uppercase tracking-tighter mr-0.5">Size</span>
          <div
