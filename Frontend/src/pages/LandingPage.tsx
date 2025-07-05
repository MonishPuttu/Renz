import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { Bot, Send, Code2, Rocket, Sparkles } from 'lucide-react';
import { RootState } from '../Redux/Store';
import { setPrompt } from '../Redux/Slice';

function LandingPage() {
  const prompt = useSelector((state: RootState) => state.prompt.prompt);
  const [isVisible, setIsVisible] = useState(false);
  const navigate = useNavigate();
  const dispatch = useDispatch();

  useEffect(() => {
    setIsVisible(true);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (prompt.trim()) {
      setIsVisible(false);
      setTimeout(() => {
        navigate('/build');
      }, 500);
    }
  };

  const features = [
    {
      icon: <Code2 className="w-6 h-6" />,
      title: "Smart Code Generation",
      description: "Generate production-ready code with best practices"
    },
    {
      icon: <Rocket className="w-6 h-6" />,
      title: "Instant Deployment",
      description: "Deploy your applications with a single click"
    },
    {
      icon: <Sparkles className="w-6 h-6" />,
      title: "AI-Powered Assistance",
      description: "Get intelligent suggestions and optimizations"
    }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#0A0A0A] to-[#1A1A1A] text-white flex flex-col relative overflow-hidden">
      {/* Background Design Elements */}
      <div className="absolute inset-0 overflow-hidden">
        {/* Top Left Circle */}
        <div className="absolute -top-20 -left-20 w-80 h-80 bg-yellow-500/5 rounded-full blur-3xl"></div>
        
        {/* Bottom Right Circle */}
        <div className="absolute -bottom-20 -right-20 w-80 h-80 bg-yellow-500/5 rounded-full blur-3xl"></div>
        
        {/* Center Circle */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-yellow-500/5 rounded-full blur-3xl"></div>
      </div>

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center justify-center p-6 relative z-10">
        <div 
          className={`max-w-4xl w-full space-y-12 transition-all duration-1000 transform ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
          }`}
        >
          {/* Hero Section */}
          <div className="text-center space-y-6">
            <div className="relative inline-block">
              <div className="absolute inset-0 bg-yellow-500 blur-3xl opacity-20 animate-pulse"></div>
              <Bot className="w-24 h-24 text-yellow-500 mx-auto relative animate-bounce" />
            </div>
            <h1 className="text-5xl font-bold bg-gradient-to-r from-yellow-500 to-yellow-600 bg-clip-text text-transparent">
              Welcome to Renz
            </h1>
            <p className="text-gray-400 text-xl max-w-2xl mx-auto">
              Your expert AI assistant for building amazing web applications. Transform your ideas into reality with just a few words.
            </p>
          </div>

          {/* Features Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
            {features.map((feature, index) => (
              <div 
                key={index} 
                className="p-6 rounded-lg bg-[#1A1A1A] border border-gray-800 hover:border-yellow-500/50 transition-all duration-300 hover:scale-105"
              >
                <div className="flex items-center gap-3 mb-4">
                  {feature.icon}
                  <h3 className="text-lg font-semibold">{feature.title}</h3>
                </div>
                <p className="text-gray-400">{feature.description}</p>
              </div>
            ))}
          </div>

          {/* Input Form */}
          <form onSubmit={handleSubmit} className="space-y-4 max-w-3xl mx-auto">
            <div className="relative group flex gap-4">
              <div className="flex-1">
                <div className="absolute -inset-1 bg-gradient-to-r from-yellow-500 to-yellow-600 rounded-lg blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200"></div>
                <div className="relative">
                  <textarea
                    value={prompt}
                    onChange={(e) => dispatch(setPrompt(e.target.value))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSubmit(e);
                      }
                    }}
                    placeholder="Describe what you want to build..."
                    className="w-full bg-[#1A1A1A] rounded-lg px-4 py-3 min-h-[60px] max-h-[60px] focus:outline-none focus:ring-2 focus:ring-yellow-500 text-white placeholder-gray-400 resize-none border border-gray-800 transition-all duration-300"
                  />
                </div>
              </div>
              <button
                type="submit"
                className="p-4 h-[60px] bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-110 hover:rotate-12 flex items-center justify-center"
                disabled={!prompt.trim()}
              >
                <Send className="w-6 h-6" />
              </button>
            </div>
          </form>

          {/* Example Prompts */}
          <div className="text-center space-y-2 max-w-3xl mx-auto">
            <p className="text-sm text-gray-400">Try these examples:</p>
            <div className="flex flex-wrap gap-2 justify-center">
              {[
                "Create a modern e-commerce website",
                "Build a task management app",
                "Design a portfolio website"
              ].map((example, index) => (
                <button
                  key={index}
                  onClick={() => dispatch(setPrompt(example))}
                  className="text-sm px-4 py-2 rounded-full bg-[#1A1A1A] text-gray-400 hover:text-white hover:bg-yellow-500/20 transition-all duration-300"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default LandingPage;
