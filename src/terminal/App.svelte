<script>
  import { onMount } from 'svelte';
  
  // State
  let messages = [];
  let chatHistory = [];
  let historyIndex = -1;
  let activePanel = 'chat'; // chat | signals | alerts | portfolio | heatmap | screener | pipeline | hero | trades
  let showCommandPalette = false;
  let commandInput = '';
  let chatInput = '';
  let isTyping = false;
  let autocompleteVisible = false;
  let tickerSearch = '';
  
  // Data
  let signals = [];
  let alerts = [];
  let portfolio = { positions: [], pnl: 0, value: 0 };
  let heatmap = [];
  let screenerResults = [];
  let pipelineStatus = { status: 'idle', runId: null, progress: 0 };
  let heroPick = null;
  let trades = [];
  let marketData = {};
  
  // Utils
  const POPULAR_TICKERS = ['RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'ICICIBANK', 'TATASTEEL', 'TATAMOTORS', 'SBIN', 'LT', 'ITC', 'HINDUNILVR', 'KOTAKBANK', 'AXISBANK', 'MARUTI', 'SUNPHARMA', 'TITAN', 'ADANIENT', 'ADANIPORTS', 'BAJFINANCE', 'DIVISLAB'];
  
  let now = new Date();
  let connectionStatus = 'connecting';
  
  function fmt(num, decimals = 2) {
    if (num === null || num === undefined) return '-';
    return typeof num === 'number' ? num.toFixed(decimals) : num;
  }
  
  function formatINR(num) {
    if (num === null || num === undefined) return '-';
    if (typeof num !== 'number') return num;
    return '₹' + num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  
  function pct(num) {
    if (num === null || num === undefined) return '-';
    return typeof num === 'number' ? (num * 100).toFixed(1) + '%' : num;
  }
  
  function pnlClass(num) {
    if (num === null || num === undefined) return 'text-gray-600';
    return num >= 0 ? 'text-green-500' : 'text-red-500';
  }
  
  function time(date) { 
    if (!date) return '--:--';
    return new Date(date).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' }); 
  }
  
  function dateStr(date) {
    if (!date) return '--';
    return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  
  async function fetchJSON(url, options = {}) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    } catch (err) {
      console.error('Fetch error:', url, err);
      return null;
    }
  }
  
  // Clock & Connection
  onMount(() => {
    const interval = setInterval(() => {
      now = new Date();
    }, 1000);
    
    loadData();
    const pollInterval = setInterval(loadData, 30000); // Refresh every 30s
    
    return () => {
      clearInterval(interval);
      clearInterval(pollInterval);
    };
  });
  
  // Panel navigation
  function setActivePanel(panel) {
    activePanel = panel;
  }
  
  // Keyboard shortcuts
  function handleKeydown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      showCommandPalette = true;
    }
    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.key === '1') setActivePanel('signals');
      if (e.key === '2') setActivePanel('alerts');
      if (e.key === '3') setActivePanel('portfolio');
      if (e.key === '4') setActivePanel('heatmap');
      if (e.key === '5') setActivePanel('screener');
      if (e.key === '6') setActivePanel('pipeline');
      if (e.key === '7') setActivePanel('hero');
      if (e.key === '8') setActivePanel('trades');
      if (e.key === 'Escape') {
        showCommandPalette = false;
        autocompleteVisible = false;
      }
    }
  }
  
  // Load all data
  async function loadData() {
    try {
      connectionStatus = 'connected';
      const results = await Promise.all([
        fetchJSON('/api/signals?limit=20'),
        fetchJSON('/api/alerts'),
        fetchJSON('/api/mit/portfolio'),
        fetchJSON('/api/heatmap'),
        fetchJSON('/api/mit/screenipy/candidates'),
        fetchJSON('/api/mit/pipeline/latest'),
        fetchJSON('/api/mit/hero/analyze'),
        fetchJSON('/api/mit/trades')
      ]);
      
      signals = results[0] || [];
      alerts = results[1] || [];
      portfolio = results[2] || { positions: [], pnl: 0, value: 0 };
      heatmap = results[3] || [];
      screenerResults = results[4] || [];
      pipelineStatus = results[5] || { status: 'idle' };
      heroPick = results[6];
      trades = results[7] || [];
      
    } catch (err) {
      console.error('Load error:', err);
      connectionStatus = 'error';
    }
  }
  
  // Chat with agent
  async function sendMessage() {
    const query = chatInput.trim();
    if (!query) return;
    
    messages = [...messages, { role: 'user', content: query, time: new Date() }];
    chatHistory = [...chatHistory, query];
    historyIndex = chatHistory.length;
    chatInput = '';
    isTyping = true;
    autocompleteVisible = false;
    
    try {
      const lcQuery = query.toLowerCase();
      
      // Quick commands
      if (lcQuery === 'clear' || lcQuery === 'cls') {
        messages = [];
        isTyping = false;
        return;
      }
      
      if (lcQuery === 'refresh') {
        await loadData();
        messages = [...messages, { role: 'assistant', content: 'Data refreshed successfully.', time: new Date() }];
        isTyping = false;
        return;
      }
      
      // Panel commands
      const panelCommands = {
        'signals': 'signals',
        'alerts': 'alerts', 
        'portfolio': 'portfolio',
        'positions': 'portfolio',
        'heatmap': 'heatmap',
        'screener': 'screener',
        'screen': 'screener',
        'pipeline': 'pipeline',
        'hero': 'hero',
        'trades': 'trades',
        'trade': 'trades'
      };
      
      for (const [cmd, panel] of Object.entries(panelCommands)) {
        if (lcQuery === cmd || lcQuery === 'show ' + cmd || lcQuery === 'view ' + cmd) {
          setActivePanel(panel);
          messages = [...messages, { role: 'assistant', content: `Opened ${panel.toUpperCase()} panel.`, time: new Date() }];
          isTyping = false;
          return;
        }
      }
      
      // Run pipeline
      if (lcQuery.includes('run pipeline') || lcQuery.includes('execute pipeline')) {
        const result = await fetchJSON('/api/mit/pipeline/run', { method: 'POST' });
        if (result) {
          pipelineStatus = { status: 'running', runId: result.runId, progress: 0 };
          messages = [...messages, { role: 'assistant', content: `Pipeline started: ${result.runId}\nStatus: ${result.status || 'running'}`, time: new Date() }];
        }
        isTyping = false;
        return;
      }
      
      // Run screener
      if (lcQuery.includes('run screener') || lcQuery.includes('scan')) {
        const result = await fetchJSON('/api/mit/screenipy/run');
        if (result) {
          screenerResults = result.candidates || [];
          setActivePanel('screener');
          messages = [...messages, { role: 'assistant', content: `Screener found ${screenerResults.length} candidates.`, time: new Date() }];
        }
        isTyping = false;
        return;
      }
      
      // Default: use manager agent
      const response = await fetchJSON('/api/mit/manager/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query })
      });
      
      isTyping = false;
      
      if (response?.outputs?.[0]?.content) {
        messages = [...messages, { 
          role: 'assistant', 
          content: response.outputs[0].content,
          intent: response.intent,
          interpretation: response.interpretation,
          time: new Date()
        }];
        
        // Agent can control panels
        if (response.intent === 'show_panel' && response.targetPanel) {
          setActivePanel(response.targetPanel);
        }
      } else {
        messages = [...messages, { role: 'assistant', content: 'No response from agent. Try "help" for commands.', time: new Date() }];
      }
    } catch (err) {
      isTyping = false;
      messages = [...messages, { role: 'system', content: `Error: ${err.message}`, time: new Date() }];
    }
  }
  
  function handleChatKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
    if (e.key === 'ArrowUp' && chatHistory.length > 0) {
      e.preventDefault();
      historyIndex = Math.max(0, historyIndex - 1);
      chatInput = chatHistory[historyIndex] || '';
    }
    if (e.key === 'ArrowDown' && chatHistory.length > 0) {
      e.preventDefault();
      historyIndex = Math.min(chatHistory.length, historyIndex + 1);
      chatInput = historyIndex < chatHistory.length ? chatHistory[historyIndex] : '';
    }
  }
  
  function handleCommandSubmit() {
    if (commandInput.trim()) {
      chatInput = commandInput.trim();
      showCommandPalette = false;
      commandInput = '';
      sendMessage();
    }
  }
  
  function handleTickerAutocomplete(e) {
    const val = e.target.value.toUpperCase();
    const words = val.split(' ');
    const lastWord = words[words.length - 1];
    if (lastWord.length < 1) {
      autocompleteVisible = false;
      return;
    }
    autocompleteVisible = POPULAR_TICKERS.filter(t => t.startsWith(lastWord)).slice(0, 5).length > 0;
  }
  
  function selectTicker(ticker) {
    const words = chatInput.split(' ');
    words.pop();
    chatInput = (words.join(' ') + ' ' + ticker).trim();
    autocompleteVisible = false;
  }
  
  // Computed
  $: filteredTickers = chatInput ? POPULAR_TICKERS.filter(t => t.startsWith(chatInput.split(' ').pop().toUpperCase())).slice(0, 5) : [];
  $: portfolioPnl = portfolio?.pnl || 0;
  $: portfolioValue = portfolio?.value || 0;
  $: openPositions = portfolio?.positions?.length || 0;
  $: activeAlerts = alerts?.filter(a => a.status === 'active')?.length || 0;
