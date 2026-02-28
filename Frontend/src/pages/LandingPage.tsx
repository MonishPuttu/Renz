import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { Send, ArrowRight, Sparkles, Command } from 'lucide-react';
import { RootState } from '../Redux/Store';
import { setPrompt } from '../Redux/Slice';

// Floating particles component
const FloatingParticles = () => {
  const particles = Array.from({ length: 30 }, (_, i) => ({
    id: i,
    size: Math.random() * 3 + 1,
    x: Math.random() * 100,
    y: Math.random() * 100,
    duration: Math.random() * 20 + 15,
    delay: Math.random() * -20,
    opacity: Math.random() * 0.3 + 0.05,
  }));

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {particles.map((p) => (
        <div
          key={p.id}
          className="absolute rounded-full bg-amber-400 animate-float-particle"
          style={{
            width: `${p.size}px`,
            height: `${p.size}px`,
            left: `${p.x}%`,
            top: `${p.y}%`,
            opacity: p.opacity,
            animationDuration: `${p.duration}s`,
            animationDelay: `${p.delay}s`,
          }}
        />
      ))}
    </div>
  );
};

// Smooth typewriter hook with consistent pacing
function useTypewriter(words: string[], typingSpeed = 60, deletingSpeed = 35, pauseDuration = 2200) {
  const [displayed, setDisplayed] = useState('');
  const [wordIndex, setWordIndex] = useState(0);
  const [phase, setPhase] = useState<'typing' | 'pausing' | 'deleting'>('typing');
  const longestWord = Math.max(...words.map(w => w.length));

  useEffect(() => {
    const currentWord = words[wordIndex];

    if (phase === 'typing') {
      if (displayed.length < currentWord.length) {
        const timeout = setTimeout(() => {
          setDisplayed(currentWord.slice(0, displayed.length + 1));
        }, typingSpeed);
        return () => clearTimeout(timeout);
      } else {
        const timeout = setTimeout(() => setPhase('deleting'), pauseDuration);
        return () => clearTimeout(timeout);
      }
    }

    if (phase === 'deleting') {
      if (displayed.length > 0) {
        const timeout = setTimeout(() => {
          setDisplayed(displayed.slice(0, -1));
        }, deletingSpeed);
        return () => clearTimeout(timeout);
      } else {
        setWordIndex((prev) => (prev + 1) % words.length);
        setPhase('typing');
      }
    }
  }, [displayed, phase, wordIndex, words, typingSpeed, deletingSpeed, pauseDuration]);

  return { displayed, longestWord, currentWord: words[wordIndex] };
}

