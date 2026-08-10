(function(){
  "use strict";

  var MAJOR_PAIRS = ["EUR/USD","BTC/USD","AAPL","XAU/USD","US30","TSLA","ETH/USD","NAS100"];
  var state = { trades: [], settings: { startingBalance: 1000, defaultRisk: 1 } };
  var editingId = null;
  var selectedDir = "Long";
  var selectedPair = "";

  // ---------------- cloud account (optional) ----------------
  // Fill these in once you've created a free Supabase project (see README).
  // Leave SUPABASE_URL blank to run in local-only guest mode with no account
  // system at all — the app works exactly as before either way.
var SUPABASE_URL = "https://plpltmnyushsmjggatov.supabase.co";
var SUPABASE_ANON_KEY = "sb_publishable_KcYFUdMyKfCdUWW7jjb-wQ_RNrba-R7";
  var CLOUD_ENABLED = !!(SUPABASE_URL && SUPABASE_ANON_KEY);
  var sb = CLOUD_ENABLED && window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
  var currentUser = null; // set once a session is confirmed

  // ---------------- storage layer ----------------
  // Three tiers, chosen automatically:
  //  - 'claude'     : inside Claude's in-chat preview (window.storage)
  //  - 'indexeddb'  : real browser (Vercel/hosted/standalone) — scales to
  //                   thousands of records with async, per-record writes
  //                   instead of rewriting one giant blob every save.
  //  - 'local'      : last-resort fallback if IndexedDB is unavailable/blocked
  var CLAUDE_STORAGE = (typeof window.storage !== 'undefined' && window.storage && typeof window.storage.get === 'function');
  var storageMode = CLAUDE_STORAGE ? 'claude' : 'pending';

  var DB_NAME = 'tradejournal-db', DB_VERSION = 1, STORE_TRADES = 'trades', STORE_META = 'meta';
  var _dbPromise = null;
  function idbOpen(){
    if(_dbPromise) return _dbPromise;
    _dbPromise = new Promise(function(resolve, reject){
      if(!window.indexedDB){ reject(new Error('no indexeddb')); return; }
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function(e){
        var db = e.target.result;
        if(!db.objectStoreNames.contains(STORE_TRADES)) db.createObjectStore(STORE_TRADES, { keyPath: 'id' });
        if(!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META, { keyPath: 'key' });
      };
      req.onsuccess = function(e){ resolve(e.target.result); };
      req.onerror = function(e){ reject(e.target.error); };
    });
    return _dbPromise;
  }
  function idbStore(name, mode){ return idbOpen().then(function(db){ return db.transaction(name, mode).objectStore(name); }); }
  function idbGetAll(name){
    return idbStore(name, 'readonly').then(function(store){
      return new Promise(function(resolve, reject){
        var req = store.getAll();
        req.onsuccess = function(){ resolve(req.result || []); };
        req.onerror = function(){ reject(req.error); };
      });
    });
  }
  function idbPut(name, value){
    return idbStore(name, 'readwrite').then(function(store){
      return new Promise(function(resolve, reject){
        var req = store.put(value);
        req.onsuccess = function(){ resolve(); };
        req.onerror = function(){ reject(req.error); };
      });
    });
  }
  function idbDelete(name, key){
    return idbStore(name, 'readwrite').then(function(store){
      return new Promise(function(resolve, reject){
        var req = store.delete(key);
        req.onsuccess = function(){ resolve(); };
        req.onerror = function(){ reject(req.error); };
      });
    });
  }
  function idbClear(name){
    return idbStore(name, 'readwrite').then(function(store){
      return new Promise(function(resolve, reject){
        var req = store.clear();
        req.onsuccess = function(){ resolve(); };
        req.onerror = function(){ reject(req.error); };
      });
    });
  }
  function idbBulkPut(name, values){
    return idbStore(name, 'readwrite').then(function(store){
      return new Promise(function(resolve, reject){
        values.forEach(function(v){ store.put(v); });
        store.transaction.oncomplete = function(){ resolve(); };
        store.transaction.onerror = function(){ reject(store.transaction.error); };
      });
    });
  }

  function lsGet(key){
    return new Promise(function(resolve, reject){
      try{ var v = window.localStorage.getItem(key); resolve(v==null?null:JSON.parse(v)); }
      catch(e){ reject(e); }
    });
  }
  function lsSet(key, value){
    return new Promise(function(resolve, reject){
      try{ window.localStorage.setItem(key, JSON.stringify(value)); resolve(); }
      catch(e){ reject(e); }
    });
  }

  // dataStore: the single interface the rest of the app talks to.
  function tradeToRow(t, userId){
    return {
      id: t.id, user_id: userId, pair: t.pair, direction: t.direction, date: t.date,
      entry: t.entry, sl: t.sl, tp: t.tp, lot: t.lot, risk_pct: t.riskPct,
      exit: t.exit, exit_date: t.exitDate, notes: t.notes,
      created_at: t.createdAt || new Date().toISOString()
    };
  }
  function rowToTrade(r){
    return {
      id: r.id, pair: r.pair, direction: r.direction, date: r.date,
      entry: r.entry, sl: r.sl, tp: r.tp, lot: r.lot, riskPct: r.risk_pct,
      exit: r.exit, exitDate: r.exit_date, notes: r.notes, createdAt: r.created_at
    };
  }

  var dataStore = {
    loadAll: function(){
      if(currentUser && sb){
        return Promise.all([
          sb.from('trades').select('*').eq('user_id', currentUser.id),
          sb.from('user_settings').select('*').eq('user_id', currentUser.id).maybeSingle()
        ]).then(function(res){
          var tradesRes = res[0], settingsRes = res[1];
          if(tradesRes.error) throw tradesRes.error;
          var trades = (tradesRes.data || []).map(rowToTrade);
          var settingsRow = settingsRes.data;
          var settings = settingsRow ? {
            startingBalance: settingsRow.starting_balance,
            defaultRisk: settingsRow.default_risk,
            lastBackupAt: settingsRow.last_backup_at
          } : {};
          return { trades: trades, settings: settings };
        });
      }
      if(storageMode === 'claude'){
        return Promise.all([
          window.storage.get('fx-trades').catch(function(){ return null; }),
          window.storage.get('fx-settings').catch(function(){ return null; })
        ]).then(function(res){
          var trades = []; var settings = {};
          try{ if(res[0] && res[0].value) trades = JSON.parse(res[0].value); }catch(e){}
          try{ if(res[1] && res[1].value) settings = JSON.parse(res[1].value); }catch(e){}
          return { trades: trades, settings: settings };
        });
      }
      if(storageMode === 'indexeddb'){
        return Promise.all([idbGetAll(STORE_TRADES), idbGetAll(STORE_META)]).then(function(res){
          var settingsRow = res[1].filter(function(r){ return r.key==='settings'; })[0];
          return { trades: res[0], settings: settingsRow ? settingsRow.value : {} };
        });
      }
      return Promise.all([lsGet('fx-trades'), lsGet('fx-settings')]).then(function(res){
        return { trades: res[0] || [], settings: res[1] || {} };
      });
    },
    saveTrade: function(trade){
      if(currentUser && sb){
        return sb.from('trades').upsert(tradeToRow(trade, currentUser.id)).then(function(res){
          if(res.error) throw res.error;
        });
      }
      if(storageMode === 'claude') return dataStore._saveWholeArray();
      if(storageMode === 'indexeddb') return idbPut(STORE_TRADES, trade);
      return lsSet('fx-trades', state.trades);
    },
    deleteTrade: function(id){
      if(currentUser && sb){
        return sb.from('trades').delete().eq('id', id).eq('user_id', currentUser.id).then(function(res){
          if(res.error) throw res.error;
        });
      }
      if(storageMode === 'claude') return dataStore._saveWholeArray();
      if(storageMode === 'indexeddb') return idbDelete(STORE_TRADES, id);
      return lsSet('fx-trades', state.trades);
    },
    replaceAllTrades: function(trades){
      state.trades = trades;
      if(currentUser && sb){
        return sb.from('trades').delete().eq('user_id', currentUser.id).then(function(res){
          if(res.error) throw res.error;
          if(!trades.length) return;
          var rows = trades.map(function(t){ return tradeToRow(t, currentUser.id); });
          return sb.from('trades').upsert(rows).then(function(res2){ if(res2.error) throw res2.error; });
        });
      }
      if(storageMode === 'claude') return dataStore._saveWholeArray();
      if(storageMode === 'indexeddb') return idbClear(STORE_TRADES).then(function(){ return trades.length ? idbBulkPut(STORE_TRADES, trades) : Promise.resolve(); });
      return lsSet('fx-trades', state.trades);
    },
    saveSettings: function(settings){
      if(currentUser && sb){
        return sb.from('user_settings').upsert({
          user_id: currentUser.id,
          starting_balance: settings.startingBalance,
          default_risk: settings.defaultRisk,
          last_backup_at: settings.lastBackupAt || null,
          updated_at: new Date().toISOString()
        }).then(function(res){ if(res.error) throw res.error; });
      }
      if(storageMode === 'claude') return window.storage.set('fx-settings', JSON.stringify(settings), false);
      if(storageMode === 'indexeddb') return idbPut(STORE_META, { key: 'settings', value: settings });
      return lsSet('fx-settings', settings);
    },
    _saveWholeArray: function(){
      return window.storage.set('fx-trades', JSON.stringify(state.trades), false);
    }
  };

  // ---------------- load / init ----------------
  function loadData(){
    var authCheck = (CLOUD_ENABLED && sb)
      ? sb.auth.getSession().then(function(res){ currentUser = res.data.session ? res.data.session.user : null; })
      : Promise.resolve();

    authCheck.then(function(){
      var modeReady = CLAUDE_STORAGE ? Promise.resolve() : idbOpen().then(function(){ storageMode = 'indexeddb'; }).catch(function(){ storageMode = 'local'; });
      return modeReady.then(function(){ return dataStore.loadAll(); });
    }).then(function(res){
      state.trades = res.trades || [];
      state.settings = Object.assign(state.settings, res.settings || {});
      afterLoad();
    }).catch(function(){
      afterLoad();
      showToast("Couldn't load saved data");
    });
  }

  function afterLoad(){
    document.getElementById('sBalance').value = state.settings.startingBalance;
    document.getElementById('sRisk').value = state.settings.defaultRisk;
    document.getElementById('fRisk').value = state.settings.defaultRisk;
    var modeEl = document.getElementById('storageMode');
    if(modeEl){
      var labels = { claude: "Synced with this chat", indexeddb: "Saved on this device — built for thousands of trades", local: "Saved locally in this browser" };
      modeEl.textContent = currentUser ? ("Signed in as " + currentUser.email) : (labels[storageMode] || "");
    }
    renderBackupStatus();
    renderAccountUI();
    renderAll();
  }

  function renderBackupStatus(){
    var el = document.getElementById('sBackup');
    if(!el) return;
    var t = state.settings.lastBackupAt;
    if(!t){ el.textContent = "Never — export one for safety"; return; }
    var d = new Date(t);
    el.textContent = isNaN(d.getTime()) ? "Never" : d.toLocaleDateString(undefined,{month:'short', day:'numeric', year:'numeric'}) + " at " + d.toLocaleTimeString(undefined,{hour:'numeric', minute:'2-digit'});
  }

  // ---------------- account (optional cloud sync) ----------------
  function renderAccountUI(){
    var host = document.getElementById('accountPanel');
    if(!host) return;

    if(!CLOUD_ENABLED){
      host.innerHTML = '<p class="page-sub !mb-0">Cloud accounts aren\'t set up for this deployment yet — trades are saved on this device only.</p>';
      return;
    }

    if(currentUser){
      host.innerHTML =
        '<div class="settings-row">'+
          '<div><div class="t">Signed in</div><div class="s">'+escapeHtml(currentUser.email)+'</div></div>'+
          '<button type="button" class="btn btn-ghost" id="signOutBtn" style="width:auto;padding:9px 16px;">Sign out</button>'+
        '</div>'+
        '<p class="page-sub" style="margin:10px 0 0;">Your trades sync automatically across any device you log into.</p>';
      var so = document.getElementById('signOutBtn');
      if(so) so.addEventListener('click', handleSignOut);
    } else {
      host.innerHTML =
        '<div class="field"><label for="authEmail">Email</label><input type="text" id="authEmail" placeholder="you@example.com" autocomplete="email"></div>'+
        '<div class="field"><label for="authPassword">Password</label><input type="password" id="authPassword" placeholder="At least 6 characters" autocomplete="current-password"></div>'+
        '<div id="authError" class="page-sub" style="color:var(--loss);display:none;margin:0 0 10px;"></div>'+
        '<div class="btn-row" style="margin-top:0;">'+
          '<button type="button" class="btn btn-primary" id="signInBtn">Log in</button>'+
          '<button type="button" class="btn btn-ghost" id="signUpBtn">Sign up</button>'+
        '</div>'+
        '<p class="page-sub" style="margin-top:10px;">Optional — without an account, everything still works and stays on this device.</p>';
      document.getElementById('signInBtn').addEventListener('click', function(){ handleAuth('signIn'); });
      document.getElementById('signUpBtn').addEventListener('click', function(){ handleAuth('signUp'); });
    }
  }

  function showAuthError(msg){
    var el = document.getElementById('authError');
    if(!el) return;
    el.textContent = msg;
    el.style.display = msg ? 'block' : 'none';
  }

  function handleAuth(kind){
    var email = (document.getElementById('authEmail').value || '').trim();
    var password = document.getElementById('authPassword').value || '';
    showAuthError('');
    if(!email || !password){ showAuthError('Enter both an email and a password.'); return; }
    if(password.length < 6){ showAuthError('Password needs to be at least 6 characters.'); return; }

    var btn = document.getElementById(kind === 'signUp' ? 'signUpBtn' : 'signInBtn');
    if(btn) btn.textContent = kind === 'signUp' ? 'Signing up…' : 'Logging in…';

    var call = kind === 'signUp' ? sb.auth.signUp({ email: email, password: password }) : sb.auth.signInWithPassword({ email: email, password: password });
    call.then(function(res){
      if(res.error){ showAuthError(res.error.message); return; }
      if(kind === 'signUp' && res.data && !res.data.session){
        showAuthError('');
        showToast('Check your email to confirm your account, then log in.');
        return;
      }
      currentUser = res.data.user;
      onSignedIn();
    }).catch(function(err){
      showAuthError('Something went wrong. Try again.');
    });
  }

  function onSignedIn(){
    var localTrades = state.trades.slice();
    dataStore.loadAll().then(function(res){
      var cloudTrades = res.trades || [];
      var proceed = function(mergedTrades, mergedSettings){
        state.trades = mergedTrades;
        state.settings = Object.assign(state.settings, mergedSettings || {});
        afterLoad();
        showToast('Signed in');
      };
      if(cloudTrades.length === 0 && localTrades.length > 0){
        if(confirm('Upload your ' + localTrades.length + ' existing local trade' + (localTrades.length===1?'':'s') + ' to your new account?')){
          dataStore.replaceAllTrades(localTrades).then(function(){
            proceed(localTrades, res.settings);
          });
          return;
        }
      }
      proceed(cloudTrades, res.settings);
    });
  }

  function handleSignOut(){
    sb.auth.signOut().then(function(){
      currentUser = null;
      state.trades = [];
      loadData();
      showToast('Signed out');
    });
  }

  function saveTrades(){
    // legacy name kept for the few callers that mean "persist state.trades wholesale"
    return dataStore.replaceAllTrades(state.trades).catch(function(err){
      showToast("Save failed — try again");
      return Promise.reject(err);
    });
  }
  function saveSettings(){
    return dataStore.saveSettings(state.settings).catch(function(err){
      showToast("Save failed — try again");
      return Promise.reject(err);
    });
  }


  // ---------------- calculations ----------------
  function computeTrade(t){
    var priceRisked = (t.entry!=null && t.sl!=null) ? Math.abs(t.entry - t.sl) : null;
    var dirMult = t.direction === "Short" ? -1 : 1;
    var priceResult = (t.exit!=null && t.entry!=null) ? (t.exit - t.entry) * dirMult : null;
    var rMultiple = (priceResult!=null && priceRisked) ? priceResult / priceRisked : null;
    return { priceRisked: priceRisked, priceResult: priceResult, rMultiple: rMultiple };
  }

  // returns trades sorted chronologically, each annotated with riskAmount, pnl, balanceAfter, result
  function computeSeries(){
    var bal = Number(state.settings.startingBalance) || 0;
    var sorted = state.trades.slice().sort(function(a,b){
      var da = (a.date||'') + (a.createdAt||'');
      var db = (b.date||'') + (b.createdAt||'');
      return da < db ? -1 : da > db ? 1 : 0;
    });
    var out = [];
    sorted.forEach(function(t){
      var c = computeTrade(t);
      var riskAmount = (t.riskPct!=null) ? bal * (Number(t.riskPct)/100) : null;
      var pnl = (c.rMultiple!=null && riskAmount!=null) ? c.rMultiple * riskAmount : null;
      var balanceBefore = bal;
      if(pnl!=null){ bal += pnl; }
      var result = pnl==null ? "OPEN" : (pnl>0 ? "WIN" : (pnl<0 ? "LOSS" : "BE"));
      out.push(Object.assign({}, t, c, { riskAmount: riskAmount, pnl: pnl, balanceBefore: balanceBefore, balanceAfter: bal, result: result }));
    });
    return out;
  }

  function computeStats(series){
    var closed = series.filter(function(t){ return t.pnl!=null; });
    var wins = closed.filter(function(t){ return t.result==="WIN"; });
    var losses = closed.filter(function(t){ return t.result==="LOSS"; });
    var netPl = closed.reduce(function(s,t){ return s+t.pnl; }, 0);
    var grossProfit = wins.reduce(function(s,t){ return s+t.pnl; }, 0);
    var grossLoss = losses.reduce(function(s,t){ return s+t.pnl; }, 0);
    var winRate = closed.length ? wins.length/closed.length : null;
    var profitFactor = grossLoss!==0 ? Math.abs(grossProfit/grossLoss) : null;
    var expectancy = closed.length ? netPl/closed.length : null;
    var avgR = closed.length ? closed.reduce(function(s,t){ return s+(t.rMultiple||0); },0)/closed.length : null;
    var balance = series.length ? series[series.length-1].balanceAfter : (Number(state.settings.startingBalance)||0);
    var largestWin = wins.length ? Math.max.apply(null, wins.map(function(t){return t.pnl;})) : null;
    var largestLoss = losses.length ? Math.min.apply(null, losses.map(function(t){return t.pnl;})) : null;

    // streaks (walk closed trades in chronological order)
    var curStreakType = null, curStreakLen = 0, longestWin = 0, longestLoss = 0, runWin = 0, runLoss = 0;
    closed.forEach(function(t){
      if(t.result === "WIN"){ runWin += 1; runLoss = 0; longestWin = Math.max(longestWin, runWin); }
      else if(t.result === "LOSS"){ runLoss += 1; runWin = 0; longestLoss = Math.max(longestLoss, runLoss); }
      else { runWin = 0; runLoss = 0; }
    });
    if(closed.length){
      var last = closed[closed.length-1].result;
      if(last === "WIN" || last === "LOSS"){
        curStreakType = last;
        curStreakLen = 1;
        for(var i=closed.length-2; i>=0; i--){
          if(closed[i].result === last) curStreakLen++; else break;
        }
      }
    }

    return { closedCount: closed.length, openCount: series.length-closed.length, wins: wins.length, losses: losses.length,
      netPl: netPl, winRate: winRate, profitFactor: profitFactor, expectancy: expectancy, avgR: avgR,
      balance: balance, largestWin: largestWin, largestLoss: largestLoss,
      curStreakType: curStreakType, curStreakLen: curStreakLen, longestWinStreak: longestWin, longestLossStreak: longestLoss };
  }

  // ---------------- formatting ----------------
  function money(n){
    if(n==null || isNaN(n)) return "—";
    var sign = n<0 ? "-" : "";
    return sign + "$" + Math.abs(n).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
  }
  function pct(n){ return n==null || isNaN(n) ? "—" : (n*100).toFixed(1)+"%"; }
  function rfmt(n){ return n==null || isNaN(n) ? "—" : (n>=0?"+":"") + n.toFixed(2)+"R"; }
  function fmtDate(d){
    if(!d) return "";
    var dt = new Date(d+"T00:00:00");
    if(isNaN(dt.getTime())) return d;
    return dt.toLocaleDateString(undefined,{month:'short', day:'numeric'});
  }

  // ---------------- rendering ----------------
  // Only the visible tab is fully re-rendered on every data change — this
  // keeps saves/deletes snappy no matter how large the trade history gets.
  var currentSeries = [];
  var currentStats = null;
  function renderAll(){
    var series = computeSeries();
    currentSeries = series;
    currentStats = computeStats(series);
    renderTicker(currentStats, series);
    renderActiveTab();
    document.getElementById('sCount').textContent = state.trades.length + (state.trades.length===1 ? " trade" : " trades");
  }

  function renderActiveTab(){
    var active = document.querySelector('.panel.active');
    if(!active) return;
    if(active.id === 'panel-trades') renderTrades(currentSeries);
    else if(active.id === 'panel-stats') renderStats(currentStats, currentSeries);
  }

  function renderTicker(stats, series){
    document.getElementById('tkBalance').textContent = money(stats.balance);
    var pnlEl = document.getElementById('tkPnl');
    pnlEl.textContent = (stats.netPl>=0?"+":"") + money(stats.netPl);
    pnlEl.style.color = stats.netPl>0 ? "var(--win)" : (stats.netPl<0 ? "var(--loss)" : "var(--text)");

    var spark = document.getElementById('tkSpark');
    var fullPts = [Number(state.settings.startingBalance)||0].concat(series.map(function(t){return t.balanceAfter;}));
    var pts = downsample(fullPts, 60);
    if(pts.length<2){ spark.innerHTML=""; return; }
    var min = Math.min.apply(null,pts), max = Math.max.apply(null,pts);
    var range = (max-min)||1;
    var w=64,h=28,pad=2;
    var step = (w-pad*2)/(pts.length-1);
    var d = pts.map(function(v,i){
      var x = pad + i*step;
      var y = h-pad - ((v-min)/range)*(h-pad*2);
      return (i===0?"M":"L")+x.toFixed(1)+","+y.toFixed(1);
    }).join(" ");
    var color = pts[pts.length-1] >= pts[0] ? "#3ECF8E" : "#FF6B6B";
    spark.innerHTML = '<path d="'+d+'" fill="none" stroke="'+color+'" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>';
  }

  var TRADES_PAGE_SIZE = 50;
  var visibleTradesCount = TRADES_PAGE_SIZE;
  var lastSearchQuery = null;

  function renderTrades(series){
    var list = document.getElementById('tradeList');
    var q = (document.getElementById('tradeSearch').value || "").trim().toLowerCase();
    if(q !== lastSearchQuery){ visibleTradesCount = TRADES_PAGE_SIZE; lastSearchQuery = q; }
    var filtered = q ? series.filter(function(t){
      return (t.pair||"").toLowerCase().indexOf(q) !== -1 || (t.notes||"").toLowerCase().indexOf(q) !== -1;
    }) : series;
    if(!series.length){
      list.innerHTML = emptyState("No trades yet", "Log your first trade from the Log tab — it'll show up here.");
      return;
    }
    if(!filtered.length){
      list.innerHTML = emptyState("No matches", "Try a different pair or keyword.");
      return;
    }
    var rev = filtered.slice().reverse();
    var toShow = rev.slice(0, visibleTradesCount);
    var cardsHtml = toShow.map(function(t, i){
      var badgeClass = t.result==="WIN"?"badge-win":t.result==="LOSS"?"badge-loss":t.result==="OPEN"?"badge-open":"badge-be";
      var dirClass = t.direction==="Short"?"badge-short":"badge-long";
      var pnlColor = t.pnl>0?"var(--win)":t.pnl<0?"var(--loss)":"var(--text-dim)";
      return '<div class="trade-card" data-id="'+t.id+'" style="--card-i:'+Math.min(i,20)+'">'+
        '<div class="trade-top">'+
          '<span class="trade-pair">'+escapeHtml(t.pair||"—")+'</span>'+
          '<span class="badge '+dirClass+'">'+t.direction+'</span>'+
        '</div>'+
        '<div class="trade-mid">'+
          '<span class="trade-r num">'+ (t.rMultiple!=null? rfmt(t.rMultiple) : 'Open') +'</span>'+
          '<span class="trade-pnl num" style="color:'+pnlColor+'">'+ (t.pnl!=null? money(t.pnl) : '—') +'</span>'+
        '</div>'+
        '<div class="trade-bottom">'+
          '<span>'+fmtDate(t.date)+'</span>'+
          '<span class="badge '+badgeClass+'">'+t.result+'</span>'+
        '</div>'+
      '</div>';
    }).join("");
    var remaining = rev.length - toShow.length;
    var loadMoreHtml = remaining > 0
      ? '<button type="button" class="btn btn-ghost" id="loadMoreBtn">Show '+Math.min(remaining, TRADES_PAGE_SIZE)+' more ('+remaining+' left)</button>'
      : (rev.length > TRADES_PAGE_SIZE ? '<p class="page-sub text-center">All '+rev.length+' trades shown</p>' : '');
    list.innerHTML = cardsHtml + loadMoreHtml;
    Array.prototype.forEach.call(list.querySelectorAll('.trade-card'), function(el){
      el.addEventListener('click', function(){ openEdit(el.getAttribute('data-id')); });
    });
    var loadMoreBtn = document.getElementById('loadMoreBtn');
    if(loadMoreBtn){
      loadMoreBtn.addEventListener('click', function(){
        visibleTradesCount += TRADES_PAGE_SIZE;
        renderTrades(currentSeries);
      });
    }
  }

  function emptyState(title, sub){
    return '<div class="empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 19V5a2 2 0 012-2h9l5 5v11a2 2 0 01-2 2H6a2 2 0 01-2-2z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>'+
      '<div class="t">'+title+'</div><div class="s">'+sub+'</div></div>';
  }

  function renderStats(s, series){
    var grid = document.getElementById('kpiGrid');
    var streakLabel = s.curStreakType ? (s.curStreakLen + " " + (s.curStreakType==="WIN"?"win":"loss") + (s.curStreakLen>1?"s":"")) : "—";
    var items = [
      ["Balance", money(s.balance), ""],
      ["Net P&L", (s.netPl>=0?"+":"")+money(s.netPl), s.netPl>0?"win":s.netPl<0?"loss":""],
      ["Win rate", pct(s.winRate), ""],
      ["Profit factor", s.profitFactor==null?"—":s.profitFactor.toFixed(2), ""],
      ["Closed trades", s.closedCount, ""],
      ["Open trades", s.openCount, ""],
      ["Expectancy", s.expectancy==null?"—":money(s.expectancy), ""],
      ["Avg R-multiple", s.avgR==null?"—":rfmt(s.avgR), ""],
      ["Largest win", s.largestWin==null?"—":money(s.largestWin), "win"],
      ["Largest loss", s.largestLoss==null?"—":money(s.largestLoss), "loss"],
      ["Current streak", streakLabel, s.curStreakType==="WIN"?"win":s.curStreakType==="LOSS"?"loss":""],
      ["Longest streaks", s.longestWinStreak+"W / "+s.longestLossStreak+"L", ""],
    ];
    grid.innerHTML = items.map(function(it, i){
      return '<div class="kpi" style="--kpi-i:'+i+'"><div class="lbl">'+it[0]+'</div><div class="val num '+it[2]+'">'+it[1]+'</div></div>';
    }).join("");

    renderEquityChart(series);
    renderPairTable(series);
    renderPeriodTable(series, currentPeriod);
  }

  function downsample(arr, maxPoints){
    if(arr.length <= maxPoints) return arr;
    var stride = Math.ceil(arr.length / maxPoints);
    var out = [];
    for(var i=0; i<arr.length; i+=stride) out.push(arr[i]);
    if(out[out.length-1] !== arr[arr.length-1]) out.push(arr[arr.length-1]);
    return out;
  }

  function renderEquityChart(series){
    var svg = document.getElementById('equityChart');
    var full = [Number(state.settings.startingBalance)||0].concat(series.map(function(t){return t.balanceAfter;}));
    var pts = downsample(full, 300);
    if(pts.length < 2){
      svg.innerHTML = '<text x="300" y="110" text-anchor="middle" fill="#5B6480" font-size="13" font-family="Space Grotesk">No closed trades yet</text>';
      return;
    }
    var W=600, H=220, padL=54, padR=14, padT=16, padB=26;
    var min = Math.min.apply(null,pts), max = Math.max.apply(null,pts);
    if(min===max){ min -= 1; max += 1; }
    var range = max-min;
    var innerW = W-padL-padR, innerH = H-padT-padB;
    var step = innerW/(pts.length-1);
    function X(i){ return padL + i*step; }
    function Y(v){ return padT + innerH - ((v-min)/range)*innerH; }
    var d = pts.map(function(v,i){ return (i===0?"M":"L")+X(i).toFixed(1)+","+Y(v).toFixed(1); }).join(" ");
    var areaD = d + " L"+X(pts.length-1).toFixed(1)+","+(padT+innerH)+" L"+X(0).toFixed(1)+","+(padT+innerH)+" Z";
    var color = pts[pts.length-1] >= pts[0] ? "#3ECF8E" : "#FF6B6B";

    var gridLines = "";
    var steps = 4;
    for(var g=0; g<=steps; g++){
      var val = min + (range*g/steps);
      var y = Y(val);
      gridLines += '<line x1="'+padL+'" y1="'+y.toFixed(1)+'" x2="'+(W-padR)+'" y2="'+y.toFixed(1)+'" stroke="#1C2846" stroke-width="1"/>';
      gridLines += '<text x="'+(padL-8)+'" y="'+(y+3).toFixed(1)+'" text-anchor="end" fill="#5B6480" font-size="9.5" font-family="JetBrains Mono">'+money(val)+'</text>';
    }

    svg.innerHTML =
      '<defs><linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">'+
        '<stop offset="0%" stop-color="'+color+'" stop-opacity="0.22"/>'+
        '<stop offset="100%" stop-color="'+color+'" stop-opacity="0"/>'+
      '</linearGradient></defs>'+
      gridLines +
      '<path d="'+areaD+'" fill="url(#eqFill)" stroke="none"/>'+
      '<path d="'+d+'" fill="none" stroke="'+color+'" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
  }

  function renderPairTable(series){
    var closed = series.filter(function(t){ return t.pnl!=null; });
    var byPair = {};
    closed.forEach(function(t){
      var p = t.pair || "—";
      if(!byPair[p]) byPair[p] = { trades:0, wins:0, pnl:0 };
      byPair[p].trades++;
      if(t.result==="WIN") byPair[p].wins++;
      byPair[p].pnl += t.pnl;
    });
    var pairs = Object.keys(byPair).sort(function(a,b){ return byPair[b].pnl - byPair[a].pnl; });
    var table = document.getElementById('pairTable');
    if(!pairs.length){
      table.innerHTML = '<tr><td class="table-empty">No closed trades yet</td></tr>';
      return;
    }
    var rows = pairs.map(function(p){
      var d = byPair[p];
      var wr = d.trades ? d.wins/d.trades : 0;
      var color = d.pnl>0?"var(--win)":d.pnl<0?"var(--loss)":"var(--text-dim)";
      return '<tr>'+
        '<td class="table-td">'+escapeHtml(p)+'</td>'+
        '<td class="table-td-c">'+d.trades+'</td>'+
        '<td class="table-td-c">'+pct(wr)+'</td>'+
        '<td class="table-td-r" style="color:'+color+'">'+money(d.pnl)+'</td>'+
      '</tr>';
    }).join("");
    table.innerHTML = '<tr class="bg-surface-2">'+
      '<th class="table-th">Symbol</th>'+
      '<th class="table-th-c">Trades</th>'+
      '<th class="table-th-c">Win%</th>'+
      '<th class="table-th-r">Net P&amp;L</th>'+
    '</tr>' + rows;
  }

  // ---------------- period breakdown (week-of-month / month / quarter / year) ----------------
  var currentPeriod = 'month';

  function periodKeyLabel(t, period){
    var d = new Date(t.date+"T00:00:00");
    if(isNaN(d.getTime())) return null;
    var y = d.getFullYear(), m = d.getMonth()+1, day = d.getDate();
    if(period === 'week'){
      var wk = Math.ceil(day/7);
      var key = y+"-"+String(m).padStart(2,"0")+"-W"+wk;
      var mName = d.toLocaleDateString(undefined,{month:'short'});
      return { key: key, label: mName+" "+y+" · Wk "+wk };
    }
    if(period === 'month'){
      var key2 = y+"-"+String(m).padStart(2,"0");
      return { key: key2, label: d.toLocaleDateString(undefined,{month:'short', year:'numeric'}) };
    }
    if(period === 'quarter'){
      var q = Math.floor(d.getMonth()/3)+1;
      var key3 = y+"-Q"+q;
      return { key: key3, label: "Q"+q+" "+y };
    }
    // year
    return { key: String(y), label: String(y) };
  }

  function renderPeriodTable(series, period){
    var closed = series.filter(function(t){ return t.pnl!=null && t.date; });
    var groups = {};
    closed.forEach(function(t){
      var kl = periodKeyLabel(t, period);
      if(!kl) return;
      if(!groups[kl.key]) groups[kl.key] = { label: kl.label, trades:0, wins:0, pnl:0 };
      groups[kl.key].trades++;
      if(t.result==="WIN") groups[kl.key].wins++;
      groups[kl.key].pnl += t.pnl;
    });
    var keys = Object.keys(groups).sort().reverse();
    var table = document.getElementById('periodTable');
    if(!keys.length){
      table.innerHTML = '<tr><td class="table-empty">No closed trades yet</td></tr>';
      return;
    }
    var colLabel = period === 'week' ? 'Week' : period === 'month' ? 'Month' : period === 'quarter' ? 'Quarter' : 'Year';
    var rows = keys.map(function(k){
      var d = groups[k];
      var wr = d.trades ? d.wins/d.trades : 0;
      var color = d.pnl>0?"var(--win)":d.pnl<0?"var(--loss)":"var(--text-dim)";
      return '<tr>'+
        '<td class="table-td whitespace-nowrap">'+d.label+'</td>'+
        '<td class="table-td-c">'+d.trades+'</td>'+
        '<td class="table-td-c">'+pct(wr)+'</td>'+
        '<td class="table-td-r" style="color:'+color+'">'+money(d.pnl)+'</td>'+
      '</tr>';
    }).join("");
    table.innerHTML = '<tr class="bg-surface-2">'+
      '<th class="table-th">'+colLabel+'</th>'+
      '<th class="table-th-c">Trades</th>'+
      '<th class="table-th-c">Win%</th>'+
      '<th class="table-th-r">Net P&amp;L</th>'+
    '</tr>' + rows;
  }

  Array.prototype.forEach.call(document.querySelectorAll('#periodTabs .chip'), function(btn){
    btn.addEventListener('click', function(){
      currentPeriod = btn.getAttribute('data-period');
      Array.prototype.forEach.call(document.querySelectorAll('#periodTabs .chip'), function(b){
        b.classList.toggle('selected', b===btn);
      });
      renderPeriodTable(currentSeries, currentPeriod);
    });
  });

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }

  // ---------------- toast ----------------
  var toastTimer = null;
  function showToast(msg){
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ el.classList.remove('show'); }, 2200);
  }

  // ---------------- tabs ----------------
  function setTab(tab){
    Array.prototype.forEach.call(document.querySelectorAll('.nav-btn'), function(b){
      b.classList.toggle('active', b.getAttribute('data-tab')===tab);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.panel'), function(p){
      p.classList.toggle('active', p.id==='panel-'+tab);
    });
    closeDrawer();
    if(currentStats) renderActiveTab();
  }
  Array.prototype.forEach.call(document.querySelectorAll('.nav-btn'), function(b){
    b.addEventListener('click', function(){ setTab(b.getAttribute('data-tab')); });
  });

  // ---------------- nav drawer (phone/tablet) ----------------
  var navEl = document.getElementById('mainNav');
  var backdropEl = document.getElementById('navBackdrop');
  function openDrawer(){
    navEl.classList.add('open');
    backdropEl.classList.add('show');
  }
  function closeDrawer(){
    navEl.classList.remove('open');
    backdropEl.classList.remove('show');
  }
  document.getElementById('hamburgerBtn').addEventListener('click', openDrawer);
  document.getElementById('navClose').addEventListener('click', closeDrawer);
  backdropEl.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape') closeDrawer();
  });

  // ---------------- theme ----------------
  function getTheme(){ return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'; }
  function applyThemeButtons(theme){
    var lightBtn = document.getElementById('themeLightBtn');
    var darkBtn = document.getElementById('themeDarkBtn');
    if(lightBtn && darkBtn){
      lightBtn.classList.toggle('selected', theme==='light');
      darkBtn.classList.toggle('selected', theme!=='light');
    }
  }
  function setTheme(theme){
    if(theme === 'light') document.documentElement.setAttribute('data-theme','light');
    else document.documentElement.removeAttribute('data-theme');
    applyThemeButtons(theme);
    try{ localStorage.setItem('tradejournal-theme', theme); }catch(e){}
    renderAll(); // re-draw the equity chart / pie so their colors match the new theme
  }
  applyThemeButtons(getTheme());
  document.getElementById('themeLightBtn').addEventListener('click', function(){ setTheme('light'); });
  document.getElementById('themeDarkBtn').addEventListener('click', function(){ setTheme('dark'); });

  // ---------------- install prompt ----------------
  var deferredInstallPrompt = null;
  window.addEventListener('beforeinstallprompt', function(e){
    e.preventDefault();
    deferredInstallPrompt = e;
    var btn = document.getElementById('installBtn');
    if(btn) btn.style.display = 'block';
  });
  var installBtnEl = document.getElementById('installBtn');
  if(installBtnEl){
    installBtnEl.addEventListener('click', function(){
      if(!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      deferredInstallPrompt.userChoice.then(function(){
        deferredInstallPrompt = null;
        installBtnEl.style.display = 'none';
      });
    });
  }
  window.addEventListener('appinstalled', function(){
    if(installBtnEl) installBtnEl.style.display = 'none';
  });

  // ---------------- log form ----------------
  function renderPairChips(){
    var host = document.getElementById('pairChips');
    host.innerHTML = MAJOR_PAIRS.map(function(p){
      return '<button type="button" class="chip" data-pair="'+p+'">'+p+'</button>';
    }).join("");
    Array.prototype.forEach.call(host.querySelectorAll('.chip'), function(c){
      c.addEventListener('click', function(){
        selectedPair = c.getAttribute('data-pair');
        document.getElementById('pairCustom').value = "";
        Array.prototype.forEach.call(host.querySelectorAll('.chip'), function(x){ x.classList.toggle('selected', x===c); });
      });
    });
  }
  renderPairChips();
  document.getElementById('pairCustom').addEventListener('input', function(){
    if(this.value){ selectedPair = this.value;
      Array.prototype.forEach.call(document.querySelectorAll('#pairChips .chip'), function(x){ x.classList.remove('selected'); });
    }
  });

  Array.prototype.forEach.call(document.querySelectorAll('.toggle-btn'), function(b){
    b.addEventListener('click', function(){
      selectedDir = b.getAttribute('data-dir');
      Array.prototype.forEach.call(document.querySelectorAll('.toggle-btn'), function(x){ x.classList.toggle('active', x===b); });
    });
  });

  document.getElementById('fDate').valueAsDate = new Date();

  document.getElementById('tradeForm').addEventListener('submit', function(e){
    e.preventDefault();
    var pair = selectedPair || document.getElementById('pairCustom').value.trim();
    var entry = parseFloat(document.getElementById('fEntry').value);
    var sl = parseFloat(document.getElementById('fSL').value);
    if(!pair){ showToast("Pick or type a symbol"); return; }
    if(isNaN(entry) || isNaN(sl)){ showToast("Entry and stop loss are required"); return; }

    var t = {
      id: 't'+Date.now()+Math.random().toString(36).slice(2,7),
      pair: pair,
      direction: selectedDir,
      date: document.getElementById('fDate').value || new Date().toISOString().slice(0,10),
      entry: entry,
      sl: sl,
      tp: parseOrNull(document.getElementById('fTP').value),
      riskPct: parseOrNull(document.getElementById('fRisk').value),
      lot: parseOrNull(document.getElementById('fLot').value),
      exit: parseOrNull(document.getElementById('fExit').value),
      exitDate: document.getElementById('fExitDate').value || null,
      notes: document.getElementById('fNotes').value,
      createdAt: new Date().toISOString()
    };
    state.trades.push(t);
    dataStore.saveTrade(t).then(function(){
      showToast("Trade saved");
      renderAll();
      resetForm();
    }).catch(function(){ showToast("Save failed — try again"); });
  });

  function parseOrNull(v){ if(v===""||v==null) return null; var n=parseFloat(v); return isNaN(n)?null:n; }

  function resetForm(){
    document.getElementById('tradeForm').reset();
    document.getElementById('fRisk').value = state.settings.defaultRisk;
    document.getElementById('fDate').valueAsDate = new Date();
    selectedPair = "";
    selectedDir = "Long";
    Array.prototype.forEach.call(document.querySelectorAll('#pairChips .chip'), function(x){ x.classList.remove('selected'); });
    Array.prototype.forEach.call(document.querySelectorAll('.toggle-btn'), function(x){ x.classList.toggle('active', x.getAttribute('data-dir')==='Long'); });
  }

  // ---------------- edit modal ----------------
  function openEdit(id){
    var t = state.trades.find(function(x){ return x.id===id; });
    if(!t) return;
    editingId = id;
    var host = document.getElementById('editFormHost');
    host.innerHTML =
      '<div class="section-label" style="margin-top:0;">Symbol &amp; direction</div>'+
      '<div class="field-row">'+
        '<div class="field"><label>Symbol</label><input type="text" id="ePair" value="'+escapeAttr(t.pair)+'"></div>'+
        '<div class="field"><label>Direction</label><select id="eDir"><option '+(t.direction==="Long"?"selected":"")+'>Long</option><option '+(t.direction==="Short"?"selected":"")+'>Short</option></select></div>'+
      '</div>'+
      '<div class="section-label">Risk management</div>'+
      '<div class="field-row3">'+
        '<div class="field"><label>Entry</label><input type="number" step="any" id="eEntry" value="'+valOr(t.entry)+'"></div>'+
        '<div class="field"><label>Stop loss</label><input type="number" step="any" id="eSL" value="'+valOr(t.sl)+'"></div>'+
        '<div class="field"><label>Take profit</label><input type="number" step="any" id="eTP" value="'+valOr(t.tp)+'"></div>'+
      '</div>'+
      '<div class="field-row">'+
        '<div class="field"><label>Risk %</label><input type="number" step="any" id="eRisk" value="'+valOr(t.riskPct)+'"></div>'+
        '<div class="field"><label>Size</label><input type="number" step="any" id="eLot" value="'+valOr(t.lot)+'"></div>'+
      '</div>'+
      '<div class="section-label">Dates</div>'+
      '<div class="field-row">'+
        '<div class="field"><label>Date</label><input type="date" id="eDate" value="'+(t.date||'')+'"></div>'+
        '<div class="field"><label>Exit date</label><input type="date" id="eExitDate" value="'+(t.exitDate||'')+'"></div>'+
      '</div>'+
      '<div class="section-label">Exit</div>'+
      '<div class="field"><label>Exit price</label><input type="number" step="any" id="eExit" value="'+valOr(t.exit)+'" placeholder="leave blank if still open"></div>'+
      '<div class="section-label">Notes</div>'+
      '<div class="field"><textarea id="eNotes">'+escapeHtml(t.notes||"")+'</textarea></div>'+
      '<div class="btn-row">'+
        '<button type="button" class="btn btn-danger" id="deleteBtn">Delete</button>'+
        '<button type="button" class="btn btn-primary" id="updateBtn">Save changes</button>'+
      '</div>';

    document.getElementById('updateBtn').addEventListener('click', function(){
      var pair = document.getElementById('ePair').value.trim();
      var entry = parseFloat(document.getElementById('eEntry').value);
      var sl = parseFloat(document.getElementById('eSL').value);
      if(!pair){ showToast("Symbol is required"); return; }
      if(isNaN(entry) || isNaN(sl)){ showToast("Entry and stop loss are required"); return; }
      Object.assign(t, {
        pair: pair,
        direction: document.getElementById('eDir').value,
        entry: entry,
        sl: sl,
        tp: parseOrNull(document.getElementById('eTP').value),
        riskPct: parseOrNull(document.getElementById('eRisk').value),
        lot: parseOrNull(document.getElementById('eLot').value),
        date: document.getElementById('eDate').value,
        exitDate: document.getElementById('eExitDate').value || null,
        exit: parseOrNull(document.getElementById('eExit').value),
        notes: document.getElementById('eNotes').value
      });
      dataStore.saveTrade(t).then(function(){ showToast("Trade updated"); renderAll(); closeEdit(); }).catch(function(){ showToast("Save failed — try again"); });
    });
    document.getElementById('deleteBtn').addEventListener('click', function(){
      var id = editingId;
      state.trades = state.trades.filter(function(x){ return x.id!==id; });
      dataStore.deleteTrade(id).then(function(){ showToast("Trade deleted"); renderAll(); closeEdit(); }).catch(function(){ showToast("Delete failed — try again"); });
    });

    document.getElementById('editModal').classList.add('show');
  }
  function valOr(v){ return v==null ? "" : v; }
  function escapeAttr(s){ return escapeHtml(s||""); }
  function closeEdit(){ document.getElementById('editModal').classList.remove('show'); editingId=null; }
  document.getElementById('closeModal').addEventListener('click', closeEdit);
  document.getElementById('editModal').addEventListener('click', function(e){
    if(e.target===this) closeEdit();
  });

  // ---------------- settings ----------------
  document.getElementById('saveSettingsBtn').addEventListener('click', function(){
    var bal = parseFloat(document.getElementById('sBalance').value);
    var risk = parseFloat(document.getElementById('sRisk').value);
    state.settings.startingBalance = isNaN(bal) ? 0 : bal;
    state.settings.defaultRisk = isNaN(risk) ? 1 : risk;
    saveSettings().then(function(){ showToast("Settings saved"); renderAll(); });
  });
  document.getElementById('resetBtn').addEventListener('click', function(){
    if(!confirm("Erase every trade? This can't be undone.")) return;
    state.trades = [];
    saveTrades().then(function(){ showToast("All trades erased"); renderAll(); });
  });

  // ---------------- search ----------------
  document.getElementById('tradeSearch').addEventListener('input', function(){
    renderTrades(currentSeries);
  });

  // ---------------- export / import ----------------
  function downloadFile(filename, content, mime){
    var blob = new Blob([content], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
  }

  document.getElementById('exportCsvBtn').addEventListener('click', function(){
    if(!currentSeries.length){ showToast("No trades to export"); return; }
    var cols = ["date","pair","direction","entry","sl","tp","lot","riskPct","exit","exitDate","rMultiple","pnl","balanceAfter","result","notes"];
    var headerLabels = ["date","symbol","direction","entry","sl","tp","size","riskPct","exit","exitDate","rMultiple","pnl","balanceAfter","result","notes"];
    var header = headerLabels.join(",");
    var rows = currentSeries.map(function(t){
      return cols.map(function(c){
        var v = t[c];
        if(v==null) return "";
        v = String(v).replace(/"/g,'""');
        return /[,"\n]/.test(v) ? '"'+v+'"' : v;
      }).join(",");
    });
    downloadFile("tradejournal-trades.csv", header+"\n"+rows.join("\n"), "text/csv");
    showToast("CSV exported");
  });

  document.getElementById('exportJsonBtn').addEventListener('click', function(){
    var payload = JSON.stringify({ trades: state.trades, settings: state.settings, exportedAt: new Date().toISOString() }, null, 2);
    downloadFile("tradejournal-backup.json", payload, "application/json");
    state.settings.lastBackupAt = new Date().toISOString();
    saveSettings().then(renderBackupStatus);
    showToast("Backup exported");
  });

  document.getElementById('importJsonBtn').addEventListener('click', function(){
    document.getElementById('importFile').click();
  });
  document.getElementById('importFile').addEventListener('change', function(e){
    var file = e.target.files && e.target.files[0];
    if(!file) return;
    var reader = new FileReader();
    reader.onload = function(){
      try{
        var data = JSON.parse(reader.result);
        if(!data || !Array.isArray(data.trades)) throw new Error("bad format");
        if(!confirm("Replace current trades with this backup? ("+data.trades.length+" trades)")) return;
        state.trades = data.trades;
        if(data.settings) state.settings = Object.assign(state.settings, data.settings);
        Promise.all([saveTrades(), saveSettings()]).then(function(){
          showToast("Backup restored");
          afterLoad();
        });
      }catch(err){
        showToast("That file doesn't look like a valid backup");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  });

  // Test hook for automated QA only — harmless no-op for real users, but lets
  // an automated test drive the same save/render path a real user would hit.
  window.__tjTest = {
    bulkImport: function(trades){ return dataStore.replaceAllTrades(trades).then(renderAll); },
    timeRenderStats: function(){ var t0=performance.now(); renderStats(currentStats, currentSeries); return performance.now()-t0; },
    timeRenderTrades: function(){ var t0=performance.now(); renderTrades(currentSeries); return performance.now()-t0; },
    timeCompute: function(){ var t0=performance.now(); computeStats(computeSeries()); return performance.now()-t0; }
  };

  loadData();

  // ---------------- PWA: service worker registration (safe no-op if unsupported/sandboxed) ----------------
  if("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")){
    window.addEventListener("load", function(){
      navigator.serviceWorker.register("sw.js").catch(function(){ /* ignore — app still works fully online */ });
    });
  }
})();