</script>

<svelte:window on:keydown={handleKeydown} />

<div class="h-screen bg-[#0a0a0a] text-gray-300 font-mono flex flex-col overflow-hidden">
  <!-- Top Bar -->
  <header class="h-10 bg-[#111] border-b border-[#222] flex items-center justify-between px-4 shrink-0">
    <div class="flex items-center gap-4">
      <div class="flex items-center gap-2">
        <span class="text-orange-500 font-bold tracking-widest">IPST</span>
        <span class="text-[#444]">│</span>
        <span class="text-[#666] text-xs tracking-wider">INDIA POLICY SIGNAL TERMINAL</span>
      </div>
    </div>
    <div class="flex items-center gap-6 text-xs">
      <div class="flex items-center gap-2">
        <span class="w-2 h-2 rounded-full {connectionStatus === 'connected' ? 'bg-green-500' : connectionStatus === 'error' ? 'bg-red-500' : 'bg-yellow-500'}"></span>
        <span class="{connectionStatus === 'connected' ? 'text-green-500' : 'text-gray-600'}">{connectionStatus.toUpperCase()}</span>
      </div>
      <span class="text-[#666]">{now.toLocaleTimeString('en-US', { hour12: false })}</span>
      <span class="text-[#666]">{now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
    </div>
  </header>

  <!-- Navigation Bar -->
  <nav class="h-9 bg-[#0f0f0f] border-b border-[#222] flex items-center px-2 gap-1 shrink-0 overflow-x-auto">
    <button 
      class="px-3 py-1 rounded text-xs uppercase transition-colors {activePanel === 'chat' ? 'bg-orange-500 text-black font-medium' : 'text-[#666] hover:text-orange-500'}"
      on:click={() => setActivePanel('chat')}
    >
      <span class="text-[#666]">[ESC]</span> CHAT
    </button>
    <button 
      class="px-3 py-1 rounded text-xs uppercase transition-colors {activePanel === 'signals' ? 'bg-orange-500 text-black font-medium' : 'text-[#666] hover:text-orange-500'}"
      on:click={() => setActivePanel('signals')}
    >
      <span class="text-[#666]">[1]</span> SIGNALS <span class="ml-1 text-[10px] bg-[#222] px-1 rounded">{signals.length}</span>
    </button>
    <button 
      class="px-3 py-1 rounded text-xs uppercase transition-colors {activePanel === 'alerts' ? 'bg-orange-500 text-black font-medium' : 'text-[#666] hover:text-orange-500'}"
      on:click={() => setActivePanel('alerts')}
    >
      <span class="text-[#666]">[2]</span> ALERTS <span class="ml-1 text-[10px] bg-red-500/20 text-red-500 px-1 rounded">{activeAlerts}</span>
    </button>
    <button 
      class="px-3 py-1 rounded text-xs uppercase transition-colors {activePanel === 'portfolio' ? 'bg-orange-500 text-black font-medium' : 'text-[#666] hover:text-orange-500'}"
      on:click={() => setActivePanel('portfolio')}
    >
      <span class="text-[#666]">[3]</span> PORTFOLIO <span class="ml-1 text-[10px] bg-[#222] px-1 rounded">{openPositions}</span>
    </button>
    <button 
      class="px-3 py-1 rounded text-xs uppercase transition-colors {activePanel === 'heatmap' ? 'bg-orange-500 text-black font-medium' : 'text-[#666] hover:text-orange-500'}"
      on:click={() => setActivePanel('heatmap')}
    >
      <span class="text-[#666]">[4]</span> HEATMAP
    </button>
    <button 
      class="px-3 py-1 rounded text-xs uppercase transition-colors {activePanel === 'screener' ? 'bg-orange-500 text-black font-medium' : 'text-[#666] hover:text-orange-500'}"
      on:click={() => setActivePanel('screener')}
    >
      <span class="text-[#666]">[5]</span> SCREENER
    </button>
    <button 
      class="px-3 py-1 rounded text-xs uppercase transition-colors {activePanel === 'pipeline' ? 'bg-orange-500 text-black font-medium' : 'text-[#666] hover:text-orange-500'}"
      on:click={() => setActivePanel('pipeline')}
    >
      <span class="text-[#666]">[6]</span> PIPELINE <span class="ml-1 text-[10px] {pipelineStatus.status === 'running' ? 'bg-green-500/20 text-green-500' : 'bg-[#222]'} px-1 rounded">{pipelineStatus.status}</span>
    </button>
    <button 
      class="px-3 py-1 rounded text-xs uppercase transition-colors {activePanel === 'hero' ? 'bg-orange-500 text-black font-medium' : 'text-[#666] hover:text-orange-500'}"
      on:click={() => setActivePanel('hero')}
    >
      <span class="text-[#666]">[7]</span> HERO
    </button>
    <button 
      class="px-3 py-1 rounded text-xs uppercase transition-colors {activePanel === 'trades' ? 'bg-orange-500 text-black font-medium' : 'text-[#666] hover:text-orange-500'}"
      on:click={() => setActivePanel('trades')}
    >
      <span class="text-[#666]">[8]</span> TRADES
    </button>
    <div class="flex-1"></div>
    <button 
      class="px-3 py-1 rounded text-xs text-[#666] hover:text-orange-500 transition-colors"
      on:click={() => showCommandPalette = true}
    >
      <span class="text-[#444]">⌘K</span> COMMAND
    </button>
  </nav>

  <!-- Main Content -->
  <main class="flex-1 flex overflow-hidden">
    <!-- CHAT PANEL -->
    {#if activePanel === 'chat'}
      <div class="flex-1 flex flex-col min-w-0">
        <!-- Messages -->
        <div class="flex-1 overflow-y-auto p-4 space-y-3">
          <!-- Welcome -->
          <div class="bg-[#111] border border-[#222] p-4 rounded">
            <div class="flex items-center gap-2 mb-2">
              <span class="text-green-500">●</span>
              <span class="text-white font-medium">IPST TERMINAL</span>
              <span class="text-[#444] text-xs ml-2">v4.0</span>
            </div>
            <p class="text-xs text-[#666] mb-3">AI-powered command center. Natural language control.</p>
            <div class="text-xs text-[#555] space-y-1">
              <p><span class="text-orange-500">></span> "analyze RELIANCE" - AI stock analysis</p>
              <p><span class="text-orange-500">></span> "show portfolio" / "run pipeline"</p>
              <p><span class="text-orange-500">></span> Press <span class="text-white">1-8</span> switch panels</p>
              <p><span class="text-orange-500">></span> "help" - all commands</p>
            </div>
              <p><span class="text-orange-500">></span> "show heatmap" / "run screener" / historical data: POST /api/mit/pipeline/run</p>
          </div>
          
          <!-- Messages -->
          {#each messages as msg}
            {#if msg.role === 'user'}
              <div class="flex gap-3">
                <div class="w-6 h-6 rounded bg-orange-500/20 flex items-center justify-center text-orange-500 shrink-0">
                  <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z"/></svg>
                </div>
                <div class="bg-[#111] border border-[#222] p-3 rounded flex-1 min-w-0">
                  <div class="text-xs text-[#444] mb-1">{time(msg.time)}</div>
                  <p class="text-sm text-white whitespace-pre-wrap">{msg.content}</p>
                </div>
              </div>
            {:else if msg.role === 'assistant'}
              <div class="flex gap-3">
                <div class="w-6 h-6 rounded bg-green-500/20 flex items-center justify-center text-green-500 shrink-0">
                  <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z"/></svg>
                </div>
                <div class="bg-[#111] border border-[#222] p-3 rounded flex-1 min-w-0">
                  {#if msg.intent}
                    <div class="mb-2 text-xs {msg.intent === 'trade_action' ? 'text-green-500' : msg.intent === 'analysis' ? 'text-blue-400' : 'text-orange-500'}">● {msg.intent.toUpperCase()}</div>
                  {/if}
                  <div class="text-sm text-white whitespace-pre-wrap">{msg.content}</div>
                  {#if msg.interpretation}
                    <div class="mt-2 text-xs text-[#444] border-t border-[#222] pt-2">{msg.interpretation}</div>
                  {/if}
                </div>
              </div>
            {:else}
              <div class="bg-red-500/10 border border-red-500/30 p-3 rounded">
                <p class="text-sm text-red-500">{msg.content}</p>
              </div>
            {/if}
          {/each}
          
          <!-- Typing -->
          {#if isTyping}
            <div class="flex gap-3">
              <div class="w-6 h-6 rounded bg-green-500/20 flex items-center justify-center text-green-500 shrink-0">
                <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0z"/></svg>
              </div>
              <div class="bg-[#111] border border-[#222] p-3 rounded">
                <div class="flex gap-1">
                  <span class="w-2 h-2 rounded-full bg-green-500/60 animate-bounce"></span>
                  <span class="w-2 h-2 rounded-full bg-green-500/60 animate-bounce" style="animation-delay: 0.1s"></span>
                  <span class="w-2 h-2 rounded-full bg-green-500/60 animate-bounce" style="animation-delay: 0.2s"></span>
                </div>
              </div>
            </div>
          {/if}
        </div>

        <!-- Input -->
        <div class="p-4 border-t border-[#222] bg-[#0f0f0f]">
          <form on:submit|preventDefault={sendMessage} class="relative">
            <div class="flex gap-2 items-center">
              <span class="text-orange-500">›</span>
              <div class="flex-1 relative">
                <input
                  type="text"
                  bind:value={chatInput}
                  on:keydown={handleChatKeydown}
                  on:input={handleTickerAutocomplete}
                  placeholder="Ask anything: 'analyze INFY', 'show portfolio', 'run pipeline'..."
                  class="w-full bg-[#111] border border-[#222] px-4 py-3 rounded text-sm text-white placeholder-[#444] focus:outline-none focus:border-orange-500"
                  autocomplete="off"
                />
                
                <!-- Autocomplete -->
                {#if autocompleteVisible && filteredTickers.length > 0}
                  <div class="absolute bottom-full left-0 right-0 bg-[#111] border border-[#222] rounded mt-1 overflow-hidden">
                    {#each filteredTickers as ticker}
                      <button 
                        type="button"
                        class="w-full px-4 py-2 text-left text-sm text-white hover:bg-[#222] transition-colors"
                        on:click={() => selectTicker(ticker)}
                      >
                        {ticker}
                      </button>
                    {/each}
                  </div>
                {/if}
              </div>
              <button type="submit" class="px-6 py-3 rounded bg-orange-500 text-black text-xs uppercase font-bold hover:bg-orange-600 transition-colors">SEND</button>
            </div>
          </form>
        </div>
      </div>
    {/if}

    <!-- SIGNALS PANEL -->
    {#if activePanel === 'signals'}
      <div class="flex-1 flex flex-col p-4 overflow-hidden">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg text-white font-medium">SIGNALS <span class="text-[#666] text-sm ml-2">{signals.length} items</span></h2>
          <button class="px-3 py-1 rounded bg-[#222] text-xs text-[#666] hover:text-orange-500 transition-colors" on:click={loadData}>REFRESH</button>
        </div>
        
        <div class="flex-1 overflow-y-auto space-y-2">
          {#each signals as s}
            <button 
              class="w-full p-3 bg-[#111] border border-[#222] rounded hover:border-orange-500/50 transition-colors text-left"
              on:click={() => { chatInput = `analyze ${s.linkedEntities?.[0]?.ticker || ''}`; sendMessage(); }}
            >
              <div class="flex justify-between items-start">
                <div>
                  <span class="text-white font-medium">{s.linkedEntities?.[0]?.ticker || 'N/A'}</span>
                  <span class="text-[#666] text-xs ml-2">{s.event?.source || ''}</span>
                </div>
                <div class="text-right">
                  <span class="text-sm {s.impact?.direction === 'positive' ? 'text-green-500' : s.impact?.direction === 'negative' ? 'text-red-500' : 'text-[#666]'}">{pct(s.score)}</span>
                  <div class="text-xs text-[#444]">{dateStr(s.event?.date)}</div>
                </div>
              </div>
              <div class="text-xs text-[#666] mt-2 truncate">{s.event?.title || ''}</div>
              {#if s.tags?.length}
                <div class="flex gap-1 mt-2">
                  {#each s.tags.slice(0, 3) as tag}
                    <span class="text-[10px] bg-[#222] text-[#666] px-2 py-0.5 rounded">{tag}</span>
                  {/each}
                </div>
              {/if}
            </button>
          {/each}
          
          {#if signals.length === 0}
            <div class="text-center text-[#444] py-8">No signals yet. Run pipeline to generate.</div>
          {/if}
        </div>
      </div>
    {/if}

    <!-- ALERTS PANEL -->
    {#if activePanel === 'alerts'}
      <div class="flex-1 flex flex-col p-4 overflow-hidden">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg text-white font-medium">ALERTS <span class="text-red-500 text-sm ml-2">{activeAlerts} active</span></h2>
          <button class="px-3 py-1 rounded bg-[#222] text-xs text-[#666] hover:text-orange-500 transition-colors" on:click={loadData}>REFRESH</button>
        </div>
        
        <div class="flex-1 overflow-y-auto space-y-2">
          {#each alerts as a}
            <div class="p-3 bg-[#111] border-l-2 rounded-r {a.severity === 'high' ? 'border-l-red-500' : a.severity === 'medium' ? 'border-l-yellow-500' : 'border-l-blue-400'}">
              <div class="flex justify-between">
                <span class="text-xs {a.severity === 'high' ? 'text-red-500' : a.severity === 'medium' ? 'text-yellow-500' : 'text-blue-400'}">{a.severity?.toUpperCase()}</span>
                <span class="text-xs text-[#444]">{time(a.triggeredAt)} {dateStr(a.triggeredAt)}</span>
              </div>
              <div class="text-sm text-white mt-1">{a.reason}</div>
              <div class="text-xs text-[#666] mt-1">{a.ticker || 'General'}</div>
            </div>
          {/each}
          
          {#if alerts.length === 0}
            <div class="text-center text-[#444] py-8">No alerts configured.</div>
          {/if}
        </div>
      </div>
    {/if}

    <!-- PORTFOLIO PANEL -->
    {#if activePanel === 'portfolio'}
      <div class="flex-1 flex flex-col p-4 overflow-hidden">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg text-white font-medium">PORTFOLIO</h2>
          <button class="px-3 py-1 rounded bg-[#222] text-xs text-[#666] hover:text-orange-500 transition-colors" on:click={loadData}>REFRESH</button>
        </div>
        
        <!-- Summary -->
        <div class="grid grid-cols-3 gap-4 mb-6">
          <div class="bg-[#111] border border-[#222] p-4 rounded">
            <div class="text-xs text-[#666] uppercase">Total Value</div>
            <div class="text-xl text-white mt-1">{formatINR(portfolioValue)}</div>
          </div>
          <div class="bg-[#111] border border-[#222] p-4 rounded">
            <div class="text-xs text-[#666] uppercase">P&L</div>
            <div class="text-xl {pnlClass(portfolioPnl)} mt-1">{formatINR(portfolioPnl)}</div>
          </div>
          <div class="bg-[#111] border border-[#222] p-4 rounded">
            <div class="text-xs text-[#666] uppercase">Positions</div>
            <div class="text-xl text-white mt-1">{openPositions}</div>
          </div>
        </div>
        
        <!-- Positions -->
        <div class="flex-1 overflow-y-auto">
          <div class="text-xs text-[#666] uppercase mb-2">Open Positions</div>
          <div class="space-y-2">
            {#each (portfolio.positions || []).slice(0, 20) as p}
              <button 
                class="w-full p-3 bg-[#111] border border-[#222] rounded hover:border-orange-500/50 transition-colors text-left"
                on:click={() => { chatInput = `analyze ${p.ticker}`; setActivePanel('chat'); sendMessage(); }}
              >
                <div class="flex justify-between items-center">
                  <div>
                    <span class="text-white font-medium">{p.ticker}</span>
                    <span class="text-[#666] text-xs ml-2">{p.qty} shares</span>
                  </div>
                  <div class="text-right">
                    <div class="text-sm {pnlClass(p.pnl)}">{formatINR(p.pnl)}</div>
                    <div class="text-xs text-[#444]">@ {formatINR(p.avgPrice)}</div>
                  </div>
                </div>
              </button>
            {/each}
          </div>
          
          {#if !portfolio.positions?.length}
            <div class="text-center text-[#444] py-8">No open positions.</div>
          {/if}
        </div>
      </div>
    {/if}

    <!-- HEATMAP PANEL -->
    {#if activePanel === 'heatmap'}
      <div class="flex-1 flex flex-col p-4 overflow-hidden">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg text-white font-medium">SECTOR HEATMAP</h2>
          <button class="px-3 py-1 rounded bg-[#222] text-xs text-[#666] hover:text-orange-500 transition-colors" on:click={loadData}>REFRESH</button>
        </div>
        
        <div class="flex-1 overflow-y-auto space-y-2">
          {#each heatmap as h}
            <div 
              class="p-4 rounded transition-all hover:scale-[1.01]"
              style="background: linear-gradient(90deg, {h.weightedScore > 0 ? `rgba(0,200,100,${Math.min(0.3, Math.abs(h.weightedScore))})` : h.weightedScore < 0 ? `rgba(200,0,50,${Math.min(0.3, Math.abs(h.weightedScore))})` : '#111'} 0%, #111 100%)"
            >
              <div class="flex justify-between items-center">
                <div>
                  <span class="text-white font-medium">{h.sector}</span>
                  <span class="text-[#666] text-xs ml-2">{h.signalCount || 0} signals</span>
                </div>
                <div class="text-lg {h.weightedScore > 0 ? 'text-green-500' : h.weightedScore < 0 ? 'text-red-500' : 'text-[#666]'}">
                  {pct(h.weightedScore)}
                </div>
              </div>
              <div class="mt-2 h-1 bg-[#222] rounded overflow-hidden">
                <div 
                  class="h-full transition-all {h.weightedScore > 0 ? 'bg-green-500' : h.weightedScore < 0 ? 'bg-red-500' : 'bg-[#444]'}"
                  style="width: {Math.min(100, Math.abs(h.weightedScore) * 100)}%"
                ></div>
              </div>
            </div>
          {/each}
          
          {#if heatmap.length === 0}
            <div class="text-center text-[#444] py-8">No heatmap data. Run pipeline.</div>
          {/if}
        </div>
      </div>
    {/if}

    <!-- SCREENER PANEL -->
    {#if activePanel === 'screener'}
      <div class="flex-1 flex flex-col p-4 overflow-hidden">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg text-white font-medium">SCREENER <span class="text-[#666] text-sm ml-2">{screenerResults.length} candidates</span></h2>
          <button 
            class="px-3 py-1 rounded bg-orange-500 text-black text-xs font-medium hover:bg-orange-600 transition-colors"
            on:click={async () => { 
              const result = await fetchJSON('/api/mit/screenipy/run');
              if (result) screenerResults = result.candidates || [];
            }}
          >
            RUN SCREENER
          </button>
        </div>
        
        <div class="flex-1 overflow-y-auto space-y-2">
          {#each screenerResults as c}
            <button 
              class="w-full p-3 bg-[#111] border border-[#222] rounded hover:border-orange-500/50 transition-colors text-left"
              on:click={() => { chatInput = `analyze ${c.ticker}`; setActivePanel('chat'); sendMessage(); }}
            >
              <div class="flex justify-between">
                <div>
                  <span class="text-white font-medium">{c.ticker}</span>
                  <span class="text-[#666] text-xs ml-2">{c.sector || ''}</span>
                </div>
                <span class="text-sm {c.score > 0.5 ? 'text-green-500' : 'text-[#666]'}">{pct(c.score)}</span>
              </div>
              <div class="text-xs text-[#666] mt-1 truncate">{c.reason || ''}</div>
            </button>
          {/each}
          
          {#if screenerResults.length === 0}
            <div class="text-center text-[#444] py-8">No candidates. Click "Run Screener" to scan.</div>
          {/if}
        </div>
      </div>
    {/if}

    <!-- PIPELINE PANEL -->
    {#if activePanel === 'pipeline'}
      <div class="flex-1 flex flex-col p-4 overflow-hidden">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg text-white font-medium">PIPELINE</h2>
          <button 
            class="px-3 py-1 rounded bg-green-500/20 text-green-500 text-xs hover:bg-green-500/30 transition-colors"
            on:click={async () => {
              const result = await fetchJSON('/api/mit/pipeline/run', { method: 'POST' });
              if (result) pipelineStatus = { status: 'running', runId: result.runId, progress: 0 };
            }}
          >
            RUN PIPELINE
          </button>
        </div>
        
        <!-- Status -->
        <div class="bg-[#111] border border-[#222] p-6 rounded mb-6">
          <div class="flex items-center gap-3 mb-4">
            <span class="w-3 h-3 rounded-full {pipelineStatus.status === 'running' ? 'bg-green-500 animate-pulse' : pipelineStatus.status === 'completed' ? 'bg-blue-400' : 'bg-[#444]'}"></span>
            <span class="text-white font-medium uppercase">{pipelineStatus.status}</span>
          </div>
          {#if pipelineStatus.runId}
            <div class="text-xs text-[#666]">Run ID: {pipelineStatus.runId}</div>
          {/if}
          {#if pipelineStatus.progress > 0}
            <div class="mt-4">
              <div class="h-2 bg-[#222] rounded overflow-hidden">
                <div class="h-full bg-orange-500 transition-all" style="width: {pipelineStatus.progress}%"></div>
              </div>
              <div class="text-xs text-[#666] mt-1">{pipelineStatus.progress}% complete</div>
            </div>
          {/if}
        </div>
        
        <!-- Pipeline Steps -->
        <div class="text-xs text-[#666] uppercase mb-2">Pipeline Steps</div>
        <div class="space-y-2">
          {#each ['Fetch Sources', 'Parse Documents', 'Generate Signals', 'Score & Rank', 'Update Heatmap', 'Send Alerts'] as step, i}
            <div class="flex items-center gap-3 p-3 bg-[#111] border border-[#222] rounded">
              <span class="w-6 h-6 rounded bg-[#222] text-xs text-[#666] flex items-center justify-center">{i + 1}</span>
              <span class="text-sm text-white">{step}</span>
              <span class="ml-auto text-xs text-[#444]">{pipelineStatus.status === 'running' ? '...' : '○'}</span>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- HERO PANEL -->
    {#if activePanel === 'hero'}
      <div class="flex-1 flex flex-col p-4 overflow-hidden">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg text-white font-medium">HERO ANALYSIS</h2>
          <button 
            class="px-3 py-1 rounded bg-orange-500/20 text-orange-500 text-xs hover:bg-orange-500/30 transition-colors"
            on:click={async () => {
              heroPick = await fetchJSON('/api/mit/hero/analyze');
            }}
          >
            ANALYZE
          </button>
        </div>
        
        {#if heroPick}
          <div class="bg-[#111] border border-orange-500/30 p-6 rounded">
            <div class="flex justify-between items-start mb-4">
              <div>
                <span class="text-2xl text-white font-bold">{heroPick.ticker}</span>
                <span class="text-[#666] ml-2">{heroPick.name || ''}</span>
              </div>
              <span class="text-2xl {heroPick.score > 0 ? 'text-green-500' : 'text-red-500'}">{pct(heroPick.score)}</span>
            </div>
            <div class="text-sm text-[#666] mb-4">{heroPick.thesis || ''}</div>
            <div class="grid grid-cols-3 gap-4">
              {#each Object.entries(heroPick.metrics || {}).slice(0, 6) as [key, val]}
                <div>
                  <div class="text-xs text-[#666] uppercase">{key}</div>
                  <div class="text-sm text-white">{typeof val === 'number' ? fmt(val) : val}</div>
                </div>
              {/each}
            </div>
          </div>
        {:else}
          <div class="flex-1 flex items-center justify-center">
            <div class="text-center">
              <div class="text-4xl text-[#222] mb-4">★</div>
              <div class="text-[#666]">Click "Analyze" to get top stock pick</div>
            </div>
          </div>
        {/if}
      </div>
    {/if}

    <!-- TRADES PANEL -->
    {#if activePanel === 'trades'}
      <div class="flex-1 flex flex-col p-4 overflow-hidden">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg text-white font-medium">TRADES <span class="text-[#666] text-sm ml-2">{trades.length} closed</span></h2>
          <button class="px-3 py-1 rounded bg-[#222] text-xs text-[#666] hover:text-orange-500 transition-colors" on:click={loadData}>REFRESH</button>
        </div>
        
        <div class="flex-1 overflow-y-auto space-y-2">
          {#each trades as t}
            <div class="p-3 bg-[#111] border border-[#222] rounded">
              <div class="flex justify-between">
                <div>
                  <span class="text-white font-medium">{t.ticker}</span>
                  <span class="text-[#666] text-xs ml-2">{t.action?.toUpperCase()}</span>
                </div>
                <div class="text-right">
                  <span class="text-sm {pnlClass(t.pnl)}">{formatINR(t.pnl)}</span>
                  <div class="text-xs text-[#444]">{dateStr(t.closedAt)}</div>
                </div>
              </div>
            </div>
          {/each}
          
          {#if trades.length === 0}
            <div class="text-center text-[#444] py-8">No closed trades yet.</div>
          {/if}
        </div>
      </div>
    {/if}
  </main>

  <!-- Status Bar -->
  <footer class="h-6 bg-[#111] border-t border-[#222] flex items-center px-4 text-[10px] text-[#555] shrink-0">
    <span>IPST v4.0</span>
    <span class="mx-2">|</span>
    <span>API: {connectionStatus}</span>
    <span class="mx-2">|</span>
    <span>Panels: {activePanel.toUpperCase()}</span>
    <span class="mx-2">|</span>
    <span>Press CTRL+K for commands</span>
  </footer>
</div>

<!-- Command Palette -->
{#if showCommandPalette}
  <div class="fixed inset-0 z-50" on:click|self={() => showCommandPalette = false}>
    <div class="absolute inset-0 bg-black/90"></div>
    <div class="absolute top-20 left-1/2 -translate-x-1/2 w-full max-w-xl">
      <div class="bg-[#111] border border-[#222] rounded-lg p-4 shadow-2xl">
        <input
          type="text"
          bind:value={commandInput}
          on:keydown={(e) => e.key === 'Enter' && handleCommandSubmit()}
          placeholder="Type command or query..."
          class="w-full bg-[#0a0a0a] border border-[#222] px-4 py-3 rounded mb-4 text-sm text-white placeholder-[#444] focus:outline-none focus:border-orange-500"
          autofocus
        />
        <div class="grid grid-cols-2 gap-2 text-xs">
          <button class="p-2 bg-[#0a0a0a] border border-[#222] rounded hover:border-orange-500/50 text-left transition-colors" on:click={() => { commandInput = 'analyze '; showCommandPalette = false; }}>
            <span class="text-orange-500">analyze [TICKER]</span>
            <div class="text-[#444]">AI stock analysis</div>
          </button>
          <button class="p-2 bg-[#0a0a0a] border border-[#222] rounded hover:/50 text-leftborder-orange-500 transition-colors" on:click={() => { commandInput = 'show portfolio'; showCommandPalette = false; }}>
            <span class="text-orange-500">portfolio</span>
            <div class="text-[#444]">View positions</div>
          </button>
          <button class="p-2 bg-[#0a0a0a] border border-[#222] rounded hover:border-orange-500/50 text-left transition-colors" on:click={() => { commandInput = 'run pipeline'; showCommandPalette = false; }}>
            <span class="text-orange-500">pipeline</span>
            <div class="text-[#444]">Execute pipeline</div>
          </button>
          <button class="p-2 bg-[#0a0a0a] border border-[#222] rounded hover:border-orange-500/50 text-left transition-colors" on:click={() => { commandInput = 'run screener'; showCommandPalette = false; }}>
            <span class="text-orange-500">screener</span>
            <div class="text-[#444]">Scan candidates</div>
          </button>
          <button class="p-2 bg-[#0a0a0a] border border-[#222] rounded hover:border-orange-500/50 text-left transition-colors" on:click={() => { commandInput = 'show heatmap'; showCommandPalette = false; }}>
            <span class="text-orange-500">heatmap</span>
            <div class="text-[#444]">Sector view</div>
          </button>
          <button class="p-2 bg-[#0a0a0a] border border-[#222] rounded hover:border-orange-500/50 text-left transition-colors" on:click={() => { commandInput = 'help'; showCommandPalette = false; }}>
            <span class="text-orange-500">help</span>
            <div class="text-[#444]">Show commands</div>
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}
