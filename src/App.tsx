import React, { useState, useEffect, useRef } from "react";
import { 
  Search, 
  Play, 
  Database, 
  Terminal, 
  AlertCircle, 
  CheckCircle2, 
  Loader2, 
  Download, 
  Filter,
  BarChart3,
  LayoutDashboard,
  Settings,
  History,
  ExternalLink,
  Star,
  MessageSquare
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { io, Socket } from "socket.io-client";
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Cell
} from "recharts";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface Product {
  asin: string;
  title: string;
  price: string;
  rating: number;
  reviews: number;
  productUrl: string;
  bullets?: string[];
  description?: string;
  bestSellerRank?: string;
  category?: string;
  sellerName?: string;
}

interface LogEntry {
  message: string;
  type: "info" | "success" | "warn" | "error";
  timestamp: string;
}

export default function App() {
  const [keyword, setKeyword] = useState("");
  const [deviceType, setDeviceType] = useState<"desktop" | "mobile">("desktop");
  const [mode, setMode] = useState<"standard" | "human" | "agent">("standard");
  const [isScraping, setIsScraping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [activeTab, setActiveTab] = useState<"dashboard" | "data" | "logs">("dashboard");
  const [socket, setSocket] = useState<Socket | null>(null);

  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const newSocket = io();
    setSocket(newSocket);

    newSocket.on("log", (log: { message: string; type: "info" | "success" | "warn" | "error" }) => {
      setLogs(prev => [...prev, { ...log, timestamp: new Date().toLocaleTimeString() }]);
    });

    newSocket.on("scrape:partial", (product: Product) => {
      setProducts(prev => {
        const exists = prev.find(p => p.asin === product.asin);
        if (exists) return prev.map(p => p.asin === product.asin ? product : p);
        return [product, ...prev];
      });
    });

    newSocket.on("scrape:complete", (result: { data: Product[]; count: number }) => {
      setProducts(result.data);
      setIsScraping(false);
      setActiveTab("dashboard");
    });

    newSocket.on("scrape:error", (result: { error: string }) => {
      setError(result.error);
      setIsScraping(false);
      setActiveTab("dashboard");
    });

    fetchData();

    return () => {
      newSocket.disconnect();
    };
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const fetchData = async () => {
    try {
      const res = await fetch("/api/data");
      const data = await res.json();
      setProducts(data);
    } catch (err) {
      console.error("Failed to fetch data", err);
    }
  };

  const startScraping = async () => {
    if (isScraping) return;
    setIsScraping(true);
    setError(null);
    setLogs([]);
    setActiveTab("logs");

    try {
      const res = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword, deviceType, mode }),
      });
      
      if (!res.ok) {
        const result = await res.json();
        throw new Error(result.error || "Failed to start scraping.");
      }
      
      // We don't wait for the result here anymore, 
      // we wait for the socket events.
    } catch (err: any) {
      setError(err.message || "Failed to connect to the server.");
      setIsScraping(false);
      setActiveTab("dashboard");
    }
  };

  const downloadJSON = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(products, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "amazon_products.json");
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  const [lastUpdate, setLastUpdate] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setLastUpdate(new Date());
    }, 60000);
    return () => clearInterval(timer);
  }, []);

  const stats = {
    total: products.length,
    avgPrice: products.length ? (products.reduce((acc, p) => acc + (parseFloat(p.price) || 0), 0) / products.length).toFixed(2) : "0.00",
    avgRating: products.length ? (products.reduce((acc, p) => acc + (p.rating || 0), 0) / products.length).toFixed(1) : "0.0",
    totalReviews: products.reduce((acc, p) => acc + (p.reviews || 0), 0),
    topCategory: (() => {
      const categories = products.map(p => p.category).filter(c => c && c !== "N/A");
      if (categories.length === 0) return "N/A";
      const catCounts: Record<string, number> = {};
      categories.forEach(c => catCounts[c] = (catCounts[c] || 0) + 1);
      return Object.entries(catCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "N/A";
    })()
  };

  const chartData = products.slice(0, 10).map(p => ({
    name: p.asin,
    price: parseFloat(p.price) || 0,
    rating: p.rating,
    reviews: p.reviews
  }));

  return (
    <div className="min-h-screen bg-[#F7F9FC] text-zinc-800 font-sans selection:bg-indigo-500/30 pb-20 md:pb-0">
      {/* Desktop Sidebar */}
      <aside className="fixed left-0 top-0 bottom-0 w-64 bg-white border-r border-zinc-200 z-50 hidden md:block shadow-sm">
        <div className="p-6 flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-600/20">
            <Database className="w-6 h-6 text-white" />
          </div>
          <span className="text-zinc-900 font-bold text-xl tracking-tight">ScraperPro</span>
        </div>

        <nav className="px-4 mt-6 space-y-1">
          {[
            { id: "dashboard", icon: LayoutDashboard, label: "Dashboard" },
            { id: "data", icon: Database, label: "Data Explorer" },
            { id: "logs", icon: Terminal, label: "Real-time Logs" },
          ].map((item) => (
            <button 
              key={item.id}
              onClick={() => setActiveTab(item.id as any)}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all duration-200",
                activeTab === item.id ? "bg-indigo-50 text-indigo-600" : "hover:bg-zinc-50 text-zinc-500 hover:text-zinc-900"
              )}
            >
              <item.icon className="w-5 h-5" />
              <span className="font-semibold">{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="absolute bottom-6 left-4 right-4">
          <div className="p-4 bg-zinc-50 rounded-2xl border border-zinc-100">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">System Status</span>
            </div>
            <p className="text-xs text-zinc-600 font-medium">All systems operational</p>
          </div>
        </div>
      </aside>

      {/* Mobile Bottom Nav */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-zinc-200 z-50 md:hidden flex items-center justify-around h-16 px-4 shadow-[0_-4px_12px_rgba(0,0,0,0.05)]">
        {[
          { id: "dashboard", icon: LayoutDashboard, label: "Home" },
          { id: "data", icon: Database, label: "Data" },
          { id: "logs", icon: Terminal, label: "Logs" },
        ].map((item) => (
          <button 
            key={item.id}
            onClick={() => setActiveTab(item.id as any)}
            className={cn(
              "flex flex-col items-center gap-1 transition-all duration-200",
              activeTab === item.id ? "text-indigo-600" : "text-zinc-400"
            )}
          >
            <item.icon className="w-6 h-6" />
            <span className="text-[10px] font-bold uppercase tracking-tighter">{item.label}</span>
          </button>
        ))}
      </nav>

      {/* Mobile FAB */}
      <button 
        onClick={startScraping}
        disabled={isScraping}
        className={cn(
          "fixed bottom-20 right-6 w-14 h-14 bg-indigo-600 rounded-full shadow-2xl z-50 flex items-center justify-center text-white md:hidden transition-all active:scale-90",
          isScraping && "opacity-50 cursor-not-allowed"
        )}
      >
        {isScraping ? <Loader2 className="w-6 h-6 animate-spin" /> : <Play className="w-6 h-6 fill-current" />}
      </button>

      {/* Main Content */}
      <main className="md:pl-64 min-h-screen">
        {/* Header */}
        <header className="h-20 border-b border-zinc-200 bg-white/80 backdrop-blur-md sticky top-0 z-40 px-4 md:px-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 flex-1">
            <div className="relative flex-1 max-w-xl">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-400" />
              <input 
                type="text"
                placeholder="Search products..."
                className="w-full bg-zinc-100 border-none rounded-2xl py-3 pl-12 pr-4 text-zinc-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all text-sm md:text-base"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
              />
            </div>
            {isScraping && (
              <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-emerald-50 border border-emerald-100 rounded-full">
                <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">Live Extraction</span>
              </div>
            )}
          </div>
            
            {/* Device Toggle */}
            <div className="hidden lg:flex bg-zinc-100 p-1 rounded-2xl">
              <button 
                onClick={() => setDeviceType("desktop")}
                className={cn(
                  "px-4 py-2 rounded-xl text-xs font-bold transition-all",
                  deviceType === "desktop" ? "bg-white text-indigo-600 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
                )}
              >
                Desktop
              </button>
              <button 
                onClick={() => setDeviceType("mobile")}
                className={cn(
                  "px-4 py-2 rounded-xl text-xs font-bold transition-all",
                  deviceType === "mobile" ? "bg-white text-indigo-600 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
                )}
              >
                Android
              </button>
            </div>

            {/* Strategy Toggle */}
            <div className="hidden xl:flex bg-zinc-100 p-1 rounded-2xl">
              <button 
                onClick={() => setMode("standard")}
                className={cn(
                  "px-3 py-2 rounded-xl text-[10px] font-bold transition-all",
                  mode === "standard" ? "bg-white text-indigo-600 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
                )}
              >
                Fast
              </button>
              <button 
                onClick={() => setMode("human")}
                className={cn(
                  "px-3 py-2 rounded-xl text-[10px] font-bold transition-all",
                  mode === "human" ? "bg-white text-indigo-600 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
                )}
              >
                Human
              </button>
              <button 
                onClick={() => setMode("agent")}
                className={cn(
                  "px-3 py-2 rounded-xl text-[10px] font-bold transition-all",
                  mode === "agent" ? "bg-white text-indigo-600 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
                )}
              >
                AI Agent
              </button>
            </div>

            <button 
              onClick={startScraping}
              disabled={isScraping}
              className={cn(
                "flex items-center justify-center gap-2 px-4 md:px-6 py-3 rounded-2xl font-bold transition-all duration-300 shadow-md",
                isScraping 
                  ? "bg-zinc-200 text-zinc-400 cursor-not-allowed" 
                  : "bg-indigo-600 text-white hover:bg-indigo-700 active:scale-95"
              )}
            >
              {isScraping ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5" />}
              <span className="hidden sm:inline">{isScraping ? "Extracting..." : "Run"}</span>
            </button>

          <div className="flex items-center gap-2">
            <button 
              onClick={downloadJSON}
              className="p-3 bg-zinc-100 rounded-2xl hover:bg-zinc-200 transition-colors text-zinc-600"
              title="Download JSON"
            >
              <Download className="w-5 h-5" />
            </button>
            <div className="hidden sm:flex items-center gap-3 pl-2">
              <div className="w-10 h-10 bg-indigo-100 rounded-2xl flex items-center justify-center">
                <Settings className="w-5 h-5 text-indigo-600" />
              </div>
            </div>
          </div>
        </header>

        {/* Content Area */}
        <div className="p-4 md:p-8">
          <AnimatePresence mode="wait">
            {activeTab === "dashboard" && (
              <motion.div 
                key="dashboard"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                className="space-y-6 md:y-8"
              >
                <div className="flex items-center justify-between mb-8">
                  <h2 className="text-2xl font-black text-zinc-900 tracking-tight">Market Overview</h2>
                  <div className="flex items-center gap-2 text-xs text-zinc-400 font-bold uppercase tracking-widest">
                    <div className={cn("w-2 h-2 rounded-full", isScraping ? "bg-emerald-500 animate-pulse" : "bg-zinc-300")} />
                    {isScraping ? "Live Extraction" : `Updated ${lastUpdate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                  </div>
                </div>

                {/* Stats Grid */}
                {error && (
                  <div className="bg-red-50 border border-red-200 rounded-[2rem] p-6 flex items-center gap-4 text-red-800 mb-6">
                    <div className="w-12 h-12 bg-red-100 rounded-2xl flex items-center justify-center flex-shrink-0">
                      <AlertCircle className="w-6 h-6" />
                    </div>
                    <div>
                      <h4 className="font-bold text-sm md:text-base">Scraping Error</h4>
                      <p className="text-xs md:text-sm opacity-80">{error}</p>
                    </div>
                  </div>
                )}
                {products.length === 0 && !isScraping && logs.length > 0 && !error && (
                  <div className="bg-amber-50 border border-amber-200 rounded-[2rem] p-6 flex items-center gap-4 text-amber-800 mb-6">
                    <div className="w-12 h-12 bg-amber-100 rounded-2xl flex items-center justify-center flex-shrink-0">
                      <AlertCircle className="w-6 h-6" />
                    </div>
                    <div>
                      <h4 className="font-bold text-sm md:text-base">No products found</h4>
                      <p className="text-xs md:text-sm opacity-80">Amazon might be blocking the request or the keyword returned no results. Try switching to <b>Android Mode</b> or wait a few minutes.</p>
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
                  {[
                    { label: "Total", value: stats.total, icon: Database, color: "bg-blue-500" },
                    { label: "Price", value: `$${stats.avgPrice}`, icon: BarChart3, color: "bg-emerald-500" },
                    { label: "Rating", value: `${stats.avgRating}`, icon: Star, color: "bg-amber-500" },
                    { label: "Top Category", value: stats.topCategory, icon: LayoutDashboard, color: "bg-purple-500" },
                  ].map((stat, i) => (
                    <div key={i} className="p-5 bg-white border border-zinc-200 rounded-[2rem] shadow-sm flex flex-col justify-between h-32 md:h-40 relative overflow-hidden group">
                      <div className="relative z-10">
                        <p className="text-[10px] md:text-xs font-bold text-zinc-400 uppercase tracking-widest mb-1">{stat.label}</p>
                        <h3 className="text-xl md:text-3xl font-black text-zinc-900 tracking-tight">{stat.value}</h3>
                      </div>
                      <div className={cn("w-10 h-10 md:w-12 md:h-12 rounded-2xl flex items-center justify-center text-white shadow-lg", stat.color)}>
                        <stat.icon className="w-5 h-5 md:w-6 md:h-6" />
                      </div>
                    </div>
                  ))}
                </div>

                {/* Charts Section */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 md:gap-8">
                  <div className="p-6 md:p-8 bg-white border border-zinc-200 rounded-[2.5rem] shadow-sm">
                    <h3 className="text-lg md:text-xl font-bold text-zinc-900 mb-6">Price Distribution</h3>
                    <div className="h-[250px] md:h-[300px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f1f1" vertical={false} />
                          <XAxis dataKey="name" stroke="#a1a1aa" fontSize={10} tickLine={false} axisLine={false} />
                          <YAxis stroke="#a1a1aa" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} />
                          <Tooltip 
                            contentStyle={{ backgroundColor: '#fff', border: 'none', borderRadius: '16px', boxShadow: '0 10px 25px rgba(0,0,0,0.05)' }}
                          />
                          <Bar dataKey="price" radius={[8, 8, 8, 8]} barSize={20}>
                            {chartData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill="#6366f1" />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="p-6 md:p-8 bg-white border border-zinc-200 rounded-[2.5rem] shadow-sm">
                    <h3 className="text-lg md:text-xl font-bold text-zinc-900 mb-6">Engagement Overview</h3>
                    <div className="h-[250px] md:h-[300px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData} layout="vertical">
                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f1f1" horizontal={false} />
                          <XAxis type="number" stroke="#a1a1aa" fontSize={10} tickLine={false} axisLine={false} />
                          <YAxis dataKey="name" type="category" stroke="#a1a1aa" fontSize={10} tickLine={false} axisLine={false} width={60} />
                          <Tooltip 
                            contentStyle={{ backgroundColor: '#fff', border: 'none', borderRadius: '16px', boxShadow: '0 10px 25px rgba(0,0,0,0.05)' }}
                          />
                          <Bar dataKey="reviews" fill="#10b981" radius={[8, 8, 8, 8]} barSize={20} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>

                {/* Recent Items List (Mobile Friendly) */}
                <div className="bg-white border border-zinc-200 rounded-[2.5rem] shadow-sm overflow-hidden">
                  <div className="p-6 md:p-8 border-b border-zinc-100 flex items-center justify-between">
                    <h3 className="text-lg md:text-xl font-bold text-zinc-900">Recent Products</h3>
                    <button onClick={() => setActiveTab("data")} className="text-sm font-bold text-indigo-600">View All</button>
                  </div>
                  <div className="divide-y divide-zinc-100">
                    {products.slice(0, 5).map((product, i) => (
                      <div key={i} className="p-4 md:p-6 flex items-center gap-4 hover:bg-zinc-50 transition-colors">
                        <div className="w-12 h-12 md:w-16 md:h-16 bg-zinc-100 rounded-2xl flex items-center justify-center text-[10px] font-bold text-zinc-400 shrink-0">
                          ASIN
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="text-sm md:text-base font-bold text-zinc-900 truncate">{product.title}</h4>
                          <div className="flex items-center gap-3 mt-1">
                            <span className="text-xs font-bold text-indigo-600">${product.price}</span>
                            <div className="flex items-center gap-1">
                              <Star className="w-3 h-3 text-amber-500 fill-amber-500" />
                              <span className="text-xs font-medium text-zinc-500">{product.rating}</span>
                            </div>
                          </div>
                        </div>
                        <a href={product.productUrl} target="_blank" rel="noreferrer" className="p-3 bg-zinc-100 rounded-2xl text-zinc-400 hover:text-indigo-600 transition-colors">
                          <ExternalLink className="w-5 h-5" />
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === "data" && (
              <motion.div 
                key="data"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="bg-white border border-zinc-200 rounded-[2.5rem] shadow-sm overflow-hidden"
              >
                <div className="p-6 md:p-8 border-b border-zinc-100">
                  <h3 className="text-xl font-bold text-zinc-900">Data Explorer</h3>
                  <p className="text-sm text-zinc-500 mt-1">Full extraction history</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest border-b border-zinc-100">
                        <th className="px-6 py-6">Product</th>
                        <th className="px-6 py-6">Price</th>
                        <th className="px-6 py-6">Rating</th>
                        <th className="px-6 py-6 hidden md:table-cell">Seller</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {products.map((product, i) => (
                        <tr key={i} className="hover:bg-zinc-50 transition-colors">
                          <td className="px-6 py-4">
                            <div className="max-w-xs md:max-w-md">
                              <p className="text-sm font-bold text-zinc-900 truncate">{product.title}</p>
                              <p className="text-[10px] font-mono text-zinc-400 mt-1">{product.asin}</p>
                            </div>
                          </td>
                          <td className="px-6 py-4 font-black text-zinc-900 text-sm">${product.price}</td>
                          <td className="px-6 py-4 text-sm font-bold text-zinc-600">{product.rating}</td>
                          <td className="px-6 py-4 text-xs text-zinc-500 hidden md:table-cell">{product.sellerName}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </motion.div>
            )}

            {activeTab === "logs" && (
              <motion.div 
                key="logs"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                className="bg-[#1C1C1E] border border-zinc-800 rounded-[2.5rem] overflow-hidden flex flex-col h-[calc(100vh-16rem)] md:h-[calc(100vh-12rem)] shadow-xl"
              >
                <div className="p-5 border-b border-zinc-800 bg-[#2C2C2E] flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                    <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Live Console</span>
                  </div>
                  <button onClick={() => setLogs([])} className="text-[10px] font-bold text-zinc-500 uppercase hover:text-white transition-colors">Clear</button>
                </div>
                <div className="flex-1 p-5 font-mono text-[11px] md:text-xs overflow-y-auto space-y-2 custom-scrollbar">
                  {logs.map((log, i) => (
                    <div key={i} className="flex gap-3">
                      <span className="text-zinc-600 shrink-0">{log.timestamp}</span>
                      <span className={cn(
                        "font-bold uppercase",
                        log.type === "info" && "text-blue-400",
                        log.type === "success" && "text-emerald-400",
                        log.type === "warn" && "text-amber-400",
                        log.type === "error" && "text-red-400"
                      )}>
                        {log.type}:
                      </span>
                      <span className="text-zinc-300 leading-relaxed">{log.message}</span>
                    </div>
                  ))}
                  <div ref={logEndRef} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 10px;
        }
      `}</style>
    </div>
  );
}
