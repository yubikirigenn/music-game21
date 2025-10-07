import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, Upload, Music, Settings, RotateCcw, Home } from 'lucide-react';

const RhythmGame = () => {
  const [gameState, setGameState] = useState('upload');
  const [isPaused, setIsPaused] = useState(false);
  const [audioContext, setAudioContext] = useState(null);
  const [audioBuffer, setAudioBuffer] = useState(null);
  const [notes, setNotes] = useState([]);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [judgement, setJudgement] = useState('');
  const [currentTime, setCurrentTime] = useState(0);
  const [analyzing, setAnalyzing] = useState(false);
  const [inputMethod, setInputMethod] = useState('touch');
  const [difficulty, setDifficulty] = useState('normal');
  const [perfectCount, setPerfectCount] = useState(0);
  const [greatCount, setGreatCount] = useState(0);
  const [goodCount, setGoodCount] = useState(0);
  const [missCount, setMissCount] = useState(0);
  const [hitEffects, setHitEffects] = useState([]);
  
  const canvasRef = useRef(null);
  const audioSourceRef = useRef(null);
  const startTimeRef = useRef(0);
  const animationRef = useRef(null);
  const hitNotesRef = useRef(new Set());
  const touchActiveRef = useRef(new Set());

  const LANES = 4;
  const NOTE_SPEED = 1.2;
  const NOTE_TYPES = {
    NORMAL: 'normal',
    LONG: 'long',
    FLICK: 'flick',
    SLIDE: 'slide'
  };

  const DIFFICULTY_SETTINGS = {
    easy: { threshold: 2.8, minInterval: 0.5, specialChance: 0.08, maxPerSecond: 2 },
    normal: { threshold: 2.2, minInterval: 0.35, specialChance: 0.18, maxPerSecond: 3 },
    hard: { threshold: 1.8, minInterval: 0.25, specialChance: 0.32, maxPerSecond: 4 }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setAnalyzing(true);
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      setAudioContext(ctx);
      const arrayBuffer = await file.arrayBuffer();
      const buffer = await ctx.decodeAudioData(arrayBuffer);
      setAudioBuffer(buffer);
      setGameState('settings');
    } catch (error) {
      alert('音声ファイルの処理に失敗しました');
    } finally {
      setAnalyzing(false);
    }
  };

  const detectBeatsWithAI = async (buffer, ctx, diffLevel) => {
    const channelData = buffer.getChannelData(0);
    const sampleRate = buffer.sampleRate;
    const windowSize = Math.floor(sampleRate * 0.043);
    const hopSize = Math.floor(windowSize / 2);
    
    const features = [];
    for (let i = 0; i < channelData.length - windowSize; i += hopSize) {
      let energy = 0;
      let zcr = 0;
      let spectralCentroid = 0;
      for (let j = 0; j < windowSize; j++) {
        const sample = channelData[i + j];
        energy += sample * sample;
        if (j > 0 && channelData[i + j - 1] * sample < 0) zcr++;
        spectralCentroid += Math.abs(sample) * j;
      }
      features.push({
        time: i / sampleRate,
        energy: Math.sqrt(energy / windowSize),
        zcr: zcr / windowSize,
        centroid: spectralCentroid / (energy + 0.0001),
        flux: 0
      });
    }

    for (let i = 1; i < features.length; i++) {
      features[i].flux = Math.max(0, features[i].energy - features[i - 1].energy);
    }

    const settings = DIFFICULTY_SETTINGS[diffLevel];
    const avgEnergy = features.reduce((s, f) => s + f.energy, 0) / features.length;
    const stdEnergy = Math.sqrt(features.reduce((s, f) => s + Math.pow(f.energy - avgEnergy, 2), 0) / features.length);
    const avgFlux = features.reduce((s, f) => s + f.flux, 0) / features.length;
    const stdFlux = Math.sqrt(features.reduce((s, f) => s + Math.pow(f.flux - avgFlux, 2), 0) / features.length);
    
    const fluxThreshold = avgFlux + stdFlux * settings.threshold;
    const energyThreshold = avgEnergy + stdEnergy * 0.5;
    
    const peaks = [];
    for (let i = 8; i < features.length - 8; i++) {
      const curr = features[i];
      
      const isStrongOnset = curr.flux > fluxThreshold &&
        curr.energy > energyThreshold &&
        curr.flux > features[i - 1].flux &&
        curr.flux > features[i - 2].flux &&
        curr.flux > features[i + 1].flux;
      
      const localMax = Array.from({ length: 9 }, (_, k) => features[i - 4 + k].flux)
        .every((v, idx) => idx === 4 || v <= curr.flux);
      
      if (isStrongOnset && localMax && 
          (peaks.length === 0 || curr.time - peaks[peaks.length - 1].time > settings.minInterval)) {
        peaks.push({
          time: curr.time + 0.05,
          energy: curr.energy,
          zcr: curr.zcr,
          intensity: curr.flux / avgFlux
        });
      }
    }

    const noteData = [];
    let noteId = 0;
    const timeWindow = 1.0;
    const notesInWindow = [];

    for (let i = 0; i < peaks.length; i++) {
      const peak = peaks[i];
      
      notesInWindow.push(peak.time);
      while (notesInWindow.length > 0 && peak.time - notesInWindow[0] > timeWindow) {
        notesInWindow.shift();
      }
      
      if (notesInWindow.length > settings.maxPerSecond) continue;
      
      const recentNotes = noteData.filter(n => Math.abs(n.time - peak.time) < 0.2);
      const usedLanes = new Set(recentNotes.map(n => n.lane));
      recentNotes.forEach(n => {
        if (n.type === NOTE_TYPES.SLIDE) usedLanes.add(n.targetLane);
      });
      
      const availableLanes = [];
      for (let l = 0; l < LANES; l++) {
        if (!usedLanes.has(l)) availableLanes.push(l);
      }
      
      if (availableLanes.length === 0) continue;
      
      const lane = availableLanes[Math.floor(Math.random() * availableLanes.length)];
      const highEnergy = peak.energy > avgEnergy * 1.8;
      
      if (Math.random() < settings.specialChance && highEnergy) {
        const r = Math.random();
        if (r < 0.25 && i < peaks.length - 5) {
          noteData.push({
            id: noteId++,
            time: peak.time,
            lane,
            type: NOTE_TYPES.LONG,
            duration: 0.6 + Math.random() * 0.8,
            hit: false,
            holding: false
          });
        } else if (r < 0.5 && peak.zcr > 0.05) {
          noteData.push({
            id: noteId++,
            time: peak.time,
            lane,
            type: NOTE_TYPES.FLICK,
            direction: Math.random() > 0.5 ? 'left' : 'right',
            hit: false
          });
        } else if (r < 0.75 && lane < LANES - 1 && !usedLanes.has(lane + 1)) {
          noteData.push({
            id: noteId++,
            time: peak.time,
            lane,
            type: NOTE_TYPES.SLIDE,
            targetLane: lane + 1,
            hit: false
          });
        } else {
          noteData.push({
            id: noteId++,
            time: peak.time,
            lane,
            type: NOTE_TYPES.NORMAL,
            hit: false
          });
        }
      } else {
        noteData.push({
          id: noteId++,
          time: peak.time,
          lane,
          type: NOTE_TYPES.NORMAL,
          hit: false
        });
      }
    }

    return noteData.sort((a, b) => a.time - b.time);
  };

  const handleSettingsComplete = async () => {
    const detectedNotes = await detectBeatsWithAI(audioBuffer, audioContext, difficulty);
    setNotes(detectedNotes);
    setGameState('ready');
  };

  const startGame = () => {
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContext.destination);
    source.start(0);
    audioSourceRef.current = source;
    startTimeRef.current = audioContext.currentTime;
    setGameState('playing');
    setIsPaused(false);
    setScore(0);
    setCombo(0);
    setMaxCombo(0);
    setCurrentTime(0);
    setPerfectCount(0);
    setGreatCount(0);
    setGoodCount(0);
    setMissCount(0);
    setHitEffects([]);
    hitNotesRef.current.clear();
    touchActiveRef.current.clear();
    setNotes(prev => prev.map(n => ({ ...n, hit: false, holding: false })));
    source.onended = () => {
      setGameState('finished');
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  };

  const togglePause = () => {
    if (isPaused) {
      audioContext.resume();
      setIsPaused(false);
    } else {
      audioContext.suspend();
      setIsPaused(true);
    }
  };

  const resetGame = () => {
    if (audioSourceRef.current) audioSourceRef.current.stop();
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    setGameState('ready');
    setIsPaused(false);
  };

  const backToUpload = () => {
    if (audioSourceRef.current) audioSourceRef.current.stop();
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    setGameState('upload');
    setAudioBuffer(null);
    setNotes([]);
    setIsPaused(false);
  };

  const checkLongNoteRelease = (lane, time) => {
    const longNotes = notes.filter(n => 
      n.lane === lane && 
      n.type === NOTE_TYPES.LONG && 
      n.holding && 
      !hitNotesRef.current.has(n.id)
    );
    longNotes.forEach(note => {
      const endTime = note.time + note.duration;
      const diff = Math.abs(endTime - time);
      if (time < endTime - 0.12) {
        hitNotesRef.current.add(note.id);
        note.holding = false;
        setCombo(0);
        setMissCount(p => p + 1);
        setJudgement('MISS');
        setTimeout(() => setJudgement(''), 300);
      } else if (diff <= 0.12) {
        let jType;
        if (diff <= 0.04) jType = 'perfect';
        else if (diff <= 0.08) jType = 'great';
        else jType = 'good';
        hitNote(note, jType, lane);
        note.holding = false;
      }
      setNotes([...notes]);
    });
  };

  const checkHit = (lane, time) => {
    const notesInLane = notes.filter(n => 
      n.lane === lane && 
      !hitNotesRef.current.has(n.id) &&
      (n.type !== NOTE_TYPES.LONG || !n.holding)
    );
    let closestNote = null;
    let minDiff = Infinity;
    for (const note of notesInLane) {
      const diff = Math.abs(note.time - time);
      if (diff < minDiff && diff <= 0.12) {
        minDiff = diff;
        closestNote = note;
      }
    }
    if (closestNote) {
      if (closestNote.type === NOTE_TYPES.LONG) {
        closestNote.holding = true;
        setNotes([...notes]);
        addHitEffect(lane, 'perfect');
      } else {
        let jType;
        if (minDiff <= 0.04) jType = 'perfect';
        else if (minDiff <= 0.08) jType = 'great';
        else jType = 'good';
        hitNote(closestNote, jType, lane);
      }
    }
  };

  const addHitEffect = (lane, jType) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const laneWidth = canvas.width / LANES;
    const x = lane * laneWidth + laneWidth / 2;
    const y = canvas.height * 0.85;
    const effect = {
      id: Date.now() + Math.random(),
      x, y, jType,
      createdAt: Date.now()
    };
    setHitEffects(p => [...p, effect]);
    setTimeout(() => {
      setHitEffects(p => p.filter(e => e.id !== effect.id));
    }, 400);
  };

  const hitNote = (note, jType, lane) => {
    hitNotesRef.current.add(note.id);
    const points = jType === 'perfect' ? 100 : jType === 'great' ? 70 : 40;
    setScore(p => p + points);
    setCombo(p => {
      const newCombo = p + 1;
      setMaxCombo(max => Math.max(max, newCombo));
      return newCombo;
    });
    setJudgement(jType.toUpperCase());
    if (jType === 'perfect') setPerfectCount(p => p + 1);
    else if (jType === 'great') setGreatCount(p => p + 1);
    else setGoodCount(p => p + 1);
    addHitEffect(lane, jType);
    setTimeout(() => setJudgement(''), 300);
  };

  useEffect(() => {
    if (inputMethod !== 'keyboard' || gameState !== 'playing' || isPaused) return;
    const pressedKeys = new Set();
    const handleKeyDown = (e) => {
      const keyToLane = { 'a': 0, 's': 1, 'd': 2, 'f': 3 };
      const lane = keyToLane[e.key.toLowerCase()];
      if (lane === undefined || pressedKeys.has(lane)) return;
      pressedKeys.add(lane);
      const time = audioContext.currentTime - startTimeRef.current;
      checkHit(lane, time);
    };
    const handleKeyUp = (e) => {
      const keyToLane = { 'a': 0, 's': 1, 'd': 2, 'f': 3 };
      const lane = keyToLane[e.key.toLowerCase()];
      if (lane === undefined) return;
      pressedKeys.delete(lane);
      const time = audioContext.currentTime - startTimeRef.current;
      checkLongNoteRelease(lane, time);
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [gameState, notes, audioContext, inputMethod, isPaused]);

  useEffect(() => {
    if (inputMethod !== 'touch' || gameState !== 'playing' || isPaused) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handleTouchStart = (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const touches = e.type.includes('touch') ? e.touches : [e];
      for (let i = 0; i < touches.length; i++) {
        const touch = touches[i];
        const x = touch.clientX - rect.left;
        const lane = Math.floor((x / rect.width) * LANES);
        if (lane >= 0 && lane < LANES && !touchActiveRef.current.has(lane)) {
          touchActiveRef.current.add(lane);
          const time = audioContext.currentTime - startTimeRef.current;
          checkHit(lane, time);
        }
      }
    };
    const handleTouchEnd = (e) => {
      e.preventDefault();
      const time = audioContext.currentTime - startTimeRef.current;
      touchActiveRef.current.forEach(lane => checkLongNoteRelease(lane, time));
      touchActiveRef.current.clear();
    };
    canvas.addEventListener('touchstart', handleTouchStart);
    canvas.addEventListener('touchend', handleTouchEnd);
    canvas.addEventListener('mousedown', handleTouchStart);
    canvas.addEventListener('mouseup', handleTouchEnd);
    return () => {
      canvas.removeEventListener('touchstart', handleTouchStart);
      canvas.removeEventListener('touchend', handleTouchEnd);
      canvas.removeEventListener('mousedown', handleTouchStart);
      canvas.removeEventListener('mouseup', handleTouchEnd);
    };
  }, [gameState, notes, audioContext, inputMethod, isPaused]);

  const drawTile = (ctx, x, y, w, h, color) => {
    ctx.shadowBlur = 25;
    ctx.shadowColor = color;
    const grad = ctx.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, color);
    grad.addColorStop(0.5, color + 'ee');
    grad.addColorStop(1, color + 'cc');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.fillRect(x, y, w, h * 0.25);
    ctx.shadowBlur = 0;
  };

  useEffect(() => {
    if (gameState !== 'playing' || isPaused) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const draw = () => {
      const time = audioContext.currentTime - startTimeRef.current;
      setCurrentTime(time);
      const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
      bgGrad.addColorStop(0, '#1a1a3e');
      bgGrad.addColorStop(1, '#0a0a1a');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);
      const laneW = w / LANES;
      for (let i = 0; i < LANES; i++) {
        ctx.strokeStyle = 'rgba(100, 100, 150, 0.3)';
        ctx.lineWidth = 2;
        ctx.strokeRect(i * laneW, 0, laneW, h);
        if (inputMethod === 'keyboard') {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
          ctx.font = 'bold 28px Arial';
          ctx.textAlign = 'center';
          ctx.fillText(['A', 'S', 'D', 'F'][i], i * laneW + laneW / 2, 50);
        }
      }
      const judgeY = h * 0.85;
      ctx.shadowBlur = 30;
      ctx.shadowColor = '#00ff88';
      ctx.strokeStyle = '#00ff88';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(0, judgeY);
      ctx.lineTo(w, judgeY);
      ctx.stroke();
      ctx.shadowBlur = 0;
      notes.forEach(note => {
        if (hitNotesRef.current.has(note.id) && note.type !== NOTE_TYPES.LONG) return;
        if (note.type === NOTE_TYPES.LONG && !note.holding && hitNotesRef.current.has(note.id)) return;
        const diff = note.time - time;
        if (diff < -0.2 && !note.holding) {
          if (!hitNotesRef.current.has(note.id)) {
            hitNotesRef.current.add(note.id);
            setCombo(0);
            setMissCount(p => p + 1);
            setJudgement('MISS');
            setTimeout(() => setJudgement(''), 300);
          }
          return;
        }
        if (note.type === NOTE_TYPES.LONG) {
          const endT = note.time + note.duration;
          if (time > endT + 0.2 && note.holding) {
            hitNotesRef.current.add(note.id);
            note.holding = false;
            setCombo(0);
            setMissCount(p => p + 1);
            setJudgement('MISS');
            setTimeout(() => setJudgement(''), 300);
            setNotes([...notes]);
            return;
          }
          if (time > endT + 0.2 && !note.holding && !hitNotesRef.current.has(note.id)) {
            hitNotesRef.current.add(note.id);
            return;
          }
        }
        if (diff > 3) return;
        const y = judgeY - (diff * h * NOTE_SPEED / 3);
        const tileX = note.lane * laneW + laneW * 0.08;
        const tileW = laneW * 0.84;
        if (note.type === NOTE_TYPES.LONG) {
          const endY = judgeY - ((note.time + note.duration - time) * h * NOTE_SPEED / 3);
          const currY = note.holding ? judgeY : y;
          const noteH = Math.abs(endY - currY);
          const grad = ctx.createLinearGradient(0, Math.min(currY, endY), 0, Math.max(currY, endY));
          grad.addColorStop(0, 'rgba(255, 200, 0, 0.85)');
          grad.addColorStop(1, 'rgba(255, 220, 0, 0.65)');
          ctx.fillStyle = grad;
          ctx.fillRect(tileX, Math.min(currY, endY), tileW, noteH);
          ctx.strokeStyle = '#ffcc00';
          ctx.lineWidth = 4;
          ctx.strokeRect(tileX, Math.min(currY, endY), tileW, noteH);
          if (!note.holding) drawTile(ctx, tileX, y - 40, tileW, 80, '#ffcc00');
          drawTile(ctx, tileX, endY - 40, tileW, 80, '#ffaa00');
        } else if (note.type === NOTE_TYPES.FLICK) {
          drawTile(ctx, tileX, y - 40, tileW, 80, '#ff00ff');
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 48px Arial';
          ctx.textAlign = 'center';
          ctx.shadowBlur = 10;
          ctx.shadowColor = '#ff00ff';
          ctx.fillText(note.direction === 'left' ? '◀' : '▶', note.lane * laneW + laneW / 2, y + 15);
          ctx.shadowBlur = 0;
        } else if (note.type === NOTE_TYPES.SLIDE) {
          const startX = note.lane * laneW + laneW * 0.08;
          const endX = note.targetLane * laneW + laneW * 0.08;
          ctx.strokeStyle = 'rgba(0, 255, 200, 0.7)';
          ctx.lineWidth = 60;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(startX + tileW / 2, y);
          ctx.lineTo(endX + tileW / 2, y);
          ctx.stroke();
          drawTile(ctx, startX, y - 40, tileW, 80, '#00ffcc');
          drawTile(ctx, endX, y - 40, tileW, 80, '#00ffcc');
        } else {
          drawTile(ctx, tileX, y - 40, tileW, 80, '#00ffff');
        }
      });
      hitEffects.forEach(eff => {
        const age = Date.now() - eff.createdAt;
        const prog = age / 400;
        const colors = { perfect: '#ffff00', great: '#00ff00', good: '#0088ff' };
        ctx.save();
        ctx.globalAlpha = 1 - prog;
        ctx.strokeStyle = colors[eff.jType];
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(eff.x, eff.y, 40 + prog * 30, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      });
      animationRef.current = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [gameState, notes, audioContext, isPaused, inputMethod, hitEffects]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-950 via-purple-950 to-blue-950 flex items-center justify-center p-2">
      <div className="w-full h-screen max-w-7xl flex flex-col">
        {gameState === 'upload' && (
          <div className="flex-1 flex items-center justify-center">
            <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-2xl p-10 text-center max-w-2xl w-full shadow-2xl border border-purple-500/20">
              <Music className="w-20 h-20 mx-auto mb-6 text-cyan-400 animate-pulse" />
              <h1 className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-400 mb-4">リズムゲーム</h1>
              <p className="text-gray-300 mb-8">MP3ファイルをアップロードして、AI生成の譜面で遊ぼう</p>
              <label className="inline-flex items-center gap-3 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white px-8 py-4 rounded-xl cursor-pointer transition-all shadow-lg hover:shadow-cyan-500/50">
                <Upload className="w-6 h-6" />
                <span className="font-bold text-lg">MP3を選択</span>
                <input type="file" accept="audio/mpeg,audio/mp3" onChange={handleFileUpload} className="hidden" />
              </label>
              {analyzing && (
                <div className="mt-8">
                  <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-cyan-500 border-t-transparent"></div>
                  <p className="text-white mt-4 text-lg">AI解析中...</p>
                </div>
              )}
            </div>
          </div>
        )}
        {gameState === 'settings' && (
          <div className="flex-1 flex items-center justify-center">
            <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-2xl p-10 max-w-2xl w-full shadow-2xl border border-purple-500/20">
              <div className="flex items-center gap-4 mb-8">
                <Settings className="w-10 h-10 text-cyan-400" />
                <h2 className="text-3xl font-bold text-white">ゲーム設定</h2>
              </div>
              <div className="space-y-8">
                <div>
                  <h3 className="text-white font-bold mb-4 text-xl">操作方法</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <button onClick={() => setInputMethod('touch')} className={`p-5 rounded-xl border-2 transition-all ${inputMethod === 'touch' ? 'border-cyan-500 bg-cyan-500/20 shadow-lg shadow-cyan-500/30' : 'border-gray-700 hover:border-gray-600'}`}>
                      <div className="text-white font-bold text-lg mb-1">タッチ</div>
                      <div className="text-gray-400 text-sm">画面をタップ</div>
                    </button>
                    <button onClick={() => setInputMethod('keyboard')} className={`p-5 rounded-xl border-2 transition-all ${inputMethod === 'keyboard' ? 'border-cyan-500 bg-cyan-500/20 shadow-lg shadow-cyan-500/30' : 'border-gray-700 hover:border-gray-600'}`}>
                      <div className="text-white font-bold text-lg mb-1">キーボード</div>
                      <div className="text-gray-400 text-sm">ASDF キー</div>
                    </button>
                  </div>
                </div>
                <div>
                  <h3 className="text-white font-bold mb-4 text-xl">難易度</h3>
                  <div className="grid grid-cols-3 gap-4">
                    <button onClick={() => setDifficulty('easy')} className={`p-5 rounded-xl border-2 transition-all ${difficulty === 'easy' ? 'border-green-500 bg-green-500/20 shadow-lg shadow-green-500/30' : 'border-gray-700 hover:border-gray-600'}`}>
                      <div className="text-white font-bold text-lg mb-1">EASY</div>
                      <div className="text-gray-400 text-sm">初心者向け</div>
                    </button>
                    <button onClick={() => setDifficulty('normal')} className={`p-5 rounded-xl border-2 transition-all ${difficulty === 'normal' ? 'border-yellow-500 bg-yellow-500/20 shadow-lg shadow-yellow-500/30' : 'border-gray-700 hover:border-gray-600'}`}>
                      <div className="text-white font-bold text-lg mb-1">NORMAL</div>
                      <div className="text-gray-400 text-sm">標準</div>
                    </button>
                    <button onClick={() => setDifficulty('hard')} className={`p-5 rounded-xl border-2 transition-all ${difficulty === 'hard' ? 'border-red-500 bg-red-500/20 shadow-lg shadow-red-500/30' : 'border-gray-700 hover:border-gray-600'}`}>
                      <div className="text-white font-bold text-lg mb-1">HARD</div>
                      <div className="text-gray-400 text-sm">上級者向け</div>
                    </button>
                  </div>
                </div>
                <button onClick={handleSettingsComplete} className="w-full bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white py-5 rounded-xl font-bold text-xl transition-all shadow-lg hover:shadow-cyan-500/50">
                  譜面を生成
                </button>
              </div>
            </div>
          </div>
        )}
        {gameState === 'ready' && (
          <div className="flex-1 flex items-center justify-center">
            <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-2xl p-10 text-center max-w-2xl w-full shadow-2xl border border-purple-500/20">
              <h2 className="text-3xl font-bold text-white mb-6">準備完了！</h2>
              <div className="text-gray-300 mb-8 space-y-3">
                <p className="text-xl">ノーツ数: <span className="text-cyan-400 font-bold">{notes.length}</span></p>
                <p className="text-xl">難易度: <span className="text-yellow-400 font-bold">{difficulty.toUpperCase()}</span></p>
                <div className="bg-gray-800/50 rounded-xl p-6 mt-6">
                  <p className="text-white font-bold mb-3 text-lg">ノーツタイプ</p>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="flex items-center gap-2"><span className="text-cyan-400 text-xl">●</span> 通常ノーツ</div>
                    <div className="flex items-center gap-2"><span className="text-yellow-400 text-xl">▬</span> ロングノーツ</div>
                    <div className="flex items-center gap-2"><span className="text-pink-400 text-xl">◀</span> フリックノーツ</div>
                    <div className="flex items-center gap-2"><span className="text-green-400 text-xl">⟷</span> スライドノーツ</div>
                  </div>
                </div>
              </div>
              <button onClick={startGame} className="inline-flex items-center gap-3 bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white px-10 py-5 rounded-xl font-bold text-2xl transition-all shadow-lg hover:shadow-green-500/50">
                <Play className="w-8 h-8" />
                START
              </button>
            </div>
          </div>
        )}
        {(gameState === 'playing' || gameState === 'finished') && (
          <div className="flex-1 flex flex-col bg-gradient-to-br from-gray-900 to-gray-800 rounded-2xl overflow-hidden shadow-2xl border border-purple-500/20">
            <div className="bg-gradient-to-r from-gray-800 to-gray-900 p-4 flex justify-between items-center border-b border-purple-500/20">
              <div className="flex-1">
                <div className="text-white text-xl font-bold">SCORE: <span className="text-cyan-400">{score}</span></div>
                <div className="text-yellow-400 text-lg font-semibold">COMBO: {combo}</div>
              </div>
              <div className="flex-1 flex justify-center items-center">
                {judgement && !isPaused && (
                  <div className={`text-3xl font-black animate-pulse ${
                    judgement === 'PERFECT' ? 'text-yellow-400 drop-shadow-[0_0_10px_rgba(255,255,0,0.8)]' :
                    judgement === 'GREAT' ? 'text-green-400 drop-shadow-[0_0_10px_rgba(0,255,0,0.8)]' :
                    judgement === 'GOOD' ? 'text-blue-400 drop-shadow-[0_0_10px_rgba(0,136,255,0.8)]' :
                    'text-red-400 drop-shadow-[0_0_10px_rgba(255,0,0,0.8)]'
                  }`}>
                    {judgement}
                  </div>
                )}
              </div>
              <div className="flex-1 flex justify-end items-center gap-3">
                {gameState === 'playing' && (
                  <>
                    <button onClick={togglePause} className="bg-gray-700 hover:bg-gray-600 text-white p-3 rounded-lg transition-all shadow-lg">
                      {isPaused ? <Play className="w-6 h-6" /> : <Pause className="w-6 h-6" />}
                    </button>
                    <button onClick={resetGame} className="bg-gray-700 hover:bg-gray-600 text-white p-3 rounded-lg transition-all shadow-lg">
                      <RotateCcw className="w-6 h-6" />
                    </button>
                  </>
                )}
                <div className="text-white text-lg font-mono ml-2">
                  {Math.floor(currentTime / 60)}:{String(Math.floor(currentTime % 60)).padStart(2, '0')}
                </div>
              </div>
            </div>
            <div className="flex-1 relative">
              <canvas ref={canvasRef} width={1200} height={800} className="w-full h-full" style={{ touchAction: 'none' }} />
              {isPaused && (
                <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center">
                  <div className="text-center">
                    <Pause className="w-24 h-24 text-cyan-400 mx-auto mb-6 animate-pulse" />
                    <h2 className="text-4xl font-bold text-white mb-8">PAUSED</h2>
                    <button onClick={togglePause} className="bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white px-10 py-4 rounded-xl font-bold text-xl transition-all shadow-lg">
                      再開
                    </button>
                  </div>
                </div>
              )}
              {gameState === 'finished' && (
                <div className="absolute inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4">
                  <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl p-10 max-w-lg w-full shadow-2xl border border-purple-500/30">
                    <h2 className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-400 mb-8 text-center">RESULT</h2>
                    <div className="text-white space-y-4 mb-8">
                      <div className="flex justify-between text-2xl border-b border-purple-500/30 pb-3">
                        <span>SCORE</span>
                        <span className="font-black text-cyan-400">{score}</span>
                      </div>
                      <div className="flex justify-between text-xl border-b border-purple-500/30 pb-3">
                        <span>MAX COMBO</span>
                        <span className="font-bold text-yellow-400">{maxCombo}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-4 pt-4">
                        <div className="bg-yellow-500/10 rounded-xl p-4 text-center border border-yellow-500/30">
                          <div className="text-yellow-400 font-bold text-lg mb-1">PERFECT</div>
                          <div className="text-3xl font-black">{perfectCount}</div>
                        </div>
                        <div className="bg-green-500/10 rounded-xl p-4 text-center border border-green-500/30">
                          <div className="text-green-400 font-bold text-lg mb-1">GREAT</div>
                          <div className="text-3xl font-black">{greatCount}</div>
                        </div>
                        <div className="bg-blue-500/10 rounded-xl p-4 text-center border border-blue-500/30">
                          <div className="text-blue-400 font-bold text-lg mb-1">GOOD</div>
                          <div className="text-3xl font-black">{goodCount}</div>
                        </div>
                        <div className="bg-red-500/10 rounded-xl p-4 text-center border border-red-500/30">
                          <div className="text-red-400 font-bold text-lg mb-1">MISS</div>
                          <div className="text-3xl font-black">{missCount}</div>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-3">
                      <button onClick={resetGame} className="w-full flex items-center justify-center gap-3 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white px-6 py-4 rounded-xl font-bold text-lg transition-all shadow-lg">
                        <RotateCcw className="w-6 h-6" />
                        もう一度プレイ
                      </button>
                      <button onClick={backToUpload} className="w-full flex items-center justify-center gap-3 bg-gradient-to-r from-gray-700 to-gray-600 hover:from-gray-600 hover:to-gray-500 text-white px-6 py-4 rounded-xl font-bold text-lg transition-all shadow-lg">
                        <Home className="w-6 h-6" />
                        別の曲を選ぶ
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default RhythmGame;