function LandingPage() {
  const prompt = useSelector((state: RootState) => state.prompt.prompt);
  const [isVisible, setIsVisible] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const navigate = useNavigate();
  const dispatch = useDispatch();

  const rotatingWords = [
    'a SaaS dashboard',
    'an e-commerce store',
    'a portfolio website',
    'a task manager',
    'a social media app',
    'a blog platform',
  ];
  const { displayed, longestWord, currentWord } = useTypewriter(rotatingWords);

  useEffect(() => {
    setIsVisible(true);

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        textareaRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (prompt.trim()) {
      setIsVisible(false);
      setTimeout(() => navigate('/build'), 500);
    }
  }, [prompt, navigate]);

  const examples = [
    { text: "Build a real-time chat application with rooms", emoji: "💬" },
    { text: "Create a Kanban board like Trello", emoji: "📋" },
    { text: "Design a weather dashboard with charts", emoji: "🌤️" },
    { text: "Make an AI image gallery with search", emoji: "🖼️" },
  ];

  return (
    <div className="min-h-screen bg-[#06060a] text-white flex flex-col relative overflow-hidden selection:bg-amber-500/30">
      {/* Layered Background */}
      <div className="absolute inset-0 pointer-events-none">
        {/* Primary aurora */}
        <div className="absolute top-[-20%] left-1/2 -translate-x-1/2 w-[1200px] h-[700px] bg-gradient-to-b from-amber-500/10 via-orange-600/5 to-transparent rounded-full blur-[120px] animate-aurora-1"></div>
        {/* Secondary aurora */}
        <div className="absolute top-[-10%] left-[30%] w-[600px] h-[500px] bg-gradient-to-br from-rose-500/5 via-purple-500/3 to-transparent rounded-full blur-[100px] animate-aurora-2"></div>
        {/* Tertiary glow */}
        <div className="absolute bottom-[-10%] right-[20%] w-[500px] h-[400px] bg-gradient-to-t from-amber-800/8 to-transparent rounded-full blur-[80px] animate-aurora-3"></div>
        {/* Grid */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.015)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.015)_1px,transparent_1px)] bg-[size:72px_72px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_70%)]"></div>
        {/* Radial vignette */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,#06060a_75%)]"></div>
        <FloatingParticles />
      </div>

      {/* Nav */}
      <nav className="relative z-20 flex items-center justify-between px-6 md:px-12 py-5 animate-slide-down">
        <div className="flex items-center gap-2.5 group cursor-default">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 via-orange-500 to-red-500 flex items-center justify-center font-bold text-sm text-black shadow-lg shadow-amber-500/20 group-hover:shadow-amber-500/40 transition-shadow duration-500">
            R
          </div>
          <span className="text-lg font-semibold tracking-tight bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent">Renz</span>
        </div>
        <div className="flex items-center gap-6">
          <a
            href="https://github.com/MonishPuttu/Renz"
            target="_blank"
            rel="noreferrer"
            className="text-sm text-zinc-500 hover:text-white transition-colors duration-300 flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
            GitHub
          </a>
        </div>
      </nav>

      {/* Main */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 pb-16 relative z-10">
        <div
          className={`max-w-3xl w-full transition-all duration-1000 transform ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-12'
          }`}
        >
          {/* Hero */}
          <div className="text-center mb-12">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-amber-500/15 bg-amber-500/5 text-amber-400/90 text-xs font-medium mb-8 animate-fade-in-up backdrop-blur-sm">
              <Sparkles className="w-3 h-3" />
              Idea to app in seconds
            </div>

            {/* Headline */}
            <h1 className="text-5xl sm:text-6xl md:text-7xl font-bold tracking-tight leading-[1.05] mb-6">
              <span className="block animate-stagger-1 text-white">Build</span>
              <span className="block animate-stagger-2 relative mt-3">
                {/* Invisible text to reserve max width and prevent layout shift */}
                <span className="invisible" aria-hidden="true">{'x'.repeat(longestWord)}</span>
                <span className="absolute left-1/2 -translate-x-1/2 top-0 whitespace-nowrap">
                  <span className="bg-gradient-to-r from-amber-300 via-orange-400 to-rose-500 bg-clip-text text-transparent animate-gradient-x bg-[length:200%_auto]">
                    {displayed}
                  </span>
                  <span className="animate-blink text-amber-400 ml-0.5 font-light">|</span>
                </span>
              </span>
            </h1>

            <p className="text-zinc-500 text-base md:text-lg max-w-xl mx-auto leading-relaxed animate-stagger-4">
              Describe what you need. Renz writes the code, sets up the project, and gives you a live preview — all in your browser.
            </p>
          </div>

          {/* Input */}
          <form onSubmit={handleSubmit} className="mb-10 animate-stagger-5">
            <div className={`relative group transition-all duration-700 ${isFocused ? 'scale-[1.02]' : ''}`}>
              {/* Glow ring */}
              <div className={`absolute -inset-px rounded-2xl bg-gradient-to-r from-amber-500/60 via-orange-500/60 to-rose-500/60 blur-sm transition-opacity duration-700 ${isFocused ? 'opacity-100' : 'opacity-0 group-hover:opacity-50'}`}></div>
              <div className={`absolute -inset-1 rounded-2xl bg-gradient-to-r from-amber-500/20 via-orange-500/20 to-rose-500/20 blur-xl transition-opacity duration-700 ${isFocused ? 'opacity-100' : 'opacity-0'}`}></div>

              <div className={`relative bg-[#0e0e14] border rounded-2xl p-1.5 flex items-end gap-1.5 transition-all duration-500 ${isFocused ? 'border-amber-500/30 shadow-2xl shadow-amber-500/5' : 'border-zinc-800/80'}`}>
                <textarea
                  ref={textareaRef}
                  value={prompt}
                  onChange={(e) => dispatch(setPrompt(e.target.value))}
                  onFocus={() => setIsFocused(true)}
                  onBlur={() => setIsFocused(false)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSubmit(e);
                    }
                  }}
                  placeholder="What do you want to build?"
                  rows={2}
                  className="flex-1 bg-transparent rounded-xl px-4 py-3.5 focus:outline-none text-white placeholder-zinc-600 resize-none text-[15px] leading-relaxed"
                />
                <div className="flex flex-col items-center gap-1.5 pb-1.5 pr-1.5">
                  <button
                    type="submit"
                    className={`p-3 rounded-xl font-semibold flex items-center justify-center shrink-0 transition-all duration-500 ${
                      prompt.trim()
                        ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-black shadow-lg shadow-amber-500/25 hover:shadow-amber-500/40 hover:scale-105 active:scale-95'
                        : 'bg-zinc-800/50 text-zinc-600 cursor-not-allowed'
                    }`}
                    disabled={!prompt.trim()}
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Shortcut hint */}
              {!isFocused && !prompt && (
                <div className="absolute right-4 top-1/2 -translate-y-1/2 hidden md:flex items-center gap-1 text-zinc-700 text-xs pointer-events-none">
                  <kbd className="px-1.5 py-0.5 rounded border border-zinc-800 bg-zinc-900/50 font-mono text-[10px]">
                    <Command className="w-2.5 h-2.5 inline" /> K
                  </kbd>
                  <span>to focus</span>
                </div>
              )}
            </div>
          </form>

          {/* Examples */}
          <div className="animate-stagger-6">
            <p className="text-center text-xs text-zinc-600 mb-4 uppercase tracking-widest font-medium">Try an idea</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-w-2xl mx-auto">
              {examples.map((example, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => {
                    dispatch(setPrompt(example.text));
                    textareaRef.current?.focus();
                  }}
                  className="group/ex relative flex items-center gap-3 text-left text-sm px-4 py-3.5 rounded-xl border border-zinc-800/60 bg-zinc-900/30 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700 hover:bg-zinc-800/40 transition-all duration-300 backdrop-blur-sm"
                  style={{ animationDelay: `${index * 100}ms` }}
                >
                  <span className="text-base shrink-0">{example.emoji}</span>
                  <span className="flex-1 truncate">{example.text}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-zinc-600 opacity-0 -translate-x-2 group-hover/ex:opacity-100 group-hover/ex:translate-x-0 transition-all duration-300 shrink-0" />
                </button>
              ))}
            </div>
          </div>

          {/* Trust bar */}
          <div className="mt-16 flex items-center justify-center gap-6 text-[11px] text-zinc-700 animate-stagger-7">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/60"></span>
              Open Source
            </span>
            <span className="w-px h-3 bg-zinc-800"></span>
            <span>React + Tailwind</span>
            <span className="w-px h-3 bg-zinc-800"></span>
            <span>WebContainer Powered</span>
          </div>
        </div>
      </main>
    </div>
  );
}

export default LandingPage;
